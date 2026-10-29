import type { FactKind } from '../factledger/types.ts';
export interface GoldSpan { id: string; kind: FactKind; raw: string; start: number; end: number; required: boolean }
export type MutationType = 'number' | 'unit' | 'date' | 'entity' | 'quote_word' | 'negation' | 'modal' | 'quantifier' | 'sentence_drop' | 'claim_insertion';
export interface Edit { start: number; end: number; replacement: string }
export interface Mutation { type: MutationType; seed: number; text: string; location: { start: number; end: number }; before: string; after: string }
export interface MutationResult { mutation: Mutation | null; rejected: string | null }
