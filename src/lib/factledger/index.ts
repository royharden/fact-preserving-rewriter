export type { Candidate, ExtractOptions, Fact, FactKind, Span, Toggle } from './types.ts';
export { KIND_PREFIX, KIND_PRECEDENCE } from './types.ts';
export { extract, unknownToggleIds } from './extract.ts';
export { match } from './match.ts';
export type { AddedFact, KeptFact, MatchResult, MissingFact } from './match.ts';
export { canonicalDecimal, factKey, halveDecimal, normaliseEntityText, shiftDecimal } from './normalise.ts';
export { bareHalfSpans } from './numbers.ts';
export { normaliseDate } from './dates.ts';
export type { DateComponent, DateComponents } from './dates.ts';
