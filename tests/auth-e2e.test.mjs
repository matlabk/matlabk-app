// node --test tests/auth-e2e.test.mjs
// تشغيل كامل للتطبيق (js/main.js + كل الموديولات الحقيقية + DOM مبني من index.html الحقيقي): الضغط يتم بتنفيذ معالجات onclick/onsubmit
// الفعلية. فقط Firebase (Auth/Firestore) محاكى بنموذج يتبع ترتيب أحداث الـ SDK (tests/boot/sdk.mjs). ليس اختبارًا على Firebase الحقيقي.
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { A, S, sleep, fresh, errors, consoleErrors, loadError } from './boot/env.mjs';
import { activeScreens, el, fire, type, nativeSubmits, screenLog } from './boot/dom.mjs';
import fs from 'node:fs';

const PW = 'Passw0rd!x'; const CUST = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const DRV = { role: 'driver', status: 'active', fullName: 'Drv', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } };
const MER = { role: 'merchant', status: 'active', name: 'M' };
const pick = (r) => { fire('home-start'); const c = [...document.querySelectorAll('.rp-card')].find((x) => x.attrs.onclick.includes(`'${r}'`)); fire.call(null, c.id || '__none__'); };
// البطاقات بلا id: ننفذ onclick الخاص بها كما يفعل المتصفح
const choose = (r) => { fire('home-start'); const c = [...document.querySelectorAll('.rp-card')].find((x) => x.attrs.onclick.includes(`'${r}'`)); new Function(c.attrs.onclick)(); };
const acct = (email, uid, doc) => { S.accounts[email] = { uid, password: PW }; if (doc) { S.users[uid] = doc; if (doc.role === 'merchant') S.stores[uid] = {}; } };
const emailLogin = async (email, pw = PW, wait = 60) => { type('em-email', email); type('em-pass', pw); fire('em-form', 'submit'); await sleep(wait); };
const google = async (user, wait = 80) => { S.popupUser = user; fire('lg-google'); await sleep(wait); };
const screen = () => activeScreens().join(',');
beforeEach(async () => { await fresh(); });

test('00. الإقلاع: لا خطأ تحميل، الصفحة الرئيسية ظاهرة، شاشة التحميل مخفية، مستمع Auth واحد فقط', async () => {
  assert.equal(loadError, null); assert.equal(screen(), 'screen-entry'); assert.equal(el('loading').classes.has('hide'), true); assert.equal(S.listeners.length, 1); assert.deepEqual(errors, []);
});
test('00b. كل معالجات onclick/onsubmit في index.html تشير لدوال معرّفة على window (لا أزرار ميتة)', () => {
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
  const cases = { 'auth/popup-closed-by-user': /إغلاق نافذة Google/, 'auth/unauthorized-domain': /من هذا الرابط/, 'auth/operation-not-allowed': /غير متاح/, 'auth/internal-error': /غير متوقع/, 'auth/network-request-failed': /الإنترنت/ };
  for (const [code, re] of Object.entries(cases)) { S.popupError = code; fire('lg-google'); await sleep(40); assert.match(el('err-msg').textContent, re, code); assert.equal(el('lg-google').disabled, false); assert.equal(screen(), 'screen-login'); }
  S.popupError = 'auth/popup-blocked'; fire('lg-google'); await sleep(40); assert.equal(el('lg-alt').hidden, false); // مسار redirect البديل يُعرض صراحة
});
test('02b. وضع التشخيص: رمز Firebase يظهر في الرسالة فقط عند DEBUG_ERRORS', async () => {
  choose('customer'); S.popupError = 'auth/internal-error'; fire('lg-google'); await sleep(40); assert.ok(!el('err-msg').textContent.includes('auth/internal-error'));
  window.DEBUG_ERRORS = true; fire('lg-google'); await sleep(40); assert.ok(el('err-msg').textContent.includes('[auth/internal-error]'));
});

