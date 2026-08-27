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
 *     success the bytes are republished to the PUBLIC card-art bucket at a
 *     guessable path. An SSRF response that passes the sniff is not merely
 *     fetched, it is served back to the internet.
 *
 * The content checks in `fetch-source.ts` (image content-type, magic bytes,
 * non-empty, under 8 MB) stay exactly as they were. They are complementary, not
 * redundant: they were written to catch TCGdex's `200 text/html` soft-404 and
 * they still do that. What they never were is a destination control, which is
 * what lives here.
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
 * DELIBERATELY ABSENT: `assets.pkmn.gg`. `warm:pkmn` recorded ~58 `image_asset`
 * rows against that host in 2026-08 (DECISIONS.md 2026-08-10) before pkmn.gg was
 * ruled out as a source on legal grounds on 2026-08-26 —
 * `apps/images/src/warmFromPkmn.ts` is retired and says it "must not be
 * reintroduced as a fallback". Those rows were never purged, so leaving the host
 * out of this list is what actually ENFORCES that ruling: their bytes are already
 * in the bucket and still serve as a `HIT`, but a future refill would answer the
 * placeholder with `host 'assets.pkmn.gg' is not an allow-listed image upstream`
 * instead of silently re-fetching from a source the owner rejected. If that is
 * ever reversed, it is one line here plus a DECISIONS.md entry.
 */
export const IMAGE_SOURCE_HOSTS: ReadonlySet<string> = new Set([
  'assets.tcgdex.net',
  'raw.githubusercontent.com',
]);

export interface UpstreamPolicy {
  /** Hostnames (exact, lower-case, no port) we will fetch bytes from. */
  allowedHosts: ReadonlySet<string>;
  /** URL schemes we will speak. Everything else — `file:`, `data:`, … — is refused. */
  protocols: ReadonlySet<string>;
  /**
   * Skip the resolved-address check. ONLY the tests set this, so that a
   * loopback HTTP server can stand in for an upstream; production must never.
   */
  allowPrivateAddresses: boolean;
}

/** The policy the cloud image tier runs under. */
export const IMAGE_SOURCE_POLICY: UpstreamPolicy = {
  allowedHosts: IMAGE_SOURCE_HOSTS,
  // http as well as https because a recorded `source_url` predates this check and
  // may not be https; the host allow-list is the control, and both allow-listed
  // hosts are HSTS CDNs that would upgrade anyway. Everything that is not a web
  // scheme is refused outright.
  protocols: new Set(['https:', 'http:']),
  allowPrivateAddresses: false,
};

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
    text = text.slice(0, lastColon + 1) + '0';
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
 * Is `raw` a URL we are willing to send a request to?
 *
 * Called on the initial URL AND on the resolved target of every redirect hop —
 * that ordering is the whole point, because a check that only ever sees the first
 * URL passes while the bug it was written for is still there.
 *
 * Three layers, in order of how much they cost:
 *   1. shape — parses, no embedded credentials, a web scheme;
 *   2. host  — an exact match in the allow-list (an IP literal never matches one,
 *              so `http://169.254.169.254/…` is refused right here);
 *   3. address — what the name actually resolves to, so a hijacked or poisoned
 *              record for an allow-listed host cannot point us at the metadata
 *              service. This narrows DNS rebinding but does not eliminate it:
 *              `fetch` resolves the name again when it connects, and nothing here
 *              pins the answer. Closing that fully needs a custom undici
 *              connector that validates the socket's peer address, which is a
 *              bigger change than this one — see DECISIONS.md 2026-08-27.
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
  if (!policy.protocols.has(url.protocol)) {
    return { ok: false, reason: `scheme '${url.protocol}' is not fetchable` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URL carries embedded credentials' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!policy.allowedHosts.has(host)) {
    return { ok: false, reason: `host '${host}' is not an allow-listed image upstream` };
  }
  if (policy.allowPrivateAddresses) return { ok: true, url };

  let addresses: Array<{ address: string }>;
  try {
    addresses = await abortable(lookup(host, { all: true, verbatim: true }), signal);
  } catch (err) {
    return { ok: false, reason: `could not resolve '${host}': ${(err as Error).message}` };
  }
  if (addresses.length === 0) return { ok: false, reason: `'${host}' resolved to no address` };
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: `'${host}' resolves to non-public address ${address}` };
    }
  }
  return { ok: true, url };
}
