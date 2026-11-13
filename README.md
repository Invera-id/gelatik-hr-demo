# Gelatik HR — Workforce Monitoring

Aplikasi web untuk memantau dan mengelola tenaga kerja lapangan (personel outsourcing) PT Gelatik Supra. Dikembangkan oleh Invera.

> Repository ini **tidak** memuat data personel asli PT Gelatik Supra. Semua seed dan fixture bersifat sintetis. Jangan commit, log, screenshot, atau deploy workbook internal.

## Tentang project

Gelatik menempatkan ribuan personel (sales, promotor, SDO, admin, team leader) di berbagai area, project, dan client. Data mereka selama ini tersebar di workbook Excel. Aplikasi ini menggantikannya dengan satu sistem yang:

- menyimpan **master personel** beserta riwayat penempatan, mutasi, exit, dan re-entry;
- memastikan setiap perubahan data **diajukan dulu lalu divalidasi HR** sebelum berlaku;
- membatasi akses per **role** dan per **area**.

### Pengguna

| Role | Tugas utama | Cakupan data default |
|---|---|---|
| Area Supporting | Input personel baru, ajukan perubahan/mutasi/exit, unggah dokumen | Area sendiri |
| HR Head Office | Import Excel, validasi pengajuan, periksa dokumen | Semua area |
| Operational Manager | Memantau dashboard & laporan | Semua area, read-only |
| BoD / GM | Memantau dashboard & laporan | Semua area, read-only |
| Super Admin | Konfigurasi role, permission, ambang kontrak | Semua area |

### Fitur

- **Import Excel personel.** Hanya sheet bernama `Database` yang dibaca, dan kolom dikenali dari nama header. Peringatan per baris dan kolom ditampilkan **sebelum** data disimpan. Baris dengan Personnel ID yang sama direkonsiliasi menjadi duplikasi, mutasi, exit, atau re-entry, lalu masuk antrean review. Aturan lengkapnya ada di [docs/IMPORT_RULES.md](docs/IMPORT_RULES.md).
- **Master personel.** Tersedia daftar, pencarian, dan detail lengkap (identitas, domisili, kontak, penempatan, riwayat karir, catatan). Export ke Excel juga tersedia.
- **Pengajuan & validasi HR.** Pengajuan mencakup entry baru, edit data dasar, mutasi/penempatan, dan exit. Halaman Validasi menampilkan pemeriksaan otomatis per pengajuan (**Siap / Perlu dicek / Tertahan**) beserta alasannya, sehingga HR tidak perlu membuka detail satu per satu. **Validasi yang Valid** hanya memproses pengajuan tanpa temuan; **Validasi Semua** juga memproses yang hanya punya peringatan. Pengajuan yang Tertahan tidak pernah ikut validasi massal.
- **Replacement & fulfillment.** Exit yang sudah divalidasi otomatis membuat kebutuhan pengganti.
- **Monitoring kontrak.** Status (akan berakhir / sudah berakhir / data belum lengkap) dihitung dari tanggal berakhir kontrak. Ambang pengingat bisa dikonfigurasi.
- **PKWT (kontrak kerja) karyawan.** Setiap karyawan aktif yang belum punya PKWT yang diterima HR diberi peringatan (di daftar karyawan, detail, Validasi, dashboard, dan halaman **Kelengkapan PKWT**). PKWT diunggah dari detail karyawan kapan saja ke storage privat, lalu diperiksa HR (diterima / ditolak dengan alasan), dan riwayat versinya tersimpan. Peringatan ini **tidak** menghalangi validasi.
- **Dashboard & laporan.** Tersedia jumlah personel, turnover, quota project, serta kepatuhan kontrak dan dokumen yang bisa diklik ke daftar detail.
- **Notifikasi in-app & audit log.** Setiap aksi penting tercatat. Halaman Notifikasi ber-pagination, dan "Tandai semua dibaca" berlaku untuk semua notifikasi.

Hal yang **tidak** termasuk: payroll, absensi, integrasi BPJS, email, atau WhatsApp.

### Teknologi

```
apps/web/            Frontend: React 19 + TypeScript + Vite
apps/api/            Backend: Go + Fiber v3 + PostgreSQL (pgx v5)
  cmd/api/           Perintah: serve | migrate | seed | user create
  internal/          api (HTTP) · service (workflow) · domain & imports (aturan bisnis) · auth · access · db · storage
  internal/db/migrations/   Migration SQL berversi
packages/contracts/  openapi.yaml (kontrak API) + generator tipe TypeScript
docs/                Spesifikasi, aturan import, progres, requirement terbaru
compose.yaml         PostgreSQL lokal (+ service api opsional)
Makefile             Kumpulan perintah
```

Server adalah penentu akhir untuk login, hak akses, cakupan area, dan seluruh aturan bisnis. Pemeriksaan di frontend hanya untuk kenyamanan pengguna.

## Cara menjalankan (development)

