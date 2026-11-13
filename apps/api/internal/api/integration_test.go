package api

import (
	"bytes"
	"context"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/xuri/excelize/v2"
)

type employee struct {
	ID               string  `json:"id"`
	PersonnelID      string  `json:"personnelId"`
	Name             string  `json:"name"`
	AreaID           *string `json:"areaId"`
	EmploymentStatus string  `json:"employmentStatus"`
	ValidationStatus string  `json:"validationStatus"`
	Version          int     `json:"version"`
	PendingChange    *struct {
		RequestID string `json:"requestId"`
		Status    string `json:"status"`
	} `json:"pendingChange"`
}

type page struct {
	Items []employee `json:"items"`
	Total int        `json:"total"`
}

type kpi struct {
	ActiveEmployees  int `json:"activeEmployees"`
	ReplacementNeeds int `json:"replacementNeeds"`
	Fulfilled        int `json:"fulfilled"`
	Open             int `json:"open"`
}

func TestAuthentication(t *testing.T) {
	e := newEnv(t)
	anon := &client{e: e}
	anon.must("GET", "/api/v1/employees", nil, 401)

	bad := anon.do("POST", "/api/v1/auth/login", map[string]string{"email": "hr@demo.test", "password": "wrong-password"})
	unknown := anon.do("POST", "/api/v1/auth/login", map[string]string{"email": "nobody@demo.test", "password": "wrong-password"})
	if bad.Status != 401 || unknown.Status != 401 || bad.code() != unknown.code() {
		t.Fatalf("login errors must not reveal account existence: %s / %s", bad.Body, unknown.Body)
	}

	hr := e.login("hr@demo.test")
	hr.must("GET", "/api/v1/auth/me", nil, 200)
	noCSRF := &client{e: e, cookie: hr.cookie}
	if r := noCSRF.do("POST", "/api/v1/employees/employee-002/notes", map[string]string{"notes": "x"}); r.Status != 403 || r.code() != "CSRF_FAILED" {
		t.Fatalf("mutation without CSRF must be rejected: %d %s", r.Status, r.Body)
	}
	wrong := &client{e: e, cookie: hr.cookie, csrf: "forged"}
	wrong.must("POST", "/api/v1/employees/employee-002/notes", map[string]string{"notes": "x"}, 403)

	// Cross-site origin is rejected even with a valid token.
	req := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	req.Header.Set("Cookie", "gelatik_session="+hr.cookie)
	req.Header.Set("X-CSRF-Token", hr.csrf)
	req.Header.Set("Origin", "https://evil.example")
	if r := e.raw(req); r.Status != 403 {
		t.Fatalf("foreign origin must be rejected: %d", r.Status)
	}

	hr.must("POST", "/api/v1/auth/logout", map[string]string{}, 204)
	hr.must("GET", "/api/v1/auth/me", nil, 401)

	// Expired sessions are refused.
	ops := e.login("operations@demo.test")
	if _, err := e.pool.Exec(context.Background(), `UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = 'user-operations'`); err != nil {
		t.Fatal(err)
	}
	ops.must("GET", "/api/v1/auth/me", nil, 401)

	// Throttling after repeated failures, even with the right password.
	for i := 0; i < 5; i++ {
		anon.do("POST", "/api/v1/auth/login", map[string]string{"email": "management@demo.test", "password": "nope-nope-nope"})
	}
	if r := anon.do("POST", "/api/v1/auth/login", map[string]string{"email": "management@demo.test", "password": demoPassword}); r.Status != 429 {
		t.Fatalf("expected throttling, got %d", r.Status)
	}
}

