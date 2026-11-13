package api

import (
	"context"
	"net/url"
	"testing"

	"github.com/xuri/excelize/v2"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

// workbook builds a synthetic 83-column workbook; rows are field→value maps.
func workbook(t *testing.T, sheet string, rows ...map[string]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	_ = f.SetSheetName("Sheet1", sheet)
	idx := map[string]int{}
	for i, c := range imports.Template {
		ref, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr(sheet, ref, c.Header)
		if c.Field != "" {
			idx[c.Field] = i
		}
	}
	for r, row := range rows {
		for k, v := range row {
			ref, _ := excelize.CoordinatesToCellName(idx[k]+1, r+2)
			_ = f.SetCellValue(sheet, ref, v)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func row(id, name, area, project, position string, extra ...any) map[string]any {
	m := map[string]any{"personnelId": id, "name": name, "areaCbs": area, "projectName": project, "position": position, "joinDate": "2025-01-06", "nationalId": "3201010101010001"}
	for i := 0; i+1 < len(extra); i += 2 {
		m[extra[i].(string)] = extra[i+1]
	}
	return m
}

type preview struct {
	PreviewID       string               `json:"previewId"`
	Status          string               `json:"status"`
	Summary         imports.Summary      `json:"summary"`
	ScopePreview    imports.ScopePreview `json:"scopePreview"`
	DiscoveredAreas []imports.RefArea    `json:"discoveredAreas"`
}

func TestImportLifecycle(t *testing.T) {
	e := newEnv(t)
	hr, bandung, admin := e.login("hr@demo.test"), e.login("bandung@demo.test"), e.login("superadmin@demo.test")

	if r := hr.upload("/api/v1/imports/previews", "x.xlsx", workbook(t, "Database aktif", row("P1", "Satu", "Bandung", "Project Alpha Bandung", "Sales"))); r.Status != 422 || !contains(r.Body, "Sheet Database tidak ditemukan") {
		t.Fatalf("wrong sheet must be rejected: %d %s", r.Status, r.Body)
	}
	if r := hr.upload("/api/v1/imports/previews", "x.xls", []byte("x")); r.Status != 422 {
		t.Fatalf(".xls must be rejected: %d", r.Status)
	}
	if r := e.login("operations@demo.test").upload("/api/v1/imports/previews", "x.xlsx", []byte("x")); r.Status != 403 {
		t.Fatalf("read-only role cannot import: %d", r.Status)
	}

	file := workbook(t, "Database",
		row("P-001", "Satu", "Bandung", "Project Alpha Bandung", "Sales", "bankAccountNumber", "0012345"),
		row("P-002", "Dua", "Bandung", "Project Alpha Bandung", "Sales"),
		row("P-002", "Dua", "Jakarta", "Project Gamma Jakarta", "Sales"),
		row("P-003", "Tiga", "MAKASSAR", "NKP BARU", "SALES"),
	)
	personnel := e.count(`SELECT count(*) FROM personnel`)
	areas := e.count(`SELECT count(*) FROM areas`)
	var pv preview
	hr.must("POST", "/api/v1/imports/previews", nil, 422) // file part required
	r := hr.upload("/api/v1/imports/previews", "personil.xlsx", file)
	if r.Status != 200 {
		t.Fatalf("preview: %d %s", r.Status, r.Body)
	}
	r.json(t, &pv)
	if e.count(`SELECT count(*) FROM personnel`) != personnel || e.count(`SELECT count(*) FROM areas`) != areas || e.count(`SELECT count(*) FROM import_batches`) != 0 {
		t.Fatal("preview must not change business data")
	}
	if pv.Summary.NewMasters != 3 || len(pv.DiscoveredAreas) != 1 {
		t.Fatalf("preview summary: %+v", pv.Summary)
	}
	hr.must("POST", "/api/v1/imports/cancel", map[string]string{"previewId": pv.PreviewID}, 204)
	hr.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 404)

	hr.upload("/api/v1/imports/previews", "personil.xlsx", file).json(t, &pv)
	bandung.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 404) // bound to its owner
	var commit struct {
		BatchID string `json:"batchId"`
		Replay  bool   `json:"replay"`
	}
	hr.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 200).json(t, &commit)
	var replay struct {
		BatchID string `json:"batchId"`
		Replay  bool   `json:"replay"`
	}
	hr.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 200).json(t, &replay)
	if !replay.Replay || replay.BatchID != commit.BatchID || e.count(`SELECT count(*) FROM import_batches`) != 1 {
		t.Fatal("commit must be idempotent")
	}
	if e.count(`SELECT count(*) FROM personnel`) != personnel+3 || e.count(`SELECT count(*) FROM import_source_records`) != 4 {
		t.Fatal("masters + distinct source records expected")
	}
	if e.count(`SELECT count(*) FROM personnel WHERE business_key = 'P-002' AND condition_status = 'NEEDS_REVIEW'`) != 1 {
		t.Fatal("ambiguous history stays NEEDS_REVIEW")
	}
	if e.count(`SELECT count(*) FROM personnel WHERE business_key = 'P-001' AND profile->>'bankAccountNumber' = '0012345' AND national_id = '3201010101010001'`) != 1 {
		t.Fatal("identifiers must be stored as strings")
	}
	if e.count(`SELECT count(*) FROM personnel WHERE record_status = 'SUBMITTED' AND source = 'IMPORT'`) != 3 {
		t.Fatal("import does not mean HR validation")
	}

	// Identical re-import is a no-op.
	hr.upload("/api/v1/imports/previews", "personil-ulang.xlsx", file).json(t, &pv)
	if pv.Summary.NewMasters != 0 || pv.Summary.NewSourceRecords != 0 {
		t.Fatalf("identical re-import: %+v", pv.Summary)
	}
	hr.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 200)
	if e.count(`SELECT count(*) FROM import_source_records`) != 4 || e.count(`SELECT count(*) FROM import_review_items`) != 1 {
		t.Fatal("re-import must not duplicate source records or review items")
	}

	// Data changed after preview → conflict, nothing written.
	hr.upload("/api/v1/imports/previews", "baru.xlsx", workbook(t, "Database", row("P-001", "Satu", "Bandung", "Project Alpha Bandung", "Sales", "religion", "Islam"))).json(t, &pv)
	if _, err := e.pool.Exec(context.Background(), `UPDATE personnel SET version = version + 1 WHERE business_key = 'P-001'`); err != nil {
		t.Fatal(err)
	}
	if r := hr.do("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}); r.Status != 409 || r.code() != "PREVIEW_STALE" {
		t.Fatalf("stale preview: %d %s", r.Status, r.Body)
	}

	// Area Support: out-of-scope rows excluded, cannot create references; scope change invalidates preview.
	areasBefore := e.count(`SELECT count(*) FROM areas`)
	scoped := workbook(t, "Database",
		row("B-1", "Bandung Satu", "Bandung", "Project Baru Bandung", "Sales"),
		row("B-2", "Luar", "PAPUA", "X", "Sales"),
	)
	bandung.upload("/api/v1/imports/previews", "bdg.xlsx", scoped).json(t, &pv)
	if pv.ScopePreview.OutOfScopeRows != 1 || len(pv.DiscoveredAreas) != 0 {
		t.Fatalf("scope preview: %+v areas=%v", pv.ScopePreview, pv.DiscoveredAreas)
	}
	admin.must("PUT", "/api/v1/settings/roles/AREA_SUPPORT", map[string]any{"scope": "SELECTED_AREAS", "selectedAreaIds": []string{"area-bandung", "area-semarang"},
		"permissions": []string{"view_dashboard", "view_employee", "import_personnel", "view_notifications"}}, 200)
	if r := bandung.do("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}); r.Status != 409 || r.code() != "SCOPE_CHANGED" {
		t.Fatalf("scope change: %d %s", r.Status, r.Body)
	}
	bandung.upload("/api/v1/imports/previews", "bdg.xlsx", scoped).json(t, &pv)
	bandung.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 200)
	if e.count(`SELECT count(*) FROM areas`) != areasBefore || e.count(`SELECT count(*) FROM personnel WHERE business_key = 'B-2'`) != 0 {
		t.Fatal("out-of-scope rows must not create areas or personnel")
	}

	// Review decision: confirm the P-002 placement change once.
	var ov struct {
		ReviewItems []struct {
			ID          string   `json:"id"`
			Kind        string   `json:"kind"`
			RecordIDs   []string `json:"recordIds"`
			BusinessKey string   `json:"businessKey"`
		} `json:"reviewItems"`
		SourceRecords []struct {
			ID     string             `json:"id"`
			Fields map[string]*string `json:"fields"`
		} `json:"sourceRecords"`
	}
	bandung.must("GET", "/api/v1/imports", nil, 200) // overview allowed with import permission
	hr.must("GET", "/api/v1/imports?status=PENDING,KEPT_PENDING", nil, 200).json(t, &ov)
	var itemID, before, after string
	for _, it := range ov.ReviewItems {
		if it.BusinessKey == "P-002" && it.Kind == "PLACEMENT_CHANGE" {
			itemID = it.ID
			for _, s := range ov.SourceRecords {
				for _, id := range it.RecordIDs {
					if s.ID == id && s.Fields["areaCbs"] != nil && *s.Fields["areaCbs"] == "Jakarta" {
						after = id
					} else if s.ID == id && s.Fields["areaCbs"] != nil && *s.Fields["areaCbs"] == "Bandung" {
						before = id
					}
				}
			}
		}
	}
	if itemID == "" || before == "" || after == "" {
		t.Fatalf("placement review item not found: %+v", ov.ReviewItems)
	}
	decision := map[string]any{"decisionKind": "PLACEMENT_CHANGE", "movementType": "AREA_CHANGE", "effectiveDate": "2026-03-01", "beforeRecordId": before, "afterRecordId": after, "note": "Mutasi terkonfirmasi"}
	bandung.must("POST", "/api/v1/imports/reviews/"+itemID+"/decision", decision, 403) // no resolve permission
	if r := hr.do("POST", "/api/v1/imports/reviews/"+itemID+"/decision", map[string]any{"decisionKind": "PLACEMENT_CHANGE", "beforeRecordId": before, "afterRecordId": after}); r.Status != 422 {
		t.Fatalf("missing effective date must be rejected: %d", r.Status)
	}
	hr.must("POST", "/api/v1/imports/reviews/"+itemID+"/decision", decision, 204)
	hr.must("POST", "/api/v1/imports/reviews/"+itemID+"/decision", decision, 409)
	if e.count(`SELECT count(*) FROM career_events WHERE source = 'IMPORT_REVIEW'`) != 1 {
		t.Fatal("repeated decision must not duplicate the timeline")
	}
	if e.count(`SELECT count(*) FROM personnel WHERE business_key = 'P-002' AND area_id = 'area-jakarta'`) != 1 {
		t.Fatal("confirmed placement must update the master")
	}
}

