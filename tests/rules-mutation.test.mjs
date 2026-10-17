// node --test rules-mutation.test.mjs — اختبار طفرات: نُفسد firestore.rules عمدًا (إزالة حاجز واحد) ونتأكد أن اختبارات القواعد **تفشل**.
// الهدف إثبات أن الاختبارات (والمفسّر المحلي) حسّاسة فعلًا ولا تنجح دائمًا. يعمل على المفسّر المحلي فقط (ليس Emulator Google).
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const H = 'firestore.rules.hardening.test.mjs';
const MUT = [
  ['M1 الأدمن يغيّر role', "isAdmin() &&\n        request.resource.data.role == resource.data.role &&", 'isAdmin() &&', H],
  ['M2 تزوير approvedBy', "        request.resource.data.get('approvedBy', '') == request.auth.uid &&\n", "", H],
  ['M3 approvedAt من العميل', "        request.resource.data.get('approvedAt', null) == request.time &&\n        (resource.data.role != 'merchant' ||\n          getAfter(/databases/$(database)/documents/stores/$(userId)).data.get('status', '') == 'active');", "        (resource.data.role != 'merchant' ||\n          getAfter(/databases/$(database)/documents/stores/$(userId)).data.get('status', '') == 'active');", H],
  ['M4 اعتماد من غير pending', "      return resource.data.get('status', '') == 'pending' && request.resource.data.get('status', '') == 'active' &&\n        request.resource.data.get('approvedBy'", "      return request.resource.data.get('status', '') == 'active' &&\n        request.resource.data.get('approvedBy'", H],
  ['M5 تاجر معتمد بمتجر غير متسق', "getAfter(/databases/$(database)/documents/stores/$(userId)).data.get('status', '') == 'active');\n    }\n    function adminRejectionOk", "true);\n    }\n    function adminRejectionOk", H],
  ['M6 أدمن موقوف يبقى أدمن', "        !(get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('status', '') in ['blocked', 'deleted']);", "        true;", H],
  ['M7 قراءة المتاجر المعلّقة', "!(resource.data.get('status', '') in ['pending', 'rejected', 'incomplete']) || request.auth.uid == storeId || isAdmin());", "true);", H],
  ['M8 تزوير adminId في التدقيق', "        request.resource.data.adminId == request.auth.uid &&\n", "", H],
  ['M9 إنشاء حساب بنقاط/حالة تشغيل مسبقة', "        request.resource.data.get('points', 0) == 0 &&\n        request.resource.data.get('isOnline', false) == false &&", "        request.resource.data.get('isOnline', false) == false &&", H],
  ['M10 إنشاء مستخدم بدور admin', "request.resource.data.role in ['customer', 'merchant', 'driver'] &&\n        (", "request.resource.data.role in ['customer', 'merchant', 'driver', 'admin'] &&\n        (", H],
  ['M11 حقول الاعتماد تُلمس مع حركات التشغيل', "(opsStatus(resource.data.get('status', '')) && opsStatus(request.resource.data.get('status', '')) && !approvalTouched())", "(opsStatus(resource.data.get('status', '')) && opsStatus(request.resource.data.get('status', '')))", H],
  ['M12 pending يدخل مجموعة التشغيل (التفاف blocked->active)', "(opsStatus(resource.data.get('status', '')) && opsStatus(request.resource.data.get('status', '')) && !approvalTouched())", "(opsStatus(request.resource.data.get('status', '')) && !approvalTouched())", H],
  ['M13 تحديث status مباشر بلا اعتماد', "((request.resource.data.get('status', '') == resource.data.get('status', '') && !approvalTouched()) ||", "((true) ||", H],
  ['M14 تفعيل المتجر وحده', "getAfter(/databases/$(database)/documents/users/$(storeId)).data.get('status', '') == 'active') ||", "true) ||", H],
  ['M15 رفض بلا سبب', "        request.resource.data.get('rejectReason', '').size() > 0 && request.resource.data.get('rejectReason', '').size() <= 500 &&", "        request.resource.data.get('rejectReason', '').size() <= 500 &&", H],
  ['M16 إنشاء مستخدم بحقول غير معتمدة', "        request.resource.data.keys().hasOnly(['name', 'email', 'phone', 'role', 'points', 'photoURL', 'status', 'createdAt', 'updatedAt']) &&\n", "", H],
];
const run = (file, text) => { const p = path.join(os.tmpdir(), 'mut-' + Math.random().toString(36).slice(2) + '.rules'); fs.writeFileSync(p, text); const r = spawnSync(process.execPath, ['--import', './rules-sim/register.mjs', '--test', file], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), RULES_PATH: p }, encoding: 'utf8' }); fs.unlinkSync(p); const m = /# fail (\d+)/.exec(r.stdout); return m ? Number(m[1]) : -1; };
test('MUT0. القواعد الأصلية (بدون طفرة) تنجح في الملفين', () => { for (const f of ['firestore.rules.test.mjs', 'firestore.rules.hardening.test.mjs']) assert.equal(run(f, rules), 0, f); });
for (const [name, from, to, file] of MUT) test(`MUT ${name}: الطفرة تُكتشف (اختبار واحد على الأقل يفشل)`, () => { const n = rules.split(from).length - 1; assert.ok(n >= 1, 'نص الطفرة غير موجود في القواعد: ' + name); const mutated = rules.replace(from, to); assert.notEqual(mutated, rules); assert.ok(run(file, mutated) > 0, 'الطفرة لم تُكتشف: ' + name); });

// ملاحظة (دفاع متعدد الطبقات): طفرتان جُرّبتا وتبيّن أنهما **مكافئتان** لأن حاجزًا آخر مستقلًّا يمنع نفس السلوك، فلا تُدرجان: (أ) حذف `request.resource.data.role == resource.data.role` من فرع التحديث الذاتي (قوائم hasOnly لا تضم role)، (ب) استبدال شرط تساوي status في الانتقال بـ true (قوائم الحقول المسموحة والفروع تمنع تغيير status ذاتيًا).
