// node --test tests/auth-races.test.mjs
// سباقات المصادقة: كل سيناريو حتمي (التحكم في توقيت اكتمال كل عملية Firebase يدويًا) ويفحص الحالة النهائية: الجلسة الفعلية، الشاشة/الدور،
// الدور المختار المتبقي، ورسالة المستخدم. Firebase محاكى (tests/boot/sdk.mjs) بترتيب أحداث يطابق معرفتي بالـ SDK؛ مش اختبار على Firebase الحقيقي.
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { A, S, sleep, fresh, finishPopup, failPopup } from './boot/env.mjs';
import { activeScreens, el, fire, screenLog } from './boot/dom.mjs';

const CUST = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const DRV = { role: 'driver', status: 'active', fullName: 'Drv', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } };
const X = { uid: 'uX', email: 'x@x.com' }, Y = { uid: 'uY', email: 'y@x.com' };
const choose = (r) => { fire('home-start'); const c = [...document.querySelectorAll('.rp-card')].find((x) => x.attrs.onclick.includes(`'${r}'`)); new Function(c.attrs.onclick)(); };
const screen = () => activeScreens().join(',');
const DASH = ['screen-customer', 'screen-driver', 'screen-merchant', 'screen-admin'];
const ever = (...ids) => ids.some((i) => screenLog.includes(i));
const googleClick = async () => { fire('lg-google'); await sleep(10); };
beforeEach(async () => { await fresh(); S.users.uX = CUST; S.users.uY = DRV; window.AUTH_OP_TIMEOUT_MS = 80; });

