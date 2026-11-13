# Backend & Full-Stack Progress — GELATIK HR PROJEK

Status per 2026-11-11 (tahap 8: requirement 10 Nov — lihat `docs/REQUIREMENTS_2026-11-10.md`). Monorepo: `apps/web` (React/Vite), `apps/api` (Go 1.25+/Fiber v3/pgx v5/PostgreSQL 17), `packages/contracts` (OpenAPI 3.1).

Legend: ✅ selesai · 🟡 sebagian / dengan batasan · ⛔ belum / terhambat

## 1. Tahapan

| # | Tahap | Status | Catatan |
|---|---|---|---|
| 1 | Inspeksi, baseline, matriks fitur, keputusan arsitektur | ✅ | Baseline sebelum perubahan: lint ✓, build ✓, test 205/206 (1 gagal sejak sebelumnya, lihat §9) |
| 2 | Restrukturisasi monorepo (`git mv` ke `apps/web`, npm workspace) | ✅ | Riwayat git dipertahankan; lockfile lama dipakai ulang lalu dimigrasikan ke workspace |
| 3 | Database, migration, konfigurasi, authN/authZ | ✅ | `0001_init.sql`, sesi opaque server-side, CSRF, throttling, RBAC + scope di server |
| 4 | Employee/project, pengajuan, validasi, movement, replacement | ✅ | Transaksional, optimistic concurrency, idempoten |
| 5 | Import/review, dashboard/analytics/export, notifikasi | ✅ | Import otoritatif di server; reminder berjalan di server |
| 6 | Integrasi frontend | ✅ | `ApiDemoProvider` + `ApiNotificationProvider`; mode lokal hanya via `VITE_DATA_SOURCE=local` |
| 7 | Pengujian akhir, CI, dokumentasi | ✅ | Lihat §8 untuk hasil yang benar-benar dijalankan |
| 8 | Requirement 10 Nov: monitoring kontrak terkonfigurasi, dokumen wajib + storage privat, dashboard compliance, validasi tipe data | ✅ / 🟡 | Migration `0002`. Arti "4 tahun", daftar dokumen wajib, dan target finance menunggu keputusan bisnis (⛔ finance belum diimplementasikan) |

## 2. Keputusan arsitektur

- **Satu backend modular**: `internal/api` (transport Fiber), `internal/service` (workflow transaksional + SQL), `internal/domain` & `internal/imports` (aturan murni, tanpa I/O), `internal/auth`, `internal/access`, `internal/db` (pool, migration ter-embed, helper transaksi).
- **Fiber v3.7.0** dengan `Immutable: true` (string request tidak dipakai ulang fasthttp setelah handler selesai); DB memakai `c.Context()` dengan timeout per request, bukan `fiber.Ctx` yang disimpan.
- **Skema** memisahkan: identitas personel (`personnel`, berikut proyeksi kondisi efektif), periode kerja (`employment_periods`), penempatan (`placements`), pengajuan (`change_requests`), keputusan validasi append-only (`validation_decisions`), histori (`career_events`, unik per `source_ref`), replacement (`replacement_needs`, unik per exit), data sumber impor (`import_source_records`), review (`import_review_items` + `import_review_decisions`), notifikasi per penerima, audit (`audit_log`).
- **Pending tidak pernah efektif**: entry belum tervalidasi tidak dihitung aktif; basic edit/movement/exit disimpan sebagai `change_requests` dan baru diterapkan saat validasi. Basic edit dan movement menyimpan `base_version`; exit menyimpan `base_period_id` → pengajuan usang ditolak `409 STALE_REQUEST`.
- **Idempotensi & konkurensi**: unique index (satu pengajuan terbuka per personel+jenis, satu need per exit, satu alokasi aktif per kandidat, `career_events.source_ref`, `notifications.dedupe_key`, `client_ref` notes/flags), `SELECT … FOR UPDATE`, advisory lock untuk impor/migration/reminder.
- **Permission per request**: role config dibaca dari DB setiap request → perubahan permission langsung berlaku pada sesi aktif. Tidak ada klaim permission di cookie.
- **Frontend**: kontrak `DemoContextValue` dipertahankan agar route/tampilan tetap; provider API memuat *workspace* (referensi) dan *snapshot* ter-scope dari server (profil diringkas; profil lengkap hanya dari endpoint detail). List employee memakai pagination/filter/sort server-side; export dibuat server; impor diparse server. Lihat §7 untuk batasan pola snapshot.

