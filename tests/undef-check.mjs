// node tests/undef-check.mjs — heuristic: دوال تُستدعى في ملف ولا تُعرَّف/تُستورد/ليست Built-in (يلتقط نسيان import).
import fs from 'node:fs';
const dir = new URL('../js/', import.meta.url).pathname;
const KW = new Set('if for while switch catch function return typeof await async new super import export class else do try finally delete void in of'.split(' '));
const GLOBALS = new Set('alert confirm prompt fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame parseInt parseFloat isNaN isFinite String Number Boolean Array Object Math Date JSON Promise Set Map WeakMap Error URL URLSearchParams FormData FileReader Image Blob Intl RegExp Symbol encodeURIComponent decodeURIComponent encodeURI decodeURI atob btoa structuredClone getComputedStyle matchMedia navigator maplibregl AbortController Audio Notification TextEncoder TextDecoder queueMicrotask CustomEvent Event IntersectionObserver MutationObserver ResizeObserver XMLHttpRequest escape unescape require sendPrompt'.split(' '));
// Baseline: false positives معروفة (كلمات داخل تعليقات/متغيرات متعددة التصريح/CSS url()) - أي اسم جديد خارج القائمة يُفشل الاختبار.
const BASELINE = new Set(['admin-customers.js:onPage','admin-requests.js:onPage','admin.js:onPage','customer.js:goCheckout','customer.js:url','customer.js:gradient','driver.js:File','external.js:epUnsub','geo-utils.js:toRad','maps.js:callback','maps.js:POI','maps.js:on','maps.js:driverId','merchant.js:Picker','rides.js:Distance','routing.js:Polyline']);
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(dir + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
  const declared = new Set();
  for (const m of src.matchAll(/\b(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) m[1].split(',').forEach((x) => declared.add(x.split(':').pop().split('=')[0].trim()));
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) m[1].split(',').forEach((x) => declared.add(x.split('=')[0].trim()));
  for (const m of src.matchAll(/import\s*\{([^}]*)\}/g)) m[1].split(',').forEach((x) => declared.add(x.trim().split(/\s+as\s+/).pop()));
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>|\b([A-Za-z_$][\w$]*)\s*=>/g)) (m[1] ?? m[2]).split(',').forEach((x) => declared.add(x.split('=')[0].replace(/[{}\[\]\.]/g, '').trim()));
  for (const m of src.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) m[1].split(',').forEach((x) => declared.add(x.split('=')[0].replace(/[{}\[\]\.]/g, '').trim()));
  for (const m of src.matchAll(/catch\s*\(\s*([\w$]+)/g)) declared.add(m[1]);
  const called = new Set([...src.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  for (const n of called) if (!KW.has(n) && !GLOBALS.has(n) && !declared.has(n) && !/^(get|set)$/.test(n) && !BASELINE.has(`${f}:${n}`)) { console.log(`${f}: '${n}(' not declared/imported`); bad++; }
}
console.log(bad ? `FAIL ${bad}` : 'OK no undeclared function calls'); process.exit(bad ? 1 : 0);
