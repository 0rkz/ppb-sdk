# Changelog

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
