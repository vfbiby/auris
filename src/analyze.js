// Listens to a track before it plays: band envelopes, kick onsets, tempo,
// beat phase, and the arrangement (breakdown → build → drop).

export const FPS = 100;

export async function analyzeTrack(buffer, onStep = () => {}) {
  onStep('Splitting the spectrum');
  const bands = await renderBands(buffer);
  const n = bands.low.length;

  onStep('Tracing the kick');
  const low = normalize(bands.low);
  const mid = normalize(bands.mid);
  const high = normalize(bands.high);

  // onset strength: how much the low end rose over the last 30 ms
  const flux = new Float32Array(n);
  for (let i = 3; i < n; i++) flux[i] = Math.max(0, low[i] - low[i - 3]);

  onStep('Finding the tempo');
  const { bpm, offset, period } = estimateTempo(flux);

  // Kicks: strong low-end onsets that sit on the beat grid. Offbeat basslines
  // can hit as hard as the kick, but they never land on the grid.
  const kicks = [];
  for (let b = offset * FPS; b < n; b += period) {
    let best = 0;
    let at = -1;
    for (let i = Math.max(3, Math.round(b) - 4); i <= Math.min(n - 1, Math.round(b) + 5); i++) {
      if (flux[i] > best) {
        best = flux[i];
        at = i;
      }
    }
    if (best > 0.22) kicks.push(at);
  }

  onStep('Mapping the arrangement');
  const sections = findSections({ low, mid, high, kicks, bpm, offset, duration: buffer.duration });

  const kickEnv = new Float32Array(n);
  for (const k of kicks) {
    for (let j = 0; j < 40 && k + j < n; j++) {
      kickEnv[k + j] = Math.max(kickEnv[k + j], Math.exp(-j / 12) * Math.min(1, flux[k] * 2.2));
    }
  }

  return {
    duration: buffer.duration,
    bpm,
    offset,
    low,
    mid,
    high,
    kick: kickEnv,
    kicks: kicks.map((k) => k / FPS),
    overview: overview(low, mid, high, 240),
    ...sections,
  };
}

async function renderBands(buffer) {
  const sr = buffer.sampleRate;
  const ctx = new OfflineAudioContext(3, buffer.length, sr);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const merger = ctx.createChannelMerger(3);
  const chain = (specs, ch) => {
    let node = src;
    for (const [type, freq, q] of specs) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      node.connect(f);
      node = f;
    }
    node.connect(merger, 0, ch);
  };
  chain([['lowpass', 130], ['lowpass', 130]], 0);
  chain([['highpass', 300], ['lowpass', 3000]], 1);
  chain([['highpass', 5000], ['highpass', 5000]], 2);
  merger.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();

  const hop = Math.round(sr / FPS);
  const frames = Math.floor(out.length / hop);
  const rms = (ch) => {
    const d = out.getChannelData(ch);
    const e = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      const o = f * hop;
      for (let i = 0; i < hop; i++) s += d[o + i] * d[o + i];
      e[f] = Math.sqrt(s / hop);
    }
    return e;
  };
  return { low: rms(0), mid: rms(1), high: rms(2) };
}

function percentile(arr, p) {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 1e-6;
}

function normalize(arr) {
  const top = percentile(arr, 0.985);
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.min(1, arr[i] / top);
  return out;
}

function smooth(arr, win) {
  const out = new Float32Array(arr.length);
  let acc = 0;
  const h = Math.floor(win / 2);
  for (let i = -h; i < arr.length + h; i++) {
    const add = arr[i + h] ?? 0;
    const sub = arr[i - h - 1] ?? 0;
    acc += add - sub;
    if (i >= 0 && i < arr.length) out[i] = acc / win;
  }
  return out;
}

function estimateTempo(flux) {
  const n = flux.length;
  let best = 0;
  let bestLag = 50;
  // lag in frames: 60..190 BPM
  for (let lag = Math.floor((60 * FPS) / 190); lag <= Math.ceil((60 * FPS) / 60); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag];
    // favour the 100–150 BPM region a touch, where dance music lives
    const bpm = (60 * FPS) / lag;
    const w = Math.exp(-Math.pow(Math.log2(bpm / 124), 2) * 1.2);
    if (s * w > best) {
      best = s * w;
      bestLag = lag;
    }
  }
  // parabolic refine over neighbours
  const ac = (lag) => {
    let s = 0;
    for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag];
    return s;
  };
  const a = ac(bestLag - 1);
  const b = ac(bestLag);
  const c = ac(bestLag + 1);
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const coarse = bestLag + Math.max(-0.5, Math.min(0.5, shift));

  // Fine fit: the grid that collects the most onset energy across the whole
  // track. Even 0.1 BPM of error drifts ~90 ms over two minutes.
  const gridSum = (p, off) => {
    let s = 0;
    for (let t = off; t < n; t += p) s += flux[Math.round(t)] || 0;
    return s;
  };
  let period = coarse;
  let offset = 0;
  let bestSum = -1;
  for (let p = coarse * 0.995; p <= coarse * 1.005; p += 0.004) {
    for (let off = 0; off < p; off += 0.5) {
      const s = gridSum(p, off);
      if (s > bestSum) {
        bestSum = s;
        period = p;
        offset = off;
      }
    }
  }
  // the grid is periodic; report the earliest equivalent phase
  if (offset > period - 2) offset -= period;
  offset = Math.max(0, offset);
  return { bpm: (60 * FPS) / period, period, offset: offset / FPS };
}

