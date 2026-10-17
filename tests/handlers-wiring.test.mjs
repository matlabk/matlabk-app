// node --test tests/handlers-wiring.test.mjs — لا أزرار ميتة: كل دالة تُستدعى من onclick/onsubmit/... (في index.html وفي قوالب HTML داخل js/)
// معرّفة فعلًا على window بعد إقلاع main.js الحقيقي. (Firebase مُحاكى، DOM من index.html)
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { sleep, loadError } from './boot/env.mjs';
const SKIP = new Set(['event', 'if', 'return', 'function', 'typeof', 'this', 'window', 'document', 'location', 'history', 'setTimeout', 'alert', 'confirm', 'parseInt', 'parseFloat', 'String', 'Number', 'Math', 'JSON', 'Object', 'Array', 'Date', 'stopPropagation', 'preventDefault', 'esc', 'escJs', 'icon']);
const calls = (code) => [...code.matchAll(/(?<![.\w$'"])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]).filter((n) => !SKIP.has(n));
test('W1. الإقلاع بلا أخطاء', async () => { await sleep(300); assert.equal(loadError, null); });
test('W2. معالجات index.html (onclick/onsubmit/…) كلها معرّفة', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); const bad = new Set(); let n = 0;
  for (const m of html.matchAll(/\son([a-z]+)="([^"]*)"/g)) { n++; for (const c of calls(m[2])) if (typeof globalThis[c] !== 'function') bad.add(c); }
  assert.ok(n > 200); assert.deepEqual([...bad], []);
});
test('W3. معالجات القوالب المولَّدة داخل js/ كلها معرّفة (مثل بانر openStore الذي كان غير معرّف)', () => {
  const dir = new URL('../js/', import.meta.url); const bad = new Map(); let n = 0;
  for (const f of fs.readdirSync(dir)) { const s = fs.readFileSync(new URL(f, dir), 'utf8'); for (const m of s.matchAll(/\bon(?:click|change|input|submit|keyup|keydown|blur|focus)=\\?["']([^"'\n]*)/g)) { n++; for (const c of calls(m[1])) if (typeof globalThis[c] !== 'function') bad.set(f + ':' + c, 1); } }
  assert.ok(n > 50); assert.deepEqual([...bad.keys()], []);
});
