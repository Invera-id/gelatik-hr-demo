package api

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
)

// Synthetic files only.
var (
	pdfBytes = []byte("%PDF-1.4\n% synthetic test document\n%%EOF\n")
	pngBytes = []byte("\x89PNG\r\n\x1a\n synthetic")
)

type docVersion struct {
	ID           string  `json:"id"`
	Version      int     `json:"version"`
	ReviewStatus string  `json:"reviewStatus"`
	ReviewNote   *string `json:"reviewNote"`
	SupersededAt *string `json:"supersededAt"`
}

type subjectDocs struct {
	SubjectType string `json:"subjectType"`
	SubjectID   string `json:"subjectId"`
	Complete    bool   `json:"complete"`
	Locked      bool   `json:"locked"`
	Slots       []struct {
		DocumentTypeCode string       `json:"documentTypeCode"`
		Required         bool         `json:"required"`
		Status           string       `json:"status"`
		Current          *docVersion  `json:"current"`
		History          []docVersion `json:"history"`
	} `json:"slots"`
}

func entryBody(pid string, submit bool, extra map[string]any) map[string]any {
	b := map[string]any{"personnelId": pid, "name": "Synthetic " + pid, "areaId": "area-bandung", "projectId": "project-alpha-bandung", "position": "Sales",
		"joinDate": "2026-09-01", "contractStatus": "SIGNED", "submit": submit}
	for k, v := range extra {
		b[k] = v
	}
	return b
}

func requireKTPForEntry(t *testing.T, admin *client) {
	t.Helper()
	admin.must("PUT", "/api/v1/settings/document-types/KTP", map[string]any{"name": "KTP (contoh sintetis)", "active": true}, 200)
	admin.must("PUT", "/api/v1/settings/document-requirements/EMPLOYEE_ENTRY", map[string]any{"documentTypeCodes": []string{"KTP"}}, 200)
}

func entryDocs(t *testing.T, c *client, id string) subjectDocs {
	t.Helper()
	var out struct{ Subjects []subjectDocs }
	c.must("GET", path("/api/v1/employees/%s/documents", id), nil, 200).json(t, &out)
	for _, s := range out.Subjects {
		if s.SubjectType == "PERSONNEL_ENTRY" {
			return s
		}
	}
	t.Fatal("entry subject missing")
	return subjectDocs{}
}

