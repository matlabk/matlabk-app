// ===== auth.js — تسجيل الدخول/إنشاء حساب، التوجيه بعد الدخول (Routing)، مزامنة HubSpot =====

import { auth, db, doc, getDoc, gProvider, runTransaction, serverTimestamp, setDoc, signInWithPopup, signInWithRedirect, signOut, updateDoc, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from './firebase.js';
import { INTENT_ROLES, INTENT_TTL_MS, RESET_SENT, OP_TIMEOUT_ERROR, MSG_PROFILE_CREATE_FAILED, isValidEmail, normalizeEmail, validateEmailLogin, validateSignup, MSG_INVALID_ROLE, MSG_ROLE_REQUIRED, MSG_USER_LOAD_FAILED, OFFLINE_ERROR, ROLE_UI, SESSION_NOT_READY, decodeIntent, describeAuthError, encodeIntent, evaluateRoleGate, isRedirectPendingValid } from './auth-flow.js';
import { loadBanners, loadCategories, loadCoupons, loadCustomerData, loadProducts } from './customer.js';
import { isCustomerProfileComplete, isValidPhoneStrict, normalizePhone, resolveRoute, STATUS } from './account-state.js';

export const ENTRY_TYPE_KEY = 'matlabk_entry_type'; // الدور المختار قبل دخول Google، مخزّن مؤقتًا في sessionStorage لنجاة إعادة التحميل فقط - مش مصدر صلاحيات
// الدور المختار يُحفظ في الذاكرة (مسار popup) + sessionStorage (مسار redirect/إعادة تحميل) ويُستهلك مرة واحدة في بوابة الدور.
let _pendingIntent = null; // { type, ts }
let _loginMethod = 'google'; // 'google' | 'email' - يغيّر صياغة رسالة التعارض فقط، ولا يؤثر على قرار الصلاحيات
let _loginInFlight = false; // true من لحظة الضغط على Google حتى تأكيد Firebase للجلسة (يميّز الدخول الجديد عن الجلسة المستعادة)
export function setEntryIntent(type) {
  const raw = encodeIntent(type); if (!raw) return false;
  _pendingIntent = { type, ts: Date.now() };
  try { sessionStorage.setItem(ENTRY_TYPE_KEY, raw); } catch(e) {}
  return true;
}
export function peekEntryType() {
  if (_pendingIntent && Date.now() - _pendingIntent.ts <= INTENT_TTL_MS) return _pendingIntent.type;
  // sessionStorage لا يُعتمد إلا عند العودة من redirect (الصفحة اتعمّلها reload عن قصد). غير كده أي قيمة متبقية من محاولة قديمة
  // (إعادة تحميل أثناء نافذة Google...) لا تُعامَل كدخول جديد ولا تطرد جلسة مستعادة سليمة.
  try { return hasRedirectPending() ? decodeIntent(sessionStorage.getItem(ENTRY_TYPE_KEY)) : null; } catch(e) { return null; }
}
export function clearEntryIntent() { _pendingIntent = null; _loginInFlight = false; _loginMethod = 'google'; try { sessionStorage.removeItem(ENTRY_TYPE_KEY); } catch(e) {} }
export function takeEntryType() { const t = peekEntryType(); clearEntryIntent(); return t; }
// بيتنادى أول حاجة في onAuthStateChanged(user): يلتقط (الدور المختار + هل ده دخول جديد؟) ويصفّر الحالة المعلّقة.
export function captureLoginIntent() {
  const fresh = _loginInFlight || hasRedirectPending() || peekEntryType() !== null;
  const method = _loginMethod; _lastMethod = method;
  return { intent: takeEntryType(), fresh, method };
}
import { clearAllListeners, setLoad, showScreen, showToast } from './utils.js';
import { getLocation, loadDriverData, startGPS } from './driver.js';
import { loadAdminData } from './admin.js';
import { startNotifListener } from './notifications.js';
import { loadMerchantData } from './merchant.js';
import { listenSettings } from './orders.js';
import { listenRideOffers, initDriverActiveRideListener } from './rides.js';

// ===== AUTH FUNCTIONS =====

// ===== Phase 2: Centralized Firebase Error Mapping =====
// نقطة واحدة لترجمة أكواد أخطاء Firebase Auth لرسائل عربية واضحة - بدل ما كل دالة تفسّر
// الأكواد بمنطقها الخاص. أي دالة Auth جديدة مستقبلًا تستخدم هذه الدالة بدل تكرار المنطق.
export function firebaseAuthErrorMessage(e) {
  // رسائل عربية مفهومة (بدون أكواد Firebase) - الجدول في auth-flow.js ومُختبَر.
  return describeAuthError(e, { online: typeof navigator === 'undefined' || navigator.onLine !== false }).message;
}

// ===== Phase 2: Prevent Double Authentication =====
// قفل واحد بسيط يمنع تشغيل أكتر من عملية Authentication (Google/Email Login/Register/Reset)
// في نفس اللحظة - بيتفعّل مع أول عملية وبيتحرر تلقائيًا لما تخلص (نجاح أو فشل).
let _authOpInProgress = false;
let _authOpTimer = null;
// مهلة أقصى لأي عملية مصادقة معلّقة (نافذة Google عالقة، شبكة لا ترد...): بعدها تُفك الأزرار وتظهر رسالة، بدل تجمّد كل الأزرار بدون تفسير.
// لا نمسح الدور المختار هنا: لو وصلت النتيجة المتأخرة تُعالَج بنفس بوابة الدور (لا تمرير صامت).
const authOpTimeoutMs = () => (Number.isFinite(window.AUTH_OP_TIMEOUT_MS) ? window.AUTH_OP_TIMEOUT_MS : 45000);
function authLockStart() {
  if (_authOpInProgress) return false;
  _authOpInProgress = true;
  clearTimeout(_authOpTimer);
  // عند انتهاء المهلة يبقى الدور المختار (صلاحية 10 دقائق): أي نتيجة متأخرة تمر على البوابة بدل ما تتعامل كجلسة مستعادة.
  _authOpTimer = setTimeout(() => { if (_authOpInProgress) { console.warn('[auth] operation timed out'); _loginInFlight = false; resetLoginState(); showLoginError(OP_TIMEOUT_ERROR); } }, authOpTimeoutMs());
  return true;
}
function authLockEnd() { _authOpInProgress = false; clearTimeout(_authOpTimer); _authOpTimer = null; }
export function isAuthOpActive() { return _authOpInProgress || _loginInFlight; }
// تسجيل خروج متعمَّد من التطبيق (doLogout/رفض الدور): مستمع "مفيش مستخدم" في main.js لا يعيد التوجيه/يمسح الحالة لما يوصله حدث الخروج ده.
let _expectSignOutUntil = 0;
export function takeExpectedSignOut() { const ok = Date.now() < _expectSignOutUntil; _expectSignOutUntil = 0; return ok; }
// وضع التشخيص (لا يعرض أسرارًا): يضيف رمز خطأ Firebase للرسالة. يُفعَّل بـ window.DEBUG_ERRORS=true أو localStorage.matlabk_debug_auth='1'.
function authDebugOn() { try { return window.DEBUG_ERRORS === true || localStorage.getItem('matlabk_debug_auth') === '1'; } catch(e) { return window.DEBUG_ERRORS === true; } }
const withCode = (msg, e) => (authDebugOn() && e && e.code ? msg + ' [' + e.code + ']' : msg);

// ===== شاشة الدخول (MATLABK): حالة التحميل والأخطاء داخل الشاشة نفسها =====
// كل أزرار المصادقة (Google/بريد/إنشاء/استعادة): زر واحد فقط يظهر عليه التحميل، والباقي يتعطل أثناء أي عملية معلّقة.
const AUTH_BTNS = {
  google: { btn: 'lg-google', label: 'lg-google-label', text: 'المتابعة باستخدام Google' },
  email: { btn: 'em-submit', label: 'em-submit-label', text: 'تسجيل الدخول' },
  signup: { btn: 'su-submit', label: 'su-submit-label', text: 'إنشاء الحساب' },
  reset: { btn: 'fg-submit', label: 'fg-submit-label', text: 'إرسال رابط الاستعادة' },
};
const AUTH_AUX = ['lg-back', 'lg-retry', 'em-forgot', 'em-signup', 'su-back', 'fg-back', 'em-email', 'em-pass', 'su-email', 'su-pass', 'su-pass2', 'fg-email'];
function setLoginBusy(on, label, which = 'google') {
  for (const k of Object.keys(AUTH_BTNS)) {
    const c = AUTH_BTNS[k]; const b = document.getElementById(c.btn); if (!b) continue;
    const isActive = !!on && k === which;
    b.disabled = !!on; b.setAttribute('aria-busy', isActive ? 'true' : 'false'); b.classList.toggle('is-loading', isActive);
    const l = document.getElementById(c.label); if (l) l.textContent = isActive ? (label || 'جاري فتح Google…') : c.text;
  }
  for (const id of AUTH_AUX) { const x = document.getElementById(id); if (x) x.disabled = !!on; }
}
// مسح حقول البريد/كلمة المرور من الواجهة (كلمة المرور لا تُحفظ في أي مكان؛ هنا بنفضّي الحقول بعد الاستخدام/الخروج)
function clearAuthForms() { for (const id of ['em-email', 'em-pass', 'su-email', 'su-pass', 'su-pass2', 'fg-email']) { const x = document.getElementById(id); if (x) x.value = ''; } }
function showAltLogin(on) { const el = document.getElementById('lg-alt'); if (el) el.hidden = !on; }
// بيتنادى من onAuthStateChanged (نجاح/فشل) ومن الخروج: يفك الزر والقفل - مفيش Loading عالق.
export function resetLoginState() { setLoginBusy(false); authLockEnd(); }
const REDIRECT_PENDING_KEY = 'matlabk_redirect_pending'; // يُكتب قبل أي تحويل redirect، المسار البديل فقط
export function hasRedirectPending() { try { return isRedirectPendingValid(sessionStorage.getItem(REDIRECT_PENDING_KEY)); } catch(e) { return false; } }
export function clearRedirectPending() { try { sessionStorage.removeItem(REDIRECT_PENDING_KEY); } catch(e) {} }
try { if (!hasRedirectPending()) sessionStorage.removeItem(ENTRY_TYPE_KEY); } catch(e) { /* تخزين غير متاح: لا يوجد شيء متبقٍ أصلًا */ }
export function showLoginError(msg, { retry = false } = {}) {
  // نفس الرسالة في شاشة الدخول والصفحة الرئيسية (اللي ظاهرة منهم هي اللي يشوفها المستخدم) - مفيش رسالة تضيع.
  for (const id of ['err-msg', 'home-err', 'su-err', 'fg-err']) { const e = document.getElementById(id); if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; if (msg && e.scrollIntoView) { try { e.scrollIntoView({ block: 'nearest' }); } catch(x) {} } } }
  const ok = document.getElementById('fg-ok'); if (ok) { ok.textContent = ''; ok.style.display = 'none'; } // أي رسالة جديدة/مسح يخفي رسالة نجاح الاستعادة
  for (const id of ['lg-retry', 'home-retry']) { const r = document.getElementById(id); if (r) r.hidden = !(msg && retry); }
}
// الرجوع للصفحة بزر Back بعد تحويل Google (bfcache) لازم يفك الزر والقفل
window.addEventListener('pageshow', (ev) => { if (ev.persisted) { setLoginBusy(false); authLockEnd(); } });


