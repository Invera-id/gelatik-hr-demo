# Excel Import — Rules (history & reconciliation)

**Authoritative on the server** (`apps/api/internal/imports`, `internal/service/imports.go`).
The browser only uploads the file and renders the preview; it never sends parsed rows or
classifications, and the server would not trust them. (The original browser pipeline in
`apps/web/src/lib/import` remains only for the explicit `VITE_DATA_SOURCE=local` prototype.)

Reads only the sheet named exactly `Database` after trim + case-fold (ignores `Database
aktif`, no first-sheet fallback; two matches abort), handles the 83-column template,
reordered/extra/missing columns by header name and repeated headers by occurrence order,
keeps identifiers as strings, normalizes dates (Excel 1900/1904 serials, `21-Oct-00`,
`dd/mm/yyyy`, ISO) / mixed scores / height-weight units / blank values, and preserves
`R/P` and `N/A` as source codes. `.xlsx` only.

## Flow: upload → parse/validate → preview → confirm → commit

1. `POST /api/v1/imports/previews` (multipart). Limits: 20 MiB, 20 000 rows, 200 columns,
   zip-decompression caps, at most 2 concurrent previews. Corrupt/encrypted files abort.
2. The server parses, applies **area scope before reference discovery**, reconciles against
   the current database and stages the plan in `import_previews` (gzip JSON) bound to the
   caller, under a random token (only its SHA-256 is stored), expiring after
   `IMPORT_PREVIEW_TTL` (30 min). Expired, uncommitted previews are deleted on the next preview.
   **Nothing in master data, references or effective conditions changes.**
