# MATLABK-SECURITY-TEST-RESULTS — نتائج الاختبارات الفعلية

التاريخ: 13 أكتوبر 2026. البيئة: Node v22 داخل صندوق التنفيذ، **بلا شبكة وبلا متصفح وبلا Firebase وبلا Firestore Emulator الرسمي** (Java 21 موجودة لكن لا يوجد Emulator ولا firebase-tools؛ `npm install` يتوقف). لا بيانات إنتاج.

## 0) تصنيف الأدلة
| الرمز | الفئة | نُفِّذت؟ | ما الذي يحاكيه |
|---|---|---|---|
| A | فحص ثابت على نص الكود/القواعد | نعم | لا يثبت سلوكًا |
| B | Unit منطق نقي | نعم | بلا Firebase |
| C | تشغيل **التطبيق الحقيقي** (كل `js/` + `index.html` كـ DOM) مع **Firebase مُحاكى** | نعم | نموذج Auth/Firestore كتبتُه (`tests/boot/sdk.mjs`) — ليس متصفحًا ولا Firebase |
| E* | قواعد Firestore عبر **مفسّر محلي كتبتُه** (`tests/rules-sim/`) | نعم | **ليس Emulator Google** — لا يُعتبر إثباتًا لصحة القواعد الرسمية |
| E | قواعد Firestore على **Emulator الرسمي** | **لا — NOT RUN** | لا Emulator في البيئة |
| F | متصفح حقيقي | **لا — NOT RUN** | |
| G | Firebase الفعلي / الموقع المنشور | **لا — NOT RUN** | |

## 1) الأوامر
```
cd tests
npm run all             # = unit + rules:local + rules:mutation   (290 اختبارًا)
npm run unit            # A + B + C (204)
npm run rules:local     # E*: node --import ./rules-sim/register.mjs --test firestore.rules.test.mjs firestore.rules.hardening.test.mjs rules-sim.selftest.mjs   (69)
npm run rules:mutation  # E*: node --test rules-mutation.test.mjs   (17)
node import-check.mjs && node undef-check.mjs
npm test                # Emulator الرسمي على جهاز المالك (يحتاج npm install وإنترنت) — NOT RUN هنا
```

## 2) النتائج النهائية
| الملف | الفئة | البيئة | اختبارات | نجح | فشل | تخطّي |
|---|---|---|---|---|---|---|
| `tests/account-state.test.mjs` | B | Node + محاكاة Firebase (لا Emulator) | 6 | 6 | 0 | 0 |
| `tests/auth-contract.test.mjs` | A | Node + محاكاة Firebase (لا Emulator) | 31 | 31 | 0 | 0 |
| `tests/auth-flow.test.mjs` | B | Node + محاكاة Firebase (لا Emulator) | 22 | 22 | 0 | 0 |
| `tests/role-gate.test.mjs` | C | Node + محاكاة Firebase (لا Emulator) | 34 | 34 | 0 | 0 |
| `tests/role-gate-pure.test.mjs` | B | Node + محاكاة Firebase (لا Emulator) | 5 | 5 | 0 | 0 |
| `tests/google-only.test.mjs` | B/C | Node + محاكاة Firebase (لا Emulator) | 4 | 4 | 0 | 0 |
| `tests/auth-e2e.test.mjs` | C | Node + محاكاة Firebase (لا Emulator) | 19 | 19 | 0 | 0 |
| `tests/auth-reopen.test.mjs` | C | Node + محاكاة Firebase (لا Emulator) | 4 | 4 | 0 | 0 |
| `tests/auth-races.test.mjs` | C | Node + محاكاة Firebase (لا Emulator) | 13 | 13 | 0 | 0 |
| `tests/admin-authz.test.mjs` | C | Node + محاكاة Firebase (لا Emulator) | 11 | 11 | 0 | 0 |
| `tests/admin-client-rules.test.mjs` | C + E* | Node + محاكاة Firebase (لا Emulator) | 5 | 5 | 0 | 0 |
| `tests/rules-static.test.mjs` | A | Node + محاكاة Firebase (لا Emulator) | 10 | 10 | 0 | 0 |
| `tests/handlers-wiring.test.mjs` | C | Node + محاكاة Firebase (لا Emulator) | 3 | 3 | 0 | 0 |
| `tests/schema-contract.test.mjs` | A | Node + محاكاة Firebase (لا Emulator) | 5 | 5 | 0 | 0 |
| `tests/xss-escape.test.mjs` | A | Node + محاكاة Firebase (لا Emulator) | 3 | 3 | 0 | 0 |
| `tests/normalize-pending.test.mjs` | B | Node + محاكاة Firebase (لا Emulator) | 5 | 5 | 0 | 0 |
| `tests/functions-core.test.mjs` | B | Node + محاكاة Firebase (لا Emulator) | 24 | 24 | 0 | 0 |
| `tests/firestore.rules.test.mjs` | E* | مفسّر القواعد المحلي (ليس Emulator Google) | 43 | 43 | 0 | 0 |
| `tests/firestore.rules.hardening.test.mjs` | E* | مفسّر القواعد المحلي (ليس Emulator Google) | 18 | 18 | 0 | 0 |
| `tests/rules-sim.selftest.mjs` | B | اختبار المفسّر نفسه | 8 | 8 | 0 | 0 |
| `tests/rules-mutation.test.mjs` | E* | طفرات على القواعد عبر المفسّر المحلي | 17 | 17 | 0 | 0 |
| **المجموع** | | | **290** | **290** | **0** | **0** |