function findSections({ low, mid, high, kicks, bpm, offset, duration }) {
  const n = low.length;
  const lowS = smooth(low, 400);
  const full = new Float32Array(n);
  for (let i = 0; i < n; i++) full[i] = (low[i] + mid[i] + high[i]) / 3;
  const fullS = smooth(full, 400);
  const lowLevel = percentile(lowS, 0.7);
  const fullLevel = percentile(fullS, 0.7);
  const barSec = (60 / bpm) * 4;
  // Beat phase says nothing about which beat is "one"; the drop does.
  let anchor = offset;
  const snapBar = (t) => anchor + Math.round((t - anchor) / barSec) * barSec;

  // Breakdown: longest stretch where the low end drops away, not at the edges.
  let runs = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const quiet = lowS[i] < lowLevel * 0.4;
    if (quiet && start < 0) start = i;
    if ((!quiet || i === n - 1) && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }
  runs = runs.filter(([a, b]) => b - a > 6 * FPS && a > 8 * FPS && b < n - 8 * FPS);
  runs.sort((x, y) => y[1] - y[0] - (x[1] - x[0]));

  let breakdown = null;
  let build = null;
  let drop = null;
  if (runs.length) {
    // the smoothing window smears edges by seconds; anchor on real kicks instead
    const [a, b] = runs[0];
    const centre = (a + b) / 2;
    const before = kicks.filter((k) => k < centre).pop();
    const after = kicks.find((k) => k > centre);
    const dropT = after != null ? after / FPS : snapBar(b / FPS);
    anchor = dropT;
    const startT = snapBar(before != null ? before / FPS + 60 / bpm : a / FPS);
    breakdown = { start: startT, end: dropT };
    drop = dropT;

    // Build: percussion creeping back in. Walk back from the drop bar by bar
    // while the highs still carry rhythmic transients.
    const hits = (t0) => {
      let c = 0;
      for (let i = Math.floor(t0 * FPS); i < (t0 + barSec) * FPS; i++) {
        const d = high[i] - high[i - 2];
        if (d > 0.12 && d >= high[i - 1] - high[i - 3]) {
          c++;
          i += 8;
        }
      }
      return c;
    };
    let buildT = dropT;
    while (buildT - barSec > startT && hits(buildT - barSec) >= 3) buildT -= barSec;
    if (buildT < dropT - barSec) build = buildT;
  }

  // Intro: until the mids (snares, claps, bass harmonics) arrive.
  const midS = smooth(mid, 200);
  const midLevel = percentile(midS, 0.7);
  const midStart = percentile(midS.slice(0, 8 * FPS), 0.5);
  let introEnd = 0;
  for (let i = 0; i < n; i++) {
    if (midS[i] > Math.max(midLevel * 0.3, midStart * 1.8)) {
      introEnd = snapBar(i / FPS);
      break;
    }
  }
  let outro = duration;
  for (let i = n - 1; i > (drop ?? 0) * FPS; i--) {
    if (lowS[i] > lowLevel * 0.75 && fullS[i] > fullLevel * 0.7) {
      outro = snapBar(i / FPS);
      break;
    }
  }

  // tracks without a distinct mid-range entry would otherwise be "all intro"
  if (breakdown && introEnd > breakdown.start * 0.6) introEnd = Math.min(snapBar(8 * barSec), breakdown.start);
  const sections = [];
  const push = (name, a, b) => b - a > 0.5 && sections.push({ name, start: a, end: b });
  if (breakdown) {
    push('Intro', 0, introEnd);
    push('Groove', introEnd, breakdown.start);
    push('Breakdown', breakdown.start, build ?? drop);
    if (build) push('Build', build, drop);
    push('Drop', drop, outro);
    push('Outro', outro, duration);
  } else {
    push('Intro', 0, introEnd);
    push('Groove', introEnd, outro);
    push('Outro', outro, duration);
  }
  return { sections, drop, breakdown, build, barOffset: ((anchor % barSec) + barSec) % barSec };
}

function overview(low, mid, high, cols) {
  const n = low.length;
  const out = [];
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((c * n) / cols);
    const b = Math.floor(((c + 1) * n) / cols);
    let l = 0;
    let m = 0;
    let h = 0;
    for (let i = a; i < b; i++) {
      l = Math.max(l, low[i]);
      m = Math.max(m, mid[i]);
      h = Math.max(h, high[i]);
    }
    out.push([l, m, h]);
  }
  return out;
}
