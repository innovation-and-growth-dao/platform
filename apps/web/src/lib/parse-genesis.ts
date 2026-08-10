/**
 * Tolerant parse for hand-edited genesis files. Strict JSON first; on failure,
 * strips // and /* *\/ comments and trailing commas (the #1 hand-editing
 * mistake) and retries; otherwise throws a friendly, actionable message rather
 * than the browser's cryptic "Unexpected token …".
 */
export function parseGenesisFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to lenient */
  }
  try {
    return JSON.parse(stripJsonc(text));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      "This file isn't valid JSON. Common causes: a trailing comma after the last entry, " +
        'a missing comma between entries, single quotes instead of "double" quotes, or a missing bracket. ' +
        `(${detail})`,
    );
  }
}

/** Remove JS-style comments and trailing commas — string-aware (won't touch text inside "quotes"). */
function stripJsonc(src: string): string {
  let out = '';
  let inStr = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '}' || c === ']') {
      // drop a trailing comma sitting before this closer (across whitespace)
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      if (j >= 0 && out[j] === ',') out = out.slice(0, j) + out.slice(j + 1);
    }
    out += c;
    i++;
  }
  return out;
}