export function hideLoading() {
  const ld = document.getElementById('loading');
  ld.classList.add('hide');
  setTimeout(() => ld.style.display = 'none', 500);
}


// المسار الأساسي: نافذة Google المنبثقة. السبب: authDomain (go-elmanayef.firebaseapp.com) غير نطاق الموقع (matlabk.github.io)،
// والمتصفحات الحديثة بتحجب تخزين الطرف الثالث => signInWithRedirect بيرجع بدون جلسة (نتيجة فاضية بدون خطأ). الـ Popup مش بيعتمد على كده.
// مهم: signInWithPopup لازم تتنادى في نفس الـ click handler قبل أي await عشان المتصفح ما يحجبش النافذة.
// ما بعد نجاح أي مصادقة (Google أو بريد): الدخول الفعلي يؤكده onAuthStateChanged، وده بيمرّره على بوابة الدور.
async function afterCredential(cred) {
  // لو مستمع الجلسة (onAuthStateChanged) سبق والتقط الاختيار وعالج هذا الدخول، لا نمرّر نفس الدخول على البوابة مرة تانية
  // (مرة تانية بدون الدور المختار كانت هتعامله كجلسة مستعادة وتفتح لوحة الدور الفعلي بعد الرفض).
  if (!_loginInFlight) return;
  if (window.CU && cred?.user && window.CU.uid === cred.user.uid) {
    // نفس المستخدم كان داخل بالفعل (مفيش onAuthStateChanged جديد): نمرّر على نفس البوابة (قراءة طازجة من Firestore + فحص الدور).
    resetLoginState();
    await handleSignedIn(cred.user, captureLoginIntent());
    return;
  }
  // الدخول الفعلي يؤكده onAuthStateChanged فقط (هو اللي يوجّه ويفك الزر). لو لسه ماوصلش نغيّر الوصف ونراقب.
  if (!window.CU) {
    setLoginBusy(true, 'جاري تسجيل دخولك…', _busyWhich);
    setTimeout(() => { if (!window.CU) { resetLoginState(); showLoginError(SESSION_NOT_READY); } }, 15000);
  }
}
let _busyWhich = 'google';

