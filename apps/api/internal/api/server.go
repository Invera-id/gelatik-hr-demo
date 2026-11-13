// Package api is the HTTP transport: Fiber app, middleware, routes and handlers.
// Handlers decode/validate input, call the service layer and encode responses.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	recoverer "github.com/gofiber/fiber/v3/middleware/recover"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/config"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/service"
)

const jsonBodyLimit = 1 << 20

type Server struct {
	Cfg  config.Config
	Log  *slog.Logger
	Auth *auth.Service
	Svc  *service.Service
}

const principalKey = "principal"

func principal(c fiber.Ctx) *access.Principal {
	p, _ := c.Locals(principalKey).(*access.Principal)
	return p
}

func (s *Server) actor(c fiber.Ctx) service.Actor {
	return service.Actor{P: principal(c), RequestID: httpx.RequestID(c)}
}

// New builds the Fiber app. Immutable is enabled so strings taken from the
// request are never reused by fasthttp after the handler returns.
func New(s *Server) *fiber.App {
	cfg := fiber.Config{
		AppName:      "gelatik-hr-api",
		Immutable:    true,
		BodyLimit:    max(s.Cfg.ImportMaxBytes, s.Cfg.DocumentMaxBytes) + 1<<20,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
		ErrorHandler: httpx.ErrorHandler(s.Log),
	}
	if len(s.Cfg.TrustedProxies) > 0 {
		cfg.TrustProxy = true
		cfg.TrustProxyConfig = fiber.TrustProxyConfig{Proxies: s.Cfg.TrustedProxies}
		cfg.ProxyHeader = fiber.HeaderXForwardedFor
	}
	app := fiber.New(cfg)
	app.Use(recoverer.New())
	app.Use(httpx.RequestIDMiddleware())
	app.Use(httpx.AccessLog(s.Log))
	app.Use(httpx.SecurityHeaders())
	if len(s.Cfg.AllowedOrigins) > 0 {
		app.Use(cors.New(cors.Config{
			AllowOrigins:     s.Cfg.AllowedOrigins,
			AllowCredentials: true,
			AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Content-Type", "X-CSRF-Token", "X-Request-ID"},
			ExposeHeaders:    []string{"X-Request-ID", "Content-Disposition"},
			MaxAge:           600,
		}))
	}
	app.Get("/healthz", s.health)
	app.Get("/readyz", s.ready)

	v1 := app.Group("/api/v1", httpx.TimeoutMiddleware(s.Cfg.RequestTimeout))
	v1.Get("/health", s.health)
	v1.Get("/ready", s.ready)
	v1.Post("/auth/login", httpx.BodyLimit(jsonBodyLimit), s.originGuard, s.login)

	authed := v1.Group("", s.authenticate, s.originGuard, s.csrf)
	authed.Post("/auth/logout", s.logout)
	authed.Get("/auth/me", s.me)
	authed.Get("/workspace", s.workspace)
	authed.Get("/snapshot", s.snapshot)
	authed.Get("/dashboard", s.dashboard)
	authed.Get("/dashboard/compliance", s.compliance)
	authed.Get("/exports/:kind", s.export)

	j := httpx.BodyLimit(jsonBodyLimit)
	authed.Get("/employees", s.listEmployees)
	authed.Post("/employees", j, s.createEmployee)
	authed.Post("/employees/validate-bulk", j, s.bulkValidate)
	authed.Get("/employees/:id", s.getEmployee)
	authed.Put("/employees/:id", j, s.updateEmployee)
	authed.Post("/employees/:id/validation", j, s.validateEntry)
	authed.Post("/employees/:id/exit-request", j, s.saveExit)
	authed.Post("/employees/:id/movement-request", j, s.saveMovement)
	authed.Post("/employees/:id/reentry", j, s.reentry)
	authed.Post("/employees/:id/notes", j, s.addNote)
	authed.Post("/employees/:id/flags", j, s.setFlag)
	authed.Post("/change-requests/:id/validation", j, s.validateRequest)

	authed.Get("/contracts/monitoring", s.contractMonitoring)
	authed.Get("/employees/:id/documents", s.employeeDocuments)
	authed.Get("/documents/catalog", s.documentCatalog)
	authed.Get("/documents/queue", s.documentQueue)
	authed.Get("/validation/readiness", s.validationReadiness)
	authed.Get("/documents/employee-status", s.employeeDocumentStatus)
	authed.Post("/documents/subjects/:subjectType/:subjectId/:documentType", s.uploadDocument)
	authed.Post("/documents/versions/:id/review", j, s.reviewDocument)
	authed.Get("/documents/versions/:id/content", s.documentContent)

	authed.Get("/replacements/:id", s.getNeed)
	authed.Post("/replacements/:id/match", j, s.match)
	authed.Post("/replacements/:id/fulfill", j, s.fulfill)

	authed.Post("/projects", j, s.createProject)
	authed.Put("/projects/:id", j, s.updateProject)
	authed.Post("/projects/:id/status", j, s.projectStatus)
	authed.Put("/projects/:id/quotas/:period", j, s.saveQuota)

	authed.Get("/imports", s.importOverview)
	authed.Post("/imports/previews", s.importPreview)
	authed.Post("/imports/commit", j, s.importCommit)
	authed.Post("/imports/cancel", j, s.importCancel)
	authed.Get("/imports/batches/:id/exceptions", s.batchExceptions)
	authed.Post("/imports/reviews/:id/decision", j, s.decideReview)

	authed.Get("/notifications", s.listNotifications)
	authed.Post("/notifications/mark", j, s.markNotifications)

	authed.Put("/settings/roles/:role", j, s.updateRole)
	authed.Post("/settings/roles/reset", j, s.resetRoles)
	authed.Put("/settings/validation-policy/:transaction", j, s.setPolicy)
	authed.Get("/settings/contract-monitoring", s.getContractSettings)
	authed.Put("/settings/contract-monitoring", j, s.saveContractSettings)
	authed.Put("/settings/document-types/:code", j, s.saveDocumentType)
	authed.Put("/settings/document-requirements/:transaction", j, s.saveDocumentRequirements)
	authed.Get("/users", s.listUsers)
	authed.Post("/users", j, s.createUser)
	authed.Patch("/users/:id", j, s.updateUser)

	app.Use(func(c fiber.Ctx) error { return httpx.NotFound("Endpoint") })
	return app
}

