/**
 * Trust Kit — getPQS(): read a publisher's Publisher-Quality Score from the
 * BYTE Library indexer REST.
 *
 * PQS is the indexer's off-chain 24h-batch DELIVERY-QUALITY composite — dispute
 * 40% / retention 25% / freshness 15% / revenue-quality 20%, expressed in basis
 * points (0-10000). It is a REPUTATION SIGNAL, not the verification gate: the
 * payment-gating "verify-before-act" check is the hash + signer recovery in
 * `attestation.ts`, NOT this score. PQS is advisory, off-chain, and may be
 * absent (a publisher the indexer has not yet scored).
 *
 * Grounded against indexer/src/api.rs (`GET /publisher/{address}/pqs`) and
 * indexer/src/types.rs `PQSRecord` (serialized with raw snake_case field names,
 * no serde rename). A 404 from the endpoint means "not yet scored".
 */

import type { Hex } from 'viem';

/**
 * A publisher's quality score. All sub-scores and the composite are in basis
 * points (0-10000); `composite` is `null` when the publisher has not been scored.
 */
export interface PQS {
  /** Composite PQS in BPS (0-10000), or null = not yet scored. */
  composite: number | null;
  /** Dispute sub-score (40% weight), BPS. */
  dispute?: number;
  /** Retention sub-score (25% weight), BPS. */
  retention?: number;
  /** Freshness sub-score (15% weight), BPS. */
  freshness?: number;
  /** Revenue-quality sub-score (20% weight), BPS. */
  revenueQuality?: number;
  /** ISO timestamp the score was computed (from `computed_at`). */
  asOf?: string;
}

/** The raw indexer PQSRecord JSON (snake_case, BPS ints). */
interface PQSRecordJson {
  publisher: string;
  dispute_score: number;
  retention_score: number;
  freshness_score: number;
  revenue_quality: number;
  composite: number;
  computed_at: string;
}

/**
 * Fetch a publisher's PQS from the indexer.
 *
 *   GET {indexerUrl}/publisher/{address}/pqs
 *
 * Returns `{ composite: null }` for an unscored publisher (the indexer answers
 * 404). Throws on transport/server errors (network failure, 5xx) so callers can
 * distinguish "scored: not yet" from "could not reach the indexer".
 *
 * @param publisher   on-chain publisher address.
 * @param indexerUrl  indexer base URL (e.g. NetworkConfig.indexerUrl).
 * @param timeoutMs   request timeout (default 5s).
 */
export async function getPQS(
  publisher: Hex | string,
  indexerUrl: string,
  timeoutMs = 5_000,
): Promise<PQS> {
  if (!indexerUrl) {
    throw new Error('getPQS: indexerUrl is empty — pass NetworkConfig.indexerUrl or an explicit URL.');
  }
  const addr = String(publisher).toLowerCase();
  const url = `${indexerUrl.replace(/\/$/, '')}/publisher/${addr}/pqs`;

  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

  // Not-yet-scored: the endpoint returns 404 when there is no pqs_scores row.
  if (res.status === 404) {
    return { composite: null };
  }
  if (!res.ok) {
    throw new Error(`getPQS: indexer ${res.status} ${res.statusText} for ${url}`);
  }

  const rec = (await res.json()) as PQSRecordJson;
  return {
    composite: typeof rec.composite === 'number' ? rec.composite : null,
    dispute: rec.dispute_score,
    retention: rec.retention_score,
    freshness: rec.freshness_score,
    revenueQuality: rec.revenue_quality,
    asOf: rec.computed_at,
  };
}
