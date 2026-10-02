/**
 * MATLABK backend (Cloud Functions v2) — NOT DEPLOYED / NOT TESTED in this audit.
 * يتطلب خطة Blaze. يغطي:
 *   1) Dispatcher موثوق (orders / rides / external_purchases) يكتب candidateDriverIds بالـ Admin SDK.
 *   2) التحقق الموثوق من المسافة والسعر (Authoritative distance/fare) وتصحيح القيم أو وضع علامة مراجعة.
 * الإعدادات: firebase functions:config أو متغيرات بيئة:  ROUTING_BASE_URL (OSRM-compatible, self-hosted).
 * بعد النشر: ضع settings/dispatch.legacyOpenOrderRead=false (أو احذفه) و window.APP_CONFIG.backendDispatch=true.
 */
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const MAX_CANDIDATES = 3;
const FRESH_MS = 2 * 60 * 1000;           // آخر موقع للمندوب لازم يكون أحدث من دقيقتين
const ROUTING_BASE_URL = process.env.ROUTING_BASE_URL; // مطلوب للتحقق الموثوق من المسافة
const DIST_TOLERANCE = { ratio: 0.15, absKm: 1 };

const toRad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const R = 6371, dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function pickCandidates(target, { exclude = [], vehicleTypes = null } = {}) {
  const snap = await db.collection('users')
    .where('role', '==', 'driver').where('status', '==', 'active').where('isOnline', '==', true).get();
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => !exclude.includes(u.id)
      && !u.activeOrderId && !u.activeRideId && !u.activeExternalPurchaseId
      && typeof u.lat === 'number' && typeof u.lng === 'number'
      && u.lastSeen && now - u.lastSeen.toMillis() <= FRESH_MS
      && (!vehicleTypes || vehicleTypes.includes(u.vehicleType)))
    .map((u) => ({ id: u.id, km: haversineKm(target, { lat: u.lat, lng: u.lng }) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.id);
}

// ---------- orders: searching_driver -> candidateDriverIds ----------
exports.dispatchOrder = onDocumentWritten('orders/{id}', async (event) => {
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.status !== 'searching_driver' || after.driverId) return;
  if ((after.candidateDriverIds || []).length > 0) return;       // idempotent
  const target = { lat: after.storeLat ?? after.customerLat, lng: after.storeLng ?? after.customerLng };
  if (typeof target.lat !== 'number') return;
  const ids = await pickCandidates(target);
  await event.data.after.ref.update({
    candidateDriverIds: ids, dispatchedAt: FieldValue.serverTimestamp(),
    dispatchRound: (after.dispatchRound || 0) + 1,
  });
});

// ---------- rides / external: requested -> driver_offered ----------
async function dispatchOffer(ref, data, target, vehicleTypes) {
  if (data.status !== 'requested' || data.driverId) return;
  const ids = await pickCandidates(target, { vehicleTypes });
  if (!ids.length) return;
  await db.runTransaction(async (t) => {
    const cur = await t.get(ref);
    if (cur.data().status !== 'requested') return;                // سباق: اتعالج بالفعل
    t.update(ref, {
      status: 'driver_offered', candidateDriverIds: ids, rejectedDriverIds: [],
      offeredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      dispatchLog: [...(cur.data().dispatchLog || []).slice(-18), { event: 'backend_dispatch', at: Date.now(), candidateCount: ids.length }],
    });
  });
}
exports.dispatchRide = onDocumentWritten('rides/{id}', async (e) => {
  const d = e.data.after.exists ? e.data.after.data() : null;
  if (d) await dispatchOffer(e.data.after.ref, d, d.pickup, ['motorcycle', 'tuktuk', 'car']);
});
exports.dispatchExternal = onDocumentWritten('external_purchases/{id}', async (e) => {
  const d = e.data.after.exists ? e.data.after.data() : null;
  const p = d && d.pickupLocation;
  if (d && p) await dispatchOffer(e.data.after.ref, d, { lat: p.latitude, lng: p.longitude }, ['motorcycle', 'tuktuk', 'car']);
});