export async function loginGoogle(type) {
  // النوع (عميل أو كابتن أو تاجر). لو مفيش نوع صالح (لا وسيط ولا اختيار سابق) => لا نفتح Google ولا نفترض "عميل": نرجّع المستخدم لاختيار نوع الحساب.
  const role = INTENT_ROLES.includes(type) ? type : window.selectedType;
  if (!INTENT_ROLES.includes(role)) { openRolePick(); showLoginError(MSG_ROLE_REQUIRED); return; }
  if (!authLockStart()) return; // منع الضغط المتكرر
  window.selectedType = role;
  showLoginError(''); showAltLogin(false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showLoginError(OFFLINE_ERROR); authLockEnd(); return; }
  _busyWhich = 'google'; setLoginBusy(true, 'جاري فتح Google…');
  setEntryIntent(role); _loginInFlight = true; _loginMethod = 'google'; // الدور المختار يُحفظ قبل أي عملية Google وبشكل متزامن قبل أول انتظار
  try {
    await afterCredential(await signInWithPopup(auth, gProvider));
  } catch(e) {
    clearEntryIntent();
    resetLoginState();
    const d = describeAuthError(e, { online: typeof navigator === 'undefined' || navigator.onLine !== false });
    if (!d.silent) showLoginError(withCode(d.message, e));
    if (d.offerRedirect) showAltLogin(true);
    console.warn('[auth] popup sign-in failed:', e?.code || e);
  }
}


