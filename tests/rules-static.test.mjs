// node --test tests/rules-static.test.mjs
// فحوص ثابتة (static) على نص firestore.rules: تتأكد من وجود الحواجز المقصودة. **ليست تقييمًا للقواعد** ولا تثبت أنها تعمل؛
// الإثبات الفعلي يحتاج Firestore Emulator (tests/firestore.rules.test.mjs) ولم يُشغَّل في هذه البيئة.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
const block = (name) => { const i = rules.indexOf(`match /${name}`); assert.ok(i > 0, name); let d = 0, j = rules.indexOf('{', i + `match /${name}`.length); const st = j; for (; j < rules.length; j++) { if (rules[j] === '{') d++; else if (rules[j] === '}' && --d === 0) break; } return rules.slice(st, j + 1); };
test('S1. رفض افتراضي لأي مسار غير مذكور', () => { const tail = rules.slice(rules.lastIndexOf('match /{document=**}')); assert.match(tail, /allow read, write: if false;/); });
test('S2. isAdmin() يقرأ الدور من مستند users في الخادم (لا من token ولا من بيانات الطلب)', () => {
  const fn = rules.slice(rules.indexOf('function isAdmin()'), rules.indexOf('}', rules.indexOf('function isAdmin()')) + 1);
  assert.match(fn, /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.role == 'admin'/); assert.doesNotMatch(fn, /request\.resource|request\.auth\.token/);
  assert.doesNotMatch(rules, /request\.resource\.data\.role == 'admin'|request\.auth\.token\.(admin|role)/);
});
test('S3. إنشاء users: أدوار customer/merchant/driver فقط، حالة ابتدائية مقيّدة، وحقول الاعتماد ممنوعة', () => {
  const u = block('users/{userId}'); const c = u.slice(u.indexOf('allow create'), u.indexOf('allow update'));
  assert.match(c, /request\.auth\.uid == userId/); assert.match(c, /role in \['customer', 'merchant', 'driver'\]/); assert.doesNotMatch(c, /'admin'/);
  assert.match(c, /role == 'customer' && request\.resource\.data\.status == 'active'/); assert.match(c, /role != 'customer' && request\.resource\.data\.status == 'incomplete'/); assert.match(c, /approvalFieldsAbsent\(request\.resource\.data\)/);
  assert.match(rules, /function approvalFieldsAbsent[\s\S]*?approvalStatus[\s\S]*?approvedAt[\s\S]*?approvedBy[\s\S]*?rejectedAt[\s\S]*?rejectedBy[\s\S]*?rejectReason[\s\S]*?rejectionReason/);
});
test('S4. تحديث users لغير الأدمن: الدور ثابت وليس admin، وانتقال الحالة محكوم (incomplete/rejected -> pending فقط)', () => {
  const u = block('users/{userId}'); const up = u.slice(u.indexOf('allow update'), u.indexOf('allow delete'));
  assert.match(up, /allow update: if adminUserUpdateOk\(userId\) \|\| \(/); assert.match(rules, /function adminUserUpdateOk\(userId\)[\s\S]*?request\.resource\.data\.role == resource\.data\.role[\s\S]*?adminApprovalOk\(userId\)[\s\S]*?adminRejectionOk\(userId\)[\s\S]*?opsStatus[\s\S]*?approvalTouched\(\)/);
  assert.match(rules, /function adminApprovalOk\(userId\)[\s\S]*?== 'pending'[\s\S]*?== 'active'[\s\S]*?approvedBy[\s\S]*?request\.auth\.uid[\s\S]*?approvedAt[\s\S]*?request\.time[\s\S]*?getAfter\(\/databases\/\$\(database\)\/documents\/stores/);
  assert.match(rules, /function adminRejectionOk\(userId\)[\s\S]*?== 'pending'[\s\S]*?== 'rejected'[\s\S]*?rejectedBy[\s\S]*?rejectedAt[\s\S]*?request\.time[\s\S]*?rejectReason[\s\S]*?getAfter\(/);
  assert.match(rules, /function adminStoreUpdateOk\(storeId\)[\s\S]*?getAfter\(\/databases\/\$\(database\)\/documents\/users\/\$\(storeId\)\)/);
  assert.match(up, /request\.resource\.data\.status == 'pending' && resource\.data\.status in \['incomplete', 'rejected'\]/); assert.match(up, /driverSubmitComplete\(request\.resource\.data\)/); assert.match(up, /merchantSubmitComplete\(request\.auth\.uid\)/);
  assert.match(u, /allow delete: if isAdmin\(\);/);
});
test('S5. لا يوجد حقل اعتماد/حالة قابل للكتابة من فروع التحديث الذاتي (قوائم hasOnly)', () => {
  const u = block('users/{userId}'); const up = u.slice(u.indexOf('allow update'), u.indexOf('allow delete')); const lists = [...up.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map((m) => m[1]);
  assert.ok(lists.length >= 6); for (const l of lists) for (const f of ['role', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt', 'rejectReason', 'rejectionReason', 'approvalStatus', 'points']) assert.equal(l.includes(`'${f}'`), false, f + ' in ' + l);
});
test('S6. المتجر: إنشاء pending فقط لتاجر، وتغيير حالته ذاتيًا rejected->pending فقط', () => {
  const st = block('stores/{storeId}'); assert.match(st, /allow create:[\s\S]*?status == 'pending'[\s\S]*?role', ''\) == 'merchant'/); assert.match(st, /resource\.data\.status == 'rejected' && request\.resource\.data\.status == 'pending'/); assert.match(st, /allow delete: if isAdmin\(\);/);
});
test('S7. سجل التدقيق: قراءة/إنشاء للأدمن فقط ولا تعديل ولا حذف لأحد', () => { const a = block('auditLog/{id}'); assert.match(a, /allow read: if isAdmin\(\);/); assert.match(a, /allow create: if isAdmin\(\) &&[\s\S]*?adminId == request\.auth\.uid[\s\S]*?createdAt == request\.time/); assert.match(a, /allow update, delete: if false;/); });
test('S8. مجموعات المحتوى الإداري (settings/categories/banners/coupons) كتابتها للأدمن فقط', () => { for (const c of ['settings/{id}', 'categories/{id}', 'banners/{id}', 'coupons/{id}']) assert.match(block(c), /allow write: if isAdmin\(\);/, c); });
test('S9. لا قاعدة مفتوحة: لا "if true"، ولا allow write لأي مسجّل دخول بلا شروط على المجموعات الحساسة', () => {
  assert.doesNotMatch(rules, /allow [a-z, ]+: if true/);
  for (const c of ['users/{userId}', 'stores/{storeId}', 'auditLog/{id}']) assert.doesNotMatch(block(c), /allow (write|create|update|delete): if isSignedIn\(\);/, c);
});
test('S10. بوابات التشغيل: isActiveDriver/isApprovedMerchant تشترط status=active من مستند users', () => {
  assert.match(rules, /function isApprovedMerchant\(\)[\s\S]*?role', ''\) == 'merchant' && u\.get\('status', ''\) == 'active'/); assert.match(rules, /function isActiveDriver\(\)[\s\S]*?'active'/);
});
