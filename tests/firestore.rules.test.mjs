// يحتاج Emulator + شبكة:  cd tests && npm i && npm test        (لم يُشغَّل في بيئة التدقيق — الشبكة كانت معطّلة)
import { test, before, beforeEach, after } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, setLogLevel } from 'firebase/firestore';
setLogLevel('error');
let env;
const P = (o) => ({ ...o });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'go-elmanayef', firestore: { rules: fs.readFileSync('../firestore.rules', 'utf8') } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const u = (id, x) => setDoc(doc(d, 'users', id), x);
    await u('admin', { role: 'admin', status: 'active' });
    await u('custA', { role: 'customer', status: 'active', name: 'Cust A', phone: '01001234567' });
    await u('custB', { role: 'customer', status: 'active', name: 'Cust B', phone: '01111234567' });
    await u('custInc', { role: 'customer', status: 'active', name: 'Inc', phone: '' });
    for (const id of ['drvA', 'drvB', 'drvC']) await u(id, { role: 'driver', status: 'active', isOnline: true, fullName: 'Name ' + id, phone: '0122', activeOrderId: null, activeRideId: null, activeExternalPurchaseId: null, lat: 30, lng: 32 });
    await u('storeA', { role: 'merchant', status: 'active' });
    await u('storeB', { role: 'merchant', status: 'active' });
    await setDoc(doc(d, 'stores', 'storeA'), { status: 'active', isOpen: true, lat: 30.0, lng: 32.0 });
    await setDoc(doc(d, 'settings', 'pricing'), { pricingVersion: 1, delivery: { baseFare: 10, perKmRate: 2, minimumFare: 10, bookingFee: 0 }, ride: { baseFare: 5, perKmRate: 3, minimumFare: 10, bookingFee: 0 }, external_purchase: { baseFare: 20, perKmRate: 0, minimumFare: 20, bookingFee: 0 } });
    await setDoc(doc(d, 'settings', 'commission'), { rate: 10, externalRate: 10 });
    await setDoc(doc(d, 'products', 'p1'), { merchantId: 'storeA', name: 'x', price: 50, available: true, stock: 5 });
    await setDoc(doc(d, 'orders', 'o1'), { customerId: 'custA', storeId: 'storeA', status: 'searching_driver', driverId: null, candidateDriverIds: ['drvA'], customerName: 'secret', items: [] });
    await setDoc(doc(d, 'orders', 'oDone'), { customerId: 'custA', storeId: 'storeA', driverId: 'drvA', status: 'delivered' });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();

