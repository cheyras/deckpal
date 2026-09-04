# drive-export

Exports curated card-scan exemplars to Google Drive at `/deckpal/card_scans`, so
the training set is a folder somebody can open, sort and audit rather than a set
of opaque object keys.

Only exemplars on the **opt-in crop-retention tier** are eligible:
`crop_retained = true AND crop_consent_at IS NOT NULL`. That filter is in the
SQL and asserted again in TypeScript immediately before any bytes are read — see
the header of `export.mts` for why once is not enough.

Every exported JPEG carries its own provenance in-band (XMP + EXIF), so an image
that gets separated from the manifest is still self-describing. The manifest is a
derived index; the images are the source of truth.

## Running it

```bash
# Rehearsal against Drive. Still authenticates, because the credential is the
# part most likely to be wrong.
node --import tsx tools/drive-export/export.mts --dry-run

# Real export.
node --import tsx tools/drive-export/export.mts

# No credential needed, and it has to be asked for by name.
node --import tsx tools/drive-export/export.mts --local-out ./scan-export

# Rebuild manifest.json from what the folder already holds. Uploads nothing.
node --import tsx tools/drive-export/export.mts --manifest-only
```

| Flag | Effect |
|---|---|
| `--dry-run` | Do everything except write or upload; print the plan |
| `--local-out <dir>` | Write to a local directory instead of Drive. **The only credential-free path** |
| `--manifest-only` | Rebuild `manifest.json` from the destination's contents; upload nothing |
| `--limit N` | Cap the rows considered this run |
| `--since <ISO date>` | Only exemplars captured at or after this instant |
| `--folder <id>` | Override `DRIVE_EXPORT_FOLDER_ID` |

Unknown flags are a hard error rather than being ignored: here a typo like
`--dry-ru` would mean a real upload to a shared folder that the operator
believed was a rehearsal.

Re-running is a no-op (contract B8). Already-exported images are skipped by a
cheap existence check on the destination, so a failed run is retried rather than
reconciled.

## Credentials

The tool authenticates as a **Google service account** and refuses to run
without one (contract B11). There is no implicit local fallback.

1. In the Google Cloud console, create a service account and enable the **Google
   Drive API** for its project.
2. Create a JSON key for it (IAM → Service Accounts → Keys → Add key) and save
   it at the repo root as `.drive-export-credentials.json`. That path is
   gitignored. It is a live private key — the tool never prints it, and neither
   should you.
3. In Drive, create `/deckpal/card_scans` and **share it with the service
   account's `client_email`** with edit access. A service account has its own
   empty Drive and can only see what is shared with it. This tool resolves the
   folder by name and will not create it (contract B9: shared infrastructure is
   not something a script changes on its own).
4. Point the environment variable at the key:

```bash
export DRIVE_EXPORT_CREDENTIALS="$PWD/.drive-export-credentials.json"
# Optional but faster and unambiguous — the id from the folder's URL,
# https://drive.google.com/drive/folders/<id>
export DRIVE_EXPORT_FOLDER_ID="<id>"
```

The Drive path also needs the `googleapis` package, which is a dependency of
this tool and of nothing else in the repo (a root `pnpm install` does not pull
it in). It is imported lazily, so `--local-out`, `--dry-run` of the encode path
and the tests all work without it; the Drive path says so plainly if it is
missing.

## Environment

| Variable | Required for | Meaning |
|---|---|---|
| `DRIVE_EXPORT_CREDENTIALS` | Drive path | Path to the service-account JSON key. Never printed |
| `DRIVE_EXPORT_FOLDER_ID` | Drive path (optional) | Drive folder id. Unset, the tool resolves `/deckpal/card_scans` by name and fails loudly if it cannot |
| `DRIVE_EXPORT_CROP_BUCKET` | Reading crops (optional) | Storage bucket holding retained crops. Defaults to `card-scans` |
| `SUPABASE_URL` | Reading crops | Storage origin. Must be https — the service-role key rides on the request |
| `SUPABASE_SERVICE_ROLE_KEY` | Reading crops | Server-side only |
| `DATABASE_URL` etc. | Reading exemplars | Whatever `@deckpal/db`'s `makePool` needs; load with `set -a && . ./.env && set +a` |

Per contract B11 these belong in `DEPLOYMENT.md`'s environment table. **They are
not there yet** — this tool was written in a worktree that does not own that
file, and adding those rows is outstanding.

## The filename convention

