package imports

// ColumnKind controls how a template column is normalized.
type ColumnKind string

const (
	KindMarker     ColumnKind = "marker"
	KindIgnore     ColumnKind = "ignore"
	KindText       ColumnKind = "text"
	KindIdentifier ColumnKind = "identifier"
	KindRtRw       ColumnKind = "rtrw"
	KindDate       ColumnKind = "date"
	KindScore      ColumnKind = "score"
	KindHeight     ColumnKind = "height"
	KindWeight     ColumnKind = "weight"
	KindBoolean    ColumnKind = "boolean"
	KindStatusCode ColumnKind = "statusCode"
	KindGender     ColumnKind = "gender"
	KindTenure     ColumnKind = "tenure"
)

type ColumnDef struct {
	Index  int
	Header string
	Field  string // "" for markers/ignored columns
	Kind   ColumnKind
}

// Template is the canonical 83-column PT Gelatik Supra personnel workbook layout.
// Repeated labels (Alamat, RT, RW, ...) appear for both KTP and DOMISILI and are
// matched by occurrence order.
var Template = func() []ColumnDef {
	raw := [][3]string{
		{"No", "", "ignore"}, {"ID Personil", "personnelId", "identifier"}, {"Area CBS", "areaCbs", "text"}, {"Sub Area", "subArea", "text"},
		{"KTP", "", "marker"}, {"Nama", "name", "text"}, {"NoKTP", "nationalId", "identifier"}, {"Tempat lahir", "birthPlace", "text"},
		{"Tanggal Lahir", "birthDate", "date"}, {"Jenis Kelamin", "gender", "gender"}, {"Alamat", "ktpAddress", "text"}, {"RT", "ktpRt", "rtrw"},
		{"RW", "ktpRw", "rtrw"}, {"kelurahan", "ktpKelurahan", "text"}, {"kecamatan", "ktpKecamatan", "text"}, {"kotamadya", "ktpCity", "text"},
		{"propinsi", "ktpProvince", "text"}, {"Kode Pos", "ktpPostalCode", "identifier"}, {"Agama", "religion", "text"}, {"DOMISILI", "", "marker"},
		{"Alamat", "domicileAddress", "text"}, {"RT", "domicileRt", "rtrw"}, {"RW", "domicileRw", "rtrw"}, {"kelurahan", "domicileKelurahan", "text"},
		{"kecamatan", "domicileKecamatan", "text"}, {"kotamadya", "domicileCity", "text"}, {"propinsi", "domicileProvince", "text"},
		{"Kode Pos", "domicilePostalCode", "identifier"}, {"STATUS", "", "marker"}, {"Status Perkawinan", "maritalStatus", "text"},
		{"Pendidikan Terakhir", "education", "text"}, {"TelpRumah", "homePhone", "identifier"}, {"Handphone", "mobilePhone", "identifier"},
		{"Alamat Email", "email", "text"}, {"DATA KONTRAK", "", "marker"}, {"Tanggal Bergabung", "joinDate", "date"},
		{"Tanggal Kontrak", "contractStartDate", "date"}, {"Tanggal Berakhir Kontrak", "contractEndDate", "date"},
		{"Tanggal Setoran Awal", "initialDepositDate", "date"}, {"No Rekening", "bankAccountNumber", "identifier"},
		{"Nama Pada Nomer Rekening", "bankAccountName", "text"}, {"No NPWP", "taxId", "identifier"}, {"Program", "program", "text"},
		{"DATA OUTLET", "", "marker"}, {"Nama Client", "clientName", "text"}, {"Nama Project", "projectName", "text"}, {"Nama TL", "teamLeader", "text"},
		{"Posisi", "position", "text"}, {"Status", "employeeStatus", "statusCode"}, {"Outlet", "outlet", "text"}, {"Area Coverage", "coverageArea", "text"},
		{"DATA JAMSOSTEK", "", "marker"}, {"No Jamsostek", "jamsostekNumber", "identifier"}, {"No BPJS Kesehatan", "bpjsHealthNumber", "identifier"},
		{"Nama Ibu Kandung", "motherName", "text"}, {"NIK Ibu Kandung", "motherNationalId", "identifier"}, {"DATA HRD", "", "marker"},
		{"Tanggal Mutasi", "mutationDate", "date"}, {"Tanggal Keluar", "exitDate", "date"}, {"Alasan Keluar", "exitReason", "text"},
		{"Pinalti", "penalty", "text"}, {"NILAI AKADEMIK", "", "marker"}, {"Nilai Tes Akademik", "academicScore", "score"},
		{"Nilai Tes Kepribadian", "personalityScore", "score"}, {"Nilai Tes Kemampuan Dasar", "basicAbilityScore", "score"},
		{"Nilai Tes Logika", "logicScore", "score"}, {"SELEKSI FISIK", "", "marker"}, {"Tinggi Badan", "height", "height"},
		{"Berat Badan", "weight", "weight"}, {"Tidak menggunakan kacamata", "noGlasses", "boolean"}, {"Tidak juling", "notCrossEyed", "boolean"},
		{"Tidak buta warna", "notColorBlind", "boolean"}, {"Tidak menggunakan kawat gigi", "noBraces", "boolean"},
		{"Struktur gigi lengkap dan rapih", "healthyTeeth", "boolean"}, {"Kulit bersih dan sehat", "healthySkin", "boolean"},
		{"Postur tubuh normal tidak cacat", "normalPosture", "boolean"}, {"Gerak berjalan normal", "normalWalking", "boolean"},
		{"Tidak sedang mengandung/ hamil bagi wanita", "pregnancyCondition", "boolean"}, {"Bicara Jelas dan lancar", "clearSpeech", "boolean"},
		{"Pengakhiran Perjanjian", "agreementTermination", "boolean"}, {"SP yang diberikan", "warningLetter", "text"},
		{"NAMA PERUSAHAAN", "companyName", "text"}, {"MASA KERJA", "tenureLabel", "tenure"},
	}
	out := make([]ColumnDef, len(raw))
	for i, r := range raw {
		out[i] = ColumnDef{Index: i, Header: r[0], Field: r[1], Kind: ColumnKind(r[2])}
	}
	return out
}()

var TemplateHeadersNormalized = func() []string {
	out := make([]string, len(Template))
	for i, c := range Template {
		out[i] = NormalizeHeader(c.Header)
	}
	return out
}()

// SignatureHeaders identify the header row (a combination, not a single word).
var SignatureHeaders = []string{"id personil", "nama", "tanggal bergabung", "posisi"}

// EmployeeFieldKeys are stored on the personnel record; everything else goes to profile.
var EmployeeFieldKeys = map[string]bool{"personnelId": true, "name": true, "subArea": true, "position": true, "joinDate": true, "contractStartDate": true, "contractEndDate": true}
