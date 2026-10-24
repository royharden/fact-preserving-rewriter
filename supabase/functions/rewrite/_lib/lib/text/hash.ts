// GENERATED from src/lib/text/hash.ts; edit the source and run npm run sync:functions.
// SHA-256 hex digest via WebCrypto (browser, Node >= 20 and Deno all expose globalThis.crypto.subtle). Async by design.

export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto (globalThis.crypto.subtle) is not available');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}
