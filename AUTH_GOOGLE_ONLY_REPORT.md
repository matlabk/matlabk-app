# MATLABK — Google-only Authentication Cleanup (محلي فقط، لا نشر)

لم يُنشر أي شيء (لا Firebase ولا GitHub)، ولم تُغيَّر أي إعدادات في Firebase Console.

## 1. الملفات المعدّلة (5 فقط — ثبت بـ `diff -rq` مقابل النسخة السابقة)
| الملف | السبب |
|---|---|
| `index.html` | شاشة الدخول صارت: MATLABK + الوصف + `Continue with Google` + جملة التوجيه. حُذفت حقول البريد/كلمة المرور، "دخول الحسابات القديمة"، نسيت كلمة المرور، دخول بالرابط، `auth-register`، **وشاشة `screen-otp` بالكامل** |
| `js/auth.js` | حذف الدخول القديم والربط، وتقليص imports، وتقليص `firebaseAuthErrorMessage` لرسائل Google |
| `js/firebase.js` | استيراد/تصدير Auth أصبح 6 واجهات فقط |
| `js/main.js` | حذف مسار رابط البريد، وimports/exports/`Object.assign(window…)` القديمة، ومعالج تعارض الحسابات |
| `tests/auth-contract.test.mjs` | تحديث الاختبارات لتعكس Google-only (انظر 5) |

## 2. ما تم حذفه
- **Email/Password:** `doLogin`، `signInWithEmailAndPassword`، `createUserWithEmailAndPassword`، حقول `lmail/lpass`، زر الدخول.
- **Password Reset:** `showForgot`، `sendPasswordResetEmail`.
- **Email Link / OTP:** `showEmailOTP`، `sendSignInLinkToEmail`، `isSignInWithEmailLink`/`signInWithEmailLink` وكتلتها في `main.js`، مفتاح `localStorage` الخاص بـ`emailForSignIn`، وشاشة `screen-otp`.
- **Account Linking:** `handleEmailAlreadyInUse`، `handleGoogleAccountConflict`، `maybeOfferPendingLink` واستدعاؤه من `routeUser`، ومنطق `add-password`/`add-google`، `LINK_INTENT_KEY` (`mova_link_intent`) ودوال `stash/read/clearLinkIntent` (واستدعاء المسح في `doLogout`)، و`EmailAuthProvider`، `linkWithCredential`، `linkWithRedirect`، `fetchSignInMethodsForEmail`.
- **`doRegister`:** فحصت المراجع قبل الحذف: لا استخدام في أي HTML ولا ملف آخر، فقط تصديرها في `main.js` واختبار قديم يتحقق من وجودها ⇒ حُذفت، وعُدِّل الاختبار.
- **`switchTab`:** صارت بلا معنى بعد حذف التبويبات؛ حُذفت. `pickEntryType` تستدعي الآن `updateEntryLabel()` مباشرة.

## 3. ما تم الإبقاء عليه
`loginGoogle` (يستخدم `signInWithRedirect`)، `getRedirectResult(auth)`، `onAuthStateChanged`، `GoogleAuthProvider`، `signOut`/`doLogout`، قفل العملية `authLock*` ضد الضغط المزدوج، تلميح نوع الحساب `matlabk_entry_type` في `sessionStorage` (لمستخدم Google الجديد فقط، وليس مصدر صلاحيات)، `firebaseAuthErrorMessage` بعد تقليصه، تخزين البريد في مستند المستخدم (`email: user.email`) و`syncToHubSpot` (بيانات وليست Provider). لم أمس حقول البريد في الملفات الشخصية.
- **تغيير سلوك واحد مقصود:** خطأ `auth/account-exists-with-different-credential` لم يعد يعرض "سجّل بكلمة المرور أولًا" (مسار مستحيل الآن)، بل رسالة: "هذا البريد مرتبط بطريقة دخول قديمة غير مدعومة. تواصل مع الإدارة".

## 4. Authentication Flow النهائي
1. المستخدم يفتح MATLABK ويختار نوع الحساب (عميل/كابتن/تاجر) ← `pickEntryType` تحفظ النوع كتلميح وتعرض شاشة الدخول.
2. `Continue with Google` ← `loginGoogle` ← `signInWithRedirect`.
3. Google ثم العودة للتطبيق ← `getRedirectResult` (يعرض خطأ إن وُجد) و`onAuthStateChanged`.
4. يقرأ التطبيق `users/{uid}`: **موجود** ← `routeUser()` ← الشاشة حسب الدور/الحالة (`resolveRoute`). **جديد** ← `completeRegistration(النوع)` (أو شاشة اختيار الدور لو لا يوجد تلميح) ← إنشاء المستند بحالة `incomplete`/`active` (عميل) ← استكمال البيانات/الاعتماد كما هو.
- لم يتغير: اكتمال ملف العميل، اعتماد الكابتن والتاجر، الأدوار/الحالات، قواعد Firestore.

## 5. الاختبارات (نُفِّذت فعليًا)
| الأمر | النتيجة |
|---|---|
| `node --check` على `js/*.js` و`functions/**` و`scripts/*.mjs` و`tests/*.mjs` | PASS (لا أخطاء) |
| `node tests/import-check.mjs` | PASS |
| `node tests/undef-check.mjs` | PASS |
| `node --test` للملفات الستة | **65/65 PASS، 0 FAIL** |