- `import-check` = OK، `undef-check` = OK، `node --check` على كل `js/` و`tests/` = OK. لا اختبارات مُتخطّاة. كل ملف عُدّ مرة واحدة.
- **لا شيء من فئات E (Emulator) وF (متصفح) وG (Firebase/الإنتاج) نُفِّذ.** نجاح E* لا يعني صحة القواعد على Firestore الفعلي.

## 3) هل حُذفت اختبارات أو أُضعفت؟ (جرد دقيق: الأساس مقابل الآن)
الأساس = `MATLABK-COMPLETE-FIXED-AND-TESTED.zip` (298 اختبارًا). الآن 290. الفرق كله ناتج عن **حذف ميزة البريد/كلمة المرور بقرار صاحب المشروع**:
| ما تغيّر | التفصيل | المصير |
|---|---|---|
| `email-auth.test.mjs` (26) | E1 دخول بريد؛ E2–E4 بيانات خاطئة/مدخلات/بدون دور؛ E10–E15 إنشاء حساب بالبريد؛ E17–E19 استعادة كلمة المرور؛ E22 كلمة المرور لا تُخزَّن؛ E25 مُحققات المدخلات | **حُذفت** (الميزة نفسها محذوفة) |
| (نفس الملف) | E5 تعارض الأدوار، E6 pending/incomplete، E7 الأدمن، E8 دور مجهول، E9 فشل قراءة الملف، E16 انقطاع الاتصال، E20 الخروج، E21 دور قديم، E23 قفل مشترك، E24 رسالة تعارض Google، E26 أخطاء الإعدادات | **حُوِّلت لـ Google**: `auth-e2e` 12 13 13b 16 14 · `admin-authz` AD1 AD2 · `auth-reopen` R2 · `auth-races` R11 · `google-only` G2 G3 G4 |
| `auth-e2e` (22 → 19) | حُذفت 04 (كلمة مرور خاطئة) و06 (مدخلات/بريد مستخدم) و07 و08 (استعادة)؛ حُوِّلت 03 05 06b 09 10 10b 11 12 13 13b 14 15 16؛ أُضيفت 03 و04 الجديدتان (لا مسار بريد، واستدعاء المعالجات القديمة مباشرة غير ممكن) | |
| `auth-races` (13 → 13) | R2 R5 R5b R7 R8 R10 كانت تستخدم البريد؛ حُوِّلت إلى نوافذ Google معلّقة بنفس النية والتحقق | حُفظت كاملة |
| `admin-authz` (11 → 11) | وسيلة الدخول فقط | حُفظت كاملة |
| `auth-contract` (32 → 31) | اختباران (موفّرو الدخول + حصر استدعاءات SDK للبريد) دُمجا في اختبار واحد **أصرم**: يمنع وجود أي مسار بريد/كلمة مرور/استعادة/رابط بريد في `index.html` و`js/` و`functions/` وCSS | **أُقوّي** لا أُضعف |
| `firestore.rules.hardening` (11 → 18)، `admin-client-rules` (+5)، `rules-mutation` (11 → 17) | إضافات | جديدة |
**كل سيناريو غير مرتبط بالبريد بقي مُغطّى.** القائمة الحرفية لعناوين الاختبارات المحذوفة والمضافة لكل ملف مولَّدة آليًا ومُراجَعة (النتيجة أعلاه).

