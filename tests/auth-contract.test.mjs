// node --test tests/auth-contract.test.mjs — فحوص ثابتة (static) على الكود والقواعد؛ مش بديل لاختبار الـ Emulator.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const R = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const rules = R('firestore.rules');
test('no user-facing old brand', () => {
  const html = R('index.html'); assert.doesNotMatch(html, /MOVA|موزا|MO<span>/);
  assert.match(html, /<title>MATLABK/); assert.match(R('js/main.js'), /name:'MATLABK'/);
  for (const f of ['js/admin.js', 'js/external.js', 'js/notifications.js', 'js/orders.js']) assert.doesNotMatch(R(f), /['"`][^'"`\n]*(MOVA|موزا)[^'"`\n]*['"`]/);
});
test('registration is Google only; no email/password creation path remains', () => {
  assert.doesNotMatch(R('js/auth.js'), /createUserWithEmailAndPassword\(auth/);
  assert.match(R('js/auth.js'), /export async function doRegister\(\) \{ return loginGoogle\(\); \}/);
});
test('only admin code writes status active / approval audit fields', () => {
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url))) {
    if (f === 'admin.js' || f === 'admin-requests.js' || f === 'admin-customers.js') continue;
    const s = R('js/' + f); assert.doesNotMatch(s, /approvedBy|rejectedBy/, f);
    assert.doesNotMatch(s.replace(/status: *role === 'customer' \? STATUS\.ACTIVE[^\n]*/, ''), /updateDoc\(doc\(db, *'users'[^)]*\)[^)]*status *: *'active'/, f);
  }
  assert.match(R('js/admin.js'), /approvedBy:window\.CU\.uid/); assert.match(R('js/admin.js'), /rejectedBy:window\.CU\.uid/);
});
test('rules: creation status, transitions, and gates present', () => {
  assert.match(rules, /role != 'customer' && request\.resource\.data\.status == 'incomplete'/);
  assert.match(rules, /resource\.data\.status in \['incomplete', 'rejected'\]/);
  assert.match(rules, /approvalFieldsAbsent\(request\.resource\.data\)/);
  assert.equal((rules.match(/!isCustomerBlocked\(\) && customerProfileComplete\(\)/g) || []).length, 3);
  assert.match(rules, /isApprovedMerchant\(\)/);
  const upd = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /stores/{storeId}'));
  for (const bad of ["'approvedBy'", "'rejectedBy'", "'approvedAt'", "'rejectReason'", "'role'"]) {
    const m = upd.match(/hasOnly\(\[[^\]]*\]\)/g) || []; assert.ok(!m.some((x) => x.includes(bad)), 'self-update allow-list must not contain ' + bad);
  }
});
test('onboarding page: every screen id referenced by routing exists', () => {
  const html = R('index.html'); const auth = R('js/auth.js');
  for (const id of [...auth.matchAll(/showScreen\('(screen-[a-z-]+)'\)/g)].map((m) => m[1])) assert.ok(html.includes(`id="${id}"`), id);
});