// Row warnings (row + column + raw value) are returned by the preview, before anything is
// saved, so the user can fix the workbook first.
func TestImportPreviewReportsWarningsBeforeCommit(t *testing.T) {
	e := newEnv(t)
	hr := e.login("hr@demo.test")
	file := workbook(t, "Database",
		row("W-001", "Satu", "Bandung", "Project Alpha Bandung", "Sales", "weight", "enam puluh"),
		row("W-002", "Dua", "Bandung", "Project Alpha Bandung", "Sales", "weight", "60,5"),
	)
	var pv struct {
		Warnings      []imports.FieldIssue `json:"warnings"`
		WarningsTotal int                  `json:"warningsTotal"`
	}
	hr.must("POST", "/api/v1/imports/previews", nil, 422)
	r := hr.upload("/api/v1/imports/previews", "personil.xlsx", file)
	if r.Status != 200 {
		t.Fatalf("preview: %d %s", r.Status, r.Body)
	}
	r.json(t, &pv)
	if pv.WarningsTotal != 1 || len(pv.Warnings) != 1 {
		t.Fatalf("warnings: %+v total=%d", pv.Warnings, pv.WarningsTotal)
	}
	if w := pv.Warnings[0]; w.RowNumber != 2 || w.Column != "Berat Badan" || w.RawValue != "enam puluh" {
		t.Fatalf("warning must point at row and column: %+v", w)
	}
	if e.count(`SELECT count(*) FROM import_source_records`) != 0 || e.count(`SELECT count(*) FROM import_batches`) != 0 {
		t.Fatal("preview must not save anything")
	}
}

// Personnel ids come from Excel and may contain spaces or "/"; the detail endpoint must
// decode the escaped path parameter (it returned 404 before, hiding the full profile).
func TestImportedIDWithReservedCharactersOpensDetail(t *testing.T) {
	e := newEnv(t)
	hr := e.login("hr@demo.test")
	var pv struct {
		PreviewID string `json:"previewId"`
	}
	hr.upload("/api/v1/imports/previews", "personil.xlsx", workbook(t, "Database",
		row("ID SL/001", "Spasi Garing", "Bandung", "Project Alpha Bandung", "Sales", "birthPlace", "Bandung"))).json(t, &pv)
	hr.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 200)
	var id string
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM personnel WHERE personnel_id = 'ID SL/001'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	var detail struct {
		Employee struct {
			ID      string         `json:"id"`
			Profile map[string]any `json:"profile"`
		} `json:"employee"`
	}
	hr.must("GET", "/api/v1/employees/"+url.PathEscape(id), nil, 200).json(t, &detail)
	if detail.Employee.ID != id || detail.Employee.Profile["birthPlace"] != "Bandung" {
		t.Fatalf("detail: %+v", detail.Employee)
	}
}
