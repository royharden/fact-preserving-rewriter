import { runChecks } from './checks.ts';
import { runClaims } from './claims.ts';
import { runE2E } from './e2e.ts';
import { invoked } from './common.ts';
export interface EvaluationTasks {
  runChecks(): Promise<void>;
  runClaims(options: { existing: 'reuse' }): Promise<void>;
  runE2E(mode: 'mock' | 'live'): Promise<void>;
}
export async function runEvaluation(mode: 'mock' | 'live', tasks: EvaluationTasks = { runChecks, runClaims, runE2E }): Promise<void> {
  await tasks.runChecks();
  await tasks.runClaims({ existing: 'reuse' });
  await tasks.runE2E(mode);
}
if (invoked(import.meta.url)) {
  if (process.argv.includes('--live') && process.argv.includes('--mock')) throw new Error('choose one eval mode');
  await runEvaluation(process.argv.includes('--live') ? 'live' : 'mock');
}
