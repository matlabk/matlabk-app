// ===== auth-flow.js (MATLABK) =====
// منطق نقي (بدون Firebase/DOM) لقرارات تسجيل الدخول بـ Google: تفسير الأخطاء وقرار "مفيش مستخدم" بعد العودة من redirect.
// معزول عشان يتجرّب فعليًا بـ node --test (tests/auth-flow.test.mjs).

// code -> { message, silent?, offerRedirect? }. silent = لا رسالة للمستخدم (إلغاء ناتج عن ضغطة/نافذة تانية).
const TABLE = {
  'auth/popup-closed-by-user': { message: 'تم إغلاق نافذة Google قبل إكمال تسجيل الدخول. اضغط "المتابعة باستخدام Google" للمحاولة مرة أخرى.' },
  'auth/cancelled-popup-request': { message: '', silent: true },
  'auth/popup-blocked': { message: 'المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى، أو اختر "المتابعة بدون نافذة منبثقة".', offerRedirect: true },
  'auth/operation-not-supported-in-this-environment': { message: 'هذا المتصفح لا يدعم نافذة تسجيل الدخول المنبثقة. اختر "المتابعة بدون نافذة منبثقة" أو افتح الموقع من متصفح آخر.', offerRedirect: true },
  'auth/network-request-failed': { message: 'تعذّر الاتصال بالإنترنت. تأكد من الشبكة وحاول مرة أخرى.' },
  'auth/unauthorized-domain': { message: 'تعذّر تسجيل الدخول من هذا الرابط حاليًا. تواصل مع الدعم.' },
  'auth/too-many-requests': { message: 'محاولات كثيرة متتالية. انتظر قليلًا ثم حاول مرة أخرى.' },
  'auth/user-disabled': { message: 'هذا الحساب موقوف. تواصل مع الإدارة.' },
  'auth/operation-not-allowed': { message: 'تسجيل الدخول بـ Google غير متاح مؤقتًا. حاول لاحقًا.' },
  'auth/web-storage-unsupported': { message: 'متصفحك يمنع حفظ بيانات الدخول. فعّل التخزين أو جرّب متصفحًا آخر.' },
  'auth/account-exists-with-different-credential': { message: 'هذا البريد مسجّل بطريقة دخول قديمة لم تعد مدعومة. تواصل مع الإدارة لمساعدتك.' },
};
export const GENERIC_ERROR = 'حدث خطأ غير متوقع. حاول مرة أخرى.';
export const OFFLINE_ERROR = 'لا يوجد اتصال بالإنترنت. تأكد من الشبكة وحاول مرة أخرى.';
export const REDIRECT_FAILED = 'تعذّر إكمال تسجيل الدخول بعد العودة من Google على هذا المتصفح. جرّب "المتابعة باستخدام Google" مرة أخرى بالنافذة المنبثقة، أو افتح الموقع من متصفح آخر.';
export const SESSION_NOT_READY = 'تم اختيار الحساب لكن تعذّر إكمال الدخول. تأكد من الاتصال وحاول مرة أخرى.';

export function describeAuthError(e, { online = true } = {}) {
  if (online === false) return { message: OFFLINE_ERROR, silent: false, offerRedirect: false };
  const hit = TABLE[e && e.code];
  return hit ? { silent: false, offerRedirect: false, ...hit } : { message: GENERIC_ERROR, silent: false, offerRedirect: false };
}

// بعد ما onAuthStateChanged يبلّغ "مفيش مستخدم" (وبعد استنّينا نتيجة getRedirectResult):
//  - لو فيه auth.currentUser => السباق انتهى والـ callback بتاع المستخدم هو اللي بيوجّه => ignore.
//  - لو كنا بادئين redirect فعلًا ورجعنا بدون جلسة => ده فشل حقيقي (تخزين طرف ثالث محجوب) ولازم يتعرض بوضوح، مش رجوع صامت.
export function signedOutOutcome({ currentUser, redirectPending, existingError }) {
  if (currentUser) return { action: 'ignore', error: null };
  if (redirectPending && !existingError) return { action: 'show-login', error: REDIRECT_FAILED };
  return { action: 'show-login', error: null };
}

export const REDIRECT_PENDING_TTL_MS = 10 * 60 * 1000;
export function isRedirectPendingValid(stamp, now = Date.now()) {
  const t = Number(stamp);
  return Number.isFinite(t) && t > 0 && now - t >= 0 && now - t <= REDIRECT_PENDING_TTL_MS;
}