func TestRequiredDocumentsGateFinalValidation(t *testing.T) {
	e := newEnv(t)
	admin, hr, area := e.login("superadmin@demo.test"), e.login("hr@demo.test"), e.login("bandung@demo.test")
	area.must("PUT", "/api/v1/settings/document-requirements/EMPLOYEE_ENTRY", map[string]any{"documentTypeCodes": []string{}}, 403)
	requireKTPForEntry(t, admin)

	// Draft and submit are allowed without documents (submit gate is TBC; not enforced).
	var emp struct{ ID string }
	area.must("POST", "/api/v1/employees", entryBody("DOC-001", false, nil), 201).json(t, &emp)
	area.must("PUT", path("/api/v1/employees/%s", emp.ID), entryBody("DOC-001", true, nil), 200)

	validate := func(want int) resp {
		return hr.must("POST", path("/api/v1/employees/%s/validation", emp.ID), map[string]any{"status": "VALIDATED"}, want)
	}
	if r := validate(409); r.code() != "DOCUMENTS_INCOMPLETE" || !contains(r.Body, "KTP") {
		t.Fatalf("missing document must block final validation: %s", r.Body)
	}
	up := path("/api/v1/documents/subjects/PERSONNEL_ENTRY/%s/KTP", emp.ID)
	var v1 docVersion
	if r := area.upload(up, "ktp.pdf", pdfBytes); r.Status != 201 {
		t.Fatalf("upload: %d %s", r.Status, r.Body)
	} else {
		r.json(t, &v1)
	}
	if v1.ReviewStatus != "PENDING_REVIEW" {
		t.Fatalf("upload must not approve: %s", v1.ReviewStatus)
	}
	validate(409)
	review := func(c *client, id, status, note string, want int) resp {
		return c.must("POST", path("/api/v1/documents/versions/%s/review", id), map[string]any{"status": status, "note": note}, want)
	}
	review(area, v1.ID, "ACCEPTED", "", 403)
	if r := review(hr, v1.ID, "REJECTED", " ", 422); !contains(r.Body, "note") {
		t.Fatalf("rejection needs a reason: %s", r.Body)
	}
	review(hr, v1.ID, "REJECTED", "Foto buram", 200)
	if e.count(`SELECT count(*) FROM notifications WHERE category = 'DOCUMENT' AND recipient_user_id = 'user-bandung'`) != 1 {
		t.Fatal("uploader is notified about the rejection")
	}
	var v2 docVersion
	r := area.upload(up, "ktp-baru.pdf", pdfBytes)
	r.json(t, &v2)
	if r.Status != 201 || v2.Version != 2 || v2.ReviewStatus != "PENDING_REVIEW" {
		t.Fatalf("replacement: %d %s", r.Status, r.Body)
	}
	d := entryDocs(t, area, emp.ID)
	slot := d.Slots[0]
	if slot.Current.ID != v2.ID || len(slot.History) != 1 || slot.History[0].ReviewStatus != "REJECTED" || *slot.History[0].ReviewNote != "Foto buram" {
		t.Fatalf("previous version and its decision are kept: %+v", slot)
	}
	review(hr, v1.ID, "ACCEPTED", "", 409) // superseded version cannot be decided
	review(hr, v2.ID, "ACCEPTED", "", 200)
	review(hr, v2.ID, "REJECTED", "x", 409)

	// Replacing an accepted file starts a new review; the old approval does not carry over.
	var v3 docVersion
	area.upload(up, "ktp-v3.pdf", pdfBytes).json(t, &v3)
	if v3.ReviewStatus != "PENDING_REVIEW" || entryDocs(t, hr, emp.ID).Complete {
		t.Fatal("new version must be reviewed again")
	}
	validate(409)
	review(hr, v3.ID, "ACCEPTED", "", 200)
	validate(204)

	if r := area.upload(up, "late.pdf", pdfBytes); r.Status != 409 {
		t.Fatalf("validated subject is locked: %d", r.Status)
	}
	got := hr.must("GET", path("/api/v1/documents/versions/%s/content", v3.ID), nil, 200)
	if !bytes.Equal(got.Body, pdfBytes) || got.Header.Get("Content-Type") != "application/pdf" || !strings.HasPrefix(got.Header.Get("Content-Disposition"), "attachment") ||
		got.Header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("download: %v", got.Header)
	}
	// Operations may see personnel but has neither upload nor review permission → no file access.
	e.login("operations@demo.test").must("GET", path("/api/v1/documents/versions/%s/content", v3.ID), nil, 403)
	if n := e.count(`SELECT count(*) FROM document_versions WHERE subject_id = $1`, emp.ID); n != 3 {
		t.Fatalf("all versions kept, got %d", n)
	}
}

func TestBulkValidationSkipsIncompleteDocuments(t *testing.T) {
	e := newEnv(t)
	admin, hr, area := e.login("superadmin@demo.test"), e.login("hr@demo.test"), e.login("bandung@demo.test")
	requireKTPForEntry(t, admin)
	var emp struct{ ID string }
	area.must("POST", "/api/v1/employees", entryBody("DOC-BULK", true, nil), 201).json(t, &emp)
	var res struct{ Validated int }
	hr.must("POST", "/api/v1/employees/validate-bulk", map[string]any{"ids": []string{emp.ID}}, 200).json(t, &res)
	if res.Validated != 0 || e.count(`SELECT count(*) FROM personnel WHERE id = $1 AND record_status = 'VALIDATED'`, emp.ID) != 0 {
		t.Fatalf("bulk validation must not bypass required documents: %+v", res)
	}
}

