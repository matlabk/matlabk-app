// node --test tests/auth-contract.test.mjs — فحوص ثابتة (static) على الكود والقواعد؛ مش بديل لاختبار الـ Emulator.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const R = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const rules = R('firestore.rules');
test('no user-facing old brand', () => {
  const html = R('index.html'); assert.doesNotMatch(html, /MOVA|موزا|MO<span>/);
  assert.match(html, /<title>MATLABK/); assert.match(R('js/main.js'), /name:'MATLABK'/);
  for (const f of ['js/admin.js', 'js/external.js', 'js/notifications.js', 'js/orders.js']) assert.doesNotMatch(R(f), /['"`][^'"`\n]*(MOVA|موزا)[^'"`\n]*['"`]/);
});
test('Google-only authentication: no legacy provider code anywhere (comments stripped)', () => {
  const FORBIDDEN = ['createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'sendPasswordResetEmail', 'sendSignInLinkToEmail', 'signInWithEmailLink', 'isSignInWithEmailLink',
    'EmailAuthProvider', 'linkWithCredential', 'linkWithRedirect', 'linkWithPopup', 'fetchSignInMethodsForEmail', 'emailForSignIn', 'doLogin', 'doRegister', 'showForgot', 'showEmailOTP',
    'handleEmailAlreadyInUse', 'handleGoogleAccountConflict', 'maybeOfferPendingLink', 'mova_link_intent', 'LINK_INTENT', 'stashLinkIntent', 'readLinkIntent', 'clearLinkIntent', 'switchTab'];
  const files = ['index.html', ...fs.readdirSync(new URL('../js/', import.meta.url)).map((f) => 'js/' + f), 'functions/index.js', 'functions/lib/dispatch-core.js'];
  for (const f of files) { const s = strip(R(f).replace(/<!--[\s\S]*?-->/g, '')); for (const w of FORBIDDEN) assert.ok(!s.includes(w), `${f} still references ${w}`); }
});
test('Google Auth is present and the redirect flow is intact', () => {
  const fb = R('js/firebase.js'); const imp = fb.match(/import \{([^}]*)\} from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js"/)[1].split(',').map((x) => x.trim()).sort();
  assert.deepEqual(imp, ['GoogleAuthProvider', 'getAuth', 'getRedirectResult', 'onAuthStateChanged', 'signInWithRedirect', 'signOut']); // لا شيء زيادة
  assert.match(fb, /new GoogleAuthProvider\(\)/);
  const a = R('js/auth.js'); assert.match(a, /export async function loginGoogle/); assert.match(a, /await signInWithRedirect\(auth, gProvider\)/);
  const m = R('js/main.js'); assert.match(m, /getRedirectResult\(auth\)/); assert.match(m, /onAuthStateChanged\(auth, async user =>/);
  const html = R('index.html'); assert.match(html, /onclick="loginGoogle\(\)"/); assert.match(html, /المتابعة باستخدام Google/);
});
test('login screen (screen-entry) is Google-only and complete: brand, tagline, Google button, note, legal; no legacy UI; no screen-auth/OTP', () => {
  const html = R('index.html'); const s = html.slice(html.indexOf('id="screen-entry"'), html.indexOf('id="screen-role-select"'));
  assert.doesNotMatch(s, /type="(email|password)"|auth-tab|lmail|lpass|login-btn|legacy-login|auth-register|role-btn|اختر دورك/);
  assert.doesNotMatch(html, /id="screen-auth"|id="screen-otp"|otp-email|otp-card/);
  for (const txt of ['MATLAB<span>K</span>', 'خدماتك أقرب إليك', 'توصيل • مشاوير • خدمات داخل المنايف', 'المتابعة باستخدام Google', 'تسجيل سريع وآمن باستخدام حساب Google', 'بمتابعتك، أنت توافق على شروط الاستخدام وسياسة الخصوصية.']) assert.ok(s.includes(txt), txt);
  assert.match(s, /onclick="loginGoogle\(\)"/); assert.match(s, /<svg class="lg-g"/);                       // أيقونة Google
  assert.doesNotMatch(html, /Gmail|MATALBK|\bMova\b/i);
  assert.match(s, /id="err-msg"[^>]*role="alert"/); assert.match(s, /type="button" id="lg-google"/);
  // لا dead handlers: كل دالة تُستدعى من onclick داخل الشاشة معروضة على window
  const m = R('js/main.js'); const win = m.slice(m.indexOf('Object.assign(window'), m.indexOf('});', m.indexOf('Object.assign(window')));
  for (const fnName of new Set([...s.matchAll(/onclick="([A-Za-z]+)\(/g)].map((x) => x[1]))) assert.match(win, new RegExp('\\b' + fnName + '\\b'), fnName);
});
test('login UX: loading state blocks double-click, errors inline, offline guard, bfcache reset, friendly Arabic messages (no firebase codes shown)', () => {
  const a = R('js/auth.js');
  assert.match(a, /if \(!authLockStart\(\)\) return;/); assert.match(a, /b\.disabled = on/); assert.match(a, /aria-busy/); assert.match(a, /is-loading/);
  assert.match(a, /navigator\.onLine === false/); assert.match(a, /pageshow/); assert.match(a, /ev\.persisted/);
  const map = a.slice(a.indexOf('export function firebaseAuthErrorMessage'), a.indexOf('\n}\n', a.indexOf('export function firebaseAuthErrorMessage')));
  for (const code of ['auth/network-request-failed', 'auth/account-exists-with-different-credential', 'auth/popup-closed-by-user', 'auth/too-many-requests', 'auth/user-disabled', 'auth/unauthorized-domain']) assert.ok(map.includes(code), code);
  for (const msg of [...map.matchAll(/: '([^']+)'/g)].map((x) => x[1]).filter((x) => !x.startsWith('auth/'))) assert.doesNotMatch(msg, /auth\/|firebase/i, msg);
  assert.doesNotMatch(a, /showToast\(firebaseAuthErrorMessage/); // الأخطاء داخل الشاشة (role=alert) لا Toast
  assert.match(R('js/main.js'), /showLoginError\(firebaseAuthErrorMessage\(e\)\)/);
});
test('partner choice kept (driver / merchant) as a light secondary action; role/status flow untouched', () => {
  const html = R('index.html'); const s = html.slice(html.indexOf('id="screen-entry"'), html.indexOf('id="screen-role-select"'));
  assert.match(s, /pickEntryType\('driver'\)/); assert.match(s, /pickEntryType\('merchant'\)/); assert.match(s, /id="lg-mode"/); assert.match(s, /id="lg-join"/);
  const a = R('js/auth.js'); assert.doesNotMatch(a, /showScreen\('screen-auth'\)/); assert.match(a, /window\.selectedType = type === 'driver' \|\| type === 'merchant' \? type : 'customer'/);
  assert.match(a, /status: role === 'customer' \? STATUS\.ACTIVE : STATUS\.INCOMPLETE/); // لا تفعيل تلقائي لكابتن/تاجر
});
test('login CSS: tap target >=56px, focus-visible, reduced-motion, no dead auth CSS, contrast of text colours >= 4.5:1', () => {
  const css = R('css/styles.css'); const lg = css.slice(css.indexOf('/* ===== LOGIN — MATLABK'));
  assert.match(lg, /\.lg-google\{[^}]*min-height:56px/); assert.match(lg, /\.lg-link\{[^}]*min-height:44px/); assert.match(lg, /:focus-visible/); assert.match(lg, /prefers-reduced-motion/);
  for (const dead of ['.auth-card', '.google-btn', '.google-ic', '.auth-tab', '.otp-', '#screen-auth', '#screen-otp', '.divider']) assert.ok(!css.includes(dead), dead);
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  assert.ok(cr('#4B5563', '#FFFFFF') >= 4.5);   // secondary text (note / legal / sub)
  assert.ok(cr('#1A1A2E', '#FFF3EB') >= 4.5);   // نص شريط نوع الحساب
  assert.ok(cr('#3c4043', '#FFFFFF') >= 4.5);   // نص زر Google
  assert.ok(cr('#B42318', '#FDECEC') >= 4.5);   // رسالة الخطأ
});
test('no localStorage/sessionStorage key from the old auth system survives', () => {
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url))) { const s = R('js/' + f); assert.doesNotMatch(s, /emailForSignIn|mova_link_intent/); }
  assert.match(R('js/auth.js'), /ENTRY_TYPE_KEY = 'matlabk_entry_type'/); // تلميح نوع الحساب لمستخدم Google الجديد فقط (UI hint)
});
test('email stays a profile data field (not an auth provider)', () => {
  const a = R('js/auth.js'); assert.match(a, /email: *user\.email/); assert.match(a, /export function syncToHubSpot/);
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
  const allowed = ['mova_loc_perm_', 'mova-functions', 'mova/', 'MOVA Icon System', 'MOVA Design System', 'MOVA Phase 3', 'MOVA DESIGN SYSTEM'];
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
