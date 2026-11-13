// Package httpx holds HTTP-transport concerns: the error envelope and middleware.
package httpx

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/gofiber/fiber/v3"
)

// Error is a typed API error. Services return it; the error handler renders it.
type Error struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

func NewError(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func BadRequest(message string) *Error {
	return NewError(fiber.StatusBadRequest, "BAD_REQUEST", message)
}
func Unauthorized() *Error {
	return NewError(fiber.StatusUnauthorized, "UNAUTHENTICATED", "Sesi tidak valid atau sudah berakhir. Silakan masuk kembali.")
}
func Forbidden() *Error {
	return NewError(fiber.StatusForbidden, "FORBIDDEN", "Anda tidak memiliki akses untuk tindakan ini.")
}

// NotFound is also used for out-of-scope records so existence is not disclosed.
func NotFound(what string) *Error {
	return NewError(fiber.StatusNotFound, "NOT_FOUND", what+" tidak ditemukan.")
}
func Conflict(code, message string) *Error { return NewError(fiber.StatusConflict, code, message) }

// Validation builds a 422 error with per-field messages.
func Validation(fields map[string]string) *Error {
	return &Error{Status: fiber.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Message: "Data belum valid. Periksa kembali isian yang ditandai.", Fields: fields}
}

// FieldErrors accumulates per-field validation messages.
type FieldErrors map[string]string

func (f FieldErrors) Add(field, msg string) {
	if _, exists := f[field]; !exists {
		f[field] = msg
	}
}

func (f FieldErrors) Err() error {
	if len(f) == 0 {
		return nil
	}
	return Validation(f)
}

// ErrorHandler renders every error in the consistent envelope and never leaks internals.
func ErrorHandler(log *slog.Logger) fiber.ErrorHandler {
	return func(c fiber.Ctx, err error) error {
		reqID := RequestID(c)
		var apiErr *Error
		var fe *fiber.Error
		switch {
		case errors.As(err, &apiErr):
		case errors.As(err, &fe):
			code := "HTTP_ERROR"
			switch fe.Code {
			case fiber.StatusNotFound:
				code = "NOT_FOUND"
			case fiber.StatusRequestEntityTooLarge:
				code = "PAYLOAD_TOO_LARGE"
			case fiber.StatusMethodNotAllowed:
				code = "METHOD_NOT_ALLOWED"
			}
			apiErr = NewError(fe.Code, code, fe.Message)
		default:
			log.Error("unhandled error", "request_id", reqID, "path", c.Path(), "err", err)
			apiErr = NewError(fiber.StatusInternalServerError, "INTERNAL", "Terjadi kesalahan pada server.")
		}
		body := fiber.Map{"code": apiErr.Code, "message": apiErr.Message, "requestId": reqID}
		if len(apiErr.Fields) > 0 {
			body["fields"] = apiErr.Fields
		}
		return c.Status(apiErr.Status).JSON(fiber.Map{"error": body})
	}
}
