# Project Instructions

Full-stack monorepo for GELATIK HR PROJEK (PT Gelatik Supra, developed by Invera):
`apps/web` (React/Vite), `apps/api` (Go/Fiber/PostgreSQL), `packages/contracts` (OpenAPI).

Read these files before modifying code:
- docs/BACKEND_PROGRESS.md (architecture, feature matrix, assumptions/TBC, limitations)
- docs/IMPORT_RULES.md (Excel import & reconciliation rules)
- docs/REQUIREMENTS_2026-11-10.md (contract monitoring, required documents, input validation; open business questions incl. "4 tahun" and finance target)
- docs/DEMO_SPEC.md (original requirements; older parts mention Laravel/Inertia/SQLite — the actual stack is React/Vite + Go/Fiber + PostgreSQL)

Rules:
- Use synthetic data only. Never commit, log, or screenshot real Gelatik personnel data or internal workbooks. No secrets in the repo or in `VITE_*` variables.
- The server is the authority for authentication, permissions, area scope and every business rule; frontend checks are UX only.
- Pending changes must never become effective without validation; keep history (no hard deletes of business history).
- Identifiers (Personnel ID, NIK, rekening, NPWP, BPJS) are strings. NIK is not assumed complete, valid, or unique.
- Keep business logic in pure, testable code (`apps/api/internal/domain`, `apps/api/internal/imports`); HTTP in `internal/api`; transactional workflows in `internal/service`.
- Every API change updates `packages/contracts/openapi.yaml` and regenerates types (`npm run contracts:generate`); the Go drift test and `npm run contracts:check` must pass.
- Schema changes are new versioned migrations in `apps/api/internal/db/migrations` (never edit an applied one).
- Do not add payroll, attendance, BPJS/email/WhatsApp integrations, AI/ML, microservices, brokers, or other out-of-scope modules. Avoid overengineering.
- Documents: files only in private storage (`internal/storage`), never public or base64 in tables; upload never approves; final validation requires accepted required documents. Do not invent mandatory document lists, the "4 tahun" rule, or finance metrics.
- Business assumptions (exact matching, SLA 3 working days Mon–Fri, contract gate, validation ownership, quota, turnover formula) are TBC — do not present them as final policy.
- Run lint/test/build for the components you change (`make check`); Go integration tests need PostgreSQL (`docker compose up -d db`).
- Update docs/BACKEND_PROGRESS.md when completing a phase.
- Do not commit, push, change repository visibility, or deploy without explicit instruction.
