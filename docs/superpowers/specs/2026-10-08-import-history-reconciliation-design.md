# Import History & Reconciliation — Design

Date: 2026-10-08
Status: Proposed (awaiting review)
Author: Alfaril Dzaky Praptana (with Claude)

## 1. Problem

The Excel import treats one normalized `ID Personil` as one master record and
merges every matching row with "last non-empty value wins" — in `parse.ts`
(rows within a file) and `plan.ts` (re-import across files). That silently
destroys history when several rows actually represent a placement change,
mutation, exit, or re-entry.

Synthetic driver case (ID-TEST000314): two rows, same person and NoKTP, but
Area CBS YOGYAKARTA vs SOLO, same Tanggal Mutasi (7-Sep-26), and one row carries
Tanggal Keluar + Alasan Keluar while the other does not. These are two distinct
records with a possible movement/exit whose order must be reviewed — not a
duplicate to collapse, and not proof of a single "current" row.

**Core goal:** for every group of rows sharing a normalized ID, decide again
whether it is an *identical duplication* (one master, no new event) or a
*movement/exit/re-entry* (legitimate history). When evidence is insufficient to
decide, do not guess — route to a review queue. This discriminator replaces
"last row wins".

## 2. Constraints carried from AGENTS.md / existing rules

- Frontend-only demo. No backend, no external API. Synthetic/dummy data only.
- Keep import rules: read only the `Database` sheet; ignore `Database aktif` and
  others; handle 83 columns and repeated headers; identifiers stay strings;
  normalize dates/mixed scores/height-weight units/blank values; preserve `R/P`
  and `N/A` as source codes; persist data; keep re-import idempotent.
- Persistence stays IndexedDB (imported data) + localStorage (demo/seed data).
  Do **not** claim atomic transactions across the two stores (§13).
- Keep unrelated features working. Avoid overengineering: functional UI, not
  fancy; the value is in the engine + conservative semantics.

## 3. Scope decisions (confirmed with stakeholder)

1. **Faithful but pragmatic**: full classification/reconciliation engine +
   separate source-record store + review queue with confirmation actions +
   career-timeline integration + all 20 §15 tests. UI functional, not elaborate.
2. **Review queue location**: a section on the existing Import page with a
   pending badge. No new route/nav entry.
3. **Unknown current condition**: a new explicit field
   `Employee.conditionStatus: 'CONFIRMED' | 'NEEDS_REVIEW'`, default `CONFIRMED`
   for all existing/seed data; views surface a badge and exclude
   `NEEDS_REVIEW` from active-workforce / eligibility / fulfillment counts.

## 4. Data model

### 4.1 `Employee` (src/types.ts)
Add:
```ts
conditionStatus: 'CONFIRMED' | 'NEEDS_REVIEW'
```
- Default `CONFIRMED` for seed data, localStorage-loaded data (migration in
  `loadData`), form-created employees, and single-clean-row imports.
- `NEEDS_REVIEW` only when the current condition genuinely cannot be
  determined (new person whose only records are ambiguous).

### 4.2 `SourceImportRecord` (new, src/lib/import/types.ts)
One per distinct source row kept losslessly (§4 "Catatan sumber impor"):
```ts
interface SourceImportRecord {
  id: string                 // `${businessKey}:${fingerprint}` — idempotent key
  businessKey: string        // master ref (normalized ID Personil)
  personnelId: string        // original string ID (provenance)
  name: string
  batchId: string
  fileName: string
  sheetName: string
  rowNumber: number          // Excel 1-based row (provenance, NOT chronology)
  raw: Record<string, string | number | boolean | null>
  fields: Record<string, string | null>   // normalized business fields
  structured: PersonnelStructured
  fingerprint: string        // opaque business-content token (see §6)
  warnings: FieldIssue[]
  reconciliationStatus: 'IDENTICAL' | 'LINKED' | 'PENDING_REVIEW' | 'CONFIRMED'
  createdAt: string
}
```

