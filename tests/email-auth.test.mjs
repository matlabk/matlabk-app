// node --test tests/email-auth.test.mjs
// اختبارات سلوكية لمصادقة البريد/كلمة المرور فوق كود auth.js الحقيقي مع محاكاة Firebase والمتصفح.
// مش اختبار تكامل مع Firebase Auth الحقيقي (قواعد كلمة المرور/التحقق/الحماية من الإساءة تعمل في الخادم الفعلي فقط).
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { A, $, T, reset, wireAuthListener, popupSucceeds, settle, DASHBOARDS, opened } from './helpers/env.mjs';
import { RESET_SENT, MSG_USER_LOAD_FAILED, validateSignup, validateEmailLogin, isValidEmail, describeAuthError } from '../js/auth-flow.js';

const PW = 'Sup3r-Secret-Pass!';
const CUSTOMER = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const DRIVER_ACTIVE = { role: 'driver', status: 'active', fullName: 'D', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } };
const BAD = 'البريد الإلكتروني أو كلمة المرور غير صحيحة. إذا كنت سجّلت سابقًا عبر Google فاستخدم زر Google.';
const fill = (id, v) => { $(id).value = v; };
const errText = (id = 'err-msg') => $(id).textContent;
let logs;
const realConsole = { warn: console.warn, error: console.error, log: console.log };
beforeEach(() => { const t = reset(); wireAuthListener(); logs = []; for (const k of ['warn', 'error', 'log']) console[k] = (...a) => { logs.push(a.map(String).join(' ')); }; });
import { afterEach } from 'node:test'; afterEach(() => { Object.assign(console, realConsole); });

function account(email, uid, doc) { T().accounts[email] = { uid, password: PW }; if (doc) T().users[uid] = doc; }
async function doLogin(role, email, pw = PW) { A.openLogin(role); fill('em-email', email); fill('em-pass', pw); await A.emailLogin({ preventDefault() {} }); await settle(); }
async function doSignup(role, email, pw = PW, confirm = pw) { A.openLogin(role); A.openSignup(); fill('su-email', email); fill('su-pass', pw); fill('su-pass2', confirm); await A.emailSignup({ preventDefault() {} }); await settle(); }

// ---------- تسجيل الدخول ----------
test('E1. بريد وكلمة مرور صحيحان لعميل => لوحة العميل بعد قراءة Firestore', async () => {
  account('a@x.com', 'u1', CUSTOMER); await doLogin('customer', 'a@x.com');
  const t = T(); assert.equal(t.screens.at(-1), 'screen-customer'); assert.ok(t.calls.includes('loadCustomerData')); assert.equal(t.signOuts, 0); assert.ok(t.reads.includes('users/u1'));
});
test('E2. بيانات خاطئة (كلمة مرور / بريد غير مسجّل) => رسالة موحدة، لا لوحة، الدور المختار يُمسح، الحقول تُفرَّغ، الأزرار تعود', async () => {
  account('a@x.com', 'u1', CUSTOMER);
  for (const [email, pw] of [['a@x.com', 'wrong-pass'], ['nobody@x.com', PW]]) {
    await doLogin('customer', email, pw);
    assert.equal(errText(), BAD); assert.equal(opened(...DASHBOARDS), false); assert.equal($('em-pass').value, ''); assert.equal($('em-submit').disabled, false);
    assert.deepEqual(A.captureLoginIntent(), { intent: null, fresh: false, method: 'google' }); assert.equal(T().reads.length, 0);
  }
});
test('E3. مدخلات ناقصة/غير صالحة تُرفض محليًا بدون أي طلب Firebase', async () => {
  A.openLogin('customer');
  for (const [e, p, re] of [['', PW, /صيغة البريد/], ['not-an-email', PW, /صيغة البريد/], ['a@x.com', '', /اكتب كلمة المرور/]]) { fill('em-email', e); fill('em-pass', p); await A.emailLogin(); assert.match(errText(), re); }
  assert.equal(T().emailCalls.length, 0);
});
test('E4. بدون نوع حساب مختار => لا طلب Firebase، رجوع لاختيار النوع (لا افتراض عميل)', async () => {
  fill('em-email', 'a@x.com'); fill('em-pass', PW); window.selectedType = null; await A.emailLogin();
  assert.equal(T().emailCalls.length, 0); assert.equal(T().screens.at(-1), 'screen-role-pick'); assert.match(errText(), /اختر نوع الحساب/);
  window.selectedType = 'admin'; await A.emailLogin(); assert.equal(T().emailCalls.length, 0); // admin ليس نوعًا قابلًا للاختيار
});

