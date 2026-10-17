// node --test tests/admin-client-rules.test.mjs
// يربط كود الإدارة الحقيقي (js/admin.js) بقواعد firestore.rules عبر المفسّر المحلي: نشغّل admAccDrv/admRejDrv/admAccStore/admRejStore فعليًا (Firebase مُحاكى)،
// نلتقط الكتابات التي يرسلها العميل، ثم نعيد تنفيذها نفسها كأدمن حقيقي على القواعد (مفسّر محلي، ليس Emulator Google) ونتأكد أنها تُقبل، وأن أي تعديل ضار عليها يُرفض.
// الغاية: كشف أي عدم توافق بين حمولة العميل وشروط القواعد (approvedBy/approvedAt/serverTimestamp/المتجر الذرّي).
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { S, sleep, fresh } from './boot/env.mjs';
import { fire, type, activeScreens } from './boot/dom.mjs';
import { initializeTestEnvironment, assertFails, assertSucceeds, doc, setDoc, getDoc, runTransaction, addDoc, collection, serverTimestamp } from './rules-sim/shim.mjs';

const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const ADMIN = { role: 'admin', status: 'active', name: 'Boss' };
const drv = (status) => ({ role: 'driver', status, fullName: 'Drv', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' } });
const mer = (status) => ({ role: 'merchant', status, storeName: 'M' });
const choose = (r) => { fire('home-start'); const c = [...document.querySelectorAll('.rp-card')].find((x) => x.attrs.onclick.includes(`'${r}'`)); new Function(c.attrs.onclick)(); };
const unTS = (v) => (v === 'TS' ? serverTimestamp() : Array.isArray(v) ? v.map(unTS) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unTS(x)])) : v);
beforeEach(async () => { await fresh(); });

async function runApp(seed, act) { // يشغّل واجهة الإدارة الحقيقية ويرجع ما كتبته
  S.users.uA = ADMIN; S.users.uD = drv('pending'); S.users.uM = mer('pending'); S.stores.uM = { status: 'pending', storeName: 'M' };
  choose('customer'); S.popupUser = { uid: 'uA', email: 'a@x.com' }; fire('lg-google'); await sleep(90); assert.equal(activeScreens().join(','), 'screen-admin');
  S.writes.length = 0; await act(); await sleep(60); return S.writes.map((w) => ({ ...w, data: unTS(w.data) }));
}
async function rulesEnv() {
  const env = await initializeTestEnvironment({ firestore: { rules: RULES } });
  await env.withSecurityRulesDisabled(async (c) => { const d = c.firestore(); await setDoc(doc(d, 'users', 'uA'), ADMIN); await setDoc(doc(d, 'users', 'uD'), drv('pending')); await setDoc(doc(d, 'users', 'uM'), mer('pending')); await setDoc(doc(d, 'stores', 'uM'), { status: 'pending', storeName: 'M' }); });
  return env;
}
const replay = (db, writes) => runTransaction(db, async (tx) => { for (const w of writes.filter((x) => !x.add)) { const [c, id] = w.path.split('/'); const ref = id === 'new' ? doc(collection(db, c)) : doc(db, c, id); if (w.update) tx.update(ref, w.data); else tx.set(ref, w.data); } });
const dumpUser = async (env, id) => env.withSecurityRulesDisabled(async (c) => (await getDoc(doc(c.firestore(), 'users', id))).data());

test('AR1. اعتماد كابتن من واجهة الإدارة الحقيقية: الكتابات تُقبل في القواعد وتنتج active مع approvedBy الأدمن', async () => {
  const w = await runApp(null, () => window.admAccDrv('uD')); assert.ok(w.some((x) => x.path === 'users/uD' && x.data.status === 'active')); assert.ok(w.some((x) => x.path.startsWith('notifications/')));
  const env = await rulesEnv(); await assertSucceeds(replay(env.authenticatedContext('uA').firestore(), w)); const u = await dumpUser(env, 'uD'); assert.equal(u.status, 'active'); assert.equal(u.approvedBy, 'uA'); assert.equal(u.role, 'driver');
});
test('AR2. رفض كابتن بسبب: نفس الشيء مع rejectedBy/rejectReason', async () => {
  const w = await runApp(null, async () => { window.admRejDrv('uD'); type('reason-text', 'الرخصة منتهية'); window.confirmReasonModal(); });
  const env = await rulesEnv(); await assertSucceeds(replay(env.authenticatedContext('uA').firestore(), w)); const u = await dumpUser(env, 'uD'); assert.equal(u.status, 'rejected'); assert.equal(u.rejectedBy, 'uA'); assert.equal(u.rejectReason, 'الرخصة منتهية');
});
test('AR3. اعتماد تاجر ورفضه: users+stores في معاملة واحدة تُقبل بالقواعد (الاتساق الذرّي)', async () => {
  const w = await runApp(null, () => window.admAccStore('uM')); assert.ok(w.some((x) => x.path === 'stores/uM' && x.data.status === 'active'));
  const env = await rulesEnv(); await assertSucceeds(replay(env.authenticatedContext('uA').firestore(), w)); assert.equal((await dumpUser(env, 'uM')).status, 'active');
  await fresh(); const w2 = await runApp(null, async () => { window.admRejStore('uM'); type('reason-text', 'بيانات ناقصة'); window.confirmReasonModal(); });
  const env2 = await rulesEnv(); await assertSucceeds(replay(env2.authenticatedContext('uA').firestore(), w2)); assert.equal((await dumpUser(env2, 'uM')).status, 'rejected');
});
test('AR4. سجل التدقيق الذي يكتبه التطبيق يُقبل (adminId=uid، createdAt=serverTimestamp، حقول محددة)', async () => {
  await runApp(null, () => window.admAccDrv('uD')); const audit = S.writes.find((x) => x.path === 'auditLog/new'); assert.ok(audit, 'يُكتب سجل تدقيق'); const env = await rulesEnv();
  await assertSucceeds(addDoc(collection(env.authenticatedContext('uA').firestore(), 'auditLog'), unTS(audit.data)));
  await assertFails(addDoc(collection(env.authenticatedContext('uA').firestore(), 'auditLog'), { ...unTS(audit.data), adminId: 'someoneElse' })); // انتحال
});
test('AR5. نفس كتابات العميل بعد تعديلها ضارًّا تُرفض: هوية معتمِد مزوّرة، متجر منفصل، حالة خاطئة، وقت من العميل', async () => {
  const w = await runApp(null, () => window.admAccStore('uM')); const env = await rulesEnv(); const db = () => env.authenticatedContext('uA').firestore();
  const tamper = (f) => w.map((x) => f({ ...x, data: { ...x.data } }));
  await assertFails(replay(db(), tamper((x) => { if (x.path === 'users/uM') x.data.approvedBy = 'forged'; return x; })));
  await assertFails(replay(db(), tamper((x) => { if (x.path === 'users/uM') x.data.approvedAt = new Date(0).getTime(); return x; })));
  await assertFails(replay(db(), w.filter((x) => x.path !== 'stores/uM'))); // بلا تحديث المتجر
  await assertFails(replay(db(), tamper((x) => { if (x.path === 'stores/uM') x.data.status = 'rejected'; return x; })));
  await assertFails(replay(db(), tamper((x) => { if (x.path === 'users/uM') delete x.data.approvedBy; return x; })));
  assert.equal((await dumpUser(env, 'uM')).status, 'pending'); // لا شيء تسرّب
});
