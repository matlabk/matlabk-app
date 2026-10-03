// ===== auth.js — تسجيل الدخول/إنشاء حساب، التوجيه بعد الدخول (Routing)، مزامنة HubSpot =====

import { auth, createUserWithEmailAndPassword, db, doc, EmailAuthProvider, fetchSignInMethodsForEmail, getDoc, gProvider, linkWithCredential, linkWithRedirect, runTransaction, sendPasswordResetEmail, sendSignInLinkToEmail, serverTimestamp, setDoc, signInWithEmailAndPassword, signInWithRedirect, signOut, updateDoc } from './firebase.js';
import { loadBanners, loadCategories, loadCoupons, loadCustomerData, loadProducts } from './customer.js';
import { isCustomerProfileComplete, isValidPhoneStrict, normalizePhone, resolveRoute, STATUS } from './account-state.js';

export const ENTRY_TYPE_KEY = 'matlabk_entry_type'; // UI hint فقط (sessionStorage) - مش مصدر صلاحيات
export function takeEntryType() { try { const t = sessionStorage.getItem(ENTRY_TYPE_KEY); sessionStorage.removeItem(ENTRY_TYPE_KEY); return ['customer','driver','merchant'].includes(t) ? t : null; } catch(e) { return null; } }
import { clearAllListeners, setLoad, showErr, showScreen, showToast } from './utils.js';
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
  const code = e?.code || '';
  const map = {
    'auth/user-not-found': 'البريد أو كلمة المرور غير صحيحة',
    'auth/wrong-password': 'البريد أو كلمة المرور غير صحيحة',
    'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة',
    'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة',
    'auth/email-already-in-use': 'البريد مسجل بالفعل — سجّل دخولك بدل إنشاء حساب جديد',
    'auth/weak-password': 'كلمة المرور ضعيفة، اختر كلمة مرور أقوى (6 أحرف على الأقل)',
    'auth/too-many-requests': 'محاولات كتير متتالية، حاول تاني بعد شوية',
    'auth/network-request-failed': 'مشكلة في الاتصال بالإنترنت، حاول تاني',
    'auth/unauthorized-domain': 'الدومين غير مصرح في إعدادات Firebase',
    'auth/popup-closed-by-user': 'تم إغلاق نافذة تسجيل الدخول',
    'auth/credential-already-in-use': 'هذا الحساب مربوط بمستخدم آخر بالفعل',
    'auth/provider-already-linked': 'الحساب ده مربوط بالفعل',
    'auth/requires-recent-login': 'يرجى تسجيل الدخول مرة أخرى لإتمام هذه العملية',
  };
  return map[code] || 'حدث خطأ، حاول مرة أخرى';
}

// ===== Phase 2: Prevent Double Authentication =====
// قفل واحد بسيط يمنع تشغيل أكتر من عملية Authentication (Google/Email Login/Register/Reset)
// في نفس اللحظة - بيتفعّل مع أول عملية وبيتحرر تلقائيًا لما تخلص (نجاح أو فشل).
let _authOpInProgress = false;
function authLockStart() {
  if (_authOpInProgress) return false;
  _authOpInProgress = true;
  return true;
}
function authLockEnd() { _authOpInProgress = false; }

// ===== Phase 2: Secure Account Linking — التخزين المؤقت لنية الربط =====
// بيتخزن بس لحظة اكتشاف تعارض Provider حقيقي (auth/account-exists-with-different-credential
// أو auth/email-already-in-use)، وبيتمسح فورًا بعد أول استخدام أو محاولة - مفيش أي Auto Linking،
// الربط الفعلي بيحصل بس بعد ما المستخدم يثبت ملكية الحساب الأصلي بتسجيل دخول ناجح بيه.
const LINK_INTENT_KEY = 'mova_link_intent';
function stashLinkIntent(intent) { try { sessionStorage.setItem(LINK_INTENT_KEY, JSON.stringify(intent)); } catch(e) {} }
function readLinkIntent() { try { const raw = sessionStorage.getItem(LINK_INTENT_KEY); return raw ? JSON.parse(raw) : null; } catch(e) { return null; } }
function clearLinkIntent() { try { sessionStorage.removeItem(LINK_INTENT_KEY); } catch(e) {} }

