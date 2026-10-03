// node tests/import-check.mjs — يتأكد إن كل اسم مستورد من ملف محلي مُصدَّر فعلًا (فشل import = تطبيق ميت في المتصفح).
import fs from 'node:fs'; import path from 'node:path';
const dir = new URL('../js/', import.meta.url).pathname; let bad = 0;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const exportsOf = (src) => { const s = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class|var)\s+([A-Za-z0-9_$]+)/g)) s.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) s.add(n); });
  return s; };
const ex = Object.fromEntries(files.map((f) => [f, exportsOf(fs.readFileSync(dir + f, 'utf8'))]));
for (const f of files) {
  const src = fs.readFileSync(dir + f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g)) {
    const target = m[2]; if (!ex[target]) { console.log(f, 'imports missing file', target); bad++; continue; }
    for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean))
      if (!ex[target].has(n)) { console.log(`${f}: '${n}' not exported by ${target}`); bad++; }
  }
}
console.log(bad ? `FAIL ${bad}` : 'OK all local imports resolve'); process.exit(bad ? 1 : 0);
