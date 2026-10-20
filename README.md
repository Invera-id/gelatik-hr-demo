# Gelatik HR — Workforce Monitoring Demo V3

Frontend-only React/Vite prototype untuk memvalidasi requirement workforce movement, turnover, replacement, fulfillment, dan monitoring PT Gelatik Supra. Build default tidak membawa seed employee; data uji disimpan lokal di browser.

> **Import-Only Environment** — Repository tidak memuat data employee aktual PT Gelatik Supra. Jangan commit, log, screenshot, atau deploy workbook internal.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run lint
npm run test
npm run build
```

Pada PowerShell dengan execution policy terbatas, gunakan `npm.cmd`. Production build berada di `dist/`.

## Akun demo

Semua akun menggunakan password `password`.

| Role | Email | Default scope | Karakter akses |
|---|---|---|---|
| Area Supporting / Data Input | `bandung@demo.test` | Area Sendiri (Bandung) | Data entry, movement, dan Import Excel dalam scope |
| HR Head Office | `hr@demo.test` | All Areas | Validation, matching, fulfillment, import/export |
| Operational / Manager | `operations@demo.test` | All Areas | Read-only monitoring |
| BoD / GM | `management@demo.test` | All Areas | Read-only management view |
| Super Admin | `superadmin@demo.test` | All Areas | Demo configuration dan seluruh fitur |

## Route utama

| Route | Fungsi |
|---|---|
| `/dashboard` | KPI, filter, charts, drill-down, SLA, kontrak, recent movement |
| `/employees` | Master Employee, Client filter, dan derived Employee Aktif tab |
| `/projects` | Master Project CRUD/status dan list sesuai scope |
| `/projects/:id` | Project Overview, Workforce, Monthly, Termination Analytics |
| `/reports/analytics` | Monthly Client Summary, Client Quota, Pengakhiran Perjanjian |
| `/employees/new` | Employee Entry |
| `/employees/:id` | Current state, notes, flag, career timeline |
| `/employees/:id/edit` | Basic edit / revision |
| `/employees/:id/exit` | Employee Exit / revision |
| `/employees/:id/movement` | Promotion, mutation, dan placement change |
| `/employees/:id/reentry` | Re-entry dengan historical warning |
| `/movements` | Employee Movement History |
| `/validation` | Entry, exit, dan movement validation queue |
| `/replacements` | Replacement & Fulfillment monitor |
| `/replacements/:id` | Matching, fulfillment, dan replacement chain |
| `/reports/export` | Lima jenis export `.xlsx` sesuai filter/scope |
| `/import` | Controlled `.xlsx` preview/validation/import dan antrean review sesuai permission/scope |
| `/settings/access` | Demo RBAC matrix (`manage_roles`) |
| `/settings/validation` | Validation policy (`manage_validation_policy`) |

## Data, Excel, dan reset

- Mode default adalah `IMPORT_ONLY`. Seed workforce hanya aktif bila build secara eksplisit memakai `VITE_DEMO_DATA_MODE=SAMPLE`.
- Import-only memakai namespace `gelatik-import-only-data-v1`, sehingga seed lama pada `gelatik-demo-data-v2` tidak dimuat. Data import tetap berada di IndexedDB `gelatik-personnel-db`.
- Menu profile mereset transaksi lokal tanpa menghapus personnel, batch, source records, exceptions, atau review items hasil import.
- Sesi login memakai `sessionStorage`; notifikasi disimpan pada namespace terpisah per mode.
- Export `.xlsx` diproses di browser; CSV menjadi fallback bila workbook gagal dibuat.

## Import Excel Personil (83 kolom)

Fitur impor ada di menu **Import Excel** ketika permission **Mengimpor Excel Personel** aktif, termasuk untuk `bandung@demo.test`, dengan alur `Pilih .xlsx → Parse → Validate → Preview → Confirm → Commit`. Cancel pada tahap preview tidak mengubah IndexedDB.

- **Hanya sheet bernama `Database`** yang diproses (cocok persis setelah trim + normalisasi huruf). Sheet lain, termasuk `Database aktif`, diabaikan; tidak ada fallback ke sheet pertama. Jika tidak ada sheet `Database`, impor dibatalkan tanpa mengubah data.
- Data impor disimpan **persisten di IndexedDB** (`gelatik-personnel-db`), bukan server dan bukan hanya state React — tetap ada setelah refresh/tutup browser. Daftar, detail, dan dashboard membaca sumber yang sama.
- Workbook dengan header berubah urutan atau kolom tambahan dipetakan berdasarkan nama header. Header berulang dipasangkan berdasarkan urutan kemunculannya; kolom yang hilang menjadi kosong/NEEDS_REVIEW, bukan digeser secara positional. Warning struktur header disembunyikan sementara untuk kebutuhan demo.
- Re-import identik idempotent berdasarkan normalized Personnel ID + fingerprint. Konflik NoKTP tidak di-merge otomatis dan tetap berada di review queue.
- Critical field yang kosong/tidak dikenal dan mutation historis memakai guardrail `NEEDS_REVIEW`; import tidak otomatis berarti validasi HR atau kontrak `SIGNED`.
- Import Area Supporting dibatasi sebelum reconciliation dan reference discovery. Preview memisahkan valid dalam scope, warning/review, error, dan di luar scope. Baris luar scope diberi status **“Di luar cakupan area — tidak diimpor.”**, tidak dikomit, dan tidak dapat membuat Area/Project baru.
- Hanya `.xlsx` yang didukung. `.xls` harus disimpan ulang sebagai `.xlsx`.
- Pipeline aktif berada di `src/lib/import/` (`columns`, `normalizers`, `workbook`, `mapping`, `parse`, `classify`, `reconcile`, `repository`, `service`).

## Vercel

Repository menyertakan `vercel.json` untuk SPA deep-link rewrite ke `index.html`. Tidak ada backend, serverless function, database, atau environment secret.

1. Import repository ke Vercel.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Setelah deploy, uji refresh pada `/dashboard`, `/employees/employee-026`, `/projects/project-beta-bandung`, `/reports/analytics`, dan `/replacements/need-chain-002`.

## Version 3 analytics

Dashboard memakai istilah **Turnover** dan **Vacant** serta target fulfillment ≤ 3 hari kerja. Reference CSV di `docs/reference/` dipakai untuk membaca **header saja**; tidak ada baris employee referensi dalam aplikasi. Quota per project/bulan, Turnover %, Monthly Index, dan Pengakhiran Perjanjian adalah interpretasi demo yang perlu konfirmasi Gelatik. Lihat [V3 change log](docs/DEMO_V3_CHANGELOG.md) untuk flow presentasi dan formula.

## Demo RBAC

Permission dikelompokkan menjadi Monitoring, Employee, Import & Export, Validation, Replacement & Fulfillment, Project, dan Administrasi. Sidebar, route, tombol, serta action pada `DemoContext` membaca konfigurasi yang sama. Scope memakai label **Area Sendiri**, **Area Terpilih**, atau **Semua Area**.

- Area Supporting: data entry own-area, import own-area, movement/exit/re-entry, serta monitoring project/replacement; tidak memvalidasi atau melakukan matching/fulfillment secara default.
- HR Head Office: semua area, employee/import/review/validation/project/replacement/export; tidak mendapat konfigurasi role secara default.
- Operations Manager dan Management: read-only untuk dashboard, analytics, employee, movement, project, replacement, dan export.
- Super Admin: seluruh permission aktif; permission administrasi inti dikunci agar akses konfigurasi tidak terputus.

Konfigurasi lama berbasis permission luas (`edit_employee`, `create_exit`, `validate_employee`, `validate_exit`) dimigrasikan saat startup. `manage_users` tidak ditampilkan karena belum ada fitur User Management nyata. Permission Import Excel tidak otomatis memberikan permission membuat employee manual.

> Konfigurasi role pada prototype digunakan untuk simulasi kebutuhan. Struktur permission dan otorisasi production akan ditentukan kembali bersama PT Gelatik Supra.

## Batasan penting

Prototype ini tidak menyediakan production authentication/authorization, sinkronisasi antarperangkat, database, audit guarantee, public-holiday calculation, BPJS integration, file storage, atau external notification. RBAC dan scope berbasis frontend/localStorage mencegah aksi di dalam demo, tetapi bukan batas keamanan production. Exact matching, SLA tiga hari, calendar Senin–Jumat, contract gate, cross-area behavior, validation ownership, quota manual vs turunan master, dan flag treatment masih **DEMO ASSUMPTION / TBC**.
