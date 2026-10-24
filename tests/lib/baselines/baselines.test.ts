import { describe, expect, it } from 'vitest';
import { b0, b1RuleRestyler, runSystem } from '../../../src/lib/baselines/systems.ts';
import { extract } from '../../../src/lib/factledger/extract.ts';
import { checkAttempt } from '../../../src/lib/checks/index.ts';
const referenceTime = new Date('2026-10-24T12:00:00.000Z');
describe('computed baselines', () => {
  const source = 'We do not release ABC-1234. The cost is $1.2M; delivery takes 5 to 7 minutes. She said “do not alter this quote”.';
  it('B0 is exact source identity', () => { expect(b0(source)).toBe(source); });
  it('B1 protects exact quotes and identifiers and hard-rechecks all candidate sentences', () => {
    const result = b1RuleRestyler(source, [], referenceTime);
    expect(result).toContain('“do not alter this quote”'); expect(result).toContain('ABC-1234');
    expect(checkAttempt({ sourceText: source, ledger: extract(source, { referenceTime }), samples: [], referenceTime, maskNamespace: null }, result).flags.filter((f) => f.class === 'hard')).toEqual([]);
  });
  it('B0/B1 never call the model through the actual system runner', async () => {
    let calls = 0;
    for (const system of ['B0', 'B1'] as const) {
      const result = await runSystem({ system, sourceId: 'test', voiceId: 'test', sourceText: source, samples: ['a sample'], ledger: extract(source, { referenceTime }), referenceTime: referenceTime.toISOString(), protectedTerms: [], aliases: {}, maskNamespace: null }, { model: 'must-not-call', rewriter: { name: 'reject', call: async () => { calls++; throw new Error('forbidden model call'); } } });
      expect(result.modelCalls).toBe(0);
    }
    expect(calls).toBe(0);
  });
});