### 4.3 `ReviewItem` (new, src/lib/import/types.ts)
One per thing a reviewer must decide (§8). Deterministic id so re-import /
re-confirmation never duplicates:
```ts
type ReviewKind =
  | 'IDENTICAL_DUPLICATE' | 'PROFILE_VARIATION' | 'PLACEMENT_CHANGE'
  | 'EXIT' | 'REENTRY' | 'IDENTITY_CONFLICT' | 'UNDETERMINED'

type ReviewStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'KEPT_PENDING'

interface ReviewDateFact { label: string; value: string | null }

interface ReviewItem {
  id: string                 // deterministic: `rv:${businessKey}:${kind}:${contentHash}`
  businessKey: string
  personnelId: string
  personnelName: string
  kind: ReviewKind
  recordIds: string[]        // SourceImportRecord ids involved
  diffFields: string[]       // business fields that differ across records
  dates: ReviewDateFact[]    // available effective dates (labeled, not inferred)
  rowNumbers: number[]
  reason: string             // why this needs review
  candidate: {               // proposed interpretation, explicitly unconfirmed
    label: string
    movementType?: EmployeeMovementType
    note: string
  } | null
  status: ReviewStatus
  resolution: {
    decisionKind: ReviewKind
    movementType?: EmployeeMovementType
    effectiveDate?: string | null
    exitScope?: 'PLACEMENT_END' | 'EMPLOYMENT_END'
    previousRecordId?: string | null
    afterRecordId?: string | null
    note: string
    reviewedBy: string
    reviewedAt: string
    decisionVersion: number  // bumped on re-decision; feeds event id → idempotent
  } | null
  createdAt: string
  updatedAt: string
}
```

### 4.4 Master `StoredPersonnel`
Unchanged in shape except its `employee` now carries `conditionStatus`. It stays
the identity + confirmed current condition, keyed by `businessKey`.

## 5. IndexedDB migration (no wipe)

`DB_VERSION` 1 → 2. `onupgradeneeded` creates two stores and preserves the three
existing ones:
- `sourceRecords` — keyPath `id`, index on `businessKey`.
- `reviewItems` — keyPath `id`, index on `businessKey`, index on `status`.
- existing `personnel` / `batches` / `exceptions` untouched (data survives).

`commit(plan)` is extended to write masters, source records, review items,
batches, and exceptions in one IndexedDB readwrite transaction across the
relevant stores (atomic within IndexedDB). Confirmed import events are derived,
not a separate store (see §8). Idempotency guarantees:
- Re-importing an identical row → same `sourceRecords.id` → `put` overwrites,
  no new business record, no new review item.
- Re-deciding a review item bumps `decisionVersion`; derived event id includes
  it, so the timeline reconciles rather than duplicating.

## 6. Engine (pure, no I/O)

New modules under `src/lib/import/`:

### 6.1 `fingerprint.ts`
- `businessFingerprint(fields, structured) -> string`: deterministic token from
  normalized business values **only**. Excludes No, rowNumber, import time,
  fileName, sheet order. Implemented as a stable stringify of a whitelisted set
  of business fields + structured, hashed to a short base36 token. The token is
  opaque — no raw PII is embedded in what logs/UI show.
- `diffBusinessFields(a, b) -> string[]`: list of differing business fields
  (used for classification and the side-by-side UI).
- `PLACEMENT_FIELDS` = area/subArea/project/position; `PROFILE_FIELDS` = phone,
  address, etc.; `EXIT_FIELDS` = exitDate/exitReason. Drives classification.

### 6.2 `classify.ts`
`classifyGroup(records: SourceImportRecord[]) -> GroupClassification` following
§5 + §6:
- **A Identical duplicate**: all records share one fingerprint ⇒ one master, no
  event. (No, rowNumber, date display format, insignificant case/space ignored
  because they are not in the fingerprint.)
- **B Profile variation**: differences only in `PROFILE_FIELDS`. Not a movement.
  If update order unknown, keep variants and flag fields for review; never pick
  "current" by row order.
- **C Placement change**: differences in `PLACEMENT_FIELDS`. Auto-confirm a
  movement **only if** before/after determinable, effective date supported by
  source, order clear, and no conflicting signals. Otherwise → candidate for
  review. (Excel-only data rarely satisfies all four by design.)
- **D Exit**: exitDate/exitReason present. Distinguish employment-end vs
  placement-end vs correction vs unclear — never inferred from reason keywords;
  requires reviewer choice.
