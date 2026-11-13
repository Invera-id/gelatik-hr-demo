package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
)

// Throttling: a login is refused once an email or IP accumulates this many
// failures inside the window. Counts come from the database so they hold across instances.
const (
	MaxFailuresPerEmail = 5
	MaxFailuresPerIP    = 30
	FailureWindow       = 15 * time.Minute
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrThrottled          = errors.New("too many attempts")
	ErrNoSession          = errors.New("no session")
)

type Service struct {
	Pool *pgxpool.Pool
	TTL  time.Duration
	Now  func() time.Time
}

type Session struct {
	Token     string
	CSRFToken string
	ExpiresAt time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) throttled(ctx context.Context, emailKey, ip string) (bool, error) {
	since := s.now().Add(-FailureWindow)
	var byEmail, byIP int
	err := s.Pool.QueryRow(ctx, `
		SELECT
		  count(*) FILTER (WHERE email_key = $1),
		  count(*) FILTER (WHERE ip = $2)
		FROM login_attempts WHERE NOT succeeded AND attempted_at > $3 AND (email_key = $1 OR ip = $2)`,
		emailKey, ip, since).Scan(&byEmail, &byIP)
	if err != nil {
		return false, err
	}
	return byEmail >= MaxFailuresPerEmail || byIP >= MaxFailuresPerIP, nil
}

// Login verifies credentials and creates a fresh session (any previous cookie is
// replaced, which rotates the session on login). Errors never reveal whether the account exists.
func (s *Service) Login(ctx context.Context, email, password, ip, userAgent, previousToken string) (*Session, string, error) {
	key := EmailKey(email)
	if limited, err := s.throttled(ctx, key, ip); err != nil {
		return nil, "", err
	} else if limited {
		return nil, "", ErrThrottled
	}
	var userID, hash string
	var active bool
	err := s.Pool.QueryRow(ctx, `SELECT id, password_hash, active FROM users WHERE email_key = $1`, key).Scan(&userID, &hash, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = VerifyPassword(password, dummyHash)
		hash = ""
	} else if err != nil {
		return nil, "", err
	}
	ok := false
	if hash != "" {
		ok, err = VerifyPassword(password, hash)
		if err != nil {
			return nil, "", err
		}
	}
	if _, err := s.Pool.Exec(ctx, `INSERT INTO login_attempts (email_key, ip, succeeded, attempted_at) VALUES ($1, $2, $3, $4)`, key, ip, ok && active, s.now()); err != nil {
		return nil, "", err
	}
	if !ok || !active {
		return nil, "", ErrInvalidCredentials
	}
	token, err := NewToken()
	if err != nil {
		return nil, "", err
	}
	csrf, err := NewToken()
	if err != nil {
		return nil, "", err
	}
	expires := s.now().Add(s.TTL)
	err = db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		if previousToken != "" {
			if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, HashToken(previousToken), s.now()); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$4,$5,$6,$7)`,
			HashToken(token), userID, csrf, s.now(), expires, ip, truncate(userAgent, 256))
		return err
	})
	if err != nil {
		return nil, "", err
	}
	return &Session{Token: token, CSRFToken: csrf, ExpiresAt: expires}, userID, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// Resolve loads the session and the principal. Permissions are read fresh from
// role_configs on every request, so role changes apply to active sessions immediately.
func (s *Service) Resolve(ctx context.Context, token string) (*access.Principal, string, error) {
	if token == "" {
		return nil, "", ErrNoSession
	}
	var p access.Principal
	var csrf, role, scope string
	var perms, selected []string
	var lastSeen time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT u.id, u.name, u.email, u.role, u.area_id, s.csrf_token, s.last_seen_at, rc.scope, rc.selected_area_ids, rc.permissions
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN role_configs rc ON rc.role = u.role
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.active`,
		HashToken(token), s.now()).Scan(&p.UserID, &p.Name, &p.Email, &role, &p.AreaID, &csrf, &lastSeen, &scope, &selected, &perms)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNoSession
	}
	if err != nil {
		return nil, "", err
	}
	p.Role = access.Role(role)
	p.Config = access.RoleConfig{Role: p.Role, Scope: access.Scope(scope), SelectedAreaIDs: selected}
	for _, perm := range perms {
		p.Config.Permissions = append(p.Config.Permissions, access.Permission(perm))
	}
	policy, err := LoadPolicy(ctx, s.Pool)
	if err != nil {
		return nil, "", err
	}
	p.Policy = policy
	if s.now().Sub(lastSeen) > time.Minute {
		_, _ = s.Pool.Exec(ctx, `UPDATE sessions SET last_seen_at = $2 WHERE token_hash = $1`, HashToken(token), s.now())
	}
	return &p, csrf, nil
}

// CheckCSRF compares the header token against the session token in constant time.
func CheckCSRF(expected, got string) bool {
	return expected != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(got)) == 1
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	_, err := s.Pool.Exec(ctx, `UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, HashToken(token), s.now())
	return err
}

// RevokeUserSessions ends every session of a user (deactivation, password reset).
func RevokeUserSessions(ctx context.Context, q db.Querier, userID string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`, userID, at)
	return err
}

// Cleanup removes expired sessions and old login attempts.
func (s *Service) Cleanup(ctx context.Context) error {
	if _, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < $1 OR revoked_at < $1 - interval '1 day'`, s.now()); err != nil {
		return err
	}
	_, err := s.Pool.Exec(ctx, `DELETE FROM login_attempts WHERE attempted_at < $1`, s.now().Add(-24*time.Hour))
	return err
}

func LoadPolicy(ctx context.Context, q db.Querier) (access.ValidationPolicy, error) {
	policy := access.DefaultValidationPolicy()
	rows, err := q.Query(ctx, `SELECT transaction_type, authority FROM validation_policy`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t, a string
		if err := rows.Scan(&t, &a); err != nil {
			return nil, err
		}
		policy[access.TransactionType(t)] = access.Authority(a)
	}
	return policy, rows.Err()
}
