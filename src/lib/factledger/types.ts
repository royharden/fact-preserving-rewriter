// Fact ledger types (PLAN section 3). Offsets are half-open UTF-16 code-unit indices: text.slice(start, end) === raw.

export type FactKind = 'number' | 'date' | 'entity' | 'quote' | 'verbatim';

export interface Fact {
  /** Kind prefix + 1-based index in document order per kind: N1, D1, E1, Q1, V1. */
  id: string;
  kind: FactKind;
  raw: string;
  /** Canonical comparison value, also shown in the ledger UI (e.g. "currency 1200000 USD", "day 2026-10-24"). */
  normalised: string;
  start: number;
  end: number;
  /** false only when toggled 'ignored'; ignored facts are exempt from the presence check, never from "added". */
  required: boolean;
}

export type Toggle = 'required' | 'ignored';

export interface ExtractOptions {
  /** Fixed reference instant for date recognition (the run's frozen reference_time, never the wall clock). */
  referenceTime: Date;
  /** Fact id -> toggle. Ids not present default to required. */
  toggles?: Readonly<Record<string, Toggle>>;
  /** User protected terms; every whole-token occurrence is an entity, whatever its case or position. */
  protectedTerms?: readonly string[];
  /** Canonical term -> explicit aliases; an alias occurrence normalises to its canonical term. */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /**
   * Extra text (normally the source, when extracting a rewrite) whose mid-sentence capitalised words also license a
   * sentence-initial word as an entity.
   */
  contextText?: string;
}

export interface Span {
  start: number;
  end: number;
}

/** A recognised span before ids are assigned. */
export interface Candidate extends Span {
  kind: FactKind;
  normalised: string;
}

export const KIND_PREFIX: Readonly<Record<FactKind, string>> = {
  number: 'N',
  date: 'D',
  entity: 'E',
  quote: 'Q',
  verbatim: 'V',
};

/** Span precedence, highest first. */
export const KIND_PRECEDENCE: readonly FactKind[] = ['verbatim', 'quote', 'date', 'number', 'entity'];
