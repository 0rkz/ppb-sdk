# Changelog

## 0.3.2 — 2026-08-25

### Fixed
- **`peerDependencies` claimed `@x402/core "^2.13.0"` / `@x402/evm "^2.13.0"` — false.** `shapeResult()`
  reads `result.paymentStatus`, a field that only exists from `@x402/core@2.15.0` onward; 2.13.0 and
  2.14.0 return a `{kind: ...}` union instead, so a paid 200 under a real 2.13.x/2.14.x install throws
  `GatewayError` (the exact bug the 0.3.1 rewrite was meant to fix, just moved one version range over).
  Both peer floors are now `^2.15.0` — `@x402/evm` matched to `@x402/core` because each `@x402/evm`
  release pins its own `@x402/core` dependency to `~<same-minor>`, so installing an older `@x402/evm`
  pulls a pre-2.15 `@x402/core` in at the top level too — an unmatched `@x402/evm` floor would silently
  reopen this same bug via its own dependency instead of the SDK's peer range. The install-hint string
  in the `loadX402()` error is updated to match.
- **`shapeResult()`: a `payment_required` `paymentStatus` on a 2xx no longer throws.** `@x402/core`'s
  `parsePaymentResult` can land on `payment_required` even on an HTTP 200 when the decoded
  `X-PAYMENT-RESPONSE` header doesn't look like a `SettleResponse` (no `success` field) — an
  unrecognizable receipt, not an actual still-402. Now checked against the response status: a 2xx with
  an unrecognizable receipt is treated the same as a missing one (body returned, `settlement: null`);
  anything else — a real 402, or any other non-2xx status — still throws as before.
- **`shapeResult()`: a `settled` `paymentStatus` on a non-2xx status now throws instead of returning the
  error body as `data`.** Previously a 500 with a valid settlement receipt returned
  `{data: <error body>, settlement: {success: true, ...}}` — money moved, the request failed, and the
  caller had no signal. Now throws a `GatewayError` that carries the decoded settlement info, so a caller
  can tell "paid and failed" apart from "paid and succeeded" and pursue a refund/dispute instead of
  acting on an error body.
- **`discover()` (and the method-catalog fetch inside `fetchFeed`) had no timeout** — a hung
  `GET /feeds` could stall `fetchFeed` for the platform's full fetch timeout (~300s). Now aborts after
  3s (`AbortSignal.timeout`).
- **A failed catalog fetch was cached for the client's entire lifetime**, permanently pinning a
  long-lived client to the static `POST_ORACLES` fallback after one bad network blip. Failure is now
  cached for 60s only; the next `fetchFeed` after that retries the catalog fetch.
- Catalog `method[]` comparison was case-sensitive, so a catalog serving lowercase/mixed-case HTTP
  methods (e.g. `["get"]`) would fail to resolve `GET` and fall through to the `POST_ORACLES` fallback.
  Method strings are now uppercased on read; a malformed (non-string) entry in one feed's `method[]` is
  dropped rather than thrown on, so it can't take the whole catalog fetch down and TTL-cache a failure
  for every other feed too.

### Docs
- README: the headline `fetchFeed` example used `defi-yields`, which is 410 Gone on the live gateway.
  Switched to `weather`, and noted that `settlement` can be null on a genuinely paid call.