// ===== المصادقة بالبريد الإلكتروني وكلمة المرور (إضافة بجانب Google - نفس نظام الأدوار والبوابة) =====
// مبادئ: كلمة المرور تُقرأ من الحقل وتمر مباشرة إلى Firebase Auth (لا تُخزَّن ولا تُسجَّل ولا تُرسل لـ Firestore)؛
// الدور المختار يُحفظ قبل أي طلب؛ نجاح المصادقة لا يفتح لوحة: القرار دائمًا من handleSignedIn (users/{uid}).
function _val(id) { return document.getElementById(id)?.value ?? ''; }
function _chosenRole() {
  const role = window.selectedType;
  if (INTENT_ROLES.includes(role)) return role;
  openRolePick(); showLoginError(MSG_ROLE_REQUIRED); return null;
}
export async function emailLogin(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const role = _chosenRole(); if (!role) return;
  const email = normalizeEmail(_val('em-email')), password = _val('em-pass');
  const v = validateEmailLogin({ email, password });
  if (!v.ok) { showLoginError(v.message); return; }
  if (!authLockStart()) return;
  showLoginError(''); showAltLogin(false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showLoginError(OFFLINE_ERROR); authLockEnd(); return; }
  _busyWhich = 'email'; setLoginBusy(true, 'جاري تسجيل الدخول…', 'email');
  setEntryIntent(role); _loginInFlight = true; _loginMethod = 'email';
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const pw = document.getElementById('em-pass'); if (pw) pw.value = '';
    await afterCredential(cred);
  } catch(e) {
    clearEntryIntent(); resetLoginState();
    const pw = document.getElementById('em-pass'); if (pw) pw.value = '';
    showLoginError(withCode(describeAuthError(e, { online: typeof navigator === 'undefined' || navigator.onLine !== false, method: 'email' }).message, e));
    console.warn('[auth] email sign-in failed:', e?.code || 'unknown');
  }
}
export async function emailSignup(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const role = _chosenRole(); if (!role) return;
  const email = normalizeEmail(_val('su-email')), password = _val('su-pass'), confirm = _val('su-pass2');
  const v = validateSignup({ email, password, confirm });
  if (!v.ok) { showLoginError(v.message); return; }
  if (!authLockStart()) return;
  showLoginError('');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showLoginError(OFFLINE_ERROR); authLockEnd(); return; }
  _busyWhich = 'signup'; setLoginBusy(true, 'جاري إنشاء الحساب…', 'signup');
  setEntryIntent(role); _loginInFlight = true; _loginMethod = 'email'; // الدور المختار يتحفظ: حساب جديد => completeRegistration(role) من البوابة
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    for (const id of ['su-pass', 'su-pass2']) { const x = document.getElementById(id); if (x) x.value = ''; }
    await afterCredential(cred);
  } catch(e) {
    clearEntryIntent(); resetLoginState();
    for (const id of ['su-pass', 'su-pass2']) { const x = document.getElementById(id); if (x) x.value = ''; }
    showLoginError(withCode(describeAuthError(e, { online: typeof navigator === 'undefined' || navigator.onLine !== false, method: 'email' }).message, e));
    console.warn('[auth] email sign-up failed:', e?.code || 'unknown');
  }
}
// استعادة كلمة المرور: آلية Firebase الرسمية فقط. الرد دايمًا محايد (لا نكشف هل البريد مسجّل أم لا).
export async function emailReset(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const email = normalizeEmail(_val('fg-email'));
  if (!isValidEmail(email)) { showLoginError('صيغة البريد الإلكتروني غير صحيحة. تأكد منه وحاول مرة أخرى.'); return; }
  if (!authLockStart()) return;
  showLoginError('');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showLoginError(OFFLINE_ERROR); authLockEnd(); return; }
  _busyWhich = 'reset'; setLoginBusy(true, 'جاري الإرسال…', 'reset');
  const done = (msg, isErr) => { resetLoginState(); if (isErr) showLoginError(msg); else { const ok = document.getElementById('fg-ok'); if (ok) { ok.textContent = msg; ok.style.display = 'block'; } } };
  try {
    await sendPasswordResetEmail(auth, email);
    done(RESET_SENT, false);
  } catch(e) {
    // مسجّل/غير مسجّل: نفس الرد المحايد. باقي الأخطاء (صيغة/اتصال/محاولات كثيرة) رسائل عربية واضحة.
    if (e?.code === 'auth/user-not-found') { done(RESET_SENT, false); return; }
    done(withCode(describeAuthError(e, { online: typeof navigator === 'undefined' || navigator.onLine !== false, method: 'email' }).message, e), true);
    console.warn('[auth] reset-email failed:', e?.code || 'unknown');
  }
}
export function openSignup() { if (!INTENT_ROLES.includes(window.selectedType)) { openRolePick(); return; } setLoginBusy(false); showLoginError(''); showAltLogin(false); showScreen('screen-signup'); }
export function openForgot() { setLoginBusy(false); showLoginError(''); showScreen('screen-forgot'); }

