// اختبارات تشديد القواعد (HARDENING-2026): نفس واجهة firestore.rules.test.mjs، فتعمل على Firestore Emulator الحقيقي:
//   cd tests && npm i && npm test
// وعلى المفسّر المحلي (ليس Emulator Google): node --import ./rules-sim/register.mjs --test firestore.rules.hardening.test.mjs
import { test, before, beforeEach, after } from 'node:test';
import fs from 'node:fs'; import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, Timestamp, setLogLevel } from 'firebase/firestore';
setLogLevel('error');
let env;
const full = (id, o = {}) => ({ role: 'driver', status: 'pending', fullName: 'Name ' + id, phone: '01012345678', nationalId: '12345678901234', vehicleType: 'moto', docsSubmitted: true, docs: { id: 'x' }, ...o });
before(async () => { env = await initializeTestEnvironment({ projectId: 'go-elmanayef', firestore: { rules: fs.readFileSync(process.env.RULES_PATH || '../firestore.rules', 'utf8') } }); });
after(() => env.cleanup());
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const dump = async (path) => env.withSecurityRulesDisabled(async (c) => { const [a, b] = path.split('/'); const s = await getDoc(doc(c.firestore(), a, b)); return s.exists() ? s.data() : undefined; });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore(); const u = (id, x) => setDoc(doc(d, 'users', id), x); const st = (id, x) => setDoc(doc(d, 'stores', id), x);
    await u('admin', { role: 'admin', status: 'active', name: 'Boss' }); await u('admin2', { role: 'admin', status: 'active' }); await u('adminBlocked', { role: 'admin', status: 'blocked' }); await u('adminNoStatus', { role: 'admin' });
    await u('custA', { role: 'customer', status: 'active', name: 'Cust A', phone: '01001234567' });
    await u('drvP', full('drvP')); await u('drvA', full('drvA', { status: 'active' })); await u('drvR', full('drvR', { status: 'rejected' })); await u('drvI', { role: 'driver', status: 'incomplete' }); await u('drvB', full('drvB', { status: 'blocked' }));
    await u('merP', { role: 'merchant', status: 'pending', storeName: 'S', storePhone: '0101' }); await st('merP', { status: 'pending', storeName: 'Pending Store', storePhone: '01011112222' });
    await u('merA', { role: 'merchant', status: 'active' }); await st('merA', { status: 'active', storeName: 'Active Store', isOpen: true });
    await u('merR', { role: 'merchant', status: 'rejected' }); await st('merR', { status: 'rejected', storeName: 'Rej Store' });
    await u('merI', { role: 'merchant', status: 'incomplete' }); await st('merI', { status: 'incomplete', storeName: 'Inc Store' });
  });
});
const approve = (uid) => ({ status: 'active', approvedBy: uid, approvedAt: serverTimestamp() });
const reject = (uid) => ({ status: 'rejected', rejectedBy: uid, rejectedAt: serverTimestamp(), rejectReason: 'x', rejectionReason: 'x' });

