// node --test tests/google-only.test.mjs — Google هو مزوّد الدخول الوحيد: سلوك Google المتبقي من اختبارات البريد القديمة + غياب أي مسار آخر.
// (اختبارات البريد/كلمة المرور/الاستعادة حُذفت عمدًا مع الميزة بقرار صاحب المشروع؛ سيناريوهاتها المشتركة مع Google مغطّاة في auth-e2e/auth-races/role-gate.)
import { test, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { A, $, T, reset } from './helpers/env.mjs';
import * as FLOW from '../js/auth-flow.js';
import { describeAuthError, CONFIG_ERROR, OFFLINE_ERROR, roleIntentConflict } from '../js/auth-flow.js';
beforeEach(() => reset());

test('G1. لا مسار غير Google: auth.js و auth-flow.js لا يُصدّران أي دالة بريد/كلمة مرور/استعادة', () => {
  for (const n of ['emailLogin', 'emailSignup', 'emailReset', 'openSignup', 'openForgot']) assert.equal(n in A, false, 'auth.js يصدّر ' + n);
  for (const n of ['validateEmailLogin', 'validateSignup', 'isValidEmail', 'normalizeEmail', 'RESET_SENT', 'MIN_PASSWORD_LENGTH']) assert.equal(n in FLOW, false, 'auth-flow.js يصدّر ' + n);
  assert.equal(typeof A.loginGoogle, 'function'); assert.equal(typeof A.loginGoogleRedirect, 'function'); assert.equal(typeof A.processAuthUser, 'function');
});
test('G2. Google بلا اتصال: رسالة عربية، لا نافذة، لا قفل عالق، ولا دور مختار متبقٍ', async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { A.openLogin('customer'); await A.loginGoogle(); assert.equal($('err-msg').textContent, OFFLINE_ERROR); assert.equal(T().popupCalls, 0); assert.equal($('lg-google').disabled, false); assert.equal(A.peekEntryType(), null); }
  finally { desc ? Object.defineProperty(globalThis, 'navigator', desc) : delete globalThis.navigator; }
});
test('G3. رسائل أخطاء Google: عربية وبلا رموز خام، وأخطاء إعدادات المشروع برسالة إعدادات، والمجهول برسالة عامة', () => {
  for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/popup-blocked', 'auth/network-request-failed', 'auth/unauthorized-domain', 'auth/operation-not-allowed', 'auth/user-disabled', 'auth/too-many-requests', 'auth/internal-error', 'auth/never-heard-of-it']) {
    const d = describeAuthError({ code }); assert.ok(d.silent === true || (typeof d.message === 'string' && d.message.length > 5), code); assert.ok(!/auth\//.test(d.message || ''), code); // الصامتة (إلغاء مقصود) بلا رسالة
  }
  for (const code of ['auth/requests-from-referer-https://matlabk.github.io-are-blocked.', 'auth/invalid-api-key', 'auth/app-not-authorized', 'auth/configuration-not-found']) assert.equal(describeAuthError({ code }).message, CONFIG_ERROR, code);
  assert.equal(describeAuthError({ code: 'auth/popup-blocked' }).offerRedirect, true); assert.equal(describeAuthError({ code: 'auth/popup-closed-by-user' }).silent, false);
  assert.equal(describeAuthError({ code: 'auth/network-request-failed' }, { online: false }).message, OFFLINE_ERROR);
});
test('G4. رسالة تعارض الدور: النص المعتمد، بالدور الفعلي، وتطلب بريد Google آخر (لا "بريد إلكتروني آخر")', () => {
  assert.equal(roleIntentConflict('driver', 'customer'), 'هذا البريد الإلكتروني مسجّل بالفعل كحساب عميل. لاستخدام MATLABK ككابتن، يُرجى تسجيل الدخول ببريد Google آخر.');
  assert.equal(roleIntentConflict('merchant', 'driver'), 'هذا البريد الإلكتروني مسجّل بالفعل كحساب كابتن. لاستخدام MATLABK كتاجر، يُرجى تسجيل الدخول ببريد Google آخر.');
  assert.ok(!/إلكتروني آخر/.test(roleIntentConflict('customer', 'merchant'))); assert.ok(!/admin|إدارة/i.test(roleIntentConflict('driver', 'admin'))); // لا كشف عن حساب الإدارة
  assert.equal(roleIntentConflict('customer', 'customer'), null); assert.equal(roleIntentConflict('customer', 'admin'), null);
});