// ===== الصفحة الرئيسية -> اختيار نوع الحساب -> شاشة الدخول (Google + بريد) =====
export function openRolePick() {
  clearAuthForms(); setLoginBusy(false); showLoginError(''); showAltLogin(false); showScreen('screen-role-pick');
}
export function openLogin(type) {
  if (!INTENT_ROLES.includes(type)) { openRolePick(); return; }
  window.selectedType = type; // UI فقط - القرار الفعلي في evaluateRoleGate من Firestore
  const ui = ROLE_UI[type];
  const t = document.getElementById('lg-role-title'); if (t) t.textContent = ui.title;
  const n = document.getElementById('lg-role-note'); if (n) n.textContent = ui.note;
  const card = document.getElementById('screen-login'); if (card) card.setAttribute('data-role', type);
  setLoginBusy(false); showLoginError(''); showAltLogin(false);
  showScreen('screen-login');
}
export function pickRole(type) { openLogin(type); }

// الحساب مرتبط بدور مختلف (أو حالة غير آمنة): نسجّل الخروج فعليًا (بدون مسح أي بيانات دائمة) ونعرض الرسالة
// where: 'login' (نفس شاشة الدور المختار + Google لحساب آخر) | 'pick' (اختيار النوع من جديد) | 'home'
export async function rejectRoleMismatch(message, { where = 'home', intent = null } = {}) {
  await doLogout();
  if (where === 'login' && INTENT_ROLES.includes(intent)) openLogin(intent);
  else if (where === 'pick') openRolePick();
  showLoginError(message);
}

// مسار بديل صريح (اختيار المستخدم) لو النافذة المنبثقة محجوبة. ممكن يفشل على متصفحات بتحجب تخزين الطرف الثالث - عشان كده
// بنسجّل علامة قبل التحويل، ولو رجعنا بدون جلسة main.js بيعرض رسالة واضحة بدل الرجوع الصامت.
export async function loginGoogleRedirect() {
  if (!authLockStart()) return;
  showLoginError(''); showAltLogin(false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showLoginError(OFFLINE_ERROR); authLockEnd(); return; }
  setLoginBusy(true, 'جاري التحويل إلى Google…');
  if (!INTENT_ROLES.includes(window.selectedType)) { resetLoginState(); openRolePick(); showLoginError(MSG_ROLE_REQUIRED); return; }
  setEntryIntent(window.selectedType); _loginInFlight = true;
  try { sessionStorage.setItem(REDIRECT_PENDING_KEY, String(Date.now())); } catch(e) {}
  try {
    await signInWithRedirect(auth, gProvider);
  } catch(e) {
    clearRedirectPending(); resetLoginState();
    showLoginError(firebaseAuthErrorMessage(e));
  }
}



export async function doLogout() {
  if (window._gpsWatch) navigator.geolocation.clearWatch(window._gpsWatch);
  if (window._gpsInterval) clearInterval(window._gpsInterval);
  clearAllListeners(); // بيصفّر كل الـ listeners + أعلام المتابعة بما فيها إحداثيات GPS المندوب (مسجلة من driver.js) // يقفل كل الـ onSnapshot listeners المفتوحة (طلبات، منتجات، إشعارات...)
  // جديد (Sprint 3): screen-cust-detail بتتفتح بـ style.display المباشر (زي screen-store-manage
  // من قبل)، وده بيتغلب على أي تبديل بـ class.active اللي showScreen() بتعمله - فلازم نقفلها
  // صراحة هنا وإلا ممكن تفضل عالقة ظاهرة فوق شاشة الدخول بعد تسجيل الخروج.
  const cd = document.getElementById('screen-cust-detail'); if (cd) cd.style.display = 'none';
  // تنظيف حالة المستخدم السابق (تبديل حسابات Google): لا يبقى أي دور/حالة/مسودة من حساب سابق.
  clearAuthForms(); clearEntryIntent(); _lastAttempt = null; // الدور المختار القديم لا يبقى عالقًا بعد الخروج
  try { localStorage.removeItem('manayef_drv_draft'); } catch(e) {}
  window.CUD = null; window.CU = null; window.uploadedDocs = {};
  if (auth.currentUser) _expectSignOutUntil = Date.now() + 5000; // الحدث الناتج عن هذا الخروج لا يعيد التوجيه من main.js
  try { await signOut(auth); } catch(e) { console.warn('[auth] signOut failed:', e?.code || 'unknown'); }
  window.selectedType = null; showLoginError(''); resetLoginState(); showAltLogin(false); clearRedirectPending();
  showScreen('screen-entry');
}


