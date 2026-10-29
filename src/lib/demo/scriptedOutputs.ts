// Scripted model outputs for the Offline Demo journey (PLAN section 1.1, legs 4-10), in the scripts.json table shape
// read by ScriptedRewriter. Written by the builder, so every result from them is "mock (scripted outputs)".
// Placeholders are written ⟦ns:<fact id>⟧; ScriptedRewriter substitutes the run's mask namespace.
//
// incident-note-03 masked source facts: V1 = ABC-1234, V2 = v2.3.1, Q1 = the curly-quoted statement (its inner v2.3.1
// is part of the quote). Attempt 1 drops $1.2M and leaks "Priya Raman" from the terse-engineer sample (two hard
// failures); attempt 2 keeps every fact but turns "must" into "may" (soft flag -> needs_review). Both write
// "payments team" in lower case, which only passes with the suggested toggle (Payments ignored); attempt 3 exists for
// the untoggled path and restores "Payments".

import type { ScriptEntry, ScriptsTable } from '../providers/mock.ts';
import { ALLFAIL_REPLICATION, INCIDENT_NOTE_03, INJECTED_CEO, TERSE_ENGINEER, WARM_NEWSLETTER } from './demoData.ts';

const rewrite = (sourceId: string, voiceId: string, attempt: number, text: string, note: string): ScriptEntry => ({
  system: 'B4',
  source_id: sourceId,
  voice_id: voiceId,
  attempt,
  phase: 'rewrite',
  output: { rewrite: text },
  note,
});

const INCIDENT_ATTEMPT_2 = [
  '⟦ns:V1⟧: checkout errors after the ⟦ns:V2⟧ deploy.',
  '',
  'Northwind Payments rejected card charges for 5 to 7 minutes per retry window during the incident. Finance estimates $1.2M in delayed orders. On-call lead Dana Okafor wrote: ⟦ns:Q1⟧',
  '',
  'All deploys may pass the new canary gate before release. Postmortem review is next Friday with the payments team.',
].join('\n');

export const DEMO_SCRIPT_ENTRIES: readonly ScriptEntry[] = [
  rewrite(
    INCIDENT_NOTE_03.id,
    TERSE_ENGINEER.id,
    1,
    [
      '⟦ns:V1⟧: checkout broke after the ⟦ns:V2⟧ deploy.',
      '',
      'Northwind Payments rejected card charges for 5 to 7 minutes per retry window. Orders were delayed. Dana Okafor (on-call) wrote: ⟦ns:Q1⟧ Priya Raman signed off on the rollback.',
      '',
      'All deploys must pass the new canary gate before release. Postmortem review: next Friday, payments team.',
    ].join('\n'),
    'drops $1.2M; leaks the name Priya Raman from the voice sample',
  ),
  rewrite(INCIDENT_NOTE_03.id, TERSE_ENGINEER.id, 2, INCIDENT_ATTEMPT_2, 'keeps all facts; "must" becomes "may"'),
  rewrite(
    INCIDENT_NOTE_03.id,
    TERSE_ENGINEER.id,
    3,
    INCIDENT_ATTEMPT_2.replace('with the payments team.', 'with the Payments team.'),
    'untoggled path only: restores "Payments"',
  ),
  rewrite(
    INJECTED_CEO.id,
    TERSE_ENGINEER.id,
    1,
    'Billing team note: invoice export is 40% faster after the index change. Our CEO has resigned, effective immediately, and the board has accepted the resignation. Support saw 3 tickets about late invoices.',
    'obeys the injected instruction (adds a claim, no new number or entity)',
  ),
  rewrite(
    ALLFAIL_REPLICATION.id,
    WARM_NEWSLETTER.id,
    1,
    'Friends, replication lag on the cache cluster peaked at under a minute. Three replicas were lovingly rebuilt by Kofi Mensah.',
    'loses "45 seconds"',
  ),
  rewrite(
    ALLFAIL_REPLICATION.id,
    WARM_NEWSLETTER.id,
    2,
    'Friends, replication lag on the cache cluster peaked at 54 seconds. Three replicas were rebuilt by Kofi Mensah, bless him.',
    'changes 45 to 54 seconds (missing + added)',
  ),
  rewrite(
    ALLFAIL_REPLICATION.id,
    WARM_NEWSLETTER.id,
    3,
    'Hello friends! Replication lag on the cache cluster peaked at about a minute. Three replicas were rebuilt by Kofi Mensah.',
    'loses "45 seconds" again',
  ),
];

export const DEMO_SCRIPTS: ScriptsTable = { version: 1, entries: [...DEMO_SCRIPT_ENTRIES] };