### 1. Prasyarat

- Node.js 24+ (npm 11)
- Go 1.26+
- Docker Desktop (untuk PostgreSQL)
- `make` (sudah ada di macOS/Linux; di Windows pakai WSL atau Git Bash yang punya `make`)

Port yang dipakai: `5173` (frontend), `8080` (backend), dan `55432` (PostgreSQL).

### 2. Persiapan (sekali saja)

Install dependensi frontend:

```bash
npm install
```

Siapkan file `.env`. Minta file `decrypt-env.mjs` ke pemilik project, simpan di folder root, lalu jalankan:

```bash
node decrypt-env.mjs
```

Langkah ini menghasilkan `apps/api/.env` dan `apps/web/.env` (detailnya di bagian [File `.env` (terenkripsi)](#file-env-terenkripsi)). Tanpa `.env`, backend tetap jalan dengan nilai default development, tetapi tombol pintasan akun demo di halaman login tidak muncul.

Nyalakan PostgreSQL. Database `gelatik_hr` dan `gelatik_hr_test` dibuat otomatis:

```bash
make db-up
```

Buat tabel:

```bash
make migrate
```

Buat akun demo:

```bash
make seed
```

`make seed` hanya membuat **5 akun demo** dan satu area `Bandung`, karena akun Area Support harus terikat ke sebuah area. Data personel, project, dan jenis dokumen tidak di-seed; data itu masuk lewat import Excel atau UI. Seed ditolak bila `APP_ENV=production`.

### 3. Jalankan aplikasi

Jalankan backend dan frontend di **dua terminal** terpisah.

Terminal 1, backend di http://localhost:8080:

```bash
make api
```

Terminal 2, frontend di http://localhost:5173:

```bash
make web
```

Lalu buka **http://localhost:5173**. Frontend meneruskan `/api` ke backend, jadi tidak perlu pengaturan CORS.

### 4. Login

Semua akun demo memakai password **`gelatik-dev-password`**. Password ini bisa diganti lewat env `SEED_DEMO_PASSWORD` saat menjalankan `make seed`.

| Email | Role |
|---|---|
| `superadmin@demo.test` | Super Admin |
| `hr@demo.test` | HR Head Office |
| `bandung@demo.test` | Area Supporting (Bandung) |
| `operations@demo.test` | Operational Manager |
| `management@demo.test` | BoD / GM |

### 5. Alur mencoba

1. Login sebagai `hr@demo.test`, buka **Import Excel**, lalu unduh template atau pilih workbook `.xlsx` yang punya sheet `Database`.
2. Periksa tabel peringatan di preview, lalu klik **Konfirmasi & Simpan**.
3. Buka **Validation**. Lihat kartu Siap / Perlu dicek / Tertahan, periksa temuannya, lalu validasi.
4. Buka detail karyawan yang bertanda **PKWT belum ada**, unggah PKWT (PDF/JPG/PNG), lalu terima sebagai HR. Peringatannya akan hilang.
5. (Opsional) Login sebagai `superadmin@demo.test` untuk mengatur ambang pengingat di **Monitoring Kontrak**.
6. Login sebagai `bandung@demo.test` untuk mencoba input personel baru dan mengunggah PKWT dari halaman detail personel.

### Mengosongkan database development

Perintah ini menghapus **semua** data di database dev lalu membuat ulang tabel dan akun demo:

```bash
docker compose exec -T db psql -U gelatik -d gelatik_hr -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && make migrate && make seed && rm -rf apps/api/var/documents
```

### Masalah umum

| Gejala | Solusi |
|---|---|
| Backend menolak start karena "pending migrations" | Jalankan `make migrate`, lalu `make api` lagi. |
| `address already in use` di port 8080 atau 5173 | Masih ada server lama yang jalan. Hentikan dulu (Ctrl+C di terminalnya), atau cari prosesnya dengan `lsof -i :8080`. |
| Tidak bisa terhubung ke database | Pastikan Docker menyala dan `make db-up` sudah dijalankan. |
| Login gagal setelah database dikosongkan | Semua sesi ikut terhapus. Jalankan `make seed`, lalu login ulang. |

## Perintah lain

| Perintah | Fungsi |
|---|---|
| `make api` / `make web` | Menjalankan backend / frontend |
| `make db-up` / `make db-down` | Menyalakan / mematikan PostgreSQL |
| `make migrate` | Menerapkan migration (juga dipakai di production) |
| `make seed` | Membuat akun demo (development) |
| `make test-api` | gofmt, go vet, unit + integration test backend (butuh PostgreSQL) |
| `npm run lint` · `npm run test` · `npm run build` | Pemeriksaan frontend |
| `npm run contracts:generate` · `npm run contracts:check` | Membuat ulang / mengecek tipe TypeScript dari OpenAPI |
| `make check` | Lint, test, build, dan cek kontrak sekaligus |

Untuk membuat administrator pertama (misalnya di production, tanpa seed):

```bash
cd apps/api && USER_PASSWORD='<min 12 karakter>' go run ./cmd/api user create --email admin@example.com --name "Admin" --role SUPER_ADMIN
```

## Konfigurasi

- **Backend:** `apps/api/.env` (didapat dari dekripsi, lihat bagian berikut). Isinya meliputi database, origin yang diizinkan, cookie sesi, batas import, `STORAGE_DIR` dan batas file dokumen, serta `BUSINESS_DATE` (khusus non-production, untuk menetapkan "hari ini").
- **Frontend:** `apps/web/.env` (didapat dari dekripsi). Semua variabel `VITE_*` ikut masuk ke bundle publik, jadi **jangan taruh secret di sana**.
- `VITE_DATA_SOURCE=api` (default) memakai backend. `VITE_DATA_SOURCE=local` menjalankan prototype lama yang menyimpan data di browser; mode ini tidak mendukung dokumen dan monitoring kontrak.

### File `.env` (terenkripsi)

File `.env` asli **tidak pernah di-push**. Yang ada di repo hanyalah salinan terenkripsinya:

- `apps/api/.env.enc`
- `apps/web/.env.enc`

Alat untuk membukanya **tidak ada di repo**. File `decrypt-env.mjs` berisi kuncinya dan dibagikan pemilik project secara pribadi. Alat ini hanya memakai Node.js bawaan (AES-256-GCM), jadi jalan di Windows, macOS, dan Linux.

Membuka (rekan tim):

1. Simpan `decrypt-env.mjs` yang kamu terima di folder root project.
2. Jalankan dari folder root:

   ```bash
   node decrypt-env.mjs
   ```

3. Hasilnya `apps/api/.env` dan `apps/web/.env`.

- File `.env` yang sudah ada tidak ditimpa. Tambahkan `--force` untuk menimpanya.
- `decrypt-env.mjs` sudah di-ignore git, jadi tidak akan ikut ter-push.
- `make migrate`, `make seed`, dan `make api` otomatis membaca `apps/api/.env`.
- Vite otomatis membaca `apps/web/.env`.
- Di Windows tanpa `make`, set variabel dari `apps/api/.env` di shell sebelum menjalankan `go run ./cmd/api serve`.

Mengubah isi `.env` (pemilik): edit `apps/api/.env` dan/atau `apps/web/.env`, lalu jalankan:

```bash
node env-tools/encrypt-env.mjs
```

Setelah itu commit dan push file `.env.enc` yang berubah. Folder `env-tools/` (berisi kunci) di-ignore git. **Simpan cadangannya di tempat aman**: tanpa kunci itu, file `.env.enc` tidak bisa dibuka lagi.

## Deployment (belum ada deploy aktif)

- **Backend:** container dari `apps/api/Dockerfile` (distroless, non-root). Urutan rilis:
  1. Backup database.
  2. `api migrate`.
  3. Rollout `api serve`.

  Server menolak start bila ada migration tertunda. Wajib di production:
  - `APP_ENV=production`
  - `SESSION_COOKIE_SECURE=true`
  - HTTPS
  - `STORAGE_DIR` pada volume privat yang persisten (default image: `/data/documents`)
- **Frontend:** hosting statis dari `apps/web`, build `npm run build`, output `dist`, dengan SPA rewrite ke `/index.html`.
- **Topologi yang disarankan:** satu domain, dengan reverse proxy yang meneruskan `/api/*` ke backend dan sisanya ke frontend. Dengan begitu cookie tetap first-party dan CORS tidak diperlukan.
- Frontend versi terbaru membutuhkan backend versi terbaru, jadi rilis keduanya bersama. Detailnya ada di [docs/REQUIREMENTS_2026-11-10.md](docs/REQUIREMENTS_2026-11-10.md).
- **CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml). Jadikan job `ci-ok` sebagai required check.

## Dokumentasi

- [docs/BACKEND_PROGRESS.md](docs/BACKEND_PROGRESS.md): arsitektur, matriks fitur, asumsi/TBC, batasan, dan hasil pengujian
- [docs/IMPORT_RULES.md](docs/IMPORT_RULES.md): aturan import Excel dan rekonsiliasi
- [docs/REQUIREMENTS_2026-11-10.md](docs/REQUIREMENTS_2026-11-10.md): monitoring kontrak, PKWT karyawan, validasi input, kesiapan validasi, dan pertanyaan bisnis yang masih terbuka
- [packages/contracts/openapi.yaml](packages/contracts/openapi.yaml): kontrak API (prefix `/api/v1`)

## Batasan & asumsi

Beberapa aturan masih **asumsi yang perlu dikonfirmasi (TBC)**, belum kebijakan final Gelatik:

- exact matching
- SLA ≤ 3 hari kerja
- contract gate
- kewenangan validasi
- quota dan formula turnover
- arti "kontrak 4 tahun"
- target finance

Detailnya ada di dokumen di atas.
