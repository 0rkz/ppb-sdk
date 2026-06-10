/**
 * BYTE Library — keyless x402 gateway client.
 *
 * Mirrors the REAL gateway at x402-gateway/src/index.ts. A WALLET signs the
 * payment (EIP-3009 transferWithAuthorization — gasless; the facilitator
 * broadcasts and pays gas). There is NO API key anywhere: the wallet IS the
 * credential. Discovery is free (GET /feeds, GET /.well-known/x402.json); paid
 * routes answer HTTP 402 with PaymentRequirements, the client signs, and retries.
 *
 * The 402 flow composes the documented @x402 v2 primitives exactly as the
 * reference client does (x402-gateway/examples/agent-client/ts/pay-and-fetch.ts):
 * there is NO `wrapFetchWithPayment` in the v2 SDK — we build
 *   registerExactEvmScheme(new x402Client(), { signer }) -> x402HTTPClient(core)
 * and drive an unpaid -> 402 -> sign -> retry loop.
 *
 * BOUNDARY: this x402 USDC payment leg is INDEPENDENT of the on-chain
 * direct-allowance approve step that Subscriber performs (usdc.approve(
 * dataStream, cap) — see subscriber.ts). Those are two distinct USDC flows. In
 * particular, the `fact-oracle` POST requires `subscriber_address` to ALREADY
 * be a registered, allowance-granting subscriber on-chain (a prior
 * Subscriber.subscribe), because the answer is broadcast on-chain to that
 * address and its per-message fee is transferFrom-pulled from the subscriber's
 * DataStream allowance — paying the x402 leg alone is not sufficient for oracle
 * delivery.
 *
 * DEPENDENCIES (peer / OPTIONAL — the heavy @x402 stack is NOT pulled into the
 * core SDK; it is loaded lazily at call time so an SDK consumer who never
 * touches the gateway never needs it installed):
 *   '@x402/core'  ^2.13.0   (x402Client, x402HTTPClient)
 *   '@x402/evm'   ^2.13.0   (registerExactEvmScheme, toClientEvmSigner)
 *   'viem'        ^2.21.0   (the account/signer + public client)
 */

/**
 * The signer the gateway client pays with. Either a viem account/signer that
 * exposes { address, signTypedData } (you typically get this from
 * privateKeyToAccount), optionally paired with a viem publicClient so the
 * exact-EVM scheme can do on-chain nonce/allowance reads when needed.
 */
export interface GatewayClientOptions {
  /** Gateway base URL. Defaults to prod 'https://x402.payperbyte.io'.
   *  For local dev pass 'http://127.0.0.1:3402' (gateway config.ts port 3402). */
  baseUrl?: string;
  /** viem account/signer (address + signTypedData). The wallet that signs the
   *  EIP-3009 payment authorization. NO API key. */
  signer: any;
  /** Optional viem PublicClient, wrapped via toClientEvmSigner so the scheme can
   *  read on-chain nonce/allowance. Optional for the gasless "exact" USDC path. */
  publicClient?: any;
}

/** One feed entry from GET /feeds (mirrors FeedMetadata in the gateway config). */
export interface GatewayFeed {
  id: string;
  name: string;
  description: string;
  /** Human-readable price, e.g. "$0.022". */
  price: string;
  /** Atomic 6-decimal USDC price string — the SDK READS this; it never recomputes. */
  priceAtomic: string;
  expectedSizeBytes: number;
  provenance: 'eip712-attested' | 'first-party';
  updateFrequency: string;
  /** Endpoint path, e.g. '/feeds/weather'. */
  endpoint: string;
  disclaimerCategory: string;
  /** On-chain publisher address — present on publisher-backed feeds only. */
  publisher?: `0x${string}`;
}

/** The parsed GET /feeds catalog. */
export interface GatewayCatalog {
  protocol: string;
  version: string;
  networks: string[];
  facilitator: string;
  /** USDC asset address advertised by the gateway. */
  asset: `0x${string}`;
  pricing: {
    model: string;
    pricePerKB: string;
    floor: string;
    note: string;
  };
  disclaimers: {
    header: string;
    note: string;
    text: Record<string, string>;
  };
  feeds: GatewayFeed[];
}

/** One x402 payment option the signer can pay against (from a 402 / resources). */
export interface GatewayAccept {
  scheme: string;
  /** CAIP-2 network, e.g. 'eip155:421614'. Read from the 402 — never hardcoded. */
  network: string;
  payTo: `0x${string}`;
  price: {
    asset: `0x${string}`;
    amount: string;
    extra?: { name?: string; version?: string };
  };
  [k: string]: unknown;
}

/** One resource from GET /.well-known/x402.json. */
export interface GatewayResource {
  resource: string;
  method: 'GET' | 'POST';
  name: string;
  description: string;
  category: string;
  price: string;
  /** Per-resource payment options, so the caller gets accepts[] without a 402 probe. */
  accepts: GatewayAccept[];
  metadata: { expectedSizeBytes: number; updateFrequency: string };
}

