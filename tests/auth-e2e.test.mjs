// node --test tests/auth-e2e.test.mjs
// تشغيل كامل للتطبيق (js/main.js + كل الموديولات الحقيقية + DOM مبني من index.html الحقيقي): الضغط يتم بتنفيذ معالجات onclick
// الفعلية. فقط Firebase (Auth/Firestore) محاكى بنموذج يتبع ترتيب أحداث الـ SDK (tests/boot/sdk.mjs). ليس اختبارًا على Firebase الحقيقي.
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { A, S, sleep, fresh, errors, consoleErrors, loadError } from './boot/env.mjs';
import { activeScreens, el, fire, nativeSubmits, screenLog } from './boot/dom.mjs';
import fs from 'node:fs';

const CUST = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const DRV = { role: 'driver', status: 'active', fullName: 'Drv', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } };
const MER = { role: 'merchant', status: 'active', name: 'M' };
// البطاقات بلا id: ننفذ onclick الخاص بها كما يفعل المتصفح
const choose = (r) => { fire('home-start'); const c = [...document.querySelectorAll('.rp-card')].find((x) => x.attrs.onclick.includes(`'${r}'`)); new Function(c.attrs.onclick)(); };
// الدخول الوحيد: Google. acct يربط البريد بـuid ويزرع مستند المستخدم؛ loginAs يضغط زر Google الحقيقي (نافذة Google تنجح بذلك الحساب)
const ACC = {};
const acct = (email, uid, doc) => { ACC[email] = uid; if (doc) { S.users[uid] = doc; if (doc.role === 'merchant') S.stores[uid] = {}; } };
const google = async (user, wait = 80) => { S.popupUser = user; fire('lg-google'); await sleep(wait); };
const loginAs = (email, wait = 80) => google({ uid: ACC[email] ?? 'uid-' + email, email }, wait);
const screen = () => activeScreens().join(',');
beforeEach(async () => { await fresh(); for (const k of Object.keys(ACC)) delete ACC[k]; });

test('00. الإقلاع: لا خطأ تحميل، الصفحة الرئيسية ظاهرة، شاشة التحميل مخفية، مستمع Auth واحد فقط', async () => {
  assert.equal(loadError, null); assert.equal(screen(), 'screen-entry'); assert.equal(el('loading').classes.has('hide'), true); assert.equal(S.listeners.length, 1); assert.deepEqual(errors, []);
});
test('00b. كل معالجات onclick في index.html تشير لدوال معرّفة على window (لا أزرار ميتة)', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); const SKIP = new Set(['event', 'if', 'return', 'location', 'preventDefault', 'stopPropagation']); const bad = new Set();
  for (const m of html.matchAll(/\son([a-z]+)="([^"]*)"/g)) for (const c of m[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!SKIP.has(c[1]) && typeof globalThis[c[1]] !== 'function') bad.add(c[1]);
  assert.deepEqual([...bad], []);
});

