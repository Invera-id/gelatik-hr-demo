// Package config loads runtime configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env              string // development | production | test
	ListenAddr       string
	DatabaseURL      string
	DBMaxConns       int32
	AllowedOrigins   []string
	TrustedProxies   []string
	CookieName       string
	CookieSecure     bool
	CookieSameSite   string // Lax | Strict | None
	CookieDomain     string
	SessionTTL       time.Duration
	RequestTimeout   time.Duration
	ImportMaxBytes   int
	ImportMaxRows    int
	ImportPreviewTTL time.Duration
	// BusinessDate overrides "today" (YYYY-MM-DD, Asia/Jakarta) for demos and tests.
	BusinessDate     string
	ReminderInterval time.Duration
	LogLevel         string
	// Private document storage (local directory; never served statically).
	StorageDir           string
	DocumentMaxBytes     int
	DocumentAllowedTypes []string // sniffed MIME types, e.g. application/pdf
}

// SupportedDocumentTypes are the MIME types the server can verify from file content.
var SupportedDocumentTypes = map[string]bool{"application/pdf": true, "image/jpeg": true, "image/png": true}

func (c Config) Production() bool { return c.Env == "production" }

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	v := env(key, "")
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func envDuration(key string, fallback time.Duration) (time.Duration, error) {
	v := env(key, "")
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}

// Load reads configuration and validates production-critical settings.
func Load() (Config, error) {
	var errs []error
	c := Config{
		Env:            env("APP_ENV", "development"),
		ListenAddr:     env("LISTEN_ADDR", ":8080"),
		DatabaseURL:    env("DATABASE_URL", ""),
		CookieName:     env("SESSION_COOKIE_NAME", "gelatik_session"),
		CookieSameSite: env("SESSION_COOKIE_SAMESITE", "Lax"),
		CookieDomain:   env("SESSION_COOKIE_DOMAIN", ""),
		BusinessDate:   env("BUSINESS_DATE", ""),
		LogLevel:       env("LOG_LEVEL", "info"),
	}
	for _, o := range strings.Split(env("ALLOWED_ORIGINS", ""), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, o)
		}
	}
	for _, o := range strings.Split(env("TRUSTED_PROXIES", ""), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.TrustedProxies = append(c.TrustedProxies, o)
		}
	}
	for _, t := range strings.Split(env("DOCUMENT_ALLOWED_TYPES", "application/pdf,image/jpeg,image/png"), ",") {
		if t = strings.TrimSpace(t); t != "" {
			c.DocumentAllowedTypes = append(c.DocumentAllowedTypes, t)
		}
	}
	c.StorageDir = env("STORAGE_DIR", "")
	if c.StorageDir == "" && !c.Production() {
		c.StorageDir = "./var/documents"
	}
	c.CookieSecure = env("SESSION_COOKIE_SECURE", strconv.FormatBool(c.Env == "production")) == "true"
	maxConns, err := envInt("DB_MAX_CONNS", 10)
	errs = append(errs, err)
	c.DBMaxConns = int32(maxConns)
	c.ImportMaxBytes, err = envInt("IMPORT_MAX_BYTES", 20*1024*1024)
	errs = append(errs, err)
	c.ImportMaxRows, err = envInt("IMPORT_MAX_ROWS", 20000)
	errs = append(errs, err)
	c.DocumentMaxBytes, err = envInt("DOCUMENT_MAX_BYTES", 10*1024*1024)
	errs = append(errs, err)
	c.SessionTTL, err = envDuration("SESSION_TTL", 12*time.Hour)
	errs = append(errs, err)
	c.RequestTimeout, err = envDuration("REQUEST_TIMEOUT", 30*time.Second)
	errs = append(errs, err)
	c.ImportPreviewTTL, err = envDuration("IMPORT_PREVIEW_TTL", 30*time.Minute)
	errs = append(errs, err)
	c.ReminderInterval, err = envDuration("REMINDER_INTERVAL", 15*time.Minute)
	errs = append(errs, err)

	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	switch c.CookieSameSite {
	case "Lax", "Strict", "None":
	default:
		errs = append(errs, errors.New("SESSION_COOKIE_SAMESITE must be Lax, Strict or None"))
	}
	if c.CookieSameSite == "None" && !c.CookieSecure {
		errs = append(errs, errors.New("SameSite=None requires SESSION_COOKIE_SECURE=true"))
	}
	if c.DocumentMaxBytes <= 0 {
		errs = append(errs, errors.New("DOCUMENT_MAX_BYTES must be positive"))
	}
	for _, t := range c.DocumentAllowedTypes {
		if !SupportedDocumentTypes[t] {
			errs = append(errs, fmt.Errorf("DOCUMENT_ALLOWED_TYPES: %q cannot be verified by content sniffing", t))
		}
	}
	if c.Production() {
		if c.StorageDir == "" {
			errs = append(errs, errors.New("production requires STORAGE_DIR (private, persistent volume)"))
		}
		if !c.CookieSecure {
			errs = append(errs, errors.New("production requires SESSION_COOKIE_SECURE=true"))
		}
		if c.BusinessDate != "" {
			errs = append(errs, errors.New("BUSINESS_DATE override is not allowed in production"))
		}
	}
	if c.BusinessDate != "" {
		if _, err := time.Parse(time.DateOnly, c.BusinessDate); err != nil {
			errs = append(errs, fmt.Errorf("BUSINESS_DATE: %w", err))
		}
	}
	return c, errors.Join(errs...)
}
