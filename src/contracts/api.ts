// zod schemas for the edge-function API (PLAN section 6.3) and for model outputs (strict: unknown keys are errors).
// Wire names are snake_case.

import { z } from 'zod';

const SpanSchema = z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).strict();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const RequestKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

export const FactKindSchema = z.enum(['number', 'date', 'entity', 'quote', 'verbatim']);
export const VerdictSchema = z.enum(['pass', 'needs_review', 'failed']);
export const RunStatusSchema = z.enum(['open', 'attempting', 'judging', 'review_ready']);
export const ClaimLabelSchema = z.enum(['supports', 'contradicts', 'says_nothing']);

export const FlagSchema = z
  .object({
    id: z.string().regex(/^[HSCG][1-9]\d*$/),
    class: z.enum(['hard', 'soft', 'claim', 'coverage']),
    code: z.string().min(1),
    factId: z.string().optional(),
    kind: FactKindSchema.optional(),
    sourceSpan: SpanSchema.optional(),
    rewriteSpan: SpanSchema.optional(),
    found: z.string(),
    evidence: z.string().optional(),
    pairId: z.string().optional(),
  })
  .strict();

export const CoverageSchema = z.object({ judged: z.number().int().min(0), total: z.number().int().min(0) }).strict();

// --- rewrite function ---------------------------------------------------------------------------------------------

/** The client sends ids and the hash it saw; never prompt text, repair text, verdicts, hashes of output or costs. */
export const RewriteRequestSchema = z
  .object({
    run_id: z.string().uuid(),
    expected_ordinal: z.number().int().min(1).max(3),
    request_key: RequestKeySchema,
    source_hash: Sha256Schema,
  })
  .strict();
export type RewriteRequest = z.infer<typeof RewriteRequestSchema>;

export const RewriteResponseSchema = z
  .object({
    attempt_id: z.string(),
    ordinal: z.number().int().min(1).max(3),
    rewrite: z.string(),
    content_hash: Sha256Schema,
    flags: z.array(FlagSchema),
    verdict: VerdictSchema,
    run_status: RunStatusSchema,
    next_ordinal: z.number().int().min(2).max(3).nullable(),
    call_ids: z.array(z.string()),
  })
  .strict();
export type RewriteResponse = z.infer<typeof RewriteResponseSchema>;

// --- judge function -----------------------------------------------------------------------------------------------

export const JudgeRequestSchema = z
  .object({
    run_id: z.string().uuid(),
    attempt_id: z.string().uuid(),
    request_key: RequestKeySchema,
    finalize_unavailable: z.boolean().optional(),
  })
  .strict();
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;

export const JudgeResponseSchema = z
  .object({
    flags: z.array(FlagSchema),
    coverage: CoverageSchema,
    verdict: VerdictSchema,
    run_status: RunStatusSchema,
    call_ids: z.array(z.string()),
  })
  .strict();
export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export const ErrorResponseSchema = z
  .object({ error: z.string(), scope: z.string().optional(), detail: z.string().optional() })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// --- model outputs (strict JSON; parsed by providers/parse.ts) ----------------------------------------------------

/** Rewriter output: exactly one string field. */
export const RewriteModelOutputSchema = z.object({ rewrite: z.string() }).strict();
export type RewriteModelOutput = z.infer<typeof RewriteModelOutputSchema>;

/** LLM claim judge output for one batch. */
export const JudgeModelOutputSchema = z
  .object({
    results: z.array(z.object({ pair_id: z.string().min(1), label: ClaimLabelSchema }).strict()),
  })
  .strict();
export type JudgeModelOutput = z.infer<typeof JudgeModelOutputSchema>;

/** B3 self-check output: issues the model believes its draft has (used only to prompt its own revision). */
export const B3SelfCheckOutputSchema = z
  .object({
    issues: z
      .array(z.object({ type: z.enum(['added', 'dropped', 'changed']), detail: z.string().max(500) }).strict())
      .max(50),
  })
  .strict();
export type B3SelfCheckOutput = z.infer<typeof B3SelfCheckOutputSchema>;