func TestDocumentsAreScopedAndFilesVerified(t *testing.T) {
	e := newEnv(t)
	admin, area := e.login("superadmin@demo.test"), e.login("bandung@demo.test")
	requireKTPForEntry(t, admin)
	admin.must("POST", "/api/v1/users", map[string]any{"name": "Area Semarang", "email": "semarang@demo.test", "role": "AREA_SUPPORT", "areaId": "area-semarang", "password": demoPassword}, 201)
	other := e.login("semarang@demo.test")

	var emp struct{ ID string }
	area.must("POST", "/api/v1/employees", entryBody("DOC-SCOPE", false, nil), 201).json(t, &emp)
	up := path("/api/v1/documents/subjects/PERSONNEL_ENTRY/%s/KTP", emp.ID)

	for name, tc := range map[string]struct {
		file string
		data []byte
		want int
	}{
		"executable renamed to pdf": {"ktp.pdf", []byte("MZ\x90\x00 synthetic"), 422},
		"pdf disguised as png":      {"ktp.png", pdfBytes, 422},
		"html":                      {"ktp.pdf", []byte("<html><script>alert(1)</script>"), 422},
		"too large":                 {"big.pdf", append(bytes.Clone(pdfBytes), make([]byte, 1<<20)...), 413},
		"empty":                     {"empty.pdf", []byte{}, 422},
	} {
		if r := area.upload(up, tc.file, tc.data); r.Status != tc.want {
			t.Errorf("%s: status %d want %d: %s", name, r.Status, tc.want, r.Body)
		}
	}
	if r := area.upload(path("/api/v1/documents/subjects/PERSONNEL_ENTRY/%s/UNKNOWN", emp.ID), "a.pdf", pdfBytes); r.Status != 422 {
		t.Errorf("unknown document type: %d", r.Status)
	}
	if n := e.count(`SELECT count(*) FROM document_versions`); n != 0 {
		t.Fatalf("rejected uploads leave no rows, got %d", n)
	}
	if keys, _ := e.store.List(context.Background(), e.svc.Clock().AddDate(1, 0, 0)); len(keys) != 0 {
		t.Fatalf("rejected uploads leave no files, got %d", len(keys))
	}

	var v docVersion
	area.upload(up, "foto.png", pngBytes).json(t, &v)
	if v.ID == "" {
		t.Fatal("png upload")
	}
	// Another area cannot see, download, upload or review (existence is not disclosed).
	other.must("GET", path("/api/v1/employees/%s/documents", emp.ID), nil, 404)
	other.must("GET", path("/api/v1/documents/versions/%s/content", v.ID), nil, 404)
	if r := other.upload(up, "x.pdf", pdfBytes); r.Status != 404 {
		t.Fatalf("cross-area upload: %d", r.Status)
	}
	var q struct{ Items []struct{ SubjectID string } }
	other.must("GET", "/api/v1/documents/queue?status=ALL", nil, 200).json(t, &q)
	for _, it := range q.Items {
		if it.SubjectID == emp.ID {
			t.Fatal("queue leaks other area")
		}
	}

	// Orphan sweep removes only unreferenced files.
	orphanKey := strings.Repeat("ab", 32)
	_ = e.store.Put(context.Background(), orphanKey, bytes.NewReader(pdfBytes))
	n, err := e.svc.SweepOrphanDocuments(context.Background(), -1e18)
	if err != nil || n != 1 {
		t.Fatalf("sweep: %d %v", n, err)
	}
	area.must("GET", path("/api/v1/documents/versions/%s/content", v.ID), nil, 200)
}