// ===== Phase 2: Secure Account Linking — التنفيذ الفعلي =====
// مبدأ أساسي: مفيش أي ربط تلقائي، ومفيش ربط بمجرد تطابق البريد. الربط بيحصل بس بعد ما
// المستخدم يثبت ملكية الحساب الأصلي (تسجيل دخول ناجح بيه)، وبعدين يثبت ملكية الحساب التاني
// (بإتمام Google OAuth الحقيقي، أو بمعرفة كلمة المرور اللي هو نفسه كتبها).




// ===== AUTHENTICATION V2 — Role Selection (بعد Authentication دائمًا، لكل Provider) =====
// Provider Independence: الدالة دي هي المكان الوحيد في المشروع اللي بينشئ users/{uid} لأي
// مستخدم جديد (Email أو Google أو أي Provider مستقبلي) - الـ Gateway (main.js:onAuthStateChanged)
// بيقرا بس وبيوجّه هنا، وصفر Provider بيكتب حاجة بنفسه.
let _registrationInProgress = false; // Concurrency: يمنع Double-click/محاولات متزامنة من نفس الجلسة
export async function completeRegistration(role) {
  if (!window.CU || _registrationInProgress) return;
  if (!['customer','merchant','driver'].includes(role)) return;
  _registrationInProgress = true;
  document.querySelectorAll('#screen-role-select .role-btn').forEach(b => b.style.pointerEvents = 'none');
  const user = window.CU;
  try {
    // Idempotency: لو المستند اتعمل بالفعل (Retry بعد فشل شبكة، أو تاب تاني سبق ونجح) - نستكمل
    // بدل ما نكرر الكتابة أو نغيّر دور موجود بالفعل.
    const existing = await getDoc(doc(db,'users',user.uid));
    if (existing.exists()) {
      // المستند اتعمل بالفعل (تاب تاني/Retry): نعدّي على نفس بوابة الدور بدل التوجيه المباشر (لا تغيير دور ولا فتح لوحة مختلفة).
      await handleSignedIn(user, { intent: role, fresh: true });
      return;
    }
    const data = {
      name: user.displayName || '',
      email: user.email || '',
      phone: '',
      role,
      points: 0,
      photoURL: user.photoURL || '',
      status: role === 'customer' ? STATUS.ACTIVE : STATUS.INCOMPLETE,
      createdAt: serverTimestamp()
    };
    if (role === 'merchant') {
      // Atomic Registration: users/{uid} و stores/{uid} في نفس الـ Transaction - صفر احتمال
      // ينشئ الأول وتفشل الكتابة التانية (المشكلة القديمة المكتشفة في مراجعة Google Sign-In).
      await runTransaction(db, async (t) => {
        t.set(doc(db,'users',user.uid), data);
        t.set(doc(db,'stores',user.uid), { storeName:'', storePhone:'', category:'متجر', status:'pending', createdAt: serverTimestamp() });
      });
    } else {
      await setDoc(doc(db,'users',user.uid), data);
    }
    window.CUD = data;
    syncToHubSpot(data);
    if (role === 'driver') showScreen('screen-driver-register');
    else if (role === 'merchant') showScreen('screen-complete-merchant');
    else routeUser();
  } catch(e) {
    // حساب Firebase اتعمل لكن ملف المستخدم لم يُحفظ (قواعد/شبكة): لا نبتلع الخطأ. نسجّل الرمز، ونرجّع المستخدم لشاشة الدور
    // برسالة واضحة + إعادة محاولة بنفس الدور (completeRegistration idempotent: لو المستند اتعمل لا يتكرر ولا يتغير الدور).
    console.error('[auth] profile creation failed:', e?.code || 'unknown');
    _lastAttempt = { intent: role, fresh: true, method: _lastMethod };
    openLogin(role); showLoginError(withCode(MSG_PROFILE_CREATE_FAILED, e), { retry: true });
  } finally {
    _registrationInProgress = false;
    document.querySelectorAll('#screen-role-select .role-btn').forEach(b => b.style.pointerEvents = '');
  }
}

