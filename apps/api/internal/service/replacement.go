package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

const needSelect = `SELECT rn.id, rn.exit_request_id, rn.original_personnel_id, rn.area_id, rn.project_id, rn.position, rn.exit_date::text,
	rn.replacement_personnel_id, rn.replacement_join_date::text, rn.previous_need_id, rn.lifecycle_status, rn.sla_status, rn.fulfilled_at,
	rn.gap_working_days, rn.version, rn.created_at, rn.updated_at FROM replacement_needs rn WHERE `

func (s *Service) needs(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.ReplacementNeed, error) {
	rows, err := q.Query(ctx, needSelect+where+` ORDER BY rn.exit_date DESC, rn.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ReplacementNeed{}
	for rows.Next() {
		var n domain.ReplacementNeed
		if err := rows.Scan(&n.ID, &n.EmployeeExitID, &n.OriginalEmployeeID, &n.AreaID, &n.ProjectID, &n.Position, &n.ExitDate, &n.ReplacementEmployeeID,
			&n.ReplacementJoinDate, &n.PreviousReplacementNeedID, &n.LifecycleStatus, &n.SLAStatus, &n.FulfilledAt, &n.GapWorkingDays, &n.Version, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		n.Status = domain.CombinedStatus(n.LifecycleStatus, n.SLAStatus)
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Service) visibleNeed(ctx context.Context, q db.Querier, p *access.Principal, id string, forUpdate bool) (domain.ReplacementNeed, error) {
	where := "rn.id = $1"
	if forUpdate {
		// FOR UPDATE must follow ORDER BY in needs(); lock explicitly first.
		if _, err := q.Exec(ctx, `SELECT 1 FROM replacement_needs WHERE id = $1 FOR UPDATE`, id); err != nil {
			return domain.ReplacementNeed{}, err
		}
	}
	list, err := s.needs(ctx, q, where, id)
	if err != nil {
		return domain.ReplacementNeed{}, err
	}
	if len(list) == 0 || !p.CoversArea(list[0].AreaID) {
		return domain.ReplacementNeed{}, httpx.NotFound("Replacement need")
	}
	return list[0], nil
}

type Candidate struct {
	Employee domain.Employee `json:"employee"`
	Eligible bool            `json:"eligible"`
	Reasons  []string        `json:"reasons"`
	Blockers []string        `json:"fulfillmentBlockers"`
}

type NeedDetail struct {
	Need       domain.ReplacementNeed   `json:"need"`
	Chain      []domain.ReplacementNeed `json:"chain"`
	Candidates []Candidate              `json:"candidates"`
}

func allocatedElsewhere(ctx context.Context, q db.Querier, needID, candidateID string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM replacement_needs WHERE replacement_personnel_id = $1 AND lifecycle_status IN ('OPEN','MATCHED') AND id <> $2)`, candidateID, needID).Scan(&taken)
	return taken, err
}

