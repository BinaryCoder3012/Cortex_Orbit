/**
 * Splits text into passages of roughly `target` characters on paragraph
 * boundaries, falling back to sentence boundaries for long paragraphs.
 * Passages are what citations point at, so they should read as whole thoughts.
 */
export function chunkText(text: string, target = 900): string[] {
  const paras = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0);

  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= target * 1.4) {
      pieces.push(p);
      continue;
    }
    let buf = '';
    for (const s of p.split(/(?<=[.?!])\s+/)) {
      if (buf && buf.length + s.length > target) {
        pieces.push(buf);
        buf = '';
      }
      buf = buf ? `${buf} ${s}` : s;
    }
    if (buf) pieces.push(buf);
  }

  // merge short neighbours (headings, one-liners) into the passage that follows
  const out: string[] = [];
  let carry = '';
  for (const piece of pieces) {
    const joined = carry ? `${carry}\n${piece}` : piece;
    if (joined.length < target * 0.35) {
      carry = joined;
      continue;
    }
    if (out.length && joined.length < target * 0.5 && out[out.length - 1].length + joined.length < target * 1.4) {
      out[out.length - 1] += `\n\n${joined}`;
    } else {
      out.push(joined);
    }
    carry = '';
  }
  if (carry) {
    if (out.length) out[out.length - 1] += `\n\n${carry}`;
    else out.push(carry);
  }
  return out;
}

/** Splits a long document into windows for extraction calls, on chunk boundaries. */
export function windows(chunks: string[], maxChars = 120_000): string[] {
  const out: string[] = [];
  let buf = '';
  for (const c of chunks) {
    if (buf && buf.length + c.length > maxChars) {
      out.push(buf);
      buf = '';
    }
    buf = buf ? `${buf}\n\n${c}` : c;
  }
  if (buf) out.push(buf);
  return out;
}
