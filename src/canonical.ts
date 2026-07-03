/**
 * Canonical JSON serialization — the SDK's definition of canonical bytes for
 * keccak256 hashing, used by the SDK publish path (publisher.ts/publisher.py)
 * and the SDK verify-side envelope re-wrap, in BOTH the TypeScript and the
 * Python SDK. The publish-side hash and the verify-side hash MUST agree byte for
 * byte, or a logically-identical payload would produce two different keccak256
 * digests and the verifier would raise a false HashMismatchError.
 *
 * ⚠️ THIS IS NOT THE ONLY CANONICAL FORM IN THE STACK. The first-party live
 * feeds (data-feeds/<feed>/server.py) sign INSERTION-ORDER compact JSON — a frozen
 * hash-compatibility surface that must never be re-sorted. A payload signed
 * there will NOT hash-match this sorted form. fetchAndVerify is form-aware
 * (tries both + raw bytes) and throws CanonicalFormMismatchError rather than a
 * false tamper alarm when re-serialization can't reproduce the attested bytes.
 * See ops/plans/TICKET_CANONICAL_FORMS_2026-07-03.md.
 *
 * Canonical form = UTF-8 of JSON with recursively lexicographically-sorted
 * object keys and no insignificant whitespace (separators ',' and ':'). This is
 * NOT full RFC-8785/JCS: floats are emitted in each language's default repr (JS
 * Number vs Python float may differ for some values), and very large integers /
 * NaN / Infinity / -0 are out of scope. Keep payload values to strings, bools,
 * and integers that round-trip identically in JS and Python, or pre-stringify
 * floats, to guarantee keccak256 parity across SDKs. Array element order is
 * significant and preserved; only object keys are sorted.
 *
 * Parity note vs the Python helper (byte/canonical.py): Python uses
 * json.dumps(..., sort_keys=True, separators=(',',':'), ensure_ascii=False).
 * `ensure_ascii=False` makes Python emit non-ASCII characters as raw UTF-8
 * bytes, matching JS TextEncoder (which never \uXXXX-escapes). Keys are sorted
 * by Unicode code-unit order on both sides — String.prototype.sort() (JS) and
 * Python str comparison agree for the BMP, which covers all typical JSON keys.
 */

/**
 * Recursively rebuild a value with every object's keys sorted in ascending
 * lexicographic (code-unit) order. Arrays keep their element order. Primitives
 * pass through untouched.
 *
 * JSON.stringify does NOT sort keys on its own — it preserves the insertion
 * order of a plain object's own enumerable keys. So we rebuild each object with
 * keys inserted in sorted order, then JSON.stringify emits them sorted.
 */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep); // arrays: order PRESERVED (never sorted)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v; // primitives untouched
}

/**
 * Canonical JSON string. JSON.stringify with no `space` argument already emits
 * the ',' and ':' separators with no insignificant whitespace.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/** Canonical UTF-8 bytes — the exact bytes fed into keccak256. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