// GetNeed returns a need, its replacement chain and in-scope candidates evaluated on the server.
func (s *Service) GetNeed(ctx context.Context, p *access.Principal, id string) (*NeedDetail, error) {
	if err := require(p, access.ViewReplacement); err != nil {
		return nil, err
	}
	n, err := s.visibleNeed(ctx, s.Pool, p, id, false)
	if err != nil {
		return nil, err
	}
	d := &NeedDetail{Need: n, Chain: []domain.ReplacementNeed{}, Candidates: []Candidate{}}
	for prev, guard := n.PreviousReplacementNeedID, 0; prev != nil && guard < 50; guard++ {
		list, err := s.needs(ctx, s.Pool, "rn.id = $1", *prev)
		if err != nil || len(list) == 0 || !p.CoversArea(list[0].AreaID) {
			break
		}
		d.Chain = append(d.Chain, list[0])
		prev = list[0].PreviousReplacementNeedID
	}
	if n.AreaID == nil {
		return d, nil
	}
	// Only same-area active candidates within the caller's scope are listed; nothing outside scope leaks.
	rows, err := s.Pool.Query(ctx, employeeSelect+` WHERE p.area_id = $1 AND p.employment_status = 'ACTIVE' AND p.id <> $2 AND ($3::text[] IS NULL OR p.area_id = ANY($3)) ORDER BY p.name LIMIT 200`,
		*n.AreaID, n.OriginalEmployeeID, scopeArgs(p))
	if err != nil {
		return nil, err
	}
	emps, err := collectEmployees(rows, false)
	if err != nil {
		return nil, err
	}
	for _, e := range emps {
		taken, err := allocatedElsewhere(ctx, s.Pool, n.ID, e.ID)
		if err != nil {
			return nil, err
		}
		reasons := domain.CandidateEligibility(n, e, taken)
		d.Candidates = append(d.Candidates, Candidate{Employee: e, Eligible: len(reasons) == 0, Reasons: nonNil(reasons), Blockers: nonNil(domain.FulfillmentBlockers(n, e, taken))})
	}
	return d, nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// Match allocates a candidate. Eligibility is re-checked under row locks; the
// partial unique index guarantees one active allocation per candidate.
func (s *Service) Match(ctx context.Context, a Actor, needID, candidateID string, expectedVersion *int) (*domain.ReplacementNeed, error) {
	p := a.P
	if err := require(p, access.MatchReplacement); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		n, err := s.visibleNeed(ctx, tx, p, needID, true)
		if err != nil {
			return err
		}
		if expectedVersion != nil && *expectedVersion != n.Version {
			return errStale
		}
		if n.LifecycleStatus == "FULFILLED" {
			return httpx.Conflict("INVALID_STATE", "Kebutuhan sudah terpenuhi.")
		}
		c, err := s.visibleEmployee(ctx, tx, p, candidateID, true)
		if err != nil {
			return err
		}
		taken, err := allocatedElsewhere(ctx, tx, n.ID, c.ID)
		if err != nil {
			return err
		}
		if reasons := domain.CandidateEligibility(n, c, taken); len(reasons) > 0 {
			return &httpx.Error{Status: 422, Code: "CANDIDATE_NOT_ELIGIBLE", Message: "Kandidat tidak memenuhi syarat: " + joinReasons(reasons)}
		}
		now := s.now()
		_, err = tx.Exec(ctx, `UPDATE replacement_needs SET replacement_personnel_id = $2, lifecycle_status = 'MATCHED', matched_by = $3, matched_at = $4, updated_at = $4, version = version + 1 WHERE id = $1`,
			n.ID, c.ID, p.UserID, now)
		if db.IsUniqueViolation(err, "replacement_needs_one_allocation") {
			return httpx.Conflict("CANDIDATE_ALLOCATED", "Kandidat sudah dialokasikan pada kebutuhan aktif lain.")
		}
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "replacement.match", EntityType: "replacement_need", EntityID: n.ID, PersonnelID: &c.ID, AreaID: n.AreaID,
			ActivityType: "MATCHING", Title: "Kandidat dipasangkan", Description: "Dipasangkan ke kebutuhan " + shortID(n.ID)}); err != nil {
			return err
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		return emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("match:%s:%s", n.ID, c.ID), Recipients: dir.hrHO(p.UserID), Category: "REPLACEMENT", Severity: "info",
			Title: "Kandidat replacement dipasangkan", Message: fmt.Sprintf("%s (%s) dipasangkan untuk kebutuhan %s.", c.Name, c.PersonnelID, shortID(n.ID)),
			Actor: p.UserID, EntityType: "replacement", EntityID: n.ID, AreaID: n.AreaID, Target: &NotificationTarget{Kind: "replacement", ID: n.ID}})
	})
	if err != nil {
		return nil, err
	}
	n, err := s.visibleNeed(ctx, s.Pool, p, needID, false)
	return &n, err
}

func joinReasons(r []string) string {
	out := ""
	for i, x := range r {
		if i > 0 {
			out += "; "
		}
		out += x
	}
	return out
}

