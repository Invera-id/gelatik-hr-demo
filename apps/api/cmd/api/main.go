// Command api runs the Gelatik HR API and its operational subcommands.
//
//	api serve            start the HTTP server (default)
//	api migrate          apply pending migrations (explicit deploy step)
//	api migrate status   list pending migrations
//	api seed             insert the demo accounts only (refused in production)
//	api user create      create a user (bootstrap the first administrator)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // Asia/Jakarta must resolve in minimal containers

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/api"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/config"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/service"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/storage"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	_ = l.UnmarshalText([]byte(level))
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}

func run(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg.LogLevel)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := db.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "migrate":
		if len(args) > 0 && args[0] == "status" {
			pending, err := db.PendingMigrations(ctx, pool)
			if err != nil {
				return err
			}
			fmt.Printf("pending migrations: %d %v\n", len(pending), pending)
			return nil
		}
		applied, err := db.Migrate(ctx, pool)
		if err != nil {
			return err
		}
		if err := db.InTx(ctx, pool, func(tx pgx.Tx) error { return service.EnsureDefaults(ctx, tx) }); err != nil {
			return err
		}
		fmt.Printf("applied migrations: %v\n", applied)
		return nil
	case "seed":
		if cfg.Production() {
			return errors.New("seed is disabled in production")
		}
		opt := service.SeedOptions{DemoPassword: os.Getenv("SEED_DEMO_PASSWORD")}
		if opt.DemoPassword == "" {
			fmt.Println("SEED_DEMO_PASSWORD not set: only role defaults were ensured (no demo accounts).")
		}
		if err := db.InTx(ctx, pool, func(tx pgx.Tx) error { return service.Seed(ctx, tx, opt) }); err != nil {
			return err
		}
		fmt.Println("seed complete")
		return nil
	case "user":
		if len(args) == 0 || args[0] != "create" {
			return errors.New("usage: api user create --email ... --name ... --role ... [--area ...] (password from USER_PASSWORD)")
		}
		fs := flag.NewFlagSet("user create", flag.ContinueOnError)
		email := fs.String("email", "", "email")
		name := fs.String("name", "", "display name")
		role := fs.String("role", "SUPER_ADMIN", "role")
		area := fs.String("area", "", "area id (required for AREA_SUPPORT)")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		var areaID *string
		if strings.TrimSpace(*area) != "" {
			areaID = area
		}
		return db.InTx(ctx, pool, func(tx pgx.Tx) error {
			if err := service.EnsureDefaults(ctx, tx); err != nil {
				return err
			}
			id, err := service.CreateUser(ctx, tx, service.UserInput{Name: *name, Email: *email, Role: *role, AreaID: areaID, Password: os.Getenv("USER_PASSWORD")})
			if err == nil {
				fmt.Println("created user", id)
			}
			return err
		})
	case "serve":
		return serve(ctx, cfg, log, pool)
	}
	return fmt.Errorf("unknown command %q", cmd)
}

func serve(ctx context.Context, cfg config.Config, log *slog.Logger, pool *pgxpool.Pool) error {
	// Migrations are an explicit deploy step; the server refuses to start on a stale schema.
	if pending, err := db.PendingMigrations(ctx, pool); err != nil {
		return err
	} else if len(pending) > 0 {
		return fmt.Errorf("pending migrations %v: run `api migrate` first", pending)
	}
	svc := service.New(pool, log)
	svc.BusinessDate = cfg.BusinessDate
	svc.ImportMaxRows = cfg.ImportMaxRows
	svc.ImportPreviewTTL = cfg.ImportPreviewTTL
	store, err := storage.NewLocal(cfg.StorageDir)
	if err != nil {
		return fmt.Errorf("document storage: %w", err)
	}
	svc.Store, svc.DocMaxBytes, svc.DocAllowedTypes = store, cfg.DocumentMaxBytes, cfg.DocumentAllowedTypes
	authSvc := &auth.Service{Pool: pool, TTL: cfg.SessionTTL}
	app := api.New(&api.Server{Cfg: cfg, Log: log, Auth: authSvc, Svc: svc})

	go func() {
		tick := time.NewTicker(cfg.ReminderInterval)
		defer tick.Stop()
		for {
			jobCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			if err := svc.RunReminders(jobCtx); err != nil && ctx.Err() == nil {
				log.Error("reminders", "err", err)
			}
			if err := authSvc.Cleanup(jobCtx); err != nil && ctx.Err() == nil {
				log.Error("session cleanup", "err", err)
			}
			if n, err := svc.SweepOrphanDocuments(jobCtx, time.Hour); err != nil && ctx.Err() == nil {
				log.Error("document orphan sweep", "err", err)
			} else if n > 0 {
				log.Info("document orphan sweep", "deleted", n)
			}
			cancel()
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.ListenAddr, "env", cfg.Env)
		errCh <- app.Listen(cfg.ListenAddr, fiber.ListenConfig{DisableStartupMessage: true})
	}()
	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return app.ShutdownWithContext(shutdownCtx)
}
