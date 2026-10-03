# MATLABK — Fix Pass Report (Emulator/Functions) — لا نشر

**PRODUCTION READINESS: NOT READY** (لا Runtime evidence للـRules ولا للـFunctions الحقيقية). لم يُنفَّذ `firebase deploy` ولا أي نشر.

## 0. الإعداد
- `firebase.json`: `functions.source`، `firestore` (rules + indexes الموجودين)، `emulators` (firestore:8080, functions:5001). **بدون hosting**.
- `.firebaserc`: `default = go-elmanayef` (يطابق `projectId` في `js/firebase.js`؛ تحقق منه اختبار). لم يتغير أي مشروع.
- محاولة التشغيل: `npm install firebase-tools @firebase/rules-unit-testing` ← **E403 (forbidden by security policy)**؛ لا `firebase` CLI ولا Emulator jar. `node --test tests/firestore.rules.test.mjs` ← `ERR_MODULE_NOT_FOUND`. **= BLOCKED.**
- `tests/package.json`: `npm test` = `firebase emulators:exec --config ../firebase.json --project go-elmanayef --only firestore "node --test firestore.rules.test.mjs"` (لم يُشغَّل).

## 1. FILES ADDED / MODIFIED / DELETED
**ADDED**
| ملف | لماذا | أثره على MATLABK |
|---|---|---|
| `firebase.json`, `.firebaserc` | كانا ناقصين؛ لتشغيل الـEmulator ونشر `functions/` لاحقًا | لا أثر على التطبيق نفسه |
| `functions/lib/dispatch-core.js` | منطق الـdispatch/التحقق/التدوير نقي + orchestration بـIO مُحقَن (لأن `index.js` لا يعمل بدون `firebase-admin`) | هو المنطق الفعلي الذي ينفّذه `index.js` |
| `tests/functions-core.test.mjs` (24 اختبار) | اختبار سلوك الـdispatcher فعليًا | — |

**MODIFIED**
| ملف | ماذا تغيّر | ما الذي لم يتغير |
|---|---|---|
| `functions/index.js` | نفس أسماء الـexports السبعة؛ بقت طبقة IO رفيعة فوق الـcore: Transactions بـprecondition، Triggers تعمل **عند دخول الحالة فقط**، scheduler موسّع | أسماء الـexports، `aggregateOrderStats`، `functions/package.json` |
| `js/orders.js` | `merchantRespond`: إعادة محاولة الخطوة الثانية (3 مرات) وتجاهل الحالة لو الـbackend سبق، وخطأ واضح `search-start-failed` | الحالات والانتقالات و`transitionOrder` |
| `js/merchant.js` | رسالة تقول إن البحث سيبدأ تلقائيًا بدل "حدث خطأ" | الواجهة |
| `js/driver.js` | تصفير `activeOrderId` بعد التسليم لم يعد صامتًا (log + self-heal)، والـself-heal صار يغطي `DELIVERED` أيضًا | باقي دورة الكابتن |
| `tests/auth-contract.test.mjs` | +6 اختبارات static (config، حقول backend، merchantRespond، driver، functions، بقاء القاعدتين) | — |
| `tests/firestore.rules.test.mjs`, `tests/package.json` | +4 اختبارات Emulator (BLOCKED) وتحديث projectId والسكربت | — |

**DELETED**: لا شيء. **UNCHANGED عمدًا:** `firestore.rules` (لم أحتج تعديلها)، `firestore.indexes.json`، `rides.js`/`external.js` (مسار الـclient dispatch باقٍ)، `index.html`، `auth.js`، `admin.js`، الـworkers، `scripts/`.

## 2. تحليل `customerDispatchOk` / `epCustomerDispatchOk` (لم تُحذف)
- **الاستخدام:** تُستدعى فقط من `allow update` للـrides/external_purchases. العميل يصل إليها من `dispatchRide` (`rides.js:342,420`) و`dispatchExternalPurchase` (`external.js:130,186`)، وكلاهما يبدأ باستعلام على `users` تمنعه `users.read` ⇒ **لا تنجح اليوم في الواقع** (NOT VERIFIED بـEmulator).
- **ماذا يحدث عند الحذف:** لن يتأثر شيء الآن؛ بعد نشر الـbackend يصبح هو الكاتب الوحيد. **لم أحذفها** لأن الـbackend غير مُثبَت وقت التشغيل، بحسب تعليماتك.
- **المخاطرة المتبقية:** عميل خبيث يستطيع كتابة `candidateDriverIds` (ثلاثة كباتن مؤهلين) مباشرة عبر الـAPI. القرار: M1 بعد نجاح اختبارات الـbackend.

