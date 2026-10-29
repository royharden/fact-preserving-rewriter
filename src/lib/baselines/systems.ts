import type { PipelineDeps, PipelineResult, PipelineRun } from '../loop/runPipeline.ts';
import { runPipeline } from '../loop/runPipeline.ts';
import { b1RuleRestyler } from './b1RuleRestyler.ts';
export { b0 } from './b0.ts';
export { b1RuleRestyler } from './b1RuleRestyler.ts';
/** B2/B3 use canonical prompt/adapter phases; B4 uses the masked repair pipeline. */
export function runSystem(run: PipelineRun, deps: PipelineDeps): Promise<PipelineResult> {
  return runPipeline(run, { ...deps, restyle: (text, samples) => b1RuleRestyler(text, samples, new Date(run.referenceTime)) });
}