// Routes lists registered method+path pairs (used by the contract drift test).
func Routes(app *fiber.App) [][2]string {
	var out [][2]string
	for _, r := range app.GetRoutes(true) {
		if r.Method == fiber.MethodHead || r.Method == fiber.MethodOptions || r.Path == "/" {
			continue
		}
		out = append(out, [2]string{r.Method, r.Path})
	}
	return out
}

func (s *Server) health(c fiber.Ctx) error { return c.JSON(fiber.Map{"status": "ok"}) }

// ready requires a reachable database with every migration applied.
func (s *Server) ready(c fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	pending, err := db.PendingMigrations(ctx, s.Svc.Pool)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "unavailable", "reason": "database"})
	}
	if len(pending) > 0 {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "unavailable", "reason": "migrations pending", "pending": pending})
	}
	return c.JSON(fiber.Map{"status": "ready"})
}

func (s *Server) sessionToken(c fiber.Ctx) string { return c.Cookies(s.Cfg.CookieName) }

func (s *Server) authenticate(c fiber.Ctx) error {
	p, csrf, err := s.Auth.Resolve(c.Context(), s.sessionToken(c))
	if errors.Is(err, auth.ErrNoSession) {
		s.clearCookie(c)
		return httpx.Unauthorized()
	}
	if err != nil {
		return err
	}
	c.Locals(principalKey, p)
	c.Locals("csrf", csrf)
	return c.Next()
}

// csrf enforces the synchronizer token on every state-changing request.
func (s *Server) csrf(c fiber.Ctx) error {
	if !httpx.IsMutation(c.Method()) {
		return c.Next()
	}
	expected, _ := c.Locals("csrf").(string)
	if !auth.CheckCSRF(expected, c.Get("X-CSRF-Token")) {
		return httpx.NewError(fiber.StatusForbidden, "CSRF_FAILED", "Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.")
	}
	return c.Next()
}

// originGuard rejects cross-site mutations from origins that are not allowed
// (defense in depth next to SameSite cookies and the CSRF token).
func (s *Server) originGuard(c fiber.Ctx) error {
	if !httpx.IsMutation(c.Method()) {
		return c.Next()
	}
	origin := c.Get("Origin")
	if origin == "" {
		return c.Next()
	}
	if slices.Contains(s.Cfg.AllowedOrigins, origin) {
		return c.Next()
	}
	if u, err := url.Parse(origin); err == nil && strings.EqualFold(u.Host, c.Host()) {
		return c.Next()
	}
	return httpx.NewError(fiber.StatusForbidden, "ORIGIN_REJECTED", "Origin tidak diizinkan.")
}

func (s *Server) setCookie(c fiber.Ctx, value string, expires time.Time) {
	c.Cookie(&fiber.Cookie{Name: s.Cfg.CookieName, Value: value, Path: "/", Domain: s.Cfg.CookieDomain, Expires: expires,
		HTTPOnly: true, Secure: s.Cfg.CookieSecure, SameSite: s.Cfg.CookieSameSite})
}

func (s *Server) clearCookie(c fiber.Ctx) {
	if s.sessionToken(c) != "" {
		s.setCookie(c, "", time.Unix(0, 0))
	}
}