// ---- 1,2: Google ----
test('01. Google ناجح (عميل): لوحة العميل بعد قراءة users/{uid} مرة واحدة، ولا رجوع للبداية', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await google({ uid: 'u1', email: 'a@x.com' });
  assert.equal(screen(), 'screen-customer'); assert.equal(S.calls.filter((c) => c === 'getDoc users').length, 1);
  const i = screenLog.lastIndexOf('screen-login'); assert.ok(i >= 0); assert.equal(screenLog.slice(i + 1).includes('screen-entry'), false, screenLog.join('>')); assert.equal(screenLog.filter((s) => s === 'screen-customer').length, 1);
});
test('02. Google فاشل: رسالة عربية ظاهرة داخل شاشة الدخول، الزر يعود، لا انتقال', async () => {
  choose('customer');
  const cases = { 'auth/popup-closed-by-user': /إغلاق نافذة Google/, 'auth/unauthorized-domain': /من هذا الرابط/, 'auth/operation-not-allowed': /غير متاح/, 'auth/internal-error': /غير متوقع/, 'auth/network-request-failed': /الإنترنت/, 'auth/requests-from-referer-https://matlabk.github.io-are-blocked.': /إعدادات الخدمة/ };
  for (const [code, re] of Object.entries(cases)) { S.popupError = code; fire('lg-google'); await sleep(40); assert.match(el('err-msg').textContent, re, code); assert.equal(el('lg-google').disabled, false); assert.equal(screen(), 'screen-login'); }
  S.popupError = 'auth/popup-blocked'; fire('lg-google'); await sleep(40); assert.equal(el('lg-alt').hidden, false); // مسار redirect البديل يُعرض صراحة
});
test('02b. وضع التشخيص: رمز Firebase يظهر في الرسالة فقط عند DEBUG_ERRORS', async () => {
  choose('customer'); S.popupError = 'auth/internal-error'; fire('lg-google'); await sleep(40); assert.ok(!el('err-msg').textContent.includes('auth/internal-error'));
  window.DEBUG_ERRORS = true; fire('lg-google'); await sleep(40); assert.ok(el('err-msg').textContent.includes('[auth/internal-error]'));
});

// ---- Google فقط: مسارات البريد القديمة غير موجودة ولا يمكن الوصول إليها باستدعاء مباشر ----
test('03. شاشة الدخول فيها زر Google فقط: لا حقول بريد/كلمة مرور ولا نماذج ولا روابط تسجيل/استعادة', async () => {
  choose('customer'); const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(screen(), 'screen-login'); assert.ok(el('lg-google')); assert.doesNotMatch(html, /type="(email|password)"|<form\b|id="(em|su|fg)-|openSignup|openForgot|emailLogin|emailSignup|emailReset/);
  for (const id of ['em-form', 'em-email', 'em-pass', 'em-submit', 'em-forgot', 'em-signup', 'su-form', 'fg-form', 'screen-signup', 'screen-forgot']) assert.equal(el(id), undefined, id); // العناصر نفسها غير موجودة (لا إخفاء فقط)
});
test('04. استدعاء معالجات البريد القديمة مباشرة غير ممكن: غير معرّفة على window ولا تُنفَّذ أي طلبات Firebase', async () => {
  choose('customer');
  for (const fn of ['emailLogin', 'emailSignup', 'emailReset', 'openSignup', 'openForgot']) { assert.equal(typeof window[fn], 'undefined', fn); assert.throws(() => window[fn]('a@x.com'), TypeError, fn); }
  for (const m of ['signInWithEmailAndPassword', 'createUserWithEmailAndPassword', 'sendPasswordResetEmail', 'sendSignInLinkToEmail', 'signInWithEmailLink']) assert.equal(typeof (A[m]), 'undefined', m);
  assert.deepEqual(S.calls.filter((c) => /signIn|create|reset|emailLink/i.test(c)), []);
});

// ---- 5,6: حساب جديد عبر Google ----
test('05. حساب Google جديد (عميل/كابتن/تاجر): مستند واحد بالحالة الصحيحة ثم شاشة الاستكمال، بلا صلاحيات إدارية', async () => {
  for (const [role, st, scr] of [['customer', 'active', 'screen-complete-customer'], ['driver', 'incomplete', 'screen-driver-register'], ['merchant', 'incomplete', 'screen-complete-merchant']]) {
    await fresh(); const em = role + '@x.com'; choose(role); await google({ uid: 'uid-' + em, email: em }, 100);
    const w = S.writes.filter((x) => x.path === 'users/uid-' + em); assert.equal(w.length, 1, role); assert.equal(w[0].data.role, role); assert.equal(w[0].data.status, st); assert.equal('isAdmin' in w[0].data || 'approvedBy' in w[0].data, false); assert.equal(screen(), scr, role);
  }
});
test('06b. نجاح مصادقة Google وفشل حفظ الملف: لا يُبتلع الخطأ، رسالة + إعادة محاولة، والإعادة تنجح بدون مستند مكرر', async () => {
  choose('driver'); S.failWrite = true; await google({ uid: 'uid-n@x.com', email: 'n@x.com' }, 100);
  assert.equal(screen(), 'screen-login'); assert.match(el('lg-retry').hidden ? '' : el('err-msg').textContent, /تعذّر حفظ بياناته/); assert.ok(consoleErrors.some((x) => x.includes('permission-denied'))); assert.equal(S.users['uid-n@x.com'], undefined);
  S.failWrite = false; fire('lg-retry'); await sleep(80);
  assert.equal(screen(), 'screen-driver-register'); assert.equal(S.writes.filter((x) => x.path === 'users/uid-n@x.com').length, 1); assert.equal(S.users['uid-n@x.com'].role, 'driver'); assert.equal(S.users['uid-n@x.com'].status, 'incomplete');
});

// ---- 9: لا نماذج ولا إرسال أصلي ----
test('09. لا نماذج HTML في الصفحة: لا إرسال أصلي ولا كلمة مرور ولا بريد في الرابط (بعد كل سيناريو دخول)', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await loginAs('a@x.com');
  assert.deepEqual(nativeSubmits, []); const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.doesNotMatch(html, /<form\b|onsubmit=/);
});

