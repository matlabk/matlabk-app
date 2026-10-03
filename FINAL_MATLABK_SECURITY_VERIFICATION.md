# FINAL_MATLABK_SECURITY_VERIFICATION

## M. Production readiness: **NOT READY**

**سبب القرار (P0 غير محقق/غير مُتحقَّق منه):**
1. **Firestore Rules لم تُختبر وقت التشغيل.** Emulator غير متاح: `npm install firebase-tools` → `403 forbidden by security policy`، و`curl https://registry.npmjs.org` → 403. Java 21 موجود لكن لا يوجد Emulator jar ولا `@firebase/rules-unit-testing`. النتيجة: **36 اختبار Emulator = BLOCKED — NOT EXECUTED** (مكتوبة وسليمة نحويًا `node --check`، لم تُنفَّذ).
2. **Dispatch الإنتاجي غير مكتمل.** حذفتُ المفتاح `legacyOpenOrderRead` تمامًا من الـRules والعميل. الآن لا يرى أي كابتن أي طلب إلا لو كتب Backend الـdispatcher `candidateDriverIds`. الـdispatcher في `functions/index.js` **غير منشور وغير مُختبر**؛ بدون نشره لن يصل أي طلب لأي كابتن (أمان صحيح، لكن الوظيفة معطّلة).
3. حدود `get()` في الـRules لم تُقَس (تحليل ثابت فقط، القسم I).
4. Google Sign-In وتبديل الحسابات لم تُجرَّب في متصفح (لا شبكة/متصفح).
5. المسافة ما زالت مُرسلة من العميل (سقف تقريبي فقط) ← P1 مفتوح من التدقيق السابق.

## A. Executive Summary
نُفِّذ فعليًا في الكود: اعتماد/رفض/إيقاف/حذف المتجر **ذرّي** (Batch) بدون catch صامت، حذف مفتاح الـdispatch القديم، تشديد بوابات التاجر (المنتجات/المتجر/الطلبات) إلى `role=merchant ∧ status=active`، منع حفظ كابتن كـ`pending` بدون بيانات كاملة، سكربت ترحيل للحسابات الناقصة، وتوسيع الاختبارات. ما تحقق وقت التشغيل: **الاختبارات الثابتة والمنطقية فقط (31/31)**. سلوك الـRules كله غير متحقَّق.

## B. Files changed (هذه الجولة)
`firestore.rules` · `js/admin.js` · `js/auth.js` · `js/driver.js` · `js/orders.js` · `js/firebase.js` (+writeBatch) · `js/account-state.js` · `workers/cloudinary-sign/index.js` (مسار matlabk/) · `functions/package.json` (الاسم) · `scripts/normalize-pending.mjs` (جديد) · `tests/` (firestore.rules.test.mjs موسَّع، auth-contract، normalize-pending، undef-check، import-check) · هذا التقرير (وحُذف FINAL_MATLABK_AUTH_AUDIT.md السابق).

## C. Security fixes
| # | Problem | Old | New | Verification |
|---|---|---|---|---|
| 1 | موافقة التاجر غير ذرّية | `updateDoc(users)` ثم `updateDoc(stores).catch(()=>{})` ← ممكن users=active وstores=pending | `adminDecision()` = `writeBatch` يكتب users + stores + notification معًا؛ الخطأ يظهر ولا يُبتلع | static PASS؛ الذرّية فعليًا BLOCKED |
| 2 | إيقاف/تفعيل/حذف/تعديل متجر | كتابتان منفصلتان + catch صامت | نفس Batch | static PASS؛ runtime BLOCKED |
| 3 | `legacyOpenOrderRead` | يفتح كل `searching_driver` لأي كابتن active | **محذوف** من الـRules والعميل | static PASS؛ runtime BLOCKED |
| 4 | كابتن `pending` ناقص البيانات | يبقى pending بحفظ ناقص | حفظ pending لكابتن يتطلب `driverSubmitComplete` | runtime BLOCKED |
| 5 | صلاحيات التاجر | بعضها `status=='active'` فقط | الكل عبر `isApprovedMerchant()` (role+status) | static PASS؛ runtime BLOCKED |
| 6 | حالة المتجر عند إعادة التقديم | تبقى rejected | `rejected→pending` مع `users.status=pending` (getAfter) | runtime BLOCKED |
| 7 | كتابة Online بصمت | `.catch(()=>{})` | يرجّع الحالة ويُظهر خطأ | static PASS |
| 8 | تغيير الدور | — | `role` ثابت وغير موجود في أي allow-list | static PASS؛ runtime BLOCKED |

