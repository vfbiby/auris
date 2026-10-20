import { createEye } from './eye.js';
import { analyzeTrack, FPS } from './analyze.js';
import { renderDemoTrack, DEMO_TITLE } from './synth.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fmt = (s) => {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const params = new URLSearchParams(location.search);
const eye = createEye($('stage'));
const panelEl = $('panel');

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  eye.resize(w, h, w > 820 ? panelEl.offsetWidth : 0);
}
window.addEventListener('resize', layout);
layout();

// ── Sliders ───────────────────────────────────────────────────────────
const SIGNAL = [
  ['kick', 'Kick'],
  ['bass', 'Bass'],
  ['mid', 'Mids'],
  ['high', 'Highs'],
];
const MECH = [
  ['plates', 'Plates'],
  ['iris', 'Iris'],
  ['lens', 'Lens'],
  ['core', 'Core'],
  ['orbit', 'Orbit'],
];
const controls = {};
function buildSliders(list, host) {
  for (const [key, name] of list) {
    const row = document.createElement('label');
    row.className = 'ctl';
    row.innerHTML = `<span class="ctl-name">${name}</span><input type="range" min="0" max="1000" value="0"><span class="ctl-val">0.00</span>`;
    const input = row.querySelector('input');
    const val = row.querySelector('.ctl-val');
    const c = { row, input, val, held: false, manual: 0, shown: -1 };
    const release = () => {
      c.held = false;
      row.classList.remove('held');
    };
    input.addEventListener('pointerdown', () => {
      c.held = true;
      row.classList.add('held');
    });
    input.addEventListener('pointerup', release);
    input.addEventListener('pointercancel', release);
    input.addEventListener('blur', release);
    input.addEventListener('input', () => {
      c.manual = input.value / 1000;
    });
    host.appendChild(row);
    controls[key] = c;
  }
}
buildSliders(SIGNAL, $('signalSliders'));
buildSliders(MECH, $('mechSliders'));

function show(key, v) {
  const c = controls[key];
  if (c.held) return c.manual;
  const q = Math.round(v * 1000);
  if (q !== c.shown) {
    c.shown = q;
    c.input.value = q;
    c.input.style.setProperty('--v', `${q / 10}%`);
    c.val.textContent = (q / 1000).toFixed(2);
    c.row.classList.toggle('hot', v > 0.8);
  }
  return v;
}
// keep the filled track in sync while a slider is being dragged
for (const c of Object.values(controls)) {
  c.input.addEventListener('input', () => {
    c.input.style.setProperty('--v', `${c.input.value / 10}%`);
    c.val.textContent = (c.input.value / 1000).toFixed(2);
  });
}

// ── Audio ─────────────────────────────────────────────────────────────
let ctx = null;
let track = null; // { buffer, analysis, title }
let source = null;
let startedAt = 0;
let pausedAt = 0;
let playing = false;

function ensureCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function position() {
  if (!track) return 0;
  if (!playing) return pausedAt;
  return Math.min(track.buffer.duration, ctx.currentTime - startedAt);
}

function play(from = pausedAt) {
  if (!track) return;
  ensureCtx();
  ctx.resume();
  stopSource();
  source = ctx.createBufferSource();
  source.buffer = track.buffer;
  source.connect(ctx.destination);
  source.start(0, from);
  startedAt = ctx.currentTime - from;
  playing = true;
  source.onended = () => {
    if (source && ctx.currentTime - startedAt >= track.buffer.duration - 0.05) {
      playing = false;
      pausedAt = 0;
      document.body.classList.remove('playing');
    }
  };
  document.body.classList.add('playing');
}
function stopSource() {
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {}
    source.disconnect();
    source = null;
  }
}
function pause() {
  pausedAt = position();
  stopSource();
  playing = false;
  document.body.classList.remove('playing');
}
function seek(t) {
  t = Math.max(0, Math.min(track.buffer.duration - 0.1, t));
  director.lastT = t;
  if (playing) play(t);
  else pausedAt = t;
}

$('play').addEventListener('click', () => (playing ? pause() : play()));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && track && $('veil').classList.contains('gone')) {
    e.preventDefault();
    playing ? pause() : play();
  }
});

// ── Loading & listening ──────────────────────────────────────────────
const logEl = $('log');
function log(html, cls = '') {
  const li = document.createElement('li');
  li.innerHTML = html;
  if (cls) li.className = cls;
  logEl.appendChild(li);
  return li;
}

