// ===== main.js — نقطة الدخول: يجمّع كل الموديولات، يربطها بـ window عشان أزرار onclick في
// الواجهة تلاقيها، يجهّز PWA، ويستمع لحالة تسجيل الدخول في Firebase =====

import { db, auth, doc, getDoc, onAuthStateChanged, getRedirectResult } from './firebase.js';
import { signedOutOutcome } from './auth-flow.js';
import { Logger, initOfflineHandling, callCurrentStore, callStore, closeModal, filterProds, openNotifs, openWA, setLoad, showErr, showScreen, showToast, waCurrentStore } from './utils.js';
import { markNotifRead, startNotifListener, registerNotificationsResets } from './notifications.js';
import { initAdminMap, initTrackMap, closeLocationPicker, locPickerConfirm, locPickerUseCurrent, locPickerOnSearchInput, locPickerOnCategoryClick, locPickerOnResultClick, recenterTrackMap, recenterRideStatusMap, toggleDriverMap, showDriverMapTab, registerMapsResets } from './maps.js';
import { goCheckout, openTrack, closeTrack, registerOrdersResets } from './orders.js';
import { addCart, chgQty, custCancelOrderUI, custNav, doSearch, filterCat, loadBanners, loadCategories, loadCoupons, loadCustomerData, loadOrders, loadProducts, loadProductsByStore, loadStores, openAnyReq, openCart, openCustomerLocationPicker, openCustCompleteProfile, saveCustCompleteProfile, quickReq, removeCartItem, renderProds, selMCat, selectRatingTarget, sendAnyReq, setStar, submitMerchant, submitRating, updateCartUI, registerCustomerResets } from './customer.js';
import { acceptOrd, agreeTermsModal, buildChart, closeTermsModal, closeZoom, dregBack, dregGetLocation, dregInit, dregNext, dregRestart, dregSaveDraft, dregSetExp, drvNav, getLocation, listenNewOrders, loadDriverData, loadDriverOrders, openTermsModal, removeUploadedDoc, startGPS, submitDrvReg, toggleAgree, toggleOnline, updOrdStatus, uploadDoc, zoomDoc, registerDriverResets, driverAvatarFallback } from './driver.js';
import { delProd, loadMerchantData, loadMerchantOrders, loadMerchantProds, merchAcceptOrd, merchCancelOrdUI, merchRejectOrd, openAddProd, openMerchantLocationPicker, saveProd, uploadProductImage, removeProductImage, registerMerchantResets, merchNav, merchQuickToggleOpen, mstLoadProfile, mstSaveProfile, mstSetOpen, mstUploadLogo, loadMerchantAccount, merchToggleProdAvail } from './merchant.js';
import { admAccDrv, admAccStore, admDelProd, admLogoutConfirm, admNav, admRejDrv, admRejStore, admUpdOrd, closeReasonModal, closeStoreManage, confirmReasonModal, delBanner, delCat, delCoupon, editBanner, editCat, editCoupon, filtDrvs, filtOrds, loadAdminData, loadAuditLog, loadMoreDrivers, loadMoreMerchants, loadMoreOrders, logAudit, openAddBanner, openAddCat, openAddCoupon, openDrvModal, openEditProd, openReasonModal, openStoreManage, renderAdminBanners, renderAdminCats, renderAdminCoupons, saveBanner, saveCat, saveComm, savePricingSettings, saveCoupon, saveEditProd, smDeleteCover, smDeleteStore, smQuickActivate, smQuickPause, smQuickDelete, smSaveProfile, smSetAccountStatus, smSetOpen, smTab, smUploadCover, smUploadLogo, toggleProdAvail, uploadBannerImg, registerAdminResets, admDrvPause, admDrvActivate, admDrvDelete, saveRidePricingSettings, saveExternalPricingSettings, saveExternalCommission } from './admin.js';
import { onCustomerSearchInput, filterCustomersByStatus, loadMoreCustomers, openCustomerDetails, closeCustomerDetails, saveCustomerBasicInfo, toggleCustomerBlock, softDeleteCustomer, loadMoreCustomerOrders, registerCustomerListReset } from './admin-customers.js';
import { loadMoreMerchantRequests, loadMoreAnyRequests, acceptMerchantRequest, rejectMerchantRequest, addNoteToMerchantRequest, acceptAnyRequest, rejectAnyRequest, addNoteToAnyRequest } from './admin-requests.js';
import { completeRegistration, doLogout, firebaseAuthErrorMessage, hideLoading, loginGoogle, routeUser, selCMCat, submitMerchantProfile, syncToHubSpot, showLoginError, submitCustomerProfile, editMerchantProfile, captureLoginIntent, emailLogin, emailSignup, emailReset, openSignup, openForgot, peekEntryType, clearEntryIntent, handleSignedIn, retryLoadAccount, openRolePick, openLogin, pickRole, loginGoogleRedirect, resetLoginState, hasRedirectPending, clearRedirectPending } from './auth.js';
import { openRideRequest, resetRideRequest, rrClose, rrOpenPointPicker, selectRideVehicle, createRideRequest, acceptRideOffer, rejectRideOffer, retryDispatch, handleDriverRideAction, rsCloseStatus, registerRidesResets } from './rides.js';
import { sendExternalPurchase, retryExternalDispatch, acceptExternalOffer, rejectExternalOffer, handleDriverExternalAction, reportItemUnavailableFromPanel, reportBudgetExceededFromPanel, epCustomerCancel, epCustomerContinue, epCloseStatus, epOpenLocationPicker, epCancelAnyReq, registerExternalResets } from './external.js';
import { renderIcons } from './icons.js';
import { initLocationPermissionGate } from './location-permission.js';