```
sv03.5_102_v-4471_sl-dragon-shield-matte-black_pl-frame_fv-3_d-20260904_e-918273.jpg
sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918273.jpg
```

Eight `_`-separated fields, then `.jpg`: set id, local id, `v-<variantId>`,
`sl-<sleeve slug>`, `pl-<pipeline>`, `fv-<frame pipeline version>`,
`d-<YYYYMMDD>` capture date in UTC, and `e-<exemplarId>` — optionally
`e-<exemplarId>-<frameIndex>` when the crop is one frame of a tilt sequence:

```
sv03.5_102_v-4471_sl-dragon-shield-matte-black_pl-frame_fv-3_d-20260904_e-918273-2.jpg
```

- The card identity leads, so an alphabetical listing groups every exemplar of
  one card together — the order somebody auditing a training set reads in.
- `e-<exemplarId>` is the exemplar's primary key, which is what makes names
  collision-free. The frame index is additive: a name without one is
  byte-identical to what the convention produced before that field existed, so
  adding it renames nothing already in the folder. It is needed when crops hang
  off a table keyed `(exemplar_id, frame_index)` — without it, up to sixteen
  crops of one capture share a name and fifteen are silently skipped as
  "already exported".
- `_` is reserved as the separator and no field may contain one, so parsing is
  exact rather than heuristic.
- The absent forms are `v.none` and `sl.none`. Those fields' slug alphabet has
  no dot, so the sentinel cannot be forged by a sleeve called "none".
- The sleeve slug is lossy on purpose (lowercased, de-punctuated, capped at 40
  characters). The exact label is in the manifest and in the file's own
  metadata; the exemplar id is the key back to the row.

Every field passes an allow-list before it lands in a name, so no path
separator, `..`, percent-escape, quote or whitespace can reach the filesystem or
the Drive query. `buildExportName` runs the finished name back through that
guard and throws rather than returning something the guard rejects.

`buildExportName` and `parseExportName` are a pure exported pair; the round trip
in both directions is asserted in `__tests__/naming.test.ts`.

## Embedded metadata

Each JPEG carries the same record three ways, because three different readers
exist:

- **XMP** — an `x:xmpmeta` packet in the `deckpal:` namespace
  (`https://deckpal.app/ns/scan/1.0/`). Exact, UTF-8, complete.
- **EXIF `IFD0.ImageDescription`** — one human sentence, for a file browser's
  properties pane.
- **EXIF `Exif.UserComment`** — the same record as compact ASCII JSON, for a
  reader that parses EXIF but not XMP.

A nullable field is always present and empty rather than omitted: an empty
`deckpal:variantId` means "no chosen printing", where a missing one would mean
"nothing wrote it".

`user_id` is deliberately **not** in the record. The export leaves the system;
who took the photograph does not need to.

The contributor's own camera metadata is stripped, not forwarded — measured on
sharp 0.35.3, `withMetadata({ exif })` merges with the input's EXIF and carries
the device make and GPS IFD straight through, where `withExif()` replaces the
block. `withMetadata({ xmp })` is silently ignored on that version; `withXmp()`
writes it. Both behaviours are pinned by reading the encoded bytes back in
`__tests__/export.test.ts`.

## Tests

```bash
node --import tsx --test tools/drive-export/__tests__/*.test.ts
```

`naming.test.ts` is pure: the filename convention, the consent gate and argument
parsing, with no network, no database and no image work. `export.test.ts` runs
the whole tool against a temp directory with the database and object store
injected as seams, and reads the encoded JPEGs back to prove the metadata is
really there and the contributor's really is not.

`tools/*` is not in `pnpm-workspace.yaml`, so `pnpm --filter @deckpal/drive-export test`
does not resolve yet; add `'tools/*'` to that file's `packages` list if you want
the filter form. The `node --import tsx` invocation above works either way.

## What is not covered

`fetchExemplarsFromDb` and `readCropFromObjectStore` have never been run.
`scan_exemplar` does not exist yet, and the crop bucket's real name needs the
owner's confirmation. Both are single, clearly-marked functions behind the
`fetchExemplars` / `readCrop` seams that everything else is tested through.

**Check the query against the schema that actually ships.** This tool was
specified against a `scan_exemplar` carrying its own `crop_object_key`. The
migration written alongside it puts retained crops on a child table,
`scan_exemplar_frame (exemplar_id, frame_index, …)`. If that is what lands, the
query needs a join to it and `frame_index` in the projection — everything
downstream already handles it, but the query does not do the join yet.
