package service

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

func loadRoleConfigs(ctx context.Context, q db.Querier) ([]access.RoleConfig, error) {
	rows, err := q.Query(ctx, `SELECT role, scope, selected_area_ids, permissions FROM role_configs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byRole := map[access.Role]access.RoleConfig{}
	for rows.Next() {
		var c access.RoleConfig
		var role, scope string
		var perms []string
		if err := rows.Scan(&role, &scope, &c.SelectedAreaIDs, &perms); err != nil {
			return nil, err
		}
		c.Role, c.Scope = access.Role(role), access.Scope(scope)
		c.Permissions = []access.Permission{}
		for _, p := range access.AllPermissions {
			if slices.Contains(perms, string(p)) {
				c.Permissions = append(c.Permissions, p)
			}
		}
		byRole[c.Role] = c
	}
	out := []access.RoleConfig{}
	for _, r := range access.Roles {
		if c, ok := byRole[r]; ok {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

// EnsureDefaults inserts default role configs and validation policy when missing.
// Existing configuration is never overwritten.
func EnsureDefaults(ctx context.Context, q db.Querier) error {
	for _, c := range access.DefaultRoleConfigs() {
		perms := make([]string, len(c.Permissions))
		for i, p := range c.Permissions {
			perms[i] = string(p)
		}
		if _, err := q.Exec(ctx, `INSERT INTO role_configs (role, scope, selected_area_ids, permissions) VALUES ($1,$2,$3,$4) ON CONFLICT (role) DO NOTHING`, string(c.Role), string(c.Scope), c.SelectedAreaIDs, perms); err != nil {
			return err
		}
	}
	for t, a := range access.DefaultValidationPolicy() {
		if _, err := q.Exec(ctx, `INSERT INTO validation_policy (transaction_type, authority) VALUES ($1,$2) ON CONFLICT DO NOTHING`, string(t), string(a)); err != nil {
			return err
		}
	}
	return nil
}

// countAdmins counts active users whose role holds manage_roles.
func countAdmins(ctx context.Context, q db.Querier) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM users u JOIN role_configs rc ON rc.role = u.role WHERE u.active AND 'manage_roles' = ANY(rc.permissions)`).Scan(&n)
	return n, err
}

func ensureAdminRemains(ctx context.Context, tx pgx.Tx) error {
	n, err := countAdmins(ctx, tx)
	if err != nil {
		return err
	}
	if n == 0 {
		return httpx.Conflict("LAST_ADMIN", "Perubahan ditolak: harus tersisa minimal satu pengguna aktif yang dapat mengelola akses.")
	}
	return nil
}

type RoleConfigInput struct {
	Scope           string   `json:"scope"`
	SelectedAreaIDs []string `json:"selectedAreaIds"`
	Permissions     []string `json:"permissions"`
}

// UpdateRoleConfig replaces one role's permissions and scope. Because permissions are
// resolved per request, the change applies to active sessions on their next request.
func (s *Service) UpdateRoleConfig(ctx context.Context, a Actor, role string, in RoleConfigInput) ([]access.RoleConfig, error) {
	if err := require(a.P, access.ManageRoles); err != nil {
		return nil, err
	}
	fe := httpx.FieldErrors{}
	if !access.ValidRole(role) {
		return nil, httpx.NotFound("Role")
	}
	if !access.ValidScope(in.Scope) {
		fe.Add("scope", "Scope tidak dikenal.")
	}
	perms := []string{}
	for _, p := range in.Permissions {
		if !access.ValidPermission(p) {
			fe.Add("permissions", "Permission tidak dikenal: "+p)
		} else if !slices.Contains(perms, p) {
			perms = append(perms, p)
		}
	}
	if access.Role(role) == access.RoleSuperAdmin {
		for _, locked := range access.LockedSuperAdmin {
			if !slices.Contains(perms, string(locked)) {
				perms = append(perms, string(locked))
			}
		}
	}
	if in.SelectedAreaIDs == nil {
		in.SelectedAreaIDs = []string{}
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if len(in.SelectedAreaIDs) > 0 {
			var known int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM areas WHERE id = ANY($1)`, in.SelectedAreaIDs).Scan(&known); err != nil {
				return err
			}
			if known != len(in.SelectedAreaIDs) {
				return httpx.Validation(map[string]string{"selectedAreaIds": "Area tidak dikenal."})
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE role_configs SET scope=$2, selected_area_ids=$3, permissions=$4, updated_by=$5, updated_at=$6 WHERE role = $1`,
			role, in.Scope, in.SelectedAreaIDs, perms, a.P.UserID, s.now()); err != nil {
			return err
		}
		if err := ensureAdminRemains(ctx, tx); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "access.role.update", EntityType: "role_config", EntityID: role, Details: map[string]any{"scope": in.Scope, "permissions": perms, "selectedAreaIds": in.SelectedAreaIDs}})
	})
	if err != nil {
		return nil, err
	}
	return loadRoleConfigs(ctx, s.Pool)
}

