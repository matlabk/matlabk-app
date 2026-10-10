// node --test tests/auth-reopen.test.mjs — فتح التطبيق من جديد بحالة مسبقة (كل سيناريو في عملية Node مستقلة تُقلع التطبيق الحقيقي).
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
const run = (pre) => { const out = execFileSync(process.execPath, [new URL('./boot/reopen.mjs', import.meta.url).pathname], { env: { ...process.env, BOOT_PRESEED: JSON.stringify(pre) }, encoding: 'utf8' }); return JSON.parse(out.split('\n').find((l) => l.startsWith('RESULT ')).slice(7)); };
const CUST = { role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' };
const recent = JSON.stringify({ t: 'driver', ts: Date.now() });
test('R1. جلسة صحيحة مستعادة => اللوحة المناسبة مباشرة بدون إعادة اختيار', () => {
  const r = run({ session: { uid: 'u1', email: 'a@x.com' }, users: { u1: CUST } }); assert.equal(r.loadError, false); assert.deepEqual(r.screens, ['screen-customer']); assert.equal(r.signOuts, 0);
});
test('R2. اختيار دور قديم متبقٍ في sessionStorage (إعادة تحميل أثناء نافذة Google) لا يطرد جلسة مستعادة سليمة', () => {
  const r = run({ storage: { matlabk_entry_type: recent }, session: { uid: 'u1', email: 'a@x.com' }, users: { u1: CUST } });
  assert.deepEqual(r.screens, ['screen-customer'], JSON.stringify(r)); assert.equal(r.signOuts, 0); assert.equal(r.err, '');
});
test('R3. بدون جلسة: الصفحة الرئيسية، ولا أثر لاختيار قديم', () => {
  const r = run({ storage: { matlabk_entry_type: recent } }); assert.deepEqual(r.screens, ['screen-entry']); assert.equal(r.err, '');
});
test('R4. جلسة مستعادة لحساب بدور غير معروف => لا لوحة (fail-closed) ورسالة', () => {
  const r = run({ session: { uid: 'u2', email: 'b@x.com' }, users: { u2: { status: 'active', name: 'x', phone: '01012345678' } } }); assert.equal(r.screens.includes('screen-customer'), false); assert.equal(r.signOuts, 1); assert.match(r.err, /غير مكتملة أو غير صالحة/);
});
