// ===== account-state.js (MATLABK) =====
// منطق نقي (بدون Firebase/DOM) لتحديد الشاشة الصحيحة من الحالة الفعلية للحساب. الواجهة بس بتوجّه المستخدم؛
// الحماية الحقيقية في firestore.rules (customerProfileComplete / driverSubmitComplete / merchantSubmitComplete ...).
// مطابقة للقواعد: status = incomplete -> pending(=pending_review) -> active(=approved) | rejected.
export const STATUS = Object.freeze({ INCOMPLETE: 'incomplete', PENDING: 'pending', ACTIVE: 'active', REJECTED: 'rejected', BLOCKED: 'blocked', DELETED: 'deleted' });

export function normalizePhone(p) { return String(p == null ? '' : p).trim().replace(/[\s-]/g, ''); }
// نفس شرط الـ Rules (10..15 حرف) + أرقام فقط وعلامة + اختيارية
export function isValidPhoneStrict(p) { const n = normalizePhone(p); return /^\+?\d{10,14}$/.test(n) && n.length <= 15; }

// مطابق لـ driverSubmitComplete في firestore.rules (رقم اللوحة ومواصفات المركبة اختياريان)
export function isDriverDataComplete(u) {
  return !!u && typeof u.fullName === 'string' && u.fullName.trim().length >= 2 && isValidPhoneStrict(u.phone) &&
    typeof u.nationalId === 'string' && u.nationalId.length === 14 &&
    !!u.vehicleType && u.docsSubmitted === true && !!u.docs && typeof u.docs === 'object' && Object.keys(u.docs).length > 0;
}
// pending بدون بيانات مكتملة = ليس طلبًا مقدَّمًا فعليًا -> يُعامل incomplete (Normalization على مستوى الواجهة؛ الترحيل الفعلي: scripts/normalize-pending.mjs)
export function effectiveStatus(u) {
  if (!u) return undefined;
  if (u.role === 'driver' && u.status === STATUS.PENDING && !isDriverDataComplete(u)) return STATUS.INCOMPLETE;
  return u.status;
}

export function isCustomerProfileComplete(u) {
  return !!u && typeof u.name === 'string' && u.name.trim().length >= 2 && isValidPhoneStrict(u.phone);
}

// returns: admin | blocked | customer-complete | customer-home | driver-register | driver-dashboard
//          | merchant-complete | merchant-status | merchant-dashboard | unknown
export function resolveRoute(u, ctx = {}) {
  if (!u) return 'unknown';
  const st = u.status;
  if (u.role === 'admin') return 'admin';
  if (u.role === 'driver') return st === STATUS.ACTIVE ? 'driver-dashboard' : 'driver-register';
  if (u.role === 'merchant') {
    if (st === STATUS.ACTIVE) return 'merchant-dashboard';
    if (st === STATUS.PENDING || st === STATUS.REJECTED) return 'merchant-status';
    return 'merchant-complete'; // incomplete أو أي حالة غير معروفة = لا صلاحيات تشغيلية
  }
  if (st === STATUS.BLOCKED || st === STATUS.DELETED) return 'blocked';
  return isCustomerProfileComplete(u) ? 'customer-home' : 'customer-complete';
}