## 3. Matriks fitur → aturan → endpoint → permission/scope → tabel → test

| Fitur / halaman | Aturan bisnis utama | Endpoint (`/api/v1`) | Permission / scope | Tabel | Test |
|---|---|---|---|---|---|
| Login/logout/me | argon2id, sesi opaque, rotasi saat login, CSRF, throttling 5/email & 30/IP per 15 menit, pesan generik | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | publik / sesi | users, sessions, login_attempts | `TestAuthentication` |
| Role, permission, scope | 5 role, OWN_AREA / SELECTED_AREAS / ALL_AREAS; Super Admin terkunci; admin terakhir dilindungi | `PUT /settings/roles/{role}`, `POST /settings/roles/reset`, `PUT /settings/validation-policy/{t}`, `GET/POST /users`, `PATCH /users/{id}` | manage_roles / manage_validation_policy | role_configs, validation_policy, users | `TestAreaScopeAndReadOnly` |
| Area, project, quota | project unik per area; area tak bisa dipindah bila dipakai | `POST/PUT /projects`, `POST /projects/{id}/status`, `PUT /projects/{id}/quotas/{period}` | manage_project, toggle_project_status, manage_project_quota + scope | areas, projects, project_quotas | 🟡 belum ada test integrasi khusus (perilaku sederhana; validasi input di service) |
| Employee master/detail/search | scope area; luar scope → 404 | `GET /employees` (page ≤200, q, filter, sort), `GET /employees/{id}`, `GET /snapshot`, `GET /workspace` | view_employee + scope | personnel (+ requests, events) | `TestAreaScopeAndReadOnly` |
| Entry, basic edit | entry DRAFT→SUBMITTED→VALIDATED/REVISION_REQUIRED; basic edit = pengajuan, placement tidak boleh berubah | `POST /employees`, `PUT /employees/{id}`, `POST /employees/{id}/validation`, `POST /employees/validate-bulk` | create_employee, edit_employee_basic, validate_employee_entry_edit (+bulk_validate) + policy + scope | personnel, change_requests, validation_decisions | `TestEntryValidationExitReplacementFlow` |
| Movement (promotion/mutation/…) | lintas area butuh scope asal & tujuan; stale → 409 | `POST /employees/{id}/movement-request`, `POST /change-requests/{id}/validation` | request_placement_change / validate_placement_change + policy | change_requests, placements, career_events | integration (alur) |
| Exit | satu pengajuan terbuka; validasi menutup periode & penempatan; need tepat sekali | `POST /employees/{id}/exit-request`, `POST /change-requests/{id}/validation` | request_employee_exit / validate_employee_exit | change_requests, employment_periods, replacement_needs | validasi paralel 4× → 1 sukses, 1 need |
| Re-entry | identitas sama, periode baru, harus setelah exit terakhir | `POST /employees/{id}/reentry` | reentry_employee + scope asal & tujuan | employment_periods, placements, career_events | integration |
| Notes, flags | append-only, idempoten per `clientRef` | `POST /employees/{id}/notes`, `/flags` | manage_employee_notes_flags | employee_notes, employee_flags | integration |
| Replacement matching/fulfillment/chain | exact Area+Project+Position; kandidat aktif, bukan NEEDS_REVIEW, satu alokasi; fulfillment: VALIDATED, kontrak SIGNED, join ≥ exit; gap Senin–Jumat; chain via `previous_need_id` | `GET /replacements/{id}`, `POST …/match`, `POST …/fulfill` | view/match/fulfill_replacement + scope | replacement_needs, career_events | `TestConcurrentMatchAllocatesCandidateOnce`, domain tests |
| Dashboard, analytics | KPI dari snapshot ter-scope yang sama dengan export | `GET /dashboard`, `GET /snapshot` | view_dashboard / view_analytics | — | integration (konsistensi dashboard↔export) |
| Export | 5 jenis; permission, scope, filter; netralisasi formula | `GET /exports/{kind}` | export_data + scope | audit_log | `TestWriteXLSXNeutralizesFormulas`, integration |
| Import Excel | lihat `docs/IMPORT_RULES.md` | `POST /imports/previews`, `/imports/commit`, `/imports/cancel`, `GET /imports`, `GET /imports/batches/{id}/exceptions` | import_personnel + scope | import_* , personnel, areas, projects | `TestImportLifecycle`, `internal/imports` tests |
| Review impor | keputusan final; IDENTITY_CONFLICT hanya bisa KEPT_PENDING; tanggal efektif wajib | `POST /imports/reviews/{id}/decision` | view_import_review + resolve_import_review + scope | import_review_items, import_review_decisions, career_events | `TestImportLifecycle` |
| Notifikasi | dibuat dalam transaksi bisnis; dedupe per penerima; read/archive per penerima; reminder kontrak/SLA oleh server | `GET /notifications`, `POST /notifications/mark` | view_notifications; hanya milik sendiri; scope dicek ulang saat dibaca | notifications | integration |
| Monitoring kontrak | status dari tanggal berakhir + ambang global terkonfigurasi; tanggal bisnis Asia/Jakarta; per personel | `GET /contracts/monitoring`, `GET/PUT /settings/contract-monitoring` | view_employee + scope / manage_contract_monitoring | contract_monitoring_settings | `TestEvaluateContract*`, `TestComplianceDashboardMatchesDetailLists` |
| Dokumen pengajuan | versi immutable; upload = PENDING_REVIEW; tolak wajib alasan; validasi akhir diblokir bila wajib ≠ ACCEPTED; storage privat, tipe diverifikasi isi | `GET /employees/{id}/documents`, `GET /documents/catalog`, `GET /documents/queue`, `POST /documents/subjects/…`, `POST /documents/versions/{id}/review`, `GET …/content`, `PUT /settings/document-types/{code}`, `PUT /settings/document-requirements/{t}` | upload_documents / review_documents / manage_document_requirements + scope | document_types, document_requirements, document_versions | `TestRequiredDocumentsGateFinalValidation`, `TestDocumentsAreScopedAndFilesVerified`, `TestExitValidationRequiresDocumentsOnChangeRequest`, `TestBulkValidationSkipsIncompleteDocuments` |
| Dashboard compliance | agregasi server setelah scope; sama dengan daftar detail; `null` tanpa view_employee | `GET /dashboard/compliance` | view_dashboard (+ view_employee) | — | `TestComplianceDashboardMatchesDetailLists` |
| Ops | health, readiness (migrasi) | `GET /healthz`, `/readyz`, `/api/v1/health`, `/api/v1/ready` | publik | schema_migrations | smoke |