// ---- 10,11: لا رجوع للبداية / لا تكرار توجيه ----
test('10. مستمع "مفيش مستخدم" المتأخر بعد رفض الدور لا يرجّع المستخدم للرئيسية ولا يمسح الرسالة', async () => {
  acct('a@x.com', 'u1', CUST); S.listenerDelay = 40; choose('driver'); await loginAs('a@x.com', 250);
  assert.equal(screen(), 'screen-login'); assert.match(el('err-msg').textContent, /كحساب عميل/); assert.equal(S.signOuts, 1);
});
test('10b. حدث خروج غير متوقع أثناء الدخول لا يمسح الدور المختار: حساب عميل يختار "كابتن" يُرفض ولا يدخل لوحة العميل بصمت', async () => {
  acct('a@x.com', 'u1', CUST); choose('driver'); S.netDelay = 40; S.popupUser = { uid: 'u1', email: 'a@x.com' }; fire('lg-google'); await sleep(5);
  S.listeners.forEach((l) => l(null)); // null عشوائي أثناء العملية (خروج من تاب تاني مثلًا)
  await sleep(250);
  assert.equal(screenLog.includes('screen-customer'), false, screenLog.join('>')); assert.equal(screenLog.slice(screenLog.lastIndexOf('screen-login') + 1).includes('screen-entry'), false);
  assert.match(el('err-msg').textContent, /كحساب عميل.*ككابتن/); assert.equal(S.signOuts, 1);
});
test('11. دخول واحد = قراءة users واحدة وتوجيه واحد', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await loginAs('a@x.com'); assert.equal(S.calls.filter((c) => c === 'getDoc users').length, 1);
  assert.equal(screenLog.filter((s) => s === 'screen-customer').length, 1);
});

