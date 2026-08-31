import { isIPv4, isIPv6 } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * The upstream allow-list for cold-asset fetches — the DESTINATION control that
 * `fetch-source.ts` was missing.
 *
 * WHY THIS EXISTS (CodeQL `js/request-forgery` alert #36). `fetchSourceBytes`
 * took an arbitrary URL and followed redirects. The URL is either a documented
 * derivation of the requested path (safe) or `image_asset.source_url` read
 * straight out of Postgres, which is authoritative and always wins. No
 * user-facing endpoint writes that column today — importers and warmers do — so
 * it was not anonymously exploitable. Two things still made it worth closing
 * rather than dismissing:
 *
 *  1. **`redirect: 'follow'` meant a hostile or compromised upstream sufficed.**
 *     No database write needed: a `302` from `assets.tcgdex.net` to an internal
 *     or link-local address was followed, cross-origin, by undici. That is the
 *     standard allow-list bypass, and it is why the host has to be re-checked on
 *     the FINAL url of every hop rather than only on the one we asked for.
 *  2. **The blast radius is unusually bad for an image fetcher.** This runs in
 *     the cloud image function, which holds `SUPABASE_SERVICE_ROLE_KEY`, and on
 *     success the bytes are written to the PUBLIC card-art bucket at a guessable
 *     path. An SSRF response that passes the sniff is not merely fetched, it is
 *     served back to the internet.
 *
 * The content checks in `fetch-source.ts` (image content-type, magic bytes,
 * non-empty, under 8 MB) stay exactly as they were. They are complementary, not
 * redundant: they were written to catch TCGdex's `200 text/html` soft-404 and
 * they still do that. What they never were is a destination control, which is
 * what lives here.
 *
 * **The origin is SELECTED, not carried.** `originFor` maps a validated hostname
 * to a constant origin string and the request URL is rebuilt from that constant
 * plus a character-checked path. Nothing about the host of the outgoing request
 * is derived from the input — which is both the strongest form of the control
 * and, not by coincidence, exactly what the CodeQL rule's own guidance asks for
 * ("Pick the hostname from an allow-list instead of constructing it directly
 * from user input").
 */

/**
 * Every host the cloud image tier is allowed to fetch bytes from.
 *
 *  - `assets.tcgdex.net`       — card art (`paths.ts` `cardSourceUrl`) and set
 *                                logos/symbols (`setImageSourceUrl` over the base
 *                                URL the catalog import stores in
 *                                `card_set.logo_url` / `symbol_url`, which comes
 *                                from TCGdex's own compiled JSON).
 *  - `raw.githubusercontent.com` — Pokédex species sprites, pinned to
 *                                `SPRITES_SHA` (`paths.ts`).
 *
 * THIS LIST IS THE POLICY, and its shortness is the point. An allow-list never
 * enumerates what it blocks — it enumerates what has been *approved*, and every
 * other host on the internet is refused by the same single default. So a source
 * the owner has ruled out needs no entry, no exception and no name here: it is
 * already denied, by the same code path and with the same message as any host
 * nobody has ever considered.
 *
 * That default is what makes the ruling durable rather than advisory. Bytes an
 * unapproved source contributed in the past may still be in the bucket and still
 * serve as a `HIT`; what this list guarantees is that a *refill* can never
 * silently go back and fetch more. It answers with the placeholder and
 * `host '<x>' is not an allow-listed image upstream` instead.
 *
 * Approving a new source is therefore a deliberate act: add the host above,
 * with the same one-line justification the two entries carry, plus a
 * DECISIONS.md entry recording who approved it and on what licensing basis.
 * The approved fallback ladder for card art lives in
 * `research/CARD-ART-SOURCES.md`; read it before adding anything.
 */
export const IMAGE_SOURCE_HOSTS: readonly string[] = [
  'assets.tcgdex.net',
  'raw.githubusercontent.com',
];

export interface UpstreamPolicy {
  /**
   * The constant origin to talk to for this hostname, or `null` to refuse it.
   * Returning a fixed string rather than echoing the input is the point: the
   * outgoing request's scheme, host and port come from here, never from the URL
   * we were handed.
   */
  originFor(host: string): string | null;
  /**
   * Skip the resolved-address check. ONLY the tests set this, so that a
   * loopback HTTP server can stand in for an upstream; production must never.
   */
  allowPrivateAddresses: boolean;
}

/** The policy the cloud image tier runs under. */
export const IMAGE_SOURCE_POLICY: UpstreamPolicy = {
  originFor(host: string): string | null {
    // A literal per arm on purpose. An `http://` stored URL for one of these is
    // upgraded rather than refused, because both are HTTPS-only CDNs that would
    // answer a plaintext request with a redirect to exactly this origin anyway.
    switch (host) {
      case 'assets.tcgdex.net':
        return 'https://assets.tcgdex.net';
      case 'raw.githubusercontent.com':
        return 'https://raw.githubusercontent.com';
      default:
        return null;
    }
  },
  allowPrivateAddresses: false,
};

/**
 * Characters an upstream asset path may contain, checked AFTER one decode.
 *
 * Every path this project can derive is `{lang}/{serie}/{set}/{localId}/{quality}.webp`,
 * a set logo/symbol base out of `card_set`, or a PokeAPI sprite path — the same
 * `[A-Za-z0-9.-]` id space `paths.ts` allows, plus separators. Checking the
 * DECODED form is the point: `URL` percent-encodes almost everything unusual
 * into `%NN`, so a class that allowed `%` would allow `%00` and `%20` straight
 * back in. Same rule, same reason, as `parseImagePath` — decode first, validate
 * after.
 */
const UPSTREAM_PATH = /^\/[A-Za-z0-9._~/-]*$/;
/** Empty, or a query of the same shape. Neither upstream uses one today. */
const UPSTREAM_QUERY = /^[A-Za-z0-9._~&=/-]*$/;

// ── Address classification ───────────────────────────────────────────────────
/**
 * Is this literal address one an SSRF wants and a card CDN never has?
 *
 * Loopback, link-local (including the `169.254.169.254` cloud metadata endpoint),
 * RFC1918, carrier-grade NAT, the documentation/benchmark ranges, multicast and
 * the reserved space. Anything that is not routable public unicast.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIpv4(ip);
  if (isIPv6(ip)) return isPrivateIpv6(ip);
  return true; // unparseable — refuse rather than guess
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local — 169.254.169.254 lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 literal to its eight 16-bit words, or null if it will not parse. */
function ipv6Words(ip: string): number[] | null {
  let text = ip.toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%'); // fe80::1%eth0
  if (zone !== -1) text = text.slice(0, zone);

  // A trailing dotted-quad (::ffff:127.0.0.1) becomes the last two words.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    if (!isIPv4(maybeV4)) return null;
    const o = maybeV4.split('.').map(Number) as [number, number, number, number];
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    text = `${text.slice(0, lastColon + 1)}0`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const out: number[] = [];
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      out.push(parseInt(chunk, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 1) {
    const words = tail.length > 0 ? [...head.slice(0, -1), ...tail] : head;
    return words.length === 8 ? words : null;
  }
  const rest = parse(halves[1] ?? '');
  if (rest === null) return null;
  const explicit = tail.length > 0 ? [...rest.slice(0, -1), ...tail] : rest;
  const gap = 8 - head.length - explicit.length;
  if (gap < 0) return null;
  return [...head, ...new Array<number>(gap).fill(0), ...explicit];
}

function isPrivateIpv6(ip: string): boolean {
  const w = ipv6Words(ip);
  if (w === null) return true;
  const embeddedV4 = (hi: number, lo: number): string =>
    `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if ((w[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if ((w[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((w[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  // Shapes that carry an IPv4 address inside — classify the address they carry.
  const zeroPrefix = w.slice(0, 5).every((x) => x === 0);
  if (zeroPrefix && (w[5] === 0xffff || w[5] === 0)) {
    return isPrivateIpv4(embeddedV4(w[6]!, w[7]!)); // ::ffff:a.b.c.d / ::a.b.c.d
  }
  if (w[0] === 0x0064 && w[1] === 0xff9b) return isPrivateIpv4(embeddedV4(w[6]!, w[7]!)); // NAT64
  if (w[0] === 0x2002) return isPrivateIpv4(embeddedV4(w[1]!, w[2]!)); // 6to4
  return false;
}

// ── The check ────────────────────────────────────────────────────────────────
export type UpstreamCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Reject a DNS lookup that outlives the caller's budget instead of ignoring it. */
function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  ]);
}

/**
 * Decide whether we will talk to `raw`, and return the URL we will actually use.
 *
 * Called on the initial URL AND on the resolved target of every redirect hop —
 * that ordering is the whole point, because a check that only ever sees the
 * first URL passes while the bug it was written for is still there.
 *
 * Layers, cheapest first:
 *   1. shape   — parses, no embedded credentials, a web scheme;
 *   2. host    — `policy.originFor` accepts it and hands back a CONSTANT origin.
 *                An IP literal is never a key, so `http://169.254.169.254/…` is
 *                refused right here, and so is `assets.tcgdex.net.evil.example`;
 *   3. port    — an explicit port that is not the allow-listed origin's is
 *                refused rather than silently rewritten;
 *   4. path    — a character allow-list on `pathname` and `search`;
 *   5. address — what the name actually resolves to, so a hijacked or poisoned
 *                record for an allow-listed host cannot point us at the metadata
 *                service. This narrows DNS rebinding but does not eliminate it:
 *                `fetch` resolves the name again when it connects, and nothing
 *                here pins the answer. Closing that fully needs a custom undici
 *                connector that validates the socket's peer address, which is a
 *                bigger change than this one — see DECISIONS.md 2026-08-27.
 *
 * The URL that comes back is **rebuilt from the constant origin**, so the
 * request's scheme, host and port are the allow-list's and not the caller's.
 */
export async function checkUpstreamUrl(
  raw: string,
  policy: UpstreamPolicy = IMAGE_SOURCE_POLICY,
  signal?: AbortSignal,
): Promise<UpstreamCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `not a parseable URL: ${JSON.stringify(raw.slice(0, 120))}` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `scheme '${url.protocol}' is not fetchable` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URL carries embedded credentials' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const origin = policy.originFor(host);
  if (origin === null) {
    return { ok: false, reason: `host '${host}' is not an allow-listed image upstream` };
  }
  const allowed = new URL(origin);
  if (url.port !== '' && url.port !== allowed.port) {
    return { ok: false, reason: `port '${url.port}' is not the allow-listed port for '${host}'` };
  }
  let decodedPath: string;
  let decodedQuery: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
    decodedQuery = decodeURIComponent(url.search.replace(/^\?/, ''));
  } catch {
    return { ok: false, reason: 'malformed percent-escape in the URL' };
  }
  if (!UPSTREAM_PATH.test(decodedPath)) {
    return {
      ok: false,
      reason: `path is not allow-listed: ${JSON.stringify(decodedPath.slice(0, 120))}`,
    };
  }
  if (!UPSTREAM_QUERY.test(decodedQuery)) {
    return {
      ok: false,
      reason: `query is not allow-listed: ${JSON.stringify(decodedQuery.slice(0, 120))}`,
    };
  }

  if (!policy.allowPrivateAddresses) {
    let addresses: Array<{ address: string }>;
    try {
      addresses = await abortable(lookup(allowed.hostname, { all: true, verbatim: true }), signal);
    } catch (err) {
      return { ok: false, reason: `could not resolve '${host}': ${(err as Error).message}` };
    }
    if (addresses.length === 0) return { ok: false, reason: `'${host}' resolved to no address` };
    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        return { ok: false, reason: `'${host}' resolves to non-public address ${address}` };
      }
    }
  }

  // Rebuilt from the CONSTANT origin. `allowed.origin` decides scheme, host and
  // port; only the character-checked path and query survive from the input.
  const target = new URL(`${allowed.origin}${url.pathname}${url.search}`);
  if (target.origin !== allowed.origin) {
    // Unreachable — the path allow-list contains no separator or authority
    // characters — but asserted rather than assumed, because this is the line
    // that decides which machine we open a socket to.
    return { ok: false, reason: `refusing ${target.origin}: not the allow-listed origin` };
  }
  return { ok: true, url: target };
}