// ---------- الأدوار والصلاحيات ----------
test('E5. تعارض أدوار بالبريد: كل التقاطعات الستة => لا لوحة، خروج، رسالة بالدور الفعلي + "ببريد إلكتروني آخر"', async () => {
  const ROLES = { customer: CUSTOMER, driver: DRIVER_ACTIVE, merchant: { role: 'merchant', status: 'active', name: 'M' } }; const LABEL = { customer: 'عميل', driver: 'كابتن', merchant: 'تاجر' }; const AS = { customer: 'كعميل', driver: 'ككابتن', merchant: 'كتاجر' };
  for (const role of Object.keys(ROLES)) for (const intent of Object.keys(ROLES)) {
    if (role === intent) continue; reset(); wireAuthListener(); account('a@x.com', 'u1', ROLES[role]); T().stores.u1 = {};
    await doLogin(intent, 'a@x.com');
    const t = T(); assert.equal(opened(...DASHBOARDS, 'screen-driver-register', 'screen-merchant-status', 'screen-complete-customer', 'screen-complete-merchant'), false, `${role}->${intent}: ${t.screens}`);
    assert.equal(t.signOuts, 1); assert.equal(t.writes.length, 0); assert.equal(window.CUD, null); assert.equal(t.screens.at(-1), 'screen-login');
    assert.equal(errText(), `هذا البريد الإلكتروني مسجّل بالفعل كحساب ${LABEL[role]}. لاستخدام MATLABK ${AS[intent]}، يُرجى تسجيل الدخول ببريد إلكتروني آخر.`);
  }
});
test('E6. نفس الدور + حالة pending/incomplete بالبريد => مسار الاستكمال/المراجعة، لا لوحة تشغيل', async () => {
  for (const [role, doc, screen] of [['driver', { role: 'driver', status: 'pending' }, 'screen-driver-register'], ['driver', { role: 'driver', status: 'incomplete' }, 'screen-driver-register'], ['merchant', { role: 'merchant', status: 'pending', name: 'M' }, 'screen-merchant-status']]) {
    reset(); wireAuthListener(); account('a@x.com', 'u1', doc); T().stores.u1 = {}; await doLogin(role, 'a@x.com');
    assert.equal(T().screens.at(-1), screen, doc.role + '/' + doc.status); assert.equal(opened('screen-driver', 'screen-merchant', 'screen-admin'), false); assert.equal(T().calls.includes('loadDriverData') || T().calls.includes('loadMerchantData'), false);
  }
});
test('E7. admin حقيقي: يدخل من زر العميل فقط؛ مرفوض كابتن/تاجر دون كشف وجود الإدارة؛ حقول ذاتية في مستند عميل لا تمنح admin', async () => {
  account('a@x.com', 'u1', { role: 'admin', status: 'active' }); await doLogin('customer', 'a@x.com'); assert.equal(T().screens.at(-1), 'screen-admin');
  for (const intent of ['driver', 'merchant']) { reset(); wireAuthListener(); account('a@x.com', 'u1', { role: 'admin', status: 'active' }); await doLogin(intent, 'a@x.com'); assert.equal(T().calls.includes('loadAdminData'), false); assert.ok(!/إدارة|admin/i.test(errText()), errText()); }
  reset(); wireAuthListener(); account('b@x.com', 'u2', { ...CUSTOMER, isAdmin: true, approved: true }); await doLogin('customer', 'b@x.com'); assert.equal(T().screens.at(-1), 'screen-customer'); assert.equal(T().calls.includes('loadAdminData'), false);
});
test('E8. دور مفقود/غير معروف لحساب بريد => رفض وخروج (fail-closed)', async () => {
  account('a@x.com', 'u1', { status: 'active', name: 'x', phone: '01012345678' }); await doLogin('customer', 'a@x.com');
  assert.equal(opened(...DASHBOARDS, 'screen-complete-customer'), false); assert.equal(T().signOuts, 1);
});
test('E9. فشل قراءة users/{uid} بعد نجاح المصادقة => رسالة + إعادة محاولة، لا لوحة؛ والإعادة تحتفظ بالدور المختار', async () => {
  account('a@x.com', 'u1', CUSTOMER); T().failRead = true; await doLogin('driver', 'a@x.com');
  assert.equal(errText(), MSG_USER_LOAD_FAILED); assert.equal($('lg-retry').hidden, false); assert.equal(opened(...DASHBOARDS, 'screen-complete-customer'), false); assert.equal(window.CUD, null);
  T().failRead = false; T().screens.length = 0; await A.retryLoadAccount();
  assert.equal(opened(...DASHBOARDS), false); assert.equal(T().signOuts, 1); assert.match(errText(), /كحساب عميل.*ببريد إلكتروني آخر/); // الدور المختار (كابتن) احتُفظ به
});

