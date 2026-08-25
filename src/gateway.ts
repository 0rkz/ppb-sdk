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
 * dataStream, cap) — see subscriber.ts). Those are two distinct USDC flows. The
 * live pay-per-call feeds — including the POST verdict oracles (currently
 * address-reputation, sanctions-screen, pkg-verdict, reasoning-verdict,
 * merchant-screen, positioning-snapshot, cctp-attestation-latency — see
 * `GET /feeds`, never hardcoded here) — need only the x402 leg: the paid 200
 * returns the answer in-body with an embedded EIP-712 attestation, no prior
 * on-chain subscribe required. The subscribe/allowance flow is for the
 * on-chain publish/subscribe streaming path, not x402 fetches.
 *
 * DEPENDENCIES (peer / OPTIONAL — the heavy @x402 stack is NOT pulled into the
 * core SDK; it is loaded lazily at call time so an SDK consumer who never
 * touches the gateway never needs it installed):
 *   '@x402/core'  ^2.15.0   (x402Client, x402HTTPClient — shapeResult() below
 *                            reads `result.paymentStatus`, a field that only
 *                            exists from 2.15.0 onward; 2.13.0/2.14.0 return a
 *                            `{kind: ...}` union instead and would silently
 *                            mis-shape every response — see shapeResult doc)
 *   '@x402/evm'   ^2.15.0   (registerExactEvmScheme, toClientEvmSigner —
 *                            floor matched to @x402/core: each @x402/evm
 *                            release pins its own @x402/core dependency to
 *                            `~<same-minor>`, so installing an older
 *                            @x402/evm pulls a pre-2.15 @x402/core in at the
 *                            TOP level too — an unmatched evm floor would
 *                            silently reopen the H1 bug via @x402/evm's own
 *                            dependency instead of the SDK's peer range)
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
  /**
   * HTTP methods this feed answers on, e.g. `['GET']`, `['POST']`, or
   * `['GET', 'POST']` for dual digest/verdict feeds. Read live from
   * `GET /feeds` — `fetchFeed` uses this (not a hardcoded list) to pick the
   * default method. Optional for forward-compat with older catalogs that
   * predate this field.
   */
  method?: Array<'GET' | 'POST'>;
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
  /**
   * HTTP method. If omitted, resolved from the live `GET /feeds` catalog
   * (GET if the feed offers it, else POST); the POST_ORACLES allow-list is
   * only an offline fallback if the catalog fetch fails. Explicit values here
   * always win.
   */
  method?: 'GET' | 'POST';
  /** JSON body for POST feeds (e.g. address-reputation:
   *  { domain | url, address, amount?, chain? }). Body shapes vary per
   *  oracle — see each feed's 402 challenge (bazaar.info.input). */
  body?: unknown;
}

const DEFAULT_BASE_URL = 'https://x402.payperbyte.io';
const DISCLAIMER_HEADER = 'X-BYTE-Disclaimer-Category';
/** Abort GET /feeds after this long — a hung catalog fetch must not stall fetchFeed. */
const CATALOG_FETCH_TIMEOUT_MS = 3000;
/** How long a failed catalog fetch stays cached before the next fetchFeed retries it. */
const CATALOG_FAILURE_TTL_MS = 60_000;

/**
 * OFFLINE FALLBACK ONLY — the live `GET /feeds` catalog (each entry's
 * `method` array) is the source of truth for which HTTP method a feed
 * answers on; `fetchFeed` fetches and caches that catalog and consults this
 * set only if the catalog fetch itself fails (fail-open: never default an
 * unreachable-catalog POST-only oracle to GET). This is the THIRD time this
 * list has drifted from the live catalog (0.1.9 named 2 feeds since cut and
 * missed 5 live ones; 0.2.0's regen missed the post-cut additions
 * `merchant-screen` and `cctp-attestation-latency` and still named 2 feeds
 * — `liquidation-stream`, `evidence-pack` — no longer in the live catalog).
 * Regenerated 2026-08-25 from the live catalog (GET x402.payperbyte.io/feeds,
 * `method === ["POST"]`, i.e. POST-only — NOT the dual GET+POST feeds below).
 * If you're tempted to hand-edit this list again: don't — fix the catalog
 * lookup instead, this is a fallback of last resort.
 *
 * NOT included: the dual GET-digest/POST-verdict feeds `runtime-eol` and
 * `threat-intel` — they answer GET (a digest, no body) AND POST (a verdict,
 * needs input), so they default to GET; pass method:'POST' + body for the
 * verdict. GET-only feeds (weather, earthquakes) are also absent. Everything
 * not listed defaults to GET.
 *
 * Verdict-oracle body shape (e.g. address-reputation): { domain | url,
 * address (0x), amount?: number, chain?: 'base' | 'arbitrum-one' }. The paid
 * 200 embeds an EIP-712 PayloadAttestation over the exact answer bytes. Body
 * shapes vary per oracle — see each feed's 402 challenge (bazaar.info.input).
 */
