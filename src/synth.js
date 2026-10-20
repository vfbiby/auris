// Procedurally renders the demo track "Iris Protocol" — 128 BPM, 64 bars.
// Structure (bars): intro 0–8, groove 8–24, lift 24–32, breakdown 32–40,
// build 40–44, drop 44–60, outro 60–64. The analyzer never reads this map;
// it has to find tempo, breakdown and drop from the audio itself.

export const DEMO_TITLE = 'Iris Protocol';
const BPM = 128;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 64;

const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

const SEG = 4; // bars per offline render; keeps each audio graph small
const TAIL = 3; // seconds of release/reverb carried into the next segment

export async function renderDemoTrack(sampleRate = 44100) {
  const jobs = [];
  for (let a = 0; a < BARS; a += SEG) jobs.push(renderSegment(a, a + SEG, sampleRate));
  const parts = await Promise.all(jobs);
  const length = Math.ceil((BARS * BAR + TAIL) * sampleRate);
  const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  parts.forEach((part, i) => {
    const at = Math.round(i * SEG * BAR * sampleRate);
    for (let c = 0; c < 2; c++) {
      const dst = out.getChannelData(c);
      const src = part.getChannelData(c);
      const n = Math.min(src.length, length - at);
      for (let k = 0; k < n; k++) dst[at + k] += src[k];
    }
  });
  return out;
}