// ---------- إنشاء حساب ----------
test('E10. إنشاء حساب عميل: مستند واحد role=customer/status=active، بدون صلاحيات admin، ثم استكمال بيانات العميل', async () => {
  await doSignup('customer', 'new@x.com');
  const t = T(); const w = t.writes.filter((x) => x.path.startsWith('users/')); assert.equal(w.length, 1); assert.equal(w[0].path, 'users/uid-new@x.com');
  assert.equal(w[0].data.role, 'customer'); assert.equal(w[0].data.status, 'active'); assert.equal(w[0].data.email, 'new@x.com');
  for (const k of ['isAdmin', 'admin', 'approvedBy', 'approvedAt', 'rejectedBy']) assert.equal(k in w[0].data, false, k);
  assert.equal(t.screens.at(-1), 'screen-complete-customer'); assert.equal(opened(...DASHBOARDS), false);
});
test('E11. إنشاء حساب كابتن/تاجر: status=incomplete دائمًا + شاشة الاستكمال (لا موافقة ذاتية)', async () => {
  await doSignup('driver', 'd@x.com'); let w = T().writes.find((x) => x.path.startsWith('users/')); assert.equal(w.data.role, 'driver'); assert.equal(w.data.status, 'incomplete'); assert.equal(T().screens.at(-1), 'screen-driver-register');
  reset(); wireAuthListener(); await doSignup('merchant', 'm@x.com'); w = T().writes.find((x) => x.path.startsWith('users/')); assert.equal(w.data.role, 'merchant'); assert.equal(w.data.status, 'incomplete'); assert.equal(T().screens.at(-1), 'screen-complete-merchant');
  assert.equal(opened(...DASHBOARDS), false);
});
test('E12. مدخلات غير صالحة تُرفض محليًا: بريد خاطئ / كلمتان غير متطابقتين / قصيرة / طويلة', async () => {
  A.openLogin('customer'); A.openSignup();
  for (const [e, p, c, re] of [['bad', PW, PW, /صيغة البريد/], ['a@x.com', PW, PW + 'x', /غير متطابقتين/], ['a@x.com', 'short', 'short', /8 أحرف/], ['a@x.com', 'x'.repeat(129), 'x'.repeat(129), /طويلة/]]) {
    fill('su-email', e); fill('su-pass', p); fill('su-pass2', c); await A.emailSignup(); assert.match(errText('su-err'), re);
  }
  assert.equal(T().emailCalls.length, 0); assert.equal(T().writes.length, 0);
});
test('E13. بريد مسجّل بالفعل => رسالة واضحة، لا كتابة، لا مستند ثانٍ، ولا يتغير الدور', async () => {
  account('a@x.com', 'u1', CUSTOMER); await doSignup('driver', 'a@x.com');
  assert.match(errText('su-err'), /مسجّل بالفعل/); assert.equal(T().writes.length, 0); assert.deepEqual(T().users.u1, CUSTOMER); assert.equal(Object.keys(T().users).length, 1); assert.equal(opened(...DASHBOARDS, 'screen-driver-register'), false);
  assert.equal($('su-submit').disabled, false);
});
test('E14. ضغط متكرر على إنشاء الحساب => طلب واحد، وحساب واحد، ومستند واحد', async () => {
  A.openLogin('customer'); A.openSignup(); fill('su-email', 'n@x.com'); fill('su-pass', PW); fill('su-pass2', PW);
  const p1 = A.emailSignup(); const p2 = A.emailSignup(); await Promise.all([p1, p2]); await settle();
  assert.equal(T().emailCalls.filter((c) => c.op === 'create').length, 1); assert.equal(T().writes.filter((x) => x.path.startsWith('users/')).length, 1);
});
test('E15. إنشاء حساب ثم تسجيل دخول بنفس البيانات: لا مستند مكرر', async () => {
  await doSignup('customer', 'n@x.com'); await A.doLogout(); T().writes.length = 0;
  await doLogin('customer', 'n@x.com'); assert.equal(T().writes.filter((x) => x.path.startsWith('users/')).length, 0); assert.equal(Object.keys(T().users).length, 1);
});
test('E16. انقطاع الاتصال / فشل الشبكة => رسائل عربية، بدون لوحة', async () => {
  A.openLogin('customer'); fill('em-email', 'a@x.com'); fill('em-pass', PW); T().netFail = true; await A.emailLogin(); assert.match(errText(), /الإنترنت|الاتصال/); assert.equal($('em-submit').disabled, false);
  T().netFail = false; const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { T().emailCalls.length = 0; fill('em-pass', PW); await A.emailLogin(); assert.equal(T().emailCalls.length, 0); assert.match(errText(), /الإنترنت|الاتصال/); } finally { desc ? Object.defineProperty(globalThis, 'navigator', desc) : delete globalThis.navigator; }
});

