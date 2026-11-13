package imports

import (
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// Synthetic fixtures only — no real personnel data.

var fieldIndex = func() map[string]int {
	m := map[string]int{}
	for _, c := range Template {
		if c.Field != "" {
			m[c.Field] = c.Index
		}
	}
	return m
}()

func headerRow() []Cell {
	row := make([]Cell, len(Template))
	for i, c := range Template {
		row[i] = Str(c.Header)
	}
	return row
}

func toCell(v any) Cell {
	switch x := v.(type) {
	case nil:
		return Cell{}
	case string:
		return Str(x)
	case float64:
		return Num(x)
	case int:
		return Num(float64(x))
	case bool:
		return Bool(x)
	case Cell:
		return x
	}
	panic("unsupported fixture value")
}

func buildRow(values map[string]any) []Cell {
	full := map[string]any{"areaCbs": "MAKASSAR", "projectName": "NKP MT REGULER", "position": "SALES", "joinDate": "2025-01-02"}
	if len(values) == 0 {
		full = map[string]any{}
	}
	for k, v := range values {
		full[k] = v
	}
	row := make([]Cell, len(Template))
	for k, v := range full {
		idx, ok := fieldIndex[k]
		if !ok {
			panic("unknown fixture field " + k)
		}
		row[idx] = toCell(v)
	}
	return row
}

func sheet(name string, rows ...map[string]any) SheetTable {
	t := SheetTable{Name: name, Rows: [][]Cell{headerRow()}}
	for _, r := range rows {
		t.Rows = append(t.Rows, buildRow(r))
	}
	return t
}

func parse(t *testing.T, sheets ...SheetTable) *ParseResult {
	t.Helper()
	res, err := Parse(&Workbook{Sheets: sheets})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return res
}

func testExisting() Existing {
	return Existing{
		Masters: map[string]ExistingMaster{}, Sources: map[string][]ExistingSource{}, Reviews: map[string]ExistingReview{},
		Areas:    []RefArea{{ID: "area-makassar", Name: "MAKASSAR"}, {ID: "area-bandung", Name: "Bandung"}},
		Projects: []RefProject{{ID: "project-nkp", Name: "NKP MT REGULER", ClientName: "PT. NUSA KARYA PANGAN", AreaID: "area-makassar"}},
	}
}

func TestSheetSelection(t *testing.T) {
	res := parse(t, sheet("Database aktif", map[string]any{"personnelId": "X1", "name": "Wrong"}), sheet("  database ", map[string]any{"personnelId": "P1", "name": "Satu"}))
	if len(res.Records) != 1 || res.Records[0].Name != "Satu" {
		t.Fatalf("expected only the Database sheet, got %+v", res.Records)
	}
	for _, name := range []string{"Database aktif", "Data base", "Sheet1"} {
		if _, err := Parse(&Workbook{Sheets: []SheetTable{sheet(name, map[string]any{"personnelId": "P1", "name": "A"})}}); err == nil || err.Error() != SheetNotFoundMessage {
			t.Fatalf("%q must not match: %v", name, err)
		}
	}
	if _, err := Parse(&Workbook{Sheets: []SheetTable{sheet("Database"), sheet("DATABASE")}}); err == nil || !strings.Contains(err.Error(), "ambigu") {
		t.Fatalf("duplicate Database sheets must abort, got %v", err)
	}
}

func TestReorderedAndMissingHeadersMapByName(t *testing.T) {
	headers := []string{"Nama", "Posisi", "ID Personil", "Tanggal Bergabung", "Kolom Baru", "Alamat", "Alamat"}
	row := []Cell{Str("Budi"), Str("SALES"), Str("007"), Str("2025-02-03"), Str("x"), Str("Jl KTP"), Str("Jl Domisili")}
	h := make([]Cell, len(headers))
	for i, v := range headers {
		h[i] = Str(v)
	}
	res := parse(t, SheetTable{Name: "Database", Rows: [][]Cell{h, row}})
	r := res.Records[0]
	if r.PersonnelID != "007" || r.Fields.Get("position") != "SALES" || r.Fields.Get("joinDate") != "2025-02-03" {
		t.Fatalf("mapping drifted: %+v", r.Fields)
	}
	if r.Fields.Get("ktpAddress") != "Jl KTP" || r.Fields.Get("domicileAddress") != "Jl Domisili" {
		t.Fatalf("repeated headers must map by occurrence: ktp=%q dom=%q", r.Fields.Get("ktpAddress"), r.Fields.Get("domicileAddress"))
	}
	if r.Fields["birthDate"] != nil || r.Fields["areaCbs"] != nil {
		t.Fatal("missing columns must be empty, not shifted")
	}
}

func TestIdentifiersStayStrings(t *testing.T) {
	res := parse(t, sheet("Database", map[string]any{"personnelId": "000123", "name": "A", "nationalId": "3201010101010001", "bankAccountNumber": "0012345", "taxId": "01.234.567.8-901.000", "ktpRt": 7, "mobilePhone": "08123", "bpjsHealthNumber": "xxxx1234"}))
	f := res.Records[0].Fields
	for k, want := range map[string]string{"personnelId": "000123", "nationalId": "3201010101010001", "bankAccountNumber": "0012345", "taxId": "01.234.567.8-901.000", "ktpRt": "007", "mobilePhone": "08123"} {
		if f.Get(k) != want {
			t.Errorf("%s = %q, want %q", k, f.Get(k), want)
		}
	}
	if !hasWarning(res.Records[0].Warnings, "tersamarkan") {
		t.Error("masked identifier must warn")
	}
	num := parse(t, sheet("Database", map[string]any{"personnelId": "P9", "name": "B", "nationalId": 9201010101010001.0}))
	if !hasWarning(num.Records[0].Warnings, "presisi") || strings.ContainsAny(num.Records[0].Fields.Get("nationalId"), "e+E.") {
		t.Errorf("numeric long identifier must stay digits and warn: %q", num.Records[0].Fields.Get("nationalId"))
	}
}

func hasWarning(ws []FieldIssue, part string) bool {
	for _, w := range ws {
		if strings.Contains(w.Reason, part) {
			return true
		}
	}
	return false
}

func TestDates(t *testing.T) {
	cases := map[string]Cell{"2026-09-09": Str("2026-09-09"), "2000-10-21": Str("21-Oct-00"), "2026-09-09 ": Str("09/09/2026"), "2026-09-09  ": Str("9-Sep-26"), "2026-09-09   ": Num(46274)}
	for want, in := range cases {
		got := NormalizeDate(in, false)
		if got.Value == nil || *got.Value != strings.TrimSpace(want) {
			t.Errorf("NormalizeDate(%+v) = %v, want %s", in, got.Value, want)
		}
	}
	if r := NormalizeDate(Str("31/02/2026"), false); !r.Invalid {
		t.Error("impossible date must be invalid")
	}
	if r := NormalizeDate(Num(1), true); r.Value == nil || *r.Value != "1904-01-02" {
		t.Errorf("1904 system: %v", r.Value)
	}
	res := parse(t, sheet("Database", map[string]any{"personnelId": "P1", "name": "A", "birthDate": "bukan tanggal", "initialDepositDate": "2025-01-05"}))
	if !hasWarning(res.Records[0].Warnings, "Tanggal tidak valid") || res.Records[0].Fields.Get("initialDepositDate") != "2025-01-05" {
		t.Fatal("invalid date must warn; Tanggal Setoran Awal must be read")
	}
}

func TestScoresMeasuresAndCodes(t *testing.T) {
	res := parse(t, sheet("Database", map[string]any{"personnelId": "P1", "name": "A", "academicScore": "65/100", "personalityScore": 65, "basicAbilityScore": 0, "height": "1.6 m", "weight": "55", "employeeStatus": "n/a"}))
	r := res.Records[0]
	if s := r.Structured.Scores["academicScore"]; s.MaxScore == nil || *s.MaxScore != 100 || *s.Percentage != 65 {
		t.Errorf("fraction score: %+v", s)
	}
	if s := r.Structured.Scores["personalityScore"]; s.MaxScore != nil || *s.Score != 65 {
		t.Errorf("plain score must not be scaled: %+v", s)
	}
	if r.Fields.Get("basicAbilityScore") != "0" {
		t.Error("zero is a value")
	}
	if r.Fields.Get("height") != "160 cm" || r.Fields.Get("weight") != "55 kg" {
		t.Errorf("measures: %s %s", r.Fields.Get("height"), r.Fields.Get("weight"))
	}
	if r.Fields.Get("employeeStatus") != "N/A" {
		t.Error("N/A outlet status is a business code")
	}
}

func TestRowsExceptionsBlanksAndDuplicates(t *testing.T) {
	res := parse(t, sheet("Database",
		map[string]any{"personnelId": "P1", "name": "Satu"},
		map[string]any{},
		map[string]any{"name": "Tanpa ID"},
		map[string]any{"personnelId": "P1", "name": "Satu"},
		map[string]any{"personnelId": "P1", "name": "Satu", "position": "TL"},
		map[string]any{"personnelId": "P2", "name": "Dua"},
	))
	if res.BlankRowsSkipped != 1 || len(res.Exceptions) != 1 || res.IdenticalDuplicatesInFile != 1 || len(res.Records) != 3 {
		t.Fatalf("blank=%d exc=%d dup=%d records=%d", res.BlankRowsSkipped, len(res.Exceptions), res.IdenticalDuplicatesInFile, len(res.Records))
	}
}

func TestFingerprintIgnoresProvenance(t *testing.T) {
	a := buildRow(map[string]any{"personnelId": "P1", "name": "A"})
	m1, m2 := MapRow(a, 2, false), MapRow(a, 99, false)
	if Fingerprint(m1.Fields) != Fingerprint(m2.Fields) || !strings.HasPrefix(Fingerprint(m1.Fields), "v2:") {
		t.Fatal("fingerprint must depend only on business values")
	}
	x := Fields{"a": sp("1b=2")}
	y := Fields{"a": sp("1"), "b": sp("2")}
	if Fingerprint(x) == Fingerprint(y) {
		t.Fatal("canonical form must be unambiguous")
	}
}

func rec(id string, fields map[string]string) ClassifyRecord {
	f := Fields{}
	for k, v := range fields {
		f[k] = sp(v)
	}
	return ClassifyRecord{ID: id, Fingerprint: Fingerprint(f), Fields: f}
}

func TestClassifyGroup(t *testing.T) {
	base := map[string]string{"personnelId": "P1", "name": "A", "areaCbs": "MAKASSAR", "position": "SALES"}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	if a := ClassifyGroup([]ClassifyRecord{rec("a", base), rec("b", base)}); a.PrimaryKind != "IDENTICAL_DUPLICATE" || a.NeedsReview {
		t.Fatal("identical records are a duplicate")
	}
	a := ClassifyGroup([]ClassifyRecord{rec("a", base), rec("b", with(map[string]string{"areaCbs": "BANDUNG", "mutationDate": "2026-03-01"}))})
	if a.AutoConfirmable == nil || a.AutoConfirmable.MovementType != "AREA_CHANGE" || a.AutoConfirmable.EffectiveDate != "2026-03-01" || a.AutoConfirmable.BeforeRecordID != "a" {
		t.Fatalf("clear mutation should be auto-confirmable candidate: %+v", a.AutoConfirmable)
	}
	if a := ClassifyGroup([]ClassifyRecord{rec("a", base), rec("b", with(map[string]string{"areaCbs": "BANDUNG"}))}); a.AutoConfirmable != nil || !a.NeedsReview {
		t.Fatal("placement change without mutation date needs review")
	}
	if a := ClassifyGroup([]ClassifyRecord{rec("a", base), rec("b", with(map[string]string{"exitDate": "2026-01-01"}))}); a.AutoConfirmable != nil || a.PrimaryKind != "EXIT" {
		t.Fatal("exit is never auto-resolved")
	}
	re := ClassifyGroup([]ClassifyRecord{rec("a", with(map[string]string{"exitDate": "2025-06-01", "joinDate": "2024-01-01"})), rec("b", with(map[string]string{"joinDate": "2025-09-01"}))})
	if !containsKind(re.Aspects, "REENTRY") {
		t.Fatal("join after exit is a re-entry candidate")
	}
	ktp := ClassifyGroup([]ClassifyRecord{rec("a", with(map[string]string{"nationalId": "3201010101010001"})), rec("b", with(map[string]string{"nationalId": "3201010101010002"}))})
	if !ktp.IdentityConflict {
		t.Fatal("two complete NIKs conflict")
	}
	masked := ClassifyGroup([]ClassifyRecord{rec("a", with(map[string]string{"nationalId": "3201010101010001"})), rec("b", with(map[string]string{"nationalId": "32010101xxxx0002"}))})
	if masked.IdentityConflict {
		t.Fatal("masked/incomplete NIK never counts as conflict")
	}
	contract := ClassifyGroup([]ClassifyRecord{rec("a", base), rec("b", with(map[string]string{"contractEndDate": "2026-12-31"}))})
	if contract.PrimaryKind != "PROFILE_VARIATION" || containsKind(contract.Aspects, "PLACEMENT_CHANGE") || containsKind(contract.Aspects, "REENTRY") {
		t.Fatal("contract date change alone is not mutation or re-entry")
	}
}

func containsKind(as []Aspect, kind string) bool {
	for _, a := range as {
		if a.Kind == kind {
			return true
		}
	}
	return false
}

func TestReconcileNewMastersAndReview(t *testing.T) {
	parsed := parse(t, sheet("Database",
		map[string]any{"personnelId": "P1", "name": "Satu"},
		map[string]any{"personnelId": "P2", "name": "Dua"},
		map[string]any{"personnelId": "P2", "name": "Dua", "areaCbs": "Bandung", "projectName": "BARU"},
		map[string]any{"personnelId": "P3", "name": "Tiga", "areaCbs": "PAPUA"},
	))
	plan := Reconcile(testExisting(), parsed, Options{BatchID: "b1", FileName: "f.xlsx"})
	if plan.Summary.NewMasters != 3 || plan.Summary.NewSourceRecords != 4 {
		t.Fatalf("summary %+v", plan.Summary)
	}
	var p2 MasterPlan
	for _, m := range plan.Masters {
		if m.BusinessKey == "P2" {
			p2 = m
		}
		if m.BusinessKey == "P1" && m.ConditionStatus != "CONFIRMED" {
			t.Fatal("clean single record is confirmed")
		}
	}
	if p2.ConditionStatus != "NEEDS_REVIEW" {
		t.Fatal("ambiguous history must stay NEEDS_REVIEW")
	}
	if plan.Summary.ConfirmedEvents != 0 || plan.Summary.MovementCandidates != 1 {
		t.Fatalf("history must go to review, not auto-confirm: %+v", plan.Summary)
	}
	if len(plan.NewAreas) != 1 || plan.NewAreas[0].Name != "PAPUA" {
		t.Fatalf("all-area importer discovers new areas: %+v", plan.NewAreas)
	}
}

func TestReconcileScopeBlocksOutOfScopeRows(t *testing.T) {
	ex := testExisting()
	areaB := "area-bandung"
	ex.Masters["P9"] = ExistingMaster{ID: "personnel-P9", BusinessKey: "P9", AreaID: &areaB, Fields: Fields{"personnelId": sp("P9"), "name": sp("Sembilan")}}
	parsed := parse(t, sheet("Database",
		map[string]any{"personnelId": "P1", "name": "Satu"},
		map[string]any{"personnelId": "P2", "name": "Dua", "areaCbs": "Bandung"},
		map[string]any{"personnelId": "P3", "name": "Tiga", "areaCbs": "PAPUA", "projectName": "X"},
		map[string]any{"personnelId": "P9", "name": "Sembilan"},
		map[string]any{"personnelId": "P4", "name": "Empat", "areaCbs": ""},
	))
	plan := Reconcile(ex, parsed, Options{BatchID: "b1", FileName: "f.xlsx", AllowedAreaIDs: []string{"area-makassar"}})
	if len(plan.NewAreas) != 0 || len(plan.NewProjects) != 0 {
		t.Fatalf("out-of-scope rows must not create references: %+v %+v", plan.NewAreas, plan.NewProjects)
	}
	if plan.ScopePreview.OutOfScopeRows != 3 {
		t.Fatalf("expected Bandung, PAPUA and the out-of-scope existing master excluded, got %+v", plan.ScopePreview.ExcludedRows)
	}
	if len(plan.Masters) != 1 || plan.Masters[0].BusinessKey != "P1" || plan.Summary.ExceptionRows != 1 {
		t.Fatalf("only P1 is imported; blank area is an error: masters=%d exc=%d", len(plan.Masters), plan.Summary.ExceptionRows)
	}
	for _, r := range plan.Reviews {
		if r.BusinessKey == "P9" {
			t.Fatal("must not leak out-of-scope master into review")
		}
	}
}

func TestReconcileIdempotentReimport(t *testing.T) {
	parsed := parse(t, sheet("Database", map[string]any{"personnelId": "P1", "name": "Satu"}))
	ex := testExisting()
	first := Reconcile(ex, parsed, Options{BatchID: "b1"})
	s := first.Sources[0]
	ex.Masters["P1"] = ExistingMaster{ID: "personnel-P1", BusinessKey: "P1", Fields: s.Fields}
	ex.Sources["P1"] = []ExistingSource{{ID: s.ID, BusinessKey: "P1", Fingerprint: s.Fingerprint, Fields: s.Fields}}
	second := Reconcile(ex, parsed, Options{BatchID: "b2"})
	if len(second.Masters)+len(second.Sources)+len(second.Reviews) != 0 || second.Summary.IdenticalDuplicates != 1 {
		t.Fatalf("identical re-import must be a no-op: %+v", second.Summary)
	}
}

func TestReadWorkbookFromXLSX(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	_, _ = f.NewSheet("Database")
	for i, c := range Template {
		ref, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr("Database", ref, c.Header)
	}
	set := func(field string, v any) {
		ref, _ := excelize.CoordinatesToCellName(fieldIndex[field]+1, 2)
		_ = f.SetCellValue("Database", ref, v)
	}
	set("personnelId", "000777")
	set("name", "Uji Coba")
	set("nationalId", "3201010101010001")
	set("joinDate", 45659) // serial for 2025-01-02
	set("position", "SALES")
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	wb, err := ReadWorkbook(buf.Bytes(), 1000)
	if err != nil {
		t.Fatal(err)
	}
	res, err := Parse(wb)
	if err != nil {
		t.Fatal(err)
	}
	r := res.Records[0]
	if r.PersonnelID != "000777" || r.Fields.Get("nationalId") != "3201010101010001" || r.Fields.Get("joinDate") != "2025-01-02" {
		t.Fatalf("xlsx read: %s %s %s", r.PersonnelID, r.Fields.Get("nationalId"), r.Fields.Get("joinDate"))
	}
	if _, err := ReadWorkbook([]byte("not a zip"), 10); err == nil {
		t.Fatal("corrupt workbook must abort")
	}
}

func TestWeightNormalizationIsSafeAndReportsRowAndColumn(t *testing.T) {
	rows := []map[string]any{}
	inputs := []any{"60 kg", "60,5", "60.5", 61.25, "abc", "enam puluh", "-5", "0", "1.234", ""}
	for i, w := range inputs {
		rows = append(rows, map[string]any{"personnelId": "W" + string(rune('A'+i)), "name": "Berat", "weight": w})
	}
	res := parse(t, sheet("Database", rows...))
	want := []string{"60 kg", "60.5 kg", "60.5 kg", "61.25 kg"}
	for i, w := range want {
		if got := res.Records[i].Fields.Get("weight"); got != w || len(res.Records[i].Warnings) != 0 {
			t.Errorf("row %d: got %q warnings %v want %q", i, got, res.Records[i].Warnings, w)
		}
	}
	for i := 4; i < 9; i++ {
		r := res.Records[i]
		if r.Structured.Measures["weight"].Value != nil {
			t.Errorf("row %d: %v must not be normalized", i, inputs[i])
		}
		if r.Structured.Measures["weight"].Raw == "" || len(r.Warnings) != 1 || r.Warnings[0].Column != "Berat Badan" || r.Warnings[0].RowNumber != r.RowNumber || r.RowNumber == 0 {
			t.Errorf("row %d: warning must name row and column and keep raw: %+v", i, r.Warnings)
		}
	}
	if res.Records[9].Fields.Get("weight") != "" || res.Records[9].Structured.Measures["weight"].Value != nil {
		t.Error("empty weight stays empty, never 0")
	}
}