// ---- 3,4: بريد ----
test('03. بريد وكلمة مرور صحيحان => لوحة العميل بلا رجوع للبداية ولا تكرار توجيه', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await emailLogin('a@x.com');
  assert.equal(screen(), 'screen-customer'); assert.equal(nativeSubmits.length, 0); assert.equal(S.calls.filter((c) => c === 'getDoc users').length, 1);
  assert.equal(screenLog.slice(screenLog.lastIndexOf('screen-login') + 1).includes('screen-entry'), false); assert.equal(screenLog.filter((s) => s === 'screen-customer').length, 1);
});
test('04. كلمة مرور خاطئة: رسالة موحدة، تبقى شاشة الدخول، لا لوحة، الحقول والأزرار سليمة', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await emailLogin('a@x.com', 'wrong-pw!');
  assert.match(el('err-msg').textContent, /غير صحيحة/); assert.equal(screen(), 'screen-login'); assert.equal(el('em-pass').value, ''); assert.equal(el('em-submit').disabled, false); assert.equal(S.calls.includes('getDoc users'), false);
});

// ---- 5,6: إنشاء حساب ----
test('05. إنشاء حساب جديد (عميل/كابتن/تاجر): مستند واحد بالحالة الصحيحة ثم شاشة الاستكمال، بلا صلاحيات إدارية', async () => {
  for (const [role, st, scr] of [['customer', 'active', 'screen-complete-customer'], ['driver', 'incomplete', 'screen-driver-register'], ['merchant', 'incomplete', 'screen-complete-merchant']]) {
    await fresh(); const em = role + '@x.com'; choose(role); fire('em-signup'); type('su-email', em); type('su-pass', PW); type('su-pass2', PW); fire('su-form', 'submit'); await sleep(80);
    const w = S.writes.filter((x) => x.path === 'users/uid-' + em); assert.equal(w.length, 1, role); assert.equal(w[0].data.role, role); assert.equal(w[0].data.status, st); assert.equal('isAdmin' in w[0].data || 'approvedBy' in w[0].data, false); assert.equal(screen(), scr, role);
  }
});
test('06. تسجيل بمدخلات غير صالحة/بريد مستخدم: رسائل واضحة داخل شاشة التسجيل بدون طلب شبكة (عدا المستخدم)', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); fire('em-signup'); const go = async (e, p, c) => { type('su-email', e); type('su-pass', p); type('su-pass2', c); fire('su-form', 'submit'); await sleep(40); return el('su-err').textContent; };
  assert.match(await go('bad', PW, PW), /صيغة البريد/); assert.match(await go('n@x.com', 'short', 'short'), /8 أحرف/); assert.match(await go('n@x.com', PW, PW + '1'), /غير متطابقتين/); assert.equal(S.calls.filter((c) => c === 'create').length, 0);
  assert.match(await go('a@x.com', PW, PW), /مسجّل بالفعل/); assert.equal(S.writes.length, 0); assert.equal(screen(), 'screen-signup'); assert.equal(el('su-submit').disabled, false);
});
test('06b. نجاح إنشاء حساب Firebase وفشل حفظ الملف: لا يُبتلع الخطأ، رسالة + إعادة محاولة، والإعادة تنجح بدون مستند مكرر', async () => {
  choose('driver'); fire('em-signup'); type('su-email', 'n@x.com'); type('su-pass', PW); type('su-pass2', PW); S.failWrite = true; fire('su-form', 'submit'); await sleep(80);
  assert.equal(screen(), 'screen-login'); assert.match(el('lg-retry').hidden ? '' : el('err-msg').textContent, /تعذّر حفظ بياناته/); assert.ok(consoleErrors.some((x) => x.includes('permission-denied'))); assert.equal(S.users['uid-n@x.com'], undefined);
  S.failWrite = false; fire('lg-retry'); await sleep(80);
  assert.equal(screen(), 'screen-driver-register'); assert.equal(S.writes.filter((x) => x.path === 'users/uid-n@x.com').length, 1); assert.equal(S.users['uid-n@x.com'].role, 'driver'); assert.equal(S.users['uid-n@x.com'].status, 'incomplete');
});