// MOVA Design System v1.0: يملأ كل عناصر [data-icon] الثابتة في index.html بالـ SVG
// المناظر من نظام الأيقونات الموحد (بديل الـ Emoji). Presentation فقط — صفر منطق عمل.
renderIcons();

// كل موديول عنده أعلام subscribe (زي productsUnsub) بيسجّل دالة تصفيرها هنا -- لازم يتنفذوا
// بعد ما كل الموديولات خلصت تحميل (يعني هنا في main.js تحديدًا) عشان نتجنب مشكلة
// "Cannot access '...' before initialization" الناتجة عن الاستيراد الدائري بين utils.js
// والموديولات التانية لو نادينا onListenersCleared من جوه الموديولات نفسها مباشرة.
registerCustomerResets();
registerNotificationsResets();
registerOrdersResets();
registerMapsResets();
registerDriverResets();
registerMerchantResets();
registerAdminResets();
registerCustomerListReset();
registerRidesResets();
registerExternalResets();

// ===== EXPOSE TO WINDOW =====
// app.js (اتقسم دلوقتي لموديولات) بيتحمّل كـ ES module، فالدوال في الأعلى مش بتبقى
// global تلقائيًا. index.html بينده الدوال دي من onclick="..." واللي بتدور عليها في
// window بس. من غير الكتلة دي، أي زرار في التطبيق هيفشل بصمت.
Object.assign(window, {
  callCurrentStore, callStore, closeModal, filterProds, openNotifs, openWA, setLoad, showErr,
  showScreen, showToast, waCurrentStore, markNotifRead, startNotifListener, initAdminMap,
  initTrackMap, recenterTrackMap, recenterRideStatusMap, toggleDriverMap, showDriverMapTab, goCheckout, openTrack, closeTrack, addCart, chgQty, custNav, doSearch,
  locPickerConfirm, locPickerUseCurrent, locPickerOnSearchInput, locPickerOnCategoryClick, locPickerOnResultClick, openCustomerLocationPicker, closeLocationPicker,
  filterCat, loadBanners, loadCategories, loadCoupons, loadCustomerData, loadOrders,
  loadProducts, loadProductsByStore, loadStores, openAnyReq, openCart, openCustCompleteProfile, saveCustCompleteProfile, quickReq,
  removeCartItem, renderProds, selMCat, selectRatingTarget, sendAnyReq, setStar,
  submitMerchant, submitRating, updateCartUI, custCancelOrderUI, acceptOrd, agreeTermsModal, buildChart,
  closeTermsModal, closeZoom, dregBack, dregGetLocation, dregInit, dregNext, dregRestart,
  dregSaveDraft, dregSetExp, drvNav, getLocation, listenNewOrders, loadDriverData, driverAvatarFallback,
  loadDriverOrders, openTermsModal, removeUploadedDoc, startGPS, submitDrvReg, toggleAgree,
  toggleOnline, updOrdStatus, uploadDoc, zoomDoc, delProd, loadMerchantData,
  loadMerchantOrders, loadMerchantProds, merchAcceptOrd, merchCancelOrdUI, merchRejectOrd, openAddProd, openMerchantLocationPicker, saveProd, uploadProductImage, removeProductImage,
  merchNav, merchQuickToggleOpen, mstLoadProfile, mstSaveProfile, mstSetOpen, mstUploadLogo, loadMerchantAccount, merchToggleProdAvail, admAccDrv,
  admAccStore, admDelProd, admLogoutConfirm, admNav, admRejDrv, admRejStore, admUpdOrd,
  closeReasonModal, closeStoreManage, confirmReasonModal, delBanner, delCat, delCoupon,
  editBanner, editCat, editCoupon, filtDrvs, filtOrds, loadAdminData, loadAuditLog, loadMoreCustomers, loadMoreDrivers, loadMoreMerchants, loadMoreOrders, logAudit, onCustomerSearchInput, filterCustomersByStatus, openCustomerDetails, closeCustomerDetails, saveCustomerBasicInfo, toggleCustomerBlock, softDeleteCustomer, loadMoreCustomerOrders, loadMoreMerchantRequests, loadMoreAnyRequests, acceptMerchantRequest, rejectMerchantRequest, addNoteToMerchantRequest, acceptAnyRequest, rejectAnyRequest, addNoteToAnyRequest,
  openAddBanner, openAddCat, openAddCoupon, openDrvModal, openEditProd, openReasonModal,
  openStoreManage, renderAdminBanners, renderAdminCats, renderAdminCoupons, saveBanner,
  saveCat, saveComm, savePricingSettings, saveCoupon, saveEditProd, smDeleteCover, smDeleteStore, smQuickActivate,
  smQuickPause, smQuickDelete, smSaveProfile, smSetAccountStatus, smSetOpen, smTab, smUploadCover,
  smUploadLogo, toggleProdAvail, uploadBannerImg, doLogout, loginGoogleRedirect, hideLoading,
  admDrvPause, admDrvActivate, admDrvDelete, saveRidePricingSettings, saveExternalPricingSettings, saveExternalCommission,
  loginGoogle, emailLogin, emailSignup, emailReset, openSignup, openForgot, openRolePick, pickRole, openLogin, retryLoadAccount, routeUser, completeRegistration, submitMerchantProfile, submitCustomerProfile, editMerchantProfile, selCMCat,
  syncToHubSpot, openRideRequest, resetRideRequest, rrClose, rrOpenPointPicker, selectRideVehicle, createRideRequest,
  acceptRideOffer, rejectRideOffer, retryDispatch, handleDriverRideAction, rsCloseStatus,
  sendExternalPurchase, retryExternalDispatch, acceptExternalOffer, rejectExternalOffer,
  handleDriverExternalAction, reportItemUnavailableFromPanel, reportBudgetExceededFromPanel,
  epCustomerCancel, epCustomerContinue, epCloseStatus, epOpenLocationPicker, epCancelAnyReq
});