## 3. الإصلاحات المطلوبة (1–12)
| # | الإصلاح | الدليل |
|---|---|---|
| 1 | منع loop عند عدم وجود مرشحين: لا كتابة أصلًا، والـtrigger لا يعمل إلا عند **دخول** الحالة | اختبار `لا مرشحين` + static على `entered()` |
| 2 | race: `applyPatch` = Transaction تتحقق أن (status, driverId, candidates, round, distanceCheck) كما قُرئت وإلا conflict | اختبار `سباق` (محاكاة تنفيذين متوازيين) — **الـTransaction الحقيقية NOT VERIFIED** |
| 3 | timeout للـrouting (`ROUTING_TIMEOUT_MS`=5000) | اختبار `fetchRouteKm` (timeout فعلي) |
| 4 | تحقق إحداثيات (نطاق، NaN، 0,0) للتجار/العملاء/الكباتن/المصدر والوجهة | اختبارات `استبعاد` و`إحداثيات…` |
| 5 | عدم استجابة الكابتن: مهلة (45ث مشاوير/شراء، 90ث طلبات) أو فقدان أهلية كل المرشحين ⇒ تدوير | اختبارا `عدم استجابة` و`كل المرشحين Offline` |
| 6 | عدم إعادة نفس المرشحين: `triedDriverIds` (مستبعدون، مع دورة جديدة فقط عند استنفاد المجموعة) | اختبارا `رفض الكل`, `عدم استجابة` |
| 7 | حد واضح: `DISPATCH_MAX_ROUNDS`=3 ⇒ `dispatchExhausted` (+ المشوار/الشراء يرجعان `requested`)؛ والـscheduler يتجاهل المستنفَد | اختبارا `حد التدوير` (طلب/مشوار) |
| 8 | لا كابتن مناسب: `noop` بلا كتابة، وبعد `DISPATCH_MAX_AGE_MS` (30 دقيقة) يعلَّم `dispatchExhausted` **دون إلغاء** | اختبار `بلا كباتن لفترة طويلة` |
| 9 | `merchantRespond`: retry + تسامح + رسالة؛ وشبكة أمان في الـscheduler تحرّك `merchant_accepted` العالق (>30ث) إلى `searching_driver` | static + `planAdvanceMerchant` unit — **الـclient لم يُشغَّل** |
| 10 | إزالة الصمت من تصفير `activeOrderId` + self-heal للتسليم | static (اختبار على النص) |
| 11 | external purchase العالق على قرار العميل: بعد `EP_DECISION_TIMEOUT_MS` (30 دقيقة، `0` يعطّله) يُلغى ويُفرَّغ الكابتن ويُرسل إشعار للطرفين | `planExternalStale` unit — **سياسة افتراضية تحتاج قرارك** |
| 12 | التحقق من المسافة/السعر **قبل** الـdispatch داخل نفس الكتابة (انظر 4) | اختبارات المسافة والسعر |

## 4. ما تغيّر في سلوك السعر/المسافة (للمراجعة قبل أي نشر)
- نفس payload الإنشاء من العميل (لا تغيير في UX). الـbackend يعيد حساب المسافة (`ROUTING_BASE_URL`) والسعر (`settings/pricing`، نفس معادلة `js/pricing.js`: مطابقة بقراءة الكود + اختبارين رقميين) **قبل** أول dispatch. إن اختلفت المسافة (>1 كم و>15%) أو السعر (>1) يستبدلها بالقيم الموثوقة، ويكتب `distanceCheck/authoritativeDistanceKm/verifiedAt/needsReview` (كلها backend-only: ثبت بالـstatic أنها ليست في أي قائمة سماح).
- **أثرها الظاهر:** قد يرتفع السعر عند الـdispatch إذا كان تقدير العميل أقل من الحقيقي (بما فيه استغلال `distanceKm=null`).
- **بدون routing مُعَدّ أو معطّل:** لا dispatch (`distanceCheck: routing_unavailable`)، ولا استخدام لرقم العميل. تجاوز صريح فقط: `ALLOW_UNVERIFIED_DISPATCH=true` (يوسم `unverified` + `needsReview`)، أو `VERIFY_BEFORE_DISPATCH=false`. **هذا افتراضي صارم يوقف التشغيل إن لم يُضبط الـrouting.**
- حقول backend الجديدة (additive، لا تغيير لحقول موجودة): `triedDriverIds, dispatchRound, dispatchedAt, dispatchExhausted, distanceCheck, authoritativeDistanceKm, verifiedAt, needsReview` (+`cancelReason` في external_purchases).