// ---------- الأدمن لا يغيّر الأدوار ----------
test('H1. الأدمن لا يستطيع تغيير role لأي مستند (ترقية/تخفيض/أدمن آخر) لكنه يكتب الحقول المشروعة', async () => {
  for (const [uid, role] of [['custA', 'admin'], ['drvA', 'customer'], ['admin2', 'customer'], ['merA', 'admin'], ['admin', 'driver']]) await assertFails(updateDoc(doc(as('admin'), 'users', uid), { role }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'custA'), { status: 'blocked' })); await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'custA'), { points: 40 }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvA'), { status: 'paused' })); await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvA'), { status: 'active' }));
});
test('H2. أدمن موقوف/محذوف يفقد كل صلاحيات الأدمن؛ أدمن بلا status محفوظ (توافق)', async () => {
  for (const a of ['adminBlocked']) { await assertFails(getDoc(doc(as(a), 'users', 'custA'))); await assertFails(updateDoc(doc(as(a), 'users', 'custA'), { status: 'blocked' })); await assertFails(setDoc(doc(as(a), 'settings', 'x'), { v: 1 })); await assertFails(getDoc(doc(as(a), 'stores', 'merP'))); }
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'users', 'adminBlocked'), { status: 'deleted' })); await assertFails(getDoc(doc(as('adminBlocked'), 'users', 'custA')));
  await assertSucceeds(getDoc(doc(as('adminNoStatus'), 'users', 'custA'))); await assertSucceeds(getDoc(doc(as('admin'), 'users', 'custA')));
});
// ---------- الاعتماد ----------
test('H3. اعتماد كابتن: بهوية الأدمن ووقت الخادم ومن pending فقط؛ التزوير والحالات الأخرى مرفوضة', async () => {
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'active', approvedBy: 'someoneElse', approvedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'active', approvedBy: 'admin', approvedAt: Timestamp.fromMillis(1000) }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'active', approvedBy: 'admin' })); // بدون approvedAt الخادم
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { approvedBy: 'admin', approvedAt: serverTimestamp() })); // بدون انتقال active
  for (const id of ['drvA', 'drvR', 'drvI', 'drvB']) await assertFails(updateDoc(doc(as('admin'), 'users', id), approve('admin'))); // ليس pending
  await assertFails(updateDoc(doc(as('admin'), 'users', 'custA'), approve('admin'))); // دور عميل
  await assertFails(updateDoc(doc(as('admin'), 'users', 'admin2'), approve('admin'))); // دور أدمن
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvP'), approve('admin')));
  const d = await dump('users/drvP'); assert.equal(d.status, 'active'); assert.equal(d.approvedBy, 'admin'); assert.equal(d.role, 'driver');
});
test('H4. رفض كابتن: rejectedBy بهوية الأدمن ووقت الخادم ومن pending فقط', async () => {
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { ...reject('admin'), rejectedBy: 'forged' }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { ...reject('admin'), rejectedAt: Timestamp.fromMillis(5) }));
  for (const id of ['drvA', 'drvR', 'drvI', 'drvB']) await assertFails(updateDoc(doc(as('admin'), 'users', id), reject('admin')));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { ...reject('admin'), status: 'active' })); // رفض بحالة active
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvP'), reject('admin')));
});
test('H5. اعتماد/رفض التاجر ذرّي ومتسق: users + stores في دفعة واحدة بنفس الحالة، وغير ذلك مرفوض', async () => {
  const b0 = writeBatch(as('admin')); b0.update(doc(as('admin'), 'users', 'merP'), approve('admin')); await assertFails(b0.commit());                 // users فقط
  assert.equal((await dump('users/merP')).status, 'pending');
  const b1 = writeBatch(as('admin')); b1.update(doc(as('admin'), 'users', 'merP'), approve('admin')); b1.update(doc(as('admin'), 'stores', 'merP'), { status: 'rejected' }); await assertFails(b1.commit()); // متجر بحالة مخالفة
  const b2 = writeBatch(as('admin')); b2.update(doc(as('admin'), 'users', 'merP'), reject('admin')); b2.update(doc(as('admin'), 'stores', 'merP'), { status: 'active' }); await assertFails(b2.commit());
  const b3 = writeBatch(as('admin')); b3.update(doc(as('admin'), 'users', 'merP'), approve('admin')); b3.update(doc(as('admin'), 'stores', 'merP'), { status: 'active' }); await assertSucceeds(b3.commit());
  assert.equal((await dump('users/merP')).status, 'active'); assert.equal((await dump('stores/merP')).status, 'active');
  const b4 = writeBatch(as('admin')); b4.update(doc(as('admin'), 'users', 'merA'), reject('admin')); b4.update(doc(as('admin'), 'stores', 'merA'), { status: 'rejected' }); await assertFails(b4.commit()); // merA ليس pending
});
test('H6. رفض التاجر pending مع متجر rejected ينجح، ولا شيء يتسرّب عند فشل الدفعة', async () => {
  const b = writeBatch(as('admin')); b.update(doc(as('admin'), 'users', 'merP'), reject('admin')); b.update(doc(as('admin'), 'stores', 'merP'), { status: 'rejected' }); await assertSucceeds(b.commit());
  assert.equal((await dump('users/merP')).status, 'rejected'); assert.equal((await dump('stores/merP')).status, 'rejected');
  const bad = writeBatch(as('admin')); bad.update(doc(as('admin'), 'users', 'drvP'), approve('admin')); bad.update(doc(as('admin'), 'users', 'drvA'), approve('admin')); await assertFails(bad.commit());
  assert.equal((await dump('users/drvP')).status, 'pending', 'تحديث جزئي لم يتسرّب');
});
test('H7. لا اعتماد ذاتي ولا تزوير من غير الأدمن (عميل/كابتن/تاجر)، ولا تغيير للدور', async () => {
  for (const uid of ['custA', 'drvP', 'merP', 'drvA']) { await assertFails(updateDoc(doc(as(uid), 'users', uid), approve(uid))); await assertFails(updateDoc(doc(as(uid), 'users', uid), { role: 'admin' })); await assertFails(updateDoc(doc(as(uid), 'users', uid), { approvedBy: uid })); }
  await assertFails(updateDoc(doc(as('drvP'), 'users', 'drvA'), approve('drvP'))); // اعتماد حساب آخر
});
// ---------- auditLog ----------
test('H8. سجل التدقيق: الفاعل = الأدمن الحالي ووقت الخادم وحقول محددة؛ التزوير مرفوض؛ لا قراءة لغير الأدمن؛ لا تعديل/حذف', async () => {
  const ok = { adminId: 'admin', adminName: 'Boss', action: 'قبول كابتن', details: 'drvP', createdAt: serverTimestamp() };
  await assertSucceeds(addDoc(collection(as('admin'), 'auditLog'), ok));
  await assertFails(addDoc(collection(as('admin'), 'auditLog'), { ...ok, adminId: 'admin2' }));                       // انتحال هوية
  await assertFails(addDoc(collection(as('admin'), 'auditLog'), { ...ok, createdAt: Timestamp.fromMillis(1) }));       // وقت من العميل
  await assertFails(addDoc(collection(as('admin'), 'auditLog'), { ...ok, extra: 'x' }));                              // حقل زائد
  await assertFails(addDoc(collection(as('admin'), 'auditLog'), { adminId: 'admin', createdAt: serverTimestamp() }));  // action مفقود
  await assertFails(addDoc(collection(as('admin'), 'auditLog'), { ...ok, action: 'x'.repeat(301) }));
  await assertFails(addDoc(collection(as('admin'), 'auditLog'), { ...ok, details: 5 }));
  for (const u of ['custA', 'drvA', 'merA', 'adminBlocked']) { await assertFails(addDoc(collection(as(u), 'auditLog'), ok)); await assertFails(getDocs(collection(as(u), 'auditLog'))); }
  await assertFails(addDoc(collection(anon(), 'auditLog'), ok));
  const r = await addDoc(collection(as('admin'), 'auditLog'), ok); await assertFails(updateDoc(doc(as('admin'), 'auditLog', r.path.split('/')[1]), { action: 'y' })); await assertFails(deleteDoc(doc(as('admin'), 'auditLog', r.path.split('/')[1])));
  await assertSucceeds(getDocs(collection(as('admin'), 'auditLog')));
});
// ---------- المتاجر ----------
test('H9. المتاجر: التصفح العام لـ active يعمل؛ pending/rejected/incomplete لا تُقرأ إلا للمالك والأدمن', async () => {
  await assertSucceeds(getDoc(doc(as('custA'), 'stores', 'merA')));
  for (const id of ['merP', 'merR', 'merI']) { await assertFails(getDoc(doc(as('custA'), 'stores', id))); await assertFails(getDoc(doc(as('drvA'), 'stores', id))); await assertFails(getDoc(doc(as('merA'), 'stores', id))); await assertFails(getDoc(doc(anon(), 'stores', id))); await assertSucceeds(getDoc(doc(as(id), 'stores', id))); await assertSucceeds(getDoc(doc(as('admin'), 'stores', id))); }
  await assertSucceeds(getDocs(query(collection(as('custA'), 'stores'), where('status', '==', 'active')))); // استعلام العميل الفعلي (customer.js)
  await assertFails(getDocs(collection(as('custA'), 'stores'))); // بلا قيد
  await assertFails(getDocs(query(collection(as('custA'), 'stores'), where('status', '==', 'pending'))));
  await assertSucceeds(getDocs(collection(as('admin'), 'stores')));
  await assertFails(getDoc(doc(anon(), 'stores', 'merA')));
});
// ---------- سلامة ما كان يعمل ----------
test('H10. مسارات مشروعة بلا تغيير: تحديث العميل لملفه، إنشاء حساب بحدود الدور، إعادة تقديم الكابتن المرفوض', async () => {
  await assertSucceeds(updateDoc(doc(as('custA'), 'users', 'custA'), { name: 'New', phone: '01099999999', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('custA'), 'users', 'custA'), { status: 'blocked' }));
  await assertSucceeds(setDoc(doc(as('newC'), 'users', 'newC'), { name: 'n', email: 'n@x.com', phone: '', role: 'customer', points: 0, photoURL: '', status: 'active', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('newA'), 'users', 'newA'), { name: 'n', role: 'admin', status: 'active', points: 0, createdAt: serverTimestamp() }));
  for (const [k, v] of [['points', 500], ['isOnline', true], ['activeOrderId', 'o1'], ['activeRideId', 'r1'], ['approvedBy', 'x'], ['rejectedAt', serverTimestamp()]]) await assertFails(setDoc(doc(as('newP'), 'users', 'newP'), { name: 'n', role: 'customer', status: 'active', createdAt: serverTimestamp(), [k]: v })); // حقول مميزة وقت الإنشاء
  await assertFails(setDoc(doc(as('newA2'), 'users', 'newA2'), { name: 'n', role: 'admin', status: 'incomplete', points: 0, createdAt: serverTimestamp() })); // admin بحالة incomplete
  await assertFails(setDoc(doc(as('newA3'), 'users', 'newA3'), { name: 'n', role: 'superuser', status: 'incomplete', points: 0, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('newD'), 'users', 'newD'), { name: 'n', role: 'driver', status: 'active', points: 0, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('newE'), 'users', 'someoneElse'), { name: 'n', role: 'customer', status: 'active', points: 0, createdAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('drvR'), 'users', 'drvR'), { status: 'pending', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('merA'), 'stores', 'merA'), { isOpen: false, updatedAt: serverTimestamp() }));
});
test('H11. المسجّل غير الدخول لا يقرأ البيانات المحمية، والعميل لا يقرأ ملفات الآخرين', async () => {
  for (const [c, id] of [['users', 'custA'], ['users', 'admin'], ['stores', 'merA']]) await assertFails(getDoc(doc(anon(), c, id)));
  await assertFails(getDoc(doc(as('custA'), 'users', 'drvA'))); await assertFails(getDoc(doc(as('custA'), 'users', 'admin'))); await assertSucceeds(getDoc(doc(as('custA'), 'users', 'custA')));
});

