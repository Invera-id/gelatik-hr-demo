package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/config"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/service"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/storage"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/testfixture"
)

// Integration tests run against a real PostgreSQL database (TEST_DATABASE_URL);
// transactions, constraints and locking cannot be proven with mocks.

const demoPassword = "gelatik-test-password"

type env struct {
	t     *testing.T
	pool  *pgxpool.Pool
	app   *fiber.App
	svc   *service.Service
	store *storage.Local
}

var dbMu sync.Mutex

func newEnv(t *testing.T) *env {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping PostgreSQL integration test")
	}
	dbMu.Lock()
	t.Cleanup(dbMu.Unlock)
	ctx := context.Background()
	pool, err := db.Open(ctx, url, 20)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if err := service.Seed(ctx, tx, service.SeedOptions{DemoPassword: demoPassword}); err != nil {
			return err
		}
		return testfixture.Sample(ctx, tx)
	}); err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, pool: pool}
	e.restart()
	return e
}

// restart builds a fresh app over the same database (simulates a backend restart).
func (e *env) restart() {
	cfg := config.Config{Env: "test", CookieName: "gelatik_session", CookieSameSite: "Lax", SessionTTL: time.Hour, RequestTimeout: 30 * time.Second,
		ImportMaxBytes: 5 << 20, ImportMaxRows: 5000, ImportPreviewTTL: 30 * time.Minute, AllowedOrigins: []string{"http://localhost:5173"}}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	e.svc = service.New(e.pool, log)
	e.svc.BusinessDate = "2026-09-14"
	e.svc.Clock = func() time.Time { return time.Date(2026, 9, 14, 3, 0, 0, 0, time.UTC) }
	e.svc.ImportMaxRows = cfg.ImportMaxRows
	if e.store == nil {
		store, err := storage.NewLocal(e.t.TempDir())
		if err != nil {
			e.t.Fatal(err)
		}
		e.store = store
	}
	e.svc.Store, e.svc.DocMaxBytes = e.store, 1<<20
	authSvc := &auth.Service{Pool: e.pool, TTL: cfg.SessionTTL}
	e.app = New(&Server{Cfg: cfg, Log: log, Auth: authSvc, Svc: e.svc})
}

type client struct {
	e      *env
	cookie string
	csrf   string
	userID string
}

type resp struct {
	Status int
	Body   []byte
	Header http.Header
}

func (r resp) json(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode %s: %v", r.Body, err)
	}
}

func (r resp) code() string {
	var env struct {
		Error struct{ Code string } `json:"error"`
	}
	_ = json.Unmarshal(r.Body, &env)
	return env.Error.Code
}

func (e *env) raw(req *http.Request) resp {
	e.t.Helper()
	res, err := e.app.Test(req, fiber.TestConfig{Timeout: 60 * time.Second})
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return resp{Status: res.StatusCode, Body: body, Header: res.Header}
}

func (c *client) do(method, path string, body any) resp {
	c.e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.cookie != "" {
		req.Header.Set("Cookie", "gelatik_session="+c.cookie)
	}
	if c.csrf != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	return c.e.raw(req)
}

func (c *client) must(method, path string, body any, want int) resp {
	c.e.t.Helper()
	r := c.do(method, path, body)
	if r.Status != want {
		c.e.t.Fatalf("%s %s: status %d want %d: %s", method, path, r.Status, want, r.Body)
	}
	return r
}

func (e *env) login(email string) *client {
	e.t.Helper()
	b, _ := json.Marshal(map[string]string{"email": email, "password": demoPassword})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	res, err := e.app.Test(req, fiber.TestConfig{Timeout: 30 * time.Second})
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		body, _ := io.ReadAll(res.Body)
		e.t.Fatalf("login %s: %d %s", email, res.StatusCode, body)
	}
	c := &client{e: e}
	for _, ck := range res.Cookies() {
		if ck.Name == "gelatik_session" {
			c.cookie = ck.Value
		}
	}
	var me struct {
		CSRFToken string              `json:"csrfToken"`
		User      struct{ ID string } `json:"user"`
	}
	_ = json.NewDecoder(res.Body).Decode(&me)
	c.csrf, c.userID = me.CSRFToken, me.User.ID
	if c.cookie == "" || c.csrf == "" {
		e.t.Fatal("login did not return session cookie and csrf token")
	}
	return c
}

func (c *client) upload(path, fileName string, data []byte) resp {
	c.e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", fileName)
	_, _ = fw.Write(data)
	_ = mw.Close()
	req := httptest.NewRequest("POST", path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Cookie", "gelatik_session="+c.cookie)
	req.Header.Set("X-CSRF-Token", c.csrf)
	return c.e.raw(req)
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func ptr[T any](v T) *T { return &v }

func path(format string, args ...any) string { return fmt.Sprintf(format, args...) }

func contains(haystack []byte, needle string) bool { return strings.Contains(string(haystack), needle) }