## D. Authentication flow
Continue with Google (redirect) → Firebase Auth → `users/{uid}` (إنشاء تلقائي بنوع الحساب المختار) → `resolveRoute()` من الحالة الفعلية. بدون إيميل/باسورد للتسجيل الجديد؛ الدخول القديم مطوي للتوافق. **Runtime: BLOCKED.** تغيير المستخدم يصفّر `CUD` والمسودة و`uploadedDocs` (اختبار ثابت PASS؛ ليس اختبار متصفح، ولا يثبت عدم تسرّب الحالة فعليًا).

## E. Profile completion
مشتق من بيانات `users` الفعلية (name ≥2 + phone 10–15) داخل الـRules (`customerProfileComplete`) لإنشاء order/ride/external_purchase؛ لا يوجد علم `profileComplete`. الكابتن: `driverSubmitComplete`. التاجر: `merchantSubmitComplete` (getAfter على المتجر). **Runtime BLOCKED.**

## F. Captain approval flow
incomplete → (بيانات كاملة) → pending → admin: active | rejected → (تصحيح) → pending. كل الوظائف التشغيلية خلف `isActiveDriver()`؛ GPS/online أضيف لهما `status=='active'`. **Runtime BLOCKED.**

## G. Merchant approval flow
incomplete → Transaction (متجر + users=pending) → admin Batch (users+stores) → active | rejected (+سبب) → إعادة تقديم. **Runtime BLOCKED.**

## H. Admin authorization
`isAdmin()` = `users/{uid}.role=='admin'` من Firestore. إنشاء `role=admin` من العميل مرفوض في `create`، وتغيير `role` مرفوض في `update` (بحسب الكود؛ غير مُشغَّل). **ملاحظة صريحة:** `approvedBy/approvedAt` يضعها كود الأدمن في المتصفح، فهي ليست server-controlled بالكامل؛ فرضها عبر Callable Function غير منفَّذ.

## I. Firestore Rules — حدود `get()`/`getAfter()` (تحليل ثابت، **غير مقاس**)
الحدود: 10 مستندات للطلب الواحد، 20 للـbatch/transaction؛ المستند المتكرر يُحتسب مرة. تقدير من قراءة الكود:
| العملية | مستندات مقروءة (تقدير) | الحد | التقييم |
|---|---|---|---|
| إنشاء order | users + settings/pricing + settings/commission + stores + N منتجات = 4+N | 10 | N≤6 فقط؛ أكثر قد يُرفض |
| قبول order | ≈2–3 | 10 | آمن (تقدير) |
| إنشاء ride | ≈2–3 | 10 | آمن (تقدير) |
| dispatch ride/EP من العميل | ≈4–5 | 10 | آمن (تقدير)، لكن الاستعلام مرفوض أصلًا (J) |
| إنشاء external purchase | 3 | 10 | آمن |
| إشعار entity | ≈2–3 | 10 | آمن (تقدير) |
| تقديم تاجر (transaction) | ≈2–3 | 20 | آمن (تقدير) |
| قرار أدمن (batch) | ≈2–4 | 20 | آمن (تقدير) |
**كلها تقديرات وليست نتائج Emulator → BLOCKED.** الحل المعماري لو تجاوزنا الحد: Callable Function لإنشاء الطلب.

## J. Dispatch security
- قراءة order: `searching_driver ∧ driverId==null ∧ isActiveDriver ∧ uid ∈ candidateDriverIds`. قبول: `isOnlineActiveDriver ∧ uid ∈ candidateDriverIds ∧ driverName == users.fullName||name`.
- `candidateDriverIds` ليس في أي allow-list لتحديث order ولا في create (اختبار ثابت PASS) ← لا حقن ذاتي إلا بالـAdmin SDK.
- **Gap حرج:** استعلام اختيار السائقين في `rides.js`/`external.js` يقرأ `users` من حساب العميل والـRules ترفضه ⇒ dispatch للمشاوير والشراء الخارجي لا يعمل من العميل؛ يعتمد على `functions/` (غير منشورة؛ `APP_CONFIG.backendDispatch=false`). "أقرب 3" مطبَّق فقط في `functions/index.js` (غير مُختبر).

