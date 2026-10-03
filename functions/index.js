/**
 * MATLABK backend (Cloud Functions v2) — NOT DEPLOYED. أسماء الـ exports كما هي: dispatchOrder, dispatchRide, dispatchExternal,
 * redispatchStale, verifyOrderDistance, verifyRideDistance, aggregateOrderStats.
 * المنطق كله في lib/dispatch-core.js (مُختبَر محليًا في tests/functions-core.test.mjs)؛ هنا IO فقط (Admin SDK + Transactions).
 * الإعداد (env): ROUTING_BASE_URL (OSRM-compatible، مطلوب للتحقق الموثوق من المسافة)، وباقي القيم اختيارية (انظر readConfig).
 * لا ينفع يتشغّل Production قبل: اختبار Emulator + staging. لا يوجد firebase deploy في هذه المرحلة.
 */
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const core = require('./lib/dispatch-core');

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const cfg = core.readConfig(process.env);
const COLL = { order: 'orders', ride: 'rides', external: 'external_purchases' };

const withTs = (patch) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === core.SERVER_TS ? FieldValue.serverTimestamp() : v]));

// IO حقيقي (Admin SDK). applyPatch = Transaction بـ precondition (يمنع تكرار/سباق الـ dispatch).
const io = {
  now: () => Date.now(),
  async getDoc(kind, id) { const s = await db.collection(COLL[kind]).doc(id).get(); return s.exists ? s.data() : null; },
  async loadDrivers() {
    const s = await db.collection('users').where('role', '==', 'driver').where('status', '==', 'active').where('isOnline', '==', true).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
  async getPricing() { const s = await db.doc('settings/pricing').get(); return s.exists ? s.data() : null; },
  routeKm: (a, b) => core.fetchRouteKm({ fetchFn: fetch, baseUrl: cfg.routingBaseUrl, a, b, timeoutMs: cfg.routingTimeoutMs }),
  async applyPatch(kind, id, expected, patch) {
    const ref = db.collection(COLL[kind]).doc(id);
    return db.runTransaction(async (t) => {
      const cur = await t.get(ref);
      if (!cur.exists || !core.sameDispatchState(expected, cur.data())) return false;
      t.update(ref, withTs(patch));
      return true;
    });
  },
};

const safe = (label, fn) => async (...a) => { try { return await fn(...a); } catch (e) { console.error(`[${label}] failed`, e); } };

// ---------- triggers: بس عند "دخول" الحالة المطلوبة (مفيش loop من كتابات الـ function نفسها) ----------
const entered = (e, status) => {
  const after = e.data.after.exists ? e.data.after.data() : null; const before = e.data.before.exists ? e.data.before.data() : null;
  return !!after && after.status === status && (!before || before.status !== status);
};
exports.dispatchOrder = onDocumentWritten('orders/{id}', safe('dispatchOrder', async (e) => {
  if (entered(e, 'searching_driver')) console.log('dispatchOrder', e.params.id, await core.dispatchDocument(io, 'order', e.params.id, cfg));
}));
exports.dispatchRide = onDocumentWritten('rides/{id}', safe('dispatchRide', async (e) => {
  if (entered(e, 'requested')) console.log('dispatchRide', e.params.id, await core.dispatchDocument(io, 'ride', e.params.id, cfg));
}));
exports.dispatchExternal = onDocumentWritten('external_purchases/{id}', safe('dispatchExternal', async (e) => {
  if (entered(e, 'requested')) console.log('dispatchExternal', e.params.id, await core.dispatchDocument(io, 'external', e.params.id, cfg));
}));

// ---------- تحقق مبكر من المسافة/السعر عند الإنشاء (نفس المنطق اللي بيتنفّذ قبل الـ dispatch؛ idempotent) ----------
async function verifyEarly(kind, id) {
  const d = await io.getDoc(kind, id); if (!d) return;
  const v = await core.planVerification(io, kind, d, cfg);
  if (Object.keys(v.patch).length) await io.applyPatch(kind, id, d, v.patch);
}
exports.verifyOrderDistance = onDocumentCreated('orders/{id}', safe('verifyOrderDistance', (e) => verifyEarly('order', e.params.id)));
exports.verifyRideDistance = onDocumentCreated('rides/{id}', safe('verifyRideDistance', (e) => verifyEarly('ride', e.params.id)));

// ---------- scheduler: مهلة العرض/تدوير المرشحين/طلبات بلا كابتن/merchant_accepted عالق/EP عالق ----------
exports.redispatchStale = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 120 }, safe('redispatchStale', async () => {
  const now = Date.now();
  const drivers = await io.loadDrivers();
  const cachedIo = { ...io, loadDrivers: async () => drivers };
  // 1) merchant_accepted عالق -> searching_driver (شبكة أمان لو الخطوة الثانية في merchantRespond فشلت)
  for (const doc of (await db.collection('orders').where('status', '==', 'merchant_accepted').limit(100).get()).docs) {
    const d = doc.data(); const plan = core.planAdvanceMerchant(d, now, cfg);
    if (plan.action === 'update') { await db.runTransaction(async (t) => { const c = await t.get(doc.ref); if (c.data().status === 'merchant_accepted') t.update(doc.ref, withTs(plan.patch)); }); }
  }
  // 2) dispatch/تدوير للطلبات والمشاوير والشراء الخارجي
  const work = [['order', 'orders', 'searching_driver'], ['ride', 'rides', 'requested'], ['ride', 'rides', 'driver_offered'], ['external', 'external_purchases', 'requested'], ['external', 'external_purchases', 'driver_offered']];
  for (const [kind, col, status] of work) {
    for (const doc of (await db.collection(col).where('status', '==', status).limit(200).get()).docs) {
      const d = doc.data(); if (d.dispatchExhausted === true && status !== 'driver_offered') continue;
      console.log('scheduler', kind, doc.id, await core.dispatchDocument(cachedIo, kind, doc.id, cfg));
    }
  }
  // 3) external purchase عالق على قرار العميل
  for (const doc of (await db.collection('external_purchases').where('status', 'in', ['item_unavailable', 'budget_exceeded']).limit(100).get()).docs) {
    const d = doc.data(); const plan = core.planExternalStale(d, now, cfg); if (plan.action !== 'cancel') continue;
    await db.runTransaction(async (t) => {
      const c = await t.get(doc.ref); if (c.data().status !== d.status) return;
      t.update(doc.ref, withTs(plan.patch));
      if (plan.clearDriver) t.update(db.collection('users').doc(plan.clearDriver), { activeExternalPurchaseId: null });
      for (const uid of [d.customerId, plan.clearDriver].filter(Boolean)) {
        t.set(db.collection('notifications').doc(`external_purchase_${doc.id}_cancelled_${uid}`), { userId: uid, title: 'تم إلغاء الطلب', body: 'تم إلغاء الطلب لعدم الرد في الوقت المحدد', type: 'gn', entityType: 'external_purchase', entityId: doc.id, eventKey: 'cancelled', read: false, createdAt: FieldValue.serverTimestamp() });
      }
    });
  }
}));

// ---------- Stats aggregates (لوحة الإدارة) ----------
exports.aggregateOrderStats = onDocumentWritten('orders/{id}', safe('aggregateOrderStats', async (e) => {
  const b = e.data.before.exists ? e.data.before.data() : null, a = e.data.after.exists ? e.data.after.data() : null;
  const wasDone = b && b.status === 'delivered', isDone = a && a.status === 'delivered';
  if (wasDone === isDone) return;
  const sign = isDone ? 1 : -1, src = a || b;
  await db.doc('stats/global').set({
    deliveredOrders: FieldValue.increment(sign), deliveredTotal: FieldValue.increment(sign * (src.total || 0)),
    commissionTotal: FieldValue.increment(sign * (src.commission || 0)), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}));