async function renderSegment(barA, barB, sampleRate) {
  const off = barA * BAR;
  const length = Math.ceil(((barB - barA) * BAR + TAIL) * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(comp).connect(ctx.destination);

  const noise = ctx.createBuffer(1, sampleRate * 2, sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const noiseSrc = (t, dur) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  };

  // A shared send for a cheap stereo "room".
  const verb = ctx.createConvolver();
  const ir = ctx.createBuffer(2, sampleRate * 2.4, sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
  }
  verb.buffer = ir;
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.22;
  verb.connect(verbGain).connect(master);

  const kick = (t, amp = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0 * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.5);
    const c = noiseSrc(t, 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.25 * amp, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    c.connect(hp).connect(cg).connect(master);
  };

  const hat = (t, amp = 0.18, open = false) => {
    const s = noiseSrc(t, open ? 0.3 : 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 7000 : 9000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.28 : 0.05));
    const p = ctx.createStereoPanner();
    p.pan.value = open ? -0.2 : 0.25;
    s.connect(hp).connect(g).connect(p).connect(master);
  };

  const clap = (t, amp = 0.5) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    [0, 0.011, 0.022].forEach((o) => {
      g.gain.setValueAtTime(amp, t + o);
      g.gain.exponentialRampToValueAtTime(amp * 0.2, t + o + 0.009);
    });
    g.gain.setValueAtTime(amp * 0.7, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    noiseSrc(t, 0.25).connect(bp).connect(g);
    g.connect(master);
    g.connect(verb);
  };

  const bass = (t, midi, dur, cutoff, amp = 0.42) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(cutoff * 2.2, t);
    f.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    [0, 7].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
    const sub = ctx.createOscillator();
    sub.frequency.value = NOTE(midi - 12);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(amp * 0.9, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg).connect(master);
    sub.start(t);
    sub.stop(t + dur + 0.02);
    f.connect(g).connect(master);
  };

  const pad = (t, notes, dur, cutA, cutB, amp = 0.07) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(cutA, t);
    f.frequency.linearRampToValueAtTime(cutB, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + dur * 0.35);
    g.gain.setValueAtTime(amp, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    notes.forEach((m, i) => {
      [-11, 0, 11].forEach((det, j) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(m);
        o.detune.value = det + i;
        const p = ctx.createStereoPanner();
        p.pan.value = (j - 1) * 0.6;
        o.connect(p).connect(f);
        o.start(t);
        o.stop(t + dur + 0.4);
      });
    });
    f.connect(g);
    g.connect(master);
    g.connect(verb);
  };

  const pluck = (t, midi, amp = 0.09, bright = 3200) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = NOTE(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(bright, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.sin((t + off) * 3.1) * 0.5;
    o.connect(f).connect(g).connect(p);
    p.connect(master);
    p.connect(verb);
    o.start(t);
    o.stop(t + 0.25);
  };

  const snare = (t, amp) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    noiseSrc(t, 0.1).connect(bp).connect(g).connect(master);
  };

  // A minor: Am – F – C – G
  const chords = [
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [55, 60, 64, 67],
    [55, 59, 62, 67],
  ];
  const roots = [45, 41, 48, 43];
  const arp = [0, 2, 1, 3, 2, 1, 3, 0];

  for (let bar = barA; bar < barB; bar++) {
    const t0 = bar * BAR - off;
    const ci = Math.floor(bar / 2) % 4;
    const inBreak = bar >= 32 && bar < 44;
    const inDrop = bar >= 44 && bar < 60;
    const hasBass = (bar >= 8 && bar < 32) || inDrop;
    const outroFade = bar >= 60 ? 1 - (bar - 60) / 4 : 1;

    for (let b = 0; b < 4; b++) {
      const t = t0 + b * BEAT;
      if (!inBreak) kick(t, (inDrop ? 1 : 0.92) * outroFade);
      if (bar >= 8 && !inBreak && bar < 60 && (b === 1 || b === 3)) clap(t, inDrop ? 0.55 : 0.45);
      if (!inBreak || bar >= 40) {
        hat(t + BEAT / 2, (bar < 8 ? 0.12 : 0.18) * outroFade, bar >= 16 && !inBreak && bar < 60);
      }
      if (bar >= 16 && !inBreak && bar < 60) {
        hat(t + BEAT / 4, 0.07);
        hat(t + (BEAT * 3) / 4, 0.07);
      }
      if (hasBass) {
        const cutoff = inDrop ? 900 : bar < 16 ? 380 : 560;
        bass(t + BEAT / 2, roots[ci] + (b === 3 && bar % 2 ? 12 : 0), BEAT * 0.42, cutoff, inDrop ? 0.5 : 0.4);
      }
    }

    if ((bar >= 24 && bar < 32) || inDrop) {
      for (let s = 0; s < 16; s++) {
        const n = chords[ci][arp[s % 8]] + (s >= 8 && inDrop ? 12 : 0);
        pluck(t0 + s * (BEAT / 4), n + 12, inDrop ? 0.085 : 0.06, inDrop ? 4800 : 2600);
      }
    }

    if (bar % 2 === 0 && (inBreak || inDrop || (bar >= 24 && bar < 32))) {
      const open = inBreak ? 800 + (bar - 32) * 260 : 2400;
      pad(t0, chords[ci], BAR * 2, open, open * 1.6, inBreak ? 0.085 : 0.05);
    }
    if (inBreak && bar < 40 && bar % 2 === 0) {
      pluck(t0, chords[ci][3] + 12, 0.07, 1400);
      pluck(t0 + BEAT * 1.5, chords[ci][2] + 12, 0.05, 1200);
    }
  }

  // Build: snare roll accelerating + noise riser over bars 40–44
  const b0 = 40 * BAR - off;
  const bEnd = 44 * BAR - off;
  if (barA === 40) {
    for (let bar = 40; bar < 44; bar++) {
      const div = bar < 42 ? 4 : bar < 43 ? 8 : 16;
      for (let s = 0; s < div; s++) {
        const t = bar * BAR - off + (s * BAR) / div;
        snare(t, 0.08 + 0.32 * ((t - b0) / (bEnd - b0)));
      }
    }
  }
  if (barA === 40) {
    const s = noiseSrc(b0, bEnd - b0);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, b0);
    bp.frequency.exponentialRampToValueAtTime(9000, bEnd);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, b0);
    g.gain.exponentialRampToValueAtTime(0.35, bEnd - 0.05);
    g.gain.linearRampToValueAtTime(0, bEnd);
    s.connect(bp).connect(g).connect(master);
  }
  // Crash at the drop
  if (barA === 44) {
    const t = bEnd;
    const s = noiseSrc(t, 2.5);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    s.connect(hp).connect(g);
    g.connect(master);
    g.connect(verb);
  }

  return ctx.startRendering();
}
