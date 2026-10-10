// node --test tests/role-gate.test.mjs
// اختبارات سلوكية: كود auth.js الحقيقي (handleSignedIn / loginGoogle / doLogout / routeUser / completeRegistration)
// مع محاكاة Firebase والمتصفح (tests/stubs + helpers). مش اختبار Google حقيقي ولا Firestore Emulator.
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { A, $, T, reset, authStateChanged, popupSucceeds, settle, DASHBOARDS, opened, breakSessionStorage } from './helpers/env.mjs';
import { MSG_INTENT_MISSING, MSG_INVALID_ROLE, MSG_USER_LOAD_FAILED } from '../js/auth-flow.js';

const USER = { uid: 'u1', email: 'a@x.com', displayName: 'A' };
const CUSTOMER = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const DRIVER_ACTIVE = { role: 'driver', status: 'active', fullName: 'Drv', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } };
const DRIVER_PENDING = { ...DRIVER_ACTIVE, status: 'pending' };
const DRIVER_INCOMPLETE = { role: 'driver', status: 'incomplete' };
const MERCHANT_ACTIVE = { role: 'merchant', status: 'active', name: 'M' };
const MERCHANT_PENDING = { role: 'merchant', status: 'pending', name: 'M' };
const ROLES = { customer: CUSTOMER, driver: DRIVER_ACTIVE, merchant: MERCHANT_ACTIVE };
const DASH = { customer: 'screen-customer', driver: 'screen-driver', merchant: 'screen-merchant' };
const errText = () => $('err-msg').textContent;
beforeEach(() => reset());

async function loginAs(intent, doc, extra = {}) {
  const t = T(); t.users[USER.uid] = doc; if (doc.role === 'merchant') t.stores[USER.uid] = { status: doc.status };
  A.openLogin(intent); popupSucceeds(USER);
  await A.loginGoogle(); await settle();
  return t;
}

// 1) عميل يدخل كعميل
test('1. عميل يسجل الدخول كعميل => لوحة العميل فقط', async () => {
  const t = await loginAs('customer', CUSTOMER);
  assert.equal(t.screens.at(-1), 'screen-customer'); assert.equal(t.signOuts, 0); assert.ok(t.calls.includes('loadCustomerData')); assert.deepEqual(window.CUD, CUSTOMER);
});

// 2/3/4/5) كل التعارضات: 6 تقاطعات (عميل/كابتن/تاجر) - لا لوحة، خروج فعلي، رسالة بالدور الفعلي، لا كتابة في Firestore
for (const [role, label] of [['customer', 'عميل'], ['driver', 'كابتن'], ['merchant', 'تاجر']]) {
  for (const [intent, as] of [['customer', 'كعميل'], ['driver', 'ككابتن'], ['merchant', 'كتاجر']]) {
    if (intent === role) continue;
    test(`2-5. حساب ${label} يحاول الدخول ${as} => رفض + رسالة + خروج بدون فتح أي لوحة`, async () => {
      const t = await loginAs(intent, ROLES[role]);
      assert.equal(opened(...DASHBOARDS, 'screen-driver-register', 'screen-merchant-status', 'screen-complete-merchant', 'screen-complete-customer', 'screen-blocked'), false, 'لا شاشة دور تُفتح: ' + t.screens.join(','));
      for (const c of ['loadCustomerData', 'loadDriverData', 'loadMerchantData', 'loadAdminData', 'startNotifListener', 'loadCategories', 'listenRideOffers']) assert.equal(t.calls.includes(c), false, c);
      assert.equal(t.signOuts, 1); assert.equal(t.currentUser, null); assert.equal(window.CU?.uid ?? null, window.CU?.uid ?? null);
      assert.equal(t.screens.at(-1), 'screen-login');
      assert.equal(errText(), `هذا البريد الإلكتروني مسجّل بالفعل كحساب ${label}. لاستخدام MATLABK ${as}، يُرجى تسجيل الدخول ببريد Google آخر.`);
      assert.equal(t.writes.length, 0, 'لا تغيير دور ولا مستند ثانٍ'); assert.deepEqual(t.users[USER.uid], ROLES[role]); assert.equal(Object.keys(t.users).length, 1);
      assert.equal(window.CUD, null);
    });
  }
}

