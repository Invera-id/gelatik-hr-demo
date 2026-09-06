# Gelatik HR — Workforce Monitoring Demo

Frontend-only demonstration prototype untuk memvalidasi requirement alur employee movement dan replacement PT Gelatik Supra. Seluruh data di aplikasi adalah data dummy dan disimpan hanya di browser.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Buka URL yang ditampilkan Vite, biasanya `http://localhost:5173`.

Quality checks:

```bash
npm run lint
npm run test
npm run build
```

Pada PowerShell Windows dengan execution policy terbatas, gunakan `npm.cmd` sebagai pengganti `npm`.

## Akun demo

Semua akun menggunakan password `password`.

| Role | Email | Scope |
|---|---|---|
| Area Supporting / Data Input | `bandung@demo.test` | Area Bandung |
| HR Head Office | `hr@demo.test` | Semua area + validation |
| BoD / GM | `management@demo.test` | Semua area, read-only |

## Halaman dan route

| Route | Halaman | Akses |
|---|---|---|
| `/login` | Demo login | Publik |
| `/dashboard` | KPI, charts, SLA, recent movement | Semua role |
| `/employees` | Master Employee | Semua role |
| `/employees/:id` | Employee Detail dan history | Sesuai area/role |
| `/employees/new` | Employee Entry | Area Supporting, HR |
| `/employees/:id/edit` | Edit Employee | Area Supporting, HR |
| `/employees/:id/exit` | Employee Exit | Area Supporting, HR |
| `/validation` | HR Validation | HR Head Office |
| `/replacements` | Replacement Needs | Semua role |
| `/replacements/:id` | Candidate matching dan fulfillment | Semua role; Management read-only |

## Business flow

1. Area Supporting membuat Employee Entry atau Employee Exit.
2. Record dapat disimpan sebagai `DRAFT` atau dikirim sebagai `SUBMITTED`.
3. HR Head Office memilih `VALIDATED` atau `REVISION_REQUIRED`.
4. Validasi Employee Exit dengan `replacementRequired = true` membuat Replacement Need.
5. Kandidat hanya eligible jika Area, Project, dan Position sama persis.
6. Matching dilakukan dengan tindakan pengguna, tidak otomatis.
7. Fulfillment hanya dapat diselesaikan jika kandidat sudah `VALIDATED`, kontrak `SIGNED`, dan memiliki join date.
8. Gap dihitung pada hari Senin–Jumat, tidak termasuk tanggal exit.
9. Gap maksimal tiga hari kerja menghasilkan `FULFILLED`; lebih dari tiga menghasilkan `OVER_TARGET`.

## Skenario data demo

- Success: Nanda Pratama digantikan Dony Saputra dalam dua hari kerja.
- Wrong area: Andi Kurniawan dari Semarang ditolak untuk kebutuhan Bandung.
- Over SLA: fulfillment Semarang memiliki gap enam hari kerja.
- Incomplete source: Farhan Akbar belum memiliki Project sehingga matching diblokir setelah exit divalidasi.

Data aplikasi disimpan di `localStorage`, sementara sesi login berada di `sessionStorage`. Menu profil menyediakan **Reset data demo** untuk mengembalikan semua scenario awal.

## Asumsi dan TBC

- Ini bukan autentikasi atau authorization yang aman untuk production; seluruh enforcement merupakan simulasi frontend.
- Data source dimiliki dan disuplai Gelatik. Sistem tidak menyimpulkan Area, Project, atau Position yang hilang.
- Kontrak `SIGNED` sebagai syarat fulfillment masih perlu konfirmasi requirement.
- Perhitungan working day saat ini hanya mengecualikan Sabtu dan Minggu; hari libur nasional belum dihitung.
- Tidak ada backend, database, external API, email, BPJS integration, payroll, attendance, AI/ML, atau document storage.
- Dummy state tidak ditujukan untuk sinkronisasi lintas browser/perangkat.

## Alur presentasi yang direkomendasikan

1. Login sebagai HR untuk menunjukkan dashboard lintas area dan validation queue.
2. Validasi exit Farhan Akbar untuk memperlihatkan dependency pada source data yang tidak lengkap.
3. Buka Replacement Detail dan tunjukkan alasan kandidat eligible/tidak eligible.
4. Tunjukkan scenario Nanda → Dony yang `FULFILLED` serta Semarang yang `OVER_TARGET`.
5. Login sebagai Area Bandung untuk menunjukkan pembatasan area dan form input.
6. Login sebagai Management untuk menunjukkan akses dashboard konsolidasi dan UI read-only.
