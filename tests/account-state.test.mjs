// node --test tests/account-state.test.mjs  (منطق التوجيه الفعلي من js/account-state.js)
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { resolveRoute, isCustomerProfileComplete, isValidPhoneStrict } from '../js/account-state.js';
test('customer: incomplete -> complete profile; complete -> home', () => {
  assert.equal(resolveRoute({ role: 'customer', status: 'active', name: 'Ali', phone: '' }), 'customer-complete');
  assert.equal(resolveRoute({ role: 'customer', status: 'active', name: '', phone: '01012345678' }), 'customer-complete');
  assert.equal(resolveRoute({ role: 'customer', status: 'active', name: 'Ali', phone: '01012345678' }), 'customer-home');
  assert.equal(resolveRoute({ role: 'customer', status: 'blocked', name: 'Ali', phone: '01012345678' }), 'blocked');
});
test('profileComplete flag is ignored (derived from real data only)', () => {
  assert.equal(resolveRoute({ role: 'customer', status: 'active', profileComplete: true }), 'customer-complete');
});
test('captain: incomplete/pending/rejected -> register screen; active -> dashboard', () => {
  for (const st of ['incomplete', 'pending', 'rejected', undefined, 'weird']) assert.equal(resolveRoute({ role: 'driver', status: st }), 'driver-register');
  assert.equal(resolveRoute({ role: 'driver', status: 'active' }), 'driver-dashboard');
});
test('merchant: incomplete -> form; pending/rejected -> status; active -> dashboard; unknown -> never dashboard', () => {
  assert.equal(resolveRoute({ role: 'merchant', status: 'incomplete' }), 'merchant-complete');
  assert.equal(resolveRoute({ role: 'merchant', status: 'pending' }), 'merchant-status');
  assert.equal(resolveRoute({ role: 'merchant', status: 'rejected' }), 'merchant-status');
  assert.equal(resolveRoute({ role: 'merchant', status: 'active' }), 'merchant-dashboard');
  assert.equal(resolveRoute({ role: 'merchant', status: 'approved?' }), 'merchant-complete');
});
test('client self-claimed fields do not grant access', () => {
  assert.notEqual(resolveRoute({ role: 'merchant', status: 'pending', approved: true, isAdmin: true }), 'merchant-dashboard');
  assert.notEqual(resolveRoute({ role: 'customer', status: 'active', name: 'A', phone: '1', isAdmin: true }), 'admin');
});
test('phone validation mirrors rules (10..15 chars)', () => {
  assert.ok(isValidPhoneStrict('01012345678')); assert.ok(isValidPhoneStrict('+20 101 234 5678'));
  assert.ok(!isValidPhoneStrict('0101')); assert.ok(!isValidPhoneStrict('abc1234567890')); assert.ok(!isValidPhoneStrict('1234567890123456'));
  assert.ok(isCustomerProfileComplete({ name: 'Al', phone: '01012345678' }));
});