### Corrected
- The 0.3.1 entry above states `result.kind` "was never part of the `@x402/core@2.13+` client contract"
  — that's wrong. `@x402/core` 2.13.0 and 2.14.0 really do return `{kind: 'success' | 'settle_failed' |
  'payment_required' | 'error' | 'passthrough', ...}` from `processResponse()`; `kind` was a real field
  there. The contract changed to `{status, paymentStatus, body, header}` at 2.15.0 — that's the version
  the 0.3.1 rewrite actually needed and the peer floor never claimed. The rewrite itself was correct
  against 2.15.0+; the peer range just didn't say so (see Fixed, above). False comments making the same
  claim in `src/gateway.ts` and `src/gateway.test.ts` are corrected in this release.

## 0.3.1 — 2026-08-25

Two gateway client fixes, both reproduced against a live Base-mainnet paid call.

### Fixed
- **`fetchFeed` sent GET to POST-only feeds not on the hardcoded `POST_ORACLES` list**, getting
  back `405 method_not_allowed` (e.g. the `cctp-attestation-latency` verdict oracle, added to the
  live catalog after the list was last regenerated). Method resolution now checks, in order: an
  explicit `options.method`; the feed's `method[]` from the live `GET /feeds` catalog (fetched
  lazily and cached per client — one catalog call, not one per request); `POST_ORACLES` only as an
  offline fallback if the catalog fetch itself fails. `POST_ORACLES` is also regenerated against
  the current live catalog (drops two retired feeds, adds two that were missing).
- **`shapeResult` threw on a successful, paid, settled 200** — it switched on `result.kind`, a
  field that was never part of the `@x402/core@2.13+` client contract (that package returns
  `{status, paymentStatus, body, header}`), so every response fell through to a thrown
  `"gateway error <status>"`, including genuinely paid and delivered ones. Rewritten against the
  real contract: a settled payment returns `{data, settlement}` as before; a 2xx whose settlement
  receipt header is missing or undecodable now returns the body with `settlement: null` instead of
  throwing (this was the live-hit case: gateway logs confirmed the $0.01 USDC settlement, the SDK
  threw anyway); a still-402-after-paying or an on-chain settlement failure still throw
  `GatewayError`, now carrying the real response body and decoded payment header.

### Docs
- README: the POST-oracle example now notes that `fetchFeed` derives the method from the live
  catalog when you don't pass one, rather than implying a fixed feed list.

## 0.3.0 — 2026-08-02

### Added
- **Opt-in `requireFresh`**, threaded through `verifyFromEvent` and `verifyFromGatewayResponse`. Our
  own verifiers had disagreed on this: `@foreseal/gate` and DataStreamLib both enforce the EIP-712
  `deadline`, while this SDK computed "expired" but deliberately excluded it from `verified`.
  `requireFresh: true` gets a caller the strict rule at the point of action. The default is
  unchanged and byte-identical to 0.2.1, including every reason string. `maxAgeS` was considered but
  not built: the signed `PayloadAttestation` covers `(publisher, payloadHash, payloadLength,
  deadline)` with no issued-at, so absolute age isn't derivable from signed data — the deadline is
  the only expiry the signature actually covers.

## 0.2.1 — 2026-07-03

The published 0.2.0 npm package shipped with the stale hardcoded `POST_ORACLES` set
(`{fact-oracle, evidence-pack, usc-statute}`) — `address-reputation` and every other live verdict
oracle defaulted to GET and got back `405`. This release carries the already-merged fix (below,
folded into the 0.2.0 entry) to npm; no other code changes.

## 0.2.0 — 2026-07-03

Form-aware archive verification. The canonical-forms fix from OpenBB#7455 (the
MarkovianProtocol JCS thread), packaged for publish.

### Added
- **`CanonicalFormMismatchError`** — thrown by `fetchAndVerify` when a re-serialized
  `{payload}` envelope matches the attested hash under NO known canonical form (raw bytes,
  sorted-canonical, insertion-order). Deliberately NOT a `HashMismatchError`: once a payload
  is re-serialized, a hash mismatch can't distinguish tampering from a canonical-form
  difference, so this error alleges neither. Fail closed either way — fetch the exact
  delivered bytes and use byte-exact `verifyPayload`.

### Fixed
- `fetchAndVerify` no longer raises a false tamper alarm when the publish side used the
  frozen insertion-order form (first-party live feeds) rather than the SDK's sorted form. It
  now tries the raw response bytes and every known form and verifies on any keccak match.
- Archive fetch used `/payloads/<hash>` (plural); discovery-api serves `GET /payload/:hash`
  (singular). Singular is now tried first, plural kept as a fallback — the archive path was
  404-dead on every prod call before this.
- `POST_ORACLES` regenerated from the live post-cut catalog. The old set
  `{fact-oracle, evidence-pack, usc-statute}` named 2 cut feeds and missed 5 live POST
  oracles, so `fetchFeed` defaulted the live verdict oracles to GET (405). Now:
  `address-reputation, sanctions-screen, pkg-verdict, reasoning-verdict, positioning-snapshot,
  liquidation-stream, evidence-pack`. Dual GET-digest/POST-verdict feeds (`runtime-eol`,
  `threat-intel`) default to GET; pass `method: 'POST'` + body for their verdict.

### Docs
- README: new "Canonical payload bytes — two forms" section; the false "one canonical
  definition / cross-SDK parity" framing is gone. Byte-exact `verifyPayload` is documented as
  the primary, strongest verify path.

Note: 0.1.9 was the PayPerByte rebrand publish and carries none of the above.