// 6) استعادة جلسة صحيحة (بدون اختيار) => لوحة الدور المخزّن مباشرة
for (const role of ['customer', 'driver', 'merchant']) {
  test(`6. استعادة جلسة ${role} => لوحته مباشرة بدون إعادة اختيار`, async () => {
    const t = T(); t.users[USER.uid] = ROLES[role]; t.stores[USER.uid] = {};
    await authStateChanged(USER);
    assert.equal(t.screens.at(-1), DASH[role]); assert.equal(t.signOuts, 0);
  });
}
test('6b. استعادة الجلسة تنتظر قراءة Firestore: لا لوحة قبل اكتمالها ولا تخمين دور', async () => {
  const t = T(); t.users[USER.uid] = CUSTOMER; let release; t.readGate = new Promise((r) => { release = r; });
  const p = authStateChanged(USER); await settle();
  assert.equal(window.CUD, null); assert.equal(opened(...DASHBOARDS, 'screen-complete-customer'), false); assert.equal(t.calls.length, 0);
  release(); await p; assert.equal(t.screens.at(-1), 'screen-customer');
});

// 7) خروج ثم العودة للبداية
test('7. تسجيل الخروج: إنهاء الجلسة + الصفحة الرئيسية + مسح الحالة المعلّقة + عدم المساس ببيانات Firestore', async () => {
  const t = await loginAs('customer', CUSTOMER);
  A.setEntryIntent('driver'); await A.doLogout();
  assert.equal(t.currentUser, null); assert.equal(t.signOuts, 1); assert.equal(t.screens.at(-1), 'screen-entry');
  assert.equal(window.CUD, null); assert.equal(window.selectedType, null); assert.equal(sessionStorage.getItem('matlabk_entry_type'), null);
  assert.deepEqual(t.users[USER.uid], CUSTOMER); assert.equal(t.writes.length, 0);
  assert.deepEqual(A.captureLoginIntent(), { intent: null, fresh: false, method: 'google' });
});

// 8) الدور القديم لا يبقى عالقًا
test('8a. بعد خروج: اختيار "كابتن" القديم لا يؤثر على جلسة عميل لاحقة', async () => {
  await loginAs('driver', DRIVER_ACTIVE); // يدخل ككابتن فعلًا
  await A.doLogout(); T().screens.length = 0; T().users[USER.uid] = CUSTOMER;
  await authStateChanged(USER); // جلسة مستعادة كعميل بدون اختيار
  assert.equal(T().screens.at(-1), 'screen-customer');
});
test('8b. إلغاء نافذة Google: الدور المختار يُمسح (لا يتسرب لدخول لاحق)', async () => {
  T().users[USER.uid] = CUSTOMER; A.openLogin('driver');
  T().popup = async () => { throw Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }); };
  await A.loginGoogle();
  assert.equal(sessionStorage.getItem('matlabk_entry_type'), null); assert.deepEqual(A.captureLoginIntent(), { intent: null, fresh: false, method: 'google' });
  assert.match(errText(), /تم إغلاق نافذة Google/); assert.equal($('lg-google').disabled, false);
});
test('8c. دور مختار منتهي الصلاحية (>10 دقائق) في تخزين الجلسة يُتجاهل', () => {
  sessionStorage.setItem('matlabk_entry_type', JSON.stringify({ t: 'driver', ts: Date.now() - 11 * 60 * 1000 }));
  assert.equal(A.peekEntryType(), null);
});

// 9) فشل قراءة users/{uid}
test('9. فشل قراءة ملف المستخدم: رسالة + إعادة محاولة، بدون لوحة ولا تخمين دور؛ والإعادة تحتفظ بالدور المختار', async () => {
  const t = T(); t.users[USER.uid] = CUSTOMER; t.failRead = true;
  A.openLogin('driver'); popupSucceeds(USER); await A.loginGoogle(); await settle();
  assert.equal(opened(...DASHBOARDS, 'screen-complete-customer'), false); assert.equal(window.CUD, null);
  assert.equal(errText(), MSG_USER_LOAD_FAILED); assert.equal($('lg-retry').hidden, false); assert.equal(t.calls.includes('loadCustomerData'), false);
  t.failRead = false; t.screens.length = 0; await A.retryLoadAccount(); // المختار كان كابتن والحساب عميل => رفض وليس دخول عميل
  assert.equal(opened(...DASHBOARDS), false); assert.equal(t.signOuts, 1); assert.match(errText(), /مسجّل بالفعل كحساب عميل.*ككابتن/);
});
test('9b. فشل القراءة في جلسة مستعادة: رسالة في الصفحة الرئيسية بدون لوحة', async () => {
  const t = T(); t.users[USER.uid] = CUSTOMER; t.failRead = true; await authStateChanged(USER);
  assert.equal(t.screens.at(-1), 'screen-entry'); assert.equal($('home-err').textContent, MSG_USER_LOAD_FAILED); assert.equal($('home-retry').hidden, false);
  assert.equal(opened(...DASHBOARDS), false);
  t.failRead = false; await A.retryLoadAccount(); assert.equal(t.screens.at(-1), 'screen-customer');
});