test('R1. A تنتهي مهلتها، ثم تبدأ B، ثم تكتمل A متأخرة: جلسة A تُتجاهل بدون لمس B، وB تكتمل بدورها (كابتن)', async () => {
  S.holdPopups = true; choose('customer'); await googleClick(); await sleep(130);               // A (customer) انتهت مهلتها
  assert.equal(el('lg-google').disabled, false); choose('driver'); await googleClick();            // B (driver) بدأت
  assert.equal(S.held.length, 2); assert.equal(el('lg-google').disabled, true);
  await finishPopup(0, X);                                                                          // A تكتمل متأخرة بحساب عميل
  assert.equal(ever(...DASH), false, 'جلسة A لا تُوجَّه: ' + screenLog.join('>')); assert.equal(S.signOuts, 1); assert.equal(S.current, null);
  assert.equal(el('lg-google').disabled, true, 'واجهة B ما زالت مشغولة'); assert.equal(A.peekEntryType(), 'driver', 'دور B محفوظ');
  await finishPopup(1, Y);                                                                          // B تكتمل: حساب كابتن نشط
  assert.equal(screen(), 'screen-driver'); assert.equal(S.current.uid, 'uY'); assert.equal(window.CU.uid, 'uY'); assert.equal(window.CUD.role, 'driver');
});
test('R2. محاولتان تكتملان بترتيب معكوس (B أولًا ثم A المتأخرة): لا جلسة يتيمة ولا لوحة، وحالة نظيفة برسالة', async () => {
  S.holdPopups = true; choose('customer'); await googleClick(); await sleep(130);                    // A (عميل) انتهت مهلتها
  choose('driver'); await googleClick(); await finishPopup(1, Y);                                   // B (كابتن) تكتمل أولًا
  assert.equal(screen(), 'screen-driver'); const before = screenLog.length;
  await finishPopup(0, X);                                                                          // A تكتمل متأخرة وتستبدل جلسة B في Firebase
  assert.equal(S.current, null, 'الجلسة اليتيمة أُنهيت'); assert.equal(window.CU, null); assert.equal(window.CUD, null);
  assert.equal(screenLog.slice(before).includes('screen-customer'), false); assert.equal(screen(), 'screen-entry');
  assert.match(el('home-err').textContent, /تم تجاهل محاولة دخول سابقة/);
});
test('R3. حدث "لا مستخدم" أثناء دخول جارٍ لا يمسح الدور المختار: حساب عميل يختار "كابتن" يُرفض ولا يدخل لوحة العميل', async () => {
  S.holdPopups = true; choose('driver'); await googleClick();
  S.listeners.forEach((l) => l(null)); await sleep(10);                                              // null عشوائي أثناء العملية
  assert.equal(A.peekEntryType(), 'driver'); assert.equal(el('lg-google').disabled, true);
  await finishPopup(0, X);
  assert.equal(ever(...DASH), false); assert.equal(S.signOuts, 1); assert.equal(S.current, null); assert.match(el('err-msg').textContent, /كحساب عميل.*ككابتن/); assert.equal(screen(), 'screen-login');
});
test('R4. نافذة Google تُلغى ثم تبدأ إعادة محاولة: لا أثر للأولى، والثانية تكتمل وتصل للوحة الصحيحة', async () => {
  S.holdPopups = true; choose('customer'); await googleClick(); await failPopup(0, 'auth/popup-closed-by-user');
  assert.match(el('err-msg').textContent, /إغلاق نافذة Google/); assert.equal(el('lg-google').disabled, false); assert.equal(A.peekEntryType(), null); assert.equal(S.signOuts, 0);
  await googleClick(); assert.equal(S.held.length, 2); await finishPopup(1, X);
  assert.equal(screen(), 'screen-customer'); assert.equal(S.current.uid, 'uX'); assert.equal(S.signOuts, 0);
});
test('R5. جلسة سليمة قائمة ثم تُلغى نافذة Google: لا تسجيل خروج، والجلسة واللوحة كما هما', async () => {
  S.holdPopups = true; choose('customer'); await googleClick(); await finishPopup(0, X); assert.equal(screen(), 'screen-customer'); // جلسة سليمة عبر Google
  const p = window.loginGoogle('customer'); await sleep(10); await failPopup(1, 'auth/popup-closed-by-user'); await p;
  assert.equal(S.signOuts, 0); assert.equal(S.current.uid, 'uX'); assert.equal(window.CU.uid, 'uX'); assert.equal(window.CUD.role, 'customer'); assert.equal(screen(), 'screen-customer');
});
test('R5b. جلسة سليمة قائمة ثم تكتمل مصادقة متأخرة لنفس المستخدم من محاولة قديمة: الجلسة لا تُطرد', async () => {
  S.holdPopups = true; choose('customer'); await googleClick(); await sleep(130);                    // A انتهت مهلتها
  choose('customer'); await googleClick(); await finishPopup(1, X); assert.equal(screen(), 'screen-customer'); // B: نفس الحساب X تكتمل
  await finishPopup(0, X);                                                                           // A المتأخرة بنفس المستخدم (جلسته موجودة بعد B)
  assert.equal(screen(), 'screen-customer'); assert.equal(S.current.uid, 'uX');
});
test('R6. تعارض دور مع وصول أحداث المصادقة متأخرة (قبل/بعد وعد الدالة وبعد signOut): الرسالة والشاشة تبقيان، بلا لوحة وبلا جلسة', async () => {
  for (const order of ['listenerFirst', 'promiseFirst']) {
    await fresh(); S.users.uX = CUST; window.AUTH_OP_TIMEOUT_MS = 5000; S.listenerDelay = 30; S.holdPopups = true; choose('driver'); await googleClick(); await finishPopup(0, X, order); await sleep(150);
    assert.equal(screen(), 'screen-login', order); assert.match(el('err-msg').textContent, /كحساب عميل.*ككابتن/); assert.equal(ever(...DASH), false); assert.equal(S.current, null); assert.equal(S.signOuts, 1);
  }
  // حدث "لا مستخدم" إضافي بعد الرفض (مثلًا من تاب آخر): قد ينقل للرئيسية لكن الرسالة لا تضيع ولا تُفتح لوحة
  S.listeners.forEach((l) => l(null)); await sleep(80); assert.match(el('home-err').textContent, /كحساب عميل.*ككابتن/); assert.equal(ever(...DASH), false);
});
test('R7. نجاح مصادقة Google وفشل حفظ ملف المستخدم: لا لوحة، لا مستند، رسالة + إعادة محاولة، والإعادة تنجح مرة واحدة', async () => {
  const N = { uid: 'uid-n@x.com', email: 'n@x.com' }; S.holdPopups = true; choose('driver'); S.failWrite = true; await googleClick(); await finishPopup(0, N); await sleep(60);
  assert.equal(S.current.uid, 'uid-n@x.com'); assert.equal(S.users['uid-n@x.com'], undefined); assert.equal(ever(...DASH), false); assert.equal(screen(), 'screen-login'); assert.equal(el('lg-retry').hidden, false);
  S.failWrite = false; fire('lg-retry'); await sleep(80);
  assert.equal(screen(), 'screen-driver-register'); assert.equal(S.writes.filter((w) => w.path === 'users/uid-n@x.com').length, 1); assert.equal(S.users['uid-n@x.com'].role, 'driver'); assert.equal(S.users['uid-n@x.com'].status, 'incomplete');
});
test('R8. إعادة محاولة بعد تسجيل ناقص (بخروج ودخول جديد بدل زر الإعادة): الدخول التالي يُكمل الملف مرة واحدة بالدور المختار', async () => {
  const N = { uid: 'uid-n@x.com', email: 'n@x.com' }; S.holdPopups = true; choose('driver'); S.failWrite = true; await googleClick(); await finishPopup(0, N); await sleep(60);
  assert.equal(S.users['uid-n@x.com'], undefined); S.failWrite = false; await window.doLogout(); await sleep(20);
  choose('driver'); await googleClick(); await finishPopup(1, N); await sleep(80);
  assert.equal(screen(), 'screen-driver-register'); assert.equal(S.writes.filter((w) => w.path === 'users/uid-n@x.com').length, 1); assert.equal(S.users['uid-n@x.com'].role, 'driver');
});
test('R9. تسجيل الخروج أثناء طلب معلّق ثم اكتماله متأخرًا: لا لوحة، لا جلسة، ولا تغيير للدور (الترتيبان)', async () => {
  for (const order of ['listenerFirst', 'promiseFirst']) {
    await fresh(); S.users.uX = CUST; window.AUTH_OP_TIMEOUT_MS = 5000; S.holdPopups = true; choose('customer'); await googleClick();
    await window.doLogout(); await sleep(10); assert.equal(screen(), 'screen-entry');
    await finishPopup(0, X, order); await sleep(20);
    assert.equal(ever(...DASH), false, order + ': ' + screenLog.join('>')); assert.equal(S.current, null, order); assert.equal(window.CU, null); assert.equal(screen(), 'screen-entry'); assert.match(el('home-err').textContent, /تم تجاهل محاولة دخول سابقة/);
  }
});
test('R10. تنظيف قديم (فشل متأخر لمحاولة Google انتهت مهلتها) بعد بدء محاولة أحدث: لا يلمس دورها ولا حالتها', async () => {
  S.holdPopups = true; choose('customer'); await googleClick(); await sleep(130);                    // A (عميل) انتهت مهلتها
  assert.equal(el('lg-google').disabled, false);
  choose('driver'); await googleClick();                                                            // B: Google بدور كابتن
  await failPopup(0, 'auth/network-request-failed');                                                // فشل A المتأخر (كان سيمسح دور B ويفك قفلها)
  assert.equal(el('lg-google').disabled, true); assert.equal(A.peekEntryType(), 'driver'); assert.equal(el('err-msg').textContent.includes('الإنترنت'), false, 'رسالة A لا تظهر على B');
  await finishPopup(1, X);                                                                           // B تكتمل بحساب عميل: لازم تُرفض (دور B كابتن)، لا لوحة عميل بصمت
  assert.equal(ever(...DASH), false); assert.equal(S.signOuts, 1); assert.match(el('err-msg').textContent, /كحساب عميل.*ككابتن/);
});
test('R11. ضغط مزدوج أثناء عملية معلّقة لا ينشئ محاولتين متداخلتين', async () => {
  window.AUTH_OP_TIMEOUT_MS = 5000; S.holdPopups = true; choose('customer'); fire('lg-google'); fire('lg-google'); await sleep(10);
  assert.equal(S.held.length, 1); await finishPopup(0, X); assert.equal(screen(), 'screen-customer');
});
test('R12. حدث مستخدم بلا محاولة (جلسة مستعادة) أثناء وجود محاولة قديمة معلّقة يُحجز ثم يُرفض بأمان (fail-closed) ولا يفتح لوحة', async () => {
  window.AUTH_OP_TIMEOUT_MS = 60; S.holdPopups = true; choose('customer'); await googleClick(); await sleep(100);   // A انتهت مهلتها وعمليتها معلّقة
  S.current = Y; S.listeners.forEach((l) => l(Y)); await sleep(30);                                  // حدث مستخدم مجهول المصدر
  assert.equal(ever(...DASH), false, 'محجوز: لا توجيه'); assert.equal(window.CU, null);
});
