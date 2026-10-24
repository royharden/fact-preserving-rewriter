// Durable at-most-once dispatch. A crash after dispatch is an unknown outcome, never permission to dispatch again.
import type { ModelResponse, PromptMessages } from '../providers/types.ts';
import { estimateInputTokens, reservationMicroUsd, settledMicroUsd } from '../callledger/cost.ts';
import { EdgeError } from './types.ts';
import type { CallRow, LiveModel, ServiceGateway } from './types.ts';

export function callKey(runId: string, attemptId: string, purpose: string, batch = 0): string {
  return `v1:${runId}:${attemptId}:${purpose}:${batch}`;
}
function cached(row: CallRow): ModelResponse | null {
  const p = row.response_payload as ModelResponse | null;
  if (!p || typeof p.text !== 'string' || typeof p.model !== 'string' ||
      (p.provider !== 'anthropic' && p.provider !== 'openai_compatible')) return null;
  return p;
}
export async function durableModelCall(
  db: ServiceGateway, runId: string, attemptId: string, purpose: 'rewrite' | 'b3_check' | 'b3_revise' | 'judge',
  model: LiveModel, messages: PromptMessages, batch = 0,
): Promise<{ response: ModelResponse; callId: string }> {
  const key = callKey(runId, attemptId, purpose, batch);
  // Read persisted calls first: configuration may have changed since this phase was settled.
  let row = (await db.calls(runId, attemptId)).find((c) => c.idempotency_key === key);
  if (!row) row = await db.rpc<CallRow>('reserve_model_call', {
    p_run: runId, p_attempt: attemptId, p_idempotency_key: key,
    p_function: purpose === 'judge' ? 'judge' : 'rewrite', p_purpose: purpose,
    p_provider: model.provider, p_model: model.model,
    p_reserved_micro_usd: reservationMicroUsd(estimateInputTokens(messages.system, messages.user), model.maxTokens, model.prices),
  });
  if (row.status === 'settled') {
    const response = cached(row);
    if (response) return { response, callId: row.id };
    throw new EdgeError(409, 'settled_response_unavailable');
  }
  if (row.status === 'unknown' || row.status === 'failed') throw new EdgeError(409, 'model_call_unavailable');
  if (row.status === 'dispatching') throw new EdgeError(409, 'model_call_in_progress');
  if (row.status !== 'reserved' || row.run_id !== runId || row.attempt_id !== attemptId ||
      row.idempotency_key !== key || row.purpose !== purpose || row.function !== (purpose === 'judge' ? 'judge' : 'rewrite')) {
    // A mismatched operation is not ours to terminate, even if returned by the gateway.
    throw new EdgeError(409, 'reservation_identity_mismatch');
  }
  // Bind this dispatch to one configuration snapshot. Settled replay above never depends on current configuration.
  const dispatch = { ...model, prices: { ...model.prices } };
  const reserved = Number(row.reserved_micro_usd);
  let required: number | null = null;
  try {
    required = reservationMicroUsd(estimateInputTokens(messages.system, messages.user), dispatch.maxTokens, dispatch.prices);
  } catch { /* An invalid cost configuration cannot establish coverage by the existing reservation. */ }
  if (row.provider !== dispatch.provider || row.model !== dispatch.model || !Number.isSafeInteger(reserved) ||
      reserved < 0 || required === null || required > reserved) {
    // No claim was attempted. SQL atomically permits failed/zero only while still reserved; a concurrent claimant
    // makes this settlement refuse instead of refunding a potentially billable dispatch.
    await db.rpc('settle_model_call', { p_call: row.id, p_status: 'failed', p_actual_micro_usd: 0 });
    throw new EdgeError(409, 'reservation_configuration_changed');
  }
  const claimed = await db.rpc<boolean>('claim_dispatch', { p_call: row.id });
  if (!claimed) throw new EdgeError(409, 'model_call_in_progress');
  let response: ModelResponse;
  try {
    response = await dispatch.call({ ...messages, maxTokens: dispatch.maxTokens });
  } catch {
    // Once claim_dispatch succeeds, HTTP errors/timeouts cannot prove there was no billable provider execution.
    await db.rpc('settle_model_call', { p_call: row.id, p_status: 'unknown' });
    throw new EdgeError(502, 'provider_outcome_unknown');
  }
  const actual = settledMicroUsd(reserved, response, dispatch.prices);
  if (actual > reserved) {
    await db.rpc('settle_model_call', { p_call: row.id, p_status: 'unknown' });
    throw new EdgeError(502, 'usage_exceeds_reservation');
  }
  // Persist raw JSON response with accounting in one SQL transaction. A later retry can finish checks without a call.
  await db.rpc('settle_model_call', {
    p_call: row.id, p_status: 'settled', p_actual_micro_usd: actual,
    p_input_tokens: response.inputTokens, p_output_tokens: response.outputTokens, p_response_payload: response,
  });
  return { response, callId: row.id };
}
