import type { Run, Attempt } from '../../contracts/run.ts';
import type { Fact, Span } from '../factledger/types.ts';
import { extract, match } from '../factledger/index.ts';

export type Mark = Span & { tone: 'kept' | 'missing' | 'added'; label: string };
export interface TextPiece { text: string; tone: Mark['tone'] | null; label: string }
/** Preserve every UTF-16 code unit; marks affect presentation only, never stored/exported output. */
export function textPieces(text: string, marks: readonly Mark[]): TextPiece[] {
  const boundaries = [...new Set([0, text.length, ...marks.flatMap((m) => [Math.max(0, m.start), Math.min(text.length, m.end)])])]
    .filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1];
    const mark = marks.find((m) => m.start <= start && m.end >= end);
    return { text: text.slice(start, end), tone: mark?.tone ?? null, label: mark?.label ?? '' };
  });
}
export function factMarks(run: Run, attempt: Attempt): { source: Mark[]; rewrite: Mark[] } {
  if (!run.ledger || !run.referenceTime || attempt.outputText === null) return { source: [], rewrite: [] };
  const ledger = extract(attempt.outputText, { referenceTime: new Date(run.referenceTime),
    protectedTerms: run.protectedTerms, aliases: run.aliases, contextText: run.sourceText });
  const found = match(run.ledger, ledger, attempt.outputText, run.sourceText);
  const mark = (fact: Fact, tone: Mark['tone']): Mark => ({ start: fact.start, end: fact.end, tone,
    label: `${tone}: ${fact.kind} ${fact.id} — ${fact.normalised}` });
  return { source: [...found.missing.map(({ fact }) => mark(fact, 'missing')), ...found.kept.map(({ source }) => mark(source, 'kept'))],
    rewrite: [...found.added.map(({ fact }) => mark(fact, 'added')), ...found.kept.map(({ rewrite }) => mark(rewrite, 'kept'))] };
}
/** One canonical term per line: term = alias one | alias two. Never parse HTML or fetch input URLs. */
export function parseAliases(text: string): { aliases: Record<string, string[]>; error: string | null } {
  const aliases: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const split = line.indexOf('=');
    if (split < 1) return { aliases, error: `Alias line ${i + 1}: use canonical term = alias | alias.` };
    const key = line.slice(0, split).trim();
    const values = line.slice(split + 1).split('|').map((x) => x.trim()).filter(Boolean);
    if (!key || !values.length) return { aliases, error: `Alias line ${i + 1} needs a term and at least one alias.` };
    if (Object.hasOwn(aliases, key)) return { aliases, error: `Alias line ${i + 1}: duplicate canonical term.` };
    aliases[key] = values;
  }
  return { aliases, error: null };
}
export function evidenceKey(run: Run, attempt: Attempt): string {
  return `${run.id}:${attempt.id}:${attempt.contentHash ?? 'none'}:${run.evidenceVersion}`;
}
export const readable = (value: string): string => value.replaceAll('_', ' ');
