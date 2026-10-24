// Delimited data blocks for user messages. Untrusted text (source, samples, drafts) only ever appears inside a block;
// the tag gets a suffix until neither its opening nor closing form occurs in the body, so the body cannot close it.

export function blockTag(label: string, body: string): string {
  let tag = label;
  for (let n = 2; body.includes(`<${tag}`) || body.includes(`</${tag}`); n++) tag = `${label}_${n}`;
  return tag;
}

export function block(label: string, body: string, attrs = ''): string {
  const tag = blockTag(label, body);
  return `<${tag}${attrs ? ` ${attrs}` : ''}>\n${body}\n</${tag}>`;
}
