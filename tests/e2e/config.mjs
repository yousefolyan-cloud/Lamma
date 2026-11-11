// Walks the configuration screens in a real browser: node tests/e2e/config.mjs <outdir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = 'http://localhost:8099', PASS = process.env.DEV_PASSWORD ?? 'lamma-dev', OUT = process.argv[2] ?? 'docs/screenshots';
const browser = await chromium.launch();
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-JO' });
  const page = await ctx.newPage(); await page.goto(BASE);
  await page.getByLabel('البريد الإلكتروني').fill(email); await page.getByLabel('كلمة المرور').fill(PASS);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click(); await page.getByRole('tablist').waitFor();
  return page;
}
const click = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
const pick = (page, name) => page.getByRole('radio', { name }).first().click();
const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
const shot = async (page, n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const code = 'E2E-' + Date.now().toString().slice(-6);

// Lamma operations: add an area, then set its pay policy and a threshold
const admin = await open('admin@demo.lamma.test');
await admin.getByRole('tab', { name: /الإعدادات/ }).click(); await see(admin, 'لا توجد أرقام افتراضية'); await shot(admin, '21-admin-settings-areas');
await click(admin, 'إضافة منطقة');
await admin.getByLabel('الرمز').fill(code); await admin.getByLabel('الاسم بالعربية').fill('منطقة اختبار ' + code);
await admin.getByLabel('الاسم بالإنجليزية').fill('Test zone ' + code); await admin.getByLabel('المدينة').fill('عمّان');
await click(admin, 'حفظ'); await see(admin, 'منطقة اختبار ' + code);
await pick(admin, 'المواد'); await see(admin, 'الكثافة'); await shot(admin, '22-admin-settings-materials');
await pick(admin, 'الحدود والأجور'); await pick(admin, 'منطقة اختبار ' + code);
await see(admin, 'لن تُنشر مسارات في هذه المنطقة');
await admin.getByLabel('الأجر الأساسي للمسار (د.أ)').fill('1.5'); await admin.getByLabel('مدة التقديم (دقيقة)').fill('30');
await click(admin, 'حفظ السياسة'); await see(admin, 'تم الحفظ');
await admin.getByText('لن تُنشر مسارات في هذه المنطقة').waitFor({ state: 'detached', timeout: 15000 });
await admin.getByLabel('الحد الأدنى (كغ)').first().fill('12.5'); await click(admin, 'حفظ'); await see(admin, '12.500');
await shot(admin, '23-admin-settings-rules');
await pick(admin, 'وثائق السائق'); await see(admin, 'نوع الوثيقة'); await shot(admin, '24-admin-settings-documents');

// station: change a price → new version shown as current
const station = await open('station@demo.lamma.test');
await station.getByRole('tab', { name: /المواد والأسعار/ }).click(); await see(station, 'السعر الحالي للكيلو');
await station.getByLabel('سعر جديد للكيلو (د.أ)').first().fill('0.321'); await click(station, 'حفظ السعر'); await see(station, '0.321');
await shot(station, '25-station-prices');

// driver: add a vehicle → pending review
const driver = await open('driver1@demo.lamma.test');
await driver.getByRole('tab', { name: /مركبتي/ }).click(); await see(driver, 'مركباتي');
await click(driver, 'إضافة مركبة');
await driver.getByLabel('نوع المركبة').fill('بيك أب'); await driver.getByLabel('رقم اللوحة').fill(code);
await driver.getByLabel('الحمولة (كغ)').fill('750'); await driver.getByLabel('الحجم (لتر)').fill('2500');
await click(driver, 'حفظ'); await see(driver, code); await see(driver, 'قيد المراجعة');
await shot(driver, '26-driver-equipment');
// driver: add a document with a photo → the admin can open exactly that file
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
await click(driver, 'إضافة وثيقة');
await driver.getByLabel('نوع الوثيقة').fill('doc-' + code);
const chooser = driver.waitForEvent('filechooser'); await click(driver, 'إرفاق صورة');
await (await chooser).setFiles({ name: 'licence.png', mimeType: 'image/png', buffer: png });
await see(driver, 'تم اختيار الصورة'); await click(driver, 'حفظ'); await see(driver, 'doc-' + code); await see(driver, 'عرض الصورة المرفقة');
await shot(driver, '27-driver-document-photo');
await admin.getByRole('tab', { name: /الاعتمادات/ }).click(); await see(admin, 'doc-' + code);
const popup = admin.waitForEvent('popup'); await admin.getByRole('button', { name: 'عرض الصورة المرفقة' }).last().click();
const opened = await popup; await opened.waitForLoadState();
if (!/\/storage\/v1\/object\/sign\/evidence\/driver\//.test(opened.url())) throw new Error('unexpected file url ' + opened.url());
await admin.getByRole('button', { name: 'عرض الصورة المرفقة' }).last().scrollIntoViewIfNeeded(); await shot(admin, '28-admin-review-document-photo');
await browser.close();
console.log('CONFIG E2E OK');
