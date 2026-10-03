// node --test tests/functions-core.test.mjs — يختبر منطق functions/lib/dispatch-core.js فعليًا بـ IO في الذاكرة (لا Emulator).
// ملاحظة صريحة: ده اختبار منطق الـ dispatcher، مش اختبار نشر/Triggers/Transactions الحقيقية لـ Firestore (NOT VERIFIED).
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module'; import fs from 'node:fs';
const core = createRequire(import.meta.url)('../functions/lib/dispatch-core.js');
const cfg = core.readConfig({ ROUTING_BASE_URL: 'http://r' });
const T0 = 1_700_000_000_000; class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } } const ts = (ms) => new Ts(ms);
const clone = (v) => (v instanceof Ts ? v : Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v); // يحافظ على كائنات Timestamp زي Firestore
const drv = (id, over = {}) => ({ id, role: 'driver', status: 'active', isOnline: true, lat: 30.0, lng: 32.0, vehicleType: 'motorcycle', lastSeen: ts(T0 - 10_000), activeOrderId: null, activeRideId: null, activeExternalPurchaseId: null, ...over });
const at = (km) => ({ lat: 30.0 + km / 111, lng: 32.0 }); // نقطة على بعد km تقريبًا شمالًا
const D = (id, km, over = {}) => drv(id, { ...at(km), ...over });

// ----- in-memory IO -----
function makeIO({ docs = {}, drivers = [], pricing = { delivery: { baseFare: 10, perKmRate: 2, minimumFare: 10, bookingFee: 0 }, ride: { baseFare: 5, perKmRate: 3, minimumFare: 10, bookingFee: 0 } }, route = () => 5, now = T0 } = {}) {
  const db = clone(docs); let clock = now; const log = [];
  const setPath = (o, k, v) => { const p = k.split('.'); let c = o; for (const x of p.slice(0, -1)) c = c[x] = c[x] || {}; c[p.at(-1)] = v; };
  return {
    db, log, advance: (ms) => { clock += ms; },
    now: () => clock,
    getDoc: async (kind, id) => (db[kind + ':' + id] ? clone(db[kind + ':' + id]) : null),
    loadDrivers: async () => drivers,
    getPricing: async () => pricing,
    routeKm: async (a, b) => route(a, b),
    applyPatch: async (kind, id, expected, patch) => {
      const cur = db[kind + ':' + id]; if (!cur || !core.sameDispatchState(expected, cur)) return false;
      for (const [k, v] of Object.entries(patch)) setPath(cur, k, v === core.SERVER_TS ? ts(clock) : v); log.push({ kind, id, patch }); return true;
    },
  };
}
const order = (o = {}) => ({ status: 'searching_driver', driverId: null, candidateDriverIds: [], storeLat: 30.0, storeLng: 32.0, customerLat: 30.02, customerLng: 32.0, distanceKm: 5, driverFee: 20, pricingSnapshot: { finalFare: 20, subtotal: 20 }, createdAt: ts(T0 - 1000), ...o });
const ride = (o = {}) => ({ status: 'requested', driverId: null, candidateDriverIds: [], rejectedDriverIds: [], pickup: { lat: 30, lng: 32 }, dropoff: { lat: 30.05, lng: 32 }, vehicleType: 'car', distanceKm: 5, pricingSnapshot: { finalFare: 20, subtotal: 20 }, dispatchLog: [], createdAt: ts(T0 - 1000), ...o });
const ep = (o = {}) => ({ status: 'requested', driverId: null, candidateDriverIds: [], rejectedDriverIds: [], pickupLocation: { latitude: 30, longitude: 32 }, dispatchLog: [], createdAt: ts(T0 - 1000), updatedAt: ts(T0 - 1000), ...o });