// ---- 7,8: استعادة ----
test('07. استعادة كلمة المرور: رد محايد (مسجّل وغير مسجّل) ويبقى المستخدم في شاشة الاستعادة', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); fire('em-forgot'); assert.equal(screen(), 'screen-forgot');
  for (const e of ['a@x.com', 'nobody@x.com']) { type('fg-email', e); fire('fg-form', 'submit'); await sleep(40); assert.match(el('fg-ok').textContent, /إذا كان هذا البريد مسجّلًا/); assert.equal(el('fg-err').textContent, ''); assert.equal(screen(), 'screen-forgot'); }
  assert.equal(nativeSubmits.length, 0);
});
test('08. فشل الاستعادة: بريد غير صالح/محاولات كثيرة/انقطاع => رسالة مناسبة، بلا نجاح زائف', async () => {
  choose('customer'); fire('em-forgot'); type('fg-email', 'bad'); fire('fg-form', 'submit'); await sleep(20); assert.match(el('fg-err').textContent, /صيغة البريد/); assert.equal(S.calls.includes('reset'), false);
  type('fg-email', 'a@x.com'); S.resetError = 'auth/too-many-requests'; fire('fg-form', 'submit'); await sleep(40); assert.match(el('fg-err').textContent, /محاولات كثيرة/); assert.equal(el('fg-ok').textContent, '');
  S.resetError = 'auth/network-request-failed'; fire('fg-form', 'submit'); await sleep(40); assert.match(el('fg-err').textContent, /الإنترنت/);
});

// ---- 9: لا إعادة تحميل غير مقصودة ----
test('09. إرسال النماذج لا يسبب إعادة تحميل حتى لو المعالج غير معرّف (كلمة المرور لا تظهر في الرابط)', async () => {
  choose('customer'); type('em-email', 'a@x.com'); type('em-pass', PW);
  for (const [form, fn] of [['em-form', 'emailLogin'], ['su-form', 'emailSignup'], ['fg-form', 'emailReset']]) { const keep = globalThis[fn]; delete globalThis[fn]; fire(form, 'submit'); globalThis[fn] = keep; }
  assert.deepEqual(nativeSubmits, []);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.match(html, /addEventListener\('submit'[\s\S]{0,160}classList\.contains\('em-form'\)[\s\S]{0,60}preventDefault\(\)/); // حارس يعمل حتى لو فشلت الوحدات
});

// ---- 10,11: لا رجوع للبداية / لا تكرار توجيه ----
test('10. مستمع "مفيش مستخدم" المتأخر بعد رفض الدور لا يرجّع المستخدم للرئيسية ولا يمسح الرسالة', async () => {
  acct('a@x.com', 'u1', CUST); S.listenerDelay = 40; choose('driver'); await emailLogin('a@x.com', PW, 250);
  assert.equal(screen(), 'screen-login'); assert.match(el('err-msg').textContent, /كحساب عميل/); assert.equal(S.signOuts, 1);
});
test('10b. حدث خروج غير متوقع أثناء الدخول لا يمسح الدور المختار: حساب عميل يختار "كابتن" يُرفض ولا يدخل لوحة العميل بصمت', async () => {
  acct('a@x.com', 'u1', CUST); choose('driver'); S.netDelay = 40; type('em-email', 'a@x.com'); type('em-pass', PW); fire('em-form', 'submit'); await sleep(5);
  S.listeners.forEach((l) => l(null)); // null عشوائي أثناء العملية (خروج من تاب تاني مثلًا)
  await sleep(250);
  assert.equal(screenLog.includes('screen-customer'), false, screenLog.join('>')); assert.equal(screenLog.slice(screenLog.lastIndexOf('screen-login') + 1).includes('screen-entry'), false);
  assert.match(el('err-msg').textContent, /كحساب عميل.*ككابتن/); assert.equal(S.signOuts, 1);
});
test('11. دخول واحد = قراءة users واحدة وتوجيه واحد، وكذلك استعادة جلسة', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await emailLogin('a@x.com'); assert.equal(S.calls.filter((c) => c === 'getDoc users').length, 1);
  assert.equal(screenLog.filter((s) => s === 'screen-customer').length, 1);
});