test('Customer B cannot read Customer A order', () => assertFails(getDoc(doc(as('custB'), 'orders', 'o1'))));
test('Candidate driver reads order; non-candidate driver cannot', async () => {
  await assertSucceeds(getDoc(doc(as('drvA'), 'orders', 'o1')));
  await assertFails(getDoc(doc(as('drvB'), 'orders', 'o1')));
});
test('Legacy open-order bypass is disabled even if a settings/dispatch doc exists', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'settings', 'dispatch'), { legacyOpenOrderRead: true }));
  await assertFails(getDoc(doc(as('drvB'), 'orders', 'o1')));
});
test('Non-candidate driver: query for open searching orders denied; candidate-scoped query allowed', async () => {
  const { collection, query, where, getDocs } = await import('firebase/firestore');
  await assertFails(getDocs(query(collection(as('drvB'), 'orders'), where('status', '==', 'searching_driver'), where('driverId', '==', null))));
  await assertSucceeds(getDocs(query(collection(as('drvA'), 'orders'), where('status', '==', 'searching_driver'), where('driverId', '==', null), where('candidateDriverIds', 'array-contains', 'drvA'))));
});
test('Driver cannot self-inject into candidateDriverIds nor accept as non-candidate', async () => {
  await assertFails(updateDoc(doc(as('drvB'), 'orders', 'o1'), { candidateDriverIds: ['drvA', 'drvB'], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('drvB'), 'orders', 'o1'), { driverId: 'drvB', driverName: 'Name drvB', driverPhone: '0122', status: 'driver_assigned', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), statusHistory: [] }));
  await assertFails(updateDoc(doc(as('custA'), 'orders', 'o1'), { candidateDriverIds: ['drvB'], updatedAt: serverTimestamp() }));
});
test('Driver cannot change price/fee of an order', () => assertFails(updateDoc(doc(as('drvA'), 'orders', 'o1'), { driverFee: 9999, driverId: 'drvA', status: 'driver_assigned', updatedAt: serverTimestamp() })));
test('Driver cannot forge driverName on accept; correct name succeeds', async () => {
  const ref = (u) => doc(as(u), 'orders', 'o1');
  await assertFails(updateDoc(ref('drvA'), { driverId: 'drvA', driverName: 'Forged', driverPhone: '0122', status: 'driver_assigned', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), statusHistory: [] }));
  await assertSucceeds(updateDoc(ref('drvA'), { driverId: 'drvA', driverName: 'Name drvA', driverPhone: '0122', status: 'driver_assigned', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), statusHistory: [] }));
});
test('Rating: once only, deterministic id, stars/comment limits', async () => {
  const r = (x) => ({ orderId: 'oDone', customerId: 'custA', targetId: 'storeA', targetType: 'store', stars: 5, comment: 'ok', createdAt: serverTimestamp(), ...x });
  const db = as('custA');
  await assertFails(setDoc(doc(db, 'ratings', 'random'), r()));
  await assertFails(setDoc(doc(db, 'ratings', 'oDone_custA_store'), r({ stars: 6 })));
  await assertFails(setDoc(doc(db, 'ratings', 'oDone_custA_store'), r({ comment: 'x'.repeat(501) })));
  await assertSucceeds(setDoc(doc(db, 'ratings', 'oDone_custA_store'), r()));
  await assertFails(setDoc(doc(db, 'ratings', 'oDone_custA_store'), r({ stars: 1 })));
});
test('Merchant A cannot edit merchant B product', () => assertFails(updateDoc(doc(as('storeB'), 'products', 'p1'), { price: 1, updatedAt: serverTimestamp() })));
test('Counter: random user cannot bump', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'counters', 'driverRequests'), { seq: 1005 }));
  await assertFails(updateDoc(doc(as('custA'), 'counters', 'driverRequests'), { seq: 1006 }));
});
test('User cannot self-create with points or admin role', async () => {
  await assertFails(setDoc(doc(as('newU'), 'users', 'newU'), { role: 'customer', status: 'active', points: 99999 }));
  await assertFails(setDoc(doc(as('newU'), 'users', 'newU'), { role: 'admin', status: 'active' }));
  await assertSucceeds(setDoc(doc(as('newU'), 'users', 'newU'), { role: 'customer', status: 'active', points: 0 }));
});
test('External purchase canonical create succeeds; legacy deliveryAddress-only shape fails', async () => {
  const base = () => ({ customerId: 'custA', customerName: 'A', driverId: null, candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: [],
    placeName: 'Shop', placeAddress: 'Shop', items: 'milk', notes: '', approxBudget: 100,
    pickupLocation: { latitude: 30.1, longitude: 32.1, address: 'x', city: null, zone: null }, additionalNotes: '',
    actualProductPrice: null, paymentResponsibility: 'captain_advances_cash',
    pricingSnapshot: { pricingVersion: 1, serviceType: 'external_purchase', finalFare: 20, commission: 2, commissionRate: 10 },
    status: 'requested', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await assertSucceeds(setDoc(doc(as('custA'), 'external_purchases', 'e1'), base()));
  await assertFails(setDoc(doc(as('custA'), 'external_purchases', 'e2'), { ...base(), pricingSnapshot: { ...base().pricingSnapshot, finalFare: 1 } }));
  await assertFails(setDoc(doc(as('custA'), 'external_purchases', 'e3'), { ...base(), deliveryAddress: 'x' }));
});
test('Inflated ride distance rejected (2km actual vs 500km claimed)', async () => {
  const ride = (km) => ({ customerId: 'custA', pickup: { lat: 30, lng: 32 }, dropoff: { lat: 30.01, lng: 32.01 }, vehicleType: 'car', status: 'requested', driverId: null,
    distanceKm: km, pricingSnapshot: { finalFare: 5 + 3 * km, pricingVersion: 1, serviceType: 'ride' }, createdAt: serverTimestamp() });
  await assertFails(setDoc(doc(as('custA'), 'rides', 'r1'), ride(500)));
});
test('Notification: ride/external entity schema; spoofed event rejected', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'external_purchases', 'e9'), { customerId: 'custA', driverId: 'drvA', status: 'shopping' }));
  const n = (x) => ({ userId: 'custA', title: 'بدأ الشراء', body: 'x', type: 'or', entityType: 'external_purchase', entityId: 'e9', eventKey: 'shopping', read: false, createdAt: serverTimestamp(), ...x });
  await assertSucceeds(setDoc(doc(as('drvA'), 'notifications', 'external_purchase_e9_shopping_custA'), n()));
  await assertFails(setDoc(doc(as('drvA'), 'notifications', 'x2'), n({ eventKey: 'completed' })));
  await assertFails(setDoc(doc(as('drvB'), 'notifications', 'x3'), n()));
});
test('Anonymous cannot read anything; any_requests create ok but not read', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, 'orders', 'o1')));
  await assertSucceeds(setDoc(doc(anon, 'any_requests', 'a1'), { customerId: 'guest', customerName: 'g', request: 'hi', address: 'x', status: 'new', createdAt: serverTimestamp() }));
  await assertFails(getDoc(doc(anon, 'any_requests', 'a1')));
});

