// node --test rules-sim.selftest.mjs — يتحقق من المفسّر المحلي نفسه على قواعد صغيرة مكتوبة هنا (دلالات Firestore Rules المعروفة)،
// حتى لا تُبنى ثقة على مفسّر لم يُختبر. ليس بديلًا عن Emulator Google.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { Engine } from './rules-sim/engine.mjs';
import { initializeTestEnvironment, assertFails, assertSucceeds, doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, writeBatch, serverTimestamp } from './rules-sim/shim.mjs';
const R = (body) => `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { ${body} } }`;
const mk = async (rules) => { const env = await initializeTestEnvironment({ firestore: { rules } }); return { env, as: (u) => env.authenticatedContext(u).firestore(), anon: () => env.unauthenticatedContext().firestore(), seed: (f) => env.withSecurityRulesDisabled((c) => f(c.firestore())) }; };
test('SELF1. رفض افتراضي، وallow ... if true، وغياب if = مسموح', async () => {
  const t = await mk(R("match /open/{id} { allow read; } match /t/{id} { allow read: if true; }")); await t.seed((d) => setDoc(doc(d, 'x', '1'), { a: 1 }));
  await assertFails(getDoc(doc(t.as('u'), 'x', '1'))); await assertSucceeds(getDoc(doc(t.anon(), 't', '1'))); await assertSucceeds(getDoc(doc(t.anon(), 'open', '1')));
});
test('SELF2. دلالات الأخطاء: خطأ || true = true، وخطأ && false = false، وخطأ وحده = رفض، وحقل مفقود = خطأ، وget(حقل، افتراضي) آمن', async () => {
  const t = await mk(R("match /a/{id} { allow read: if resource.data.missing == 1 || true; } match /b/{id} { allow read: if resource.data.missing == 1; } match /c/{id} { allow read: if resource.data.get('missing', 5) == 5; } match /d/{id} { allow read: if resource.data.missing == 1 && false; } match /e/{id} { allow read: if !(resource.data.missing == 1 && false); }"));
  await t.seed(async (d) => { for (const c of 'abcde') await setDoc(doc(d, c, '1'), { x: 1 }); });
  await assertSucceeds(getDoc(doc(t.as('u'), 'a', '1'))); await assertFails(getDoc(doc(t.as('u'), 'b', '1'))); await assertSucceeds(getDoc(doc(t.as('u'), 'c', '1'))); await assertFails(getDoc(doc(t.as('u'), 'd', '1'))); await assertSucceeds(getDoc(doc(t.as('u'), 'e', '1')));
});
test('SELF3. hasOnly/hasAll/hasAny وdiff().affectedKeys() وin وis وsize وmatches', async () => {
  const t = await mk(R(`match /m/{id} { allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['a','b']) && request.resource.data.a is int && request.resource.data.b.size() <= 3 && 'x' in ['x','y'] && request.resource.data.b.matches('[a-z]+'); allow create: if request.resource.data.keys().hasAll(['a']) && !request.resource.data.keys().hasAny(['bad']); }`));
  await t.seed((d) => setDoc(doc(d, 'm', '1'), { a: 1, b: 'ab', c: 9 }));
  await assertSucceeds(updateDoc(doc(t.as('u'), 'm', '1'), { a: 2, b: 'abc' })); await assertFails(updateDoc(doc(t.as('u'), 'm', '1'), { c: 10 })); await assertFails(updateDoc(doc(t.as('u'), 'm', '1'), { a: 'str' })); await assertFails(updateDoc(doc(t.as('u'), 'm', '1'), { b: 'abcd' })); await assertFails(updateDoc(doc(t.as('u'), 'm', '1'), { b: 'AB' }));
  await assertSucceeds(setDoc(doc(t.as('u'), 'm', '2'), { a: 1 })); await assertFails(setDoc(doc(t.as('u'), 'm', '3'), { b: 1 })); await assertFails(setDoc(doc(t.as('u'), 'm', '4'), { a: 1, bad: 1 }));
});
test('SELF4. get() على مستند آخر، وسقف 10 مستندات فريدة (تكرار نفس المستند يُحسب مرة)', async () => {
  const body = (n) => `match /g/{id} { allow read: if ${Array.from({ length: n }, (_, i) => `get(/databases/$(database)/documents/d/d${i}).data.v == 1`).join(' && ')}; } match /r/{id} { allow read: if get(/databases/$(database)/documents/d/d0).data.v == 1 && get(/databases/$(database)/documents/d/d0).data.v == 1 && exists(/databases/$(database)/documents/d/d0); }`;
  const t = await mk(R(body(11))); await t.seed(async (d) => { for (let i = 0; i < 11; i++) await setDoc(doc(d, 'd', 'd' + i), { v: 1 }); await setDoc(doc(d, 'g', '1'), {}); await setDoc(doc(d, 'r', '1'), {}); });
  await assertFails(getDoc(doc(t.as('u'), 'g', '1'))); await assertSucceeds(getDoc(doc(t.as('u'), 'r', '1')));
  const t2 = await mk(R(body(10))); await t2.seed(async (d) => { for (let i = 0; i < 10; i++) await setDoc(doc(d, 'd', 'd' + i), { v: 1 }); await setDoc(doc(d, 'g', '1'), {}); }); await assertSucceeds(getDoc(doc(t2.as('u'), 'g', '1')));
});
test('SELF5. دفعات: get() ترى ما قبل الدفعة وgetAfter() ما بعدها، والدفعة ذرّية، وupdate لمستند غير موجود = not-found بعد القواعد', async () => {
  const t = await mk(R("match /a/{id} { allow write: if getAfter(/databases/$(database)/documents/b/$(id)).data.v == 2; } match /b/{id} { allow write: if true; } match /c/{id} { allow write: if get(/databases/$(database)/documents/b/$(id)).data.v == 3; }"));
  await t.seed(async (d) => { await setDoc(doc(d, 'a', '1'), { v: 0 }); await setDoc(doc(d, 'b', '1'), { v: 1 }); await setDoc(doc(d, 'c', '1'), { v: 0 }); });
  const solo = t.as('u'); await assertFails(updateDoc(doc(solo, 'a', '1'), { v: 1 }));
  const b = writeBatch(solo); b.update(doc(solo, 'a', '1'), { v: 1 }); b.update(doc(solo, 'b', '1'), { v: 2 }); await assertSucceeds(b.commit());
  const b2 = writeBatch(solo); b2.update(doc(solo, 'c', '1'), { v: 1 }); b2.update(doc(solo, 'b', '1'), { v: 3 }); await assertFails(b2.commit()); // get() ترى ما قبل الدفعة (v==2) لا ما بعدها (3) => c مرفوض؛ ولو رأت ما بعد الدفعة لنجحت
});
test('SELF6. request.time == serverTimestamp()، والقيم الثابتة من العميل تُرفض', async () => {
  const t = await mk(R("match /t/{id} { allow create: if request.resource.data.at == request.time; }"));
  await assertSucceeds(setDoc(doc(t.as('u'), 't', '1'), { at: serverTimestamp() })); await assertFails(setDoc(doc(t.as('u'), 't', '2'), { at: 5 }));
});
test('SELF7. استعلام list: الحقل غير المقيَّد في where يُعتبر مجهولًا (لا يُثبت القاعدة)، والمقيَّد يُثبتها', async () => {
  const t = await mk(R("match /s/{id} { allow read: if resource.data.get('status', '') == 'active'; } match /u/{id} { allow read: if request.auth.uid == id; }"));
  await t.seed(async (d) => { await setDoc(doc(d, 's', '1'), { status: 'active' }); });
  await assertSucceeds(getDocs(query(collection(t.as('u'), 's'), where('status', '==', 'active')))); await assertFails(getDocs(collection(t.as('u'), 's'))); await assertFails(getDocs(collection(t.as('u'), 'u'))); await assertSucceeds(getDoc(doc(t.as('1'), 'u', '1')));
});
test('SELF8. نطاق الدوال لغوي: دالة معرّفة في المستوى الأعلى لا ترى متغير match متداخلًا (تُمرَّر كوسيط)', async () => {
  const t = await mk(R("function bad() { return request.auth.uid == userId; } function ok(x) { return request.auth.uid == x; } match /users/{userId} { allow read: if bad(); allow write: if ok(userId); }"));
  await t.seed((d) => setDoc(doc(d, 'users', 'u'), { a: 1 })); await assertFails(getDoc(doc(t.as('u'), 'users', 'u'))); await assertSucceeds(setDoc(doc(t.as('u'), 'users', 'u'), { a: 2 }));
});