func TestComplianceDashboardMatchesDetailLists(t *testing.T) {
	e := newEnv(t)
	admin, hr, area := e.login("superadmin@demo.test"), e.login("hr@demo.test"), e.login("bandung@demo.test")
	requireKTPForEntry(t, admin)
	var a, b struct{ ID string }
	area.must("POST", "/api/v1/employees", entryBody("CMP-1", true, map[string]any{"contractStartDate": "2026-01-01", "contractEndDate": "2026-11-13"}), 201).json(t, &a)
	area.must("POST", "/api/v1/employees", entryBody("CMP-2", true, nil), 201).json(t, &b)
	var v docVersion
	area.upload(path("/api/v1/documents/subjects/PERSONNEL_ENTRY/%s/KTP", a.ID), "k.pdf", pdfBytes).json(t, &v)
	hr.must("POST", path("/api/v1/documents/versions/%s/review", v.ID), map[string]any{"status": "ACCEPTED"}, 200)
	hr.must("POST", path("/api/v1/employees/%s/validation", a.ID), map[string]any{"status": "VALIDATED"}, 204)
	area.upload(path("/api/v1/documents/subjects/PERSONNEL_ENTRY/%s/KTP", b.ID), "k.pdf", pdfBytes)

	type summary struct {
		Contracts *struct {
			ReminderDays []int
			Summary      struct{ Monitored, Expiring, Expired, Incomplete int }
		}
		Documents *struct{ IncompleteSubmissions, PendingReviewDocuments, RejectedDocuments int }
	}
	check := func(c *client) summary {
		t.Helper()
		var s summary
		c.must("GET", "/api/v1/dashboard/compliance", nil, 200).json(t, &s)
		var list struct {
			Total int
			Items []struct {
				State struct{ Status string }
			}
		}
		c.must("GET", "/api/v1/contracts/monitoring?status=ALL&pageSize=200", nil, 200).json(t, &list)
		counts := map[string]int{}
		for _, it := range list.Items {
			counts[it.State.Status]++
		}
		cs := s.Contracts.Summary
		if list.Total != cs.Monitored || counts["EXPIRING"] != cs.Expiring || counts["EXPIRED"] != cs.Expired || counts["INCOMPLETE"] != cs.Incomplete {
			t.Fatalf("contract card %+v vs list %v (total %d)", cs, counts, list.Total)
		}
		var q struct {
			Items []struct{ PendingReview, Rejected int }
		}
		c.must("GET", "/api/v1/documents/queue?status=PENDING_REVIEW", nil, 200).json(t, &q)
		pending := 0
		for _, it := range q.Items {
			pending += it.PendingReview
		}
		var inc struct{ Items []any }
		c.must("GET", "/api/v1/documents/queue?status=INCOMPLETE", nil, 200).json(t, &inc)
		if pending != s.Documents.PendingReviewDocuments || len(inc.Items) != s.Documents.IncompleteSubmissions {
			t.Fatalf("document cards %+v vs pending %d incomplete %d", s.Documents, pending, len(inc.Items))
		}
		return s
	}
	s := check(area)
	if s.Documents.PendingReviewDocuments < 1 || s.Documents.IncompleteSubmissions < 1 {
		t.Fatalf("documents summary: %+v", s.Documents)
	}
	before := s.Contracts.Summary.Expiring
	// CMP-1 ends 60 days after the business date: outside 30/14/7, inside a 60-day threshold.
	area.must("PUT", "/api/v1/settings/contract-monitoring", map[string]any{"reminderDays": []int{60}}, 403)
	admin.must("PUT", "/api/v1/settings/contract-monitoring", map[string]any{"reminderDays": []int{0}}, 422)
	admin.must("PUT", "/api/v1/settings/contract-monitoring", map[string]any{"reminderDays": []int{60, 30}}, 200)
	s = check(area)
	if s.Contracts.Summary.Expiring != before+1 || s.Contracts.ReminderDays[0] != 60 {
		t.Fatalf("threshold change: before %d after %+v", before, s.Contracts)
	}
	check(hr)
	// A viewer without personnel access sees no compliance figures (not zeros).
	var mgmt summary
	admin.must("PUT", "/api/v1/settings/roles/MANAGEMENT", map[string]any{"scope": "ALL_AREAS", "selectedAreaIds": []string{}, "permissions": []string{"view_dashboard"}}, 200)
	e.login("management@demo.test").must("GET", "/api/v1/dashboard/compliance", nil, 200).json(t, &mgmt)
	if mgmt.Contracts != nil || mgmt.Documents != nil {
		t.Fatal("compliance figures are hidden without view_employee")
	}
}

