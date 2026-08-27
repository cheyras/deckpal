/**
 * Does a response's `Content-Type` actually promise JSON?
 *
 * ── WHY A CONTENT-TYPE GUARD EXISTS AT ALL ───────────────────────────────────
 *
 * `res.ok` does not mean "the API answered me". Both deployments answer every
 * unmatched path with the SPA shell at HTTP 200 — Vercel through the
 * `/:path(...)` → `/index.html` rewrite in `vercel.json`, and the Vite dev
 * server through its own history fallback. So a request aimed at a path this
 * deployment does not route comes back `200 text/html`: ok, truthy, and
 * completely wrong. Nothing notices until `res.json()` several lines later,
 * inside the browser's parser, and what the person sees is whatever that
 * parser happens to call a syntax error:
 *
 *   Chrome   Unexpected token '<', "<!doctype "... is not valid JSON
 *   Firefox  JSON.parse: unexpected character at line 1 column 1
 *   WebKit   The string did not match the expected pattern.
 *
 * That last one is not a paraphrase. WebKit's `Response.json()` rejects with a
 * bare `ExceptionCode::SyntaxError` (`fulfillPromiseWithJSON`, JSDOMPromise-
 * Deferred.cpp), and `DOMException`'s table gives that code the description
 * `"The string did not match the expected pattern."` — no request, no path, no
 * status, nothing an ordinary person or a bug report can act on. It shipped to
 * a real iPad user as the entire text of the "Generate cart link" failure
 * (issues #113 / #89), where the real fault was that `PurchaseSetMenu` asked
 * for the self-host base path on a cloud deployment.
 *
 * Checking the content-type before parsing converts that riddle into a sentence
 * that names the path and what came back instead of JSON. It cannot prevent the
 * wrong-path bug, but it makes the next one loud on the first report rather
 * than after somebody reads WebKit's source.
 *
 * Kept in its own module, with no imports, so the rule is unit-testable without
 * dragging in `lib/api.ts` → `lib/supabase.ts` → `import.meta.env`, which the
 * `node --import tsx --test` harness cannot load.
 */

/**
 * True when `contentType` names a JSON media type.
 *
 * Parameters are ignored (`application/json; charset=utf-8` is JSON) and the
 * `+json` structured suffix counts (`application/problem+json`), because an API
 * is free to use one and a guard that rejected it would be the bug.
 */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  return essence === 'application/json' || essence === 'text/json' || essence.endsWith('+json')
}
