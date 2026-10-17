# MATLABK-CHANGELOG (تراكمي — الأحدث أولًا)

## الجولة الحالية — MATLABK-SECURITY-GOOGLE-ONLY-FIXED (الأساس: MATLABK-COMPLETE-FIXED-AND-TESTED.zip)
| الملف | التغيير والسبب |
|---|---|
| `firestore.rules` | (محلي، غير منشور) سدّ التفاف الاعتماد: `adminUserUpdateOk` صارت تعتمد `adminApprovalOk/adminRejectionOk/opsStatus/approvalTouched`؛ `adminStoreUpdateOk` لحالة المتجر؛ قائمة حقول لإنشاء `users`. باقي القواعد والفهارس بلا تغيير |
| `index.html`, `css/styles.css` | حذف نموذج البريد وروابط التسجيل/الاستعادة وشاشتَي `screen-signup`/`screen-forgot` وحارس النماذج وCSS البريد؛ بقي زر Google وبقية التصميم |
| `js/auth.js`, `js/auth-flow.js`, `js/firebase.js`, `js/main.js` | حذف `emailLogin/emailSignup/emailReset/openSignup/openForgot` والمُحققات وأخطاء البريد واستيراد/تصدير دوال البريد في SDK |
**الاختبارات:** حُذف `email-auth.test.mjs` (الميزة محذوفة) وحُوِّلت اختبارات الدخول/السباقات/الإدارة إلى Google، وأُضيف `google-only.test.mjs` و`admin-client-rules.test.mjs`، وتوسّع `firestore.rules.hardening` (18) و`rules-mutation` (17)، وأُصرِم `auth-contract`. الجرد الكامل في `MATLABK-SECURITY-TEST-RESULTS.md`.
**المخطط/البيانات:** لا تغيير ولا ترحيل ولا حذف مستخدمين. **تأكيد:** لا نشر ولا تغيير إنتاج.

## الجولة الحالية — MATLABK-COMPLETE-FIXED-AND-TESTED (الأساس: MATLABK-AUTH-ADMIN-REPAIRED.zip)
**ملفات الإنتاج المعدَّلة (6):**
| الملف | التغيير والسبب |
|---|---|
| `firestore.rules` | (محلي، غير منشور) `isAdmin()` تستبعد `blocked/deleted`؛ دالة `adminUserUpdateOk`: الدور ثابت للأدمن، وحقول الاعتماد/الرفض فقط في `pending→active/rejected` بهوية الأدمن ووقت الخادم ومتجر متسق للتاجر؛ `stores` لا تُقرأ معلّقة/مرفوضة إلا للمالك/الأدمن؛ `auditLog` بحقول وفاعل ووقت مفروضة. الفهارس وباقي القواعد بلا تغيير |
| `js/account-state.js` | `isAdminProfile` و`resolveRoute`: أدمن موقوف/محذوف ⇒ `blocked` (يطابق القواعد) |
| `js/admin.js` | `adminDecision` بـ`runTransaction` وتحقق الهدف والحارس؛ رسائل واضحة؛ تفاصيل التدقيق = معرّف الهدف؛ تسجيل أخطاء بدل `catch` فارغ |
| `js/customer.js`, `js/main.js` | تعريف `openStore` (بانر المتجر كان يستدعي دالة غير موجودة) وتصديرها |
| `js/external.js` | تسجيل خطأ رفض العرض بدل `catch` فارغ |
**الاختبارات:** `firestore.rules.hardening.test.mjs` (11)، `rules-mutation.test.mjs` (11)، `rules-sim.selftest.mjs` (8) ومفسّر القواعد المحلي `tests/rules-sim/` (ليس Emulator Google)، `handlers-wiring.test.mjs` (3)، AD11، وتصحيح توقعَين خاطئَين في `firestore.rules.test.mjs`، وتحديث 3 اختبارات هيكلية. المجموع 298، كلها ناجحة. `npm run all`.
**الوثائق:** README، `MATLABK-AUTH-ADMIN-SECURITY-AUDIT.md`، `...-SECURITY-TESTS.md`، `MATLABK-SECURITY-REGRESSION-MATRIX.md`، `MATLABK-FILE-HASH-REPORT.md`، `MATLABK-FIREBASE-OWNER-CHECKLIST.md`؛ ونُقلت تقارير الجولات السابقة إلى `docs/history/`.
**افتراضات المخطط:** لم يتغير أي حقل أو مجموعة. لا ترحيل بيانات.
**التوافق:** القواعد الجديدة أشد؛ التفاصيل والمحاذير في القسم 7 من تقرير التدقيق. الواجهة (`index.html`/CSS) لم تتغير.
**تأكيد:** **لم يُنشر شيء ولم تُغيَّر أي موارد إنتاج** (GitHub Pages، Firebase Hosting، القواعد، الفهارس، Functions، Console)، ولم تُنشأ/تُعدَّل حسابات أو بيانات حقيقية.

## الجولة السابقة — MATLABK-AUTH-ADMIN-REPAIRED
دورة حياة محاولات المصادقة (`processAuthUser`، سياسة الجلسات القديمة، حجز الأحداث، مهلة)، قرار الإدارة بتحقق الهدف (نسخة أولى)، اختبارات `auth-races` و`admin-authz` و`rules-static`.
## جولات أقدم
بوابة الدور، الدخول بالبريد، التدقيق والإصلاح الأول، إلخ — انظر `docs/history/`.
