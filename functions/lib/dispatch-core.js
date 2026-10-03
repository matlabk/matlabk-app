/**
 * MATLABK — dispatch-core (منطق نقي + orchestration بـ IO مُحقَن، بدون firebase-admin).
 * هو نفس منطق functions/index.js (اختيار الأقرب 3، المهلة/التدوير، التحقق من المسافة/السعر قبل الـdispatch، تقدم الطلب العالق)
 * لكن معزول عشان يتجرّب فعليًا بـ node --test (tests/functions-core.test.mjs) بدون Emulator.
 * أي حقل جديد هنا Backend-only (لا يظهر في أي allow-list للعميل في firestore.rules):
 *   triedDriverIds, dispatchRound, dispatchedAt, dispatchExhausted, distanceCheck, authoritativeDistanceKm, verifiedAt, needsReview, cancelReason
 */
'use strict';

const SERVER_TS = '__SERVER_TIMESTAMP__';
const RIDE_VEHICLES = ['motorcycle', 'tuktuk', 'car']; // نفس RIDE_ELIGIBLE_VEHICLES في js/utils.js

function readConfig(env = {}) {
  const num = (k, d) => (env[k] !== undefined && env[k] !== '' && Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
  return {
    maxCandidates: 3,
    freshMs: num('DRIVER_FRESH_MS', 2 * 60 * 1000),
    maxDriverKm: num('DISPATCH_MAX_KM', 15),
    offerTtlMs: num('OFFER_TTL_MS', 45 * 1000),         // rides / external
    orderOfferTtlMs: num('ORDER_OFFER_TTL_MS', 90 * 1000),
    maxRounds: num('DISPATCH_MAX_ROUNDS', 3),
    maxAgeMs: num('DISPATCH_MAX_AGE_MS', 30 * 60 * 1000), // بعدها الـ scheduler يبطّل يحاول (بس بيعلّم dispatchExhausted)
    advanceAfterMs: num('MERCHANT_ADVANCE_AFTER_MS', 30 * 1000),
    epDecisionTimeoutMs: num('EP_DECISION_TIMEOUT_MS', 30 * 60 * 1000), // 0 = معطّل
    routingBaseUrl: env.ROUTING_BASE_URL || '',
    routingTimeoutMs: num('ROUTING_TIMEOUT_MS', 5000),
    verifyBeforeDispatch: String(env.VERIFY_BEFORE_DISPATCH ?? 'true') !== 'false',
    allowUnverified: String(env.ALLOW_UNVERIFIED_DISPATCH ?? 'false') === 'true', // تجاوز صريح (staging بدون routing)
    tolerance: { ratio: 0.15, absKm: 1 },
  };
}

// ---------- geo ----------
const toRad = (d) => (d * Math.PI) / 180;
function isValidPoint(p) {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180 && !(p.lat === 0 && p.lng === 0);
}
function haversineKm(a, b) {
  const R = 6371, dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const tsMillis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  const sec = t.seconds ?? t._seconds; // Timestamp بعد serialization
  return Number.isFinite(sec) ? sec * 1000 + Math.floor((t.nanoseconds ?? t._nanoseconds ?? 0) / 1e6) : 0;
};

// ---------- drivers ----------
function driverEligible(u, now, cfg) {
  return !!u && u.role === 'driver' && u.status === 'active' && u.isOnline === true &&
    !u.activeOrderId && !u.activeRideId && !u.activeExternalPurchaseId &&
    isValidPoint({ lat: u.lat, lng: u.lng }) && tsMillis(u.lastSeen) > 0 && now - tsMillis(u.lastSeen) <= cfg.freshMs;
}
function rankCandidates(drivers, target, { exclude = [], vehicleTypes = null, now, cfg }) {
  if (!isValidPoint(target)) return [];
  const ex = new Set(exclude);
  return drivers
    .filter((u) => !ex.has(u.id) && driverEligible(u, now, cfg) && (!vehicleTypes || vehicleTypes.includes(u.vehicleType)))
    .map((u) => ({ id: u.id, km: haversineKm(target, { lat: u.lat, lng: u.lng }) }))
    .filter((c) => c.km <= cfg.maxDriverKm)
    .sort((a, b) => a.km - b.km || (a.id < b.id ? -1 : 1))
    .slice(0, cfg.maxCandidates)
    .map((c) => c.id);
}

// ---------- pricing / distance ----------
function fareFor(serviceCfg, km) {
  const base = Number(serviceCfg.baseFare) || 0, per = Number(serviceCfg.perKmRate) || 0, min = Number(serviceCfg.minimumFare) || 0, fee = Number(serviceCfg.bookingFee) || 0;
  const subtotal = base + km * per + fee;
  return { subtotal: Math.round(subtotal), finalFare: Math.round(Math.max(subtotal, min)) }; // نفس js/pricing.js:calculateFare
}
function distanceMismatch(clientKm, authKm, tol) {
  if (typeof clientKm !== 'number' || !Number.isFinite(clientKm)) return true;
  const diff = Math.abs(authKm - clientKm);
  return diff > tol.absKm && diff / Math.max(authKm, 0.1) > tol.ratio;
}
async function fetchRouteKm({ fetchFn, baseUrl, a, b, timeoutMs }) {
  if (!baseUrl) throw new Error('routing-not-configured');
  if (!isValidPoint(a) || !isValidPoint(b)) throw new Error('bad-coords');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchFn(`${baseUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { signal: ctl.signal });
    if (!r.ok) throw new Error('routing-http-' + r.status);
    const j = await r.json();
    const m = j && j.code === 'Ok' && j.routes && j.routes[0] && j.routes[0].distance;
    if (!(m >= 0) || !Number.isFinite(m)) throw new Error('routing-bad-response');
    return Math.round(m / 10) / 100;
  } finally { clearTimeout(timer); }
}

// ---------- per-kind descriptors ----------
function describe(kind, d) {
  if (kind === 'order') {
    const store = { lat: d.storeLat, lng: d.storeLng }, cust = { lat: d.customerLat, lng: d.customerLng };
    return { target: isValidPoint(store) ? store : cust, route: [store, cust], serviceType: 'delivery', vehicleTypes: null, offeredField: 'dispatchedAt', ttl: 'orderOfferTtlMs', feeField: 'driverFee', collection: 'orders' };
  }
  if (kind === 'ride') return { target: d.pickup && { lat: d.pickup.lat, lng: d.pickup.lng }, route: [d.pickup && { lat: d.pickup.lat, lng: d.pickup.lng }, d.dropoff && { lat: d.dropoff.lat, lng: d.dropoff.lng }], serviceType: 'ride', vehicleTypes: RIDE_VEHICLES, offeredField: 'offeredAt', ttl: 'offerTtlMs', feeField: null, collection: 'rides' };
  const p = d.pickupLocation;
  return { target: p && { lat: p.latitude, lng: p.longitude }, route: null, serviceType: 'external_purchase', vehicleTypes: RIDE_VEHICLES, offeredField: 'offeredAt', ttl: 'offerTtlMs', feeField: null, collection: 'external_purchases' };
}
const ageMs = (d, now) => { const c = tsMillis(d.createdAt) || tsMillis(d.updatedAt); return c ? now - c : 0; };

// ---------- verification (قبل الـ dispatch) ----------
async function planVerification(io, kind, d, cfg) {
  const ds = describe(kind, d);
  if (!ds.route) return { state: 'skip', patch: {} };
  if (['ok', 'corrected', 'unverified'].includes(d.distanceCheck)) return { state: 'done', patch: {} };
  if (!cfg.verifyBeforeDispatch) return { state: 'skip', patch: {} };
  const block = (code) => cfg.allowUnverified
    ? { state: 'unverified', patch: { distanceCheck: 'unverified', needsReview: true, verifiedAt: SERVER_TS } }
    : { state: 'unavailable', code, patch: d.distanceCheck === code ? {} : { distanceCheck: code } };
  const [a, b] = ds.route;
  if (!isValidPoint(a) || !isValidPoint(b)) return block('bad_coords');
  const pricing = await io.getPricing();
  if (!pricing || !pricing[ds.serviceType]) return block('pricing_missing');
  let authKm;
  try { authKm = await io.routeKm(a, b); } catch (e) { return block('routing_unavailable'); }
  const f = fareFor(pricing[ds.serviceType], authKm);
  const snapFare = d.pricingSnapshot && d.pricingSnapshot.finalFare;
  const bad = distanceMismatch(d.distanceKm, authKm, cfg.tolerance) || (typeof snapFare === 'number' ? Math.abs(snapFare - f.finalFare) > 1 : true);
  const patch = { distanceCheck: bad ? 'corrected' : 'ok', authoritativeDistanceKm: authKm, verifiedAt: SERVER_TS };
  if (bad) {
    patch.distanceKm = authKm;
    patch['pricingSnapshot.finalFare'] = f.finalFare;
    patch['pricingSnapshot.subtotal'] = f.subtotal;
    patch['pricingSnapshot.calculatedDistanceKm'] = authKm;
    if (ds.feeField) patch[ds.feeField] = f.finalFare;
    patch.needsReview = true;
  }
  return { state: bad ? 'corrected' : 'ok', patch };
}

// ---------- planning (نقي) ----------
const logEntry = (d, e) => [...(Array.isArray(d.dispatchLog) ? d.dispatchLog : []).slice(-17), e];
const unionTried = (d, ids) => [...new Set([...(d.triedDriverIds || []), ...ids])].slice(-50);

function planDispatch(kind, d, drivers, now, cfg) {
  const ds = describe(kind, d);
  const isOrder = kind === 'order';
  const offered = isOrder ? (d.status === 'searching_driver' && !d.driverId && (d.candidateDriverIds || []).length > 0) : d.status === 'driver_offered';
  const waiting = isOrder ? (d.status === 'searching_driver' && !d.driverId && !(d.candidateDriverIds || []).length) : d.status === 'requested';
  if (!offered && !waiting) return { action: 'noop', reason: 'not_dispatchable' };
  if (d.driverId) return { action: 'noop', reason: 'already_assigned' };
  const round = d.dispatchRound || 0;
  const current = d.candidateDriverIds || [];
  const tried = d.triedDriverIds || [];

  if (offered) {                                                      // تدوير: انتهت المهلة أو كل المرشحين فقدوا الأهلية
    const t0 = tsMillis(d[ds.offeredField]);
    const expired = t0 > 0 ? now - t0 >= cfg[ds.ttl] : true;
    const byId = new Map(drivers.map((u) => [u.id, u]));
    const allGone = current.length > 0 && current.every((id) => !driverEligible(byId.get(id), now, cfg) || (d.rejectedDriverIds || []).includes(id));
    if (!expired && !allGone) return { action: 'noop', reason: 'offer_active' };
    if (round >= cfg.maxRounds) return exhaust(kind, d, 'max_rounds', now);
    let ids = rankCandidates(drivers, ds.target, { exclude: [...tried, ...current], vehicleTypes: ds.vehicleTypes, now, cfg });
    if (!ids.length) ids = rankCandidates(drivers, ds.target, { exclude: current, vehicleTypes: ds.vehicleTypes, now, cfg }); // دورة جديدة بعد استنفاد المجموعة
    if (!ids.length) {
      if (isOrder) return { action: 'noop', reason: 'no_replacement_keep_current' };
      return { action: 'update', reason: 'no_driver_after_offer', patch: { status: 'requested', candidateDriverIds: [], rejectedDriverIds: [], triedDriverIds: unionTried(d, current), dispatchLog: logEntry(d, { event: 'offer_expired_no_replacement', at: now }), ...(kind === 'external' ? { updatedAt: SERVER_TS } : {}) } };
    }
    return { action: 'update', reason: 'rotated', patch: dispatchPatch(kind, d, ids, round + 1, unionTried(d, [...current, ...ids]), now) };
  }
  // waiting (أول مرة أو بعد requested)
  if (round >= cfg.maxRounds) return exhaust(kind, d, 'max_rounds', now);
  const age = ageMs(d, now);
  const ids = rankCandidates(drivers, ds.target, { exclude: tried, vehicleTypes: ds.vehicleTypes, now, cfg });
  const ids2 = ids.length ? ids : (tried.length ? rankCandidates(drivers, ds.target, { vehicleTypes: ds.vehicleTypes, now, cfg }) : []);
  if (!ids2.length) {
    if (age > cfg.maxAgeMs && !d.dispatchExhausted) return { action: 'update', reason: 'aged_out', patch: { dispatchExhausted: true } };
    return { action: 'noop', reason: 'no_driver_available' };           // لا كتابة => لا loop (الـ scheduler يعيد المحاولة)
  }
  return { action: 'update', reason: 'dispatched', patch: dispatchPatch(kind, d, ids2, round + 1, unionTried(d, ids2), now) };
}
function exhaust(kind, d, why, now) {
  if (d.dispatchExhausted && (kind === 'order' || d.status === 'requested')) return { action: 'noop', reason: 'exhausted' };
  const p = { dispatchExhausted: true };
  if (kind !== 'order' && d.status === 'driver_offered') Object.assign(p, { status: 'requested', candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: logEntry(d, { event: 'exhausted', at: now }), ...(kind === 'external' ? { updatedAt: SERVER_TS } : {}) });
  return { action: 'update', reason: 'exhausted:' + why, patch: p };
}
function dispatchPatch(kind, d, ids, round, tried, now) {
  if (kind === 'order') return { candidateDriverIds: ids, triedDriverIds: tried, dispatchRound: round, dispatchedAt: SERVER_TS, dispatchExhausted: false };
  return {
    status: 'driver_offered', candidateDriverIds: ids, rejectedDriverIds: [], triedDriverIds: tried, dispatchRound: round,
    offeredAt: SERVER_TS, dispatchExhausted: false,
    dispatchLog: logEntry(d, { event: 'backend_dispatch', at: now, candidateCount: ids.length, round }),
    ...(kind === 'external' ? { updatedAt: SERVER_TS } : {}),
  };
}

// merchant_accepted عالق => searching_driver
function planAdvanceMerchant(d, now, cfg) {
  if (d.status !== 'merchant_accepted') return { action: 'noop' };
  const t = tsMillis(d.updatedAt) || tsMillis(d.createdAt);
  if (t && now - t < cfg.advanceAfterMs) return { action: 'noop', reason: 'too_fresh' };
  const h = Array.isArray(d.statusHistory) ? d.statusHistory : [];
  return { action: 'update', patch: { status: 'searching_driver', updatedAt: SERVER_TS, statusHistory: [...h, { from: 'merchant_accepted', to: 'searching_driver', at: now, by: { type: 'system', name: 'backend' } }] } };
}
// external purchase عالق على قرار العميل
function planExternalStale(d, now, cfg) {
  if (!cfg.epDecisionTimeoutMs || !['item_unavailable', 'budget_exceeded'].includes(d.status)) return { action: 'noop' };
  const t = tsMillis(d.updatedAt);
  if (!t || now - t < cfg.epDecisionTimeoutMs) return { action: 'noop', reason: 'waiting_customer' };
  return { action: 'cancel', patch: { status: 'cancelled', cancelReason: 'customer_no_response', updatedAt: SERVER_TS }, notifyEvent: 'cancelled', clearDriver: d.driverId || null };
}

// precondition للـ transaction (race): حالة الـ dispatch لازم تفضل زي ما قرأناها
function sameDispatchState(a, b) {
  if (!a || !b) return false;
  const k = (x) => JSON.stringify([x.status, x.driverId || null, x.candidateDriverIds || [], x.dispatchRound || 0, x.distanceCheck || null]);
  return k(a) === k(b);
}

// ---------- orchestration (IO مُحقَن) ----------
async function dispatchDocument(io, kind, id, cfg) {
  const d = await io.getDoc(kind, id);
  if (!d) return { result: 'noop', reason: 'missing' };
  const now = io.now();
  // لا نتحقق/نكتب أي حاجة لو المستند مش في حالة dispatch أصلًا (مثلاً اتعيّن له كابتن)
  const pre = planDispatch(kind, d, [], now, cfg);
  if (pre.action === 'noop' && (pre.reason === 'not_dispatchable' || pre.reason === 'already_assigned')) return { result: 'noop', reason: pre.reason };
  const v = await planVerification(io, kind, d, cfg);
  if (v.state === 'unavailable') {
    if (Object.keys(v.patch).length) await io.applyPatch(kind, id, d, v.patch);
    return { result: 'blocked', reason: v.code };
  }
  const drivers = await io.loadDrivers();
  const plan = planDispatch(kind, d, drivers, now, cfg); // التحقق لا يغيّر الحالة/المرشحين، فالخطة على المستند كما قُرئ
  const patch = { ...v.patch, ...(plan.action === 'update' ? plan.patch : {}) };
  if (!Object.keys(patch).length) return { result: 'noop', reason: plan.reason };
  const ok = await io.applyPatch(kind, id, d, patch);
  if (!ok) return { result: 'conflict', reason: plan.reason };
  return { result: plan.action === 'update' ? plan.reason : 'verified_only', verification: v.state };
}

module.exports = { SERVER_TS, RIDE_VEHICLES, readConfig, isValidPoint, haversineKm, driverEligible, rankCandidates, fareFor, distanceMismatch, fetchRouteKm, describe, planVerification, planDispatch, planAdvanceMerchant, planExternalStale, sameDispatchState, dispatchDocument, tsMillis };