// Fulfill completes a matched need after re-checking every blocker on the server.
func (s *Service) Fulfill(ctx context.Context, a Actor, needID string, expectedVersion *int) (*domain.ReplacementNeed, error) {
	p := a.P
	if err := require(p, access.FulfillReplacement); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		n, err := s.visibleNeed(ctx, tx, p, needID, true)
		if err != nil {
			return err
		}
		if expectedVersion != nil && *expectedVersion != n.Version {
			return errStale
		}
		if n.LifecycleStatus != "MATCHED" || n.ReplacementEmployeeID == nil {
			return httpx.Conflict("INVALID_STATE", "Kebutuhan harus memiliki kandidat terpasang dan belum terpenuhi.")
		}
		c, err := s.visibleEmployee(ctx, tx, p, *n.ReplacementEmployeeID, true)
		if err != nil {
			return err
		}
		taken, err := allocatedElsewhere(ctx, tx, n.ID, c.ID)
		if err != nil {
			return err
		}
		if blockers := domain.FulfillmentBlockers(n, c, taken); len(blockers) > 0 {
			return &httpx.Error{Status: 422, Code: "FULFILLMENT_BLOCKED", Message: "Fulfillment belum dapat dilakukan: " + joinReasons(blockers)}
		}
		gap, err := domain.WorkingDayGap(n.ExitDate, *c.JoinDate)
		if err != nil {
			return err
		}
		sla := domain.SLAStatusFor(gap)
		now := s.now()
		if _, err := tx.Exec(ctx, `UPDATE replacement_needs SET lifecycle_status = 'FULFILLED', sla_status = $2, gap_working_days = $3, replacement_join_date = $4, fulfilled_by = $5, fulfilled_at = $6, updated_at = $6, version = version + 1 WHERE id = $1`,
			n.ID, sla, gap, *c.JoinDate, p.UserID, now); err != nil {
			return err
		}
		var originalName string
		_ = tx.QueryRow(ctx, `SELECT name FROM personnel WHERE id = $1`, n.OriginalEmployeeID).Scan(&originalName)
		if _, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, new_area_id, new_project_id, new_position, notes, source, source_ref, created_by, created_at)
			VALUES ($1,$2,'REPLACEMENT',$3,$4,$5,$6,$7,'REPLACEMENT',$8,$9,$10) ON CONFLICT (source_ref) DO NOTHING`,
			newID("ce"), c.ID, *c.JoinDate, c.AreaID, c.ProjectID, c.Position, "Replacement untuk "+originalName, "replacement:"+n.ID, p.UserID, now); err != nil {
			return err
		}
		title := map[bool]string{true: "Replacement terpenuhi", false: "Replacement melewati SLA"}[sla == "WITHIN_TARGET"]
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "replacement.fulfill", EntityType: "replacement_need", EntityID: n.ID, PersonnelID: &c.ID, AreaID: n.AreaID,
			ActivityType: "FULFILLMENT", Title: title, Description: fmt.Sprintf("Gap fulfillment %d hari kerja", gap), Details: map[string]any{"gap": gap, "sla": sla}}); err != nil {
			return err
		}
		if err := resolvePrefix(ctx, tx, now, "sla:"+n.ID); err != nil {
			return err
		}
		if err := resolvePrefix(ctx, tx, now, "need-created:"+n.ID); err != nil {
			return err
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		sev, ttl := "success", "Replacement terpenuhi"
		if sla == "OVER_TARGET" {
			sev, ttl = "warning", "Replacement terpenuhi (melewati SLA)"
		}
		return emit(ctx, tx, now, spec{DedupeBase: "fulfill:" + n.ID, Recipients: append(dir.hrHO(p.UserID), dir.monitoring(n.AreaID, p.UserID)...), Category: "REPLACEMENT",
			Severity: sev, Title: ttl, Message: fmt.Sprintf("%s (%s) mengisi kebutuhan %s dalam %d hari kerja.", c.Name, c.PersonnelID, shortID(n.ID), gap),
			Actor: p.UserID, EntityType: "replacement", EntityID: n.ID, AreaID: n.AreaID, Target: &NotificationTarget{Kind: "replacement", ID: n.ID}})
	})
	if err != nil {
		return nil, err
	}
	n, err := s.visibleNeed(ctx, s.Pool, p, needID, false)
	return &n, err
}
