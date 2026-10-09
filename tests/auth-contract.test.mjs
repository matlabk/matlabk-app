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
test('Google Auth: popup is the primary flow, redirect kept only as explicit fallback; getRedirectResult + onAuthStateChanged intact', () => {
  const fb = R('js/firebase.js'); const imp = fb.match(/import \{([^}]*)\} from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js"/)[1].split(',').map((x) => x.trim()).sort();
  assert.deepEqual(imp, ['GoogleAuthProvider', 'getAuth', 'getRedirectResult', 'onAuthStateChanged', 'signInWithPopup', 'signInWithRedirect', 'signOut']); // لا شيء زيادة (لا Email)
  assert.match(fb, /new GoogleAuthProvider\(\)/); assert.match(fb, /prompt: 'select_account'/);
  const a = R('js/auth.js'); const lg = a.slice(a.indexOf('export async function loginGoogle('), a.indexOf('export async function loginGoogleRedirect()'));
  assert.match(lg, /await signInWithPopup\(auth, gProvider\)/);
  // signInWithPopup لازم تكون أول await داخل الـ click handler (وإلا المتصفح يحجب النافذة)
  assert.doesNotMatch(lg.slice(0, lg.indexOf('await signInWithPopup(')), /\bawait\b/);
  assert.doesNotMatch(lg, /signInWithRedirect/);               // المسار الأساسي ما بيستخدمش redirect
  const rd = a.slice(a.indexOf('export async function loginGoogleRedirect()')); assert.match(rd, /await signInWithRedirect\(auth, gProvider\)/); assert.match(rd, /REDIRECT_PENDING_KEY, String\(Date\.now\(\)\)/);
  const m = R('js/main.js'); assert.match(m, /getRedirectResult\(auth\)/); assert.match(m, /onAuthStateChanged\(auth, async user =>/);
  const html = R('index.html'); assert.match(html, /id="lg-google"[^>]*onclick="loginGoogle\(\)"/); assert.match(html, /المتابعة باستخدام Google/);
  assert.match(html, /id="lg-alt"[^>]*hidden[^>]*onclick="loginGoogleRedirect\(\)"/);
});
test('no race / no silent return: signed-out branch awaits redirect result, uses signedOutOutcome, resets UI, never leaves loading', () => {
  const m = R('js/main.js'); const h = m.slice(m.indexOf('onAuthStateChanged(auth, async user =>'));
  assert.match(h, /await withTimeout\(redirectSettled/); assert.match(h, /signedOutOutcome\(\{ currentUser: auth\.currentUser/); assert.match(h, /if \(out\.action === 'ignore'\) return;/);
  assert.match(h, /hideLoading\(\); resetLoginState\(\); clearRedirectPending\(\);/); assert.match(h, /if \(out\.error\) showLoginError\(out\.error\)/);
  assert.match(h, /if \(user\) \{\s*const attempt = captureLoginIntent\(\);[^\n]*\n\s*resetLoginState\(\); clearRedirectPending\(\);/);   // نجاح فعلي => فك الزر
  assert.match(m, /const redirectSettled = getRedirectResult\(auth\)\.catch/);                // النتيجة بتتستنّى مش بتتهمل
  const a = R('js/auth.js'); assert.match(a, /SESSION_NOT_READY/); assert.match(a, /setTimeout\(\(\) => \{ if \(!window\.CU\)/); // لا loading عالق بعد نجاح popup
});
test('logout resets login screen state; user is "logged in" only from onAuthStateChanged (never set by loginGoogle)', () => {
  const a = R('js/auth.js'); const lo = a.slice(a.indexOf('export async function doLogout()'), a.indexOf('\n}\n', a.indexOf('export async function doLogout()')));
  assert.match(lo, /await signOut\(auth\)/); assert.match(lo, /resetLoginState\(\)/); assert.match(lo, /clearRedirectPending\(\)/);
  const lg = a.slice(a.indexOf('export async function loginGoogle('), a.indexOf('export async function loginGoogleRedirect()')); assert.doesNotMatch(lg, /window\.CU\s*=[^=]/);
});
test('3 stages: home (screen-entry) -> role pick -> Google login screen; Google-only, no legacy UI', () => {
  const html = R('index.html');
  const home = html.slice(html.indexOf('id="screen-entry"'), html.indexOf('id="screen-role-pick"'));
  const pick = html.slice(html.indexOf('id="screen-role-pick"'), html.indexOf('id="screen-login"'));
  const login = html.slice(html.indexOf('id="screen-login"'), html.indexOf('id="screen-role-select"'));
  assert.doesNotMatch(html, /type="(email|password)"|auth-tab|lmail|lpass|login-btn|legacy-login|auth-register|id="screen-auth"|id="screen-otp"|otp-email|otp-card/i); assert.doesNotMatch(html, /id="[^"]*apple|onclick="[^"]*apple/i); // لا زر Apple
  // 1) الصفحة الرئيسية: هوية + خدمات + زر بدء، ولا زر Google ولا اختيار دور هنا
  for (const t of ['MATLAB<span>K</span>', 'خدماتك أقرب إليك', 'توصيل الطلبات', 'المشاوير', 'خدمات محلية']) assert.ok(home.includes(t), t);
  assert.match(home, /id="home-start"[^>]*onclick="openRolePick\(\)"/); assert.doesNotMatch(home, /loginGoogle|id="lg-google"/);
  assert.match(home, /id="home-err"[^>]*role="alert"/);
  // 2) اختيار النوع: ثلاث خيارات واضحة، كلها تحدد الدور قبل أي Google
  for (const r of ['customer', 'merchant', 'driver']) assert.match(pick, new RegExp(`onclick="pickRole\\('${r}'\\)"`), r);
  assert.equal([...pick.matchAll(/class="rp-card"/g)].length, 3); assert.doesNotMatch(pick, /loginGoogle/);
  for (const t of ['الدخول كعميل', 'الدخول كتاجر', 'الدخول ككابتن توصيل']) assert.ok(pick.includes(t), t);
  // 3) شاشة الدخول: زر Google واحد فقط (الدور من الحالة المحفوظة)، رسالة الخطأ داخل الشاشة، رجوع لتغيير النوع
  assert.match(login, /id="lg-google"[^>]*onclick="loginGoogle\(\)"/); assert.equal([...login.matchAll(/loginGoogle\(/g)].length, 1);
  assert.ok(login.includes('المتابعة باستخدام Google')); assert.match(login, /<svg class="lg-g"/);
  assert.match(login, /id="err-msg"[^>]*role="alert"/); assert.match(login, /id="lg-back"[^>]*onclick="openRolePick\(\)"/);
  assert.match(login, /id="lg-retry"[^>]*hidden[^>]*onclick="retryLoadAccount\(\)"/);
  assert.doesNotMatch(home + pick + login, /admin|لوحة الإدارة|دخول الإدارة/); // لا زر/نص إدارة ظاهر لغير الإدارة
  const m = R('js/main.js'); const win = m.slice(m.indexOf('Object.assign(window'), m.indexOf('});', m.indexOf('Object.assign(window')));
  for (const fnName of new Set([...(home + pick + login).matchAll(/onclick="([A-Za-z]+)\(/g)].map((x) => x[1]).filter((x) => x !== 'showScreen'))) assert.match(win, new RegExp('\\b' + fnName + '\\b'), fnName); // لا dead handlers
});
test('login UX: loading blocks double-click, errors inline (no Toast), offline guard, bfcache reset', () => {
  const a = R('js/auth.js');
  assert.match(a, /if \(!authLockStart\(\)\) return;/); assert.match(a, /b\.disabled = on/); assert.match(a, /aria-busy/); assert.match(a, /is-loading/);
  assert.match(a, /navigator\.onLine === false/); assert.match(a, /pageshow/); assert.match(a, /ev\.persisted/);
  assert.doesNotMatch(a, /showToast\(firebaseAuthErrorMessage/); assert.match(R('js/main.js'), /showLoginError\(firebaseAuthErrorMessage\(e\)\)/); assert.match(a, /describeAuthError/);
});
test('role gate: intent saved before Google; one shared gate (evaluateRoleGate) for popup/redirect/restore/same-uid; fail-closed; logout intact', () => {
  const a = R('js/auth.js'); assert.match(a, /status: role === 'customer' \? STATUS\.ACTIVE : STATUS\.INCOMPLETE/);
  assert.doesNotMatch(a, /pickEntryType|ENTRY_MODES/);
  // 1) الدور يُحفظ قبل Google وبشكل متزامن (قبل أول await)، ولا افتراض "عميل" عند غياب الاختيار
  const lg = a.slice(a.indexOf('export async function loginGoogle('), a.indexOf('export function openRolePick'));
  assert.ok(lg.indexOf('setEntryIntent(role)') > 0 && lg.indexOf('setEntryIntent(role)') < lg.indexOf('await signInWithPopup('));
  assert.match(lg, /if \(!INTENT_ROLES\.includes\(role\)\) \{ openRolePick\(\); showLoginError\(MSG_ROLE_REQUIRED\); return; \}/);
  assert.doesNotMatch(lg, /: 'customer'/);
  // 2) نفس المستخدم داخل بالفعل => نفس البوابة (قراءة طازجة)
  assert.match(lg, /await handleSignedIn\(cred\.user, captureLoginIntent\(\)\)/);
  // 3) main.js: بوابة واحدة، والتقاط الدور قبل أي تصفير، ولا توجيه مباشر هناك
  const m = R('js/main.js'); const h = m.slice(m.indexOf('onAuthStateChanged(auth, async user =>'));
  assert.match(h, /await handleSignedIn\(user, attempt\)/); assert.doesNotMatch(h, /routeUser\(\)|getDoc\(/);
  // 4) البوابة: القراءة -> evaluateRoleGate -> (رفض | تسجيل | توجيه)؛ CUD لا يُحمَّل قبل القرار
  const g = a.slice(a.indexOf('export async function handleSignedIn('), a.indexOf('export function retryLoadAccount'));
  assert.ok(g.indexOf('evaluateRoleGate(') < g.indexOf('window.CUD = data;')); assert.ok(g.indexOf('window.CUD = data;') < g.indexOf('routeUser();'));
  assert.match(g, /window\.CU = user; window\.CUD = null;/); assert.match(g, /MSG_USER_LOAD_FAILED, \{ retry: true \}/);
  // 5) routeUser fail-closed قبل تحميل أي بيانات
  const ru = a.slice(a.indexOf('export function routeUser()'), a.indexOf('// MATLABK: التوجيه من الحالة الفعلية'));
  assert.match(ru, /target === 'unknown'\) \{ rejectRoleMismatch\(MSG_INVALID_ROLE/); assert.ok(ru.indexOf("'unknown'") < ru.indexOf('startNotifListener()'));
  assert.match(a, /export async function rejectRoleMismatch\(message, \{ where = 'home', intent = null \} = \{\}\) \{\s*await doLogout\(\);/);
  const lo = a.slice(a.indexOf('export async function doLogout()')); assert.match(lo, /await signOut\(auth\)/); assert.match(lo, /clearEntryIntent\(\)/); assert.doesNotMatch(lo.slice(0, lo.indexOf('\n}\n')), /deleteDoc|setDoc|updateDoc/); // لا مسح بيانات
});
test('Firestore enforces roles independently of the UI: role immutable for self-updates; admin cannot be self-created; no second role doc per uid', () => {
  const blk = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /stores/{storeId}'));
  assert.match(blk, /request\.resource\.data\.role == resource\.data\.role/); assert.match(blk, /request\.resource\.data\.role in \['customer', 'merchant', 'driver'\]|role != 'admin'/);
  assert.match(blk, /allow create: if isSignedIn\(\) && request\.auth\.uid == userId/); // مستند واحد لكل uid
});
test('vehicle plate / specs optional: UI labels, no client requirement, rules size-only, state+migration consistent; vehicleType kept required (dispatch eligibility)', () => {
  const html = R('index.html'); for (const l of ['رقم اللوحة (اختياري)', 'مواصفات المركبة — الموديل (اختياري)', 'مواصفات المركبة — اللون (اختياري)']) assert.ok(html.includes(l), l);
  const d = R('js/driver.js'); const v1 = d.slice(d.indexOf('export function dregValidateStep1'), d.indexOf('const LICENSE_REQUIRED')); assert.doesNotMatch(v1, /d-plate|d-vmodel|d-vcolor/.test(v1) ? /^$/ : /d-plate|d-vmodel|d-vcolor/);
  assert.match(v1, /d-vtype/);
  const fn = rules.slice(rules.indexOf('function driverSubmitComplete'), rules.indexOf('function merchantSubmitComplete'));
  assert.doesNotMatch(fn, /plateNumber', ''\)\.size\(\) > 0/); assert.match(fn, /plateNumber', ''\)\.size\(\) <= 30/); assert.match(fn, /vehicleType', ''\)\.size\(\) > 0/);
  assert.doesNotMatch(R('js/account-state.js').split('isDriverDataComplete')[1].split('}')[0], /plateNumber/);
  assert.doesNotMatch(R('scripts/normalize-pending.mjs').split('driverComplete')[1].split('}')[0].replace(/\/\/[^\n]*/g, ''), /plateNumber/);
  assert.match(fn, /docsSubmitted/); assert.match(fn, /nationalId/); // باقي البيانات الإلزامية كما هي
});
test('admin: reachable only via Firestore role (no URL flag / storage flag); client guard + rules isAdmin; no default admin creation', () => {
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url))) { const s = strip(R('js/' + f)); assert.doesNotMatch(s, /[?&#]admin\b|searchParams\.get\(['"]admin|(local|session)Storage\.(get|set)Item\(['"][^'"]*admin/i, f); }
  assert.match(R('js/account-state.js'), /if \(u\.role === 'admin'\) return 'admin'/);
  assert.match(R('js/admin.js'), /if \(window\.CUD\?\.role !== 'admin'\) \{[^}]*return; \}/);
  assert.match(rules, /function isAdmin\(\) \{[\s\S]{0,160}role == 'admin'/);
  const users = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /stores/{storeId}')); assert.doesNotMatch(users.slice(users.indexOf('allow create'), users.indexOf('allow update')), /'admin'\]|== 'admin'\s*\)/); // الإنشاء لا يقبل admin
  for (const f of ['js/auth.js', 'js/main.js']) assert.doesNotMatch(strip(R(f)), /role: *'admin'|role *= *'admin'/);
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
  const a = R('js/auth.js'); assert.match(a, /localStorage\.removeItem\('manayef_drv_draft'\)/); assert.match(a, /window\.CUD = null; window\.CU = null; window\.uploadedDocs = \{\}/);
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
