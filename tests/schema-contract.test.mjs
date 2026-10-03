// Runnable WITHOUT emulator: node --test tests/schema-contract.test.mjs
// يتأكد إن مفاتيح الكتابة في الـ frontend ⊆ whitelist الـ Rules (منع تكرار mismatch زي pickupLocation/deliveryAddress).
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function whitelist(anchor) {
  const i = rules.indexOf(anchor); assert.ok(i >= 0, 'anchor ' + anchor);
  const m = /keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/.exec(rules.slice(i)); return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
}
function clientKeys(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker), b = src.indexOf(endMarker, a);
  return [...new Set([...src.slice(a, b).matchAll(/(?:^|[\s{,])([a-zA-Z]+)\s*[:,]/gm)].map((x) => x[1]))];
}
test('external_purchases create keys ⊆ rules whitelist & no deliveryAddress', () => {
  const wl = whitelist('match /external_purchases/{purchaseId}');
  const src = read('js/external.js');
  for (const k of ['customerId', 'customerName', 'placeName', 'items', 'approxBudget', 'pickupLocation', 'additionalNotes', 'pricingSnapshot', 'paymentResponsibility', 'status', 'createdAt', 'updatedAt'])
    assert.ok(wl.includes(k), 'rules missing ' + k);
  assert.ok(!wl.includes('deliveryAddress'), 'deliveryAddress must not be a create key');
  const block = src.slice(src.indexOf('const data = {'), src.indexOf('const ref = await addDoc'));
  for (const k of wl) assert.ok(block.includes(k), 'client does not send ' + k);
});
test('orders create keys: client payload ⊆ rules', () => {
  const wl = whitelist('match /orders/{orderId}');
  const src = read('js/orders.js'); const a = src.indexOf("addDoc(collection(db, 'orders'), {"); const blk = src.slice(a, src.indexOf('});', a));
  for (const k of ['customerId', 'customerName', 'storeId', 'storeName', 'items', 'total', 'commission', 'driverFee', 'pricingSnapshot', 'status', 'driverId', 'driverName', 'pickupLocation', 'customerLat', 'customerLng', 'storeLat', 'storeLng', 'distanceKm', 'statusHistory', 'createdAt']) {
    assert.ok(blk.includes(k), 'client missing ' + k); assert.ok(wl.includes(k), 'rules missing ' + k);
  }
});
test('rides create keys', () => {
  const wl = whitelist('match /rides/{rideId}');
  const src = read('js/rides.js'); const a = src.indexOf('const rideDoc = {'); const blk = src.slice(a, src.indexOf('};', a));
  for (const k of ['customerId', 'pickup', 'dropoff', 'vehicleType', 'status', 'driverId', 'distanceKm', 'tripEtaMinutes', 'routeGeometry', 'routingProvider', 'pricingSnapshot', 'createdAt']) {
    assert.ok(blk.includes(k), 'client missing ' + k); assert.ok(wl.includes(k), 'rules missing ' + k);
  }
});
test('ratings use deterministic id; notifications support entityType', () => {
  assert.match(read('js/customer.js'), /setDoc\(doc\(db,'ratings', ratingId\)/);
  assert.match(rules, /ratingId == request\.resource\.data\.orderId \+ '_' \+ request\.auth\.uid/);
  assert.match(read('js/notifications.js'), /entityType !== 'order'/);
  assert.match(rules, /entityNotifOk\(\)/);
});
test('no secrets / blob SW', () => {
  assert.doesNotMatch(read('js/main.js'), /serviceWorker\.register/);
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url))) assert.doesNotMatch(read('js/' + f), /api_secret|CLOUDINARY_API_SECRET/);
});
