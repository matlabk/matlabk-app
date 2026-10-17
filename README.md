# MATLABK — الحزمة النهائية (مُصلَحة ومُختبَرة)

تطبيق ويب لخدمة التوصيل والمشاوير في المنايف (Firebase Auth + Firestore). هذه الحزمة **كاملة**: التطبيق، القواعد والإعدادات المحلية، Cloud Functions، كل الاختبارات والتقارير.

> **لم يُنشر شيء ولم يُغيَّر أي مورد إنتاجي.** تعديلات القواعد محلية فقط ولم تُشغَّل على Firestore Emulator الرسمي — راجع `MATLABK-FIREBASE-OWNER-CHECKLIST.md` قبل أي نشر.

## المحتويات
| المسار | الوصف |
|---|---|
| `index.html`, `css/`, `js/` | التطبيق (وحدات ES بلا bundler؛ نقطة الدخول `index.html` ← `js/main.js`). **الدخول Google فقط** |
| `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc` | إعدادات Firebase المحلية (القواعد معدّلة وغير منشورة؛ الباقي كما هو) |
| `functions/`, `workers/`, `scripts/` | Cloud Functions وWorker Cloudinary وسكربت ترحيل (لم تُعدَّل) |
| `tests/` | كل الاختبارات + `tests/boot` (Firebase مُحاكى) + `tests/rules-sim` (مفسّر قواعد محلي، ليس Emulator Google) |
| `MATLABK-SECURITY-FIX-REPORT.md` | الثغرات المؤكَّدة والإصلاحات ودخول Google فقط والمخاطر المتبقية وما لم يُختبر |
| `MATLABK-SECURITY-TEST-RESULTS.md` | الاختبارات المنفذة والنتائج والبيئة وتصنيف الأدلة وجرد الاختبارات المحذوفة/المضافة |
| `MATLABK-FIREBASE-OWNER-CHECKLIST.md` | ما يلزم المالك (Emulator، Console، حسابات البريد القديمة، الأدمن، اختبار الموقع) |
| `MATLABK-CHANGELOG.md` | الملفات المعدَّلة وسببها (تراكمي) |
| `MATLABK-FILE-HASH-REPORT.md` | بصمات SHA-256 مقابل الأساس |
| `MATLABK-SECURITY-FIX.patch` | الفرق (كود + اختبارات) مقابل `MATLABK-COMPLETE-FIXED-AND-TESTED.zip`؛ `patch -p1` (لا يشمل ملفات الوثائق) |
| `docs/history/` | تقارير وباتشات الجولات السابقة (بما فيها وثائق الجولة السابقة التي حلّ محلها هذا التقرير) |

## تشغيل الاختبارات (Node 20+، بدون شبكة)
```
cd tests
npm run all            # 290 اختبارًا = unit (204) + rules:local (69) + rules:mutation (17)
npm run unit           # التطبيق الحقيقي مع Firebase مُحاكى + فحوص ثابتة
npm run rules:local    # قواعد Firestore عبر المفسّر المحلي (ليس Emulator Google)
npm run rules:mutation # طفرات القواعد
node import-check.mjs && node undef-check.mjs
npm test               # Emulator الرسمي — يلزم npm install وإنترنت وجهاز المالك (لم يُشغَّل هنا)
```
## تنبيهات صريحة
- كل اختبارات Firebase هنا **محاكاة**؛ لا متصفح حقيقي ولا Firebase حقيقي ولا Emulator رسمي. سبب فشل الدخول على الموقع المنشور **غير مُثبَت** (يلزم فحص Console).
- لا يوجد أدمن افتراضي ولا بيانات اعتماد داخل الملفات (مفتاح الويب العام في `js/firebase.js` طبيعي).