// ---- 12,13: أدوار وحالات ----
test('12. اختلاط الأدوار عبر Google: كل التقاطعات الستة مرفوضة بلا لوحة وبالرسالة المناسبة', async () => {
  const DOC = { customer: CUST, driver: DRV, merchant: MER }; const DASH = ['screen-customer', 'screen-driver', 'screen-merchant', 'screen-admin']; let n = 0;
  for (const role of Object.keys(DOC)) for (const intent of Object.keys(DOC)) {
    if (role === intent) continue;
    await fresh(); acct('a@x.com', 'u1', DOC[role]); choose(intent); await loginAs('a@x.com');
    assert.equal(screenLog.some((s) => DASH.includes(s)), false, `${role}->${intent}: ${screenLog}`); assert.equal(S.signOuts, 1); assert.equal(S.writes.length, 0);
    assert.match(el('err-msg').textContent, /ببريد Google آخر/); n++;
  }
  assert.equal(n, 6);
});
test('13. الحالات: incomplete/pending/rejected/blocked/active تُوجَّه فعليًا ولا تُعامل كـ active', async () => {
  const T = [[{ ...DRV, status: 'incomplete' }, 'driver', 'screen-driver-register'], [{ ...DRV, status: 'pending' }, 'driver', 'screen-driver-register'], [{ ...DRV, status: 'rejected' }, 'driver', 'screen-driver-register'], [DRV, 'driver', 'screen-driver'],
    [{ ...MER, status: 'incomplete' }, 'merchant', 'screen-complete-merchant'], [{ ...MER, status: 'pending' }, 'merchant', 'screen-merchant-status'], [{ ...MER, status: 'rejected' }, 'merchant', 'screen-merchant-status'], [MER, 'merchant', 'screen-merchant'],
    [{ ...CUST, status: 'blocked' }, 'customer', 'screen-blocked'], [{ ...CUST, phone: '' }, 'customer', 'screen-complete-customer'], [CUST, 'customer', 'screen-customer']];
  for (const [doc, role, scr] of T) { await fresh(); acct('a@x.com', 'u1', doc); choose(role); await loginAs('a@x.com', 90); assert.equal(screen(), scr, `${doc.role}/${doc.status}`); }
});
test('13b. دور مفقود أو غير معروف في Firestore => رفض بلا أي لوحة (لا افتراض عميل)', async () => {
  for (const bad of [{ status: 'active', name: 'x', phone: '01012345678' }, { role: 'weird', status: 'active' }]) { await fresh(); acct('a@x.com', 'u1', bad); choose('customer'); await loginAs('a@x.com'); assert.notEqual(screen(), 'screen-customer'); assert.equal(S.signOuts, 1); assert.match(el('home-err').textContent + el('err-msg').textContent, /غير مكتملة أو غير صالحة/); }
});

// ---- 14: خروج ----
test('14. الخروج: جلسة منتهية، الرئيسية، لا اختيار عالق، ثم تسجيل دخول جديد يبدأ من اختيار النوع', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await loginAs('a@x.com'); assert.equal(screen(), 'screen-customer');
  await window.doLogout(); await sleep(30); assert.equal(screen(), 'screen-entry'); assert.equal(S.current, null); assert.equal(window.CU, null); assert.equal(window.selectedType, null);
  fire('home-start'); assert.equal(screen(), 'screen-role-pick'); // يبدأ من جديد باختيار النوع
});

// ---- مهلة العمليات المعلّقة + إعادة المحاولة بعد فشل القراءة ----
test('15. نافذة Google معلّقة: بعد المهلة يُفك الزر وتظهر رسالة (بدل التجمّد)، ويمكن المحاولة بعدها', async () => {
  window.AUTH_OP_TIMEOUT_MS = 120; acct('a@x.com', 'u1', CUST); choose('customer'); S.popupHang = true; fire('lg-google'); await sleep(40);
  assert.equal(el('lg-google').disabled, true); await sleep(200);
  assert.equal(el('lg-google').disabled, false); assert.match(el('err-msg').textContent, /أطول من المعتاد/);
  S.popupHang = false; await loginAs('a@x.com'); assert.equal(screen(), 'screen-customer');
});
test('16. فشل قراءة users بعد نجاح المصادقة: رسالة + إعادة محاولة بنفس الدور، بلا لوحة', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); S.failRead = true; await loginAs('a@x.com'); assert.notEqual(screen(), 'screen-customer'); assert.match(el('err-msg').textContent, /إعادة المحاولة/); assert.equal(el('lg-retry').hidden, false);
  S.failRead = false; fire('lg-retry'); await sleep(60); assert.equal(screen(), 'screen-customer');
});
