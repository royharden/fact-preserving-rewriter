// Self-contained deployment entrypoint: imports ONLY this function's generated _lib tree.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { ConfigProbeRequestSchema, ConfigProbeResponseSchema, RewriteRequestSchema, JudgeRequestSchema } from './_lib/contracts/api.ts';
import { readLiveConfig } from './_lib/lib/server/config.ts';
import { attemptFromRow, runFromRow } from './_lib/lib/server/codec.ts';
import { executeRewrite } from './_lib/lib/server/rewrite.ts';
import { executeJudge } from './_lib/lib/server/judge.ts';
import { EdgeError, edgeError } from './_lib/lib/server/types.ts';
import type { CallRow, Row, ServiceGateway } from './_lib/lib/server/types.ts';

const FUNCTION = 'judge' as 'rewrite' | 'judge';
const MAX_REQUEST_BYTES = 4096;
async function readBody(req: Request): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new EdgeError(415, 'json_required');
  const reader = req.body?.getReader();
  if (!reader) throw new EdgeError(400, 'request_body_missing');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new EdgeError(413, 'request_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new EdgeError(400, 'invalid_json'); }
}
function check<T>(reply: { data: T; error: { message: string } | null }): T {
  if (reply.error) throw new Error(reply.error.message);
  return reply.data;
}
/** Handler re-verifies JWT in addition to the gateway verify_jwt=true setting. */
export async function handler(req: Request): Promise<Response> {
  const env = (name: string): string | undefined => Deno.env.get(name);
  const origin = env('APP_ORIGIN');
  const requestOrigin = req.headers.get('origin');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
  if (origin && requestOrigin === origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
  }
  const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers });
  try {
    if (!origin) throw new EdgeError(503, 'provider_not_configured');
    if (requestOrigin && requestOrigin !== origin) throw new EdgeError(403, 'origin_not_allowed');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') throw new EdgeError(405, 'method_not_allowed');
    const authorization = req.headers.get('authorization');
    if (!authorization || !/^Bearer \S+$/i.test(authorization)) throw new EdgeError(401, 'unauthorized');
    const url = env('SUPABASE_URL');
    const anon = env('SUPABASE_ANON_KEY');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !serviceKey) throw new EdgeError(503, 'provider_not_configured');
    const userClient = createClient(url, anon, { global: { headers: { authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await userClient.auth.getUser(authorization.replace(/^Bearer /i, ''));
    if (verified.error || !verified.data.user) throw new EdgeError(401, 'unauthorized');
    const user = verified.data.user;
    const body = await readBody(req);
    const config = readLiveConfig(env);
    if (ConfigProbeRequestSchema.safeParse(body).success) {
      // No run/evidence RPC or model call: only authenticated, service-only readiness inspection.
      const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const limits = await admin.from('budget_limits').select('live_enabled').limit(1).maybeSingle();
      const databaseEnabled = !limits.error && limits.data?.live_enabled === true;
      return json(ConfigProbeResponseSchema.parse({
        configured: databaseEnabled && !!config.rewrite && (!config.judgeEnabled || !!config.judge),
        rewrite_configured: databaseEnabled && !!config.rewrite,
        judge_configured: databaseEnabled && !!config.judge,
      }));
    }
    const parsed = FUNCTION === 'rewrite' ? RewriteRequestSchema.safeParse(body) : JudgeRequestSchema.safeParse(body);
    if (!parsed.success) throw new EdgeError(422, 'invalid_request');
    // Ownership proof uses the USER token with RLS, before creating/using a service gateway.
    const owned = await userClient.from('rewrite_runs').select('*').eq('id', parsed.data.run_id).eq('user_id', user.id).maybeSingle();
    if (owned.error || !owned.data || owned.data.user_id !== user.id) throw new EdgeError(404, 'run_not_found');
    const run = runFromRow(owned.data as Row);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const db: ServiceGateway = {
      async rpc<T>(name: string, args: Row): Promise<T> { return check(await admin.rpc(name, args)) as T; },
      async run(id) { return runFromRow(check(await admin.from('rewrite_runs').select('*').eq('id', id).eq('user_id', user.id).single()) as Row); },
      async attempts(runId) { return (check(await admin.from('attempts').select('*').eq('run_id', runId).order('ordinal')) ?? []).map((r: Row) => attemptFromRow(r)); },
      async calls(runId, attemptId) { return (check(await admin.from('call_ledger').select('*').eq('run_id', runId).eq('attempt_id', attemptId).order('created_at')) ?? []) as CallRow[]; },
    };
    const value = FUNCTION === 'rewrite'
      ? await executeRewrite(db, run, RewriteRequestSchema.parse(body), config)
      : await executeJudge(db, run, JudgeRequestSchema.parse(body), config);
    return json(value);
  } catch (error) {
    const e = edgeError(error);
    return json({ error: e.code, ...(e.scope ? { scope: e.scope } : {}) }, e.status);
  }
}
// Supabase/Deno runs this entrypoint as main; importing for source tests does not start a server.
if (import.meta.main) Deno.serve(handler);