// ---------- استعادة كلمة المرور ----------
test('E17. استعادة كلمة المرور: نفس الرد المحايد لبريد مسجّل وغير مسجّل (لا كشف)', async () => {
  account('a@x.com', 'u1', CUSTOMER);
  for (const email of ['a@x.com', 'nobody@x.com']) { reset(); wireAuthListener(); account('a@x.com', 'u1', CUSTOMER); A.openLogin('customer'); A.openForgot(); fill('fg-email', email); await A.emailReset(); assert.equal($('fg-ok').textContent, RESET_SENT); assert.equal(errText('fg-err'), ''); assert.equal(T().emailCalls.at(-1).op, 'reset'); assert.equal($('fg-submit').disabled, false); }
});
test('E18. استعادة: بريد غير صالح لا يستدعي Firebase؛ أخطاء الشبكة/المحاولات الكثيرة برسائل عربية؛ الرسالة القديمة تُمسح', async () => {
  A.openLogin('customer'); A.openForgot(); fill('fg-email', 'bad'); await A.emailReset(); assert.match(errText('fg-err'), /صيغة البريد/); assert.equal(T().emailCalls.length, 0);
  fill('fg-email', 'a@x.com'); T().resetErr = 'auth/too-many-requests'; await A.emailReset(); assert.match(errText('fg-err'), /محاولات كثيرة/); assert.equal($('fg-ok').style.display, 'none');
  T().resetErr = null; T().netFail = true; await A.emailReset(); assert.match(errText('fg-err'), /الإنترنت|الاتصال/);
});
test('E19. استعادة كلمة المرور لا تنشئ جلسة ولا تفتح شاشة ولا تكتب بيانات', async () => {
  account('a@x.com', 'u1', CUSTOMER); A.openLogin('customer'); A.openForgot(); fill('fg-email', 'a@x.com'); const before = T().screens.length; await A.emailReset();
  assert.equal(T().currentUser, null); assert.equal(T().screens.length, before); assert.equal(T().writes.length, 0); assert.equal(T().reads.length, 0);
});