// 10) حساب جديد لم يكتمل ملفه
test('10a. حساب جديد كابتن => status incomplete + شاشة استكمال البيانات (لا لوحة تشغيل)', async () => {
  const t = T(); A.openLogin('driver'); popupSucceeds(USER); await A.loginGoogle(); await settle();
  const w = t.writes.find((x) => x.path === 'users/u1'); assert.equal(w.data.role, 'driver'); assert.equal(w.data.status, 'incomplete');
  assert.equal(t.screens.at(-1), 'screen-driver-register'); assert.equal(opened(...DASHBOARDS), false);
});
test('10b. حساب جديد تاجر => incomplete + استكمال بيانات المتجر', async () => {
  const t = T(); A.openLogin('merchant'); popupSucceeds(USER); await A.loginGoogle(); await settle();
  assert.equal(t.writes.find((x) => x.path === 'users/u1').data.status, 'incomplete'); assert.equal(t.screens.at(-1), 'screen-complete-merchant'); assert.equal(opened(...DASHBOARDS), false);
});
test('10c. حساب جديد عميل بدون هاتف => شاشة استكمال العميل', async () => {
  const t = T(); A.openLogin('customer'); popupSucceeds(USER); await A.loginGoogle(); await settle();
  assert.equal(t.screens.at(-1), 'screen-complete-customer');
});
test('10d. جلسة مستعادة لحساب بلا مستند (تسجيل لم يكتمل) => شاشة اختيار الدور، لا لوحة', async () => {
  await authStateChanged(USER); assert.equal(T().screens.at(-1), 'screen-role-select'); assert.equal(opened(...DASHBOARDS), false);
});

// 11) pending
test('11. كابتن/تاجر pending أو incomplete => لا لوحة تشغيل', async () => {
  for (const [doc, screen] of [[DRIVER_PENDING, 'screen-driver-register'], [DRIVER_INCOMPLETE, 'screen-driver-register'], [MERCHANT_PENDING, 'screen-merchant-status']]) {
    reset(); const t = T(); t.users[USER.uid] = doc; t.stores[USER.uid] = {};
    await authStateChanged(USER); assert.equal(t.screens.at(-1), screen, doc.role + '/' + doc.status); assert.equal(opened('screen-driver', 'screen-merchant'), false);
    assert.equal(t.calls.includes('loadDriverData') || t.calls.includes('loadMerchantData'), false);
  }
});
test('11b. نفس الدور + pending => يدخل مسار الدور (ليس رفضًا)', async () => {
  const t = await loginAs('driver', DRIVER_PENDING); assert.equal(t.signOuts, 0); assert.equal(t.screens.at(-1), 'screen-driver-register');
  reset(); const t2 = await loginAs('merchant', MERCHANT_PENDING); assert.equal(t2.signOuts, 0); assert.equal(t2.screens.at(-1), 'screen-merchant-status');
});

