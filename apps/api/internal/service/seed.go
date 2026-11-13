package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

// Development seed: demo accounts only. Personnel, projects, quotas, and document
// types are not seeded (they come from Excel import or the UI). The one area row is
// required by the AREA_SUPPORT account's foreign key. Idempotent: ON CONFLICT DO NOTHING.

type SeedOptions struct {
	DemoPassword string // required for demo accounts; never defaulted
}

// seedUserAreas are the areas the demo accounts are scoped to (users.area_id FK).
var seedUserAreas = [][2]string{{"area-bandung", "Bandung"}}

var seedUsers = []struct{ ID, Name, Email, Role, Area string }{
	{"user-bandung", "Rina Area Bandung", "bandung@demo.test", "AREA_SUPPORT", "area-bandung"},
	{"user-hr", "Dewi HR Head Office", "hr@demo.test", "HR_HO", ""},
	{"user-operations", "Arief Operational Manager", "operations@demo.test", "OPERATIONS_MANAGER", ""},
	{"user-management", "Budi Management", "management@demo.test", "MANAGEMENT", ""},
	{"user-superadmin", "Nadia Super Admin", "superadmin@demo.test", "SUPER_ADMIN", ""},
}

func Seed(ctx context.Context, tx pgx.Tx, opt SeedOptions) error {
	if err := EnsureDefaults(ctx, tx); err != nil {
		return err
	}
	if opt.DemoPassword == "" {
		return nil
	}
	if len(opt.DemoPassword) < minPasswordLength {
		return fmt.Errorf("demo password must be at least %d characters", minPasswordLength)
	}
	for _, a := range seedUserAreas {
		if _, err := tx.Exec(ctx, `INSERT INTO areas (id, name, name_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, a[0], a[1], imports.NameKey(a[1])); err != nil {
			return err
		}
	}
	hash, err := auth.HashPassword(opt.DemoPassword)
	if err != nil {
		return err
	}
	for _, u := range seedUsers {
		if _, err := tx.Exec(ctx, `INSERT INTO users (id, name, email, email_key, password_hash, role, area_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
			u.ID, u.Name, u.Email, auth.EmailKey(u.Email), hash, u.Role, nullable(u.Area)); err != nil {
			return err
		}
	}
	return nil
}
