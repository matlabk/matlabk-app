#!/usr/bin/env node
// MATLABK — ترحيل حتمي (deterministic) للحسابات pending الناقصة إلى incomplete. غير مدمّر: يغيّر users.status فقط.
// الاستخدام:  GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/normalize-pending.mjs            (Dry-run - تقرير فقط)
//             GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/normalize-pending.mjs --apply    (تنفيذ)
// يحتاج: npm i firebase-admin (غير مثبّت في المشروع عمدًا). منطق التصنيف نقي ومُختبَر في tests/normalize-pending.test.mjs.
export const validPhone = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 15;
export function driverComplete(u) {
  return typeof u.fullName === 'string' && u.fullName.length >= 2 && validPhone(u.phone) &&
    typeof u.nationalId === 'string' && u.nationalId.length === 14 && !!u.vehicleType &&
    // plateNumber / vehicleModel / vehicleColor اختياريون
    u.docsSubmitted === true && !!u.docs && typeof u.docs === 'object' && Object.keys(u.docs).length > 0;
}
export function merchantComplete(store) {
  return !!store && typeof store.storeName === 'string' && store.storeName.length > 0 && validPhone(store.storePhone);
}
// returns { action: 'keep'|'to_incomplete', reason }
export function classify(user, store) {
  if (!user || user.status !== 'pending') return { action: 'keep', reason: 'not pending' };
  if (user.role === 'driver') return driverComplete(user) ? { action: 'keep', reason: 'complete driver application' } : { action: 'to_incomplete', reason: 'driver pending without complete data/docs' };
  if (user.role === 'merchant') return merchantComplete(store) ? { action: 'keep', reason: 'complete merchant application' } : { action: 'to_incomplete', reason: 'merchant pending without valid store data' };
  return { action: 'keep', reason: 'role not driver/merchant' };
}
async function main() {
  const apply = process.argv.includes('--apply');
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() }); const db = getFirestore();
  const snap = await db.collection('users').where('status', '==', 'pending').get();
  const report = [];
  for (const d of snap.docs) {
    const u = d.data(); const store = u.role === 'merchant' ? (await db.doc(`stores/${d.id}`).get()).data() : null;
    const c = classify(u, store); report.push({ uid: d.id, role: u.role, ...c });
    if (apply && c.action === 'to_incomplete') await d.ref.update({ status: 'incomplete', normalizedAt: FieldValue.serverTimestamp(), normalizedFrom: 'pending' });
  }
  console.table(report); console.log(apply ? 'APPLIED' : 'DRY-RUN (use --apply)', report.filter((r) => r.action === 'to_incomplete').length, 'to normalize of', report.length);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().catch((e) => { console.error(e); process.exit(1); });