## 5. TEST RESULTS
**PASS (نُفِّذت فعليًا — `node --test`، 61/61):**
| TEST | STATUS |
|---|---|
| customer: incomplete -> complete profile; complete -> home | PASS |
| profileComplete flag is ignored (derived from real data only) | PASS |
| captain: incomplete/pending/rejected -> register screen; active -> dashboard | PASS |
| merchant: incomplete -> form; pending/rejected -> status; active -> dashboard; unknown -> never dashboard | PASS |
| client self-claimed fields do not grant access | PASS |
| phone validation mirrors rules (10..15 chars) | PASS |
| no user-facing old brand | PASS |
| registration is Google only; no email/password creation path remains | PASS |
| only admin code writes status active / approval audit fields | PASS |
| rules: creation status, transitions, and gates present | PASS |
| onboarding page: every screen id referenced by routing exists | PASS |
| legacy open-dispatch bypass is gone from rules and client | PASS |
| orders: candidateDriverIds is never in any client update allow-list (only backend can write it) | PASS |
| admin approval/rejection/pause/delete use atomic batch; no silent catch on users/stores writes | PASS |
| driver presence write failure is surfaced, not swallowed | PASS |
| account switching: main.js resets per-user state when uid changes; logout clears drafts/CUD | PASS |
| rules: operational gates use role+status active (driver & merchant) | PASS |
| rules: user cannot write role or approval metadata via any self-update allow-list | PASS |
| branding: remaining "mova" tokens are only documented legacy identifiers | PASS |
| firebase.json: functions + firestore + emulators only; NO hosting; project pinned to go-elmanayef | PASS |
| backend-only dispatch/verification fields are never client-writable (no allow-list, no create whitelist) | PASS |
| merchantRespond: retries step 2, tolerates backend having advanced, surfaces failure; merchant UI message | PASS |
| driver: delivered cleanup not silent; self-heal covers DELIVERED | PASS |
| functions: triggers fire only on entering state; scheduler covers merchant_accepted, offers, EP stale; routing has timeout | PASS |
| customerDispatchOk / epCustomerDispatchOk are still present (not removed without approval) | PASS |
| أقرب 3 فعلًا: ترتيب بالمسافة، حد أقصى 3، استبعاد البعيد جدًا | PASS |
| استبعاد: Offline / لا lastSeen / lastSeen قديم / مهمة نشطة / غير active / إحداثيات غير صالحة / مركبة غير مناسبة | PASS |
| لا مرشحين: لا كتابة (لا loop) ويرجع noop | PASS |
| سباق: تشغيل dispatch مرتين بالتوازي => واحد بس ينجح والتاني conflict/noop، والمرشحون لا يتكررون | PASS |
| طلب اتعيّن له كابتن: لا dispatch | PASS |
| عدم استجابة: بعد المهلة يتبدّل المرشحون بدون تكرار الأولين (طلب) | PASS |
| كل المرشحين Offline => تدوير فوري قبل المهلة | PASS |
| حد التدوير: بعد maxRounds => dispatchExhausted ولا إرسال جديد (طلب) | PASS |
| مشوار: requested -> driver_offered بأقرب 3 ومركبة مناسبة، rejectedDriverIds فاضية | PASS |
| مشوار: رفض الكل (رجع requested) ثم dispatch جديد لا يعيد نفس المرشحين | PASS |
| مشوار: انتهاء العرض بلا بدائل => يرجع requested (مخرج)، ثم دورة جديدة لنفس الكابتن؛ ولو أوفلاين لا حلقة | PASS |
| مشوار: بعد maxRounds => requested + dispatchExhausted (حد واضح) | PASS |
| الشراء الخارجي: dispatch بإحداثيات pickupLocation.latitude/longitude، ويسجّل updatedAt | PASS |
| تضخيم المسافة (2km حقيقية، العميل بعت 12 والسعر مضخّم) => يتصحّح قبل الـ dispatch | PASS |
| تقليل المسافة/Flat fare (distanceKm=null) => يتصحّح للسعر الموثوق | PASS |
| مسافة/سعر سليمين => ok بدون تعديل القيم | PASS |
| routing واقع/غير مُعد => لا dispatch (blocked) ولا ثقة في رقم العميل؛ allowUnverified صريح فقط يتجاوز | PASS |
| إحداثيات متجر/عميل غير صالحة أو pricing ناقص => blocked | PASS |
| fetchRouteKm: timeout فعلي، إحداثيات سيئة، استجابة غير صالحة | PASS |
| معادلة السعر في الـ backend = js/pricing.js (نفس التقريب والحد الأدنى) | PASS |
| merchant_accepted عالق => يتقدّم لـ searching_driver بعد المهلة فقط، ويسجّل system في السجل | PASS |
| external item_unavailable/budget_exceeded عالق => يتلغي بعد المهلة ويفضّي الكابتن؛ المهلة 0 تعطّله | PASS |
| index.js: نفس أسماء الـ exports + trigger لا يستجيب إلا عند دخول الحالة (لا loop) | PASS |
| طلب بلا كباتن لفترة طويلة => يتعلّم dispatchExhausted مرة واحدة (بدون إلغاء) ثم لا كتابة | PASS |
| driver pending: complete -> keep; missing any required -> to_incomplete | PASS |
| merchant pending: needs valid store data | PASS |
| non-pending / other roles untouched | PASS |
| UI normalizes legacy incomplete pending driver to incomplete (never treated as submitted) | PASS |
| external_purchases create keys ⊆ rules whitelist & no deliveryAddress | PASS |
| orders create keys: client payload ⊆ rules | PASS |
| rides create keys | PASS |
| ratings use deterministic id; notifications support entityType | PASS |
| no secrets / blob SW | PASS |
| esc: no raw < > " ' survive (safe in text and quoted attributes) | PASS |
| escJs: payload cannot break out of a single-quoted JS string inside onclick | PASS |
| esc does not double-escape plain Arabic text | PASS |

