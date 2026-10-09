// node --test tests/role-gate-pure.test.mjs - منطق نقي: بوابة الدور + الدور المختار + resolveRoute fail-closed
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { evaluateRoleGate, encodeIntent, decodeIntent, INTENT_TTL_MS, MSG_INTENT_MISSING, MSG_INVALID_ROLE } from '../js/auth-flow.js';
import { resolveRoute } from '../js/account-state.js';
test('gate: نفس الدور/جلسة مستعادة/admin من زر العميل => allow', () => {
  for (const r of ['customer', 'driver', 'merchant']) { assert.equal(evaluateRoleGate({ intent: r, fresh: true, exists: true, role: r }).action, 'allow'); assert.equal(evaluateRoleGate({ intent: null, fresh: false, exists: true, role: r }).action, 'allow'); }
  assert.equal(evaluateRoleGate({ intent: 'customer', fresh: true, exists: true, role: 'admin' }).action, 'allow');
});
test('gate: تعارض => reject بالرسالة؛ لا مستند => register', () => {
  const g = evaluateRoleGate({ intent: 'merchant', fresh: true, exists: true, role: 'driver' }); assert.equal(g.action, 'reject'); assert.match(g.message, /كحساب كابتن.*كتاجر.*ببريد Google آخر/);
  assert.equal(evaluateRoleGate({ intent: 'driver', fresh: true, exists: false }).action, 'register');
});
test('gate fail-closed: دور مفقود/غير معروف، أو دخول جديد بلا دور مختار => deny', () => {
  for (const role of [undefined, null, '', 'weird', 'root']) assert.deepEqual(evaluateRoleGate({ intent: 'customer', fresh: true, exists: true, role }), { action: 'deny', reason: 'invalid-role', message: MSG_INVALID_ROLE });
  for (const intent of [null, undefined, 'admin', 'x']) assert.deepEqual(evaluateRoleGate({ intent, fresh: true, exists: true, role: 'customer' }), { action: 'deny', reason: 'intent-missing', message: MSG_INTENT_MISSING });
});
test('intent: ترميز/فك + TTL + رفض القيم الفاسدة', () => {
  const now = 1_000_000; assert.equal(decodeIntent(encodeIntent('driver', now), now + 1000), 'driver');
  assert.equal(decodeIntent(encodeIntent('driver', now), now + INTENT_TTL_MS + 1), null); assert.equal(decodeIntent(encodeIntent('driver', now), now - 1), null);
  assert.equal(encodeIntent('admin'), null); assert.equal(encodeIntent(undefined), null);
  for (const bad of [null, '', 'driver', '{', '{"t":"admin","ts":1}', '{"t":"driver"}', '[]']) assert.equal(decodeIntent(bad, 5), null, String(bad));
});
test('resolveRoute fail-closed: null/دور مفقود/غير معروف => unknown (لا واجهة عميل ضمنية)', () => {
  for (const u of [null, undefined, {}, { status: 'active' }, { role: 'weird', status: 'active', name: 'Al', phone: '01012345678' }]) assert.equal(resolveRoute(u), 'unknown');
  assert.equal(resolveRoute({ role: 'customer', status: 'active', name: 'Al', phone: '01012345678' }), 'customer-home');
});