// ===== PWA =====
// ملحوظة: أي خطأ هنا (خصوصًا تسجيل service worker من blob: URL، اللي ممكن يرفضه المتصفح)
// كان بيوقف تنفيذ باقي الملف بالكامل — بما فيه مستمع onAuthStateChanged اللي بيقفل شاشة
// التحميل. لف الكود ده في try/catch يضمن إن فشل جزء PWA (ثانوي) مايوقفش تحميل التطبيق كله.
try {
  const mf={name:'MATLABK',short_name:'MATLABK',start_url:'/',display:'standalone',background_color:'#1A1A2E',theme_color:'#FF6B00',description:'خدمة توصيل ومشاوير لأهل المنايف',icons:[{src:'https://via.placeholder.com/192x192/FF6B00/FFFFFF?text=GO',sizes:'192x192',type:'image/png'},{src:'https://via.placeholder.com/512x512/FF6B00/FFFFFF?text=GO',sizes:'512x512',type:'image/png'}]};
  const mb=new Blob([JSON.stringify(mf)],{type:'application/json'});
  const manifestLink = document.getElementById('manifest-link');
  if(manifestLink) manifestLink.setAttribute('href',URL.createObjectURL(mb));
  // AUDIT-2026: تم حذف تسجيل Service Worker المبني من Blob. المتصفحات بترفض تسجيل SW من blob: URL (يفشل بصمت
  // عبر .catch) فكان كود ميت، ولو اشتغل كان cache-first على كل الطلبات (خطر تقديم بيانات خاصة قديمة).
  // لو احتجنا PWA/Offline فعلاً: أضف /sw.js حقيقي بالسياسة الموجودة في AUDIT_REPORT.md (App-shell فقط، لا Firestore/Auth).
} catch(e) { Logger.error('PWA setup failed (non-fatal):', e); }

