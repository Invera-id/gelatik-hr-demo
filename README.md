# Gelatik HR — Workforce Monitoring Demo V2

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
| `/employees` | Master Employee sesuai scope |
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
- Menu profile menyediakan **Reset data demo** untuk mengembalikan employee, movement, exit, replacement, permission, policy, notes, flags, dan contract scenarios ke seed deterministik.
- Export `.xlsx` diproses di browser; CSV menjadi fallback bila workbook gagal dibuat.
- Import menerima `.xlsx` dan hanya field yang didokumentasikan. Duplicate Personnel ID harus dipilih **Skip** atau **Update current basic fields**; history tidak dihapus.

## Vercel

Repository menyertakan `vercel.json` untuk SPA deep-link rewrite ke `index.html`. Tidak ada backend, serverless function, database, atau environment secret.

1. Import repository ke Vercel.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Setelah deploy, uji refresh pada `/dashboard`, `/employees/employee-026`, dan `/replacements/need-chain-002`.

## Batasan penting

Prototype ini tidak menyediakan production authentication/authorization, sinkronisasi antarperangkat, database, audit guarantee, public-holiday calculation, BPJS integration, file storage, atau external notification. Exact matching, SLA tiga hari, calendar Senin–Jumat, contract gate, cross-area behavior, validation ownership, dan flag treatment masih **DEMO ASSUMPTION / TBC**.