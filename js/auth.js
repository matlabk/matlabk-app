// ===== auth.js — تسجيل الدخول/إنشاء حساب، التوجيه بعد الدخول (Routing)، مزامنة HubSpot =====

import { auth, db, doc, getDoc, gProvider, runTransaction, serverTimestamp, setDoc, signInWithRedirect, signOut, updateDoc } from './firebase.js';
import { loadBanners, loadCategories, loadCoupons, loadCustomerData, loadProducts } from './customer.js';
import { isCustomerProfileComplete, isValidPhoneStrict, normalizePhone, resolveRoute, STATUS } from './account-state.js';

export const ENTRY_TYPE_KEY = 'matlabk_entry_type'; // UI hint فقط (sessionStorage) - مش مصدر صلاحيات
export function takeEntryType() { try { const t = sessionStorage.getItem(ENTRY_TYPE_KEY); sessionStorage.removeItem(ENTRY_TYPE_KEY); return ['customer','driver','merchant'].includes(t) ? t : null; } catch(e) { return null; } }
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
  // رسائل عربية مفهومة للمستخدم - بدون أكواد Firebase.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'لا يوجد اتصال بالإنترنت. تأكد من الشبكة وحاول مرة أخرى.';
  const code = e?.code || '';
  const map = {
    'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت. تأكد من الشبكة وحاول مرة أخرى.',
    'auth/unauthorized-domain': 'تعذّر تسجيل الدخول من هذا الرابط حاليًا. تواصل مع الدعم.',
    'auth/popup-closed-by-user': 'تم إلغاء تسجيل الدخول. اضغط "المتابعة باستخدام Google" للمحاولة مرة أخرى.',
    'auth/cancelled-popup-request': 'تم إلغاء تسجيل الدخول. اضغط "المتابعة باستخدام Google" للمحاولة مرة أخرى.',
    'auth/too-many-requests': 'محاولات كثيرة متتالية. انتظر قليلًا ثم حاول مرة أخرى.',
    'auth/user-disabled': 'هذا الحساب موقوف. تواصل مع الإدارة.',
    'auth/operation-not-allowed': 'تسجيل الدخول بـ Google غير متاح مؤقتًا. حاول لاحقًا.',
    'auth/web-storage-unsupported': 'متصفحك يمنع حفظ بيانات الدخول. فعّل التخزين أو جرّب متصفحًا آخر.',
    'auth/account-exists-with-different-credential': 'هذا البريد مسجّل بطريقة دخول قديمة لم تعد مدعومة. تواصل مع الإدارة لمساعدتك.',
  };
  return map[code] || 'حدث خطأ غير متوقع. حاول مرة أخرى.';
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

// ===== شاشة الدخول (MATLABK): حالة التحميل والأخطاء داخل الشاشة نفسها =====
const GOOGLE_LABEL = 'المتابعة باستخدام Google';
function setLoginBusy(on) {
  const b = document.getElementById('lg-google'); if (!b) return;
  b.classList.toggle('is-loading', on); b.disabled = on; b.setAttribute('aria-busy', on ? 'true' : 'false');
  const l = document.getElementById('lg-google-label'); if (l) l.textContent = on ? 'جاري التحويل إلى Google…' : GOOGLE_LABEL;
}
export function showLoginError(msg) {
  const e = document.getElementById('err-msg'); if (!e) return;
  e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none';
}
// الرجوع للصفحة بزر Back بعد تحويل Google (bfcache) لازم يفك الزر والقفل
window.addEventListener('pageshow', (ev) => { if (ev.persisted) { setLoginBusy(false); authLockEnd(); } });


export function hideLoading() {
  const ld = document.getElementById('loading');
  ld.classList.add('hide');
  setTimeout(() => ld.style.display = 'none', 500);
}


const ENTRY_MODES = {
  driver: 'التسجيل ككابتن توصيل — طلبك يُراجَع من الإدارة قبل التفعيل',
  merchant: 'التسجيل كتاجر — طلبك يُراجَع من الإدارة قبل التفعيل',
};
// نوع الحساب = تلميح UI فقط لمستخدم Google الجديد (العميل هو الافتراضي). الصلاحيات الفعلية في Firestore Rules.
export function pickEntryType(type) {
  window.selectedType = type === 'driver' || type === 'merchant' ? type : 'customer';
  const mode = ENTRY_MODES[window.selectedType];
  const box = document.getElementById('lg-mode'), txt = document.getElementById('lg-mode-text'), join = document.getElementById('lg-join');
  if (box) box.hidden = !mode; if (txt) txt.textContent = mode || ''; if (join) join.hidden = !!mode;
  showLoginError('');
}

export async function loginGoogle() {
  if (!authLockStart()) return; // منع الضغط المتكرر أثناء التحويل
  showLoginError('');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showLoginError(firebaseAuthErrorMessage({})); authLockEnd(); return; }
  setLoginBusy(true);
  try { sessionStorage.setItem(ENTRY_TYPE_KEY, window.selectedType || 'customer'); } catch(e) {}
  try {
    await signInWithRedirect(auth, gProvider); // الصفحة بتتحوّل لـ Google؛ القفل بيفضل لحد الرجوع
  } catch(e) {
    setLoginBusy(false); showLoginError(firebaseAuthErrorMessage(e)); authLockEnd();
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
  try { sessionStorage.removeItem(ENTRY_TYPE_KEY); } catch(e) {}
  try { localStorage.removeItem('manayef_drv_draft'); } catch(e) {}
  window.CUD = null; window.uploadedDocs = {};
  try { await signOut(auth); } catch(e) {}
  pickEntryType('customer'); setLoginBusy(false); authLockEnd();
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