## K. Runtime test results
### K1. نُفِّذت فعليًا (31) — `node --test`
| TEST | STATUS | EVIDENCE |
|---|---|---|
| customer: incomplete -> complete profile; complete -> home | PASS | `node --test` exit 0 |
| profileComplete flag is ignored (derived from real data only) | PASS | `node --test` exit 0 |
| captain: incomplete/pending/rejected -> register screen; active -> dashboard | PASS | `node --test` exit 0 |
| merchant: incomplete -> form; pending/rejected -> status; active -> dashboard; unknown -> never dashboard | PASS | `node --test` exit 0 |
| client self-claimed fields do not grant access | PASS | `node --test` exit 0 |
| phone validation mirrors rules (10..15 chars) | PASS | `node --test` exit 0 |
| no user-facing old brand | PASS | `node --test` exit 0 |
| registration is Google only; no email/password creation path remains | PASS | `node --test` exit 0 |
| only admin code writes status active / approval audit fields | PASS | `node --test` exit 0 |
| rules: creation status, transitions, and gates present | PASS | `node --test` exit 0 |
| onboarding page: every screen id referenced by routing exists | PASS | `node --test` exit 0 |
| legacy open-dispatch bypass is gone from rules and client | PASS | `node --test` exit 0 |
| orders: candidateDriverIds is never in any client update allow-list (only backend can write it) | PASS | `node --test` exit 0 |
| admin approval/rejection/pause/delete use atomic batch; no silent catch on users/stores writes | PASS | `node --test` exit 0 |
| driver presence write failure is surfaced, not swallowed | PASS | `node --test` exit 0 |
| account switching: main.js resets per-user state when uid changes; logout clears drafts/CUD | PASS | `node --test` exit 0 |
| rules: operational gates use role+status active (driver & merchant) | PASS | `node --test` exit 0 |
| rules: user cannot write role or approval metadata via any self-update allow-list | PASS | `node --test` exit 0 |
| branding: remaining "mova" tokens are only documented legacy identifiers | PASS | `node --test` exit 0 |
| driver pending: complete -> keep; missing any required -> to_incomplete | PASS | `node --test` exit 0 |
| merchant pending: needs valid store data | PASS | `node --test` exit 0 |
| non-pending / other roles untouched | PASS | `node --test` exit 0 |
| UI normalizes legacy incomplete pending driver to incomplete (never treated as submitted) | PASS | `node --test` exit 0 |
| external_purchases create keys ⊆ rules whitelist & no deliveryAddress | PASS | `node --test` exit 0 |
| orders create keys: client payload ⊆ rules | PASS | `node --test` exit 0 |
| rides create keys | PASS | `node --test` exit 0 |
| ratings use deterministic id; notifications support entityType | PASS | `node --test` exit 0 |
| no secrets / blob SW | PASS | `node --test` exit 0 |
| esc: no raw < > " ' survive (safe in text and quoted attributes) | PASS | `node --test` exit 0 |
| escJs: payload cannot break out of a single-quoted JS string inside onclick | PASS | `node --test` exit 0 |
| esc does not double-escape plain Arabic text | PASS | `node --test` exit 0 |

