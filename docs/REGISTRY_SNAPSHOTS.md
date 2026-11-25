# Company registry snapshots (issue #29)

Kulgo resolves client-entered supplier/buyer names against a **locally stored
snapshot** of a public business registry. This slice supports **Estonia only**
(`EE`): the e-Business Register (*Äriregister*) basic-data CSV. No paid
service and no live per-tenant registry requests are made — the search runs
entirely server-side against the on-disk snapshot, so tenants' customer or
supplier names are never sent to any external service.

## Source and licence

- **Dataset:** Estonian e-Business Register basic data ("ettevotja lihtandmed"),
  refreshed daily by the Centre of Registers and Information Systems (RIK).
- **Download page:** <https://avaandmed.ariregister.rik.ee/en/downloading-open-data>
- **Direct CSV archive:** <https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip>
- **Licence:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) —
  attribute the Centre of Registers and Information Systems (RIK) when reusing the data.

The dataset contains only public data of legal entities currently in the
Business Register (statuses: registered, in liquidation, in bankruptcy).

## Setup (first run)

```bash
# 1. Download the daily archive (once; repeat for refreshes)
curl -L -o /tmp/ettevotja_rekvisiidid__lihtandmed.csv.zip \
  "https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip"

# 2. Unzip and place the CSV at the configured snapshot path
#    (default: apps/api/data/ettevotja_rekvisiidid__lihtandmed.csv)
mkdir -p apps/api/data
unzip -o /tmp/ettevotja_rekvisiidid__lihtandmed.csv.zip -d apps/api/data/
```

The snapshot path is configured via `EE_REGISTRY_SNAPSHOT_PATH` (see
`.env.example`). Relative paths resolve against the process working directory
(`apps/api` for `pnpm dev:api` / tests); set an absolute path in containers and
mount the CSV into the container. The `apps/api/data/` directory is
git-ignored — snapshots are never committed.

## Minimum repeatable operator refresh

The registry publishes the file once a day. Refresh safely with an atomic
replace (no restart needed — the API re-reads the file whenever its mtime or
size changes on the next search):

```bash
curl -L -o /tmp/ee.zip \
  "https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip"
unzip -o /tmp/ee.zip -d /tmp/ee-extract
# Atomic replace: rename over the old snapshot (never write in place)
mv /tmp/ee-extract/ettevotja_rekvisiidid__lihtandmed.csv \
   "$EE_REGISTRY_SNAPSHOT_PATH"   # e.g. apps/api/data/ettevotja_rekvisiidid__lihtandmed.csv
```

If the file is missing or corrupt, `POST /api/v1/workspace/company-registry/search`
returns `outcome: "SNAPSHOT_UNAVAILABLE"` and **ordinary workspace operations
are unaffected** — the snapshot is only consulted by the registry search.

## Parsed fields and status mapping

Only three columns of the official CSV are parsed (header names matched
case/diacritic-insensitively); all personal/contact fields (address, VAT
number, links, ...) are ignored by construction:

| CSV column                | Used as      | Notes                                             |
| ------------------------- | ------------ | ------------------------------------------------- |
| `nimi`                    | legal name   |                                                   |
| `ariregistri_kood`        | registry ID  |                                                   |
| `ettevotja_staatus`       | status       | `R` → `ACTIVE`; anything else (`L`, `N`, ...) → `INACTIVE` |

Format: UTF-8 (BOM tolerated), semicolon-separated, `\n`/`\r\n` line endings,
optionally quoted fields.

## API

`POST /api/v1/workspace/company-registry/search` (authenticated; body:
`{ "name": string, "countryCode"?: string|null, "registryId"?: string|null }`)
returns `{ outcome, candidates[], source }` where `outcome` is one of
`CONCLUSIVE_MATCH`, `CANDIDATES`, `NO_MATCH`, `UNSUPPORTED_COUNTRY`,
`SNAPSHOT_UNAVAILABLE`, and each candidate exposes only `legalName`,
`registryId`, `countryCode`, `source` (`EE_ARIREGISTER`) and `status`
(`ACTIVE`/`INACTIVE`), plus the source attribution metadata (dataset URL and
CC BY 4.0 licence link). Candidates are bounded (max 10).

Matching is conservative: a client-supplied registry ID never verifies
anything by itself; an ID/name conflict never silently attaches another
company; multiple plausible matches go to user choice; a genuinely exact,
unique name with matching country (and no registry ID supplied) or a
consistent ID is conclusive; an exact Estonia-only hit without country or ID
is offered as a candidate; a supplied registry ID that is missing from the
snapshot downgrades the name/country hit to a candidate choice, since the
input and the registry do not agree. Registry matching, publication, and
relationship confirmation remain separate facts.
