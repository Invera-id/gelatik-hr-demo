import type { EmployeeProfile } from '../types'

export type ProfileKey = keyof EmployeeProfile
export interface FieldGroup { title: string; fields: Array<[ProfileKey, string]> }

/** Reference CSV headers mapped by meaning only. Section markers and export date are excluded. */
export const employeeFieldGroups: FieldGroup[] = [
  { title: 'KTP & Identity', fields: [['nationalId', 'No KTP'], ['birthPlace', 'Tempat Lahir'], ['birthDate', 'Tanggal Lahir'], ['gender', 'Jenis Kelamin'], ['ktpAddress', 'Alamat KTP'], ['ktpRt', 'RT KTP'], ['ktpRw', 'RW KTP'], ['ktpKelurahan', 'Kelurahan KTP'], ['ktpKecamatan', 'Kecamatan KTP'], ['ktpCity', 'Kota KTP'], ['ktpProvince', 'Provinsi KTP'], ['ktpPostalCode', 'Kode Pos KTP'], ['religion', 'Agama']] },
  { title: 'Domicile', fields: [['domicileAddress', 'Alamat Domisili'], ['domicileRt', 'RT Domisili'], ['domicileRw', 'RW Domisili'], ['domicileKelurahan', 'Kelurahan Domisili'], ['domicileKecamatan', 'Kecamatan Domisili'], ['domicileCity', 'Kota Domisili'], ['domicileProvince', 'Provinsi Domisili'], ['domicilePostalCode', 'Kode Pos Domisili']] },
  { title: 'Contact & Status', fields: [['maritalStatus', 'Status Perkawinan'], ['education', 'Pendidikan Terakhir'], ['homePhone', 'Telepon Rumah'], ['mobilePhone', 'Handphone'], ['email', 'Alamat Email']] },
  { title: 'Contract & Administration', fields: [['initialDepositDate', 'Tanggal Setoran Awal'], ['bankAccountNumber', 'No Rekening'], ['bankAccountName', 'Nama Pemilik Rekening'], ['taxId', 'No NPWP'], ['program', 'Program']] },
  { title: 'Placement & Outlet', fields: [['areaCbs', 'Area CBS'], ['clientName', 'Nama Client'], ['projectName', 'Nama Project'], ['teamLeader', 'Nama TL'], ['employeeStatus', 'Status dari Source'], ['outlet', 'Outlet'], ['coverageArea', 'Area Coverage']] },
  { title: 'BPJS & Jamsostek', fields: [['jamsostekNumber', 'No Jamsostek'], ['bpjsHealthNumber', 'No BPJS Kesehatan'], ['motherName', 'Nama Ibu Kandung'], ['motherNationalId', 'NIK Ibu Kandung']] },
  { title: 'HR Movement', fields: [['mutationDate', 'Tanggal Mutasi'], ['exitDate', 'Tanggal Keluar'], ['exitReason', 'Alasan Keluar'], ['penalty', 'Pinalti']] },
  { title: 'Academic Test', fields: [['academicScore', 'Nilai Tes Akademik'], ['personalityScore', 'Nilai Kepribadian'], ['basicAbilityScore', 'Nilai Kemampuan Dasar'], ['logicScore', 'Nilai Logika']] },
  { title: 'Physical Selection', fields: [['height', 'Tinggi Badan'], ['weight', 'Berat Badan'], ['noGlasses', 'Tidak Berkacamata'], ['notCrossEyed', 'Tidak Juling'], ['notColorBlind', 'Tidak Buta Warna'], ['noBraces', 'Tidak Berkawat Gigi'], ['healthyTeeth', 'Gigi Sehat'], ['healthySkin', 'Kulit Sehat'], ['normalPosture', 'Postur Normal'], ['normalWalking', 'Berjalan Normal'], ['pregnancyCondition', 'Kondisi Kehamilan'], ['clearSpeech', 'Bicara Jelas']] },
  { title: 'Employment Closure', fields: [['agreementTermination', 'Pengakhiran Perjanjian'], ['warningLetter', 'SP yang Diberikan'], ['companyName', 'Nama Perusahaan'], ['tenureLabel', 'Masa Kerja']] },
]
