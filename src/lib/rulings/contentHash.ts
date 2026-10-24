// Content hash of an attempt's exact restored text (sha256 hex of its UTF-8 bytes). Rulings and export are bound to it.

import { sha256Hex } from '../text/hash.ts';

export async function contentHash(text: string): Promise<string> {
  return sha256Hex(text);
}
