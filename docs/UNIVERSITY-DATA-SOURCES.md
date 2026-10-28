# University directory provenance

The institution directory and individual degree-program records are different data layers. A directory entry establishes that a name, country and website were present in the source snapshot. It does **not** establish accreditation, current operation, international-student admission, degree availability, tuition, scholarships, deadlines or admission requirements.

## Source

- Provider: Hipo, **University Domains and Names Data List**.
- Repository: <https://github.com/Hipo/university-domains-list>.
- Dataset: <https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json>.
- License: MIT, <https://raw.githubusercontent.com/Hipo/university-domains-list/master/LICENSE.txt>.
- Copyright and complete license notice: [third-party/HIPO-LICENSE.txt](third-party/HIPO-LICENSE.txt).
- Local normalized snapshot: `Server/data/institutions.json`.

The provider describes a community-maintained list of university names, domains and countries, invites corrections, and includes colleges and other higher-education providers. This is a useful discovery directory, **not an official worldwide accreditation register or a complete census**. Its 200 country/territory codes include dependent territories and the provider's `XK` code. The number is not a count of sovereign states.

The snapshot records the retrieval date, upstream SHA-256, source URL, source record count, merged duplicate count and rejected record count in `metadata`. A retrieval date is not a date of independent institutional verification. A website is copied from the source and is not guaranteed to remain active or official.

## Transformation

- Original institution names are retained with Unicode and whitespace normalization.
- Countries use Georgian names from `Intl.DisplayNames`, with an English fallback. Original English country names and provider country codes remain available.
- IDs hash country code, normalized canonical domain and normalized institution name. Identical source rows retain the same ID across refreshes. An upstream rename or domain change can legitimately produce a new ID.
- Only duplicate identity keys are merged. Independent schools sharing a parent domain remain separate.
- Public HTTP(S) websites are retained; script URLs, credentials, IP addresses and invalid domains are rejected.
- No city is inferred from a university name. Unknown cities are `null`; source state/province values are preserved.
- Broad geographic regions support discovery. These are not EU membership, visa rules or scholarship eligibility. For example, geography alone never determines whether an applicant qualifies for funding.
- No program, fee, language, degree, deadline, scholarship, match score or probability is invented for directory entries.

## Refresh and validation

```powershell
node scripts/sync-institutions.js
node scripts/check-catalog.js
```

The refresh downloads the upstream JSON and MIT license, validates records, and writes the local snapshot atomically. It never connects to or modifies MongoDB. A source reduction of more than 10% requires manual review instead of replacing an existing snapshot automatically.

For a previously downloaded source and license:

```powershell
node scripts/sync-institutions.js --input path/to/world_universities_and_domains.json --license-file path/to/LICENSE.txt --retrieved-at 2026-10-27
```

The timestamp must describe actual retrieval, not independent verification. An upstream dataset refresh does not update program-specific facts: those must be checked against each program's official sources and review dates separately.

## Optional MongoDB import and JSON export

`Server/seed.js` no longer generates synthetic universities or clears a database. Its default is a **dry run** that reads the local institution and program snapshots, validates the directory, resolves every program to its institution through `CatalogCore.attachInstitutionPrograms`, and prints counts. It does not load database credentials or connect to MongoDB in this mode.

```powershell
node Server/seed.js
node Server/seed.js --dry-run
node Server/seed.js --export Server/data/catalog-export.json
```

An export is a validated combined `{ metadata, institutions, programs }` snapshot. The destination must be a JSON file inside the project and cannot overwrite the source catalogs or package manifests. Both original source metadata objects remain in the export. Program institutions that cannot be resolved cause import/export to fail rather than silently creating a new or guessed institution.

Persisting to MongoDB requires the explicit `--write` flag and the existing `MONGO_URI` in `Server/.env`:

```powershell
node Server/seed.js --write
```

This optional command upserts by stable `id` into the separate **`institutions`** and **`studyprograms`** collections, with unique ID indexes and batches of at most 500 records. It never deletes existing records, drops a collection, or merges former fabricated records from the legacy `universities` collection. Old records absent from a later source snapshot are retained in MongoDB; reconcile removals separately after reviewing their provenance. An interrupted import can be rerun because upserts reuse the same stable IDs. Database connections are closed in `finally`, including failures.

The website's public catalog reads the validated local snapshot files; this optional persistence step is not required for browsing universities or running the selection logic.

## Safety checks

```powershell
node --test tests/directory.test.js
```

These checks cover stable IDs, conservative deduplication, invalid source rows, unknown program facts, unsafe URLs, geographic count consistency, credential-free dry runs, protected export destinations, and idempotent non-destructive upserts using an in-memory collection double. Tests do not execute an actual MongoDB import.