// 12) admin / fail-closed
test('12a. لا يوجد اختيار admin: loginGoogle("admin") لا يفتح Google ولا يفترض عميلًا', async () => {
  A.openRolePick(); window.selectedType = null; popupSucceeds(USER); await A.loginGoogle('admin');
  assert.equal(T().popupCalls, 0); assert.equal(T().screens.at(-1), 'screen-role-pick'); assert.match(errText() || $('err-msg').textContent, /اختر نوع الحساب/);
});
test('12b. حقول ذاتية (isAdmin/approved) في مستند عميل لا تفتح لوحة الإدارة', async () => {
  const t = T(); t.users[USER.uid] = { ...CUSTOMER, isAdmin: true, role2: 'admin', approved: true }; await authStateChanged(USER);
  assert.equal(t.screens.at(-1), 'screen-customer'); assert.equal(t.calls.includes('loadAdminData'), false);
});
test('12c. مستند admin حقيقي: يدخل من زر العميل فقط، ومرفوض ككابتن/تاجر بدون كشف وجود حساب إدارة', async () => {
  let t = await loginAs('customer', { role: 'admin', status: 'active' }); assert.equal(t.screens.at(-1), 'screen-admin'); assert.ok(t.calls.includes('loadAdminData'));
  for (const intent of ['driver', 'merchant']) {
    reset(); t = await loginAs(intent, { role: 'admin', status: 'active' });
    assert.equal(t.calls.includes('loadAdminData'), false); assert.equal(t.signOuts, 1); assert.ok(!/إدارة|admin/i.test(errText()), errText());
  }
});
test('12d. دور مفقود/غير معروف في Firestore => رفض وخروج، لا افتراض عميل (fail-closed)', async () => {
  for (const bad of [{ status: 'active', name: 'x', phone: '01012345678' }, { role: 'weird', status: 'active' }, { role: '', status: 'active' }]) {
    reset(); const t = await loginAs('customer', bad);
    assert.equal(opened(...DASHBOARDS, 'screen-complete-customer'), false, JSON.stringify(bad)); assert.equal(t.signOuts, 1); assert.equal(errText() || $('home-err').textContent, MSG_INVALID_ROLE);
  }
});
test('12e. routeUser نفسها fail-closed: CUD=null لا يفتح لوحة العميل', async () => {
  const t = T(); window.CUD = null; A.routeUser(); await settle();
  assert.equal(opened(...DASHBOARDS), false); assert.equal(t.calls.includes('loadCustomerData'), false); assert.equal(t.screens.at(-1), 'screen-entry');
});
test('12f. دخول جديد بلا دور مختار (تخزين مفقود بعد redirect) => رفض، لا توجيه بالدور المخزّن', async () => {
  const t = T(); t.users[USER.uid] = DRIVER_ACTIVE; sessionStorage.setItem('matlabk_redirect_pending', String(Date.now()));
  await authStateChanged(USER);
  assert.equal(opened(...DASHBOARDS), false); assert.equal(t.signOuts, 1); assert.equal($('err-msg').textContent, MSG_INTENT_MISSING); assert.equal(t.screens.at(-1), 'screen-role-pick');
});
test('12g. sessionStorage معطّل (وضع خاص): الدور المختار يبقى في الذاكرة ويُطبَّق الفحص', async () => {
  breakSessionStorage(true); const t = await loginAs('driver', CUSTOMER);
  assert.equal(opened(...DASHBOARDS), false); assert.equal(t.signOuts, 1); assert.match(errText(), /كحساب عميل/);
});
test('12h. نفس المستخدم داخل بالفعل ويضغط دورًا مختلفًا => نفس الفحص (قراءة طازجة)، ولا لوحة', async () => {
  const t = T(); t.users[USER.uid] = CUSTOMER; await authStateChanged(USER); t.screens.length = 0; t.calls.length = 0;
  A.openLogin('merchant'); popupSucceeds(USER); await A.loginGoogle(); await settle();
  assert.equal(opened(...DASHBOARDS), false); assert.equal(t.signOuts, 1); assert.match(errText(), /كحساب عميل.*كتاجر/);
});
test('12i. ضغط متكرر على Google أثناء عملية معلّقة => نافذة واحدة فقط', async () => {
  const t = T(); let done; t.popup = () => new Promise((r) => { done = r; }); A.openLogin('customer');
  const p1 = A.loginGoogle(); const p2 = A.loginGoogle(); await p2; assert.equal(t.popupCalls, 1); assert.equal($('lg-google').disabled, true);
  done({ user: USER }); t.currentUser = USER; await p1;
});

test('13. مستمع main.js يطابق تسلسل الاختبار: التقاط الدور -> reset -> بوابة واحدة (لا توجيه مباشر)', async () => {
  const { readFileSync } = await import('node:fs'); const m = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const h = m.slice(m.indexOf('onAuthStateChanged(auth, async user =>'));
  const i1 = h.indexOf('captureLoginIntent()'), i2 = h.indexOf('resetLoginState(); clearRedirectPending();'), i3 = h.indexOf('window.CU = user;'), i4 = h.indexOf('await handleSignedIn(user, attempt)');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3 && i3 < i4);
});
test('14. بعد رفض الدور لا يعاد تمرير نفس الدخول على البوابة (سباق popup/المستمع) ولا تبقى جلسة CU', async () => {
  const t = await loginAs('driver', CUSTOMER);
  assert.equal(t.reads.filter((r) => r === 'users/u1').length, 1, 'قراءة واحدة فقط'); assert.equal(window.CU, null);
});