- **E Re-entry**: requires evidence of a prior exit AND a later join/entry. Same
  joinDate across rows is NOT enough.
- **F Identity conflict**: same ID, different *complete* NoKTP. Never auto-merge;
  queue. Masked/blank/precision-lost identifiers are not treated as certain
  conflicts (reuse `normalizeIdentifier` masked/precisionLoss signals).
- Chronology rules (§6): effective date ≠ import time ≠ review time. No,
  row/sheet order, and filename are never chronology evidence. Same effective
  date with indeterminable order ⇒ ambiguous. New contract dates do not by
  themselves prove mutation or re-entry. Never fill placement start/end with
  guessed dates; show known vs unknown explicitly.

### 6.3 `reconcile.ts` (replaces the planning role of `plan.ts`)
`reconcile(existing, parsed, options) -> ImportPlan` where existing includes
stored masters **and** stored source records. Produces:
- `mastersToPut`: new masters (conservative condition) and conservative updates
  to existing masters (identity/profile only; never downgrade a confirmed
  condition from an older/ambiguous record; §7, §11).
- `sourceRecordsToPut`: all new distinct source records (deduped by id).
- `reviewItemsToPut`: new/updated review items (deduped by id; existing
  CONFIRMED/DISMISSED decisions preserved).
- `autoConfirmedEvents`: only §5C all-gates-pass cases.
- `summary`: §14 counts.

Cross-file reconciliation (§11): identical row re-found ⇒ idempotent, no new
business/review. Different row ⇒ compared to stored source records + confirmed
condition. Correction-on-next-file ⇒ candidate correction (not auto movement)
unless a record identifier proves it. Record absent from a new file ⇒ no
deletion, no implied exit. Same name different ID ⇒ no auto-merge.

## 7. Conservative current status (§7)

- Single clean row, or identical duplicates differing only by No ⇒ one
  `CONFIRMED` master, current condition set as today.
- Existing confirmed master + ambiguous incoming ⇒ keep confirmed condition; add
  source records + review candidates; do not change employmentStatus.
- New person, only ambiguous records ⇒ store identity + all source records,
  `conditionStatus = NEEDS_REVIEW`; employmentStatus is set best-effort but the
  record is excluded from active-workforce/eligibility/fulfillment counts and
  shows a "Perlu ditinjau" badge until a reviewer confirms.

## 8. Career timeline integration (§9)

Confirmed events (auto-confirmed at import, or confirmed via review) are derived
into the existing `EmployeeMovement` shape with `createdBy` marker and notes
prefixed with an "Import Excel" source label, then merged into the timeline
**view** in DemoContext (same pattern as `combinedEmployees`). This avoids a
cross-store transaction: the IndexedDB review resolution is the source of truth;
the timeline reads a merged, de-duplicated list keyed by deterministic event id
(`imp-ev:${reviewItemId}:${decisionVersion}`). Re-confirmation reconciles the
existing event instead of adding a new one; raw source is never deleted.

Pending review items for a person appear in a separate
"Riwayat impor perlu ditinjau" section on the employee detail page — never mixed
with confirmed movements.

## 9. Review queue UI (§8)

A section on the Import page, with a pending-count badge. Per item: ID + name,
number of distinct records, differing fields, side-by-side comparison, available
dates, source row numbers, reason, and the candidate interpretation clearly
labeled "belum confirmed". Actions per case: confirm identical-duplicate, data
correction, profile change, mutation/placement change, placement end, company
exit, re-entry, identity link, or **keep pending**. Movement confirmation asks
before/after record + movement type + effective date + note; exit confirmation
asks placement-end vs employment-end. Reviewers are limited to HR_HO /
SUPER_ADMIN within their allowed area scope (`allowedAreaIds`). The list is
capped/paginated for large batches.

## 10. Notifications (§10)

- One batch-summary notification per import (extend existing
  `buildImportSummary`).
- Ambiguous groups produce one "Data riwayat perlu ditinjau" notice to
  authorized reviewers — not one per row; mass import does not create thousands
  of notifications.
- No auto company-exit, replacement need, fulfillment, or "mutasi berhasil"
  from ambiguous records. Historical exits from import never trigger an active
  replacement need; replacement stays behind explicit business confirmation.
