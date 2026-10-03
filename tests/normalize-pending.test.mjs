import { test } from 'node:test'; import assert from 'node:assert/strict';
import { classify } from '../scripts/normalize-pending.mjs';
import { effectiveStatus, resolveRoute } from '../js/account-state.js';
const fullDrv = { role: 'driver', status: 'pending', fullName: 'Ahmed Ali', phone: '01012345678', nationalId: '12345678901234', vehicleType: 'motorcycle', plateNumber: 'A1', docsSubmitted: true, docs: { id: 'x' } };
test('driver pending: complete -> keep; missing any required -> to_incomplete', () => {
  assert.equal(classify(fullDrv).action, 'keep');
  for (const k of ['fullName', 'phone', 'nationalId', 'vehicleType', 'plateNumber', 'docsSubmitted', 'docs']) assert.equal(classify({ ...fullDrv, [k]: undefined }).action, 'to_incomplete', k);
  assert.equal(classify({ ...fullDrv, docs: {} }).action, 'to_incomplete'); assert.equal(classify({ ...fullDrv, nationalId: '123' }).action, 'to_incomplete');
});
test('merchant pending: needs valid store data', () => {
  const u = { role: 'merchant', status: 'pending' };
  assert.equal(classify(u, { storeName: 'Shop', storePhone: '01012345678' }).action, 'keep');
  assert.equal(classify(u, null).action, 'to_incomplete'); assert.equal(classify(u, { storeName: '', storePhone: '01012345678' }).action, 'to_incomplete');
  assert.equal(classify(u, { storeName: 'S', storePhone: '12' }).action, 'to_incomplete');
});
test('non-pending / other roles untouched', () => {
  for (const st of ['active', 'rejected', 'incomplete', 'blocked']) assert.equal(classify({ role: 'driver', status: st }).action, 'keep');
  assert.equal(classify({ role: 'customer', status: 'pending' }).action, 'keep');
});
test('UI normalizes legacy incomplete pending driver to incomplete (never treated as submitted)', () => {
  assert.equal(effectiveStatus({ ...fullDrv, docs: {} }), 'incomplete'); assert.equal(effectiveStatus(fullDrv), 'pending');
  assert.equal(resolveRoute({ ...fullDrv, docs: {} }), 'driver-register');
});