Kontrak lengkap: `packages/contracts/openapi.yaml`. `TestRoutesMatchOpenAPI` gagal bila route dan spec tidak sinkron; `npm run contracts:check` gagal bila `apps/web/src/api/schema.d.ts` tidak sesuai spec.

## 4. Keamanan

- Password: argon2id (m=19 MiB, t=2, p=1). Login akun tak dikenal tetap memverifikasi hash dummy (waktu respons serupa).
- Cookie `gelatik_session`: HttpOnly, `Secure` wajib di production (validasi config), SameSite dapat dikonfigurasi (`None` mensyaratkan Secure). Token hanya disimpan sebagai SHA-256.
- CSRF: synchronizer token per sesi (`X-CSRF-Token`), dicek constant-time pada semua mutasi; mutasi juga ditolak bila `Origin` bukan origin yang diizinkan/sama host. Body mutasi wajib `application/json` (kecuali upload multipart).
- Sesi: TTL (default 12 jam), revoke saat logout, saat user dinonaktifkan atau password diganti; cleanup berkala.
- Error envelope konsisten `{error:{code,message,fields?,requestId}}`; error internal tidak dibocorkan. Log terstruktur JSON tanpa body/query.
- Dokumen: storage privat (`STORAGE_DIR`), key acak 256-bit dari server, tipe diverifikasi dari isi + ekstensi, unduh hanya lewat endpoint ber-permission (attachment, no-store, nosniff), isi/nama file tidak dicatat di log, sweep file yatim > 1 jam.
- Batas: body JSON 1 MiB, upload impor 20 MiB, upload dokumen 10 MiB (konfigurasi), 20.000 baris, 200 kolom, batas dekompresi zip, maksimal 2 preview impor paralel (429 bila penuh), timeout request 30 dtk.

## 5. Asumsi bisnis / TBC (dipertahankan dari prototype, BUKAN kebijakan final Gelatik)

