# Requirement tambahan — pembahasan 10 November 2026

Status per 2026-11-11. Melanjutkan monorepo yang sudah ada (`apps/api`, `apps/web`, `packages/contracts`); tidak ada pembangunan ulang backend atau restrukturisasi.

Legenda: ✅ selesai · 🟡 fondasi siap, menunggu keputusan bisnis · ⛔ belum dikerjakan (definisi belum ada)

## 1. Ringkasan requirement → status

| # | Requirement | Status | Ringkas |
|---|---|---|---|
| 1 | Customisasi monitoring kontrak (+ catatan "contract expiring 4 tahun") | ✅ / 🟡 | Ambang pengingat dapat dikonfigurasi di server; status dihitung server. Arti "4 tahun" **belum** diimplementasikan. |
| 2 | Upload dokumen wajib sebagai bagian validasi | ✅ / 🟡 | Upload versi, review terima/tolak, gate validasi akhir di server, storage privat. Daftar dokumen wajib **tidak** diisi (konfigurasi admin). |
| 3 | Target finance | ⛔ | Tidak ada definisi/data finance di repo. Tidak ada angka, tabel, atau rumus finance yang dibuat. |
| 4 | Informasi tersebut di dashboard utama | ✅ (kontrak, dokumen) / ⛔ (finance) | `GET /dashboard/compliance`, kartu dapat diklik ke daftar detail. |
| 5 | Validasi tipe data (contoh berat badan) | ✅ | Tinggi/Berat Badan di form entry (server = otoritas), impor diperketat, pesan error per field. |

## 2. Keputusan implementasi

### Monitoring kontrak
- Konsep dipisah: **tanggal mulai**, **tanggal berakhir**, **durasi kontrak** (berakhir − mulai), **masa kerja** (tanggal bisnis − Join Date), **ambang pengingat** (hari sebelum tanggal berakhir).
- Status (`internal/domain/contracts.go`): `EXPIRING` (0 ≤ sisa hari ≤ ambang terbesar; berakhir hari ini = 0 hari), `EXPIRED` (tanggal berakhir < hari ini), `INCOMPLETE` ("Data kontrak belum lengkap": tanggal berakhir kosong/tidak valid, atau lebih awal dari tanggal mulai), `OK`.
- Tanggal berakhir **tidak pernah** dihitung dari tanggal mulai + N tahun. Empat tahun tidak dianggap batas hukum/kebijakan.
- Populasi: personel `ACTIVE`, `VALIDATED`, bukan `NEEDS_REVIEW` (sama dengan aturan workforce aktif). Dihitung per personel dari proyeksi kontrak berjalan (satu baris per personel) → kontrak historis tidak terhitung ganda. Catatan: repo belum menyimpan riwayat kontrak terpisah.
- Tanggal bisnis Asia/Jakarta dari server (`domain.BusinessToday`), dipakai konsisten oleh daftar, dashboard, dan reminder.
- Konfigurasi `contract_monitoring_settings`: **cakupan GLOBAL** (satu baris; tidak ada override per area/project). 1–5 nilai, 1–366 hari. Default migrasi = 30/14/7 (nilai yang sebelumnya hard-coded). Ubah via `PUT /settings/contract-monitoring` dengan permission `manage_contract_monitoring` (default hanya Super Admin); perubahan diaudit.
- Reminder notifikasi kini mengikuti ambang terkonfigurasi (sebelumnya hanya D-7 & EXPIRED); kategori `D-<n>`.

