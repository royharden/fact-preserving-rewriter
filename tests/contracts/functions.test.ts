import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigProbeRequestSchema, RewriteRequestSchema, JudgeRequestSchema, RewriteResponseSchema } from '../../src/contracts/api.ts';
import { expectedCopies, FUNCTION_NAMES, sha } from '../../scripts/sync-function-libs.ts';

const root = resolve(import.meta.dirname, '../..');
const id = '11111111-1111-4111-8111-111111111111';
describe('strict edge API and deployment parity', () => {
  it('rejects caller evidence, prompt, costs, repair text and unknown probe fields', () => {
    const request = { run_id: id, expected_ordinal: 1, request_key: 'request-0001', source_hash: 'a'.repeat(64) };
    expect(RewriteRequestSchema.safeParse(request).success).toBe(true);
    for (const key of ['prompt', 'verdict', 'flags', 'repair_request', 'cost']) expect(RewriteRequestSchema.safeParse({ ...request, [key]: 'untrusted' }).success).toBe(false);
    expect(JudgeRequestSchema.safeParse({ run_id: id, attempt_id: id, request_key: 'judge-0001', flags: [] }).success).toBe(false);
    expect(ConfigProbeRequestSchema.safeParse({ probe: true }).success).toBe(true);
    expect(ConfigProbeRequestSchema.safeParse({ probe: true, run_id: id }).success).toBe(false);
    expect(RewriteResponseSchema.safeParse({ attempt_id: id, ordinal: 1, rewrite: 'Text', content_hash: 'b'.repeat(64), flags: [], verdict: 'pass', run_status: 'review_ready', next_ordinal: null, call_ids: [] }).success).toBe(true);
  });
  it('re-derives every local copy, source hash and transformed hash, with no stale extra modules', async () => {
    const expected = await expectedCopies(root);
    async function files(path: string, prefix = ''): Promise<string[]> {
      const out: string[] = [];
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) out.push(...await files(join(path, entry.name), `${name}/`));
        else out.push(name);
      }
      return out.sort();
    }
    for (const fn of FUNCTION_NAMES) {
      const local = join(root, 'supabase/functions', fn, '_lib');
      expect(await files(local)).toEqual([...expected.copies.keys(), 'hashes.json'].sort());
      expect(JSON.parse(await readFile(join(local, 'hashes.json'), 'utf8'))).toEqual(expected.manifest);
      for (const [name, transformed] of expected.copies) {
        const actual = await readFile(join(local, name), 'utf8');
        expect(actual).toBe(transformed);
        expect(sha(actual)).toBe(expected.manifest.files[name].copied_sha256);
      }
    }
  });
  it('keeps JWT verification and user-scoped ownership read ahead of service run operations', async () => {
    for (const fn of FUNCTION_NAMES) {
      const source = await readFile(join(root, 'supabase/functions', fn, 'index.ts'), 'utf8');
      expect(source.indexOf('userClient.auth.getUser')).toBeLessThan(source.indexOf('const owned ='));
      expect(source.indexOf('const owned =')).toBeLessThan(source.indexOf('const db: ServiceGateway'));
      expect(source).toContain(".eq('user_id', user.id)");
      expect(source).toContain("owned.data.user_id !== user.id");
      expect(source).not.toMatch(/from ['"]\.\.\//);
      expect(source).toContain("npm:@supabase/supabase-js@2.45.4");
    }
    expect(await readFile(join(root, 'supabase/config.toml'), 'utf8')).toMatch(/\[functions\.rewrite\]\s+verify_jwt = true[\s\S]*\[functions\.judge\]\s+verify_jwt = true/);
  });
});
