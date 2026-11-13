package httpx

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
)

const requestIDKey = "requestId"

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

// RequestIDMiddleware assigns a request ID (or accepts a well-formed upstream one).
func RequestIDMiddleware() fiber.Handler {
	return func(c fiber.Ctx) error {
		id := c.Get("X-Request-ID")
		if !requestIDPattern.MatchString(id) {
			id = uuid.NewString()
		}
		c.Locals(requestIDKey, id)
		c.Set("X-Request-ID", id)
		return c.Next()
	}
}

func RequestID(c fiber.Ctx) string {
	if v, ok := c.Locals(requestIDKey).(string); ok {
		return v
	}
	return ""
}

// TimeoutMiddleware bounds downstream work (DB calls use c.Context()).
func TimeoutMiddleware(d time.Duration) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(context.Background(), d)
		defer cancel()
		c.SetContext(ctx)
		return c.Next()
	}
}

// AccessLog writes one structured line per request. It never logs bodies or query values.
func AccessLog(log *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		status := c.Response().StatusCode()
		if err != nil {
			if apiErr, ok := err.(*Error); ok {
				status = apiErr.Status
			} else if fe, ok := err.(*fiber.Error); ok {
				status = fe.Code
			} else {
				status = fiber.StatusInternalServerError
			}
		}
		log.Info("http",
			"request_id", RequestID(c), "method", c.Method(), "route", c.Route().Path,
			"status", status, "duration_ms", time.Since(start).Milliseconds())
		return err
	}
}

// BodyLimit rejects request bodies above max (the server-wide limit is sized for imports).
func BodyLimit(max int) fiber.Handler {
	return func(c fiber.Ctx) error {
		if len(c.Body()) > max {
			return NewError(fiber.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Ukuran request melebihi batas.")
		}
		return c.Next()
	}
}

// SecurityHeaders sets conservative headers for an API that only returns JSON/files.
func SecurityHeaders() fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("Cache-Control", "no-store")
		return c.Next()
	}
}

// IsMutation reports whether the method changes state (CSRF-protected).
func IsMutation(method string) bool {
	switch strings.ToUpper(method) {
	case fiber.MethodGet, fiber.MethodHead, fiber.MethodOptions:
		return false
	}
	return true
}