### Dokumen wajib
- Dokumen melekat pada **subjek validasi**: entry personel (`PERSONNEL_ENTRY`, id personel) atau pengajuan perubahan (`CHANGE_REQUEST`: basic edit, movement, exit).
- Konfigurasi: `document_types` + `document_requirements` (per jenis transaksi). **Tidak ada kewajiban yang di-seed.** `make seed` tidak membuat jenis dokumen; fixture integration test (`internal/testfixture`) memakai 3 jenis dokumen berlabel "(contoh)" tanpa kewajiban.
- Status per slot: `MISSING` (turunan), `PENDING_REVIEW`, `ACCEPTED`, `REJECTED`. Upload **selalu** `PENDING_REVIEW`.
- Penggantian file = versi baru (`PENDING_REVIEW`); versi lama ditandai `superseded` dan keputusan review-nya tetap tersimpan sebagai riwayat. Persetujuan versi lama tidak terbawa.
- Penolakan wajib beralasan; alasan terlihat oleh pengaju dan dikirim sebagai notifikasi `DOCUMENT` ke pengunggah dan pembuat pengajuan.
- Keputusan review final per versi (409 bila sudah diputuskan / versi sudah diganti). Koreksi = unggah versi baru.
- **Draft dan submit boleh tanpa dokumen lengkap.** **Validasi akhir (`VALIDATED`) ditolak server** (`409 DOCUMENTS_INCOMPLETE`, field per jenis dokumen) bila ada dokumen wajib yang versi terbarunya bukan `ACCEPTED`. Permintaan revisi tidak diblokir. Bulk validation melewati entry yang belum lengkap.
- Impor Excel tidak melewati syarat ini: personel impor berstatus `SUBMITTED` dan melalui gate yang sama.
- Setelah subjek `VALIDATED`, dokumennya terkunci (tidak bisa unggah/review ulang).
- Permission baru: `upload_documents` (default Area Support, HR HO), `review_documents` (default HR HO), `manage_document_requirements` (default Super Admin). Lihat/unduh file butuh `view_employee` + (`upload_documents` atau `review_documents`) + scope area. Di luar scope → 404.