export function hideLoading() {
  const ld = document.getElementById('loading');
  ld.classList.add('hide');
  setTimeout(() => ld.style.display = 'none', 500);
}

export function switchTab(t) {
  // MATLABK: لوحة Google/الدخول دايمًا ظاهرة (التسجيل الجديد بـ Google فقط)
  document.getElementById('auth-login').style.display = 'block';
  document.getElementById('err-msg').style.display = 'none';
  updateEntryLabel(t);
}

export const ENTRY_LABELS = {customer:{icon:'👤',name:'عميل'},driver:{icon:'🛵',name:'كابتن'},merchant:{icon:'🏪',name:'تاجر'},admin:{icon:'⚙️',name:'إدارة'}};
export function updateEntryLabel(tab) {
  const cfg = ENTRY_LABELS[window.selectedType] || ENTRY_LABELS.customer;
  document.getElementById('entry-type-icon').textContent = cfg.icon;
  document.getElementById('entry-type-label').textContent = `Continue with Google — ${cfg.name}`;
}

export function pickEntryType(type) {
  window.selectedType = type;
  ['customer','merchant','driver','admin'].forEach(t => {
    const el = document.getElementById('reg-'+t+'-fields');
    if (el) el.style.display = t === type ? 'block' : 'none';
  });
  switchTab('register');
  showScreen('screen-auth');
}

export async function showEmailOTP() {
  const emailInput = document.getElementById('lmail');
  const email = emailInput?.value?.trim() || '';
  const finalEmail = email || prompt('أدخل بريدك الإلكتروني:');
  if (!finalEmail) return;
  try {
    await sendSignInLinkToEmail(auth, finalEmail, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    });
    window.localStorage?.setItem('emailForSignIn', finalEmail);
    document.getElementById('otp-email').textContent = finalEmail;
    showScreen('screen-otp');
    showToast('✅ تم إرسال رابط التحقق على بريدك','ok');
  } catch(e) { showToast(firebaseAuthErrorMessage(e),'err'); }
}

export async function loginGoogle() {
  if (!authLockStart()) { showToast('في عملية تسجيل دخول شغالة بالفعل، استنى شوية','inf'); return; }
  try {
    showToast('جاري تسجيل الدخول بـ Google...','inf');
    try { sessionStorage.setItem(ENTRY_TYPE_KEY, window.selectedType || 'customer'); } catch(e) {}
    await signInWithRedirect(auth, gProvider);
  } catch(e) {
    showToast(firebaseAuthErrorMessage(e),'err');
    authLockEnd();
  }
  // ملحوظة: الـ Lock بيفضل مقفول عمدًا هنا في حالة النجاح - الصفحة هتعمل Redirect كامل بره
  // التطبيق، فمفيش داعي نفكه (الصفحة هترجع تحمّل من جديد أصلًا، والـ Lock هيتصفّر تلقائيًا).
}

export async function doLogin() {
  if (!authLockStart()) { showToast('في عملية تسجيل دخول شغالة بالفعل، استنى شوية','inf'); return; }
  const email = document.getElementById('lmail').value.trim();
  const pass = document.getElementById('lpass').value;
  if (!email || !pass) { showErr('يرجى تعبئة جميع الحقول'); authLockEnd(); return; }
  setLoad('login-btn','lsp',true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    showToast('أهلاً بك! 👋','ok');
  } catch(e) {
    showErr(firebaseAuthErrorMessage(e));
  } finally { setLoad('login-btn','lsp',false); authLockEnd(); }
}

// MATLABK: التسجيل الجديد بـ Google فقط (بدون إيميل/باسورد). الدالة محفوظة لأن main.js/HTML القديم بيستوردها.
export async function doRegister() { return loginGoogle(); }