func TestEntryMeasurementsAreValidatedOnServer(t *testing.T) {
	e := newEnv(t)
	area := e.login("bandung@demo.test")
	r := area.must("POST", "/api/v1/employees", entryBody("000123", false, map[string]any{"weight": "enam puluh", "height": "abc"}), 422)
	var errBody struct {
		Error struct{ Fields map[string]string }
	}
	r.json(t, &errBody)
	if !strings.Contains(errBody.Error.Fields["weight"], "contoh") || errBody.Error.Fields["height"] == "" {
		t.Fatalf("field errors: %v", errBody.Error.Fields)
	}
	var emp struct{ ID string }
	area.must("POST", "/api/v1/employees", entryBody("000123", false, map[string]any{"weight": "60,5", "height": ""}), 201).json(t, &emp)
	var detail struct {
		Employee struct {
			PersonnelID string
			Profile     map[string]any
		}
	}
	area.must("GET", path("/api/v1/employees/%s", emp.ID), nil, 200).json(t, &detail)
	if detail.Employee.PersonnelID != "000123" || detail.Employee.Profile["weight"] != "60.5 kg" {
		t.Fatalf("stored: %+v", detail.Employee)
	}
	if _, ok := detail.Employee.Profile["height"]; ok {
		t.Fatal("empty height must stay absent, not 0")
	}
	// A client that omits the field keeps the stored value; an explicit "" clears it.
	area.must("PUT", path("/api/v1/employees/%s", emp.ID), entryBody("000123", false, nil), 200)
	area.must("GET", path("/api/v1/employees/%s", emp.ID), nil, 200).json(t, &detail)
	if detail.Employee.Profile["weight"] != "60.5 kg" {
		t.Fatal("omitted field must not wipe the stored weight")
	}
	area.must("PUT", path("/api/v1/employees/%s", emp.ID), entryBody("000123", false, map[string]any{"weight": "0"}), 422)
	area.must("PUT", path("/api/v1/employees/%s", emp.ID), entryBody("000123", false, map[string]any{"weight": ""}), 200)
	detail.Employee.Profile = nil
	area.must("GET", path("/api/v1/employees/%s", emp.ID), nil, 200).json(t, &detail)
	if _, ok := detail.Employee.Profile["weight"]; ok {
		t.Fatal("explicit empty clears the weight")
	}
}

