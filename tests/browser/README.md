# Browser boundary checks

Run `pnpm exec playwright install --with-deps chromium webkit` once, then `pnpm test:browser`.
Build `@deckpal/storage` and `@deckpal/matching` first on a clean checkout.
`pnpm test:deploy-assets` runs the asset controls without starting a browser.
The workflow uses Node 24 and a frozen pnpm lockfile.

Reports and screenshots go to `TEST_ARTIFACT_DIR` (default `.cache/browser-tests`).
A local installation can set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and
`PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH`; CI installs the Chromium and WebKit
revisions selected by pinned Playwright 1.63.0.

The SPA is built twice into owned temporary directories using the real Vite
configuration: cloud at `/`, self-host at `/deckpal/`. The strict server rejects
requests outside the mount, unknown API paths and missing static assets. Cloud's
synthetic Supabase URL is the same loopback server, including image fixtures.
The installed Stripe loader's exact SDK URL is fulfilled locally with an inert
stub; no third-party request reaches the network. Every other external request
fails. This suite does not test Stripe, authentication, real storage or Postgres.

Catalog responses are local fixtures assembled with the production announcement
selection, mapping and ordering helpers. Active, expired and normalized-name
suppression run independently of wall-clock time. The built UI must show complete
titles/dates/logos, exclude placeholders from counts and navigation, and preserve
real-row links at 1280 and 390 pixels. The separate database lane tests real SQL.

The test-only Vite entry imports actual DeckeChat and DeckeScreen. It is absent
from production entries/routes. A separate TypeScript check checks component
props. Tailwind explicitly scans the production components, with a rendered
position assertion guarding against an unstyled fixture.

Coverage replacing chatAccessibility source regexes:

| Previous source assertion | Rendered behavior |
| --- | --- |
| Polite, atomic live region and separation from messages | Persistent region is empty while busy; streaming text has no live ancestor; completed response announces |
| Expansion state, controlled ID and focus styles | Actual button expands with Enter, collapses with Space, retains its controlled region ID and visible keyboard focus |
| Tool mapper and retry callback wiring | Legacy ok/declined chip displays Cancelled; failed tool's real retry control reports its call ID |
| Named greeting, subhead and opener props | /me name reaches greeting; chosen persisted subhead renders; three openers fill without sending and rotate on reopening |
| Spent-credit branch and low-credit header | Low label renders; zero credits replace the textbox while transcript remains readable |
| Composer padding prop | Computed 20px mobile empty/12px desktop empty and 40px transcript bottom padding |
| Dismiss handlers and all three guards | Actual component receives child click, background drag, selection release and plain background click; only the last dismisses |
| Experimental label | Badge appears in the actual chat header |
| Motion policy | Actual reduced-motion chevron has zero transition; one small static guard retains the ban on literal blanket 0.01ms overrides |

Deployment checks derive local logos from the actual announcement metadata,
verify tracking and both ignore files, and keep marketing/character controls and
unrelated caches excluded. Removing each exact exception in a scratch matcher
must exclude the logo. Omitting each logo from a scratch copy of the real build
must fail the actual build gate. Git supplies gitignore-compatible matching;
the Vercel CLI and deployment service are not invoked.

## Deck-E states a reader has to act on

`checkDeckeStates` in `tests/browser/chat.mjs` runs in Chromium and WebKit at 390
and 1440. For a held deck edit and a paid deep call it asserts that the phone park
box does not intersect the card's headline, rows, price or buttons. At desktop it
asserts that everything to be read sits in the column he stands beside. It also
checks that the dry run renders as named card rows, that the price line and the
Top-up swap appear when the balance is short, and that the status reads "Waiting
for your OK" with no Stop. The out-of-credits card must be the registered floor
and must stay clear of him. Each notice must offer its one action, and a meter-refused
row must offer Top up instead of Try again. A deck page must lead with deck
questions. Over the real hook and fetch, a held wallet must get the wallet and
never a top-up, and Try again must resend the last question. The character itself
is not drawn here (no WebGL), so the park box is the geometry under test, and it
is the box `DeckeHost` flies him to.

## Administration DataTable coverage

`tests/browser/admin.mjs` exercises the real DataTable in Users,
Roles, Audit, credit packs/orders and the user-detail ledger at 1280 and 390px
in both builds. Fixtures span multiple pages, including a matching user outside
page one. Cases check server filter/limit/offset requests and totals, complete-list
role/pack sorting and aria-sort, page-size/reset behavior, fixed ledger pages,
late/failed query withholding, disclosures and protected/read-only actions.
Layout checks require one semantic table, contained document width, visible
keyboard focus and actual rightward scrolling from the left edge of the inner
region. Role action geometry must keep all three buttons on one line inside
their cell at both widths. The real design catalog is also exercised for
discovery, search, paging and error-mode reset after retry. Exact fictional
card/set requests from its existing examples are answered locally; arbitrary
unknown requests still fail.

The complete isolated browser suite passed 57 groups on 2026-09-14, including
these table checks. Desktop and 390px screenshots were directly reviewed.
Artifacts include full-page PNGs and viewport JPEGs for table/gallery review;
inspect the current run's results and screenshots when changing this code.

The co-located DataTable gallery uses fictional records and the same primitive.
Core tests cover controlled paging and semantic/state behavior; browser checks
exercise built SPA interaction. Neither local fixture lane proves live database
filtering, production authorization, Stripe processing or deployment. This UI
change adds no API, schema or production test target.
