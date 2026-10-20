// Visual check: node scripts/shoot.mjs [url] [tag]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const tag = process.argv[3] || 'r1';
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  headless: true,
  executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});

async function run(viewport, name, moments) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/${tag}-${name}-veil.png` });
  const a = await page.evaluate(() => {
    const x = window.__auris.analysis;
    return { bpm: x.bpm, offset: x.offset, drop: x.drop, breakdown: x.breakdown, build: x.build, sections: x.sections, kicks: x.kicks.length };
  });
  console.log(name, JSON.stringify(a));
  await page.click('#start');
  for (const [label, t, wait] of moments) {
    await page.evaluate((t) => window.__auris.seek(t), t);
    await page.waitForTimeout(wait ?? 900);
    await page.screenshot({ path: `shots/${tag}-${name}-${label}.png` });
  }
  if (logs.length) console.log(logs.join('\n'));
  await page.close();
}

const moments = [
  ['intro', 6],
  ['groove', 30],
  ['breakdown', 66],
  ['build', 79],
  ['drop', 82.4, 900],
  ['drop2', 95],
];
await run({ width: 1440, height: 900 }, 'desk', moments);
await run({ width: 390, height: 844 }, 'phone', [moments[4]]);
await browser.close();