- Exact matching Area + Project + Position; kontrak `SIGNED` sebagai gate fulfillment; SLA ≤ 3 hari kerja; kalender Senin–Jumat **tanpa** libur nasional.
- Default validation policy: Entry/Movement/Exit → HR HO; Basic edit → AREA_ADMIN (dipetakan ke role Area Support, yang secara default tidak punya permission validasi → praktis hanya Super Admin). Perlu konfirmasi.
- Re-entry langsung efektif (tanpa antrean validasi), sama seperti prototype.
- Lifecycle replacement (`OPEN/MATCHED/FULFILLED`) dipisah dari indikator SLA (`WITHIN_TARGET/OVER_TARGET`); API tetap mengirim `status` gabungan lama (`OVER_TARGET` = fulfilled melewati SLA) agar UI tidak berubah. Need terbuka yang melewati SLA hanya ditandai lewat reminder.
- Historical workforce dari master impor (exit dari Tanggal Keluar + replacement terinferensi) hanya **view turunan** (`derived: true`), tidak disimpan dan tidak bisa di-match/fulfill.
- Quota bulanan manual, formula turnover/monthly index mengikuti `apps/web/src/lib/projectAnalytics.ts`.
- Keputusan review impor bersifat final (koreksi keputusan butuh kebijakan bisnis — TBC). Exit dengan cakupan "akhir penempatan" dicatat sebagai career event `OTHER`, bukan exit perusahaan.

## 6. Perubahan perilaku dibanding prototype (disengaja)

| Prototype | Sekarang | Alasan |
|---|---|---|
| Basic edit langsung menimpa data walau SUBMITTED | Disimpan sebagai pengajuan; efektif setelah validasi | Pending tidak boleh diam-diam efektif |
| Matching bisa dilakukan pada need FULFILLED | 409 INVALID_STATE | Mencegah merusak need selesai |
| Fingerprint FNV-1a 32-bit tanpa separator | v2: SHA-256 (128 bit), separator U+001F/U+001E | Collision ~0,1% pada 3.000 baris & kanonikalisasi ambigu |
| Impor menolak Personnel ID yang ada di data manual | Direkonsiliasi terhadap master server (bisa masuk review) | Satu sumber data |
| Master di luar scope pengimpor ikut direkonsiliasi | Baris dikecualikan sebagai "di luar cakupan" | Tidak membocorkan data lintas area |
| `DEMO_TODAY` tetap 2026-09-14 | Tanggal bisnis Asia/Jakarta dari server (`BUSINESS_DATE` override hanya non-production) | Akurasi reminder |

## 7. Batasan yang diketahui

- 🟡 **Pola snapshot**: halaman analytics/dashboard/validasi/replacement masih membaca koleksi ter-scope dari `GET /snapshot` (profil diringkas). Untuk ribuan personel ini masih layak, tetapi bukan pagination penuh. Langkah lanjut: endpoint agregat/paginated per halaman (dashboard KPI & employee list sudah tersedia server-side).
- 🟡 Notifikasi & refresh data memakai polling (30 dtk notifikasi, 60 dtk snapshot + saat tab aktif kembali).
- 🟡 Halaman Project/Access Settings memanggil aksi tanpa pesan error inline; state selalu dimuat ulang dari server sehingga tidak menampilkan keberhasilan palsu.
- 🟡 Pembatasan login berbasis DB (berlaku multi-instance); belum ada CAPTCHA/lockout permanen.
- 🟡 Parsing excelize tidak dapat dibatalkan di tengah jalan; dibatasi ukuran, baris, dekompresi, dan 2 slot paralel.
- 🟡 Area/role hanya bisa dikonfigurasi per role (selected areas per role), sama seperti prototype; scope per user hanya lewat `OWN_AREA`.
- ⛔ Tidak ada UI administrasi user (API `GET/POST /users`, `PATCH /users/{id}` + CLI `api user create` tersedia).
- ⛔ Data browser lama (localStorage/IndexedDB) **tidak** dimigrasikan otomatis. Untuk memindahkan data, ekspor workbook sumber lalu impor ulang lewat alur impor server.

## 8. Hasil pemeriksaan yang dijalankan (lokal, macOS, Go 1.26.2, Node 25, PostgreSQL 17 via Docker)

