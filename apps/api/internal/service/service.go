// Package service implements authorized, transactional business workflows on top
// of PostgreSQL. HTTP concerns live in package api; pure rules live in domain/imports.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/storage"
)

type Service struct {
	Pool             *pgxpool.Pool
	Log              *slog.Logger
	Clock            func() time.Time
	BusinessDate     string // optional override, YYYY-MM-DD
	ImportMaxRows    int
	ImportPreviewTTL time.Duration
	importSlots      chan struct{}
	// Private document storage and upload limits (see config).
	Store           storage.Store
	DocMaxBytes     int
	DocAllowedTypes []string
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{Pool: pool, Log: log, Clock: time.Now, ImportMaxRows: 20000, ImportPreviewTTL: 30 * time.Minute, importSlots: make(chan struct{}, 2),
		DocMaxBytes: 10 << 20, DocAllowedTypes: []string{"application/pdf", "image/jpeg", "image/png"}}
}

func (s *Service) now() time.Time { return s.Clock().UTC() }

// Today is the business date in Asia/Jakarta (or the configured override).
func (s *Service) Today() string { return domain.BusinessToday(s.Clock(), s.BusinessDate) }

func newID(prefix string) string { return prefix + "-" + uuid.NewString() }

func (s *Service) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	return db.InTx(ctx, s.Pool, fn)
}

var errNotFound = errors.New("not found")

func notFoundOr(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, errNotFound) {
		return httpx.NotFound(what)
	}
	return err
}

func require(p *access.Principal, perms ...access.Permission) error {
	for _, perm := range perms {
		if !p.Has(perm) {
			return httpx.Forbidden()
		}
	}
	return nil
}

func requireAny(p *access.Principal, perms ...access.Permission) error {
	for _, perm := range perms {
		if p.Has(perm) {
			return nil
		}
	}
	return httpx.Forbidden()
}

// scopeArgs returns the allowed area list for SQL (`$n::text[] IS NULL OR area_id = ANY($n)`).
func scopeArgs(p *access.Principal) []string {
	if p.AllAreas() {
		return nil
	}
	return p.AllowedAreaIDs()
}

// audit records an important change. details must not copy full personal profiles.
type auditEntry struct {
	Action       string
	EntityType   string
	EntityID     string
	PersonnelID  *string
	AreaID       *string
	ActivityType string
	Title        string
	Description  string
	Details      map[string]any
}

func (s *Service) audit(ctx context.Context, tx pgx.Tx, actor string, requestID string, e auditEntry) error {
	details := e.Details
	if details == nil {
		details = map[string]any{}
	}
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	var activity, title, desc *string
	if e.ActivityType != "" {
		activity, title, desc = &e.ActivityType, &e.Title, &e.Description
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_log (occurred_at, actor_user_id, action, entity_type, entity_id, personnel_id, area_id, request_id, activity_type, title, description, details)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		s.now(), actor, e.Action, e.EntityType, e.EntityID, e.PersonnelID, e.AreaID, nullable(requestID), activity, title, desc, raw)
	return err
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Actor bundles the principal and request ID for workflow calls.
type Actor struct {
	P         *access.Principal
	RequestID string
}