// إعادة محاولة: عروض منتهية (>45s بدون قبول) ترجع requested، وطلبات searching_driver بدون مرشحين تتوسع.
exports.redispatchStale = onSchedule('every 1 minutes', async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 45 * 1000);
  for (const col of ['rides', 'external_purchases']) {
    const s = await db.collection(col).where('status', '==', 'driver_offered').where('offeredAt', '<', cutoff).get();
    for (const d of s.docs) await d.ref.update({ status: 'requested', candidateDriverIds: [], rejectedDriverIds: [], updatedAt: FieldValue.serverTimestamp() });
  }
  const o = await db.collection('orders').where('status', '==', 'searching_driver').where('driverId', '==', null).get();
  for (const d of o.docs) {
    const x = d.data(); if ((x.candidateDriverIds || []).length) continue;
    const ids = await pickCandidates({ lat: x.storeLat ?? x.customerLat, lng: x.storeLng ?? x.customerLng });
    if (ids.length) await d.ref.update({ candidateDriverIds: ids, dispatchRound: (x.dispatchRound || 0) + 1 });
  }
});

// ---------- Authoritative distance/fare ----------
async function serverRouteKm(a, b) {
  if (!ROUTING_BASE_URL) throw new Error('ROUTING_BASE_URL not configured');
  const r = await fetch(`${ROUTING_BASE_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error('routing failed');
  return Math.round(j.routes[0].distance / 10) / 100;
}
function fare(cfg, distanceKm) {
  const sub = (cfg.baseFare || 0) + distanceKm * (cfg.perKmRate || 0) + (cfg.bookingFee || 0);
  return Math.round(Math.max(sub, cfg.minimumFare || 0));
}
async function verify(ref, data, a, b, serviceType, feeField) {
  if (typeof data.distanceKm !== 'number') return;
  const pricing = (await db.doc('settings/pricing').get()).data();
  const authKm = await serverRouteKm(a, b);
  const diff = Math.abs(authKm - data.distanceKm);
  const bad = diff > DIST_TOLERANCE.absKm && diff / Math.max(authKm, 0.1) > DIST_TOLERANCE.ratio;
  const authFare = fare(pricing[serviceType], authKm);
  const patch = { distanceCheck: bad ? 'mismatch' : 'ok', authoritativeDistanceKm: authKm, authoritativeFare: authFare, verifiedAt: FieldValue.serverTimestamp() };
  if (bad) {                                   // تصحيح القيم المالية بقيم السيرفر + علامة مراجعة
    patch.distanceKm = authKm;
    patch['pricingSnapshot.finalFare'] = authFare;
    patch['pricingSnapshot.calculatedDistanceKm'] = authKm;
    if (feeField) patch[feeField] = authFare;
    patch.needsReview = true;
  }
  await ref.update(patch);
}
exports.verifyOrderDistance = onDocumentCreated('orders/{id}', async (e) => {
  const d = e.data.data();
  if (typeof d.storeLat === 'number') await verify(e.data.ref, d, { lat: d.storeLat, lng: d.storeLng }, { lat: d.customerLat, lng: d.customerLng }, 'delivery', 'driverFee');
});
exports.verifyRideDistance = onDocumentCreated('rides/{id}', async (e) => {
  const d = e.data.data();
  await verify(e.data.ref, d, d.pickup, d.dropoff, 'ride', null);
});
// ملاحظة: التصحيح بعد الكتابة (post-hoc). النموذج الأقوى: callable createOrder/createRide يحسب المسار والسعر ويكتب
// بالـ Admin SDK، وقواعد create للعميل تتقفل (allow create: if false). مؤجّل لأنه تغيير معماري أكبر.

// ---------- Stats aggregates (للوحة الإدارة بدل تحميل كل الطلبات) ----------
exports.aggregateOrderStats = onDocumentWritten('orders/{id}', async (e) => {
  const b = e.data.before.exists ? e.data.before.data() : null, a = e.data.after.exists ? e.data.after.data() : null;
  const wasDone = b && b.status === 'delivered', isDone = a && a.status === 'delivered';
  if (wasDone === isDone) return;
  const sign = isDone ? 1 : -1, src = a || b;
  await db.doc('stats/global').set({
    deliveredOrders: FieldValue.increment(sign),
    deliveredTotal: FieldValue.increment(sign * (src.total || 0)),
    commissionTotal: FieldValue.increment(sign * (src.commission || 0)),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
});
