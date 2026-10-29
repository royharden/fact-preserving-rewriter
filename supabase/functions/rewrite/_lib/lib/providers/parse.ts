// GENERATED from src/lib/providers/parse.ts; edit the source and run npm run sync:functions.
// Strict model-output parsing: the whole reply (surrounding whitespace allowed) must be one JSON value matching the
// schema exactly. Code fences, prose around the JSON, extra keys, missing keys or wrong types are errors; nothing is
// repaired or guessed. Output over 64 KB (UTF-8) is refused before parsing.

import type { ZodType } from 'npm:zod@3.23.8';
import { B3SelfCheckOutputSchema, JudgeModelOutputSchema, RewriteModelOutputSchema } from '../../contracts/api.ts';
import type { B3SelfCheckOutput, JudgeModelOutput, RewriteModelOutput } from '../../contracts/api.ts';

export const MAX_OUTPUT_BYTES = 64 * 1024;

export type ParseErrorCode = 'output_too_large' | 'not_json' | 'schema_mismatch';
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseErrorCode; detail: string };

const encoder = new TextEncoder();

export function parseModelJson<T>(text: string, schema: ZodType<T>): ParseResult<T> {
  const bytes = encoder.encode(text).length;
  if (bytes > MAX_OUTPUT_BYTES) return { ok: false, error: 'output_too_large', detail: `${bytes} bytes > ${MAX_OUTPUT_BYTES}` };
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch (e) {
    return { ok: false, error: 'not_json', detail: e instanceof Error ? e.message : String(e) };
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { ok: false, error: 'schema_mismatch', detail };
  }
  return { ok: true, value: result.data };
}

export function parseRewriteOutput(text: string): ParseResult<RewriteModelOutput> {
  return parseModelJson(text, RewriteModelOutputSchema);
}

export function parseSelfCheckOutput(text: string): ParseResult<B3SelfCheckOutput> {
  return parseModelJson(text, B3SelfCheckOutputSchema);
}

export function parseJudgeModelOutput(text: string): ParseResult<JudgeModelOutput> {
  return parseModelJson(text, JudgeModelOutputSchema);
}