تفصيل:

| الملف | النتيجة |
|---|---|
| `tests/account-state.test.mjs` | 6 اختبارًا — pass 6 / fail 0 |
| `tests/auth-contract.test.mjs` | 23 اختبارًا — pass 23 / fail 0 |
| `tests/schema-contract.test.mjs` | 5 اختبارًا — pass 5 / fail 0 |
| `tests/xss-escape.test.mjs` | 3 اختبارًا — pass 3 / fail 0 |
| `tests/normalize-pending.test.mjs` | 4 اختبارًا — pass 4 / fail 0 |
| `tests/functions-core.test.mjs` | 24 اختبارًا — pass 24 / fail 0 |


اختبارات Google-only الجديدة (في `auth-contract.test.mjs`): (أ) لا وجود لأي من 25 اسمًا قديمًا في `index.html` و`js/*` و`functions` بعد إزالة التعليقات؛ (ب) واجهات Auth المستوردة في `firebase.js` = بالضبط `getAuth, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithRedirect, getRedirectResult`؛ (ج) بقاء `loginGoogle` و`getRedirectResult(auth)` و`onAuthStateChanged` وزر Google؛ (د) شاشة الدخول بلا `type=email/password` ولا OTP ولا تبويبات، وبها الوصف والجملة المطلوبة، وكل الدوال المستدعاة من أزرارها معروضة على `window`؛ (هـ) لا مفاتيح تخزين قديمة؛ (و) البريد باقٍ كبيان ملف شخصي. والاختبار القديم الذي كان يشترط وجود `doRegister` حُذف ولم يُبقَ الكود لإرضائه.

**الفحص النهائي بالبحث:** كل الأسماء الـ19 المطلوبة (+مرادفاتها) غير موجودة في أي كود (`index.html`، `js/`، `functions/`، `firestore.rules`، `firebase.json`، `scripts/`). تظهر فقط داخل `tests/auth-contract.test.mjs` كقائمة "ممنوعات" يتحقق منها الاختبار، وهذا وجود نصي وليس وظيفة.

## 6. لم يمكن تشغيله (لا يُعدّ PASS)
- **اختبار Google الفعلي في متصفح** (الدخول، العودة من الـredirect، تبديل الحسابات): NOT VERIFIED — لا متصفح ولا شبكة.
- **40 اختبار Rules على Emulator:** BLOCKED — `firebase-tools` غير قابل للتثبيت (E403). لم أغيّر الـRules أصلًا، لكنها تبقى غير مُثبتة وقت التشغيل.
- **أي رؤية بصرية لشاشة الدخول:** لم تُفتح في متصفح.

## 7. ما تفعله يدويًا في Firebase Console (بعد مراجعة النسخة، وبعد نشر هذه النسخة من الواجهة)
1. **Authentication ← Sign-in method:** افتح مزوّد **Email/Password** وعطّله. خيار **Email link (passwordless sign-in)** هو جزء من نفس المزوّد؛ تعطيل المزوّد يوقف الاثنين.
2. أبقِ **Google** مفعّلًا، وتأكد أن الدومين الذي تُنشر عليه الواجهة ضمن **Authorized domains** (مطلوب لـ`signInWithRedirect`).
3. لا تعطّل المزوّد قبل نشر النسخة الجديدة؛ وإلا تتعطل الواجهة القديمة المنشورة التي ما زالت تعرض الدخول بالبريد.
4. اختياري: **Authentication ← Users**: حذف حسابات الاختبار القديمة يدويًا بعد التأكد (لن أمسّ أي مستخدم).
5. ملاحظة: إعداد "ربط الحسابات بنفس البريد" في Settings لم يعد مهمًا مع Google فقط.
6. قوالب البريد (Templates) لم تعد مستخدمة.

## 8. أثر التعديل على Production
مقارنة `diff -rq` تثبت أن **5 ملفات فقط** تغيّرت. هذه الملفات **بايت-بايت كما كانت**: `firestore.rules`، `firestore.indexes.json`، `firebase.json`، `.firebaserc`، `functions/**`، `js/orders.js`، `js/rides.js`، `js/external.js`، `js/driver.js`، `js/merchant.js`، `js/customer.js`، `js/admin*.js`، `js/notifications.js`، `js/pricing.js`، `js/routing.js`. أي أن الطلبات والمشاوير والـDispatch والأسعار والإشعارات والـFunctions لم تتأثر. التأثير الوحيد المقصود: لا دخول إلا بـ Google.

## 9. ملاحظات متبقية
- حسابات Email/Password القديمة (إن وُجدت) لن تستطيع الدخول، ومستند `users` الخاص بها يبقى في Firestore. إن سجّل صاحبها بـ Google قد يُنشأ UID جديد (أو يُربط تلقائيًا حسب إعداد Firebase للبريد نفسه)، فيُعامل كمستخدم جديد.
- بقيت أصناف CSS غير مستخدمة (`.otp-*`، `.auth-tab`) عمدًا لتجنّب لمس ملف الأنماط؛ آمنة وقابلة للحذف لاحقًا.
- حالة الإنتاج العامة لم تتغير: **NOT READY** (Rules/Functions بلا Runtime evidence).