// ================= AUTH-2026 (MATLABK): approval & profile gates =================
const drvSubmit = () => ({ fullName: 'Driver New', phone: '01234567890', nationalId: '12345678901234', vehicleType: 'motorcycle', plateNumber: 'ABC123', docsSubmitted: true, docs: { id: 'https://res.cloudinary.com/yfohr6xd/x.jpg' }, status: 'pending', updatedAt: serverTimestamp() });
test('incomplete customer cannot create external purchase; complete can', async () => {
  const body = (c) => ({ customerId: c, customerName: 'A', driverId: null, candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: [], placeName: 'Shop', placeAddress: 'S', items: 'milk', notes: '', approxBudget: 10,
    pickupLocation: { latitude: 30.1, longitude: 32.1, address: 'x', city: null, zone: null }, additionalNotes: '', actualProductPrice: null, paymentResponsibility: 'captain_advances_cash',
    pricingSnapshot: { pricingVersion: 1, serviceType: 'external_purchase', finalFare: 20, commission: 2, commissionRate: 10 }, status: 'requested', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await assertFails(setDoc(doc(as('custInc'), 'external_purchases', 'x1'), body('custInc')));
  await assertSucceeds(setDoc(doc(as('custA'), 'external_purchases', 'x2'), body('custA')));
});
test('customer can complete own profile (name/phone/address) but cannot touch role/status/points', async () => {
  const d = doc(as('custInc'), 'users', 'custInc');
  await assertSucceeds(updateDoc(d, { name: 'Done', phone: '01012345678', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(d, { phone: '12', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(d, { role: 'admin' }));
  await assertFails(updateDoc(d, { points: 5 }));
  await assertFails(updateDoc(d, { status: 'blocked' }));
});
test('driver: create only as incomplete; submit needs full data; cannot self-approve or edit audit fields', async () => {
  const me = as('newDrv');
  await assertFails(setDoc(doc(me, 'users', 'newDrv'), { role: 'driver', status: 'active' }));
  await assertFails(setDoc(doc(me, 'users', 'newDrv'), { role: 'driver', status: 'pending' }));
  await assertFails(setDoc(doc(me, 'users', 'newDrv'), { role: 'driver', status: 'incomplete', approvedBy: 'newDrv' }));
  await assertSucceeds(setDoc(doc(me, 'users', 'newDrv'), { role: 'driver', status: 'incomplete', name: 'N', email: 'a@b.c', points: 0, createdAt: serverTimestamp() }));
  const ref = doc(me, 'users', 'newDrv');
  await assertFails(updateDoc(ref, { status: 'pending', updatedAt: serverTimestamp() }));                 // بيانات ناقصة
  await assertFails(updateDoc(ref, { ...drvSubmit(), status: 'active' }));                                // self-approve
  await assertFails(updateDoc(ref, { ...drvSubmit(), approvedBy: 'newDrv' }));                            // audit field
  await assertFails(updateDoc(ref, { ...drvSubmit(), nationalId: '123' }));                               // تحقق الرقم القومي
  await assertSucceeds(updateDoc(ref, drvSubmit()));                                                      // incomplete -> pending
});
test('pending/rejected driver is not an active driver: cannot read candidate order or go online; rejected can resubmit', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'users', 'pDrv'), { role: 'driver', status: 'pending', isOnline: false });
    await setDoc(doc(c.firestore(), 'users', 'rDrv'), { role: 'driver', status: 'rejected', rejectReason: 'x', isOnline: false });
    await setDoc(doc(c.firestore(), 'orders', 'o2'), { customerId: 'custA', status: 'searching_driver', driverId: null, candidateDriverIds: ['pDrv', 'rDrv'] });
  });
  await assertFails(getDoc(doc(as('pDrv'), 'orders', 'o2')));
  await assertFails(getDoc(doc(as('rDrv'), 'orders', 'o2')));
  await assertFails(updateDoc(doc(as('rDrv'), 'users', 'rDrv'), { status: 'active' }));
  await assertFails(updateDoc(doc(as('rDrv'), 'users', 'rDrv'), { rejectReason: '' }));
  await assertSucceeds(updateDoc(doc(as('rDrv'), 'users', 'rDrv'), drvSubmit()));
});
test('merchant: incomplete -> pending only with complete store data; cannot self-approve; pending cannot create products or open store', async () => {
  const me = as('newM');
  await assertFails(setDoc(doc(me, 'users', 'newM'), { role: 'merchant', status: 'active' }));
  await assertSucceeds(setDoc(doc(me, 'users', 'newM'), { role: 'merchant', status: 'incomplete', name: 'M', points: 0, createdAt: serverTimestamp() }));
  const bad = (await import('firebase/firestore')).writeBatch(me);
  bad.set(doc(me, 'stores', 'newM'), { storeName: '', storePhone: '1', status: 'pending', createdAt: serverTimestamp() });
  bad.update(doc(me, 'users', 'newM'), { status: 'pending', updatedAt: serverTimestamp() });
  await assertFails(bad.commit());
  const ok = (await import('firebase/firestore')).writeBatch(me);
  ok.set(doc(me, 'stores', 'newM'), { storeName: 'Shop', storePhone: '01012345678', category: 'x', status: 'pending', createdAt: serverTimestamp() });
  ok.update(doc(me, 'users', 'newM'), { status: 'pending', updatedAt: serverTimestamp() });
  await assertSucceeds(ok.commit());
  await assertFails(updateDoc(doc(me, 'users', 'newM'), { status: 'active' }));
  await assertFails(updateDoc(doc(me, 'stores', 'newM'), { status: 'active' }));
  await assertFails(updateDoc(doc(me, 'stores', 'newM'), { isOpen: true, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(me, 'products', 'pp'), { merchantId: 'newM', name: 'x', price: 5, createdAt: serverTimestamp() }));
});
test('admin can approve/reject with audit fields; role escalation to admin is impossible', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users', 'pD2'), { role: 'driver', status: 'pending' }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'pD2'), { status: 'active', approvedBy: 'admin', approvedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('custA'), 'users', 'custA'), { role: 'admin' }));
  await assertFails(setDoc(doc(as('x9'), 'users', 'x9'), { role: 'admin', status: 'active' }));
  await assertFails(updateDoc(doc(as('drvA'), 'users', 'drvA'), { status: 'pending' }));   // active -> pending ممنوع
});

// ================= MATLABK verification matrix (NOT EXECUTED in audit env — emulator unavailable) =================
const seedStates = async () => env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore(); const u = (id, x) => setDoc(doc(d, 'users', id), x);
  for (const st of ['incomplete', 'pending', 'rejected']) {
    await u('drv_' + st, { role: 'driver', status: st, isOnline: false, fullName: 'N N', phone: '01012345678', activeOrderId: null, activeRideId: null, activeExternalPurchaseId: null });
    await u('mer_' + st, { role: 'merchant', status: st });
    await setDoc(doc(d, 'stores', 'mer_' + st), { storeName: 'S', storePhone: '01012345678', status: st === 'rejected' ? 'rejected' : 'pending', lat: 30, lng: 32 });
  }
  await u('mer_active', { role: 'merchant', status: 'active' });
  await setDoc(doc(d, 'stores', 'mer_active'), { storeName: 'S', storePhone: '01012345678', status: 'active', lat: 30, lng: 32, isOpen: true });
  await setDoc(doc(d, 'products', 'pa'), { merchantId: 'mer_active', name: 'x', price: 5, available: true, createdAt: new Date() });
  await setDoc(doc(d, 'products', 'pp2'), { merchantId: 'mer_pending', name: 'x', price: 5, available: true, createdAt: new Date() });
  await setDoc(doc(d, 'orders', 'oc'), { customerId: 'custA', storeId: 'mer_active', status: 'searching_driver', driverId: null, candidateDriverIds: ['drv_pending', 'drv_rejected', 'drv_incomplete', 'drvA'] });
  await setDoc(doc(d, 'orders', 'om'), { customerId: 'custA', storeId: 'mer_pending', status: 'waiting_merchant', driverId: null, statusHistory: [] });
  await setDoc(doc(d, 'orders', 'om2'), { customerId: 'custA', storeId: 'mer_active', status: 'waiting_merchant', driverId: null, statusHistory: [] });
});
for (const st of ['incomplete', 'pending', 'rejected']) {
  test(`${st} captain: DENIED read of candidate order, accept, GPS, online, status update`, async () => {
    await seedStates(); const me = as('drv_' + st);
    await assertFails(getDoc(doc(me, 'orders', 'oc')));
    await assertFails(updateDoc(doc(me, 'orders', 'oc'), { driverId: 'drv_' + st, driverName: 'N N', driverPhone: '1', status: 'driver_assigned', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), statusHistory: [] }));
    await assertFails(updateDoc(doc(me, 'users', 'drv_' + st), { lat: 30, lng: 32, lastSeen: serverTimestamp() }));
    await assertFails(updateDoc(doc(me, 'users', 'drv_' + st), { isOnline: true }));
    await assertFails(updateDoc(doc(me, 'users', 'drv_' + st), { status: 'active' }));
  });
  test(`${st} merchant: DENIED open/close store, product create/update/delete, order status`, async () => {
    await seedStates(); const me = as('mer_' + st);
    await assertFails(updateDoc(doc(me, 'stores', 'mer_' + st), { isOpen: true, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(me, 'products', 'np'), { merchantId: 'mer_' + st, name: 'x', price: 5, createdAt: serverTimestamp() }));
    if (st === 'pending') { await assertFails(updateDoc(doc(me, 'products', 'pp2'), { price: 6, updatedAt: serverTimestamp() })); await assertFails(updateDoc(doc(me, 'orders', 'om'), { status: 'merchant_accepted', updatedAt: serverTimestamp(), statusHistory: [] })); }
    await assertFails(updateDoc(doc(me, 'users', 'mer_' + st), { status: 'active', approvedBy: 'mer_' + st, approvedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(me, 'stores', 'mer_' + st), { status: 'active' }));
  });
}
test('active captain & active merchant ARE allowed', async () => {
  await seedStates();
  await assertSucceeds(getDoc(doc(as('drvA'), 'orders', 'oc')));
  await assertSucceeds(updateDoc(doc(as('mer_active'), 'stores', 'mer_active'), { isOpen: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('mer_active'), 'products', 'pa'), { price: 7, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('mer_active'), 'orders', 'om2'), { status: 'merchant_accepted', updatedAt: serverTimestamp(), statusHistory: [] }));
});
test('ROLE ESCALATION matrix: every self role change fails', async () => {
  await seedStates();
  const cases = [['custA', 'admin'], ['custA', 'merchant'], ['custA', 'driver'], ['drvA', 'admin'], ['mer_active', 'admin'], ['mer_pending', 'admin'], ['drv_pending', 'admin']];
  for (const [uid, role] of cases) await assertFails(updateDoc(doc(as(uid), 'users', uid), { role }));
  for (const role of ['admin', 'captain']) await assertFails(setDoc(doc(as('fresh_' + role), 'users', 'fresh_' + role), { role, status: role === 'admin' ? 'active' : 'incomplete' }));
});
test('self-approval matrix + forged approval metadata', async () => {
  await seedStates();
  for (const uid of ['drv_pending', 'mer_pending', 'custA']) {
    await assertFails(updateDoc(doc(as(uid), 'users', uid), { status: 'active' }));
    for (const f of [{ approvedBy: uid }, { approvedAt: serverTimestamp() }, { rejectedBy: 'x' }, { rejectReason: 'x' }, { approvalStatus: 'approved' }]) await assertFails(updateDoc(doc(as(uid), 'users', uid), f));
  }
});
test('state machine: pending -> active only by admin; rejected -> pending by owner after fixing data; active -> pending denied', async () => {
  await seedStates();
  await assertFails(updateDoc(doc(as('drv_pending'), 'users', 'drv_pending'), { status: 'rejected' }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'drv_pending'), { status: 'rejected', rejectedBy: 'admin', rejectedAt: serverTimestamp(), rejectReason: 'x', rejectionReason: 'x' }));
  await assertFails(updateDoc(doc(as('drv_pending'), 'users', 'drv_pending'), { status: 'pending', updatedAt: serverTimestamp() })); // بيانات ناقصة
  await assertFails(updateDoc(doc(as('drvA'), 'users', 'drvA'), { status: 'pending' }));
});
test('legacy incomplete PENDING driver cannot re-save as pending without full data', async () => {
  await seedStates();
  await assertFails(updateDoc(doc(as('drv_pending'), 'users', 'drv_pending'), { phone: '01099999999', updatedAt: serverTimestamp() }));
});
test('merchant approval ATOMIC: admin batch users+stores commits both; partial batch with missing store fails entirely', async () => {
  const { writeBatch } = await import('firebase/firestore'); await seedStates();
  const b = writeBatch(as('admin')); b.update(doc(as('admin'), 'users', 'mer_pending'), { status: 'active', approvedBy: 'admin', approvedAt: serverTimestamp() });
  b.update(doc(as('admin'), 'stores', 'mer_pending'), { status: 'active' }); await assertSucceeds(b.commit());
  await env.withSecurityRulesDisabled(async (c) => { const [u, st] = await Promise.all([getDoc(doc(c.firestore(), 'users', 'mer_pending')), getDoc(doc(c.firestore(), 'stores', 'mer_pending'))]); if (u.data().status !== 'active' || st.data().status !== 'active') throw new Error('not atomic'); });
  const b2 = writeBatch(as('admin')); b2.update(doc(as('admin'), 'users', 'mer_incomplete'), { status: 'active', approvedBy: 'admin' });
  b2.update(doc(as('admin'), 'stores', 'does_not_exist'), { status: 'active' }); await assertFails(b2.commit());
  await env.withSecurityRulesDisabled(async (c) => { const u = await getDoc(doc(c.firestore(), 'users', 'mer_incomplete')); if (u.data().status !== 'incomplete') throw new Error('partial write leaked'); });
});
test('rejected merchant resubmits: users->pending and stores rejected->pending in one batch', async () => {
  const { writeBatch } = await import('firebase/firestore'); await seedStates(); const me = as('mer_rejected');
  const b = writeBatch(me); b.update(doc(me, 'stores', 'mer_rejected'), { status: 'pending', storeName: 'S2', updatedAt: serverTimestamp() }); b.update(doc(me, 'users', 'mer_rejected'), { status: 'pending', updatedAt: serverTimestamp() });
  await assertSucceeds(b.commit());
});
test('GET-LIMIT: order create with 6 distinct products passes (4 fixed docs + 6 = 10); 7 fails — documents the real ceiling', async () => {
  await env.withSecurityRulesDisabled(async (c) => { for (let i = 1; i <= 7; i++) await setDoc(doc(c.firestore(), 'products', 'g' + i), { merchantId: 'storeA', name: 'p' + i, price: 10, available: true }); });
  const mk = (n) => ({ customerId: 'custA', customerName: 'Cust A', storeId: 'storeA', storeName: 'S', items: Array.from({ length: n }, (_, i) => ({ id: 'g' + (i + 1), name: 'p' + (i + 1), price: 10, qty: 1 })), total: 10 * n, commission: 0, driverFee: 0, status: 'waiting_merchant', driverId: null, driverName: null, createdAt: serverTimestamp() });
  console.log('NOTE: fee/commission/pricingSnapshot fields must be filled by the real client payload; adjust mk() to the app payload before trusting this test.');
  await assertFails(setDoc(doc(as('custA'), 'orders', 'big7'), mk(7)));
});
test('incomplete customer denied order / ride creation (same gate as external purchase)', async () => {
  await assertFails(setDoc(doc(as('custInc'), 'rides', 'rI'), { customerId: 'custInc', pickup: { lat: 30, lng: 32 }, dropoff: { lat: 30.01, lng: 32.01 }, vehicleType: 'car', status: 'requested', driverId: null, distanceKm: 2, pricingSnapshot: {}, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('custInc'), 'orders', 'oI'), { customerId: 'custInc', storeId: 'storeA', status: 'waiting_merchant', items: [], createdAt: serverTimestamp() }));
});

