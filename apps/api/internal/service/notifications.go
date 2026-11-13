package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

type NotificationTarget struct {
	Kind  string `json:"kind"`
	ID    string `json:"id,omitempty"`
	Route string `json:"route,omitempty"`
}

type Notification struct {
	ID              string              `json:"id"`
	DedupeKey       string              `json:"dedupeKey"`
	RecipientUserID string              `json:"recipientUserId"`
	Category        string              `json:"category"`
	Severity        string              `json:"severity"`
	Title           string              `json:"title"`
	Message         string              `json:"message"`
	ActorUserID     *string             `json:"actorUserId"`
	EntityType      string              `json:"entityType"`
	EntityID        *string             `json:"entityId"`
	AreaID          *string             `json:"areaId"`
	Target          *NotificationTarget `json:"target"`
	RequiresAction  bool                `json:"requiresAction"`
	CreatedAt       time.Time           `json:"createdAt"`
	ReadAt          *time.Time          `json:"readAt"`
	ArchivedAt      *time.Time          `json:"archivedAt"`
	ResolvedAt      *time.Time          `json:"resolvedAt"`
}

// spec is one business event before fan-out; dedupeBase + recipient forms the idempotency key.
type spec struct {
	DedupeBase     string
	Recipients     []string
	Category       string
	Severity       string
	Title          string
	Message        string
	Actor          string
	EntityType     string
	EntityID       string
	AreaID         *string
	Target         *NotificationTarget
	RequiresAction bool
}

// directory resolves recipients from current user/role configuration.
type directory struct {
	users []access.Principal
	names map[string]string
}

func loadDirectory(ctx context.Context, q db.Querier) (*directory, error) {
	policy, err := auth.LoadPolicy(ctx, q)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT u.id, u.name, u.role, u.area_id, rc.scope, rc.selected_area_ids, rc.permissions
		FROM users u JOIN role_configs rc ON rc.role = u.role WHERE u.active ORDER BY u.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	d := &directory{names: map[string]string{}}
	for rows.Next() {
		var p access.Principal
		var role, scope string
		var selected, perms []string
		if err := rows.Scan(&p.UserID, &p.Name, &role, &p.AreaID, &scope, &selected, &perms); err != nil {
			return nil, err
		}
		p.Role = access.Role(role)
		p.Config = access.RoleConfig{Role: p.Role, Scope: access.Scope(scope), SelectedAreaIDs: selected}
		for _, x := range perms {
			p.Config.Permissions = append(p.Config.Permissions, access.Permission(x))
		}
		p.Policy = policy
		d.users = append(d.users, p)
		d.names[p.UserID] = p.Name
	}
	return d, rows.Err()
}

func (d *directory) filter(fn func(access.Principal) bool) []string {
	var out []string
	for _, u := range d.users {
		if fn(u) {
			out = append(out, u.UserID)
		}
	}
	return out
}

// validators: may validate this transaction (permission + policy) and cover every given area.
func (d *directory) validators(t access.TransactionType, actor string, areas ...*string) []string {
	return d.filter(func(u access.Principal) bool { return u.UserID != actor && u.MayValidate(t, areas...) })
}

func (d *directory) monitoring(area *string, actor string) []string {
	return d.filter(func(u access.Principal) bool {
		return u.UserID != actor && (u.Role == access.RoleOperations || u.Role == access.RoleManagement) && u.CoversArea(area)
	})
}

func (d *directory) hrHO(actor string) []string {
	return d.filter(func(u access.Principal) bool { return u.UserID != actor && u.Role == access.RoleHRHO })
}

func (d *directory) exists(id string) []string {
	if _, ok := d.names[id]; ok {
		return []string{id}
	}
	return nil
}

func (d *directory) name(id string) string {
	if n, ok := d.names[id]; ok {
		return n
	}
	return id
}

// emit inserts one row per unique recipient; duplicates (same dedupe key) are skipped,
// so retries and double submits never duplicate notifications.
func emit(ctx context.Context, q db.Querier, now time.Time, sp spec) error {
	seen := map[string]bool{}
	var target []byte
	if sp.Target != nil {
		target, _ = json.Marshal(sp.Target)
	}
	for _, r := range sp.Recipients {
		if r == "" || seen[r] {
			continue
		}
		seen[r] = true
		if _, err := q.Exec(ctx, `INSERT INTO notifications (id, dedupe_key, recipient_user_id, category, severity, title, message, actor_user_id, entity_type, entity_id, area_id, target, requires_action, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (dedupe_key) DO NOTHING`,
			newID("ntf"), sp.DedupeBase+"#"+r, r, sp.Category, sp.Severity, sp.Title, sp.Message, nullable(sp.Actor), sp.EntityType, nullable(sp.EntityID), sp.AreaID, target, sp.RequiresAction, now); err != nil {
			return err
		}
	}
	return nil
}

