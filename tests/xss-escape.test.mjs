// node --test tests/xss-escape.test.mjs  — يختبر esc/escJs الفعلية المستخرجة من js/utils.js (مش نسخة).
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8');
const grab = (n) => new Function(src.match(new RegExp('export function ' + n + '\\b[\\s\\S]*?\\n}\\n'))[0].replace('export ', '') + `; return ${n};`)();
const esc = grab('esc'), escJs = grab('escJs');
const payloads = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '"><svg/onload=alert(1)>', "');alert(1);//", '" onmouseover="alert(1)'];
test('esc: no raw < > " \' survive (safe in text and quoted attributes)', () => {
  for (const p of payloads) assert.doesNotMatch(esc(p), /[<>"']/);
});
test('escJs: payload cannot break out of a single-quoted JS string inside onclick', () => {
  for (const p of payloads) { const o = escJs(p); assert.doesNotMatch(o, /(^|[^\\])'/); assert.doesNotMatch(o, /[<>"]/); }
});
test('esc does not double-escape plain Arabic text', () => assert.equal(esc('متجر الأمل 123'), 'متجر الأمل 123'));
// ملاحظة: escJs لا تُهرّب newline؛ سلسلة بسطر جديد داخل onclick تكسر الـ handler (DoS للعنصر لا XSS). الحل الأمثل = حذف onclick.