| Pemeriksaan | Hasil |
|---|---|
| `gofmt -l` | bersih |
| `go vet ./...` | lulus |
| `go test ./...` (unit + integrasi PostgreSQL, termasuk drift OpenAPI) | lulus — paket `api`, `domain`, `imports`, `service` |
| `go build ./cmd/api`, `docker build apps/api` | lulus (image 35 MB, `migrate status` jalan di container) |
| Migration pada DB kosong + idempotensi (`migrate` 2×), seed 2× | lulus |
| `npm run lint` | lulus |
| `npm run test` (Vitest) | 205/206 — satu kegagalan sama dengan baseline (§9) |
| `npm run build` (tsc + vite) | lulus (warning ukuran chunk sudah ada sebelumnya) |
| `npm run contracts:check` | lulus |
| Smoke API via curl (ready, login gagal/berhasil, list, dashboard, CSRF) | lulus |
| Alur UI di browser: login Area Support → entry → submit → logout → login HR → validasi entry → (exit oleh Area Support) → validasi exit → replacement need → matching → fulfillment (gap 3 hari kerja) → dashboard (turnover 1, fulfilled 1) | lulus; localStorage/sessionStorage kosong, cookie sesi tidak terbaca JS |
| GitHub Actions | **belum dijalankan** (tidak di-push); skrip deteksi perubahan diuji lokal |

### Tahap 8 (2026-11-11)

| Pemeriksaan | Hasil |
|---|---|
| `gofmt -l`, `go vet ./...` | bersih / lulus |
| `go test ./...` dengan PostgreSQL (termasuk 7 test integrasi baru, drift OpenAPI, test migration `0001→0002` dengan data) | lulus — paket `api`, `domain`, `imports`, `service`, `storage` |
| `make migrate` pada DB dev yang sudah berisi data (0001 → 0002), seed ulang | lulus |
| `docker build apps/api` | lulus |
| `npm run lint`, `tsc` | lulus |
| `npm run test` | 209/210 — satu kegagalan baseline yang sama (§9); 4 test baru `lib/measure.test.ts` lulus |
| `npm run build`, `npm run contracts:check` | lulus |
| Browser (API mode): Super Admin set KTP wajib → Area Support entry (berat "enam puluh" ditolak di form, "60,5" tersimpan "60.5 kg") + unggah PDF (status Menunggu pemeriksaan) → HR validasi ditolak `DOCUMENTS_INCOMPLETE` → HR terima dokumen → dashboard compliance & drill-down kontrak/dokumen konsisten | lulus; kewajiban KTP di DB dev dikembalikan kosong setelah uji |

## 9. Catatan kegagalan lama

`apps/web/src/lib/import/contextE2E.test.tsx` membaca file di `~/Downloads/Demo_Personil_3000_Baris-2.xlsx`. Di CI test ini selesai tanpa assertion (file tidak ada). Di mesin yang memiliki file tersebut, assertion `employees > importedCount` gagal karena default mode sejak commit `8952628` adalah IMPORT_ONLY (tanpa seed). Kegagalan ini ada sebelum pekerjaan backend dan tidak diubah.

## 10. CI

Workflow `.github/workflows/ci.yml` selalu berjalan; job `changes` (`scripts/ci-changes.sh`) menentukan komponen:

- `apps/web/**` → job `web` (lint, test, build, artifact `web-dist`)
- `apps/api/**` → job `api` (gofmt, vet, test dengan service PostgreSQL, migration DB kosong, build, docker build)
- `packages/contracts/**` → `contracts` + `web` + `api`
- `package.json`/lockfile → `web` + `contracts`; workflow/skrip/Makefile/compose → semua
- Dokumentasi saja → tidak ada build

**Required check yang disarankan: hanya `ci-ok`.** Job komponen yang dilewati (`skipped`) dianggap lulus, dan `ci-ok` (`if: always()`) gagal bila ada job yang `failure`/`cancelled`. Jangan memakai `paths:` di level trigger untuk workflow yang menjadi required check — check tersebut tidak akan pernah dilaporkan dan PR menunggu selamanya.

Deployment terpisah nanti: tambahkan workflow `deploy-web.yml` / `deploy-api.yml` yang dipicu `workflow_run` dari CI sukses di `main` dengan filter path yang sama, memakai environment GitHub + secret masing-masing. Backend: jalankan `api migrate` sebagai langkah eksplisit sebelum rollout image baru. Belum ada auto-deploy.
