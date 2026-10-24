// Mock providers (spec item 13, PLAN section 7 / conflict 9.22). Two implementations of one Rewriter interface:
// - ScriptedRewriter: reads a scripts table (fixtures/mock/scripts.json shape) keyed (system, source_id, voice_id,
//   attempt, phase). Scripted outputs write placeholders as ⟦ns:Q1⟧; "ns" is replaced by the run's mask namespace.
// - RecordingsRewriter: hash-keyed recordings, key = sha256(model, versions, canonical {system,user,max_tokens}),
//   generated later by scripts/build-mock-recordings.ts.
// Both throw MockRecordingMissing on a miss (no generic fallback). MOCK_SOURCE selects one; it stays 'scripted' until
// recordings have been generated (deferred: `npm run recordings`, then set 'recordings').

import type { System } from '../../contracts/run.ts';
import { MASK_VERSION } from '../mask/namespace.ts';
import { PROMPT_VERSION } from '../prompts/version.ts';
import { sha256Hex } from '../text/hash.ts';
import type { ModelResponse, Phase, PromptMessages, RewriteCall, Rewriter, ScriptKey } from './types.ts';
import { ProviderError } from './types.ts';

export type MockSource = 'scripted' | 'recordings';
export const MOCK_SOURCE: MockSource = 'scripted';
export const MOCK_MODEL = 'mock-scripted';
/** Placeholder namespace marker used in scripted outputs. */
export const SCRIPT_NS_MARK = '⟦ns:';

export class MockRecordingMissing extends Error {
  readonly key: string;

  constructor(key: string, detail = '') {
    super(`MockRecordingMissing: no mock output for ${key}${detail ? ` (${detail})` : ''}`);
    this.name = 'MockRecordingMissing';
    this.key = key;
  }
}

/** One scripted model output; exactly one of output (JSON value, serialised), raw (verbatim text) or error. */
export interface ScriptEntry {
  system: System;
  source_id: string;
  voice_id: string;
  attempt: number;
  phase: Phase;
  output?: unknown;
  raw?: string;
  error?: string;
  note?: string;
}

export interface ScriptsTable {
  version: 1;
  entries: ScriptEntry[];
}

export function scriptKeyString(k: Pick<ScriptKey, 'system' | 'sourceId' | 'voiceId' | 'attempt' | 'phase'>): string {
  return `${k.system}|${k.sourceId}|${k.voiceId}|${k.attempt}|${k.phase}`;
}

const entryKey = (e: ScriptEntry): string =>
  scriptKeyString({ system: e.system, sourceId: e.source_id, voiceId: e.voice_id, attempt: e.attempt, phase: e.phase });

function mockResponse(text: string, model: string): ModelResponse {
  return { text, provider: 'mock', model, inputTokens: null, outputTokens: null };
}

function outputText(entry: { output?: unknown; raw?: string }): string {
  const text = entry.raw ?? JSON.stringify(entry.output);
  if (typeof text !== 'string') throw new Error('mock entry must contain JSON output or raw text');
  return text;
}

export class ScriptedRewriter implements Rewriter {
  readonly name = 'mock:scripted';
  private readonly entries: Map<string, ScriptEntry>;

  constructor(table: ScriptsTable | readonly ScriptEntry[]) {
    if (!Array.isArray(table) && (table as ScriptsTable).version !== 1) throw new Error('unsupported scripts version');
    const list = Array.isArray(table) ? table : (table as ScriptsTable).entries;
    this.entries = new Map();
    for (const e of list as readonly ScriptEntry[]) {
      if ([e.output !== undefined, e.raw !== undefined, e.error !== undefined].filter(Boolean).length !== 1) {
        throw new Error('scripted entry must have exactly one of output, raw or error');
      }
      const key = entryKey(e);
      if (this.entries.has(key)) throw new Error(`duplicate scripted mock entry ${key}`);
      this.entries.set(key, e);
    }
  }

  has(key: ScriptKey): boolean {
    return this.entries.has(scriptKeyString(key));
  }

  async call(req: RewriteCall): Promise<ModelResponse> {
    const key = scriptKeyString(req.key);
    const entry = this.entries.get(key);
    if (!entry) throw new MockRecordingMissing(key, 'scripted table');
    if (entry.error !== undefined) throw new ProviderError('scripted_error', entry.error);
    let text = outputText(entry);
    if (req.namespace !== null) text = text.split(SCRIPT_NS_MARK).join(`⟦${req.namespace}:`);
    return mockResponse(text, MOCK_MODEL);
  }
}

export interface RecordingEntry {
  model: string;
  output?: unknown;
  raw?: string;
}

export interface RecordingsFile {
  version: 1;
  prompt_version: string;
  mask_version: string;
  recordings: Record<string, RecordingEntry>;
}

/** Stable property order; token limits affect the request and therefore the recording identity. */
export async function recordingKey(model: string, messages: PromptMessages, maxTokens?: number): Promise<string> {
  return sha256Hex(JSON.stringify([model, PROMPT_VERSION, MASK_VERSION, {
    system: messages.system, user: messages.user, max_tokens: maxTokens ?? null,
  }]));
}

export class RecordingsRewriter implements Rewriter {
  readonly name = 'mock:recordings';
  private readonly file: RecordingsFile;

  constructor(file: RecordingsFile) {
    this.file = file;
  }

  async call(req: RewriteCall): Promise<ModelResponse> {
    const key = await recordingKey(req.model, req.messages, req.maxTokens);
    if (this.file.version !== 1 || this.file.prompt_version !== PROMPT_VERSION || this.file.mask_version !== MASK_VERSION) {
      throw new MockRecordingMissing(key, 'stale recording versions; run `npm run recordings`');
    }
    const entry = Object.hasOwn(this.file.recordings, key) ? this.file.recordings[key] : undefined;
    if (!entry) throw new MockRecordingMissing(key, `${scriptKeyString(req.key)}; missing or stale recording, run \`npm run recordings\``);
    if (entry.model !== req.model) throw new MockRecordingMissing(key, 'recording model does not match request');
    return mockResponse(outputText(entry), entry.model);
  }
}

export interface MockInputs {
  scripts?: ScriptsTable | readonly ScriptEntry[];
  recordings?: RecordingsFile;
}

/** The mock Rewriter selected by MOCK_SOURCE (or an explicit source, for tests). */
export function createMockRewriter(inputs: MockInputs, source: MockSource = MOCK_SOURCE): Rewriter {
  if (source === 'recordings') {
    if (!inputs.recordings) throw new MockRecordingMissing('recordings.json', 'no recordings file loaded');
    return new RecordingsRewriter(inputs.recordings);
  }
  if (!inputs.scripts) throw new MockRecordingMissing('scripts.json', 'no scripts table loaded');
  return new ScriptedRewriter(inputs.scripts);
}