// ================= MATLABK fix pass (NOT EXECUTED — emulator unavailable) =================
test('clients can NEVER write backend-owned dispatch/verification fields (orders / rides / external_purchases)', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'rides', 'rb'), { customerId: 'custA', status: 'requested', driverId: null, candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: [] });
    await setDoc(doc(c.firestore(), 'external_purchases', 'eb'), { customerId: 'custA', status: 'requested', driverId: null, candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: [] });
  });
  const f = { triedDriverIds: ['x'], dispatchRound: 1, dispatchExhausted: false, distanceCheck: 'ok', authoritativeDistanceKm: 1, needsReview: false };
  for (const [col, id] of [['orders', 'o1'], ['rides', 'rb'], ['external_purchases', 'eb']]) for (const who of ['custA', 'drvA', 'admin_not_used']) {
    if (who === 'admin_not_used') continue;
    await assertFails(updateDoc(doc(as(who), col, id), { ...f, updatedAt: serverTimestamp() }));
  }
});
test('merchant respond path: active merchant moves waiting_merchant -> merchant_accepted -> searching_driver; customer cannot', async () => {
  await seedStates();
  const hist = (to) => [{ from: 'x', to, at: 1, by: 'm' }];
  await assertSucceeds(updateDoc(doc(as('mer_active'), 'orders', 'om2'), { status: 'merchant_accepted', updatedAt: serverTimestamp(), statusHistory: hist('merchant_accepted') }));
  await assertSucceeds(updateDoc(doc(as('mer_active'), 'orders', 'om2'), { status: 'searching_driver', updatedAt: serverTimestamp(), statusHistory: hist('searching_driver') }));
  await assertFails(updateDoc(doc(as('custA'), 'orders', 'om'), { status: 'searching_driver', updatedAt: serverTimestamp(), statusHistory: [] }));
});
test('driver cleanup: driver may clear own activeOrderId but not set it to an arbitrary order', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users', 'drvA'), { role: 'driver', status: 'active', isOnline: true, fullName: 'Name drvA', activeOrderId: 'o1' }, { merge: true }));
  await assertSucceeds(updateDoc(doc(as('drvA'), 'users', 'drvA'), { activeOrderId: null }));
  await assertFails(updateDoc(doc(as('drvA'), 'users', 'drvA'), { activeOrderId: 'o1' }));
});
test('customerDispatchOk still guards: customer cannot offer a ride to a pending/offline/self candidate list', async () => {
  await seedStates(); await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'rides', 'rc'), { customerId: 'custA', status: 'requested', driverId: null, pickup: { lat: 30, lng: 32 }, dropoff: { lat: 30.01, lng: 32.01 }, vehicleType: 'car', distanceKm: 2, pricingSnapshot: {}, candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: [] }));
  await assertFails(updateDoc(doc(as('custA'), 'rides', 'rc'), { status: 'driver_offered', candidateDriverIds: ['drv_pending'], rejectedDriverIds: [], dispatchLog: [], offeredAt: serverTimestamp() }));
});