const POST_ORACLES = new Set([
  'address-reputation',
  'sanctions-screen',
  'pkg-verdict',
  'reasoning-verdict',
  'merchant-screen',
  'positioning-snapshot',
  'cctp-attestation-latency',
]);

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
        "  npm install '@x402/core@^2.15.0' '@x402/evm@^2.15.0' viem\n" +
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
  /**
   * Lazily-fetched `id -> method[]` map, built from `GET /feeds` the first
   * time `fetchFeed` needs a method and none was given explicitly. Cached for
   * the lifetime of this client on success. A failed fetch is cached too — a
   * client on a flaky network doesn't retry it on every single fetchFeed call
   * — but only for `CATALOG_FAILURE_TTL_MS`: a long-lived client must not pin
   * itself to the static POST_ORACLES fallback forever just because one GET
   * /feeds hiccuped. See loadMethodCatalog() / resolveMethod().
   */
  private methodCatalogPromise: Promise<Map<string, Array<'GET' | 'POST'>>> | null = null;
  /** Wall-clock time (ms) the last catalog fetch failed, or null if the
   *  current methodCatalogPromise hasn't failed (unset, pending, or resolved
   *  successfully). Drives the retry-after-TTL check in loadMethodCatalog(). */
  private methodCatalogFailedAt: number | null = null;

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
    const res = await fetch(`${this.baseUrl}/feeds`, { signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS) });
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
   * Fetch and cache `GET /feeds` as an `id -> method[]` map. Never throws: on
   * failure it caches an empty map so resolveMethod() falls through to the
   * POST_ORACLES fallback (fail-open) — but only for CATALOG_FAILURE_TTL_MS;
   * once that elapses the next call retries the fetch instead of staying
   * pinned to the fallback for the client's whole lifetime.
   */
  private loadMethodCatalog(): Promise<Map<string, Array<'GET' | 'POST'>>> {
    if (
      this.methodCatalogFailedAt !== null &&
      Date.now() - this.methodCatalogFailedAt >= CATALOG_FAILURE_TTL_MS
    ) {
      this.methodCatalogPromise = null;
      this.methodCatalogFailedAt = null;
    }
    if (!this.methodCatalogPromise) {
      this.methodCatalogPromise = this.discover()
        .then((catalog) => {
          const map = new Map<string, Array<'GET' | 'POST'>>();
          for (const feed of catalog.feeds) {
            if (Array.isArray(feed.method) && feed.method.length > 0) {
              // Normalize casing so a catalog serving lowercase/mixed-case
              // methods still resolves — resolveMethod() compares against
              // the uppercase 'GET' literal. Tolerate a malformed entry (a
              // non-string element): drop it rather than throw, so one bad
              // feed can't take the whole catalog fetch down (the .catch()
              // below is for network/JSON failures, not per-feed data
              // problems — a throw here would wrongly discard every other
              // feed's method[] and TTL-cache the failure). A feed left with
              // an empty method[] after filtering just isn't set in the map,
              // so resolveMethod() falls through to POST_ORACLES/default for
              // that feed only.
              // Cast to unknown[] first: the declared type promises 'GET' |
              // 'POST' elements, but this is untrusted network data — a
              // malformed catalog can send anything.
              const methods = (feed.method as unknown as unknown[])
                .filter((m): m is string => typeof m === 'string')
                .map((m) => m.toUpperCase()) as Array<'GET' | 'POST'>;
              if (methods.length > 0) map.set(feed.id, methods);
            }
          }
          return map;
        })
        .catch(() => {
          this.methodCatalogFailedAt = Date.now();
          return new Map<string, Array<'GET' | 'POST'>>();
        });
    }
    return this.methodCatalogPromise;
  }

  /**
   * Resolve the HTTP method for a feed id when the caller didn't pass one
   * explicitly. Order: (1) the feed's live `method[]` from `GET /feeds` — GET
   * if it's offered, else POST (mirrors the dual-feed / POST-only split);
   * (2) if the feed is absent from the catalog (unlisted, or the catalog
   * fetch itself failed), fall back to the static POST_ORACLES allow-list —
   * fail-open to that fallback, never silently to GET-always, so an
   * unreachable catalog can't turn a POST-only oracle into a 405.
   */
  private async resolveMethod(id: string): Promise<'GET' | 'POST'> {
    const catalog = await this.loadMethodCatalog();
    const methods = catalog.get(id);
    if (methods && methods.length > 0) {
      return methods.includes('GET') ? 'GET' : 'POST';
    }
    return POST_ORACLES.has(id) ? 'POST' : 'GET';
  }

  /**
   * The canonical paid retry loop. Method: an explicit `options.method` wins;
   * otherwise it's resolved from the live `GET /feeds` catalog (GET if the
   * feed offers it, else POST), fetched lazily and cached on this client —
   * see resolveMethod(). Dual feeds (runtime-eol, threat-intel) default to
   * GET that way; pass method:'POST' + body for their verdict.
   *
   * Mirrors examples/agent-client/ts/pay-and-fetch.ts exactly:
   *  1. unpaid request; if status !== 402, return processResponse(resp) as-is.
   *  2. parse PaymentRequired from headers/body.
   *  3. createPaymentPayload -> encodePaymentSignatureHeader (WALLET SIGNS HERE).
   *  4. retry the SAME request with the payment headers merged.
   *  5. processResponse(paidResp); shape it — see shapeResult().
   */
  async fetchFeed<T = unknown>(
    feedIdOrPath: string,
    options: FetchFeedOptions = {},
  ): Promise<GatewayFetchResult<T>> {
    const url = this.resolveUrl(feedIdOrPath);
    const id = this.feedIdOf(feedIdOrPath);
    const method = options.method ?? (await this.resolveMethod(id));

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

  /**
   * Normalize an x402HTTPClient.processResponse() result into a
   * GatewayFetchResult. Written against the REAL @x402/core@2.15.0+ client
   * contract (verified by reading node_modules/@x402/core/dist/cjs/client/
   * index.d.ts across 2.13.0 through 2.23.0, 2026-08-25): `result.kind` was
   * NOT a fabricated field — @x402/core 2.13.0 and 2.14.0's processResponse()
   * really does return a `{kind: 'success' | 'settle_failed' |
   * 'payment_required' | 'error' | 'passthrough', ...}` union. The contract
   * changed to the `paymentStatus` shape below at 2.15.0. This SDK's
   * peerDependencies now floor @x402/core (and @x402/evm) at ^2.15.0 — see
   * the class doc comment — specifically so this switch is only ever fed the
   * shape it's written against:
   *
   *   type HTTPResourceResponse = {
   *     status: number;
   *     paymentStatus: 'settled' | 'settle_failed' | 'payment_required' | 'none';
   *     body: unknown;
   *     header?: SettleResponse | PaymentRequired;   // SettleResponse has `success`
   *   };
   *
   * `paymentStatus` is 'none' whenever no PAYMENT-RESPONSE/X-PAYMENT-RESPONSE
   * header decoded — that covers BOTH a genuinely free/passthrough route AND a
   * paid 200 whose settlement header the gateway omitted or the client
   * couldn't decode (the live regression this fixes: settle tx
   * 0xa610b39978132b886b0ff73311d238a4b131fbe8cabffd475a9555b429b0913a settled
   * on-chain and the gateway's delivery log confirmed it, but the SDK threw
   * "gateway error 200" on the successful, delivered response because it was
   * still switching on `result.kind`, which is always undefined against the
   * paymentStatus-shaped contract). A delivered 2xx body is not punished for
   * a missing/undecodable receipt: it's returned with `settlement: null`,
   * same as an always-free route — never thrown. The same treatment applies
   * when @x402/core itself lands on `paymentStatus: 'payment_required'` for a
   * 2xx (an unrecognizable receipt, not an actual still-402 — see below).
   * Conversely this is status-gated the other way too: a 'settled'
   * paymentStatus on a non-2xx status throws rather than handing the error
   * body back as `data` with `settlement.success: true` — money moved, the
   * request still failed, fail closed.
   */
  private shapeResult<T>(result: any, disclaimerCategory?: string): GatewayFetchResult<T> {
    const { status, paymentStatus, body, header } = result as {
      status: number;
      paymentStatus: 'settled' | 'settle_failed' | 'payment_required' | 'none';
      body: unknown;
      header?: { success?: boolean; payer?: `0x${string}`; transaction?: string; error?: string };
    };

    switch (paymentStatus) {
      case 'settled': {
        const settlement: GatewaySettlement = {
          success: Boolean(header?.success),
          payer: header?.payer,
          transaction: header?.transaction,
        };
        if (status < 200 || status >= 300) {
          // A real settlement receipt decoded, but the request itself failed
          // server-side (e.g. a 500). Money moved; the request did not
          // succeed — fail closed instead of handing the error body back as
          // `data` with `settlement.success: true`, which would read as a
          // successful paid call.
          throw new GatewayError(
            `gateway error ${status} after a settled payment — payment succeeded, the request did not`,
            status,
            body,
            settlement,
          );
        }
        return { data: body as T, settlement, disclaimerCategory };
      }

      case 'settle_failed':
        throw new GatewayError(
          'x402 payment signed but settlement failed',
          status,
          body,
          header,
        );

      case 'payment_required':
        if (status >= 200 && status < 300) {
          // @x402/core's parsePaymentResult can land here even on a 2xx when
          // the decoded X-PAYMENT-RESPONSE header doesn't look like a
          // SettleResponse (no `success` field) — an unrecognizable receipt
          // on an otherwise-successful response, not an actual still-402.
          // Same treatment as a missing/undecodable receipt: return the
          // body, no settlement, never throw on a delivered 2xx.
          return { data: body as T, settlement: null, disclaimerCategory };
        }
        throw new GatewayError(
          'still 402 after paying — payment requirements not satisfiable',
          status,
          body,
          header,
        );

      case 'none':
      default:
        if (status >= 200 && status < 300) {
          // Free / passthrough route, OR a paid settle whose receipt header
          // is missing/undecodable — the 2xx body is real either way. See
          // the class doc comment above for the live case this covers.
          return { data: body as T, settlement: null, disclaimerCategory };
        }
        throw new GatewayError(`gateway error${status ? ` ${status}` : ''}`, status, body);
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