// TestMigration0002KeepsExistingData applies 0001 only, writes data, then upgrades.
func TestMigration0002KeepsExistingData(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	dbMu.Lock()
	defer dbMu.Unlock()
	ctx := context.Background()
	pool, err := db.Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	init, err := os.ReadFile("../db/migrations/0001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;
		CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(init)); err != nil {
		t.Fatal(err)
	}
	// Data written on the 0001 schema only (the current seed already needs 0002 tables).
	if _, err := pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ('0001_init');
		INSERT INTO role_configs (role, scope, permissions) VALUES ('SUPER_ADMIN','ALL_AREAS','{manage_roles}'), ('AREA_SUPPORT','OWN_AREA','{view_employee}'), ('HR_HO','ALL_AREAS','{view_employee,custom_kept}');
		INSERT INTO areas (id, name, name_key) VALUES ('area-x', 'Area X', 'area x');
		INSERT INTO users (id, name, email, email_key, password_hash, role) VALUES ('u1', 'Admin', 'a@demo.test', 'a@demo.test', 'x', 'SUPER_ADMIN');
		INSERT INTO personnel (id, personnel_id, business_key, name, profile, area_id, employment_status, record_status, source, created_by, contract_end_date)
		  VALUES ('p1', '000123', '000123', 'Lama', '{"weight":"abc"}', 'area-x', 'ACTIVE', 'VALIDATED', 'IMPORT', 'u1', NULL),
		         ('p2', 'EMP-002', 'emp-002', 'Lama 2', '{}', 'area-x', 'ACTIVE', 'SUBMITTED', 'MANUAL', 'u1', '2026-12-31');`); err != nil {
		t.Fatal(err)
	}
	var personnelBefore int
	var weightBefore *string
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM personnel`).Scan(&personnelBefore)
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var personnelAfter int
	var hr []string
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM personnel`).Scan(&personnelAfter)
	_ = pool.QueryRow(ctx, `SELECT profile->>'weight' FROM personnel WHERE personnel_id = '000123'`).Scan(&weightBefore)
	_ = pool.QueryRow(ctx, `SELECT permissions FROM role_configs WHERE role = 'HR_HO'`).Scan(&hr)
	if personnelAfter != personnelBefore || weightBefore == nil || *weightBefore != "abc" {
		t.Fatalf("personnel %d→%d, invalid legacy weight must be kept as-is: %v", personnelBefore, personnelAfter, weightBefore)
	}
	if strings.Join(hr, ",") != "view_employee,custom_kept,upload_documents,review_documents" {
		t.Fatalf("existing permissions kept, new ones appended: %v", hr)
	}
	var days []int32
	if err := pool.QueryRow(ctx, `SELECT reminder_days FROM contract_monitoring_settings`).Scan(&days); err != nil || len(days) != 3 {
		t.Fatalf("default thresholds: %v %v", days, err)
	}
}

func TestExitValidationRequiresDocumentsOnChangeRequest(t *testing.T) {
	e := newEnv(t)
	admin, hr, area := e.login("superadmin@demo.test"), e.login("hr@demo.test"), e.login("bandung@demo.test")
	admin.must("PUT", "/api/v1/settings/document-types/SURAT_EXIT", map[string]any{"name": "Surat exit (contoh sintetis)", "active": true}, 200)
	admin.must("PUT", "/api/v1/settings/document-requirements/EMPLOYEE_EXIT", map[string]any{"documentTypeCodes": []string{"SURAT_EXIT"}}, 200)
	var empID string
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM personnel WHERE personnel_id = 'EMP-002'`).Scan(&empID); err != nil {
		t.Fatal(err)
	}
	var exit struct{ ID string }
	area.must("POST", path("/api/v1/employees/%s/exit-request", empID), map[string]any{"exitDate": "2026-09-14", "exitReason": "Resign", "replacementRequired": false, "submit": true}, 200).json(t, &exit)
	if r := hr.must("POST", path("/api/v1/change-requests/%s/validation", exit.ID), map[string]any{"status": "VALIDATED"}, 409); r.code() != "DOCUMENTS_INCOMPLETE" {
		t.Fatalf("exit without required document: %s", r.Body)
	}
	var v docVersion
	area.upload(path("/api/v1/documents/subjects/CHANGE_REQUEST/%s/SURAT_EXIT", exit.ID), "surat.pdf", pdfBytes).json(t, &v)
	hr.must("POST", path("/api/v1/documents/versions/%s/review", v.ID), map[string]any{"status": "ACCEPTED"}, 200)
	hr.must("POST", path("/api/v1/change-requests/%s/validation", exit.ID), map[string]any{"status": "VALIDATED"}, 204)
}

