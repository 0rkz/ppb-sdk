export { Publisher } from './publisher';
export { Subscriber } from './subscriber';
export { Mercat } from './mercat';
export { ByteClient, type ByteConfig, type NetworkConfig } from './client';
export { ARBITRUM_SEPOLIA, ARBITRUM_ONE, LOCAL_ANVIL } from './networks';
export { verifyPayload, verifyEventPayload, fetchAndVerify, HashMismatchError } from './verify';

// ─── Trust Kit — verify-before-act provenance primitives (Phase 0) ───────────
// sign + verify (hash AND signer recovery) + read quality score. The shipped
// verifyPayload above is HASH-only; verifyAttestation/verify add the missing
// signer-recovery leg. The 'BYTE Library' EIP-712 domain is consensus-critical.
export {
  signAttestation,
  verifyAttestation,
  verify,
  verifyFromEvent,
  verifyFromGatewayResponse,
  attestationDomain,
  PAYLOAD_ATTESTATION_TYPES,
  type Verdict,
  type VerifyAttestationArgs,
  type VerifyInput,
  type PayloadAttestationStruct,
  type TypedDataSigner,
  type AttestedEvent,
  type GatewayByteAttestation,
} from './attestation';
export { getPQS, type PQS } from './pqs';
export {
  GatewayClient,
  GatewayError,
  type GatewayClientOptions,
  type GatewayCatalog,
  type GatewayFeed,
  type GatewayResources,
  type GatewayResource,
  type GatewayAccept,
  type GatewaySettlement,
  type GatewayFetchResult,
  type FetchFeedOptions,
} from './gateway';
export * from './types';
