// Static syntax gate for erasable TypeScript: strip types with Node's built-in stripTypeScriptTypes, then parse the
// result as an ES module (vm.SourceTextModule) without linking or evaluating it. Never executes the checked code.
// Usage: node --experimental-vm-modules --no-warnings scripts/syntax-check.mjs <files or directories>...
// Directories are walked for *.ts / *.mts files (node_modules, dist and .git skipped; *.d.ts and *.tsx are not checked:
// .tsx cannot be type-stripped, and declaration files are not runtime modules).
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const isChecked = (name) => (name.endsWith('.ts') || name.endsWith('.mts')) && !name.endsWith('.d.ts');

function collect(target, out) {
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const entry of readdirSync(target).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const child = join(target, entry);
      if (statSync(child).isDirectory()) collect(child, out);
      else if (isChecked(entry)) out.push(child);
    }
  } else {
    out.push(target);
  }
}

const files = [];
for (const arg of process.argv.slice(2)) {
  try {
    collect(arg, files);
  } catch (e) {
    console.log('FAIL', arg, '-', String(e.message).split('\n')[0]);
    process.exitCode = 1;
  }
}

let bad = 0;
for (const f of files) {
  try {
    const out = stripTypeScriptTypes(readFileSync(f, 'utf8'), { mode: 'strip' });
    new vm.SourceTextModule(out, { identifier: f });
  } catch (e) {
    bad++;
    console.log('FAIL', f, '-', String(e.message).split('\n')[0]);
  }
}
console.log(bad ? `${bad} of ${files.length} file(s) failed` : `OK ${files.length} file(s)`);
process.exit(bad || process.exitCode ? 1 : 0);
