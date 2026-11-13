package testfixture

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

// Synthetic sample workforce for automated tests only. It is not part of `api seed`:
// development and production databases start without personnel, areas, or projects
// (they come from Excel import or manual entry). Requires service.Seed first (users).

var sampleAreas = [][2]string{{"area-bandung", "Bandung"}, {"area-semarang", "Semarang"}, {"area-jakarta", "Jakarta"}}

var sampleProjects = []struct{ ID, Name, Client, Area, Sub, Start string }{
	{"project-alpha-bandung", "Project Alpha Bandung", "PT Arunika Niaga", "area-bandung", "Bandung Raya", "2024-01-01"},
	{"project-beta-bandung", "Project Beta Bandung", "PT Bintang Retail", "area-bandung", "Bandung Timur", "2024-06-01"},
	{"project-alpha-semarang", "Project Alpha Semarang", "PT Arunika Niaga", "area-semarang", "Semarang Kota", "2024-01-01"},
	{"project-gamma-jakarta", "Project Gamma Jakarta", "PT Cakrawala Distribusi", "area-jakarta", "Jakarta Pusat", "2025-01-01"},
}

var sampleEmployees = [][8]string{
	{"EMP-001", "Raka Adiputra", "area-bandung", "project-alpha-bandung", "Sales", "INACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-002", "Fikri Mahardika", "area-bandung", "project-alpha-bandung", "Sales", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-003", "Andi Kurniawan", "area-semarang", "project-alpha-semarang", "Sales", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-004", "Sari Wulandari", "area-bandung", "project-alpha-bandung", "Team Leader", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-005", "Fajar Ramadhan", "area-bandung", "project-beta-bandung", "Promotor", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-008", "Putri Anggraini", "area-semarang", "project-alpha-semarang", "Promotor", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-009", "Agus Setiawan", "area-semarang", "project-alpha-semarang", "Team Leader", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-010", "Indah Permata", "area-jakarta", "project-gamma-jakarta", "Admin", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-011", "Yoga Prakoso", "area-jakarta", "project-gamma-jakarta", "Sales", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-012", "Citra Maharani", "area-jakarta", "project-gamma-jakarta", "Promotor", "ACTIVE", "DRAFT", "SUBMITTED"},
	{"EMP-013", "Bagas Nugraha", "area-bandung", "project-alpha-bandung", "Sales", "ACTIVE", "DRAFT", "SUBMITTED"},
	{"EMP-014", "Lina Marlina", "area-bandung", "project-beta-bandung", "Sales", "ACTIVE", "NOT_AVAILABLE", "DRAFT"},
	{"EMP-017", "Reza Pahlevi", "area-bandung", "project-alpha-bandung", "Promotor", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-018", "Aulia Putri", "area-bandung", "project-beta-bandung", "Promotor", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-019", "Hendra Gunawan", "area-semarang", "project-alpha-semarang", "Sales", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-022", "Melati Kusuma", "area-jakarta", "project-gamma-jakarta", "Sales", "ACTIVE", "DRAFT", "REVISION_REQUIRED"},
	{"EMP-025", "Keisha Anindita", "area-bandung", "project-beta-bandung", "Admin", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-029", "Dimas Santoso", "area-jakarta", "project-gamma-jakarta", "Sales", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-031", "Gilang Putra", "area-bandung", "project-alpha-bandung", "Promotor", "ACTIVE", "SIGNED", "VALIDATED"},
	{"EMP-033", "Tia Larasati", "area-jakarta", "project-gamma-jakarta", "Admin", "ACTIVE", "SIGNED", "VALIDATED"},
}

func Sample(ctx context.Context, tx pgx.Tx) error {
	for _, a := range sampleAreas {
		if _, err := tx.Exec(ctx, `INSERT INTO areas (id, name, name_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, a[0], a[1], imports.NameKey(a[1])); err != nil {
			return err
		}
	}
	for i, p := range sampleProjects {
		if _, err := tx.Exec(ctx, `INSERT INTO projects (id, name, name_key, client_name, area_id, sub_area, status, start_date) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7) ON CONFLICT DO NOTHING`,
			p.ID, p.Name, imports.NameKey(p.Name), p.Client, p.Area, p.Sub, p.Start); err != nil {
			return err
		}
		for j, period := range []string{"2026-07", "2026-08", "2026-09"} {
			if _, err := tx.Exec(ctx, `INSERT INTO project_quotas (project_id, period, quota) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, p.ID, period, []int{12, 9, 10, 13}[i]+j); err != nil {
				return err
			}
		}
	}
	// Example document types for tests only. No requirement is seeded: which
	// documents are mandatory per transaction is a business decision (TBC).
	for _, t := range [][2]string{{"KTP", "KTP (contoh)"}, {"KONTRAK_KERJA", "Kontrak kerja (contoh)"}, {"SURAT_RESIGN", "Surat pengunduran diri (contoh)"}} {
		if _, err := tx.Exec(ctx, `INSERT INTO document_types (code, name, description) VALUES ($1,$2,'Contoh untuk demo; bukan daftar kebijakan.') ON CONFLICT DO NOTHING`, t[0], t[1]); err != nil {
			return err
		}
	}
	areaNames := map[string]string{"area-bandung": "Bandung", "area-semarang": "Semarang", "area-jakarta": "Jakarta"}
	for i, e := range sampleEmployees {
		id := fmt.Sprintf("employee-%03d", i+1)
		join := fmt.Sprintf("2025-%02d-%02d", i%11+1, i%19+2)
		end := "2026-12-31"
		if i == 3 {
			end = "2026-09-28"
		}
		profile, _ := json.Marshal(map[string]any{"areaCbs": areaNames[e[2]], "agreementTermination": []any{"YA", "TIDAK", nil}[i%3],
			"companyName": "PT Contoh Karya Nusantara (Dummy)", "email": "dummy." + e[0] + "@example.test"})
		var validatedBy, validatedAt, submittedAt, note any
		switch e[7] {
		case "VALIDATED":
			validatedBy, validatedAt = "user-hr", "2026-08-01T09:00:00Z"
		case "SUBMITTED":
			submittedAt = "2026-09-03T03:15:00Z"
		case "REVISION_REQUIRED":
			note = "Mohon konfirmasi kembali data kontrak sebelum divalidasi."
		}
		createdBy := "user-hr"
		if e[2] == "area-bandung" && e[7] != "VALIDATED" {
			createdBy = "user-bandung"
		}
		tag, err := tx.Exec(ctx, `INSERT INTO personnel (id, personnel_id, business_key, name, profile, area_id, project_id, position, employment_status, join_date, contract_start_date,
			contract_end_date, contract_status, bpjs_status, record_status, validated_by, validated_at, submitted_at, revision_note, source, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,'ACTIVE',$13,$14,$15,$16,$17,'MANUAL',$18) ON CONFLICT DO NOTHING`,
			id, e[0], imports.BusinessKey(e[0]), e[1], profile, e[2], e[3], e[4], e[5], join, end, e[6], e[7], validatedBy, validatedAt, submittedAt, note, createdBy)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		closed := e[5] == "INACTIVE"
		var endDate any
		if closed {
			endDate = "2026-08-31"
		}
		periodID := "period-" + id
		if _, err := tx.Exec(ctx, `INSERT INTO employment_periods (id, personnel_id, start_date, end_date, start_kind, closed, created_by) VALUES ($1,$2,$3,$4,'ENTRY',$5,$6)`, periodID, id, join, endDate, closed, createdBy); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO placements (id, personnel_id, period_id, area_id, project_id, position, effective_from, effective_to, closed, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ENTRY')`,
			"plc-"+id, id, periodID, e[2], e[3], e[4], join, endDate, closed); err != nil {
			return err
		}
		if e[7] == "VALIDATED" {
			if _, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, new_area_id, new_project_id, new_position, notes, source, source_ref, created_by) VALUES ($1,$2,'JOIN',$3,$4,$5,$6,'Seed data (sintetis).','SEED',$7,'user-hr') ON CONFLICT DO NOTHING`,
				"ce-"+id, id, join, e[2], e[3], e[4], "seed:"+id); err != nil {
				return err
			}
		}
	}
	return nil
}