func TestAreaScopeAndReadOnly(t *testing.T) {
	e := newEnv(t)
	bandung := e.login("bandung@demo.test")
	var list page
	bandung.must("GET", "/api/v1/employees?pageSize=200", nil, 200).json(t, &list)
	for _, x := range list.Items {
		if x.AreaID == nil || *x.AreaID != "area-bandung" {
			t.Fatalf("Area Support saw out-of-scope employee %s", x.ID)
		}
	}
	if list.Total != 10 {
		t.Fatalf("expected 10 Bandung employees, got %d", list.Total)
	}
	// Jakarta employee detail, note, exit and dashboard filter are hidden/denied.
	bandung.must("GET", "/api/v1/employees/employee-008", nil, 404)
	bandung.must("POST", "/api/v1/employees/employee-008/notes", map[string]string{"notes": "x"}, 404)
	bandung.must("POST", "/api/v1/employees/employee-008/exit-request", map[string]any{"exitDate": "2026-09-10", "exitReason": "x", "submit": true}, 404)
	bandung.must("GET", "/api/v1/dashboard?areaId=area-jakarta", nil, 403)
	var snap struct {
		Employees []employee `json:"employees"`
	}
	bandung.must("GET", "/api/v1/snapshot", nil, 200).json(t, &snap)
	if len(snap.Employees) != 10 {
		t.Fatalf("snapshot leaked: %d", len(snap.Employees))
	}
	// Area Support has no export permission; HR export is scoped by the server.
	bandung.must("GET", "/api/v1/exports/employee", nil, 403)

	// Forged fields in the body never grant scope: creating in Jakarta is forbidden.
	bandung.must("POST", "/api/v1/employees", map[string]any{"personnelId": "X-1", "name": "Forged", "areaId": "area-jakarta", "projectId": "project-gamma-jakarta",
		"position": "Sales", "joinDate": "2026-09-01", "contractStatus": "SIGNED", "role": "SUPER_ADMIN", "createdBy": "user-superadmin"}, 403)

	ops := e.login("operations@demo.test")
	ops.must("GET", "/api/v1/employees/employee-008", nil, 200)
	ops.must("POST", "/api/v1/employees/employee-008/notes", map[string]string{"notes": "x"}, 403)
	ops.must("POST", "/api/v1/employees/employee-010/validation", map[string]string{"status": "VALIDATED"}, 403)
	ops.must("PUT", "/api/v1/settings/roles/OPERATIONS_MANAGER", map[string]any{"scope": "ALL_AREAS", "permissions": []string{"manage_roles"}}, 403)

	// Permission changes apply to active sessions immediately.
	admin := e.login("superadmin@demo.test")
	admin.must("PUT", "/api/v1/settings/roles/OPERATIONS_MANAGER", map[string]any{"scope": "SELECTED_AREAS", "selectedAreaIds": []string{"area-semarang"},
		"permissions": []string{"view_dashboard", "view_employee"}}, 200)
	ops.must("GET", "/api/v1/employees/employee-008", nil, 404)
	ops.must("GET", "/api/v1/employees/employee-003", nil, 200)

	// The last access administrator is protected.
	admin.must("PATCH", "/api/v1/users/user-superadmin", map[string]any{"active": false}, 409)
}