أيضًا PASS: `node --check` على كل `js/*.js` و`functions/**` و`scripts/` و`tests/*.mjs`؛ `tests/import-check.mjs`؛ `tests/undef-check.mjs` (baseline).
**FAIL:** لا شيء (ظهر خللان أثناء العمل وأُصلحا: فقدان `toMillis` عند نسخ المستند ⇒ كانت كل العروض تنتهي فورًا؛ وتوقعان خاطئان في اختباري).
**BLOCKED (40 اختبار Emulator — E403 / لا CLI):**
| TEST | STATUS |
|---|---|
| Customer B cannot read Customer A order | BLOCKED |
| Candidate driver reads order; non-candidate driver cannot | BLOCKED |
| Legacy open-order bypass is disabled even if a settings/dispatch doc exists | BLOCKED |
| Non-candidate driver: query for open searching orders denied; candidate-scoped query allowed | BLOCKED |
| Driver cannot self-inject into candidateDriverIds nor accept as non-candidate | BLOCKED |
| Driver cannot change price/fee of an order | BLOCKED |
| Driver cannot forge driverName on accept; correct name succeeds | BLOCKED |
| Rating: once only, deterministic id, stars/comment limits | BLOCKED |
| Merchant A cannot edit merchant B product | BLOCKED |
| Counter: random user cannot bump | BLOCKED |
| User cannot self-create with points or admin role | BLOCKED |
| External purchase canonical create succeeds; legacy deliveryAddress-only shape fails | BLOCKED |
| Inflated ride distance rejected (2km actual vs 500km claimed) | BLOCKED |
| Notification: ride/external entity schema; spoofed event rejected | BLOCKED |
| Anonymous cannot read anything; any_requests create ok but not read | BLOCKED |
| incomplete customer cannot create external purchase; complete can | BLOCKED |
| customer can complete own profile (name/phone/address) but cannot touch role/status/points | BLOCKED |
| driver: create only as incomplete; submit needs full data; cannot self-approve or edit audit fields | BLOCKED |
| pending/rejected driver is not an active driver: cannot read candidate order or go online; rejected can resubmit | BLOCKED |
| merchant: incomplete -> pending only with complete store data; cannot self-approve; pending cannot create products or open store | BLOCKED |
| admin can approve/reject with audit fields; role escalation to admin is impossible | BLOCKED |
| incomplete captain: DENIED read of candidate order, accept, GPS, online, status update | BLOCKED |
| pending captain: DENIED read of candidate order, accept, GPS, online, status update | BLOCKED |
| rejected captain: DENIED read of candidate order, accept, GPS, online, status update | BLOCKED |
| incomplete merchant: DENIED open/close store, product create/update/delete, order status | BLOCKED |
| pending merchant: DENIED open/close store, product create/update/delete, order status | BLOCKED |
| rejected merchant: DENIED open/close store, product create/update/delete, order status | BLOCKED |
| active captain & active merchant ARE allowed | BLOCKED |
| ROLE ESCALATION matrix: every self role change fails | BLOCKED |
| self-approval matrix + forged approval metadata | BLOCKED |
| state machine: pending -> active only by admin; rejected -> pending by owner after fixing data; active -> pending denied | BLOCKED |
| legacy incomplete PENDING driver cannot re-save as pending without full data | BLOCKED |
| merchant approval ATOMIC: admin batch users+stores commits both; partial batch with missing store fails entirely | BLOCKED |
| rejected merchant resubmits: users->pending and stores rejected->pending in one batch | BLOCKED |
| GET-LIMIT: order create with 6 distinct products passes (4 fixed docs + 6 = 10); 7 fails — documents the real ceiling | BLOCKED |
| incomplete customer denied order / ride creation (same gate as external purchase) | BLOCKED |
| clients can NEVER write backend-owned dispatch/verification fields (orders / rides / external_purchases) | BLOCKED |
| merchant respond path: active merchant moves waiting_merchant -> merchant_accepted -> searching_driver; customer cannot | BLOCKED |
| driver cleanup: driver may clear own activeOrderId but not set it to an arbitrary order | BLOCKED |
| customerDispatchOk still guards: customer cannot offer a ride to a pending/offline/self candidate list | BLOCKED |