3. `POST /imports/cancel` discards the staging row.
4. `POST /imports/commit` under an advisory lock, in **one database transaction**:
   re-checks permission, verifies the caller's scope signature (`409 SCOPE_CHANGED`),
   recomputes a signature of every row the plan depends on (masters, source records, review
   items of the file's IDs, other pending count, areas, projects) and refuses with
   `409 PREVIEW_STALE` if anything changed; then writes everything or nothing. Committing the
   same preview again returns the original batch (`replay: true`). Another user's token → 404.

The raw workbook is never stored. Source rows (raw + normalized values) are kept in
`import_source_records` because history and review depend on them; they are visible only
through scope-checked endpoints. Nothing from workbook content is logged.

## Height / weight normalization (2026-11-10)

Same grammar as the manual entry form (`domain.ParseMeasurement`): text cells accept `60`, `60.5`, `60,5`, `60 kg`
(one decimal separator, at most 2 decimals); explicit units are converted (`g`→kg, `m`/`mm`→cm). Numeric Excel cells
are taken as-is. Values ≤ 0, more than 2 decimals (`1.234` could be a thousands separator), unknown units or unreadable
text (`abc`, `enam puluh`) are **not** normalized: the raw value is kept and a WARNING with row number and column name is
reported. Empty stays empty (never 0). No plausibility range is enforced (TBC).

Imported personnel are `SUBMITTED`; required documents (if configured) must be accepted before HR validation — import
never bypasses the document requirement or HR validation.

## Area scope

- Rows whose `Area CBS` is outside the importer's scope are listed as
  *"Di luar cakupan area — tidak diimpor."* and are not reconciled, cannot create areas or
  projects, and are not stored.
- Rows with empty `Area CBS` from a scoped importer become exceptions.
- If a Personnel ID already exists in an area outside the importer's scope, the row is
  excluded the same way, so the other area's data is never revealed through review items.

## Identity vs history

A normalized `ID Personil` is ONE person (one master `StoredPersonnel`, keyed by
`businessKey`). The same person may legitimately appear on several rows — these
are kept as distinct `SourceImportRecord`s, never merged with "last row wins".

For every group of rows sharing an ID the importer decides again: **is this an
identical duplication, or a movement / exit / re-entry of the employee?** When the
evidence is not enough to decide, it does NOT guess — the group goes to review.

## Fingerprint (idempotency) — version 2

`Fingerprint(fields)`: take every normalized field whose trimmed value is non-empty, sort by
key, join `key U+001F value` pairs with `U+001E`, SHA-256, keep the first 128 bits as hex,
prefix `v2:`. It excludes `No`, the Excel row number, import time, sheet and file name, and
embeds no raw values. `import_source_records.fingerprint_version` records the rule
(v1 was the browser's 32-bit FNV without separators, never stored server-side). A source record's id is
`${businessKey}:${fingerprint}`, so re-importing the same row overwrites it and
never duplicates. Rows that differ only by `No` share a fingerprint → one record.

## Classification (`classify.ts`)

| Kind | Trigger | Outcome |
|------|---------|---------|
| Identical duplicate | all rows share one fingerprint | one master, no event |
| Profile variation | only profile/data fields differ | review (don't pick "current" by row order) |
| Placement change | area/sub-area/project/position/outlet/TL differ | auto-confirm only if clear; else review |
| Exit | a row carries Tanggal/Alasan Keluar | review; reviewer picks placement-end vs employment-end |
| Re-entry | an exit date, then a join strictly later | review |
| Identity conflict | same ID, two different COMPLETE NoKTP | review; never auto-merged |
| Undetermined | anything else ambiguous | review |

The classifier marks a placement change as *auto-confirmable* only when: exactly two
distinct records, the only business change is placement (plus the mutation date marking
it), exactly one record carries a `Tanggal Mutasi`, no exit involved, no identity conflict.
Reconciliation (prototype and server alike) still routes it to **review** — the detected
movement type is shown as the candidate interpretation and `confirmedEvents` stays 0. No
event is ever applied automatically at import.

## Chronology (§6)

Effective date ≠ import time ≠ review time. `No`, row order, sheet order, and file
name are never chronology evidence. Same effective date with no other ordering
signal is ambiguous. New contract dates do not by themselves prove a mutation or
re-entry. Placement start/end are never filled with guessed dates. A complete NoKTP
is 15–16 digits with no masking; masked / blank / precision-lost identifiers are
never treated as a certain conflict.

## Conservative current status (§7)

- Single clean row / identical duplicates → `CONFIRMED` master.
- Existing confirmed master + older/ambiguous rows → condition unchanged; the new
  rows + a review item are added.
- New person with only ambiguous rows → `conditionStatus = NEEDS_REVIEW`; excluded
  from active-workforce / eligibility / fulfillment counts until reviewed.
- A person absent from a later file is never deleted or auto-exited.

## Review queue (§8) and timeline (§9)

Pending items (`GET /api/v1/imports`) are scoped by area (items without an area need
all-area scope) and require `view_import_review`; deciding requires
`resolve_import_review` and scope over both the current and the resulting area. A decision
(`POST /imports/reviews/{id}/decision`) is validated server-side (effective date for
placement/exit/re-entry, before/after records, re-entry after the latest exit), stored
append-only in `import_review_decisions`, and — in the same transaction — updates the master
(condition becomes CONFIRMED only when no other item for that person is pending), its
periods/placements, and writes one career event with `source_ref =
import-review:<item>:<version>`. Decided items are final: repeating a decision returns
`409 ALREADY_DECIDED`, so the timeline is never duplicated. `IDENTITY_CONFLICT` can only be
kept pending. A company exit (`EMPLOYMENT_END`) closes the employment period; a
`PLACEMENT_END` only closes the placement and is recorded as `OTHER`.

## What import never does

No auto company-exit, replacement need, fulfillment, or "mutasi berhasil" from
ambiguous records. One batch-summary notification + at most one "Data riwayat perlu
ditinjau" notice per import — never one per row. Raw source is never deleted.

## Storage

PostgreSQL tables: `import_previews` (staging), `import_batches`, `import_source_records`,
`import_exceptions`, `import_review_items`, `import_review_decisions`, plus `personnel`,
`employment_periods`, `placements`, `areas`, `projects`. New masters are created with
`record_status = SUBMITTED` (import ≠ HR validation) and `contract_status = NOT_AVAILABLE`.
Browser data from the old prototype is not uploaded automatically; re-import the source
workbook to move it to the server.