### Storage dokumen
- `internal/storage`: antarmuka `Store` (Put/Open/Delete/List) + implementasi `Local` (direktori privat, mode 0700, tulis atomik temp→rename). Dapat diganti object storage saat deployment tanpa mengubah service.
- Key file 256-bit acak dibuat server; nama file asli hanya metadata tampilan (disanitasi). DB menyimpan metadata + key + SHA-256, bukan isi/base64.
- Tipe diverifikasi dari isi file (magic bytes PDF/JPEG/PNG) **dan** ekstensi harus cocok; Content-Type klien diabaikan. Batas ukuran & tipe via `DOCUMENT_MAX_BYTES`, `DOCUMENT_ALLOWED_TYPES`.
- Unduh hanya via `GET /documents/versions/{id}/content` (cek permission+scope, `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `nosniff`), diaudit. Tidak ada folder publik/URL permanen.
- Log tidak mencatat isi atau nama file. Kegagalan DB setelah file tersimpan → file dihapus. Sweep berkala menghapus file tanpa referensi yang lebih tua dari 1 jam; file yang direferensikan (termasuk versi lama) tidak pernah dihapus.

### Validasi tipe data
- Tinggi Badan (cm) & Berat Badan (kg) ditambahkan ke form entry/edit. Aturan (`domain.ParseMeasurement`, cermin klien `lib/measure.ts`):
  - Diterima: `60`, `60.5`, `60,5`, `60 kg` (satuan opsional, harus sesuai). Disimpan kanonik `"60.5 kg"` (format yang sama dengan impor).
  - Ditolak dengan pesan berisi contoh: teks (`abc`, `enam puluh`), negatif, `0`, satuan lain, >2 desimal (`1.234` ambigu — bisa pemisah ribuan).
  - Kosong = tidak ada nilai (bukan 0). Field yang tidak dikirim klien → nilai tersimpan dipertahankan; `""`/`null` eksplisit → dihapus.
  - **Tidak ada batas kewajaran** (min/maks) karena belum terkonfirmasi.
- Impor: aturan yang sama untuk sel teks; sel numerik Excel diterima apa adanya (bukan ambigu). Nilai ≤ 0, >2 desimal, atau tak terbaca → **warning dengan nomor baris & nama kolom**, nilai mentah dipertahankan di data sumber, nilai ternormalisasi kosong. Konversi satuan eksplisit (g→kg, m/mm→cm) tetap.
- Error API `422 VALIDATION_FAILED` membawa `fields` yang dipetakan ke field form; input pengguna dipertahankan saat gagal.
- Audit field lain: identifier (Personnel ID, NIK, rekening, NPWP, BPJS, telepon) sudah string dengan leading zero dipertahankan dan warning bila tersimpan sebagai angka Excel (test sudah ada); tanggal invalid tidak dinormalisasi diam-diam (warning impor; 422 di form); nilai/skor & enum sudah ditangani pipeline impor; email belum divalidasi formatnya (tidak ada field email di form manual). Nilai finance: tidak ada.

## 3. Pertanyaan bisnis yang belum terjawab

**A. "Contract expiring 4 tahun"** — mana yang dimaksud?
1. Kontrak berdurasi empat tahun (perlu kolom/aturan durasi)?
2. Peringatan saat **masa kerja** mendekati empat tahun (berapa hari sebelumnya; dihitung dari Join Date periode berjalan atau total semua periode termasuk re-entry)?
3. Batas akumulasi/perpanjangan kontrak (mis. total kontrak berturut-turut)? Bila ya, apakah riwayat kontrak harus disimpan per periode (saat ini hanya kontrak berjalan)?

**B. Personel tanpa tanggal berakhir kontrak** — apakah ada jenis kontrak tanpa tanggal akhir (mis. karyawan tetap) yang tidak boleh dihitung "Data kontrak belum lengkap"?

**C. Dokumen wajib**
1. Daftar dokumen wajib per jenis transaksi (Entry, Edit data dasar, Movement, Exit)?
2. Apakah kelengkapan dokumen juga menjadi syarat **submit**? (Saat ini: tidak; hanya validasi akhir.)
3. Siapa pemeriksa dokumen — sama dengan validator transaksi menurut validation policy, atau peran terpisah? (Saat ini: siapa pun dengan `review_documents` dalam scope.)
4. Apakah status selain `ACCEPTED` (mis. dokumen dapat menyusul) boleh meloloskan validasi?
5. Masa retensi file dan apakah dokumen entry juga berlaku untuk personel impor lama yang sudah `VALIDATED`.
6. Batas ukuran & tipe file final (default 10 MB, PDF/JPG/PNG).

**D. Target finance** — belum ada definisi; tidak ada yang diimplementasikan. Dibutuhkan:
1. Bentuk target: nominal uang, persentase, atau ukuran lain?
2. Jenis: pendapatan, biaya, margin, penagihan, atau pembayaran?
3. Periode (bulanan/kuartalan/tahunan) dan cakupan (perusahaan/client/project/area)?
4. Sumber realisasi dan cara pencatatannya (input manual? impor dari sistem lain?).
5. Mata uang (IDR saja?) dan aturan pembulatan.
6. Role yang boleh melihat dan mengubah.

Rencana setelah definisi disepakati: tabel target per (periode, cakupan) unik, nilai uang `numeric(18,2)`/integer rupiah, mata uang eksplisit, realisasi terpisah dengan audit, `null` ≠ 0, persentase hanya bila target > 0, permission `view_finance`/`manage_finance`, tanpa penjumlahan lintas mata uang.

**E. Batas kewajaran** tinggi/berat badan (bila diperlukan) dan apakah di luar batas = error atau warning review.

## 4. API baru (lihat `packages/contracts/openapi.yaml`)

| Endpoint | Permission |
|---|---|
| `GET /dashboard/compliance?areaId=` | `view_dashboard` (angka hanya bila `view_employee`; jika tidak → `null`, bukan 0) |
| `GET /contracts/monitoring?status=ACTION\|EXPIRING\|EXPIRED\|INCOMPLETE\|ALL&areaId=&projectId=&page=&pageSize=` | `view_employee` + scope |
| `GET/PUT /settings/contract-monitoring` | baca: `view_employee`/`view_dashboard`; ubah: `manage_contract_monitoring` |
| `GET /documents/catalog` | `view_employee` atau `manage_document_requirements` |
| `PUT /settings/document-types/{code}`, `PUT /settings/document-requirements/{transaction}` | `manage_document_requirements` |
| `GET /employees/{id}/documents` | `view_employee` + scope |
| `GET /documents/queue?status=ALL\|INCOMPLETE\|PENDING_REVIEW\|REJECTED&areaId=` | `view_employee` + scope |
| `POST /documents/subjects/{subjectType}/{subjectId}/{documentType}` (multipart `file`) | `upload_documents` + scope |
| `POST /documents/versions/{id}/review` | `review_documents` + scope |
| `GET /documents/versions/{id}/content` | `view_employee` + (`upload_documents`\|`review_documents`) + scope |

`EntryInput` mendapat field opsional `height`, `weight` (string). Kartu dashboard dan daftar detail memakai fungsi agregasi yang sama (diuji).

Filter dashboard: kartu kontrak & dokumen hanya mengikuti **Area**; rentang tanggal dashboard **tidak** berlaku (makna tanggal berbeda: kontrak = tanggal bisnis hari ini, dokumen = pengajuan terbuka).

## 5. Migration & data lama

`0002_contracts_documents.sql` (aditif): tabel `contract_monitoring_settings` (1 baris default 30/14/7), `document_types`, `document_requirements`, `document_versions`; menambah permission baru ke role yang sudah ada (Super Admin: semua; Area Support: upload; HR HO: upload + review) tanpa menghapus permission lain. Tidak ada kolom diubah/dihapus; nilai profil lama yang tidak valid (mis. berat `"abc"`) **tidak** disentuh — diuji `TestMigration0002KeepsExistingData`. Nilai tersebut akan ditolak hanya ketika pengguna mengirim ulang field itu.

## 6. Deployment (frontend dan backend harus dirilis bersama)

Kontrak API berubah (endpoint baru, field `height`/`weight`, permission baru) dan frontend memanggil endpoint baru → **frontend baru tidak bisa jalan dengan backend lama**. Backend baru tetap kompatibel dengan frontend lama (field baru opsional; field yang tidak dikirim tidak menghapus data).

Urutan:
1. Siapkan volume privat persisten untuk dokumen; set `STORAGE_DIR` (wajib di production), opsional `DOCUMENT_MAX_BYTES`, `DOCUMENT_ALLOWED_TYPES`. Jangan mount di bawah folder yang disajikan web server. Sertakan dalam backup.
2. Backup database.
3. `api migrate` (menerapkan `0002`).
4. Rollout backend (`api serve`).
5. Deploy frontend.
6. Admin mengisi jenis & kewajiban dokumen (setelah keputusan bisnis C.1) dan meninjau ambang kontrak.

Mode instance ganda: `Local` storage hanya aman untuk satu host atau volume bersama; untuk banyak instance gunakan volume bersama atau implementasi object storage pada antarmuka `storage.Store`.

## 7. Keterbatasan

- Arti "4 tahun" & target finance belum diimplementasikan (menunggu jawaban §3).
- Riwayat kontrak per periode belum disimpan; monitoring memakai kontrak berjalan.
- Mode lokal (`VITE_DATA_SOURCE=local`) tidak mendukung dokumen/monitoring kontrak (halaman menampilkan "Membutuhkan backend"); field tinggi/berat badan tidak disimpan di mode lokal.
- Unduh dokumen membaca file ke memori (≤ `DOCUMENT_MAX_BYTES`); tidak ada pratinjau inline (selalu attachment).
- Belum ada pemindaian malware; verifikasi tipe hanya magic bytes + ekstensi.
- Antrean dokumen dihitung on-request dari seluruh pengajuan terbuka dalam scope (tanpa pagination); layak untuk ribuan baris, perlu pagination bila jauh lebih besar.
- Ownership volume `/data/documents` di image distroless sudah diset ke uid 65532 tetapi belum diuji dengan container yang benar-benar menulis file.

## Tambahan 11 Nov 2026 (umpan balik pengujian)

- **Peringatan import sebelum disimpan.** Preview (`POST /imports/previews`) mengembalikan `warnings` (baris, kolom, nilai di file, alasan; maks. 5000) dan `warningsTotal`. Halaman Import menampilkan tabel "Peringatan & Error Sebelum Disimpan" beserta jumlah per kolom dan laporan CSV. Bila ada peringatan, tombol Konfirmasi & Simpan baru aktif setelah pengguna mencentang bahwa peringatan sudah diperiksa. Error tetap memblokir commit.
- **Detail personel kosong.** Parameter path tidak di-decode, sehingga ID personel dari Excel yang berisi spasi atau `/` mengembalikan 404 dan halaman detail jatuh ke profil ringkas. Sekarang semua parameter path di-decode (`pathParam`). Halaman detail menampilkan "Memuat data lengkap…" atau pesan galat, bukan "Belum tersedia", selama profil lengkap belum termuat. Sel Excel berisi `-` tetap dibaca sebagai kosong.
- **Kesiapan validasi** (`GET /validation/readiness`, perlu `view_employee` + `validate_employee_entry_edit`). Untuk setiap entry Menunggu validasi dalam scope, server melaporkan temuan hanya dari aturan yang sudah ada:
  - Memblokir: `PLACEMENT_INCOMPLETE`, `IMPORT_REVIEW`, `DOCUMENTS_INCOMPLETE`.
  - Informatif: `IMPORT_WARNING` (baris + kolom), `CONTRACT_CHECK` (data kontrak belum lengkap atau kontrak sudah berakhir).
  - Halaman Validasi menampilkan kartu Siap / Perlu dicek / Tertahan (bisa diklik untuk menyaring) dan temuan di setiap baris. Ada dua tombol: **Validasi yang Valid** (hanya entry tanpa temuan) dan **Validasi Semua** (Siap + Perlu dicek, dengan konfirmasi yang menyebut jumlah entry berperingatan). Entry Tertahan tidak pernah ikut validasi massal; server juga melewatinya. Validasi massal dikirim per 1000 entry (batas server).
- **Seed.** `make seed` hanya membuat akun demo, ditambah area Bandung (wajib untuk akun Area Support). Data sampel dipindah ke `apps/api/internal/testfixture` (khusus test).

## Tambahan 13 Nov 2026

- **Notifikasi.**
  - `GET /notifications` mendukung `offset`, `unread`, dan `category`, serta mengembalikan `total`. Halaman Notifikasi mengambil data per halaman dari server; sebelumnya hanya 100 notifikasi terbaru yang termuat.
  - `POST /notifications/mark` dengan `{action: "read", all: true}` menandai **semua** notifikasi belum dibaca milik pengguna, bukan hanya yang sedang termuat.
- **Dokumen Karyawan** (migration `0003_employee_documents`).
  - Subjek dokumen baru `PERSONNEL` (dokumen milik karyawan) beserta jenis kewajiban `EMPLOYEE_FILE`.
  - Dokumen dapat diunggah kapan saja, termasuk setelah validasi, dan tidak pernah terkunci.
  - Kewajibannya **hanya peringatan**: validasi tetap bisa dilakukan. Validasi akhir untuk kewajiban per jenis transaksi tetap memblokir seperti sebelumnya.
  - `GET /documents/employee-status?areaId=` mengembalikan daftar karyawan aktif dalam scope yang PKWT-nya belum Diterima, dengan status belum diunggah, menunggu pemeriksaan, atau ditolak.
  - Peringatan tampil di daftar karyawan, detail karyawan, dan halaman Validasi.
  - **Keputusan 13 Nov (pengguna):** dokumen karyawan cukup satu, yaitu **PKWT (kontrak kerja)**, bukan foto KTP. Migration `0004_pkwt` membuat jenis dokumen `PKWT` dan menjadikannya wajib (hanya peringatan) untuk `EMPLOYEE_FILE`. Kewajiban ini tetap dan tidak bisa diubah lewat API (`404`).
  - **Halaman "Dokumen Wajib" dihapus dari UI** karena membingungkan. Endpoint admin untuk jenis dokumen dan kewajiban per jenis transaksi masih ada di API, tetapi tidak dipakai (tidak ada kewajiban, sehingga gate validasi tidak aktif).
  - Halaman **Kelengkapan PKWT** (`/documents`) menampilkan daftar karyawan yang PKWT-nya belum lengkap. Kartu dashboard "PKWT karyawan" juga dihitung dari data yang sama (`employeeDocuments` pada `/dashboard/compliance`).
  - Di Master Employee, klik baris langsung membuka detail karyawan. Kolom ikon panah dihapus.
- **Kinerja dashboard.**
  - Lambatnya ada di browser (sekitar 5 detik), bukan di server: snapshot 0,2 detik, compliance 0,17 detik. Penyebabnya grafik per project yang menggambar ratusan project hasil import, ditambah perhitungan bersarang.
  - Perhitungan grafik sekarang dilakukan sekali jalan (memoized), dan grafik project hanya menampilkan 10 project teratas yang bernilai. Hasilnya sekitar 0,55 detik di mode development.
  - **Redis tidak ditambahkan**, karena server bukan bottleneck. Cache juga harus memperhitungkan permission, scope area, dan invalidasi data, dan menambah komponen yang perlu di-deploy. Pertimbangkan lagi bila hasil pengukuran di production menunjukkan query server yang lambat.
  - Sisa beban terbesar: snapshot 5,2 MB yang memuat semua karyawan ke browser. Langkah berikutnya, bila diperlukan, adalah memindahkan agregasi dashboard ke endpoint server.
- **Urutan deploy:** backup DB → `api migrate` (0003, 0004) → backend → frontend. Frontend baru membutuhkan backend baru.