// =====================================================================================================
// HARDENING-2026b: التفاف على الاعتماد (تحديث status مباشر بلا حقول الاعتماد، بلا متجر، من حالات أخرى، عبر مسارات بديلة)
// =====================================================================================================
const runTx = (db, fn) => import('firebase/firestore').then((m) => m.runTransaction(db, fn));
test('H12. لا اعتماد بتحديث status مباشر: pending لا يخرج إلا بالاعتماد/الرفض الكاملين (كابتن وتاجر)', async () => {
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'active' }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'active', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'merP'), { status: 'active' }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'rejected' }));
  for (const st of ['blocked', 'paused', 'deleted', 'incomplete']) await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: st })); // لا مسار pending -> تشغيل بديل
  assert.equal((await dump('users/drvP')).status, 'pending'); assert.equal((await dump('users/merP')).status, 'pending');
});
test('H13. لا دخول لحالات التشغيل من incomplete/rejected بأي طريق (حتى باعتماد كامل أو بتحديث status مباشر أو عبر blocked/deleted)', async () => {
  for (const id of ['drvI', 'drvR', 'merI', 'merR']) {
    await assertFails(updateDoc(doc(as('admin'), 'users', id), { status: 'active' })); await assertFails(updateDoc(doc(as('admin'), 'users', id), approve('admin')));
    for (const st of ['blocked', 'paused', 'deleted', 'pending']) await assertFails(updateDoc(doc(as('admin'), 'users', id), { status: st }));
  }
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvA'), { status: 'blocked' })); await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvA'), { status: 'deleted' })); await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvA'), { status: 'active' })); // حركات التشغيل القديمة تعمل
});
test('H14. لا يُلمس حقول الاعتماد/الرفض مع حركات التشغيل، ولا لعميل/أدمن/كابتن مستقر', async () => {
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvA'), { status: 'paused', approvedBy: 'admin' }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvA'), { approvedBy: 'admin', approvedAt: serverTimestamp() })); // بلا تغيير حالة
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvA'), { rejectReason: 'x' }));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'custA'), { approvedBy: 'admin' })); await assertFails(updateDoc(doc(as('admin'), 'users', 'admin2'), { rejectedBy: 'admin' }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvA'), { fullName: 'Edited', updatedAt: serverTimestamp() })); await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'merA'), { storeName: 'Edited' })); // تعديل بيانات عادي
});
test('H15. المتجر: لا تفعيل/رفض للمتجر المعلّق وحده، ولا يتجاوز حالة حساب التاجر، ولا من rejected/incomplete', async () => {
  await assertFails(updateDoc(doc(as('admin'), 'stores', 'merP'), { status: 'active' }));
  await assertFails(updateDoc(doc(as('admin'), 'stores', 'merP'), { status: 'rejected' }));
  await assertFails(updateDoc(doc(as('admin'), 'stores', 'merP'), { status: 'paused' }));
  await assertFails(updateDoc(doc(as('admin'), 'stores', 'merR'), { status: 'active' })); await assertFails(updateDoc(doc(as('admin'), 'stores', 'merI'), { status: 'active' }));
  const bad = writeBatch(as('admin')); bad.update(doc(as('admin'), 'stores', 'merP'), { status: 'active' }); bad.update(doc(as('admin'), 'users', 'merP'), { updatedAt: serverTimestamp() }); await assertFails(bad.commit()); // users لم تصبح active
  await assertSucceeds(updateDoc(doc(as('admin'), 'stores', 'merP'), { storeName: 'Renamed' })); // تعديل بيانات بلا تغيير حالة
  await assertSucceeds(updateDoc(doc(as('admin'), 'stores', 'merA'), { status: 'paused' })); await assertSucceeds(updateDoc(doc(as('admin'), 'stores', 'merA'), { status: 'active' }));
  assert.equal((await dump('stores/merP')).status, 'pending');
});
test('H16. شروط الرفض: سبب غير فارغ ≤500، rejectedBy/At من الأدمن والخادم، ومتجر rejected للتاجر', async () => {
  const rej = (extra = {}) => ({ status: 'rejected', rejectedBy: 'admin', rejectedAt: serverTimestamp(), rejectReason: 'سبب', rejectionReason: 'سبب', ...extra });
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), rej({ rejectReason: '' }))); await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), rej({ rejectReason: 'x'.repeat(501) })));
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), { status: 'rejected', rejectedBy: 'admin', rejectedAt: serverTimestamp() })); // بلا سبب
  await assertFails(updateDoc(doc(as('admin'), 'users', 'drvP'), rej({ rejectReason: 5 })));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drvP'), rej()));
  const b = writeBatch(as('admin')); b.update(doc(as('admin'), 'users', 'merP'), rej()); await assertFails(b.commit()); // بلا متجر
  const b2 = writeBatch(as('admin')); b2.update(doc(as('admin'), 'users', 'merP'), rej()); b2.update(doc(as('admin'), 'stores', 'merP'), { status: 'rejected' }); await assertSucceeds(b2.commit());
});
test('H17. Transactions: اعتماد/رفض التاجر ينجح مع المتجر في نفس المعاملة، ويفشل بلا متجر أو بمتجر مختلف الحالة أو مفقود، بلا تحديث جزئي', async () => {
  const ok = async (db) => runTx(db, async (tx) => { tx.update(doc(db, 'users', 'merP'), approve('admin')); tx.update(doc(db, 'stores', 'merP'), { status: 'active' }); });
  await assertSucceeds(ok(as('admin'))); assert.equal((await dump('users/merP')).status, 'active'); assert.equal((await dump('stores/merP')).status, 'active');
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'users', 'merX'), { role: 'merchant', status: 'pending', storeName: 'X' }); }); // تاجر pending بلا مستند متجر
  await assertFails(runTx(as('admin'), async (tx) => { tx.update(doc(as('admin'), 'users', 'merX'), approve('admin')); })); // بلا تحديث متجر
  await assertFails(runTx(as('admin'), async (tx) => { tx.update(doc(as('admin'), 'users', 'merX'), approve('admin')); tx.update(doc(as('admin'), 'stores', 'merX'), { status: 'active' }); })); // المتجر غير موجود
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'users', 'merZ'), { role: 'merchant', status: 'pending' }); await setDoc(doc(c.firestore(), 'stores', 'merZ'), { status: 'rejected' }); });
  await assertFails(runTx(as('admin'), async (tx) => { tx.update(doc(as('admin'), 'users', 'merZ'), approve('admin')); tx.update(doc(as('admin'), 'stores', 'merZ'), { status: 'active' }); })); // متجر rejected لا ينتقل إلى active
  assert.equal((await dump('users/merZ')).status, 'pending'); assert.equal((await dump('stores/merZ')).status, 'rejected'); // لا تحديث جزئي
});
test('H18. إنشاء users بحقول غير معتمدة مرفوض (قائمة حقول)، والحمولة الفعلية للتطبيق تُقبل', async () => {
  const base = { name: 'n', email: 'n@x.com', phone: '', role: 'customer', points: 0, photoURL: '', status: 'active', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as('okU'), 'users', 'okU'), base));
  for (const [k, v] of [['isAdmin', true], ['admin', true], ['requestId', 'D1'], ['approvalStatus', 'approved'], ['vehicleType', 'moto'], ['docs', { a: 1 }], ['role2', 'admin']]) await assertFails(setDoc(doc(as('u' + k), 'users', 'u' + k), { ...base, [k]: v }));
  for (const role of ['merchant', 'driver']) await assertSucceeds(setDoc(doc(as('ok' + role), 'users', 'ok' + role), { ...base, role, status: 'incomplete' }));
  await assertFails(setDoc(doc(as('badAdm'), 'users', 'badAdm'), { ...base, role: 'admin', status: 'incomplete', isAdmin: true }));
});
