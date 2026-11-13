import { normalizeHeader } from './normalizers'

/**
 * Canonical 83-column template for the PT Gelatik Supra personnel workbook.
 * Order matters: the file is mapped positionally after its header row is verified
 * against this template, because several source headers repeat (Alamat, RT, RW,
 * kelurahan, kecamatan, kotamadya, propinsi, Kode Pos appear for both KTP and
 * DOMISILI) and would overwrite each other under name-based mapping.
 */

export type ColumnKind =
  | 'marker' // group separator header, carries no per-personnel value
  | 'ignore' // read but not stored as a field (e.g. the "No" running number)
  | 'text'
  | 'identifier'
  | 'rtrw'
  | 'date'
  | 'score'
  | 'height'
  | 'weight'
  | 'boolean'
  | 'statusCode'
  | 'gender'
  | 'tenure'

export interface ColumnDef {
  /** 0-based position in the template. */
  index: number
  /** Exact source header text. */
  header: string
  /** Canonical internal field key (null for markers/ignored columns). */
  field: string | null
  kind: ColumnKind
}

const C = (header: string, field: string | null, kind: ColumnKind): [string, string | null, ColumnKind] => [header, field, kind]

const TEMPLATE: Array<[string, string | null, ColumnKind]> = [
  C('No', null, 'ignore'),
  C('ID Personil', 'personnelId', 'identifier'),
  C('Area CBS', 'areaCbs', 'text'),
  C('Sub Area', 'subArea', 'text'),
  C('KTP', null, 'marker'),
  C('Nama', 'name', 'text'),
  C('NoKTP', 'nationalId', 'identifier'),
  C('Tempat lahir', 'birthPlace', 'text'),
  C('Tanggal Lahir', 'birthDate', 'date'),
  C('Jenis Kelamin', 'gender', 'gender'),
  C('Alamat', 'ktpAddress', 'text'),
  C('RT', 'ktpRt', 'rtrw'),
  C('RW', 'ktpRw', 'rtrw'),
  C('kelurahan', 'ktpKelurahan', 'text'),
  C('kecamatan', 'ktpKecamatan', 'text'),
  C('kotamadya', 'ktpCity', 'text'),
  C('propinsi', 'ktpProvince', 'text'),
  C('Kode Pos', 'ktpPostalCode', 'identifier'),
  C('Agama', 'religion', 'text'),
  C('DOMISILI', null, 'marker'),
  C('Alamat', 'domicileAddress', 'text'),
  C('RT', 'domicileRt', 'rtrw'),
  C('RW', 'domicileRw', 'rtrw'),
  C('kelurahan', 'domicileKelurahan', 'text'),
  C('kecamatan', 'domicileKecamatan', 'text'),
  C('kotamadya', 'domicileCity', 'text'),
  C('propinsi', 'domicileProvince', 'text'),
  C('Kode Pos', 'domicilePostalCode', 'identifier'),
  C('STATUS', null, 'marker'),
  C('Status Perkawinan', 'maritalStatus', 'text'),
  C('Pendidikan Terakhir', 'education', 'text'),
  C('TelpRumah', 'homePhone', 'identifier'),
  C('Handphone', 'mobilePhone', 'identifier'),
  C('Alamat Email', 'email', 'text'),
  C('DATA KONTRAK', null, 'marker'),
  C('Tanggal Bergabung', 'joinDate', 'date'),
  C('Tanggal Kontrak', 'contractStartDate', 'date'),
  C('Tanggal Berakhir Kontrak', 'contractEndDate', 'date'),
  C('Tanggal Setoran Awal', 'initialDepositDate', 'date'),
  C('No Rekening', 'bankAccountNumber', 'identifier'),
  C('Nama Pada Nomer Rekening', 'bankAccountName', 'text'),
  C('No NPWP', 'taxId', 'identifier'),
  C('Program', 'program', 'text'),
  C('DATA OUTLET', null, 'marker'),
  C('Nama Client', 'clientName', 'text'),
  C('Nama Project', 'projectName', 'text'),
  C('Nama TL', 'teamLeader', 'text'),
  C('Posisi', 'position', 'text'),
  C('Status', 'employeeStatus', 'statusCode'),
  C('Outlet', 'outlet', 'text'),
  C('Area Coverage', 'coverageArea', 'text'),
  C('DATA JAMSOSTEK', null, 'marker'),
  C('No Jamsostek', 'jamsostekNumber', 'identifier'),
  C('No BPJS Kesehatan', 'bpjsHealthNumber', 'identifier'),
  C('Nama Ibu Kandung', 'motherName', 'text'),
  C('NIK Ibu Kandung', 'motherNationalId', 'identifier'),
  C('DATA HRD', null, 'marker'),
  C('Tanggal Mutasi', 'mutationDate', 'date'),
  C('Tanggal Keluar', 'exitDate', 'date'),
  C('Alasan Keluar', 'exitReason', 'text'),
  C('Pinalti', 'penalty', 'text'),
  C('NILAI AKADEMIK', null, 'marker'),
  C('Nilai Tes Akademik', 'academicScore', 'score'),
  C('Nilai Tes Kepribadian', 'personalityScore', 'score'),
  C('Nilai Tes Kemampuan Dasar', 'basicAbilityScore', 'score'),
  C('Nilai Tes Logika', 'logicScore', 'score'),
  C('SELEKSI FISIK', null, 'marker'),
  C('Tinggi Badan', 'height', 'height'),
  C('Berat Badan', 'weight', 'weight'),
  C('Tidak menggunakan kacamata', 'noGlasses', 'boolean'),
  C('Tidak juling', 'notCrossEyed', 'boolean'),
  C('Tidak buta warna', 'notColorBlind', 'boolean'),
  C('Tidak menggunakan kawat gigi', 'noBraces', 'boolean'),
  C('Struktur gigi lengkap dan rapih', 'healthyTeeth', 'boolean'),
  C('Kulit bersih dan sehat', 'healthySkin', 'boolean'),
  C('Postur tubuh normal tidak cacat', 'normalPosture', 'boolean'),
  C('Gerak berjalan normal', 'normalWalking', 'boolean'),
  C('Tidak sedang mengandung/ hamil bagi wanita', 'pregnancyCondition', 'boolean'),
  C('Bicara Jelas dan lancar', 'clearSpeech', 'boolean'),
  C('Pengakhiran Perjanjian', 'agreementTermination', 'boolean'),
  C('SP yang diberikan', 'warningLetter', 'text'),
  C('NAMA PERUSAHAAN', 'companyName', 'text'),
  C('MASA KERJA', 'tenureLabel', 'tenure'),
]

export const COLUMN_TEMPLATE: ColumnDef[] = TEMPLATE.map(([header, field, kind], index) => ({ index, header, field, kind }))

export const TEMPLATE_COLUMN_COUNT = COLUMN_TEMPLATE.length

/** Normalized headers of the template, in order, for structural comparison. */
export const TEMPLATE_HEADERS_NORMALIZED = COLUMN_TEMPLATE.map((column) => normalizeHeader(column.header))

/** Headers that uniquely identify the personnel header row (used for header detection). */
export const SIGNATURE_HEADERS = ['id personil', 'nama', 'tanggal bergabung', 'posisi'].map((value) => normalizeHeader(value))

/** Group-marker headers (used to skip group-title rows and anchor group context). */
export const MARKER_HEADERS = new Set(
  COLUMN_TEMPLATE.filter((column) => column.kind === 'marker').map((column) => normalizeHeader(column.header)),
)