func (s *Service) ResetRoleConfigs(ctx context.Context, a Actor) ([]access.RoleConfig, error) {
	if err := require(a.P, access.ManageRoles); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM role_configs`); err != nil {
			return err
		}
		if err := EnsureDefaults(ctx, tx); err != nil {
			return err
		}
		if err := ensureAdminRemains(ctx, tx); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "access.role.reset", EntityType: "role_config"})
	})
	if err != nil {
		return nil, err
	}
	return loadRoleConfigs(ctx, s.Pool)
}

func (s *Service) SetValidationPolicy(ctx context.Context, a Actor, transaction, authority string) (access.ValidationPolicy, error) {
	if err := require(a.P, access.ManageValidationPolicy); err != nil {
		return nil, err
	}
	if !slices.Contains(access.TransactionTypes, access.TransactionType(transaction)) {
		return nil, httpx.Validation(map[string]string{"transaction": "Jenis transaksi tidak dikenal."})
	}
	if authority != string(access.AuthorityAreaAdmin) && authority != string(access.AuthorityHRHO) && authority != string(access.AuthorityBoth) {
		return nil, httpx.Validation(map[string]string{"authority": "Otoritas tidak dikenal."})
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO validation_policy (transaction_type, authority, updated_by, updated_at) VALUES ($1,$2,$3,$4)
			ON CONFLICT (transaction_type) DO UPDATE SET authority = EXCLUDED.authority, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`, transaction, authority, a.P.UserID, s.now()); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "access.policy.update", EntityType: "validation_policy", EntityID: transaction, Details: map[string]any{"authority": authority}})
	})
	if err != nil {
		return nil, err
	}
	return auth.LoadPolicy(ctx, s.Pool)
}

type UserView struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	AreaID    *string   `json:"areaId"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Service) ListUsers(ctx context.Context, p *access.Principal) ([]UserView, error) {
	if err := require(p, access.ManageRoles); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, name, email, role, area_id, active, created_at FROM users ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserView{}
	for rows.Next() {
		var u UserView
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.AreaID, &u.Active, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

type UserInput struct {
	Name     string  `json:"name"`
	Email    string  `json:"email"`
	Role     string  `json:"role"`
	AreaID   *string `json:"areaId"`
	Active   *bool   `json:"active"`
	Password string  `json:"password"`
}

const minPasswordLength = 12

// CreateUser is the minimal administration needed to operate authentication and role/area assignment.
func CreateUser(ctx context.Context, q db.Querier, in UserInput) (string, error) {
	fe := httpx.FieldErrors{}
	in.Name, in.Email = strings.TrimSpace(in.Name), strings.TrimSpace(in.Email)
	if in.Name == "" {
		fe.Add("name", "Wajib diisi.")
	}
	if !strings.Contains(in.Email, "@") {
		fe.Add("email", "Email tidak valid.")
	}
	if !access.ValidRole(in.Role) {
		fe.Add("role", "Role tidak dikenal.")
	}
	if len(in.Password) < minPasswordLength {
		fe.Add("password", "Password minimal 12 karakter.")
	}
	if in.Role == string(access.RoleAreaSupport) && trimPtr(in.AreaID) == nil {
		fe.Add("areaId", "Area wajib untuk Area Supporting.")
	}
	if err := fe.Err(); err != nil {
		return "", err
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return "", err
	}
	id := newID("user")
	_, err = q.Exec(ctx, `INSERT INTO users (id, name, email, email_key, password_hash, role, area_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, in.Name, in.Email, auth.EmailKey(in.Email), hash, in.Role, trimPtr(in.AreaID))
	if db.IsUniqueViolation(err, "") {
		return "", httpx.Conflict("DUPLICATE_EMAIL", "Email sudah digunakan.")
	}
	return id, err
}

func (s *Service) CreateUser(ctx context.Context, a Actor, in UserInput) (string, error) {
	if err := require(a.P, access.ManageRoles); err != nil {
		return "", err
	}
	var id string
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		if id, err = CreateUser(ctx, tx, in); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "user.create", EntityType: "user", EntityID: id, Details: map[string]any{"role": in.Role}})
	})
	return id, err
}

// UpdateUser changes role/area/active/password. Deactivation and password changes
// revoke the user's sessions; the last access administrator is protected.
func (s *Service) UpdateUser(ctx context.Context, a Actor, id string, in UserInput) error {
	if err := require(a.P, access.ManageRoles); err != nil {
		return err
	}
	if in.Role != "" && !access.ValidRole(in.Role) {
		return httpx.Validation(map[string]string{"role": "Role tidak dikenal."})
	}
	if in.Password != "" && len(in.Password) < minPasswordLength {
		return httpx.Validation(map[string]string{"password": "Password minimal 12 karakter."})
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		var role string
		var active bool
		if err := tx.QueryRow(ctx, `SELECT role, active FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&role, &active); err != nil {
			return notFoundOr(err, "User")
		}
		if in.Role != "" {
			role = in.Role
		}
		if in.Active != nil {
			active = *in.Active
		}
		if role == string(access.RoleAreaSupport) && trimPtr(in.AreaID) == nil {
			var current *string
			_ = tx.QueryRow(ctx, `SELECT area_id FROM users WHERE id = $1`, id).Scan(&current)
			if current == nil {
				return httpx.Validation(map[string]string{"areaId": "Area wajib untuk Area Supporting."})
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET role=$2, active=$3, area_id=COALESCE($4, area_id), updated_at=$5 WHERE id=$1`, id, role, active, trimPtr(in.AreaID), s.now()); err != nil {
			return err
		}
		revoke := !active
		if in.Password != "" {
			hash, err := auth.HashPassword(in.Password)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, id, hash); err != nil {
				return err
			}
			revoke = true
		}
		if revoke {
			if err := auth.RevokeUserSessions(ctx, tx, id, s.now()); err != nil {
				return err
			}
		}
		if err := ensureAdminRemains(ctx, tx); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "user.update", EntityType: "user", EntityID: id, Details: map[string]any{"role": role, "active": active, "passwordChanged": in.Password != ""}})
	})
}