export async function doLogout() {
  if (window._gpsWatch) navigator.geolocation.clearWatch(window._gpsWatch);
  if (window._gpsInterval) clearInterval(window._gpsInterval);
  clearAllListeners(); // بيصفّر كل الـ listeners + أعلام المتابعة بما فيها إحداثيات GPS المندوب (مسجلة من driver.js) // يقفل كل الـ onSnapshot listeners المفتوحة (طلبات، منتجات، إشعارات...)
  // جديد (Sprint 3): screen-cust-detail بتتفتح بـ style.display المباشر (زي screen-store-manage
  // من قبل)، وده بيتغلب على أي تبديل بـ class.active اللي showScreen() بتعمله - فلازم نقفلها
  // صراحة هنا وإلا ممكن تفضل عالقة ظاهرة فوق شاشة الدخول بعد تسجيل الخروج.
  const cd = document.getElementById('screen-cust-detail'); if (cd) cd.style.display = 'none';
  // Closure Verification Fix: تنظيف أي نية ربط معلّقة (Pending Link Intent) لو المستخدم سجّل
  // خروج قبل ما يكمل مسار الربط - يمنع أي State قديم يفضل معلّق في sessionStorage لجلسة تانية
  // على نفس الجهاز/التاب.
  clearLinkIntent();
  try { sessionStorage.removeItem(ENTRY_TYPE_KEY); } catch(e) {}
  try { localStorage.removeItem('manayef_drv_draft'); } catch(e) {}
  window.CUD = null; window.uploadedDocs = {};
  try { await signOut(auth); } catch(e) {}
  showScreen('screen-entry');
}

export async function showForgot() {
  if (!authLockStart()) { showToast('في عملية شغالة بالفعل، استنى شوية','inf'); return; }
  const email = document.getElementById('lmail').value.trim();
  if (!email) { showErr('أدخل بريدك الإلكتروني أولاً'); authLockEnd(); return; }
  setLoad('login-btn','lsp',true);
  // رسالة عامة واحدة بصرف النظر عن نتيجة العملية الفعلية - عشان مانكشفش هل البريد ده مسجل
  // بحساب فعلي ولا لأ (Email Enumeration Protection). النجاح والفشل (حتى user-not-found)
  // بيوديّا لنفس الرسالة، ماعدا أخطاء واضحة في صيغة البريد نفسها.
  const genericMsg = 'لو البريد الإلكتروني ده مرتبط بحساب، هيوصلك رابط لإعادة تعيين كلمة المرور خلال دقائق.';
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(genericMsg, 'ok');
  } catch(e) {
    if (e.code === 'auth/invalid-email') showErr('صيغة البريد الإلكتروني غير صحيحة');
    else showToast(genericMsg, 'ok'); // حتى user-not-found بتاخد نفس الرسالة العامة
  } finally { setLoad('login-btn','lsp',false); authLockEnd(); }
}

// ===== Phase 2: Secure Account Linking — التنفيذ الفعلي =====
// مبدأ أساسي: مفيش أي ربط تلقائي، ومفيش ربط بمجرد تطابق البريد. الربط بيحصل بس بعد ما
// المستخدم يثبت ملكية الحساب الأصلي (تسجيل دخول ناجح بيه)، وبعدين يثبت ملكية الحساب التاني
// (بإتمام Google OAuth الحقيقي، أو بمعرفة كلمة المرور اللي هو نفسه كتبها).

// Case: Google موجود بالفعل + حاول يعمل Email/Password بنفس البريد (auth/email-already-in-use)
async function handleEmailAlreadyInUse(email) {
  let methods = [];
  try { methods = await fetchSignInMethodsForEmail(auth, email); } catch(e) {}
  if (methods.includes('google.com')) {
    // بنعرف بالتحديد إن الحساب ده اتعمل بجوجل - نوجّه المستخدم بدقة، ونخزن نية الربط عشان
    // نعرضها بعد ما يسجّل دخول بجوجل فعليًا (يعني بعد ما يثبت ملكيته للحساب التاني كمان).
    // Closure Verification Fix: صفر تخزين لكلمة المرور في sessionStorage - بنخزن نية الربط
    // (النوع + البريد) بس، وهنطلب كلمة المرور تاني وقت الربط الفعلي (maybeOfferPendingLink).
    stashLinkIntent({ type: 'add-password', email });
    showErr('البريد ده مسجل بالفعل عن طريق Google. سجّل دخولك بـ Google أولاً.');
  } else {
    showErr('البريد مسجل بالفعل — سجّل دخولك بدل إنشاء حساب جديد');
  }
  switchTab('login');
  const lmail = document.getElementById('lmail'); if (lmail) lmail.value = email;
}