// resolvePrefix marks actionable items resolved once their request is decided.
func resolvePrefix(ctx context.Context, q db.Querier, now time.Time, prefix string) error {
	_, err := q.Exec(ctx, `UPDATE notifications SET resolved_at = $2 WHERE requires_action AND resolved_at IS NULL AND starts_with(dedupe_key, $1)`, prefix, now)
	return err
}

func stamp(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

// ListNotifications returns the caller's own, non-archived notifications. Items whose
// area is no longer in scope are hidden, so stale notifications never grant access.
type NotificationQuery struct {
	Limit      int
	Offset     int
	UnreadOnly bool
	Category   string
}

type NotificationPage struct {
	Items       []Notification `json:"items"`
	UnreadCount int            `json:"unreadCount"`
	Total       int            `json:"total"` // matching the filter (unread/category), for paging
}

// visibleNotifications is the caller's own, non-archived notifications whose area is in scope.
const visibleNotifications = `recipient_user_id = $1 AND archived_at IS NULL AND (area_id IS NULL OR $2::text[] IS NULL OR area_id = ANY($2))`

func (s *Service) ListNotifications(ctx context.Context, p *access.Principal, q NotificationQuery) (*NotificationPage, error) {
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 100
	}
	q.Offset = max(q.Offset, 0)
	filter := visibleNotifications + ` AND (NOT $3 OR read_at IS NULL) AND ($4 = '' OR category = $4)`
	res := &NotificationPage{Items: []Notification{}}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE `+filter, p.UserID, scopeArgs(p), q.UnreadOnly, q.Category).Scan(&res.Total); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, dedupe_key, recipient_user_id, category, severity, title, message, actor_user_id, entity_type, entity_id, area_id, target, requires_action, created_at, read_at, archived_at, resolved_at
		FROM notifications WHERE `+filter+`
		ORDER BY created_at DESC, id LIMIT $5 OFFSET $6`, p.UserID, scopeArgs(p), q.UnreadOnly, q.Category, q.Limit, q.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var n Notification
		var target []byte
		if err := rows.Scan(&n.ID, &n.DedupeKey, &n.RecipientUserID, &n.Category, &n.Severity, &n.Title, &n.Message, &n.ActorUserID, &n.EntityType, &n.EntityID, &n.AreaID, &target, &n.RequiresAction, &n.CreatedAt, &n.ReadAt, &n.ArchivedAt, &n.ResolvedAt); err != nil {
			return nil, err
		}
		if len(target) > 0 {
			n.Target = &NotificationTarget{}
			_ = json.Unmarshal(target, n.Target)
		}
		res.Items = append(res.Items, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE `+visibleNotifications+` AND read_at IS NULL`, p.UserID, scopeArgs(p)).Scan(&res.UnreadCount)
	return res, err
}

// MarkAllNotificationsRead marks every visible unread notification of the caller as read,
// not only the page loaded in the browser.
func (s *Service) MarkAllNotificationsRead(ctx context.Context, p *access.Principal) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `UPDATE notifications SET read_at = $3 WHERE `+visibleNotifications+` AND read_at IS NULL`, p.UserID, scopeArgs(p), s.now())
	return tag.RowsAffected(), err
}

// MarkNotifications updates read/archive state for the caller's own notifications only.
func (s *Service) MarkNotifications(ctx context.Context, p *access.Principal, ids []string, action string) (int64, error) {
	if len(ids) == 0 || len(ids) > 500 {
		return 0, httpx.Validation(map[string]string{"ids": "Pilih 1–500 notifikasi."})
	}
	var sql string
	switch action {
	case "read":
		sql = `UPDATE notifications SET read_at = COALESCE(read_at, $3) WHERE recipient_user_id = $1 AND id = ANY($2)`
	case "archive":
		sql = `UPDATE notifications SET archived_at = COALESCE(archived_at, $3), read_at = COALESCE(read_at, $3) WHERE recipient_user_id = $1 AND id = ANY($2)`
	default:
		return 0, httpx.BadRequest("Aksi tidak dikenal.")
	}
	tag, err := s.Pool.Exec(ctx, sql, p.UserID, ids, s.now())
	return tag.RowsAffected(), err
}

// RunReminders reconciles contract (configured D-n thresholds / EXPIRED) and open-over-SLA reminders.
// It is idempotent: existing alerts are kept, alerts whose condition no longer
// holds are resolved. It runs in the background independent of any browser tab.
func (s *Service) RunReminders(ctx context.Context) error {
	today := s.Today()
	return s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(727211002)"); err != nil {
			return err
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		now := s.now()
		cs, err := loadContractSettings(ctx, tx)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, employeeSelect+` WHERE p.contract_end_date IS NOT NULL AND p.employment_status = 'ACTIVE' AND p.record_status = 'VALIDATED' AND p.condition_status <> 'NEEDS_REVIEW' ORDER BY p.contract_end_date, p.id`)
		if err != nil {
			return err
		}
		emps, err := collectEmployees(rows, false)
		if err != nil {
			return err
		}
		var valid []string
		made := 0
		for _, e := range emps {
			cat := domain.ContractReminderCategory(e, today, cs.ReminderDays)
			if cat == "" {
				continue
			}
			if made >= 50 {
				break
			}
			made++
			base := fmt.Sprintf("contract:%s:%s:%s", e.ID, *e.ContractEndDate, cat)
			valid = append(valid, base)
			title, sev, verb := "Kontrak mendekati berakhir ("+cat+")", "warning", "berakhir pada"
			if cat == "EXPIRED" {
				title, sev, verb = "Kontrak sudah berakhir", "error", "sudah berakhir pada"
			}
			recips := dir.filter(func(u access.Principal) bool {
				return (u.Role == access.RoleHRHO || u.Role == access.RoleAreaSupport) && u.CoversArea(e.AreaID)
			})
			if err := emit(ctx, tx, now, spec{DedupeBase: base, Recipients: recips, Category: "CONTRACT", Severity: sev, Title: title,
				Message:    fmt.Sprintf("Kontrak %s (%s) %s %s.", e.Name, e.PersonnelID, verb, *e.ContractEndDate),
				EntityType: "employee", EntityID: e.ID, AreaID: e.AreaID, Target: &NotificationTarget{Kind: "employee", ID: e.ID}, RequiresAction: true}); err != nil {
				return err
			}
		}
		if err := reconcileCategory(ctx, tx, now, "CONTRACT", valid); err != nil {
			return err
		}
		needs, err := s.needs(ctx, tx, "rn.lifecycle_status IN ('OPEN','MATCHED')")
		if err != nil {
			return err
		}
		valid = nil
		for _, n := range needs {
			gap, err := domain.WorkingDayGap(n.ExitDate, today)
			if err != nil || domain.SLAStatusFor(gap) != "OVER_TARGET" {
				continue
			}
			base := "sla:" + n.ID + ":open"
			valid = append(valid, base)
			recips := dir.filter(func(u access.Principal) bool {
				return (u.Role == access.RoleHRHO || u.Role == access.RoleOperations || u.Role == access.RoleManagement) && u.CoversArea(n.AreaID)
			})
			if err := emit(ctx, tx, now, spec{DedupeBase: base, Recipients: recips, Category: "SLA", Severity: "warning", Title: "Replacement melewati SLA",
				Message:    fmt.Sprintf("Kebutuhan %s masih terbuka %d hari kerja sejak exit (target ≤ %d).", shortID(n.ID), gap, domain.SLATargetWorkingDays),
				EntityType: "replacement", EntityID: n.ID, AreaID: n.AreaID, Target: &NotificationTarget{Kind: "replacement", ID: n.ID}, RequiresAction: true}); err != nil {
				return err
			}
		}
		return reconcileCategory(ctx, tx, now, "SLA", valid)
	})
}

func reconcileCategory(ctx context.Context, tx pgx.Tx, now time.Time, category string, validBases []string) error {
	if validBases == nil {
		validBases = []string{}
	}
	_, err := tx.Exec(ctx, `UPDATE notifications SET resolved_at = $3
		WHERE category = $1 AND requires_action AND resolved_at IS NULL
		AND NOT (left(dedupe_key, length(dedupe_key) - strpos(reverse(dedupe_key), '#')) = ANY($2))`, category, validBases, now)
	return err
}

func shortID(id string) string {
	if len(id) > 13 {
		return id[:13]
	}
	return id
}
