// Claim-check thresholds. STATUS: uncalibrated — set on dev later (PLAN section 7: calibrate on the dev split for a
// <= 5 % false-alarm rate on known-good rewrites; record the chosen values and the dev run in results/).

export const THRESHOLDS_STATUS = 'uncalibrated — set on dev later';

/** Top-k context sentences aligned to each claim sentence (both directions). */
export const ALIGN_TOP_K = 3;

/** overlap judge: a claim whose content words are covered below this fraction by its context "says nothing". */
export const OVERLAP_SUPPORT_MIN = 0.5;

/** overlap judge: claims with fewer content words than this are not judged (headings, "Done."). */
export const OVERLAP_MIN_CONTENT_WORDS = 2;

/** llm judge batching (PLAN section 4 / conflict 9.3). */
export const LLM_MAX_PAIRS_PER_BATCH = 30;
export const LLM_MAX_BATCHES = 4;