// ---------- الجلسة والخروج والتخزين ----------
test('E20. الخروج بعد دخول بالبريد: جلسة منتهية، صفحة رئيسية، حقول فارغة، لا اختيار عالق، وبيانات Firestore سليمة', async () => {
  account('a@x.com', 'u1', CUSTOMER); await doLogin('customer', 'a@x.com'); fill('em-email', 'a@x.com'); fill('em-pass', PW); fill('su-pass', PW);
  await A.doLogout(); const t = T();
  assert.equal(t.currentUser, null); assert.equal(t.screens.at(-1), 'screen-entry'); assert.equal(window.CU, null); assert.equal(window.CUD, null);
  for (const id of ['em-email', 'em-pass', 'su-email', 'su-pass', 'su-pass2', 'fg-email']) assert.equal($(id).value, '', id);
  assert.deepEqual(A.captureLoginIntent(), { intent: null, fresh: false, method: 'google' }); assert.deepEqual(t.users.u1, CUSTOMER); assert.equal(t.writes.length, 0);
});
test('E21. اختيار دور قديم لا يؤثر على جلسة بريد مستعادة لاحقًا', async () => {
  account('a@x.com', 'u1', CUSTOMER); await doLogin('driver', 'a@x.com'); // رُفض
  T().screens.length = 0; T().currentUser = null; await (async () => { const { authStateChanged } = await import('./helpers/env.mjs'); await authStateChanged({ uid: 'u1', email: 'a@x.com' }); })();
  assert.equal(T().screens.at(-1), 'screen-customer');
});
test('E22. كلمة المرور لا تُخزَّن ولا تُسجَّل ولا تُكتب في Firestore (نجاح وفشل وإنشاء)', async () => {
  account('a@x.com', 'u1', CUSTOMER); await doLogin('customer', 'a@x.com'); await A.doLogout();
  await doLogin('customer', 'a@x.com', PW + 'x'); await doSignup('customer', 'z@x.com'); T().resetErr = 'auth/network-request-failed';
  const dump = JSON.stringify([T().writes, T().users, [...Array(sessionStorage.length ?? 0)]]) + JSON.stringify(logs);
  assert.equal(dump.includes(PW), false); for (const st of [sessionStorage, localStorage]) for (const k of ['matlabk_entry_type', 'matlabk_last_uid', 'matlabk_redirect_pending']) { const v = st.getItem(k); assert.ok(v === null || !v.includes(PW), k); }
  assert.equal($('em-pass').value, ''); assert.equal($('su-pass').value, ''); assert.equal($('su-pass2').value, '');
});
test('E23. عملية Google معلّقة تمنع بدء دخول بالبريد في نفس الوقت (قفل مشترك)، وGoogle يعمل بعد ذلك كما كان', async () => {
  const t = T(); let done; t.popup = () => new Promise((r) => { done = r; }); account('a@x.com', 'u1', CUSTOMER);
  A.openLogin('customer'); const g = A.loginGoogle(); fill('em-email', 'a@x.com'); fill('em-pass', PW); await A.emailLogin();
  assert.equal(t.emailCalls.length, 0); assert.equal($('em-submit').disabled, true);
  t.users.g1 = CUSTOMER; popupSucceeds({ uid: 'g1' }); done(await (async () => { t.currentUser = { uid: 'g1' }; return { user: t.currentUser }; })()); await g; A.resetLoginState(); A.clearEntryIntent();
  reset(); wireAuthListener(); T().users.g1 = CUSTOMER; A.openLogin('customer'); popupSucceeds({ uid: 'g1' }); await A.loginGoogle(); await settle(); assert.equal(T().screens.at(-1), 'screen-customer');
});
test('E24. رسالة التعارض لمسار Google بقيت كما هي ("ببريد Google آخر")', async () => {
  T().users.u1 = CUSTOMER; A.openLogin('driver'); popupSucceeds({ uid: 'u1' }); await A.loginGoogle(); await settle();
  assert.match(errText(), /ببريد Google آخر\.$/); assert.equal(opened(...DASHBOARDS), false);
});

// ---------- منطق نقي ----------
test('E25. التحقق من المدخلات ورسائل أخطاء Firebase', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com', ' a@b.co ']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', 'a', 'a@b', '@b.com', 'a b@c.com', 'a@b.c', null, undefined, 'x'.repeat(250) + '@b.com']) assert.equal(isValidEmail(bad), false, String(bad));
  assert.equal(validateSignup({ email: 'a@b.co', password: '12345678', confirm: '12345678' }).ok, true); assert.equal(validateEmailLogin({ email: 'a@b.co', password: 'x' }).ok, true);
  for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']) assert.equal(describeAuthError({ code }, { method: 'email' }).message, BAD);
  for (const code of ['auth/email-already-in-use', 'auth/weak-password', 'auth/invalid-email', 'auth/operation-not-allowed', 'auth/too-many-requests', 'auth/user-disabled', 'auth/network-request-failed']) { const m = describeAuthError({ code }, { method: 'email' }).message; assert.ok(m.length > 10 && /[\u0600-\u06FF]/.test(m) && !/auth\//.test(m), code); }
  assert.match(describeAuthError({ code: 'auth/operation-not-allowed' }, { method: 'email' }).message, /بالبريد الإلكتروني غير متاح/);
  assert.match(describeAuthError({ code: 'auth/operation-not-allowed' }).message, /Google/); // مسار Google بلا تغيير
});

test('E26. أخطاء إعدادات المشروع (قيود مفتاح API على النطاق وغيرها) تُعرض كرسالة إعدادات واضحة لكل الطرق، لا كـ"خطأ غير متوقع"', async () => {
  const { CONFIG_ERROR } = await import('../js/auth-flow.js');
  for (const code of ['auth/requests-from-referer-https://matlabk.github.io-are-blocked.', 'auth/invalid-api-key', 'auth/app-not-authorized', 'auth/configuration-not-found']) for (const method of ['google', 'email']) assert.equal(describeAuthError({ code }, { method }).message, CONFIG_ERROR, code + ' ' + method);
  assert.notEqual(describeAuthError({ code: 'auth/internal-error' }).message, CONFIG_ERROR);
});