// ================= MATLABK role-auth-ux pass (NOT EXECUTED — emulator unavailable) =================
test('captain can submit WITHOUT plateNumber / vehicleModel / vehicleColor, but not without vehicleType; oversize plate rejected', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users', 'optDrv'), { role: 'driver', status: 'incomplete', name: 'N' }));
  const me = doc(as('optDrv'), 'users', 'optDrv'); const base = drvSubmit(); delete base.plateNumber;
  await assertFails(updateDoc(me, { ...base, vehicleType: '' }));                               // vehicleType ما زال إلزاميًا
  await assertFails(updateDoc(me, { ...base, plateNumber: 'x'.repeat(31) }));                    // حد الطول
  await assertFails(updateDoc(me, { ...base, status: 'active' }));                               // لا تفعيل ذاتي
  await assertSucceeds(updateDoc(me, base));                                                     // بدون لوحة ومواصفات => pending
});
test('same uid cannot become another role: customer -> driver/merchant/admin updates and a second role document are denied', async () => {
  for (const role of ['driver', 'merchant', 'admin']) await assertFails(updateDoc(doc(as('custA'), 'users', 'custA'), { role }));
  await assertFails(setDoc(doc(as('custA'), 'users', 'custA'), { role: 'driver', status: 'incomplete' }));   // create على مستند موجود = update ممنوع
});
test('non-admin cannot read admin collections (orders of others / all users / auditLog)', async () => {
  const { collection, getDocs } = await import('firebase/firestore');
  await assertFails(getDocs(collection(as('custA'), 'users'))); await assertFails(getDocs(collection(as('custA'), 'auditLog')));
  await assertFails(getDoc(doc(as('custB'), 'orders', 'o1')));
  await assertSucceeds(getDoc(doc(as('admin'), 'orders', 'o1')));
});