// ===== AUTHENTICATION V2 — Profile Completion (Resume Registration للتاجر) =====
// بتتفتح إما فورًا بعد اختيار دور "تاجر" (completeRegistration فوق)، أو لاحقًا لو الـ Gateway
// لقى users/{uid} موجود بدور merchant بس stores/{uid} لسه غير موجود (تسجيل قديم لم يكتمل).
export function selCMCat(btn) {
  document.querySelectorAll('#screen-complete-merchant .cat-g-btn2').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
}
export async function submitMerchantProfile() {
  if (!window.CU) return;
  const storeName = document.getElementById('cm-store-name')?.value?.trim();
  const storePhone = normalizePhone(document.getElementById('cm-store-phone')?.value);
  const catBtn = document.querySelector('#screen-complete-merchant .cat-g-btn2.sel');
  const category = catBtn?.textContent?.trim() || 'متجر';
  if (!storeName || !isValidPhoneStrict(storePhone)) { showToast('يرجى تعبئة اسم المتجر ورقم تليفون صحيح','err'); return; }
  setLoad('cm-submit-btn', null, true);
  try {
    // MATLABK: حفظ بيانات المتجر + تقديم الطلب للمراجعة في Transaction واحدة (الـ Rules بتتحقق من الاكتمال بـ getAfter).
    const uid = window.CU.uid;
    await runTransaction(db, async (t) => {
      const sRef = doc(db,'stores',uid);
      const sd = await t.get(sRef);
      if (sd.exists()) t.update(sRef, { storeName, storePhone, category, ...(sd.data().status === 'rejected' ? { status: 'pending' } : {}), updatedAt: serverTimestamp() });
      else t.set(sRef, { storeName, storePhone, category, status: 'pending', createdAt: serverTimestamp() });
      t.update(doc(db,'users',uid), { status: STATUS.PENDING, updatedAt: serverTimestamp() });
    });
    window.CUD = { ...(window.CUD || {}), status: STATUS.PENDING };
    showToast('تم إرسال طلبك للمراجعة ✅','ok');
    routeUser();
  } catch(e) {
    showToast('حدث خطأ أثناء الحفظ، حاول مرة أخرى','err');
  } finally { setLoad('cm-submit-btn', null, false); }
}

export async function submitCustomerProfile() {
  if (!window.CU) return;
  const name = document.getElementById('cc-name')?.value?.trim();
  const phone = normalizePhone(document.getElementById('cc-phone')?.value);
  const address = document.getElementById('cc-address')?.value?.trim() || '';
  if (!name || name.length < 2) { showToast('يرجى كتابة الاسم','err'); return; }
  if (!isValidPhoneStrict(phone)) { showToast('يرجى كتابة رقم تليفون صحيح','err'); return; }
  setLoad('cc-submit-btn', null, true);
  try {
    const patch = { name, phone, updatedAt: serverTimestamp() };
    if (address) patch.address = address.slice(0, 300);
    await updateDoc(doc(db,'users',window.CU.uid), patch);
    window.CUD = { ...(window.CUD || {}), name, phone, ...(address ? { address } : {}) };
    routeUser();
  } catch(e) {
    showToast('حدث خطأ أثناء الحفظ، حاول مرة أخرى','err');
  } finally { setLoad('cc-submit-btn', null, false); }
}

// شاشة حالة التاجر: مراجعة / مرفوض (مع السبب) / إعادة تعديل وتقديم
export function renderMerchantStatus() {
  const u = window.CUD || {};
  const rej = u.status === STATUS.REJECTED;
  const t = document.getElementById('ms-title'), m = document.getElementById('ms-msg'), r = document.getElementById('ms-reason'), b = document.getElementById('ms-edit-btn');
  if (t) t.textContent = rej ? 'تم رفض طلب التسجيل' : 'حسابك قيد المراجعة من الإدارة';
  if (m) m.textContent = rej ? 'يمكنك تعديل بيانات متجرك وإعادة التقديم.' : 'هنبلغك فور اعتماد متجرك. لا يمكن تشغيل المتجر قبل الموافقة.';
  if (r) { r.style.display = rej ? 'block' : 'none'; r.textContent = rej ? ('السبب: ' + (u.rejectReason || u.rejectionReason || 'غير محدد')) : ''; }
  if (b) b.style.display = rej ? 'block' : 'none';
}
export function editMerchantProfile() { showScreen('screen-complete-merchant'); }