// Case: Email/Password موجود بالفعل + حاول يعمل Google بنفس البريد
// (auth/account-exists-with-different-credential) - بتتنده من main.js وقت رجوع الـ Redirect.
export function handleGoogleAccountConflict(e) {
  const email = e?.customData?.email || '';
  if (email) {
    stashLinkIntent({ type: 'add-google', email });
    const lmail = document.getElementById('lmail'); if (lmail) lmail.value = email;
  }
  switchTab('login');
  showScreen('screen-auth');
  showErr(email
    ? `البريد ${email} مسجّل بالفعل بكلمة مرور. سجّل دخولك بيها الأول.`
    : 'الحساب ده مسجّل بطريقة تانية. سجّل دخولك بالطريقة الأصلية الأول.');
}

// بعد أي تسجيل دخول ناجح (Email أو Google) - لو فيه نية ربط مخزّنة ومطابقة لنفس البريد،
// نعرض على المستخدم اختياريًا يكمل الربط. مفيش أي تنفيذ تلقائي بدون تأكيده الصريح.
export async function maybeOfferPendingLink(currentEmail) {
  const intent = readLinkIntent();
  if (!intent || !currentEmail || intent.email?.toLowerCase() !== currentEmail?.toLowerCase()) { clearLinkIntent(); return; }
  clearLinkIntent(); // نمسحها فورًا - مرة واحدة بس، صفر تكرار عرض
  if (intent.type === 'add-google') {
    const ok = confirm('لأمان حسابك، هل تحب تربط تسجيل الدخول بجوجل بنفس الحساب؟ (اختياري)');
    if (ok) {
      try { await linkWithRedirect(auth.currentUser, gProvider); }
      catch(e) { showToast(firebaseAuthErrorMessage(e), 'err'); }
    }
  } else if (intent.type === 'add-password') {
    const ok = confirm('لأمان حسابك، هل تحب تضيف كلمة مرور لنفس الحساب (بدل الدخول بـ Google بس)؟');
    if (ok) {
      // Closure Verification Fix: كلمة المرور بتتطلب هنا مباشرة (Fresh)، مش من أي تخزين سابق -
      // صفر لحظة واحدة يتم فيها الاحتفاظ بكلمة مرور في الذاكرة أو أي تخزين متصفح.
      const pass = prompt('اكتب كلمة المرور اللي تحب تستخدمها لهذا الحساب:');
      if (pass && pass.length >= 6) {
        try {
          const cred = EmailAuthProvider.credential(intent.email, pass);
          await linkWithCredential(auth.currentUser, cred);
          showToast('تم ربط كلمة المرور بحسابك ✅', 'ok');
        } catch(e) { showToast(firebaseAuthErrorMessage(e), 'err'); }
      } else if (pass) {
        showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل — لم يتم الربط', 'err');
      }
    }
  }
}

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
      window.CUD = existing.data();
      routeUser();
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
    showToast('حدث خطأ، حاول مرة أخرى','err');
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


// ===== ROUTING =====
export function routeUser() {
  const role = window.CUD?.role;
  // Phase 2 — Secure Account Linking: نقطة واحدة بعد أي دخول ناجح (Email أو Google) - لو فيه
  // نية ربط مخزّنة من تعارض Provider سابق ومطابقة لنفس البريد، نعرضها هنا اختياريًا. Fire-and-forget
  // (مش هيوقف التنقل العادي)، ومحمي بـ .catch عشان مايعملش Unhandled Rejection.
  maybeOfferPendingLink(window.CU?.email).catch(() => {});
  startNotifListener();
  loadCategories();
  loadBanners();
  loadCoupons();
  listenSettings();
  const target = resolveRoute(window.CUD);
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