async function listen(buffer, title) {
  logEl.innerHTML = '';
  $('start').disabled = true;
  $('play').disabled = true;
  const t0 = performance.now();
  let current = log(`Decoding <b>${title}</b>`);
  const analysis = await analyzeTrack(buffer, (step) => {
    current = log(step);
  });
  current.remove();
  const ms = Math.round(performance.now() - t0);
  log(`Tempo locked at <b>${analysis.bpm.toFixed(1)} BPM</b>, ${analysis.kicks.length} kicks`);
  if (analysis.breakdown) {
    log(`Breakdown found at <b>${fmt(analysis.breakdown.start)}</b>${analysis.build ? `, build from <b>${fmt(analysis.build)}</b>` : ''}`);
    log(`Drop lands at <b>${fmt(analysis.drop)}</b>`, 'found');
  } else {
    log(`No breakdown found; it will stay open`);
  }
  log(`Listened in <b>${(ms / 1000).toFixed(1)} s</b>`);
  track = { buffer, analysis, title };
  pausedAt = 0;
  director.reset();
  paintTimeline();
  $('trackTitle').textContent = title;
  $('tDur').textContent = fmt(buffer.duration);
  $('bpm').textContent = analysis.bpm.toFixed(1);
  $('dropAt').textContent = fmt(analysis.drop);
  $('start').disabled = false;
  $('play').disabled = false;
}

$('start').addEventListener('click', () => {
  $('veil').classList.add('gone');
  const t = parseFloat(params.get('t'));
  play(isFinite(t) ? t : 0);
});

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  pause();
  $('veil').classList.remove('gone');
  const buf = await ensureCtx().decodeAudioData(await f.arrayBuffer());
  await listen(buf, f.name.replace(/\.[^.]+$/, ''));
});

(async () => {
  log('Composing <b>' + DEMO_TITLE + '</b>');
  const buffer = await renderDemoTrack();
  await listen(buffer, DEMO_TITLE);
})();

// ── Timeline ─────────────────────────────────────────────────────────
function paintTimeline() {
  const cv = $('tlCanvas');
  const dpr = Math.min(2, window.devicePixelRatio);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const ov = track.analysis.overview;
  const bw = w / ov.length;
  const css = getComputedStyle(document.documentElement);
  for (let i = 0; i < ov.length; i++) {
    const [l, m, hi] = ov[i];
    const x = i * bw;
    g.fillStyle = css.getPropertyValue('--bone-3');
    const lh = Math.max(1, l * h * 0.95);
    g.fillRect(x, h - lh, Math.max(1, bw - 0.6), lh);
    g.fillStyle = 'rgba(255,174,74,0.55)';
    const hh = Math.max(0.5, hi * h * 0.45);
    g.fillRect(x, h - hh, Math.max(1, bw - 0.6), 1);
  }
  const host = $('tlSections');
  const legend = $('tlLegend');
  host.innerHTML = '';
  legend.innerHTML = '';
  const dur = track.buffer.duration;
  for (const s of track.analysis.sections) {
    const d = document.createElement('div');
    d.dataset.s = s.name;
    d.style.left = `${(s.start / dur) * 100}%`;
    d.style.width = `${((s.end - s.start) / dur) * 100}%`;
    d.title = `${s.name} · ${fmt(s.start)}`;
    host.appendChild(d);
    const li = document.createElement('li');
    li.dataset.s = s.name;
    li.innerHTML = `<i></i><span>${s.name}</span><time>${fmt(s.start)}</time>`;
    li.addEventListener('click', () => seek(s.start + 0.01));
    legend.appendChild(li);
  }
}
window.addEventListener('resize', () => track && paintTimeline());
$('timeline').addEventListener('click', (e) => {
  if (!track) return;
  const r = e.currentTarget.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * track.buffer.duration);
});