// ---- 12,13: أدوار وحالات ----
test('12. اختلاط الأدوار عبر Google والبريد: كل التقاطعات مرفوضة بلا لوحة، وبالرسالة المناسبة لكل طريقة', async () => {
  const DOC = { customer: CUST, driver: DRV, merchant: MER }; const DASH = ['screen-customer', 'screen-driver', 'screen-merchant', 'screen-admin']; let n = 0;
  for (const role of Object.keys(DOC)) for (const intent of Object.keys(DOC)) {
    if (role === intent) continue;
    for (const via of ['google', 'email']) {
      await fresh(); acct('a@x.com', 'u1', DOC[role]); choose(intent);
      if (via === 'google') await google({ uid: 'u1', email: 'a@x.com' }); else await emailLogin('a@x.com');
      assert.equal(DASH.includes(screenLog.at(-1)) || screenLog.some((s) => DASH.includes(s)), false, `${role}->${intent} via ${via}: ${screenLog}`); assert.equal(S.signOuts, 1); assert.equal(S.writes.length, 0);
      assert.match(el('err-msg').textContent, new RegExp(via === 'google' ? 'ببريد Google آخر' : 'ببريد إلكتروني آخر')); n++;
    }
  }
  assert.equal(n, 12);
});
test('13. الحالات: incomplete/pending/rejected/blocked/active تُوجَّه فعليًا ولا تُعامل كـ active', async () => {
  const T = [[{ ...DRV, status: 'incomplete' }, 'driver', 'screen-driver-register'], [{ ...DRV, status: 'pending' }, 'driver', 'screen-driver-register'], [{ ...DRV, status: 'rejected' }, 'driver', 'screen-driver-register'], [DRV, 'driver', 'screen-driver'],
    [{ ...MER, status: 'incomplete' }, 'merchant', 'screen-complete-merchant'], [{ ...MER, status: 'pending' }, 'merchant', 'screen-merchant-status'], [{ ...MER, status: 'rejected' }, 'merchant', 'screen-merchant-status'], [MER, 'merchant', 'screen-merchant'],
    [{ ...CUST, status: 'blocked' }, 'customer', 'screen-blocked'], [{ ...CUST, phone: '' }, 'customer', 'screen-complete-customer'], [CUST, 'customer', 'screen-customer']];
  for (const [doc, role, scr] of T) { await fresh(); acct('a@x.com', 'u1', doc); choose(role); await emailLogin('a@x.com', PW, 90); assert.equal(screen(), scr, `${doc.role}/${doc.status}`); }
});
test('13b. دور مفقود أو غير معروف في Firestore => رفض بلا أي لوحة (لا افتراض عميل)', async () => {
  for (const bad of [{ status: 'active', name: 'x', phone: '01012345678' }, { role: 'weird', status: 'active' }]) { await fresh(); acct('a@x.com', 'u1', bad); choose('customer'); await emailLogin('a@x.com'); assert.notEqual(screen(), 'screen-customer'); assert.equal(S.signOuts, 1); assert.match(el('home-err').textContent + el('err-msg').textContent, /غير مكتملة أو غير صالحة/); }
});

// ---- 14: خروج ----
test('14. الخروج: جلسة منتهية، الرئيسية، لا اختيار عالق، ثم تسجيل دخول جديد يبدأ من اختيار النوع', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); await emailLogin('a@x.com'); assert.equal(screen(), 'screen-customer');
  await window.doLogout(); await sleep(30); assert.equal(screen(), 'screen-entry'); assert.equal(S.current, null); assert.equal(window.CU, null); assert.equal(window.selectedType, null); assert.equal(el('em-email').value, ''); assert.equal(el('em-pass').value, '');
  fire('home-start'); assert.equal(screen(), 'screen-role-pick'); // يبدأ من جديد باختيار النوع
});

// ---- مهلة العمليات المعلّقة + إعادة المحاولة بعد فشل القراءة ----
test('15. نافذة Google معلّقة: بعد المهلة تُفك الأزرار وتظهر رسالة (بدل تجمّد كل الأزرار)، ويمكن الدخول بالبريد بعدها', async () => {
  window.AUTH_OP_TIMEOUT_MS = 120; acct('a@x.com', 'u1', CUST); choose('customer'); S.popupHang = true; fire('lg-google'); await sleep(40);
  assert.equal(el('lg-google').disabled && el('em-submit').disabled, true); await sleep(200);
  assert.equal(el('lg-google').disabled || el('em-submit').disabled, false); assert.match(el('err-msg').textContent, /أطول من المعتاد/);
  await emailLogin('a@x.com'); assert.equal(screen(), 'screen-customer');
});
test('16. فشل قراءة users بعد نجاح المصادقة: رسالة + إعادة محاولة بنفس الدور، بلا لوحة', async () => {
  acct('a@x.com', 'u1', CUST); choose('customer'); S.failRead = true; await emailLogin('a@x.com'); assert.notEqual(screen(), 'screen-customer'); assert.match(el('err-msg').textContent, /إعادة المحاولة/); assert.equal(el('lg-retry').hidden, false);
  S.failRead = false; fire('lg-retry'); await sleep(60); assert.equal(screen(), 'screen-customer');
});
