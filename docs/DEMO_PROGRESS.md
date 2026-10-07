# Demo Progress

- [ ] Phase 1 Project inspection
- [ ] Phase 2 Types and dummy data
- [ ] Phase 3 Auth and RBAC simulation
- [ ] Phase 4 Employee master
- [ ] Phase 5 Employee movement
- [ ] Phase 6 Validation
- [ ] Phase 7 Fulfillment
- [ ] Phase 8 Dashboard
- [ ] Phase 9 Testing

## In-app notifications (frontend-only)

- Bell + unread badge in the topbar, `/notifications` inbox (filter Semua/Belum dibaca + kategori, tandai dibaca, arsipkan, pagination), and transient toasts.
- Business events are emitted from the DemoContext action layer (not the reducer) after a change is saved: entry/basic-edit submission & result, exit submission/result + replacement-need, movement submission/result, match, fulfillment, re-entry, import summary/failure, plus contract (D-7/EXPIRED only) and over-SLA reminders.
- Persisted in `localStorage` (`gelatik-notifications-v1`), per-recipient read/archive/resolve state, idempotent dedupe keys (survive refresh/StrictMode/double-click/re-login). Cross-tab sync via BroadcastChannel + storage events. Recipients follow `allowedAreaIds` / `hasPermission` / `canValidateTransaction` / validation policy.
- Priority flow: Area Supporting submits Employee Entry → authorized HR HO is notified → "Lihat Pengajuan" opens `/validation?focus=<id>` → validate/revise → submitter is notified; re-submit after revision is a new cycle.
- Modules: `src/lib/notifications/{types,rules,events,reminders,repository,service}.ts`, `src/context/NotificationContext.tsx`, components `NotificationBell`, `NotificationList`, `Toaster`, page `NotificationsPage`.
- Import report now lists which rows were duplicates (merged) in addition to warnings/exceptions, with a downloadable issue report.
- Fix: exit/movement/validation/notifications now work for IndexedDB-backed imported personnel (actions look up the combined source and write status changes back to IndexedDB).
- Limitation: frontend-only — no cross-device delivery or guaranteed background delivery; different demo users in the same browser each have their own inbox.