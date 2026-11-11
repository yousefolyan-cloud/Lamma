// Captures the same four screens for one theme build: node tests/e2e/themes.mjs <name>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const name = process.argv[2], BASE = 'http://localhost:8099', PASS = process.env.DEV_PASSWORD ?? 'lamma-dev', OUT = process.argv[3];
const browser = await chromium.launch();
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-JO' });
  const page = await ctx.newPage(); await page.goto(BASE); await page.getByLabel('البريد الإلكتروني').waitFor();
  if (email) { await page.getByLabel('البريد الإلكتروني').fill(email); await page.getByLabel('كلمة المرور').fill(PASS); await page.getByRole('button', { name: 'تسجيل الدخول' }).click(); await page.getByRole('tablist').waitFor(); }
  await page.waitForTimeout(1200); return page;
}
const shots = [['1-sign-in', null], ['2-driver', 'driver1@demo.lamma.test'], ['3-institution', 'owner1@demo.lamma.test'], ['4-admin', 'admin@demo.lamma.test']];
for (const [n, email] of shots) { const p = await open(email); await p.screenshot({ path: `${OUT}/${name}-${n}.png` }); console.log('shot', name, n); }
await browser.close();