test('أقرب 3 فعلًا: ترتيب بالمسافة، حد أقصى 3، استبعاد البعيد جدًا', async () => {
  const drivers = [D('far', 40), D('d3', 3), D('d1', 1), D('d2', 2), D('d4', 4)];
  const io = makeIO({ docs: { 'order:o': order() }, drivers });
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'dispatched');
  assert.deepEqual(io.db['order:o'].candidateDriverIds, ['d1', 'd2', 'd3']); // far (40km) خارج maxDriverKm=15
});
test('استبعاد: Offline / لا lastSeen / lastSeen قديم / مهمة نشطة / غير active / إحداثيات غير صالحة / مركبة غير مناسبة', () => {
  const now = T0; const base = [D('ok', 1), D('off', 1, { isOnline: false }), D('stale', 1, { lastSeen: ts(T0 - 10 * 60_000) }), D('nols', 1, { lastSeen: undefined }),
    D('busyO', 1, { activeOrderId: 'x' }), D('busyR', 1, { activeRideId: 'x' }), D('busyE', 1, { activeExternalPurchaseId: 'x' }), D('pend', 1, { status: 'pending' }),
    D('nan', 1, { lat: NaN }), D('zero', 1, { lat: 0, lng: 0 }), D('bike', 1, { vehicleType: 'bicycle' })];
  assert.deepEqual(core.rankCandidates(base, { lat: 30, lng: 32 }, { vehicleTypes: core.RIDE_VEHICLES, now, cfg }), ['ok']);
  assert.deepEqual(core.rankCandidates(base, { lat: NaN, lng: 32 }, { now, cfg }), []);
});
test('لا مرشحين: لا كتابة (لا loop) ويرجع noop', async () => {
  const io = makeIO({ docs: { 'order:o': order() }, drivers: [] });
  const r = await core.dispatchDocument(io, 'order', 'o', cfg);
  assert.equal(r.result, 'verified_only'); assert.equal(io.log.length, 1); // مرة واحدة: علامة التحقق فقط
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'noop'); assert.equal(io.log.length, 1); // وبعدها لا كتابة => لا loop
});
test('سباق: تشغيل dispatch مرتين بالتوازي => واحد بس ينجح والتاني conflict/noop، والمرشحون لا يتكررون', async () => {
  const io = makeIO({ docs: { 'order:o': order() }, drivers: [D('a', 1), D('b', 2), D('c', 3)] });
  const orig = io.getDoc; let gate; const both = new Promise((r) => { gate = r; }); let n = 0;
  io.getDoc = async (...a) => { const v = await orig(...a); if (++n === 2) gate(); await both; return v; }; // الاتنين يقروا نفس الحالة القديمة
  const [r1, r2] = await Promise.all([core.dispatchDocument(io, 'order', 'o', cfg), core.dispatchDocument(io, 'order', 'o', cfg)]);
  assert.deepEqual([r1.result, r2.result].sort(), ['conflict', 'dispatched']);
  assert.equal(io.db['order:o'].dispatchRound, 1); assert.equal(io.log.length, 1);
});
test('طلب اتعيّن له كابتن: لا dispatch', async () => {
  const io = makeIO({ docs: { 'order:o': order({ status: 'driver_assigned', driverId: 'x' }) }, drivers: [D('a', 1)] });
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'noop');
});
test('عدم استجابة: بعد المهلة يتبدّل المرشحون بدون تكرار الأولين (طلب)', async () => {
  const drivers = [D('a', 1), D('b', 2), D('c', 3), D('d', 4), D('e', 5), D('f', 6)];
  const io = makeIO({ docs: { 'order:o': order() }, drivers });
  await core.dispatchDocument(io, 'order', 'o', cfg); assert.deepEqual(io.db['order:o'].candidateDriverIds, ['a', 'b', 'c']);
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'noop'); // العرض لسه شغال
  io.advance(cfg.orderOfferTtlMs + 1000); for (const x of drivers) x.lastSeen = ts(io.now() - 5000);
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'rotated');
  assert.deepEqual(io.db['order:o'].candidateDriverIds, ['d', 'e', 'f']); assert.equal(io.db['order:o'].dispatchRound, 2);
});
test('كل المرشحين Offline => تدوير فوري قبل المهلة', async () => {
  const drivers = [D('a', 1), D('b', 2), D('c', 3), D('d', 4)];
  const io = makeIO({ docs: { 'order:o': order() }, drivers }); await core.dispatchDocument(io, 'order', 'o', cfg);
  for (const x of ['a', 'b', 'c']) drivers.find((d) => d.id === x).isOnline = false;
  const r = await core.dispatchDocument(io, 'order', 'o', cfg); assert.equal(r.result, 'rotated'); assert.deepEqual(io.db['order:o'].candidateDriverIds, ['d']);
});
test('حد التدوير: بعد maxRounds => dispatchExhausted ولا إرسال جديد (طلب)', async () => {
  const drivers = Array.from({ length: 12 }, (_, i) => D('d' + i, i + 1)); const io = makeIO({ docs: { 'order:o': order() }, drivers });
  for (let i = 0; i < 6; i++) { await core.dispatchDocument(io, 'order', 'o', cfg); io.advance(cfg.orderOfferTtlMs + 1000); drivers.forEach((x) => { x.lastSeen = ts(io.now() - 1000); }); }
  assert.equal(io.db['order:o'].dispatchRound, cfg.maxRounds); assert.equal(io.db['order:o'].dispatchExhausted, true);
  const before = io.log.length; await core.dispatchDocument(io, 'order', 'o', cfg); assert.equal(io.log.length, before);
});
test('مشوار: requested -> driver_offered بأقرب 3 ومركبة مناسبة، rejectedDriverIds فاضية', async () => {
  const io = makeIO({ docs: { 'ride:r': ride() }, drivers: [D('m1', 1, { vehicleType: 'motorcycle' }), D('x', 0.5, { vehicleType: 'bicycle' }), D('c1', 2), D('c2', 3), D('c3', 4)] });
  const r = await core.dispatchDocument(io, 'ride', 'r', cfg);
  assert.equal(r.result, 'dispatched'); const d = io.db['ride:r'];
  assert.equal(d.status, 'driver_offered'); assert.deepEqual(d.candidateDriverIds, ['m1', 'c1', 'c2']); assert.deepEqual(d.rejectedDriverIds, []); assert.equal(d.dispatchLog.length, 1);
});
test('مشوار: رفض الكل (رجع requested) ثم dispatch جديد لا يعيد نفس المرشحين', async () => {
  const drivers = [D('a', 1), D('b', 2), D('c', 3), D('d', 4)]; const io = makeIO({ docs: { 'ride:r': ride() }, drivers });
  await core.dispatchDocument(io, 'ride', 'r', cfg); const d = io.db['ride:r'];
  Object.assign(d, { status: 'requested', candidateDriverIds: [], rejectedDriverIds: [] }); // ما يفعله العميل/الكابتن عند رفض الكل
  await core.dispatchDocument(io, 'ride', 'r', cfg); assert.deepEqual(io.db['ride:r'].candidateDriverIds, ['d']); // a,b,c اتجرّبوا
});
test('مشوار: انتهاء العرض بلا بدائل => يرجع requested (مخرج)، ثم دورة جديدة لنفس الكابتن؛ ولو أوفلاين لا حلقة', async () => {
  const drivers = [D('a', 1)]; const io = makeIO({ docs: { 'ride:r': ride() }, drivers });
  await core.dispatchDocument(io, 'ride', 'r', cfg); io.advance(cfg.offerTtlMs + 1000); drivers[0].lastSeen = ts(io.now() - 1000);
  assert.equal((await core.dispatchDocument(io, 'ride', 'r', cfg)).result, 'no_driver_after_offer'); assert.equal(io.db['ride:r'].status, 'requested');
  assert.equal((await core.dispatchDocument(io, 'ride', 'r', cfg)).result, 'dispatched'); assert.equal(io.db['ride:r'].dispatchRound, 2); // دورة جديدة
  io.advance(cfg.offerTtlMs + 1000); drivers[0].isOnline = false;
  assert.equal((await core.dispatchDocument(io, 'ride', 'r', cfg)).result, 'no_driver_after_offer');
  const n = io.log.length; assert.equal((await core.dispatchDocument(io, 'ride', 'r', cfg)).result, 'noop'); assert.equal(io.log.length, n);
});
test('مشوار: بعد maxRounds => requested + dispatchExhausted (حد واضح)', async () => {
  const drivers = Array.from({ length: 10 }, (_, i) => D('d' + i, i + 1)); const io = makeIO({ docs: { 'ride:r': ride() }, drivers });
  for (let i = 0; i < 6; i++) { await core.dispatchDocument(io, 'ride', 'r', cfg); io.advance(cfg.offerTtlMs + 1000); drivers.forEach((x) => { x.lastSeen = ts(io.now() - 1000); }); }
  const d = io.db['ride:r']; assert.equal(d.dispatchExhausted, true); assert.equal(d.status, 'requested'); assert.ok(d.dispatchRound <= cfg.maxRounds);
});
test('الشراء الخارجي: dispatch بإحداثيات pickupLocation.latitude/longitude، ويسجّل updatedAt', async () => {
  const io = makeIO({ docs: { 'external:e': ep() }, drivers: [D('a', 1), D('b', 2)] });
  assert.equal((await core.dispatchDocument(io, 'external', 'e', cfg)).result, 'dispatched');
  assert.equal(io.db['external:e'].status, 'driver_offered'); assert.ok(io.db['external:e'].updatedAt.toMillis());
  const bad = makeIO({ docs: { 'external:e': ep({ pickupLocation: { latitude: 'x', longitude: 32 } }) }, drivers: [D('a', 1)] });
  assert.equal((await core.dispatchDocument(bad, 'external', 'e', cfg)).result, 'noop');
});
// ----- المسافة والسعر -----
test('تضخيم المسافة (2km حقيقية، العميل بعت 12 والسعر مضخّم) => يتصحّح قبل الـ dispatch', async () => {
  const io = makeIO({ docs: { 'order:o': order({ distanceKm: 12, driverFee: 34, pricingSnapshot: { finalFare: 34, subtotal: 34 } }) }, drivers: [D('a', 1)], route: () => 2 });
  const r = await core.dispatchDocument(io, 'order', 'o', cfg); const d = io.db['order:o'];
  assert.equal(r.result, 'dispatched'); assert.equal(d.distanceCheck, 'corrected'); assert.equal(d.distanceKm, 2);
  assert.equal(d.pricingSnapshot.finalFare, 14); assert.equal(d.driverFee, 14); assert.equal(d.needsReview, true); assert.equal(d.authoritativeDistanceKm, 2);
});
test('تقليل المسافة/Flat fare (distanceKm=null) => يتصحّح للسعر الموثوق', async () => {
  const io = makeIO({ docs: { 'ride:r': ride({ distanceKm: null, pricingSnapshot: { finalFare: 10, subtotal: 10 } }) }, drivers: [D('a', 1)], route: () => 10 });
  await core.dispatchDocument(io, 'ride', 'r', cfg); assert.equal(io.db['ride:r'].pricingSnapshot.finalFare, 35); assert.equal(io.db['ride:r'].distanceCheck, 'corrected');
});
test('مسافة/سعر سليمين => ok بدون تعديل القيم', async () => {
  const io = makeIO({ docs: { 'order:o': order({ distanceKm: 5, driverFee: 20, pricingSnapshot: { finalFare: 20, subtotal: 20 } }) }, drivers: [D('a', 1)], route: () => 5.2 });
  await core.dispatchDocument(io, 'order', 'o', cfg); const d = io.db['order:o']; assert.equal(d.distanceCheck, 'ok'); assert.equal(d.distanceKm, 5); assert.equal(d.driverFee, 20);
});
test('routing واقع/غير مُعد => لا dispatch (blocked) ولا ثقة في رقم العميل؛ allowUnverified صريح فقط يتجاوز', async () => {
  const io = makeIO({ docs: { 'order:o': order() }, drivers: [D('a', 1)], route: () => { throw new Error('down'); } });
  const r = await core.dispatchDocument(io, 'order', 'o', cfg); assert.equal(r.result, 'blocked'); assert.equal(io.db['order:o'].distanceCheck, 'routing_unavailable'); assert.deepEqual(io.db['order:o'].candidateDriverIds, []);
  const again = await core.dispatchDocument(io, 'order', 'o', cfg); assert.equal(again.result, 'blocked'); assert.equal(io.log.length, 1); // لا إعادة كتابة نفس العلامة
  const io2 = makeIO({ docs: { 'order:o': order() }, drivers: [D('a', 1)], route: () => { throw new Error('down'); } });
  const r2 = await core.dispatchDocument(io2, 'order', 'o', core.readConfig({ ALLOW_UNVERIFIED_DISPATCH: 'true' }));
  assert.equal(r2.result, 'dispatched'); assert.equal(io2.db['order:o'].distanceCheck, 'unverified'); assert.equal(io2.db['order:o'].needsReview, true);
});
test('إحداثيات متجر/عميل غير صالحة أو pricing ناقص => blocked', async () => {
  const io = makeIO({ docs: { 'order:o': order({ storeLat: 999 }) }, drivers: [D('a', 1)] });
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'blocked');
  const io2 = makeIO({ docs: { 'order:o': order() }, drivers: [D('a', 1)], pricing: {} });
  assert.equal((await core.dispatchDocument(io2, 'order', 'o', cfg)).reason, 'pricing_missing');
});
test('fetchRouteKm: timeout فعلي، إحداثيات سيئة، استجابة غير صالحة', async () => {
  const slow = (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  await assert.rejects(core.fetchRouteKm({ fetchFn: slow, baseUrl: 'http://r', a: { lat: 30, lng: 32 }, b: { lat: 30.1, lng: 32 }, timeoutMs: 30 }), /aborted/);
  await assert.rejects(core.fetchRouteKm({ fetchFn: async () => ({}), baseUrl: 'http://r', a: { lat: 99, lng: 32 }, b: { lat: 30, lng: 32 }, timeoutMs: 30 }), /bad-coords/);
  await assert.rejects(core.fetchRouteKm({ fetchFn: async () => ({ ok: true, json: async () => ({ code: 'NoRoute' }) }), baseUrl: 'http://r', a: { lat: 30, lng: 32 }, b: { lat: 30.1, lng: 32 }, timeoutMs: 30 }), /bad-response/);
  assert.equal(await core.fetchRouteKm({ fetchFn: async () => ({ ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 4321 }] }) }), baseUrl: 'http://r', a: { lat: 30, lng: 32 }, b: { lat: 30.1, lng: 32 }, timeoutMs: 30 }), 4.32);
});
test('معادلة السعر في الـ backend = js/pricing.js (نفس التقريب والحد الأدنى)', () => {
  const src = fs.readFileSync(new URL('../js/pricing.js', import.meta.url), 'utf8');
  assert.match(src, /Math\.round\(Math\.max\(subtotal, *(?:cfg\.)?minimumFare\)\)|Math\.max\(subtotal/); // نفس البنية
  assert.deepEqual(core.fareFor({ baseFare: 10, perKmRate: 2, minimumFare: 30, bookingFee: 1 }, 5), { subtotal: 21, finalFare: 30 });
  assert.deepEqual(core.fareFor({ baseFare: 5, perKmRate: 2.5, minimumFare: 10, bookingFee: 0 }, 3.3), { subtotal: 13, finalFare: 13 });
});
// ----- الدورات العالقة -----
test('merchant_accepted عالق => يتقدّم لـ searching_driver بعد المهلة فقط، ويسجّل system في السجل', () => {
  const d = { status: 'merchant_accepted', updatedAt: ts(T0 - 5000), statusHistory: [] };
  assert.equal(core.planAdvanceMerchant(d, T0, cfg).action, 'noop');
  const p = core.planAdvanceMerchant(d, T0 + 60_000, cfg); assert.equal(p.patch.status, 'searching_driver'); assert.equal(p.patch.statusHistory.at(-1).by.type, 'system');
  assert.equal(core.planAdvanceMerchant({ status: 'searching_driver' }, T0, cfg).action, 'noop');
});
test('external item_unavailable/budget_exceeded عالق => يتلغي بعد المهلة ويفضّي الكابتن؛ المهلة 0 تعطّله', () => {
  const d = { status: 'budget_exceeded', driverId: 'drv', customerId: 'c', updatedAt: ts(T0 - 31 * 60_000) };
  const p = core.planExternalStale(d, T0, cfg); assert.equal(p.action, 'cancel'); assert.equal(p.patch.status, 'cancelled'); assert.equal(p.clearDriver, 'drv');
  assert.equal(core.planExternalStale({ ...d, updatedAt: ts(T0 - 60_000) }, T0, cfg).action, 'noop');
  assert.equal(core.planExternalStale(d, T0, core.readConfig({ EP_DECISION_TIMEOUT_MS: '0' })).action, 'noop');
  assert.equal(core.planExternalStale({ ...d, status: 'shopping' }, T0, cfg).action, 'noop');
});
test('index.js: نفس أسماء الـ exports + trigger لا يستجيب إلا عند دخول الحالة (لا loop)', () => {
  const s = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  for (const n of ['dispatchOrder', 'dispatchRide', 'dispatchExternal', 'redispatchStale', 'verifyOrderDistance', 'verifyRideDistance', 'aggregateOrderStats']) assert.match(s, new RegExp('exports\\.' + n + ' '));
  assert.match(s, /before\.status !== status/); assert.doesNotMatch(s, /process\.env\.[A-Z_]+ *\|\| *['"]http/);
});
test('طلب بلا كباتن لفترة طويلة => يتعلّم dispatchExhausted مرة واحدة (بدون إلغاء) ثم لا كتابة', async () => {
  const io = makeIO({ docs: { 'order:o': order({ createdAt: ts(T0 - cfg.maxAgeMs - 1000) }) }, drivers: [] });
  assert.equal((await core.dispatchDocument(io, 'order', 'o', cfg)).result, 'aged_out'); // التحقق + العلامة في كتابة واحدة assert.equal(io.db['order:o'].dispatchExhausted, true); assert.equal(io.db['order:o'].status, 'searching_driver');
  const n = io.log.length; await core.dispatchDocument(io, 'order', 'o', cfg); assert.equal(io.log.length, n);
});
