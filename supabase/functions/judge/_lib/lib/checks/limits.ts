// GENERATED from src/lib/checks/limits.ts; edit the source and run npm run sync:functions.
// Input limits (spec item 1, PLAN section 2): KB = 1,024 UTF-8 bytes. Source <= 30 KB; 1-5 style samples, <= 20 KB in
// total, or a built-in voice (samples === null). Empty or non-text input is an error. Enforced in the browser and again
// in the edge function with this same function.

export const KB = 1024;
export const SOURCE_MAX_BYTES = 30 * KB;
export const SAMPLES_MAX_BYTES = 20 * KB;
export const MIN_SAMPLES = 1;
export const MAX_SAMPLES = 5;

export type LimitCode =
  | 'source_not_text'
  | 'source_empty'
  | 'source_too_large'
  | 'samples_not_list'
  | 'samples_count'
  | 'sample_not_text'
  | 'sample_empty'
  | 'samples_too_large';

export interface LimitError {
  code: LimitCode;
  field: 'source' | 'samples';
  /** 0-based sample index, for per-sample errors. */
  index?: number;
  message: string;
}

const encoder = new TextEncoder();

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

function formatKb(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} KB`;
}

/**
 * Plain text only: no NUL or other C0 control characters except tab, line feed and carriage return, no DEL, and no
 * U+FFFD replacement characters (the usual sign of a binary file decoded as text).
 */
export function looksLikeText(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/.test(value);
}

/** Validates raw inputs; returns every problem found (empty array = valid). samples === null means a built-in voice. */
export function validateInputs(source: unknown, samples: unknown): LimitError[] {
  const errors: LimitError[] = [];
  if (typeof source !== 'string' || !looksLikeText(source)) {
    errors.push({ code: 'source_not_text', field: 'source', message: 'The source must be plain text or Markdown.' });
  } else if (source.trim() === '') {
    errors.push({ code: 'source_empty', field: 'source', message: 'The source is empty.' });
  } else {
    const bytes = utf8Bytes(source);
    if (bytes > SOURCE_MAX_BYTES) {
      errors.push({ code: 'source_too_large', field: 'source', message: `The source is ${formatKb(bytes)}; the limit is 30 KB.` });
    }
  }

  if (samples === null) return errors; // built-in voice
  if (!Array.isArray(samples)) {
    errors.push({ code: 'samples_not_list', field: 'samples', message: 'Style samples must be a list of texts.' });
    return errors;
  }
  if (samples.length < MIN_SAMPLES || samples.length > MAX_SAMPLES) {
    errors.push({ code: 'samples_count', field: 'samples', message: `Provide 1 to 5 style samples (got ${samples.length}), or choose a built-in voice.` });
  }
  let total = 0;
  samples.forEach((s: unknown, index: number) => {
    if (typeof s !== 'string' || !looksLikeText(s)) {
      errors.push({ code: 'sample_not_text', field: 'samples', index, message: `Sample ${index + 1} must be plain text.` });
      return;
    }
    if (s.trim() === '') errors.push({ code: 'sample_empty', field: 'samples', index, message: `Sample ${index + 1} is empty.` });
    total += utf8Bytes(s);
  });
  if (total > SAMPLES_MAX_BYTES) {
    errors.push({ code: 'samples_too_large', field: 'samples', message: `The samples total ${formatKb(total)}; the limit is 20 KB.` });
  }
  return errors;
}