// HR sees, before validating, why each submitted entry is or is not ready: blocking issues
// (document gate, import review, placement) and informational ones (import warnings with
// row + column, contract data). Only existing rules are reported.
func TestValidationReadinessExplainsEachEntry(t *testing.T) {
	e := newEnv(t)
	hr, admin, area := e.login("hr@demo.test"), e.login("superadmin@demo.test"), e.login("bandung@demo.test")
	var pv struct {
		PreviewID string `json:"previewId"`
	}
	hr.upload("/api/v1/imports/previews", "personil.xlsx", workbook(t, "Database",
		row("R-001", "Berat Salah", "Bandung", "Project Alpha Bandung", "Sales", "weight", "enam puluh", "contractEndDate", "2027-01-31"),
		row("R-002", "Bersih", "Bandung", "Project Alpha Bandung", "Sales", "contractEndDate", "2027-01-31"),
	)).json(t, &pv)
	hr.must("POST", "/api/v1/imports/commit", map[string]string{"previewId": pv.PreviewID}, 200)
	id := func(pid string) string {
		var v string
		if err := e.pool.QueryRow(context.Background(), `SELECT id FROM personnel WHERE personnel_id = $1`, pid).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	type issue struct {
		Code      string `json:"code"`
		Blocking  bool   `json:"blocking"`
		RowNumber *int   `json:"rowNumber"`
		Column    string `json:"column"`
		RawValue  string `json:"rawValue"`
	}
	var rd struct {
		Total, Ready, NeedsCheck, Blocked int
		Items                             []struct {
			EmployeeID string  `json:"employeeId"`
			Issues     []issue `json:"issues"`
		} `json:"items"`
		WarningColumns []struct {
			Column string `json:"column"`
			Count  int    `json:"count"`
		} `json:"warningColumns"`
	}
	load := func() map[string][]issue {
		hr.must("GET", "/api/v1/validation/readiness", nil, 200).json(t, &rd)
		m := map[string][]issue{}
		for _, it := range rd.Items {
			m[it.EmployeeID] = it.Issues
		}
		if rd.Ready+rd.NeedsCheck+rd.Blocked != rd.Total || len(rd.Items) != rd.NeedsCheck+rd.Blocked {
			t.Fatalf("counts do not add up: %+v", rd)
		}
		return m
	}
	m := load()
	w := m[id("R-001")]
	if len(w) != 1 || w[0].Code != "IMPORT_WARNING" || w[0].Blocking || w[0].Column != "Berat Badan" || w[0].RowNumber == nil || *w[0].RowNumber != 2 || w[0].RawValue != "enam puluh" {
		t.Fatalf("warning with row/column expected: %+v", w)
	}
	if _, listed := m[id("R-002")]; listed {
		t.Fatal("a clean entry must count as ready, not be listed")
	}
	if len(rd.WarningColumns) != 1 || rd.WarningColumns[0].Column != "Berat Badan" || rd.WarningColumns[0].Count != 1 {
		t.Fatalf("columns: %+v", rd.WarningColumns)
	}

	admin.must("PUT", "/api/v1/settings/document-requirements/EMPLOYEE_ENTRY", map[string]any{"documentTypeCodes": []string{"KTP"}}, 200)
	m = load()
	if is := m[id("R-002")]; len(is) != 1 || is[0].Code != "DOCUMENTS_INCOMPLETE" || !is[0].Blocking {
		t.Fatalf("document gate must be reported as blocking: %+v", is)
	}
	area.must("GET", "/api/v1/validation/readiness", nil, 403) // no validation permission
}

// More notifications than one page: the list pages on the server (total + offset) and
// "mark all read" covers every unread notification, not only the loaded page.
func TestNotificationsPageAndMarkAllRead(t *testing.T) {
	e := newEnv(t)
	hr, admin := e.login("hr@demo.test"), e.login("superadmin@demo.test")
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO notifications (id, dedupe_key, recipient_user_id, category, severity, title, message, entity_type, created_at)
		SELECT 'ntf-t-' || g, 'test:' || g, 'user-hr', CASE WHEN g % 2 = 0 THEN 'VALIDATION_RESULT' ELSE 'IMPORT' END, 'info', 'Uji ' || g, 'Pesan', 'personnel', now() - g * interval '1 minute'
		FROM generate_series(1, 250) g`); err != nil {
		t.Fatal(err)
	}
	type page struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		UnreadCount int `json:"unreadCount"`
		Total       int `json:"total"`
	}
	var pg page
	hr.must("GET", "/api/v1/notifications?limit=20&offset=240", nil, 200).json(t, &pg)
	if pg.Total < 250 || len(pg.Items) != pg.Total-240 || pg.UnreadCount < 250 {
		t.Fatalf("paging: total=%d items=%d unread=%d", pg.Total, len(pg.Items), pg.UnreadCount)
	}
	hr.must("GET", "/api/v1/notifications?limit=20&category=IMPORT", nil, 200).json(t, &pg)
	if pg.Total != 125 {
		t.Fatalf("category filter total=%d", pg.Total)
	}
	hr.must("POST", "/api/v1/notifications/mark", map[string]any{"action": "archive", "all": true}, 400)
	var upd struct {
		Updated int `json:"updated"`
	}
	hr.must("POST", "/api/v1/notifications/mark", map[string]any{"action": "read", "all": true}, 200).json(t, &upd)
	hr.must("GET", "/api/v1/notifications?unread=true", nil, 200).json(t, &pg)
	if upd.Updated < 250 || pg.UnreadCount != 0 || pg.Total != 0 {
		t.Fatalf("mark all: updated=%d unread=%d total=%d", upd.Updated, pg.UnreadCount, pg.Total)
	}
	admin.must("GET", "/api/v1/notifications", nil, 200)
	if e.count(`SELECT count(*) FROM notifications WHERE recipient_user_id <> 'user-hr' AND read_at IS NOT NULL`) != 0 {
		t.Fatal("mark all must only touch the caller's notifications")
	}
}

// The PKWT (fixed employee document) only warns: the entry can be validated without it,
// it can still be uploaded after validation, and the warning clears once accepted.
func TestEmployeeDocumentsWarnButDoNotBlock(t *testing.T) {
	e := newEnv(t)
	admin, hr, area := e.login("superadmin@demo.test"), e.login("hr@demo.test"), e.login("bandung@demo.test")
	type status struct {
		Required   []struct{ Code string } `json:"required"`
		Monitored  int                     `json:"monitored"`
		Incomplete int                     `json:"incomplete"`
		Items      []struct {
			EmployeeID string   `json:"employeeId"`
			Missing    []string `json:"missing"`
			Pending    []string `json:"pending"`
		} `json:"items"`
	}
	gap := func(c *client, id string) (status, []string, []string, bool) {
		var st status
		c.must("GET", "/api/v1/documents/employee-status", nil, 200).json(t, &st)
		for _, it := range st.Items {
			if it.EmployeeID == id {
				return st, it.Missing, it.Pending, true
			}
		}
		return st, nil, nil, false
	}
	var emp struct{ ID string }
	area.must("POST", "/api/v1/employees", entryBody("EDOC-001", true, nil), 201).json(t, &emp)
	admin.must("PUT", "/api/v1/settings/document-requirements/EMPLOYEE_FILE", map[string]any{"documentTypeCodes": []string{}}, 404) // fixed, not configurable
	st, missing, _, listed := gap(hr, emp.ID)
	if len(st.Required) != 1 || st.Required[0].Code != "PKWT" || !listed || len(missing) != 1 || missing[0] != "PKWT" || st.Incomplete == 0 || st.Incomplete > st.Monitored {
		t.Fatalf("missing PKWT must warn: %+v", st)
	}
	var comp struct {
		EmployeeDocuments struct{ Monitored, Incomplete, Missing int } `json:"employeeDocuments"`
	}
	hr.must("GET", "/api/v1/dashboard/compliance", nil, 200).json(t, &comp)
	if comp.EmployeeDocuments.Incomplete != st.Incomplete || comp.EmployeeDocuments.Missing != st.Incomplete {
		t.Fatalf("dashboard PKWT count must match the list: %+v vs %d", comp.EmployeeDocuments, st.Incomplete)
	}
	if _, _, _, inScope := gap(area, "employee-003"); inScope {
		t.Fatal("out-of-scope employees must not be listed")
	}

	hr.must("POST", path("/api/v1/employees/%s/validation", emp.ID), map[string]any{"status": "VALIDATED"}, 204) // warning only

	var v docVersion
	if r := area.upload(path("/api/v1/documents/subjects/PERSONNEL/%s/PKWT", emp.ID), "pkwt.pdf", pdfBytes); r.Status != 201 {
		t.Fatalf("employee documents stay uploadable after validation: %d %s", r.Status, r.Body)
	} else {
		r.json(t, &v)
	}
	if _, _, pending, _ := gap(hr, emp.ID); len(pending) != 1 {
		t.Fatalf("uploaded file is pending review, still warned: %v", pending)
	}
	hr.must("POST", path("/api/v1/documents/versions/%s/review", v.ID), map[string]any{"status": "ACCEPTED"}, 200)
	if _, _, _, listed := gap(hr, emp.ID); listed {
		t.Fatal("accepted employee document clears the warning")
	}
}