أوامر أخرى نُفِّذت: `node --check` على كل `js/*.js` و`functions/index.js` و`workers/…` و`scripts/…` و`tests/*.mjs`: **PASS** · `tests/import-check.mjs`: **PASS** · `tests/undef-check.mjs`: **PASS** (baseline لـ16 اسمًا راجعتُ بعضها يدويًا كإيجابيات كاذبة مسبقة الوجود) · `npm test`: لا يوجد `package.json` للتطبيق، و`tests/package.json` يتطلب Emulator → **BLOCKED**.
### K2. اختبارات Emulator (36) — **كلها BLOCKED — NOT EXECUTED**
المحاولة: `node --test tests/firestore.rules.test.mjs` → `ERR_MODULE_NOT_FOUND: @firebase/rules-unit-testing`؛ والتثبيت فشل بـ403.
| TEST | STATUS | EVIDENCE |
|---|---|---|
| Customer B cannot read Customer A order | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Candidate driver reads order; non-candidate driver cannot | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Legacy open-order bypass is disabled even if a settings/dispatch doc exists | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Non-candidate driver: query for open searching orders denied; candidate-scoped query allowed | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Driver cannot self-inject into candidateDriverIds nor accept as non-candidate | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Driver cannot change price/fee of an order | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Driver cannot forge driverName on accept; correct name succeeds | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Rating: once only, deterministic id, stars/comment limits | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Merchant A cannot edit merchant B product | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Counter: random user cannot bump | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| User cannot self-create with points or admin role | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| External purchase canonical create succeeds; legacy deliveryAddress-only shape fails | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Inflated ride distance rejected (2km actual vs 500km claimed) | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Notification: ride/external entity schema; spoofed event rejected | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| Anonymous cannot read anything; any_requests create ok but not read | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| incomplete customer cannot create external purchase; complete can | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| customer can complete own profile (name/phone/address) but cannot touch role/status/points | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| driver: create only as incomplete; submit needs full data; cannot self-approve or edit audit fields | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| pending/rejected driver is not an active driver: cannot read candidate order or go online; rejected can resubmit | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| merchant: incomplete -> pending only with complete store data; cannot self-approve; pending cannot create products or open store | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| admin can approve/reject with audit fields; role escalation to admin is impossible | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| incomplete captain: DENIED read of candidate order, accept, GPS, online, status update | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| pending captain: DENIED read of candidate order, accept, GPS, online, status update | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| rejected captain: DENIED read of candidate order, accept, GPS, online, status update | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| incomplete merchant: DENIED open/close store, product create/update/delete, order status | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| pending merchant: DENIED open/close store, product create/update/delete, order status | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| rejected merchant: DENIED open/close store, product create/update/delete, order status | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| active captain & active merchant ARE allowed | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| ROLE ESCALATION matrix: every self role change fails | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| self-approval matrix + forged approval metadata | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| state machine: pending -> active only by admin; rejected -> pending by owner after fixing data; active -> pending denied | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| legacy incomplete PENDING driver cannot re-save as pending without full data | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| merchant approval ATOMIC: admin batch users+stores commits both; partial batch with missing store fails entirely | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| rejected merchant resubmits: users->pending and stores rejected->pending in one batch | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| GET-LIMIT: order create with 6 distinct products passes (4 fixed docs + 6 = 10); 7 fails — documents the real ceiling | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |
| incomplete customer denied order / ride creation (same gate as external purchase) | BLOCKED — NOT EXECUTED | مكتوب في tests/firestore.rules.test.mjs؛ لم يُشغَّل |

### العدّ النهائي
**PASS: 31 · FAIL: 0 · BLOCKED: 36 (Emulator) + Google/تبديل الحسابات في متصفح + Functions + `npm test` للتطبيق.**

## L. Remaining risks
- كل الـRules غير مُختبرة وقت التشغيل: قد تحتوي أخطاء تقييم تمنع تدفقات سليمة أو تسمح بما لا نقصد.
- Dispatcher غير منشور ⇒ لا طلبات تصل للكباتن؛ ride/EP dispatch معطّل.
- المسافة/السعر client-controlled مع سقف تقريبي. حد ~6 منتجات متميزة لكل طلب (تقدير).
- `approvedBy` من client الأدمن.
- ترحيل البيانات: شغّل `scripts/normalize-pending.mjs` (Dry-run ثم `--apply`)؛ حتى ذلك الحين الواجهة تعامل الكابتن الناقص كـincomplete، والـRules ترفض حفظه pending ناقصًا. التجار pending بلا بيانات متجر يحتاجون نفس السكربت.
- Cloudinary/HubSpot Workers: **NOT AUDITABLE — SOURCE NOT PROVIDED**. مسار `matlabk/` في المرجع فقط؛ أصول `mova/…` الحالية Legacy ولم تُمس.
- متبقٍّ من التقارير السابقة: spam في any_requests، CSP `unsafe-inline`، تجميعات الأدمن.

## Deployment
1. `cd tests && npm i && npm test` على Emulator وأصلح الفشل. 2. انشر `functions/` (`ROUTING_BASE_URL`) واختبر dispatch على staging. 3. `scripts/normalize-pending.mjs` Dry-run ثم `--apply`. 4. انشر الـRules/indexes ثم الواجهة، ثم `APP_CONFIG.backendDispatch=true`. 5. أنشئ مستند الأدمن يدويًا وفعّل Google Auth.
