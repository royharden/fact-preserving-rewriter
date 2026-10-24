// File-only transform. Does not import/execute product modules. Construction-time copies were made mechanically
// with this exact transform; executing this generator and the parity test is deferred until Dirty Mode closes.
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FUNCTION_NAMES = ['rewrite', 'judge'] as const;
export const SYNC_ROOTS = ['lib/loop/step.ts', 'lib/server/rewrite.ts', 'lib/server/judge.ts', 'lib/server/config.ts'];
export interface HashEntry { source_sha256: string; copied_sha256: string }
export interface Manifest { version: 1; sourceRoot: 'src'; files: Record<string, HashEntry> }
export const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export function importSpecifiers(source: string): string[] {
  // Anchor at actual import declarations; prose such as "from 'added'" in comments is not an import.
  return [...source.matchAll(/^\s*import\s+(?:type\s+)?(?:[\w*$,{][^;]*?\s+from\s+)?(['"])([^'"\r\n]+)\1/gm)].map((m) => m[2]);
}
export function transformSource(source: string, name: string, pins: Record<string, string>): string {
  for (const spec of importSpecifiers(source)) {
    if (!spec.startsWith('.') && spec !== 'chrono-node' && spec !== 'zod') throw new Error(`unsupported copied import ${spec} in ${name}`);
  }
  const transformed = source.replace(/\r\n/g, '\n').replace(/(['"])(chrono-node|zod)\1/g,
    (_all, quote: string, pkg: string) => `${quote}npm:${pkg}@${pins[pkg]}${quote}`);
  return `// GENERATED from src/${name}; edit the source and run npm run sync:functions.\n${transformed}`;
}
export async function functionSources(root: string): Promise<Map<string, string>> {
  const pending = [...SYNC_ROOTS];
  for (const folder of ['contracts', 'lib/prompts', 'lib/providers']) {
    for (const entry of await readdir(join(root, 'src', folder))) if (entry.endsWith('.ts')) pending.push(`${folder}/${entry}`);
  }
  const sources = new Map<string, string>();
  while (pending.length) {
    const name = pending.shift() as string;
    if (sources.has(name)) continue;
    if (name.startsWith('../') || !name.endsWith('.ts')) throw new Error(`source outside src: ${name}`);
    const text = await readFile(join(root, 'src', name), 'utf8');
    sources.set(name, text);
    for (const spec of importSpecifiers(text)) {
      if (spec.startsWith('.')) pending.push(posix.normalize(posix.join(posix.dirname(name), spec)));
    }
  }
  return new Map([...sources.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
export async function expectedCopies(root: string): Promise<{ copies: Map<string, string>; manifest: Manifest }> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  const pins = { 'chrono-node': pkg.dependencies['chrono-node'], zod: pkg.dependencies.zod };
  for (const pin of Object.values(pins)) if (!/^\d+\.\d+\.\d+$/.test(pin)) throw new Error('Deno dependency versions must be exact pins');
  const copies = new Map<string, string>();
  const manifest: Manifest = { version: 1, sourceRoot: 'src', files: {} };
  for (const [name, text] of await functionSources(root)) {
    const copy = transformSource(text, name, pins);
    copies.set(name, copy);
    manifest.files[name] = { source_sha256: sha(text), copied_sha256: sha(copy) };
  }
  return { copies, manifest };
}
export async function syncFunctionLibs(root: string): Promise<void> {
  const { copies, manifest } = await expectedCopies(root);
  for (const fn of FUNCTION_NAMES) {
    const target = join(root, 'supabase', 'functions', fn, '_lib');
    for (const [name, copy] of copies) {
      await mkdir(dirname(join(target, name)), { recursive: true });
      await writeFile(join(target, name), copy, 'utf8');
    }
    await writeFile(join(target, 'hashes.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncFunctionLibs(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
}
