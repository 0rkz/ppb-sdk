/**
 * Cross-language parity vector producer (SHIP-GATE #1 for the Python signer-leg
 * port, w2b-t1). Produces REAL viem-signed X-BYTE-Attestation receipts and runs
 * the ACTUAL TS `verifyFromGatewayResponse` over the full attack matrix, then
 * emits each case's exact inputs + TS verdict as JSON. The Python test asserts
 * its own `verify_from_gateway_response` reproduces these verdicts field-for-field
 * — proving the EIP-712 digest (viem ⇄ eth_account) is byte-identical.
 *
 *   node scripts/produce-parity-vector.cjs   # writes ../python/tests/parity_vector.json
 *
 * Deterministic: fixed NOW + fixed test keys → byte-stable vector.
 *
 * Per-case shape:
 *   { name, body, body_encoding: "utf8"|"hex", header_input: <json-string|null|garbage>,
 *     net_chain_id, expected_attester, ts_verdict }
 */
const fs = require("fs");
const path = require("path");
const { keccak256, toHex } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const attMod = require("../dist/attestation.js");
const { ARBITRUM_SEPOLIA } = require("../dist/networks.js");

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(KEY);
const ATTESTER = account.address;
const WRONG_ATTESTER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
).address;

const NOW = 1750000000n;
const CHAIN1 = { ...ARBITRUM_SEPOLIA, chainId: 1 };

// Hash a body exactly as viem's toBytesHex does: a 0x-string is the hex bytes it
// encodes; anything else is its UTF-8 encoding.
function payloadHashOf(body, encoding) {
  const hex = encoding === "hex" ? body : toHex(new TextEncoder().encode(body));
  return keccak256(hex);
}
function byteLenOf(body, encoding) {
  return encoding === "hex" ? (body.length - 2) / 2 : new TextEncoder().encode(body).length;
}

async function signReceipt(body, encoding, deadline) {
  const payloadHash = payloadHashOf(body, encoding);
  const payloadLength = byteLenOf(body, encoding);
  const signature = await attMod.signAttestation(
    { publisher: ATTESTER, payloadHash, payloadLength: BigInt(payloadLength), deadline: BigInt(deadline) },
    account,
    ARBITRUM_SEPOLIA,
  );
  return {
    alg: "EIP712-PayloadAttestation",
    domain: attMod.attestationDomain(ARBITRUM_SEPOLIA),
    publisher: ATTESTER,
    payloadHash,
    payloadLength,
    deadline,
    signature,
  };
}

function v(verdict) {
  return {
    verified: verdict.verified, hashMatch: verdict.hashMatch, signerMatch: verdict.signerMatch,
    recovered: verdict.recovered, expired: verdict.expired, reason: verdict.reason,
  };
}

async function main() {
  const JSON_BODY = '{"asset":"BTC","price":64000,"sanctioned":true}';
  const HEX_BODY = "0xdeadbeefcafe0001"; // a valid 0x-hex body
  const fresh = await signReceipt(JSON_BODY, "utf8", Number(NOW) + 300);
  const stale = await signReceipt(JSON_BODY, "utf8", Number(NOW) - 10);
  const hexRcpt = await signReceipt(HEX_BODY, "hex", Number(NOW) + 300);

  const cases = [];
  const run = async (name, body, body_encoding, headerInput, net, attester) => {
    const headerArg = headerInput === "__NULL__" ? null : headerInput;
    const tv = v(await attMod.verifyFromGatewayResponse(body, headerArg, net, attester, NOW));
    cases.push({
      name, body, body_encoding,
      header_input: headerInput, // a JSON string | "__NULL__" | "not json{"
      net_chain_id: net.chainId,
      expected_attester: attester ?? null,
      ts_verdict: tv,
    });
  };

  const freshStr = JSON.stringify(fresh);
  // ── original matrix ──
  await run("genuine", JSON_BODY, "utf8", freshStr, ARBITRUM_SEPOLIA, ATTESTER);
  await run("tampered_body", JSON_BODY.replace("64000", "99999"), "utf8", freshStr, ARBITRUM_SEPOLIA, ATTESTER);
  await run("wrong_attester", JSON_BODY, "utf8", freshStr, ARBITRUM_SEPOLIA, WRONG_ATTESTER);
  await run("no_attester", JSON_BODY, "utf8", freshStr, ARBITRUM_SEPOLIA, undefined);
  await run("missing_header", JSON_BODY, "utf8", "__NULL__", ARBITRUM_SEPOLIA, ATTESTER);
  await run("malformed_header", JSON_BODY, "utf8", "not json{", ARBITRUM_SEPOLIA, ATTESTER);
  await run("rewritten_domain_chainid1", JSON_BODY, "utf8", freshStr, CHAIN1, ATTESTER);
  await run("genuine_expired", JSON_BODY, "utf8", JSON.stringify(stale), ARBITRUM_SEPOLIA, ATTESTER);

  // ── new: validate the review fixes + coverage ──
  // #1 valid 0x-hex body passed as a string → viem hex path; Python must match.
  await run("hex_body_valid", HEX_BODY, "hex", JSON.stringify(hexRcpt), ARBITRUM_SEPOLIA, ATTESTER);
  // #2 malformed-length payloadHash → both reject (signer_match false, recovered null).
  await run("payloadhash_16byte", JSON_BODY, "utf8",
    JSON.stringify({ ...fresh, payloadHash: "0x" + "ab".repeat(16) }), ARBITRUM_SEPOLIA, ATTESTER);
  await run("payloadhash_empty", JSON_BODY, "utf8",
    JSON.stringify({ ...fresh, payloadHash: "0x" }), ARBITRUM_SEPOLIA, ATTESTER);
  // coverage: header.domain is IGNORED (verifier uses `net`, not the header) → genuine verdict.
  await run("header_domain_mismatch", JSON_BODY, "utf8",
    JSON.stringify({ ...fresh, domain: { name: "EVIL", version: "9", chainId: 99999, verifyingContract: "0x" + "de".repeat(20) } }),
    ARBITRUM_SEPOLIA, ATTESTER);
  // coverage: payloadLength/deadline as JSON STRINGS → coerced → genuine verdict.
  await run("string_numerics", JSON_BODY, "utf8",
    JSON.stringify({ ...fresh, payloadLength: String(fresh.payloadLength), deadline: String(fresh.deadline) }),
    ARBITRUM_SEPOLIA, ATTESTER);

  const out = {
    meta: {
      note: "Cross-language EIP-712 parity vector. TS (viem) produced; Python (eth_account) must reproduce ts_verdict field-for-field on the decision fields.",
      now_seconds: Number(NOW), attester: ATTESTER, wrong_attester: WRONG_ATTESTER,
      data_stream: ARBITRUM_SEPOLIA.contracts.dataStream, chain_id: ARBITRUM_SEPOLIA.chainId,
    },
    cases,
  };
  const dest = path.resolve(__dirname, "../../python/tests/parity_vector.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", dest, `(${cases.length} cases)`);
  for (const c of cases) {
    const t = c.ts_verdict;
    console.log(`  ${c.name.padEnd(26)} verified=${t.verified} hash=${t.hashMatch} signer=${t.signerMatch} recovered=${t.recovered ? t.recovered.slice(0, 10) : "null"} expired=${t.expired}`);
  }
}

main().catch((e) => { console.error("producer failed:", e); process.exit(1); });