// ===== AUTH STATE LISTENER =====
// نتيجة العودة من redirect (المسار البديل فقط). بنستناها قبل ما نعتبر "مفيش مستخدم" (انظر onAuthStateChanged) => مفيش race.
// نتيجة الخطأ بتظهر داخل شاشة الدخول؛ والنتيجة الفاضية بدون جلسة بتتعامل معاها signedOutOutcome (رسالة واضحة مش رجوع صامت).
let redirectErrorShown = false;
const redirectSettled = getRedirectResult(auth).catch(e => {
  console.log('Redirect result error:', e);
  if (e?.code && e.code !== 'auth/no-auth-event') { redirectErrorShown = true; showLoginError(firebaseAuthErrorMessage(e)); }
  return null;
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

initOfflineHandling();

// Phase 2A: بوابة شرح إذن الموقع عند أول فتح للتطبيق - مستقلة تمامًا عن تسجيل الدخول/الدور،
// عشان تتماشى مع نفس الترتيب المطلوب (فتح التطبيق ← فحص الإذن ← شرح لو محتاج) من غير ما تلمس
// أي حاجة في auth.js أو منطق التوجيه حسب الدور.
initLocationPermissionGate();

// رجوعنا من تحويل Google؟ (التلميح بيتكتب قبل التحويل) => نص تحميل مناسب بدل "جاري التحميل..."
try { if (hasRedirectPending()) { const s = document.getElementById('ld-sub'); if (s) s.textContent = 'جاري إكمال تسجيل الدخول…'; } } catch(e) {}

onAuthStateChanged(auth, async user => {
  if (user) {
    const attempt = captureLoginIntent(); // الدور المختار + هل ده دخول جديد؟ (لازم قبل resetLoginState/clearRedirectPending)
    resetLoginState(); clearRedirectPending(); // Firebase أكّد الجلسة فعليًا => نفك زر الدخول ونمسح علامة الـ redirect
    // MATLABK: منع تسرّب حالة حساب لحساب تاني (تبديل حسابات Google): أي بيانات محلية مرتبطة بمستخدم سابق تتمسح.
    try {
      const last = localStorage.getItem('matlabk_last_uid');
      if (last && last !== user.uid) { localStorage.removeItem('manayef_drv_draft'); window.uploadedDocs = {}; window.cart = []; }
      localStorage.setItem('matlabk_last_uid', user.uid);
    } catch(e) {}
    window.CUD = null;
    window.CU = user;
    // بوابة الدور المشتركة (auth.js): قراءة users/{uid} + مقارنة الدور المختار بالفعلي + fail-closed، قبل أي لوحة.
    try { await handleSignedIn(user, attempt); }
    catch(e) {
      console.error('Auth routing error:', e);
      window.CUD = null; hideLoading();
      showScreen('screen-entry'); showLoginError(firebaseAuthErrorMessage(e));
    }
  } else {
    // MATLABK: "مفيش مستخدم" مش نهائي إلا بعد ما getRedirectResult يخلّص (منع race بين النتيجتين). لو كنا بادئين redirect نستنى أطول.
    const pending = hasRedirectPending();
    await withTimeout(redirectSettled, pending ? 12000 : 3000);
    const out = signedOutOutcome({ currentUser: auth.currentUser, redirectPending: pending, existingError: redirectErrorShown });
    if (out.action === 'ignore') return; // الجلسة اتأكدت فعليًا - الـ callback الخاص بالمستخدم هو اللي بيوجّه
    window.CU = null; window.CUD = null;
    hideLoading(); resetLoginState(); clearRedirectPending();
    const keep = out.error ? peekEntryType() : null; clearEntryIntent();
    if (keep) openLogin(keep); else showScreen('screen-entry');
    if (out.error) showLoginError(out.error); // رجوع من Google بدون جلسة: رسالة واضحة بدل الرجوع الصامت لشاشة الدخول
  }
});
