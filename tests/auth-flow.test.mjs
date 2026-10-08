// node --test tests/auth-flow.test.mjs — يختبر قرارات تسجيل الدخول الفعلية من js/auth-flow.js (نقية)، + محاكاة تسلسل الـ race.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { describeAuthError, signedOutOutcome, isRedirectPendingValid, REDIRECT_FAILED, GENERIC_ERROR, OFFLINE_ERROR, REDIRECT_PENDING_TTL_MS } from '../js/auth-flow.js';

test('popup closed => رسالة واضحة (مش صامت) ولا تعرض بدائل', () => {
  const d = describeAuthError({ code: 'auth/popup-closed-by-user' }); assert.ok(d.message.length > 20); assert.equal(d.silent, false); assert.equal(d.offerRedirect, false);
});
test('popup blocked / غير مدعوم => رسالة + عرض المسار البديل', () => {
  for (const code of ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']) { const d = describeAuthError({ code }); assert.equal(d.offerRedirect, true, code); assert.ok(d.message.includes('بدون نافذة منبثقة'), code); }
});
test('cancelled-popup-request (ضغطة/نافذة تانية ألغت الأولى) => صامت بقصد، لا رسالة', () => assert.equal(describeAuthError({ code: 'auth/cancelled-popup-request' }).silent, true));
test('network error وoffline => رسائل اتصال', () => {
  assert.match(describeAuthError({ code: 'auth/network-request-failed' }).message, /الإنترنت/); assert.equal(describeAuthError({ code: 'x' }, { online: false }).message, OFFLINE_ERROR);
});
test('credential conflict / disabled / domain / too-many / unknown => رسائل عربية بدون أكواد', () => {
  for (const code of ['auth/account-exists-with-different-credential', 'auth/user-disabled', 'auth/unauthorized-domain', 'auth/too-many-requests', 'auth/operation-not-allowed', 'auth/web-storage-unsupported', 'auth/whatever']) {
    const m = describeAuthError({ code }).message; assert.ok(m.length > 10, code); assert.doesNotMatch(m, /auth\/|firebase/i, code); assert.match(m, /[\u0600-\u06FF]/, code);
  }
  assert.equal(describeAuthError({ code: 'auth/whatever' }).message, GENERIC_ERROR); assert.equal(describeAuthError(undefined).message, GENERIC_ERROR);
});
test('race: مفيش مستخدم + الـ SDK فيه currentUser => ignore (لا نرجّع المستخدم لشاشة الدخول)', () => {
  assert.equal(signedOutOutcome({ currentUser: { uid: 'u' }, redirectPending: true, existingError: false }).action, 'ignore');
  assert.equal(signedOutOutcome({ currentUser: { uid: 'u' }, redirectPending: false, existingError: false }).action, 'ignore');
});
test('رجعنا من redirect بدون جلسة وبدون خطأ => رسالة فشل واضحة (لا رجوع صامت)', () => {
  const o = signedOutOutcome({ currentUser: null, redirectPending: true, existingError: false }); assert.equal(o.action, 'show-login'); assert.equal(o.error, REDIRECT_FAILED);
});
test('لو فيه خطأ محدد اتعرض بالفعل => لا نكتب فوقه برسالة عامة', () => assert.equal(signedOutOutcome({ currentUser: null, redirectPending: true, existingError: true }).error, null));
test('زيارة عادية بلا جلسة (مش راجع من redirect) => شاشة الدخول بدون خطأ', () => assert.deepEqual(signedOutOutcome({ currentUser: null, redirectPending: false, existingError: false }), { action: 'show-login', error: null }));
test('علامة redirect: صالحة 10 دقايق فقط (لا علامة قديمة تعرض خطأ كاذب)', () => {
  const now = 1_000_000_000_000; assert.equal(isRedirectPendingValid(String(now - 1000), now), true);
  assert.equal(isRedirectPendingValid(String(now - REDIRECT_PENDING_TTL_MS - 1), now), false); assert.equal(isRedirectPendingValid(null, now), false); assert.equal(isRedirectPendingValid('abc', now), false); assert.equal(isRedirectPendingValid(String(now + 5000), now), false);
});
// محاكاة تسلسل main.js (نفس الدوال الحقيقية) لأربعة سيناريوهات: النتيجة النهائية = شاشة واحدة صحيحة، ولا Loading عالق.
async function simulate({ pending, redirectResolvesMs, sdkUserAfterMs, redirectError }) {
  let screen = 'loading', err = null, currentUser = null; let loadingHidden = false; const events = [];
  const redirectSettled = new Promise((r) => setTimeout(() => r(null), redirectResolvesMs));
  if (sdkUserAfterMs !== null) setTimeout(() => { currentUser = { uid: 'u' }; events.push('user'); screen = 'routed'; loadingHidden = true; }, sdkUserAfterMs);
  // أول emission لـ onAuthStateChanged = null (أسوأ حالة: قبل ما نتيجة redirect تتحلّل)
  await redirectSettled;
  const out = signedOutOutcome({ currentUser, redirectPending: pending, existingError: !!redirectError });
  if (out.action !== 'ignore') { loadingHidden = true; screen = 'login'; err = out.error || redirectError || null; }
  await new Promise((r) => setTimeout(r, 30)); return { screen, err, loadingHidden };
}
test('سيناريو: redirect نجح لكن null اتبعت أول => لا flash للـ login (ignore) ثم يتوجّه المستخدم', async () => {
  const r = await simulate({ pending: true, redirectResolvesMs: 20, sdkUserAfterMs: 5, redirectError: null }); assert.deepEqual(r, { screen: 'routed', err: null, loadingHidden: true });
});
test('سيناريو: redirect فشل صامتًا (تخزين محجوب) => login + رسالة REDIRECT_FAILED، ولا loading عالق', async () => {
  const r = await simulate({ pending: true, redirectResolvesMs: 10, sdkUserAfterMs: null, redirectError: null }); assert.deepEqual(r, { screen: 'login', err: REDIRECT_FAILED, loadingHidden: true });
});
test('سيناريو: زيارة عادية بلا جلسة => login بلا خطأ', async () => {
  const r = await simulate({ pending: false, redirectResolvesMs: 5, sdkUserAfterMs: null, redirectError: null }); assert.deepEqual(r, { screen: 'login', err: null, loadingHidden: true });
});
test('سيناريو: redirect رجع بخطأ Firebase محدد => نفس الخطأ يظهر (لا يُستبدل بعام)', async () => {
  const r = await simulate({ pending: true, redirectResolvesMs: 5, sdkUserAfterMs: null, redirectError: 'رسالة محددة' }); assert.equal(r.err, 'رسالة محددة'); assert.equal(r.screen, 'login');
});