- Confirmed movement/exit via review reuses existing notification paths.
  Newly-discovered historical events are distinguished from new events; old
  history does not flood toasts.

## 11. Summary counts (§14)

Extend `ImportSummary`: nonEmptyRows, uniqueIdentities, newMasters,
newSourceRecords, identicalDuplicates, movementCandidates,
exitReentryCandidates, ambiguousCases, identityConflicts, confirmedEvents,
warningRows, blankRowsSkipped. UI states explicitly that rows ≠ personnel and
never claims "all movements processed" while items remain pending.

## 12. Permissions / scope

Review actions require HR_HO or SUPER_ADMIN and the existing `edit_employee`
permission, scoped by `allowedAreaIds`. No new permission type is introduced
(avoid overengineering). The review section is hidden/disabled otherwise
(§8, test 19).

## 13. Files touched

- `src/types.ts` — add `conditionStatus`.
- `src/lib/import/types.ts` — `SourceImportRecord`, `ReviewItem`, extended
  `ImportSummary`, plan shape.
- `src/lib/import/parse.ts` — stop merging same-ID rows; emit per-row records +
  in-file grouping metadata.
- `src/lib/import/fingerprint.ts`, `classify.ts`, `reconcile.ts` — new engine
  (reconcile replaces plan.ts's role; plan.ts removed or thinned).
- `src/lib/import/repository.ts` — DB v2 migration, new stores, extended commit,
  review resolve/write-back, derived-events read.
- `src/lib/import/service.ts` — wire reconcile; extended result/summary.
- `src/lib/import/toEmployee.ts` — set `conditionStatus`; build master from a
  chosen source record conservatively.
- `src/context/DemoContext.tsx` — merge confirmed import events into the
  timeline view; expose review queue + `resolveReviewItem`; localStorage
  migration for `conditionStatus`; conservative merge into `combinedEmployees`.
- `src/pages/ImportPage.tsx` — review-queue section + badge + updated summary.
- `src/pages/EmployeeDetailPage.tsx` — "Riwayat impor perlu ditinjau" section +
  condition badge.
- `src/components/CareerTimeline.tsx` — show "Import Excel" source label.
- `src/lib/businessRules.ts` / dashboard/analytics — exclude `NEEDS_REVIEW`
  from active-workforce / eligibility counts; surface unclassified counts where
  relevant.
- `src/lib/notifications/events.ts` — "Data riwayat perlu ditinjau" notice.
- Docs: import rules + DEMO_PROGRESS.

## 14. Testing (§15 — all 20)

Pure-engine + repository + one DemoContext/review integration test, synthetic
fixtures only:
1. Same ID, identical business data, only No differs → one master, no event.
2. Two records like the driver case (area differs, same mutation date, one has
   exit) → classified distinct with movement + exit candidates, pending review.
3. Row order swapped → same classification.
4. Mutation with clear before/after chronology → confirmable.
5. Phone change only → profile variation, no movement.
6. Exit date that is a placement end → reviewer-selectable, not auto.
7. Confirmed company exit.
8. Exit then re-entry with clear dates.
9. Same joinDate alone does not become re-entry.
10. Different complete NoKTP for same ID → identity conflict queue.
11. Masked identifier not treated as certain conflict.
12. Re-import does not duplicate records or review items.
13. Re-confirmation does not duplicate events.
14. Older historical record does not overwrite a newer confirmed condition.
15. Person missing from a later file is not auto-exited.
16. Ambiguous records create no replacement need.
17. Pending review not counted as active workforce.
18. Refresh preserves source records and review decisions.
19. Permission/scope enforced on the review section.
20. 3,000-row file still processes with a responsive UI.

Plus: `npm run lint`, `tsc`, `npm test`, `npm run build`, and a manual smoke of
import → review → confirm → detail → timeline → refresh.

## 15. Assumptions / open business policy (implemented as pending-review, not invented)

- The meaning of an exit (employment-end vs placement-end) is never inferred;
  the reviewer decides.
- Identity merge policy for same-NoKTP-different-ID is undefined business
  policy → kept as a review candidate, not auto-merged.
- Auto-confirm of placement change requires all four §5C gates; by default
  Excel-only evidence routes to review. This is intentional, not a limitation.
