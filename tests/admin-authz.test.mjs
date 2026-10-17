// node --test tests/admin-authz.test.mjs
// لوحة الإدارة وقرارات الاعتماد/الرفض: يقلع التطبيق الحقيقي (js/admin.js الفعلي) مع محاكاة Firebase.
// تنبيه: الـ Rules غير مُقيَّمة هنا (لا Emulator). هذه الاختبارات تثبت منطق الواجهة/العميل فقط (البوابة، حارس الدور، تحقق الهدف داخل Transaction)؛
// الفرض الفعلي على الخادم (isAdmin() في firestore.rules) يحتاج tests/firestore.rules.test.mjs على Emulator ولم يُشغَّل.
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { S, sleep, fresh } from './boot/env.mjs';
import { activeScreens, el, fire, type, screenLog } from './boot/dom.mjs';

const ADMIN = { role: 'admin', status: 'active', name: 'Boss' };
const CUST = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const drv = (status) => ({ role: 'driver', status, fullName: 'Drv', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } });
const mer = (status) => ({ role: 'merchant', status, name: 'M' });
const choose = (r) => { fire('home-start'); const c = [...document.querySelectorAll('.rp-card')].find((x) => x.attrs.onclick.includes(`'${r}'`)); new Function(c.attrs.onclick)(); };
const screen = () => activeScreens().join(',');
const ACC = {}; // الدخول الوحيد: Google (بريد الحساب يُربط بـuid فقط ليسهل قراءة الاختبارات)
const login = async (role, email) => { choose(role); S.popupUser = { uid: ACC[email], email }; fire('lg-google'); await sleep(90); };
const acct = (email, uid, doc) => { ACC[email] = uid; S.users[uid] = doc; };
const decisionWrites = () => S.writes.filter((w) => /^(users|stores|notifications)\//.test(w.path));
const reject = async (fn, uid, reason = 'سبب تجريبي') => { window[fn](uid); type('reason-text', reason); window.confirmReasonModal(); await sleep(60); };
beforeEach(async () => { await fresh(); acct('a@x.com', 'uA', ADMIN); acct('c@x.com', 'uC', CUST); });

test('AD1. أدمن حقيقي (users/{uid}.role=admin) يدخل لوحة الإدارة من خيار "عميل" ويُحمَّل محتواها؛ الدور من Firestore لا من الاختيار', async () => {
  await login('customer', 'a@x.com'); assert.equal(screen(), 'screen-admin'); assert.equal(window.CUD.role, 'admin'); assert.ok(S.calls.includes('onSnapshot'), 'لوحة الإدارة حمّلت مستمعيها');
});
test('AD2. أدمن يختار "كابتن"/"تاجر": لا لوحة إدارة ولا لوحة دور، خروج، ورسالة لا تكشف أن الحساب إدارة', async () => {
  for (const r of ['driver', 'merchant']) { await fresh(); acct('a@x.com', 'uA', ADMIN); await login(r, 'a@x.com'); assert.equal(screenLog.includes('screen-admin'), false, r); assert.equal(S.signOuts, 1); assert.ok(!/إدارة|admin/i.test(el('err-msg').textContent), el('err-msg').textContent); assert.equal(S.calls.includes('onSnapshot'), false); }
});
test('AD3. مستخدم عادي لا يصل للوحة الإدارة بأي اختيار أو حقول ذاتية (isAdmin/admin/approved/role2) في مستنده', async () => {
  S.users.uC = { ...CUST, isAdmin: true, admin: true, approved: true, role2: 'admin', adminLevel: 9 };
  for (const r of ['customer', 'driver', 'merchant']) { await fresh(); acct('c@x.com', 'uC', S.users.uC); await login(r, 'c@x.com'); assert.equal(screenLog.includes('screen-admin'), false, r); assert.equal(S.calls.includes('onSnapshot') && screenLog.includes('screen-admin'), false); }
});
test('AD4. حارس الدفاع المتعمّق: استدعاء loadAdminData وقرارات الاعتماد من جلسة غير أدمن (Console) لا يفتح مستمعين ولا يكتب شيئًا', async () => {
  await login('customer', 'c@x.com'); assert.equal(screen(), 'screen-customer'); S.calls.length = 0; S.writes.length = 0;
  S.users.uD = drv('pending'); S.users.uM = mer('pending'); S.stores.uM = { status: 'pending' };
  await window.loadAdminData(); assert.equal(S.calls.includes('onSnapshot'), false);
  await window.admAccDrv('uD'); await window.admAccStore('uM'); await reject('admRejDrv', 'uD'); await reject('admRejStore', 'uM');
  assert.deepEqual(decisionWrites(), []); assert.equal(S.users.uD.status, 'pending'); assert.equal(S.stores.uM.status, 'pending'); assert.match(el('toast').textContent, /للإدارة فقط/);
});
test('AD5. أدمن يعتمد كابتن pending: active + approvedBy=uid الأدمن + approvedAt + إشعار + سجل تدقيق بمعرّف الهدف', async () => {
  S.users.uD = drv('pending'); await login('customer', 'a@x.com'); S.writes.length = 0;
  await window.admAccDrv('uD'); await sleep(40);
  assert.equal(S.users.uD.status, 'active'); assert.equal(S.users.uD.approvedBy, 'uA'); assert.ok(S.users.uD.approvedAt); assert.equal(S.users.uD.role, 'driver');
  assert.equal(S.writes.filter((w) => w.path.startsWith('notifications/')).length, 1);
  const audit = S.writes.find((w) => w.path === 'auditLog/new'); assert.equal(audit.data.adminId, 'uA'); assert.match(audit.data.action, /قبول كابتن/); assert.equal(audit.data.details, 'uD');
});
test('AD6. رفض كابتن pending: rejected + السبب + rejectedBy/At؛ لا يصبح active ويبقى الدور', async () => {
  S.users.uD = drv('pending'); await login('customer', 'a@x.com'); S.writes.length = 0;
  await reject('admRejDrv', 'uD', 'الرخصة منتهية');
  assert.equal(S.users.uD.status, 'rejected'); assert.equal(S.users.uD.rejectReason, 'الرخصة منتهية'); assert.equal(S.users.uD.rejectedBy, 'uA'); assert.equal(S.users.uD.role, 'driver'); assert.equal('approvedBy' in S.users.uD, false);
});
test('AD7. التحقق من الهدف: اعتماد/رفض حساب غير pending (active/incomplete/rejected/blocked/paused/deleted) أو بدور خطأ أو غير موجود => لا كتابة', async () => {
  await login('customer', 'a@x.com');
  for (const st of ['active', 'incomplete', 'rejected', 'blocked', 'paused', 'deleted']) {
    S.users.uT = drv(st); S.writes.length = 0; await window.admAccDrv('uT'); await sleep(30); assert.deepEqual(decisionWrites(), [], 'approve ' + st); assert.equal(S.users.uT.status, st); assert.match(el('toast').textContent, /تم تغيير حالة هذا الطلب/);
    await reject('admRejDrv', 'uT'); assert.deepEqual(decisionWrites(), [], 'reject ' + st); assert.equal(S.users.uT.status, st);
  }
  S.writes.length = 0; S.users.uCu = { ...CUST, status: 'pending' }; await window.admAccDrv('uCu'); assert.deepEqual(decisionWrites(), []); assert.equal(S.users.uCu.status, 'pending'); assert.match(el('toast').textContent, /ليس من نوع/); // دور خطأ
  S.users.uD = drv('pending'); await window.admAccStore('uD'); assert.deepEqual(decisionWrites().filter((w) => w.path === 'users/uD'), []); assert.equal(S.users.uD.status, 'pending'); // كابتن عبر مسار التاجر
  await window.admAccDrv('nobody'); assert.match(el('toast').textContent, /غير موجود/);
});
test('AD8. قرار التاجر ذرّي: users+stores+إشعار معًا؛ متجر مفقود أو حالته ليست pending => لا شيء يتغيّر', async () => {
  await login('customer', 'a@x.com');
  S.users.uM = mer('pending'); S.stores.uM = { status: 'pending' }; S.writes.length = 0; await window.admAccStore('uM'); await sleep(40);
  assert.equal(S.users.uM.status, 'active'); assert.equal(S.stores.uM.status, 'active'); assert.equal(S.users.uM.approvedBy, 'uA');
  S.users.uM2 = mer('pending'); delete S.stores.uM2; S.writes.length = 0; await window.admAccStore('uM2'); await sleep(30); assert.deepEqual(decisionWrites(), []); assert.equal(S.users.uM2.status, 'pending'); assert.match(el('toast').textContent, /بيانات المتجر/);
  S.users.uM3 = mer('pending'); S.stores.uM3 = { status: 'active' }; S.writes.length = 0; await reject('admRejStore', 'uM3'); assert.deepEqual(decisionWrites(), []); assert.equal(S.users.uM3.status, 'pending'); assert.equal(S.stores.uM3.status, 'active');
  S.users.uM4 = mer('pending'); S.stores.uM4 = { status: 'pending' }; await reject('admRejStore', 'uM4', 'المستندات غير واضحة'); assert.equal(S.users.uM4.status, 'rejected'); assert.equal(S.stores.uM4.status, 'rejected'); assert.equal(S.users.uM4.rejectedBy, 'uA');
});
test('AD9. الاعتماد يُحفظ بعد التحديث وإعادة الدخول: التاجر/الكابتن المعتمد يدخل لوحته، والمرفوض/المعلّق لا', async () => {
  await login('customer', 'a@x.com'); S.users.uD = drv('pending'); await window.admAccDrv('uD'); await sleep(40); await window.doLogout(); await sleep(20);
  acct('d@x.com', 'uD', S.users.uD); await login('driver', 'd@x.com'); assert.equal(screen(), 'screen-driver');
  await fresh(); acct('r@x.com', 'uR', drv('rejected')); await login('driver', 'r@x.com'); assert.equal(screen(), 'screen-driver-register'); assert.equal(screenLog.includes('screen-driver'), false);
});
test('AD10. أدمن ينتهي دوره/يُنزَّل لعميل: لا لوحة إدارة (الدور من Firestore في كل دخول)', async () => {
  S.users.uA = { ...ADMIN, role: 'customer', phone: '01012345678' }; await login('customer', 'a@x.com'); assert.equal(screenLog.includes('screen-admin'), false); assert.equal(screen(), 'screen-customer');
});
test('AD11. أدمن موقوف/محذوف (status) لا يدخل لوحة الإدارة ولا يحمّل مستمعيها؛ أدمن بلا status يدخل (يطابق isAdmin() في القواعد)', async () => {
  for (const st of ['blocked', 'deleted']) { await fresh(); acct('a@x.com', 'uA', { ...ADMIN, status: st }); await login('customer', 'a@x.com'); assert.equal(screenLog.includes('screen-admin'), false, st); assert.equal(S.calls.includes('onSnapshot'), false, st); assert.equal(screen(), 'screen-blocked', st); }
  await fresh(); acct('a@x.com', 'uA', { role: 'admin', name: 'Boss' }); await login('customer', 'a@x.com'); assert.equal(screen(), 'screen-admin');
});