**NOT VERIFIED:** سلوك الـRules كله؛ Transactions/Triggers/Scheduler الحقيقية لـFirestore وFunctions؛ حدود `get()`؛ تفاعل الواجهة (Google، تبديل الحسابات، merchantRespond، التسليم)؛ `npm test` للتطبيق (لا يوجد). **NOT AUDITABLE:** Cloudinary/HubSpot Workers.

## 6. REMAINING ISSUES
1. لا Runtime evidence لأي شيء متعلق بـFirestore/Functions.
2. `APP_CONFIG.backendDispatch` ما زال `false`: يجب قلبه عند نشر الـbackend (وإلا يحاول العميل dispatch ويفشل كما كان).
3. بعد استنفاد الجولات لا يملك العميل زر "إعادة المحاولة" فعّالًا (يحتاج قرارًا: M2/M4).
4. المشوار: لا إلغاء من العميل (M2 مؤجل). لا إلغاء تلقائي عند عدم وجود كابتن (M4 مؤجل).
5. `customerDispatchOk/epCustomerDispatchOk` باقيتان (ثغرة اختيار المرشحين من العميل) حتى قرار M1.
6. تحريك `merchant_accepted` من الـbackend لا يُرسل إشعار "جاري البحث" للعميل.
7. scheduler يستدعي routing لكل مستند معلّق كل دقيقة إذا كان الـrouting واقعًا (حد 200 مستند، timeout 5ث)؛ قد يتجاوز مهلة 120ث. مقبول للحجم الحالي، يحتاج مراجعة عند التوسع.
8. تحقق `verifyEarly` قد يتزامن مع أول dispatch ⇒ conflict ⇒ يُعاد في الدقيقة التالية (تأخير فقط).
9. حدّ ~6 أصناف مميزة للطلب (get()) غير مقاس.
10. الحاجة لـ`ROUTING_BASE_URL` (OSRM مستضاف ذاتيًا أو wrapper) قبل أي تشغيل.

## 7. PRODUCTION READINESS: **NOT READY**
الأسباب: Rules غير مُثبتة بـEmulator، Functions غير مُشغَّلة، واعتماد الإنتاج على routing خارجي غير مُعَدّ. الخطوة التالية: تشغيل `cd tests && npm i && npm test` على جهاز بشبكة، ثم Functions emulator مع Firestore emulator، ثم staging.
