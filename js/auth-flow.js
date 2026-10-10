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
// أخطاء البريد وكلمة المرور (رسائل عامة: لا نفرّق بين "البريد غير موجود" و"كلمة المرور غلط" عشان ما نكشفش مين مسجّل)
const BAD_CREDENTIALS = 'البريد الإلكتروني أو كلمة المرور غير صحيحة. إذا كنت سجّلت سابقًا عبر Google فاستخدم زر Google.';
const EMAIL_TABLE = {
  'auth/invalid-credential': { message: BAD_CREDENTIALS },
  'auth/wrong-password': { message: BAD_CREDENTIALS },
  'auth/user-not-found': { message: BAD_CREDENTIALS },
  'auth/invalid-login-credentials': { message: BAD_CREDENTIALS },
  'auth/invalid-email': { message: 'صيغة البريد الإلكتروني غير صحيحة. تأكد منه وحاول مرة أخرى.' },
  'auth/missing-password': { message: 'اكتب كلمة المرور.' },
  'auth/email-already-in-use': { message: 'هذا البريد الإلكتروني مسجّل بالفعل (ربما عبر Google). سجّل الدخول بالطريقة التي استخدمتها، أو اضغط «نسيت كلمة المرور؟».' },
  'auth/weak-password': { message: 'كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل.' },
  'auth/operation-not-allowed': { message: 'الدخول بالبريد الإلكتروني غير متاح حاليًا. استخدم Google أو تواصل مع الدعم.' },
  'auth/too-many-requests': { message: 'محاولات كثيرة متتالية. انتظر قليلًا ثم حاول مرة أخرى، أو استعد كلمة المرور.' },
};
export const MIN_PASSWORD_LENGTH = 8;
export const RESET_SENT = 'إذا كان هذا البريد مسجّلًا لدينا، فسيصلك رابط لإعادة تعيين كلمة المرور خلال دقائق. راجع الرسائل غير المرغوبة أيضًا.';
export const normalizeEmail = (v) => String(v == null ? '' : v).trim();
// تحقق بسيط للصيغة (التحقق النهائي من Firebase): شيء@شيء.شيء بدون مسافات
export function isValidEmail(v) { const e = normalizeEmail(v); return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
export function validateEmailLogin({ email, password }) {
  if (!isValidEmail(email)) return { ok: false, message: EMAIL_TABLE['auth/invalid-email'].message };
  if (typeof password !== 'string' || password.length === 0) return { ok: false, message: EMAIL_TABLE['auth/missing-password'].message };
  return { ok: true };
}
export function validateSignup({ email, password, confirm }) {
  if (!isValidEmail(email)) return { ok: false, message: EMAIL_TABLE['auth/invalid-email'].message };
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف.` };
  if (password.length > 128) return { ok: false, message: 'كلمة المرور طويلة جدًا (الحد الأقصى 128 حرفًا).' };
  if (password !== confirm) return { ok: false, message: 'كلمتا المرور غير متطابقتين.' };
  return { ok: true };
}
export const GENERIC_ERROR = 'حدث خطأ غير متوقع. حاول مرة أخرى.';
export const OFFLINE_ERROR = 'لا يوجد اتصال بالإنترنت. تأكد من الشبكة وحاول مرة أخرى.';
export const REDIRECT_FAILED = 'تعذّر إكمال تسجيل الدخول بعد العودة من Google على هذا المتصفح. جرّب "المتابعة باستخدام Google" مرة أخرى بالنافذة المنبثقة، أو افتح الموقع من متصفح آخر.';
export const SESSION_NOT_READY = 'تم اختيار الحساب لكن تعذّر إكمال الدخول. تأكد من الاتصال وحاول مرة أخرى.';

export function describeAuthError(e, { online = true, method = 'google' } = {}) {
  if (online === false) return { message: OFFLINE_ERROR, silent: false, offerRedirect: false };
  // أخطاء إعدادات المشروع (قيود مفتاح API على النطاق، مفتاح غير صالح، تطبيق غير مصرّح...): تؤثر على كل طرق الدخول معًا. رسالة تفرّق بينها
  // وبين "خطأ غير متوقع" (الرمز الأصلي يظهر في وضع التشخيص وفي console).
  const code = e && e.code;
  if (typeof code === 'string' && (/^auth\/requests-from-referer-/.test(code) || CONFIG_ERROR_CODES.has(code))) return { message: CONFIG_ERROR, silent: false, offerRedirect: false };
  // رسائل البريد/كلمة المرور لها الأولوية في مسار البريد (operation-not-allowed و too-many-requests بنصوص تناسبه)؛ مسار Google بلا تغيير.
  const hit = (method === 'email' && EMAIL_TABLE[e && e.code]) || TABLE[e && e.code];
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

// ===== فصل الأدوار (عميل / كابتن / تاجر) على نفس حساب Google =====
// الدور الحقيقي من Firestore (users/{uid}.role) - والـ Rules تمنع تغييره (role ثابت) وتمنع إنشاء مستند تاني بنفس الـ uid.
// intent = اللي المستخدم اختاره قبل Google (customer | driver | merchant). null = جلسة مستعادة (لم يختر شيئًا في هذه الزيارة) => نوجّه بالدور المخزّن.
// مبدأ الأمان: غياب الدور المختار في دخول جديد (fresh) أو دور غير معروف في Firestore **ليس تصريحًا** => رفض (fail-closed).
export const ROLE_LABELS = { customer: 'عميل', driver: 'كابتن', merchant: 'تاجر', admin: 'إدارة' };
export const INTENT_ROLES = ['customer', 'driver', 'merchant'];
const INTENT_AS = { customer: 'كعميل', driver: 'ككابتن', merchant: 'كتاجر' };

// نصوص شاشة الدخول لكل دور (تُعرض بعد اختيار نوع الحساب)
export const ROLE_UI = {
  customer: { title: 'الدخول كعميل', note: 'اطلب من متاجر المنايف وتابع طلباتك ومشاويرك.' },
  merchant: { title: 'الدخول كتاجر', note: 'بعد التسجيل تُراجَع بيانات متجرك من الإدارة قبل التفعيل.' },
  driver: { title: 'الدخول ككابتن توصيل', note: 'بعد التسجيل تُراجَع بياناتك من الإدارة قبل التفعيل.' },
};

export const MSG_USER_LOAD_FAILED = 'تعذّر تحميل بيانات حسابك. تأكد من الاتصال ثم اضغط «إعادة المحاولة».';
export const MSG_INVALID_ROLE = 'بيانات حسابك غير مكتملة أو غير صالحة، ولا يمكن فتح أي لوحة الآن. تواصل مع الدعم لمراجعة الحساب.';
export const MSG_INTENT_MISSING = 'لم نتمكن من تحديد نوع الحساب الذي اخترته. اختر نوع الحساب ثم سجّل الدخول مرة أخرى.';
const CONFIG_ERROR_CODES = new Set(['auth/invalid-api-key', 'auth/api-key-not-valid.-please-pass-a-valid-api-key.', 'auth/app-not-authorized', 'auth/configuration-not-found', 'auth/project-not-found', 'auth/invalid-app-credential', 'auth/app-not-installed']);
export const CONFIG_ERROR = 'تعذّر الاتصال بخدمة تسجيل الدخول بسبب إعدادات الخدمة. أبلغ الدعم بهذه المشكلة.';
export const OP_TIMEOUT_ERROR = 'استغرقت العملية وقتًا أطول من المعتاد. تأكد من الاتصال ثم حاول مرة أخرى.';
export const MSG_PROFILE_CREATE_FAILED = 'تم إنشاء حسابك لكن تعذّر حفظ بياناته. اضغط «إعادة المحاولة».';
export const MSG_ROLE_REQUIRED = 'اختر نوع الحساب أولًا (عميل أو تاجر أو كابتن).';

// رسالة التعارض. لا نكشف شيئًا عن حساب الإدارة (نص عام) - صاحب الحساب الحقيقي فقط هو اللي وصل لهنا بعد Google.
export function roleIntentConflict(intent, role, method = 'google') {
  if (!INTENT_AS[intent]) return null;
  if (!ROLE_LABELS[role]) return null; // الدور غير المعروف يعالجه evaluateRoleGate (deny) - مش تصريح
  if (role === intent) return null;
  // حساب الإدارة بيدخل من زر "عميل" (بدون خيار ظاهر للإدارة)؛ الصلاحية الفعلية من users.role في Firestore.
  if (role === 'admin' && intent === 'customer') return null;
  const registered = role === 'admin' ? 'بحساب آخر في MATLABK' : `كحساب ${ROLE_LABELS[role]}`;
  const other = method === 'email' ? 'ببريد إلكتروني آخر' : 'ببريد Google آخر';
  return `هذا البريد الإلكتروني مسجّل بالفعل ${registered}. لاستخدام MATLABK ${INTENT_AS[intent]}، يُرجى تسجيل الدخول ${other}.`;
}

// قرار البوابة بعد تأكيد Firebase للجلسة وقراءة users/{uid} (دالة نقية - مصدر القرار الوحيد قبل فتح أي لوحة):
//  register: لا يوجد مستند مستخدم (حساب جديد)  |  allow: يُوجَّه حسب الدور المخزّن
//  reject: تعارض دور (رسالة + خروج، الرجوع لشاشة الدخول بنفس الدور)  |  deny: حالة غير آمنة (رسالة + خروج)
export function evaluateRoleGate({ intent = null, fresh = false, exists, role, method = 'google' }) {
  if (!exists) return { action: 'register' };
  if (!ROLE_LABELS[role]) return { action: 'deny', reason: 'invalid-role', message: MSG_INVALID_ROLE };
  if (fresh && !INTENT_ROLES.includes(intent)) return { action: 'deny', reason: 'intent-missing', message: MSG_INTENT_MISSING };
  const msg = roleIntentConflict(intent, role, method);
  if (msg) return { action: 'reject', reason: 'role-mismatch', message: msg };
  return { action: 'allow' };
}

// ===== حفظ الدور المختار (sessionStorage = للنجاة من إعادة تحميل الصفحة فقط، مش مصدر صلاحيات) =====
export const INTENT_TTL_MS = 10 * 60 * 1000;
export function encodeIntent(type, now = Date.now()) {
  return INTENT_ROLES.includes(type) ? JSON.stringify({ t: type, ts: now }) : null;
}
export function decodeIntent(raw, now = Date.now()) {
  if (typeof raw !== 'string' || !raw) return null;
  let o; try { o = JSON.parse(raw); } catch (e) { return null; }
  if (!o || !INTENT_ROLES.includes(o.t)) return null;
  const age = now - Number(o.ts);
  return Number.isFinite(age) && age >= 0 && age <= INTENT_TTL_MS ? o.t : null;
}
