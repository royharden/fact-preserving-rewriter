// GENERATED from src/lib/style/distance.ts; edit the source and run npm run sync:functions.
// styleDistance(text, profile): mean |z| over the features whose sample sd > 0 (zero-variance features are skipped and
// listed). The text's feature values are the mean over its own sentence blocks, matching how the profile was built.
// null with a reason when the profile is under 600 words, when no feature varies, or when the text is empty.
// Descriptive only: it never blocks a rewrite and is not a validated metric.

import type { FeatureName, StyleProfile } from './profile.ts';
import { FEATURES, blocks, featureVector, mean } from './profile.ts';

export const STYLE_LABEL = 'descriptive, not a validated metric';
const ZERO_SD = 1e-9;

export interface StyleDistance {
  value: number | null;
  reason: string | null;
  used: FeatureName[];
  skipped: FeatureName[];
  perFeature: Partial<Record<FeatureName, number>>;
  label: string;
}

export function styleDistance(text: string, p: StyleProfile): StyleDistance {
  const base = { used: [] as FeatureName[], skipped: [] as FeatureName[], perFeature: {}, label: STYLE_LABEL };
  if (!p.scoreEnabled) return { ...base, value: null, reason: p.disabledReason ?? 'Style score disabled.' };
  const textBlocks = blocks(text);
  if (textBlocks.length === 0) return { ...base, value: null, reason: 'No text to compare.' };

  const vectors = textBlocks.map(featureVector);
  const used: FeatureName[] = [];
  const skipped: FeatureName[] = [];
  const perFeature: Partial<Record<FeatureName, number>> = {};
  for (const f of FEATURES) {
    const stat = p.features[f];
    if (!(stat.sd > ZERO_SD)) {
      skipped.push(f);
      continue;
    }
    const x = mean(vectors.map((v) => v[f]));
    perFeature[f] = Math.abs(x - stat.mean) / stat.sd;
    used.push(f);
  }
  if (used.length === 0) {
    return { ...base, skipped, value: null, reason: 'No style feature varies across the samples (zero variance).' };
  }
  return { value: mean(used.map((f) => perFeature[f] ?? 0)), reason: null, used, skipped, perFeature, label: STYLE_LABEL };
}
