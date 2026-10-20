// Frame-exact video capture: node scripts/record.mjs [from] [to] [out.mp4]
// Drives the page clock one frame at a time, so the result is smooth and in
// sync no matter how slowly the browser renders. Needs ffmpeg and a running
// dev server (npm run dev).
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const from = parseFloat(process.argv[2] ?? '70');
const to = parseFloat(process.argv[3] ?? '88.5');
const out = process.argv[4] ?? 'docs/breakdown-to-drop.mp4';
const url = process.env.URL || 'http://localhost:5173/';
const FPS = 60;
const WARMUP = 2.5; // seconds rendered before `from` so the smoothing settles

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME ||
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
// 1440×810 CSS px at 4/3 scale → 1920×1080 frames
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 60000 });
await page.click('#start');
await page.waitForTimeout(1200); // let the veil fade out
await page.evaluate(() => window.__auris.offline());

const dir = mkdtempSync(join(tmpdir(), 'auris-frames-'));
const dt = 1 / FPS;
let clock = 1000;
for (let t = from - WARMUP; t < from; t += dt) {
  await page.evaluate(([t, dt, c]) => window.__auris.renderAt(t, dt, c), [t, dt, (clock += dt)]);
}
const total = Math.round((to - from) * FPS);
for (let i = 0; i < total; i++) {
  const t = from + i * dt;
  await page.evaluate(([t, dt, c]) => window.__auris.renderAt(t, dt, c), [t, dt, (clock += dt)]);
  await page.screenshot({ path: join(dir, `f${String(i).padStart(5, '0')}.png`) });
  if (i % 60 === 0) process.stdout.write(`\r${i}/${total} frames`);
}
console.log(`\r${total}/${total} frames`);

const wav = join(dir, 'audio.wav');
writeFileSync(wav, Buffer.from(await page.evaluate(([a, b]) => window.__auris.wav(a, b), [from, to]), 'base64'));
await browser.close();

const len = (to - from).toFixed(3);
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(dir, 'f%05d.png'),
  '-i', wav,
  '-vf', `fade=t=in:st=0:d=0.4,fade=t=out:st=${(to - from - 0.6).toFixed(3)}:d=0.6,format=yuv420p`,
  '-af', `afade=t=in:st=0:d=0.3,afade=t=out:st=${(to - from - 0.6).toFixed(3)}:d=0.6`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high',
  '-c:a', 'aac', '-b:a', '192k',
  '-t', len, '-movflags', '+faststart',
  out,
], { stdio: 'inherit' });
rmSync(dir, { recursive: true, force: true });
console.log(`wrote ${out}`);