/** The parsed GET /.well-known/x402.json manifest. */
export interface GatewayResources {
  x402Version: number;
  name: string;
  facilitator: string;
  catalog: string;
  resources: GatewayResource[];
  [k: string]: unknown;
}

/** Settlement receipt decoded from a paid response. */
export interface GatewaySettlement {
  success: boolean;
  payer?: `0x${string}`;
  /** On-chain settlement transaction hash. */
  transaction?: string;
}

/** Result of fetchFeed(). */
export interface GatewayFetchResult<T = unknown> {
  /** Parsed response body. */
  data: T;
  /** Settlement receipt, or null for free / already-paid / passthrough routes. */
  settlement: GatewaySettlement | null;
  /** From the X-BYTE-Disclaimer-Category response header. */
  disclaimerCategory?: string;
}

/** Options for fetchFeed(). */
export interface FetchFeedOptions {
  /** HTTP method. Defaults to GET; POST_ORACLES feeds require POST. */
  method?: 'GET' | 'POST';
  /** JSON body for POST feeds (e.g. fact-oracle:
   *  { question, subscriber_address, max_byte_cost? }). */
  body?: unknown;
}

const DEFAULT_BASE_URL = 'https://x402.payperbyte.io';
const DISCLAIMER_HEADER = 'X-BYTE-Disclaimer-Category';

/**
 * Feeds the gateway serves over POST with a JSON body (mirrors POST_ORACLES in
 * x402-gateway/src/index.ts). fact-oracle's body is
 * { question, subscriber_address (0x, REQUIRED — must already be a registered,
 * allowance-granting on-chain subscriber), max_byte_cost?: number (default 2000) }.
 */
const POST_ORACLES = new Set(['fact-oracle', 'evidence-pack', 'usc-statute']);

/** Load the optional @x402 peer deps lazily. Built from variables so the core
 *  SDK build does not statically require the heavy x402 stack. */
