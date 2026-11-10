// End-to-end run of the real app (web build) against the real SQL through the local dev gateway.
// One browser context per person = one phone per person. Captures real screenshots into docs/screenshots.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // uses the globally installed Playwright
const BASE = 'http://localhost:8099', PASS = process.env.DEV_PASSWORD ?? 'lamma-dev', OUT = 'docs/screenshots';
const browser = await chromium.launch();
const people = {};
async function person(email) {
  if (people[email]) return people[email];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-JO' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', email, e.message); process.exitCode = 1; });
  await page.goto(BASE);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASS);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('tablist').waitFor();
  return (people[email] = page);
}
const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
const click = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });

// sign-in screen
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage(); await p.goto(BASE); await p.getByLabel('البريد الإلكتروني').waitFor(); await shot(p, '01-sign-in'); await ctx.close(); }

const driver = await person('driver1@demo.lamma.test');
await see(driver, 'LM-'); await shot(driver, '02-driver-available-routes');
await click(driver, 'التقديم على المسار');
await see(driver, 'مؤهل بانتظار الإسناد'); await shot(driver, '03-driver-applied');

const admin = await person('admin@demo.lamma.test');
await see(admin, 'لوحة التشغيل'); await shot(admin, '04-admin-operations');
await click(admin, 'إسناد الآن');
await see(admin, 'مسند');
await admin.getByRole('tab', { name: /الاعتمادات/ }).click(); await see(admin, 'طلبات الاعتماد'); await shot(admin, '05-admin-approvals');

await driver.getByRole('tab', { name: /جولتي/ }).click();
await click(driver, 'جولتي');
await click(driver, 'ابدأ المسار');

const stops = [
  { owner: 'owner4@demo.lamma.test', weights: [['22.9', '0.4'], ['12.35', '0.35']] },
  { owner: 'owner5@demo.lamma.test', weights: [['18.6', '0.4']] },
  { owner: 'owner1@demo.lamma.test', weights: [['14.25', '0.25']] },
];
for (const [i, s] of stops.entries()) {
  await driver.getByRole('button', { name: 'وصلت إلى الموقع', exact: true }).waitFor();
  if (i === 0) await shot(driver, '06-driver-stop');
  await click(driver, 'وصلت إلى الموقع');
  await see(driver, 'تسجيل الوزن');
  for (const [j, [gross, tare]] of s.weights.entries()) {
    await driver.getByLabel('الوزن الإجمالي (كغ)').nth(j).fill(gross);
    await driver.getByLabel('وزن الفارغ (كغ)').nth(j).fill(tare);
  }
  if (i === 0) await shot(driver, '07-driver-weighing');
  await click(driver, 'حفظ الوزن وإرساله للتوقيع');
  await see(driver, 'بانتظار توقيع صاحب المنشأة');
  if (i === 0) await shot(driver, '08-driver-waiting-signature');
  const owner = await person(s.owner);
  await see(owner, 'أوزان بانتظار توقيعك');
  if (i === 0) await shot(owner, '09-institution-home-pending-signature');
  await click(owner, 'مراجعة الوزن والتوقيع');
  await see(owner, 'أؤكد بصفتي');
  if (i === 0) await shot(owner, '10-institution-sign');
  await click(owner, 'أؤكد وأوقّع');
  await see(owner, 'تم التوقيع');
  await driver.getByRole('button', { name: 'إتمام التوقف والانتقال للتالي', exact: true }).waitFor({ timeout: 15000 });
  if (i === 0) await shot(driver, '11-driver-signed');
  await click(driver, 'إتمام التوقف والانتقال للتالي');
}
await see(driver, 'توجّه إلى محطة الفرز'); await shot(driver, '12-driver-to-station');

const station = await person('station@demo.lamma.test');
await see(station, 'شحنة في الطريق'); await shot(station, '13-station-shipment-on-the-way');
await click(driver, 'وصلت إلى المحطة');
await see(driver, 'بانتظار تأكيد المحطة'); await shot(driver, '14-driver-awaiting-station');
// the driver has no control that completes the route
if (await driver.getByRole('button', { name: /تأكيد الاستلام|إنهاء/ }).count()) throw new Error('driver must not be able to complete the route');

await click(station, 'استلام ووزن');
await station.getByLabel('صافي وزن المحطة (كغ)').first().waitFor();
const labels = await station.getByRole('heading').allInnerTexts().catch(() => []);
const cards = station.getByLabel('صافي وزن المحطة (كغ)');
// signed totals: PET 40.700, ALU 26.000 — fill each card with its own signed figure read from the screen
for (let k = 0; k < await cards.count(); k++) {
  const card = cards.nth(k).locator('xpath=ancestor::div[.//*[contains(text(),"موقّع ميدانياً")]][1]');
  const signed = (await card.innerText()).match(/(\d+\.\d{3})/)[1];
  await cards.nth(k).fill(signed);
}
await shot(station, '15-station-compare');
await click(station, 'تأكيد الاستلام');
await see(station, 'تم تأكيد الاستلام واكتمل المسار'); await shot(station, '16-station-confirmed');
await see(driver, 'اكتمل المسار'); await shot(driver, '17-driver-completed');

const owner = await person('owner4@demo.lamma.test');
await click(owner, 'رجوع');
await owner.getByRole('tab', { name: /سجل الجمع/ }).click(); await see(owner, 'LM-'); await shot(owner, '18-institution-history');
await admin.getByRole('tab', { name: /التشغيل/ }).click(); await see(admin, 'مكتمل'); await shot(admin, '19-admin-after-completion');
// language switch (English, LTR)
await driver.getByRole('button', { name: 'رجوع' }).first().click();
await driver.getByRole('tab', { name: /الحساب/ }).click(); await driver.getByRole('radio', { name: /English/ }).click();
await driver.getByRole('tab', { name: /My round/ }).click(); await see(driver, 'Past rounds'); await shot(driver, '20-driver-english');
await browser.close();
console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK');