// ===== MATLABK security verification pass (static) =====
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
test('legacy open-dispatch bypass is gone from rules and client', () => {
  assert.doesNotMatch(strip(rules), /legacyOpenOrderRead|dispatchLegacyOpen|settings\/dispatch/);
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url))) assert.doesNotMatch(strip(R('js/' + f)), /legacyOpenOrderRead|getDispatchMode/, f);
  assert.match(R('js/orders.js'), /array-contains', driverUid/);
});
test('orders: candidateDriverIds is never in any client update allow-list (only backend can write it)', () => {
  const a = rules.indexOf('match /orders/{orderId}'); const blk = rules.slice(a, rules.indexOf('match /ratings', a));
  for (const m of blk.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)) assert.doesNotMatch(m[1], /candidateDriverIds/);
  const create = blk.slice(blk.indexOf('allow create'), blk.indexOf('allow update')); assert.doesNotMatch(create, /candidateDriverIds/);
});
test('admin approval/rejection/pause/delete use atomic batch; no silent catch on users/stores writes', () => {
  const s = R('js/admin.js');
  assert.match(s, /async function adminDecision[\s\S]*?writeBatch\(db\)[\s\S]*?await b\.commit\(\)/);
  for (const fn of ['admAccDrv', 'admRejDrv', 'admAccStore', 'admRejStore', 'smQuickPause', 'smQuickActivate', 'smQuickDelete', 'smDeleteStore']) assert.match(s.slice(s.indexOf('function ' + fn), s.indexOf('function ' + fn) + 900), /adminDecision/, fn);
  for (const l of s.split('\n')) if (/doc\(db,\s*'(users|stores)'/.test(l)) assert.doesNotMatch(l, /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/, l.slice(0, 80));
});
test('driver presence write failure is surfaced, not swallowed', () => assert.match(R('js/driver.js'), /presence write failed/));
test('account switching: main.js resets per-user state when uid changes; logout clears drafts/CUD', () => {
  const m = R('js/main.js'); assert.match(m, /matlabk_last_uid/); assert.match(m, /window\.CUD = null;\s*window\.CU = user/);
  const a = R('js/auth.js'); assert.match(a, /localStorage\.removeItem\('manayef_drv_draft'\)/); assert.match(a, /window\.CUD = null; window\.uploadedDocs = \{\}/);
});
test('rules: operational gates use role+status active (driver & merchant)', () => {
  assert.match(rules, /function isApprovedMerchant\(\)[\s\S]{0,200}role', ''\) == 'merchant'[\s\S]{0,80}status', ''\) == 'active'/);
  const products = rules.slice(rules.indexOf('match /products/'), rules.indexOf('match /stores/') > rules.indexOf('match /products/') ? rules.indexOf('match /orders/') : undefined);
  assert.ok((products.match(/isApprovedMerchant\(\)/g) || []).length >= 3);
});
test('rules: user cannot write role or approval metadata via any self-update allow-list', () => {
  const a = rules.indexOf('match /users/{userId}'); const blk = rules.slice(a, rules.indexOf('match /stores/{storeId}', a));
  assert.match(blk, /request\.resource\.data\.role == resource\.data\.role/);
  for (const m of blk.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)) assert.doesNotMatch(m[1], /'(role|approvedBy|approvedAt|rejectedBy|rejectedAt|rejectReason|rejectionReason|points|approvalStatus)'/);
});
test('branding: remaining "mova" tokens are only documented legacy identifiers', () => {
  const allowed = ['mova_loc_perm_', 'mova_link_intent', 'mova-functions', 'mova/', 'MOVA Icon System', 'MOVA Design System', 'MOVA Phase 3', 'MOVA DESIGN SYSTEM'];
  for (const f of ['js/location-permission.js', 'js/auth.js', 'js/icons.js', 'js/external.js', 'css/styles.css', 'functions/package.json', 'workers/cloudinary-sign/index.js'])
    for (const l of R(f).split('\n')) if (/mova/i.test(l)) assert.ok(allowed.some((a) => l.includes(a)), f + ': ' + l.trim().slice(0, 80));
});

// ===== MATLABK fix pass: config + cycle completion (static) =====
test('firebase.json: functions + firestore + emulators only; NO hosting; project pinned to go-elmanayef', () => {
  const j = JSON.parse(R('firebase.json')); assert.equal(j.functions.source, 'functions'); assert.equal(j.firestore.rules, 'firestore.rules');
  assert.ok(!('hosting' in j)); assert.deepEqual(Object.keys(j.emulators).filter((k) => !['ui', 'singleProjectMode'].includes(k)).sort(), ['firestore', 'functions']);
  assert.equal(JSON.parse(R('.firebaserc')).projects.default, 'go-elmanayef'); assert.match(R('js/firebase.js'), /projectId: "go-elmanayef"/);
});
test('backend-only dispatch/verification fields are never client-writable (no allow-list, no create whitelist)', () => {
  const fields = ['triedDriverIds', 'dispatchRound', 'dispatchedAt', 'dispatchExhausted', 'distanceCheck', 'authoritativeDistanceKm', 'verifiedAt', 'needsReview'];
  for (const f of fields) assert.doesNotMatch(strip(rules), new RegExp(`'${f}'`), f);
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url))) for (const k of fields) assert.doesNotMatch(strip(R('js/' + f)), new RegExp(`\\b${k}\\s*:`), f + ':' + k);
});
test('merchantRespond: retries step 2, tolerates backend having advanced, surfaces failure; merchant UI message', () => {
  const o = R('js/orders.js'); assert.match(o, /async function _startDriverSearch/); assert.match(o, /fromStatus === ORDER_STATUS\.SEARCHING_DRIVER\) return/); assert.match(o, /search-start-failed/);
  assert.match(R('js/merchant.js'), /search-start-failed/);
});
test('driver: delivered cleanup not silent; self-heal covers DELIVERED', () => {
  const d = R('js/driver.js'); assert.doesNotMatch(d, /activeOrderId: ?null\}\)\.catch\(\(\) ?=> ?\{\}\)/);
  assert.match(d, /st === ORDER_STATUS\.CANCELLED \|\| st === ORDER_STATUS\.DELIVERED/);
});
test('functions: triggers fire only on entering state; scheduler covers merchant_accepted, offers, EP stale; routing has timeout', () => {
  const f = R('functions/index.js'); assert.match(f, /entered\(e, 'searching_driver'\)/); assert.match(f, /entered\(e, 'requested'\)/);
  for (const k of ["'merchant_accepted'", "'driver_offered'", "'item_unavailable', 'budget_exceeded'"]) assert.ok(f.includes(k), k);
  assert.match(R('functions/lib/dispatch-core.js'), /AbortController/);
});
test('customerDispatchOk / epCustomerDispatchOk are still present (not removed without approval)', () => {
  assert.match(rules, /function customerDispatchOk/); assert.match(rules, /function epCustomerDispatchOk/);
});
