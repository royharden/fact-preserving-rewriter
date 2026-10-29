// Explicit owner-run identity bootstrap/reuse. No provider or service-role credentials belong in this module.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invoked, projectPath } from './common.ts';

export interface StoredEvalSession { version: 1; project_url: string; user_id: string; access_token: string; refresh_token: string }
type AuthClient = Pick<SupabaseClient, 'auth'>;
export function evalSessionPath(value: string | undefined): string {
  if (!value) throw new Error('set EVAL_SESSION_FILE to an owner-chosen .eval-auth/<name>.json path');
  const path = projectPath(value), rel = relative(projectPath('.eval-auth'), path);
  if (!rel || rel.startsWith('..') || !/\.json$/i.test(rel)) throw new Error('EVAL_SESSION_FILE must be inside gitignored .eval-auth/');
  return path;
}
export function expectedEvalUserId(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('set EVAL_EXPECTED_USER_ID to the owner-approved bootstrap user id');
  return value;
}
function storedSession(value: unknown, url: string, expectedUserId: string): StoredEvalSession {
  if (!value || typeof value !== 'object') throw new Error('invalid saved eval session');
  const row = value as StoredEvalSession;
  if (row.version !== 1 || row.project_url !== url || row.user_id !== expectedUserId || typeof row.access_token !== 'string' || !row.access_token || typeof row.refresh_token !== 'string' || !row.refresh_token) throw new Error('saved eval session project/identity mismatch');
  return row;
}
/** Verify against Auth, rather than trusting identity fields decoded from a local session or JWT. */
export async function restoreEvalIdentity(client: AuthClient, saved: unknown, url: string, expectedUserId: string): Promise<StoredEvalSession> {
  const row = storedSession(saved, url, expectedEvalUserId(expectedUserId));
  const restored = await client.auth.setSession({ access_token: row.access_token, refresh_token: row.refresh_token }).catch(() => { throw new Error('approved eval session could not be restored'); });
  if (restored.error || !restored.data.session || restored.data.session.user.id !== expectedUserId) throw new Error('approved eval session could not be restored');
  const verified = await client.auth.getUser().catch(() => { throw new Error('approved eval identity could not be verified'); });
  if (verified.error || verified.data.user?.id !== expectedUserId) throw new Error('approved eval identity could not be verified');
  return { version: 1, project_url: url, user_id: expectedUserId, access_token: restored.data.session.access_token, refresh_token: restored.data.session.refresh_token };
}
export async function restoreEvalSession(client: AuthClient, url: string): Promise<string> {
  const expected = expectedEvalUserId(process.env.EVAL_EXPECTED_USER_ID), path = evalSessionPath(process.env.EVAL_SESSION_FILE);
  let saved: unknown;
  try { saved = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('saved eval session could not be read/parsed'); }
  const refreshed = await restoreEvalIdentity(client, saved, url, expected);
  // Persist refresh-token rotation. This is auth state, never a result/evidence artifact.
  await writeFile(path, `${JSON.stringify(refreshed)}\n`, { mode: 0o600 });
  return expected;
}
export async function bootstrapEvalSession(client: AuthClient, url: string, path: string): Promise<string> {
  // Refuse an existing file before creating an identity; exclusive write also guards concurrent bootstrap.
  await readFile(path, 'utf8').then(() => { throw new Error('eval session file already exists; restore it instead'); }, (e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  const result = await client.auth.signInAnonymously();
  if (result.error || !result.data.session || !result.data.user) throw new Error('eval identity bootstrap failed');
  const session: StoredEvalSession = { version: 1, project_url: url, user_id: result.data.user.id,
    access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(session)}\n`, { flag: 'wx', mode: 0o600 });
  return session.user_id;
}
if (invoked(import.meta.url)) {
  if (!process.argv.includes('--bootstrap')) throw new Error('use npm run eval:bootstrap-session for the separate identity-only owner step');
  const url = process.env.VITE_SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('public backend URL/anonymous key required');
  const path = evalSessionPath(process.env.EVAL_SESSION_FILE);
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const userId = await bootstrapEvalSession(client, url, path);
  process.stdout.write(`Eval user id: ${userId}\nSaved session: ${path}\nSet EVAL_EXPECTED_USER_ID to this id. Owner must separately approve the live plan and provision its expiring SQL allowance for this user before eval --live. No model call or allowance was created.\n`);
}