async function loadX402(): Promise<{
  x402Client: any;
  x402HTTPClient: any;
  registerExactEvmScheme: any;
  toClientEvmSigner: any;
}> {
  // Specifiers held in variables so `tsc` / bundlers don't hard-resolve them at
  // build time — these are OPTIONAL peer deps installed only by gateway users.
  const coreClientPkg = '@x402/core/client';
  const evmExactPkg = '@x402/evm/exact/client';
  const evmPkg = '@x402/evm';
  try {
    const [core, evmExact, evm] = await Promise.all([
      import(/* @vite-ignore */ coreClientPkg),
      import(/* @vite-ignore */ evmExactPkg),
      import(/* @vite-ignore */ evmPkg),
    ]);
    return {
      x402Client: core.x402Client,
      x402HTTPClient: core.x402HTTPClient,
      registerExactEvmScheme: evmExact.registerExactEvmScheme,
      toClientEvmSigner: evm.toClientEvmSigner,
    };
  } catch (e) {
    throw new Error(
      'GatewayClient requires the optional x402 peer deps. Install them:\n' +
        "  npm install '@x402/core@^2.13.0' '@x402/evm@^2.13.0' viem\n" +
        `(original error: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

export class GatewayClient {
  readonly baseUrl: string;
  private readonly signer: any;
  private readonly publicClient: any;
  /** Lazily-built x402HTTPClient (one per GatewayClient). */
  private x402: any = null;

  constructor(opts: GatewayClientOptions) {
    if (!opts || !opts.signer) {
      throw new Error('GatewayClient: a `signer` (viem account) is required — the wallet IS the credential (no API key).');
    }
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.signer = opts.signer;
    this.publicClient = opts.publicClient;
  }

  /**
   * Discover the feed catalog. GET {baseUrl}/feeds — free, no payment.
   * Returns the parsed catalog; each feed carries its priceAtomic so callers
   * never recompute price.
   */
  async discover(): Promise<GatewayCatalog> {
    const res = await fetch(`${this.baseUrl}/feeds`);
    if (!res.ok) throw new Error(`gateway /feeds failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as GatewayCatalog;
  }

  /**
   * Discover payable resources with their per-resource accepts[].
   * GET {baseUrl}/.well-known/x402.json — free, no payment. Gives the caller
   * the accepts[] (network, payTo, asset, amount) without probing a 402.
   */
  async discoverResources(): Promise<GatewayResources> {
    const res = await fetch(`${this.baseUrl}/.well-known/x402.json`);
    if (!res.ok) throw new Error(`gateway /.well-known/x402.json failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as GatewayResources;
  }

  /** Build (once) the x402HTTPClient with the exact-EVM scheme bound to the wallet. */
  private async ensureClient(): Promise<any> {
    if (this.x402) return this.x402;
    const { x402Client, x402HTTPClient, registerExactEvmScheme, toClientEvmSigner } = await loadX402();
    // The viem account satisfies the x402 ClientEvmSigner interface (address +
    // signTypedData). Wrap with the public client so the scheme can do optional
    // on-chain reads (nonce/allowance). The signer pays whatever CAIP-2 network +
    // USDC asset the 402 names — we never hardcode the chain.
    const signer = toClientEvmSigner(this.signer, this.publicClient);
    const core = registerExactEvmScheme(new x402Client(), { signer });
    this.x402 = new x402HTTPClient(core);
    return this.x402;
  }

  /**
   * Resolve a feed id or path to a full URL. 'weather' -> /feeds/weather;
   * '/feeds/weather' and 'https://…/feeds/weather' pass through.
   */
  private resolveUrl(feedIdOrPath: string): string {
    if (/^https?:\/\//.test(feedIdOrPath)) return feedIdOrPath;
    const path = feedIdOrPath.startsWith('/')
      ? feedIdOrPath
      : `/feeds/${feedIdOrPath}`;
    return `${this.baseUrl}${path}`;
  }

  /** Extract the feed id from a path/url so we can pick GET vs POST defaults. */
  private feedIdOf(feedIdOrPath: string): string {
    const m = feedIdOrPath.replace(/^https?:\/\/[^/]+/, '').match(/\/feeds\/([^/?#]+)/);
    if (m) return m[1];
    return feedIdOrPath.replace(/^\/+/, '');
  }

  /**
   * The canonical paid retry loop. GET by default; POST_ORACLES feeds
   * (fact-oracle, evidence-pack, usc-statute) default to POST with a JSON body.
   *
   * Mirrors examples/agent-client/ts/pay-and-fetch.ts exactly:
   *  1. unpaid request; if status !== 402, return processResponse(resp) as-is.
   *  2. parse PaymentRequired from headers/body.
   *  3. createPaymentPayload -> encodePaymentSignatureHeader (WALLET SIGNS HERE).
   *  4. retry the SAME request with the payment headers merged.
   *  5. processResponse(paidResp); switch on result.kind.
   */
  async fetchFeed<T = unknown>(
    feedIdOrPath: string,
    options: FetchFeedOptions = {},
  ): Promise<GatewayFetchResult<T>> {
    const url = this.resolveUrl(feedIdOrPath);
    const id = this.feedIdOf(feedIdOrPath);
    const method = options.method ?? (POST_ORACLES.has(id) ? 'POST' : 'GET');

    const init: RequestInit = { method };
    if (method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.body ?? {});
    }

    const x402 = await this.ensureClient();

    // 1) Unpaid attempt — discovers the 402 + payment requirements.
    const first = await fetch(url, init);
    const disclaimerCategory = first.headers.get(DISCLAIMER_HEADER) ?? undefined;

    if (first.status !== 402) {
      // Free route, error, or already paid — hand back as-is.
      const result = await x402.processResponse(first);
      return this.shapeResult<T>(result, disclaimerCategory);
    }

    // 2) Parse the PaymentRequired (header on v2, body on v1).
    const paymentRequired = x402.getPaymentRequiredResponse(
      (name: string) => first.headers.get(name),
      await first.clone().json().catch(() => undefined),
    );

    // 3) Sign a payment payload for the advertised requirements (WALLET SIGNS).
    const payload = await x402.createPaymentPayload(paymentRequired);
    const paymentHeaders = x402.encodePaymentSignatureHeader(payload);

    // 4) Retry the SAME request with the signed payment header attached.
    const paidResp = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...paymentHeaders },
    });
    const paidDisclaimer = paidResp.headers.get(DISCLAIMER_HEADER) ?? disclaimerCategory;

    // 5) Interpret the paid response.
    const result = await x402.processResponse(paidResp);
    return this.shapeResult<T>(result, paidDisclaimer);
  }

  /** Normalize an x402PaymentResult into GatewayFetchResult. */
  private shapeResult<T>(result: any, disclaimerCategory?: string): GatewayFetchResult<T> {
    switch (result.kind) {
      case 'success': {
        const s = result.settleResponse ?? {};
        return {
          data: result.body as T,
          settlement: {
            success: Boolean(s.success),
            payer: s.payer,
            transaction: s.transaction,
          },
          disclaimerCategory,
        };
      }
      case 'passthrough':
        // Free / no-payment route — no settlement.
        return { data: result.body as T, settlement: null, disclaimerCategory };
      case 'settle_failed':
        throw new GatewayError(
          'x402 payment signed but settlement failed',
          result.status,
          result.body,
          result.settleResponse,
        );
      case 'payment_required':
        throw new GatewayError(
          'still 402 after paying — payment requirements not satisfiable',
          result.status,
          result.paymentRequired,
        );
      case 'error':
      default:
        throw new GatewayError(
          `gateway error${result.status ? ` ${result.status}` : ''}`,
          result.status,
          result.body,
        );
    }
  }
}

/** Error thrown by GatewayClient for non-success x402 results. */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
    public readonly settleResponse?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