## 4) مقارنة بالأساس (هل الاختبارات الجديدة تكشف العيوب؟)
تشغيل الاختبارات الجديدة على ما قبل الإصلاح:
| الاختبار | على الأساس | بعد الإصلاح |
|---|---|---|
| `firestore.rules.hardening` | 12 نجح / **6 فشل** (H12 تحديث status مباشر، H13 دخول من incomplete/rejected، H15 تفعيل المتجر وحده، H16 رفض بلا سبب/متجر، H17 معاملات، H18 حقول إنشاء) — **على المفسّر المحلي فقط** | 18 / 0 |
| `auth-contract` (Google-only الصارم) | 3 فشل (الموفّرون، استيرادات SDK، بوابة الدور) | 31 / 0 |
| `google-only` G1 | فشل (الدوال موجودة) | نجح |
| `rules-static` S4 (بنية الاعتماد) | فشل | نجح |
| `admin-client-rules` على القواعد السابقة | 5/5 نجحت (حمولة العميل نفسها تتوافق مع القواعد القديمة والجديدة)؛ سد الثغرة تُثبته H12–H18 لا هذا الملف | 5 / 0 |
ملاحظة: ملفات `auth-e2e/auth-races/admin-authz` الجديدة **لا تُشغَّل على الأساس أصلًا** (محوّل الاختبار الحالي لا يحتوي أسماء SDK للبريد التي يستوردها الكود القديم) فلا تُحسب دليلًا قبل/بعد.
## 5) اختبار الطفرات (مفسّر محلي)
17 اختبارًا: القواعد الأصلية تنجح + 16 طفرة (حاجز واحد يُعطَّل كل مرة) **تُكتشف كلها**: تغيير الدور، تزوير approvedBy/approvedAt، اعتماد من غير pending، متجر غير متسق، أدمن موقوف، قراءة المتاجر المعلّقة، انتحال adminId، إنشاء بنقاط/بدور admin/بحقول غير معتمدة، حقول الاعتماد مع حركات التشغيل، دخول مجموعة التشغيل من pending، تحديث status بلا اعتماد، تفعيل المتجر وحده، رفض بلا سبب. طفرتان قديمتان تبيّن أنهما مكافئتان (حاجز آخر مستقل يمنعهما) فاستُبدلتا.
## 6) ما لم يُنفَّذ (بصراحة)
1. **Firebase Emulator الرسمي** — NOT RUN (لا شبكة؛ `npm install` يتوقف). قواعد Firestore الجديدة غير مُتحقَّق منها رسميًا.
2. **متصفح حقيقي** — NOT RUN (Popup Google الفعلي، RTL، الموبايل، شاشات الأدمن).
3. **الموقع المنشور** — NOT RUN (لم تُفحص ملفات JS المنشورة ولا سلوك تسجيل الدخول عليه).
4. **إعدادات Firebase Console / Google Cloud** — لا وصول (المزوّدات، النطاقات، قيود المفتاح، App Check).
5. `functions/`: لم تُثبَّت اعتمادياتها ولم تُشغَّل (سوى اختبارات منطقها النقي).
