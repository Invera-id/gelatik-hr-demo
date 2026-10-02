# Gelatik HR — Workforce Monitoring Demo V3

Frontend-only React/Vite prototype untuk memvalidasi requirement workforce movement, turnover, replacement, fulfillment, dan monitoring PT Gelatik Supra. Seluruh data bersifat fiktif dan disimpan lokal di browser.

> **Demo Environment** — Seluruh data yang ditampilkan merupakan data dummy untuk simulasi requirement dan bukan data aktual PT Gelatik Supra.

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
| Area Supporting / Data Input | `bandung@demo.test` | Bandung | Input dan monitoring area |
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
| `/import` | Controlled `.xlsx` preview/validation/import (HR/Super Admin) |
| `/settings/access` | Demo RBAC matrix (Super Admin) |
| `/settings/validation` | Validation policy (Super Admin) |

## Data, Excel, dan reset

- Demo state memakai `localStorage`; sesi login memakai `sessionStorage`.
- Menu profile menyediakan **Reset data demo** untuk mengembalikan employee, movement, exit, replacement, projects, quota, permission, policy, notes, flags, dan contract scenarios ke seed deterministik. Reset dianjurkan bila browser pernah dipakai untuk V2.
- Export `.xlsx` diproses di browser; CSV menjadi fallback bila workbook gagal dibuat.

## Import Excel Personil (83 kolom)

Fitur impor penuh ada di menu **Import Excel** (role HR HO / Super Admin). Pilih satu file `.xlsx`; sistem otomatis membaca → menormalisasi → memvalidasi → menyimpan.

- **Hanya sheet bernama `Database`** yang diproses (cocok persis setelah trim + normalisasi huruf). Sheet lain, termasuk `Database aktif`, diabaikan; tidak ada fallback ke sheet pertama. Jika tidak ada sheet `Database`, impor dibatalkan tanpa mengubah data.
- Data impor disimpan **persisten di IndexedDB** (`gelatik-personnel-db`), bukan server dan bukan hanya state React — tetap ada setelah refresh/tutup browser. Daftar, detail, dan dashboard membaca sumber yang sama.
- Impor ulang melakukan **dedup berdasarkan ID Personil**: ID baru → insert, ID berubah → update (nilai kosong tidak menghapus nilai lama), ID sama & tidak berubah → unchanged. Impor file identik tidak menggandakan data.
- Baris tanpa identitas minimum (ID Personil + Nama) dan konflik NoKTP disimpan sebagai **exception**; field opsional bermasalah hanya menghasilkan **warning** (baris tetap tersimpan). Ringkasan + rincian masalah + unduhan laporan tersedia setelah impor.
- Arsitektur berlapis & swappable: `src/lib/import/` (`columns`, `normalizers`, `workbook`, `mapping`, `parse`, `plan`, `repository`, `service`). Repository memakai interface `PersonnelRepository` sehingga backend API bisa menggantikan IndexedDB tanpa menulis ulang parser/UI.

> Catatan: file contoh `Demo_Personil_3000_Baris-2.xlsx` memakai sheet bernama "Data Demo", sehingga perlu diubah menjadi `Database` dulu (salinan siap pakai `Demo_Personil_3000_Baris-Database.xlsx` sudah dibuat di folder Downloads). Download template ber-sheet `Database` tersedia di halaman Import.

## Vercel

Repository menyertakan `vercel.json` untuk SPA deep-link rewrite ke `index.html`. Tidak ada backend, serverless function, database, atau environment secret.

1. Import repository ke Vercel.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Setelah deploy, uji refresh pada `/dashboard`, `/employees/employee-026`, `/projects/project-beta-bandung`, `/reports/analytics`, dan `/replacements/need-chain-002`.

## Version 3 analytics

Dashboard memakai istilah **Turnover** dan **Vacant** serta target fulfillment ≤ 3 hari kerja. Reference CSV di `docs/reference/` dipakai untuk membaca **header saja**; tidak ada baris employee referensi dalam aplikasi. Quota per project/bulan, Turnover %, Monthly Index, dan Pengakhiran Perjanjian adalah interpretasi demo yang perlu konfirmasi Gelatik. Lihat [V3 change log](docs/DEMO_V3_CHANGELOG.md) untuk flow presentasi dan formula.

## Batasan penting

Prototype ini tidak menyediakan production authentication/authorization, sinkronisasi antarperangkat, database, audit guarantee, public-holiday calculation, BPJS integration, file storage, atau external notification. Exact matching, SLA tiga hari, calendar Senin–Jumat, contract gate, cross-area behavior, validation ownership, dan flag treatment masih **DEMO ASSUMPTION / TBC**.