// ── Director: music → mechanism ──────────────────────────────────────
const MOOD = { Intro: 0.32, Groove: 0.62, Breakdown: 0, Build: 0.08, Drop: 1, Outro: 0.28, Standby: 0.18 };
const director = {
  mood: MOOD.Standby,
  flash: 0,
  bass: 0,
  energy: 0,
  lastT: 0,
  reset() {
    this.mood = MOOD.Standby;
    this.flash = 0;
    this.lastT = 0;
  },
  step(t, dt, time) {
    const a = track?.analysis;
    let s = { name: 'Standby', start: 0, end: 1 };
    let f = { kick: 0, low: 0, mid: 0, high: 0 };
    if (a) {
      s = a.sections.find((x) => t >= x.start && t < x.end) || a.sections[a.sections.length - 1];
      const i = Math.min(a.low.length - 1, Math.floor(t * FPS));
      f = { kick: a.kick[i], low: a.low[i], mid: a.mid[i], high: a.high[i] };
      if (!playing && t === pausedAt) f = { kick: 0, low: f.low * 0.2, mid: f.mid * 0.2, high: f.high * 0.2 };
      if (a.drop != null && this.lastT < a.drop && t >= a.drop && t - a.drop < 0.5) {
        this.flash = 1;
        this.mood = 1;
      }
    }
    this.lastT = t;
    const progress = clamp01((t - s.start) / (s.end - s.start));

    const kick = show('kick', f.kick);
    const rawBass = show('bass', f.low);
    const mid = show('mid', f.mid);
    const high = show('high', f.high);

    // bass: quick attack, slower release
    const kb = rawBass > this.bass ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.18);
    this.bass += (rawBass - this.bass) * kb;
    this.energy += ((rawBass + mid + high) / 3 - this.energy) * (1 - Math.exp(-dt / 0.4));

    let target = MOOD[s.name] ?? 0.6;
    if (s.name === 'Build') target = 0.04 + progress * 0.16;
    const closing = target < this.mood;
    const tc = closing ? (s.name === 'Breakdown' ? 1.1 : 0.6) : 0.35;
    this.mood += (target - this.mood) * (1 - Math.exp(-dt / tc));
    this.flash *= Math.exp(-dt / 0.75);
    const mood = this.mood;
    const think = 1 - mood;
    const build = s.name === 'Build' ? progress : 0;

    const p = {
      mood,
      flash: this.flash,
      tremble: build * build + this.flash * 0.4,
      plates: show('plates', clamp01(mood * 0.16 + kick * (0.22 + 0.78 * mood) * (1 + this.flash * 0.4) + build * 0.05)),
      iris: show('iris', clamp01(0.05 + mood * 0.55 + mood * this.bass * 0.4)),
      lens: show('lens', clamp01(this.bass * (0.35 + 0.65 * mood) * 1.1)),
      core: show(
        'core',
        clamp01(
          (0.08 + high * 0.8 + mid * 0.12) * (0.3 + 0.7 * mood) +
            think * 0.1 * (0.5 + 0.5 * Math.sin(time * 1.7)) +
            build * 0.45 +
            this.flash * 0.3
        )
      ),
      orbit: show('orbit', clamp01(0.08 + this.energy * (0.3 + 0.9 * mood))),
      gaze: clamp01(mood * 0.6 + kick * 0.4),
    };
    return { p, section: s };
  },
};

// ── Frame loop ───────────────────────────────────────────────────────
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let shownSection = '';
const pips = [...document.querySelectorAll('#beatPips i')];
// Offline mode: a script drives the clock frame by frame (video capture).
let offline = false;
function frame(now) {
  if (offline) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  render(position(), dt, now / 1000);
  requestAnimationFrame(frame);
}
function render(t, dt, time) {
  const { p, section } = director.step(t, dt, time);
  eye.update(p, dt, time);

  if (section.name !== shownSection) {
    shownSection = section.name;
    $('sectionName').textContent = section.name;
    $('sectionName').dataset.s = section.name;
    document
      .querySelectorAll('#tlSections div, #tlLegend li')
      .forEach((d) => d.classList.toggle('on', d.dataset.s === section.name));
  }
  if (track) {
    const a = track.analysis;
    const beatSec = 60 / a.bpm;
    const beat = Math.max(0, Math.floor((t - a.barOffset) / beatSec + 0.02));
    $('bar').textContent = `${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`;
    pips.forEach((el, i) => el.classList.toggle('on', i === beat % 4 && (playing || t > 0)));
    $('tNow').textContent = fmt(t);
    $('tlHead').style.left = `${(t / track.buffer.duration) * 100}%`;
  }
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    $('frameRate').textContent = `${Math.round(fpsN / fpsAcc)} fps`;
    fpsAcc = 0;
    fpsN = 0;
  }
}
requestAnimationFrame(frame);

window.__auris = {
  seek: (t) => seek(t),
  play: () => play(),
  pause,
  get analysis() {
    return track?.analysis;
  },
  get t() {
    return position();
  },
  // Stop the live loop; afterwards each renderAt() call draws one frame.
  offline() {
    pause();
    pausedAt = -1;
    offline = true;
    document.body.classList.add('playing'); // look live on camera
    $('frameRate').textContent = '60 fps';
  },
  renderAt(t, dt, time) {
    render(t, dt, time);
  },
  // 16-bit stereo WAV of [t0, t1) from the current track, base64-encoded.
  wav(t0, t1) {
    const b = track.buffer;
    const a = Math.floor(t0 * b.sampleRate);
    const n = Math.floor((t1 - t0) * b.sampleRate);
    const chans = [b.getChannelData(0), b.getChannelData(Math.min(1, b.numberOfChannels - 1))];
    const view = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, 36 + n * 4, true);
    str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, b.sampleRate, true);
    view.setUint32(28, b.sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        const v = Math.max(-1, Math.min(1, chans[c][a + i] || 0));
        view.setInt16(44 + i * 4 + c * 2, v * 32767, true);
      }
    }
    let bin = '';
    const bytes = new Uint8Array(view.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};