func TestEntryValidationExitReplacementFlow(t *testing.T) {
	e := newEnv(t)
	bandung, hr := e.login("bandung@demo.test"), e.login("hr@demo.test")
	var before kpi
	hr.must("GET", "/api/v1/dashboard", nil, 200).json(t, &before)

	entry := map[string]any{"personnelId": "EMP-100", "name": "Calon Pengganti", "areaId": "area-bandung", "projectId": "project-alpha-bandung",
		"position": "Sales", "joinDate": "2026-09-07", "contractStatus": "SIGNED", "submit": false}
	var created employee
	bandung.must("POST", "/api/v1/employees", entry, 201).json(t, &created)
	if created.ValidationStatus != "DRAFT" {
		t.Fatal("draft expected")
	}
	if r := bandung.do("POST", "/api/v1/employees", entry); r.Status != 409 || r.code() != "DUPLICATE_PERSONNEL_ID" {
		t.Fatalf("duplicate personnel id: %d %s", r.Status, r.Body)
	}
	entry["submit"] = true
	entry["expectedVersion"] = created.Version
	bandung.must("PUT", "/api/v1/employees/"+created.ID, entry, 200).json(t, &created)
	if e.count(`SELECT count(*) FROM notifications WHERE recipient_user_id = 'user-hr' AND category = 'VALIDATION_REQUEST'`) != 1 {
		t.Fatal("validator must be notified once")
	}
	bandung.must("POST", "/api/v1/employees/"+created.ID+"/validation", map[string]string{"status": "VALIDATED"}, 403) // not a validator
	hr.must("POST", "/api/v1/employees/"+created.ID+"/validation", map[string]any{"status": "REVISION_REQUIRED", "note": "Cek kontrak"}, 204)
	hr.must("POST", "/api/v1/employees/"+created.ID+"/validation", map[string]any{"status": "VALIDATED"}, 409) // must be SUBMITTED
	var mid kpi
	hr.must("GET", "/api/v1/dashboard", nil, 200).json(t, &mid)
	if mid.ActiveEmployees != before.ActiveEmployees {
		t.Fatal("pending entry must not count as active")
	}
	var detail struct {
		Employee employee `json:"employee"`
	}
	bandung.must("GET", "/api/v1/employees/"+created.ID, nil, 200).json(t, &detail)
	entry["expectedVersion"] = detail.Employee.Version
	bandung.must("PUT", "/api/v1/employees/"+created.ID, entry, 200)
	hr.must("POST", "/api/v1/employees/"+created.ID+"/validation", map[string]any{"status": "VALIDATED"}, 204)
	var after kpi
	hr.must("GET", "/api/v1/dashboard", nil, 200).json(t, &after)
	if after.ActiveEmployees != before.ActiveEmployees+1 {
		t.Fatalf("validated entry must count: %d -> %d", before.ActiveEmployees, after.ActiveEmployees)
	}

	// Basic edit on a validated record stays pending until validated.
	bandung.must("GET", "/api/v1/employees/employee-004", nil, 200).json(t, &detail)
	edit := map[string]any{"personnelId": "EMP-004", "name": "Nama Baru", "areaId": "area-bandung", "projectId": "project-alpha-bandung", "position": "Team Leader",
		"joinDate": "2025-04-05", "contractStatus": "SIGNED", "submit": true, "expectedVersion": detail.Employee.Version}
	bandung.must("PUT", "/api/v1/employees/employee-004", edit, 200)
	bandung.must("GET", "/api/v1/employees/employee-004", nil, 200).json(t, &detail)
	if detail.Employee.Name == "Nama Baru" || detail.Employee.PendingChange == nil || detail.Employee.PendingChange.Status != "SUBMITTED" {
		t.Fatalf("pending edit must not be effective: %+v", detail.Employee)
	}
	editReq := detail.Employee.PendingChange.RequestID
	// A stale request (record changed after submission) is rejected on validation.
	if _, err := e.pool.Exec(context.Background(), `UPDATE personnel SET version = version + 1 WHERE id = 'employee-004'`); err != nil {
		t.Fatal(err)
	}
	admin := e.login("superadmin@demo.test") // default policy: basic edit validated by AREA_ADMIN; Super Admin always may
	if r := admin.do("POST", "/api/v1/change-requests/"+editReq+"/validation", map[string]string{"status": "VALIDATED"}); r.Status != 409 || r.code() != "STALE_REQUEST" {
		t.Fatalf("stale edit must conflict: %d %s", r.Status, r.Body)
	}

	// Exit → validation → exactly one replacement need, even under concurrent validation.
	var exit struct{ ID string }
	bandung.must("POST", "/api/v1/employees/employee-002/exit-request", map[string]any{"exitDate": "2026-09-02", "exitReason": "Resign", "replacementRequired": true, "submit": true}, 200).json(t, &exit)
	bandung.must("POST", "/api/v1/employees/employee-002/exit-request", map[string]any{"exitDate": "2026-09-02", "exitReason": "Resign", "replacementRequired": true, "submit": true}, 200)
	if e.count(`SELECT count(*) FROM change_requests WHERE personnel_id = 'employee-002' AND transaction_type = 'EMPLOYEE_EXIT'`) != 1 {
		t.Fatal("double submit must not duplicate the exit request")
	}
	if e.count(`SELECT count(*) FROM personnel WHERE id = 'employee-002' AND employment_status = 'ACTIVE'`) != 1 {
		t.Fatal("pending exit must not be effective")
	}
	var wg sync.WaitGroup
	statuses := make([]int, 4)
	for i := range statuses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			statuses[i] = hr.do("POST", "/api/v1/change-requests/"+exit.ID+"/validation", map[string]string{"status": "VALIDATED"}).Status
		}(i)
	}
	wg.Wait()
	ok := 0
	for _, s := range statuses {
		if s == 204 {
			ok++
		} else if s != 409 {
			t.Fatalf("unexpected status %d", s)
		}
	}
	if ok != 1 || e.count(`SELECT count(*) FROM replacement_needs WHERE exit_request_id = $1`, exit.ID) != 1 {
		t.Fatalf("exactly one validation and one need expected: ok=%d", ok)
	}
	var needID string
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM replacement_needs WHERE exit_request_id = $1`, exit.ID).Scan(&needID); err != nil {
		t.Fatal(err)
	}

	// Matching re-checks eligibility on the server.
	if r := hr.do("POST", "/api/v1/replacements/"+needID+"/match", map[string]string{"employeeId": "employee-004"}); r.Status != 422 || !contains(r.Body, "Posisi tidak sesuai") {
		t.Fatalf("wrong position must be rejected: %d %s", r.Status, r.Body)
	}
	if r := hr.do("POST", "/api/v1/replacements/"+needID+"/match", map[string]string{"employeeId": "employee-009"}); r.Status != 422 || !contains(r.Body, "Area tidak sesuai") {
		t.Fatalf("wrong area must be rejected: %d %s", r.Status, r.Body)
	}
	bandung.must("POST", "/api/v1/replacements/"+needID+"/match", map[string]string{"employeeId": created.ID}, 403)
	hr.must("POST", "/api/v1/replacements/"+needID+"/fulfill", map[string]any{}, 409) // not matched yet
	hr.must("POST", "/api/v1/replacements/"+needID+"/match", map[string]string{"employeeId": created.ID}, 200)
	var need struct {
		Status         string `json:"status"`
		GapWorkingDays *int   `json:"gapWorkingDays"`
	}
	hr.must("POST", "/api/v1/replacements/"+needID+"/fulfill", map[string]any{}, 200).json(t, &need)
	if need.Status != "FULFILLED" || need.GapWorkingDays == nil || *need.GapWorkingDays != 3 {
		t.Fatalf("Wed exit → Mon join is 3 working days: %+v", need)
	}
	hr.must("POST", "/api/v1/replacements/"+needID+"/fulfill", map[string]any{}, 409)
	hr.must("POST", "/api/v1/replacements/"+needID+"/match", map[string]string{"employeeId": created.ID}, 409)
	if e.count(`SELECT count(*) FROM career_events WHERE source_ref = $1`, "replacement:"+needID) != 1 {
		t.Fatal("one replacement timeline event")
	}

	// Replacement chain + re-entry keep the same identity and history.
	var exit2 struct{ ID string }
	bandung.must("POST", "/api/v1/employees/"+created.ID+"/exit-request", map[string]any{"exitDate": "2026-09-10", "exitReason": "Kontrak selesai", "replacementRequired": true, "submit": true}, 200).json(t, &exit2)
	hr.must("POST", "/api/v1/change-requests/"+exit2.ID+"/validation", map[string]string{"status": "VALIDATED"}, 204)
	if e.count(`SELECT count(*) FROM replacement_needs WHERE exit_request_id = $1 AND previous_need_id = $2`, exit2.ID, needID) != 1 {
		t.Fatal("replacement chain must link to the previous need")
	}
	bandung.must("POST", "/api/v1/employees/"+created.ID+"/reentry", map[string]any{"areaId": "area-bandung", "projectId": "project-alpha-bandung", "position": "Sales", "joinDate": "2026-09-05"}, 422)
	bandung.must("POST", "/api/v1/employees/"+created.ID+"/reentry", map[string]any{"areaId": "area-bandung", "projectId": "project-alpha-bandung", "position": "Sales", "joinDate": "2026-09-14"}, 200)
	bandung.must("POST", "/api/v1/employees/"+created.ID+"/reentry", map[string]any{"areaId": "area-bandung", "projectId": "project-alpha-bandung", "position": "Sales", "joinDate": "2026-09-15"}, 409)
	if e.count(`SELECT count(*) FROM personnel WHERE business_key = 'EMP-100'`) != 1 || e.count(`SELECT count(*) FROM employment_periods WHERE personnel_id = $1`, created.ID) != 2 {
		t.Fatal("re-entry must reuse the identity and add a period")
	}
	if e.count(`SELECT count(*) FROM career_events WHERE personnel_id = $1`, created.ID) < 4 {
		t.Fatal("history (join, replacement, exit, re-entry) must be preserved")
	}

	// Data survives a backend restart; a different session sees it.
	e.restart()
	ops := e.login("operations@demo.test")
	var k kpi
	ops.must("GET", "/api/v1/dashboard", nil, 200).json(t, &k)
	if k.Fulfilled != 1 || k.ReplacementNeeds != 2 {
		t.Fatalf("dashboard after restart: %+v", k)
	}
	r := ops.must("GET", "/api/v1/exports/replacement", nil, 200)
	f, err := excelize.OpenReader(bytes.NewReader(r.Body))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := f.GetRows("Data")
	if len(rows) != 3 {
		t.Fatalf("export must match dashboard (header + 2 needs), got %d rows", len(rows))
	}

	// Notifications: not duplicated, read state per recipient.
	var notes struct {
		Items []struct {
			ID       string `json:"id"`
			Category string `json:"category"`
		} `json:"items"`
		Unread int `json:"unreadCount"`
	}
	hr.must("GET", "/api/v1/notifications", nil, 200).json(t, &notes)
	if e.count(`SELECT count(*) FROM notifications WHERE starts_with(dedupe_key, 'exit-submit:'||$1)`, exit.ID) != 2 {
		t.Fatal("exit submission must notify each validator (HR, Super Admin) exactly once despite re-submit")
	}
	first := notes.Items[0].ID
	hr.must("POST", "/api/v1/notifications/mark", map[string]any{"ids": []string{first}, "action": "read"}, 200)
	bandung.must("POST", "/api/v1/notifications/mark", map[string]any{"ids": []string{first}, "action": "archive"}, 200)
	if e.count(`SELECT count(*) FROM notifications WHERE id = $1 AND read_at IS NOT NULL AND archived_at IS NULL`, first) != 1 {
		t.Fatal("another user cannot change my notification state")
	}
}

func TestConcurrentMatchAllocatesCandidateOnce(t *testing.T) {
	e := newEnv(t)
	bandung, hr := e.login("bandung@demo.test"), e.login("hr@demo.test")
	// Two exits on the same placement (Bandung / Alpha / Promotor) → two needs.
	var needs []string
	for _, id := range []string{"employee-013", "employee-019"} {
		var x struct{ ID string }
		bandung.must("POST", "/api/v1/employees/"+id+"/exit-request", map[string]any{"exitDate": "2026-09-01", "exitReason": "Resign", "replacementRequired": true, "submit": true}, 200).json(t, &x)
		hr.must("POST", "/api/v1/change-requests/"+x.ID+"/validation", map[string]string{"status": "VALIDATED"}, 204)
		var n string
		_ = e.pool.QueryRow(context.Background(), `SELECT id FROM replacement_needs WHERE exit_request_id = $1`, x.ID).Scan(&n)
		needs = append(needs, n)
	}
	var cand employee
	bandung.must("POST", "/api/v1/employees", map[string]any{"personnelId": "EMP-200", "name": "Kandidat", "areaId": "area-bandung", "projectId": "project-alpha-bandung",
		"position": "Promotor", "joinDate": "2026-09-03", "contractStatus": "DRAFT", "submit": true}, 201).json(t, &cand)
	hr.must("POST", "/api/v1/employees/"+cand.ID+"/validation", map[string]string{"status": "VALIDATED"}, 204)
	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := range needs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = hr.do("POST", "/api/v1/replacements/"+needs[i]+"/match", map[string]string{"employeeId": cand.ID}).Status
		}(i)
	}
	wg.Wait()
	if !((codes[0] == 200) != (codes[1] == 200)) {
		t.Fatalf("exactly one match may succeed: %v", codes)
	}
	matched := needs[0]
	if codes[1] == 200 {
		matched = needs[1]
	}
	// Contract gate: DRAFT contract blocks fulfillment.
	if r := hr.do("POST", "/api/v1/replacements/"+matched+"/fulfill", map[string]any{}); r.Status != 422 || !contains(r.Body, "Kontrak belum ditandatangani") {
		t.Fatalf("contract gate: %d %s", r.Status, r.Body)
	}
}