// ===== بوابة الدور: تُنفَّذ بعد تأكيد Firebase للجلسة، وقبل تحميل أي بيانات خاصة بدور أو فتح أي لوحة =====
// مسار واحد لكل حالات الدخول: popup / redirect / استعادة جلسة / نفس المستخدم داخل بالفعل.
// attempt = { intent, fresh } من captureLoginIntent(). المصدر الوحيد للدور الفعلي: users/{uid} في Firestore.
let _lastAttempt = null;
let _lastMethod = 'google'; // طريقة آخر دخول التقطه captureLoginIntent (لإعادة المحاولة) // لزر "إعادة المحاولة" بعد فشل قراءة الحساب - بنفس الدور المختار
export async function handleSignedIn(user, attempt = {}) {
  const intent = attempt.intent || null, fresh = !!attempt.fresh, method = attempt.method === 'email' ? 'email' : 'google';
  window.CU = user; window.CUD = null; // لا لوحة تُفتح قبل ما الدور يتأكد
  let data = null, exists = false, storeMissing = false;
  try {
    const ud = await getDoc(doc(db, 'users', user.uid));
    exists = ud.exists(); data = exists ? ud.data() : null;
    if (exists && data.role === 'merchant') storeMissing = !(await getDoc(doc(db, 'stores', user.uid))).exists();
  } catch(e) {
    // فشل القراءة (شبكة/صلاحيات): لا نخمّن الدور ولا نفتح لوحة. رسالة + إعادة محاولة بنفس الدور المختار.
    console.error('Auth routing error (users read):', e);
    _lastAttempt = { intent, fresh, method }; window.CUD = null;
    hideLoading();
    if (fresh && INTENT_ROLES.includes(intent)) openLogin(intent); else showScreen('screen-entry');
    showLoginError(withCode(MSG_USER_LOAD_FAILED, e), { retry: true });
    return;
  }
  _lastAttempt = null;
  const gate = evaluateRoleGate({ intent, fresh, exists, role: data?.role, method });
  if (gate.action === 'reject') { hideLoading(); await rejectRoleMismatch(gate.message, { where: 'login', intent }); return; }
  if (gate.action === 'deny') { hideLoading(); await rejectRoleMismatch(gate.message, { where: gate.reason === 'intent-missing' ? 'pick' : 'home' }); return; }
  hideLoading();
  if (gate.action === 'register') {
    // حساب جديد: الإنشاء الفعلي في completeRegistration() (الرقابة الفعلية في Rules). بدون دور مختار => شاشة اختيار الدور.
    if (intent) completeRegistration(intent); else showScreen('screen-role-select');
    return;
  }
  window.CUD = data;
  // Resume Registration: تاجر عنده users/{uid} من غير stores/{uid} (تسجيل لم يكتمل) => يرجع لنفس الخطوة الناقصة.
  if (data.role === 'merchant' && storeMissing) { showScreen('screen-complete-merchant'); return; }
  routeUser();
}
export function retryLoadAccount() {
  const u = auth.currentUser;
  if (!u) { showLoginError(''); showScreen('screen-entry'); return; }
  showLoginError('');
  return handleSignedIn(u, _lastAttempt || {});
}

// ===== ROUTING =====
export function routeUser() {
  const target = resolveRoute(window.CUD);
  // fail-closed: دور غائب/غير معروف (أو CUD لم يُحمَّل) لا يفتح أي لوحة، حتى لو اتنادى routeUser من مكان تاني.
  if (target === 'unknown') { rejectRoleMismatch(MSG_INVALID_ROLE, { where: 'home' }); return; }
  startNotifListener();
  loadCategories();
  loadBanners();
  loadCoupons();
  listenSettings();
  // MATLABK: التوجيه من الحالة الفعلية (من Firestore) - بدون الوصول لأي Dashboard ثم المنع.
  if (target === 'admin') { showScreen('screen-admin'); loadAdminData(); }
  else if (target === 'driver-register') showScreen('screen-driver-register');
  else if (target === 'driver-dashboard') {
    showScreen('screen-driver'); loadDriverData();
    if (window.onlineStatus) startGPS();
    listenRideOffers(); initDriverActiveRideListener();
  }
  else if (target === 'merchant-dashboard') { showScreen('screen-merchant'); loadMerchantData(); }
  else if (target === 'merchant-status') { renderMerchantStatus(); showScreen('screen-merchant-status'); }
  else if (target === 'merchant-complete') showScreen('screen-complete-merchant');
  else if (target === 'blocked') showScreen('screen-blocked');
  else if (target === 'customer-complete') { showScreen('screen-complete-customer'); const n = document.getElementById('cc-name'); if (n && !n.value) n.value = window.CUD?.name || window.CU?.displayName || ''; }
  else { showScreen('screen-customer'); loadCustomerData(); getLocation(); loadProducts(); loadBanners(); }
}


// ===== HUBSPOT SYNC =====
export function syncToHubSpot(data) {
  fetch('https://manayef-hubspot-bridge.mohamedselim3121998.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      village: data.address || data.village || '',
      role: data.role || ''
    })
  }).catch(() => {});
}
