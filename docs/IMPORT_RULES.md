# Excel Import — Rules (history & reconciliation)

Frontend-only. Reads only the sheet named exactly `Database` (ignores `Database
aktif` and the rest), handles the 83-column template and repeated headers, keeps
identifiers as strings, normalizes dates / mixed scores / height-weight units /
blank values, and preserves `R/P` and `N/A` as source codes. Data persists in
IndexedDB; re-import is idempotent.

## Identity vs history

A normalized `ID Personil` is ONE person (one master `StoredPersonnel`, keyed by
`businessKey`). The same person may legitimately appear on several rows — these
are kept as distinct `SourceImportRecord`s, never merged with "last row wins".

For every group of rows sharing an ID the importer decides again: **is this an
identical duplication, or a movement / exit / re-entry of the employee?** When the
evidence is not enough to decide, it does NOT guess — the group goes to review.

## Fingerprint (idempotency)

`businessFingerprint(fields)` is a deterministic token over normalized business
values only. It excludes `No`, the Excel row number, import time, and file name,
and embeds no raw values (safe to show). A source record's id is
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

**Auto-confirm** a placement change only when: exactly two distinct records, the
only business change is placement (plus the mutation date marking it), exactly one
record carries a `Tanggal Mutasi`, no exit involved, no identity conflict, and no
existing confirmed master to overwrite. Everything else → review.

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

Pending items appear on the Import page: ID + name, number of distinct records,
differing fields, side-by-side comparison, available dates, source row numbers,
reason, and a candidate interpretation clearly labeled "belum dikonfirmasi".
Reviewers (HR HO / Super Admin, within area scope) confirm a dup / correction /
profile change / mutation / placement-end / company-exit / re-entry / identity
conflict, or keep it pending. Confirmed events become career-timeline
`EmployeeMovement`s labeled "Import Excel", derived as a view over the IndexedDB
decisions (deterministic id `imp-ev:<reviewItemId>:<decisionVersion>` → re-confirm
reconciles instead of duplicating). Ambiguous items show in a separate
"Riwayat impor perlu ditinjau" section, never mixed with confirmed movements.

## What import never does

No auto company-exit, replacement need, fulfillment, or "mutasi berhasil" from
ambiguous records. One batch-summary notification + at most one "Data riwayat perlu
ditinjau" notice per import — never one per row. Raw source is never deleted.

## Storage (§13)

IndexedDB stores: `personnel` (master), `sourceRecords`, `reviewItems`, `batches`,
`exceptions`, `meta` (DB v2; v1 data preserved on upgrade). Confirmed timeline
events are derived, not written across stores, so no cross-store atomicity is
claimed. localStorage holds the demo/seed data; `conditionStatus` defaults to
CONFIRMED for all legacy/seed records.
