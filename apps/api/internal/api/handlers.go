package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/service"
)

// pathParam returns a decoded path parameter. Fiber matches routes on the escaped path and
// returns params still percent-encoded, so ids with spaces, "/" or other reserved characters
// (personnel ids come from Excel) must be unescaped here.
func pathParam(c fiber.Ctx, name string) string {
	raw := c.Params(name)
	if v, err := url.PathUnescape(raw); err == nil {
		return v
	}
	return raw
}

// decode requires a JSON body (rejects form posts) and decodes it into v.
func decode(c fiber.Ctx, v any) error {
	if !strings.HasPrefix(strings.ToLower(c.Get(fiber.HeaderContentType)), fiber.MIMEApplicationJSON) {
		return httpx.NewError(fiber.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type harus application/json.")
	}
	dec := json.NewDecoder(bytes.NewReader(c.Body()))
	if err := dec.Decode(v); err != nil {
		return httpx.BadRequest("Format JSON tidak valid.")
	}
	return nil
}

type meResponse struct {
	User           domain.UserSummary  `json:"user"`
	Email          string              `json:"email"`
	Permissions    []access.Permission `json:"permissions"`
	Scope          access.Scope        `json:"scope"`
	AllowedAreaIDs []string            `json:"allowedAreaIds"`
	CSRFToken      string              `json:"csrfToken"`
}

func meFor(p *access.Principal, csrf string) meResponse {
	allowed := p.AllowedAreaIDs()
	return meResponse{User: domain.UserSummary{ID: p.UserID, Name: p.Name, Role: string(p.Role), AreaID: p.AreaID}, Email: p.Email,
		Permissions: p.Config.Permissions, Scope: p.Config.Scope, AllowedAreaIDs: allowed, CSRFToken: csrf}
}

func (s *Server) login(c fiber.Ctx) error {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	if strings.TrimSpace(in.Email) == "" || in.Password == "" || len(in.Password) > 512 {
		return httpx.Validation(map[string]string{"email": "Email dan password wajib diisi."})
	}
	sess, _, err := s.Auth.Login(c.Context(), in.Email, in.Password, c.IP(), c.Get(fiber.HeaderUserAgent), s.sessionToken(c))
	switch {
	case errors.Is(err, auth.ErrThrottled):
		return httpx.NewError(fiber.StatusTooManyRequests, "TOO_MANY_ATTEMPTS", "Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.")
	case errors.Is(err, auth.ErrInvalidCredentials):
		return httpx.NewError(fiber.StatusUnauthorized, "INVALID_CREDENTIALS", "Email atau password tidak sesuai.")
	case err != nil:
		return err
	}
	s.setCookie(c, sess.Token, sess.ExpiresAt)
	p, csrf, err := s.Auth.Resolve(c.Context(), sess.Token)
	if err != nil {
		return err
	}
	return c.JSON(meFor(p, csrf))
}

func (s *Server) logout(c fiber.Ctx) error {
	if err := s.Auth.Logout(c.Context(), s.sessionToken(c)); err != nil {
		return err
	}
	s.clearCookie(c)
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) me(c fiber.Ctx) error {
	csrf, _ := c.Locals("csrf").(string)
	return c.JSON(meFor(principal(c), csrf))
}

func (s *Server) workspace(c fiber.Ctx) error {
	w, err := s.Svc.Workspace(c.Context(), principal(c))
	if err != nil {
		return err
	}
	return c.JSON(w)
}

func (s *Server) snapshot(c fiber.Ctx) error {
	snap, err := s.Svc.Snapshot(c.Context(), principal(c))
	if err != nil {
		return err
	}
	return c.JSON(snap)
}

func filters(c fiber.Ctx) domain.DashboardFilters {
	return domain.DashboardFilters{DateFrom: c.Query("dateFrom"), DateTo: c.Query("dateTo"), AreaID: c.Query("areaId"), ProjectID: c.Query("projectId"), Position: c.Query("position"), Status: c.Query("status")}
}

func (s *Server) dashboard(c fiber.Ctx) error {
	k, err := s.Svc.Dashboard(c.Context(), principal(c), filters(c))
	if err != nil {
		return err
	}
	return c.JSON(k)
}

func (s *Server) export(c fiber.Ctx) error {
	data, name, err := s.Svc.Export(c.Context(), s.actor(c), pathParam(c, "kind"), filters(c))
	if err != nil {
		return err
	}
	c.Set(fiber.HeaderContentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Set(fiber.HeaderContentDisposition, `attachment; filename="`+name+`"`)
	return c.Send(data)
}

func queryInt(c fiber.Ctx, key string, def int) (int, error) {
	v := c.Query(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, httpx.Validation(map[string]string{key: "Harus berupa angka."})
	}
	return n, nil
}

func (s *Server) listEmployees(c fiber.Ctx) error {
	page, err := queryInt(c, "page", 1)
	if err != nil {
		return err
	}
	size, err := queryInt(c, "pageSize", 25)
	if err != nil {
		return err
	}
	res, err := s.Svc.ListEmployees(c.Context(), principal(c), service.EmployeeQuery{Page: page, PageSize: size, Search: strings.TrimSpace(c.Query("q")),
		AreaID: c.Query("areaId"), ProjectID: c.Query("projectId"), ClientName: c.Query("clientName"), EmploymentStatus: c.Query("employmentStatus"),
		ValidationStatus: c.Query("validationStatus"), ActiveOnly: c.Query("tab") == "active", Sort: c.Query("sort")})
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) createEmployee(c fiber.Ctx) error {
	var in service.EntryInput
	if err := decode(c, &in); err != nil {
		return err
	}
	e, err := s.Svc.CreateEntry(c.Context(), s.actor(c), in)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(e)
}

func (s *Server) getEmployee(c fiber.Ctx) error {
	d, err := s.Svc.GetEmployee(c.Context(), principal(c), pathParam(c, "id"))
	if err != nil {
		return err
	}
	return c.JSON(d)
}

func (s *Server) updateEmployee(c fiber.Ctx) error {
	var in service.EntryInput
	if err := decode(c, &in); err != nil {
		return err
	}
	e, err := s.Svc.UpdateEmployee(c.Context(), s.actor(c), pathParam(c, "id"), in)
	if err != nil {
		return err
	}
	return c.JSON(e)
}

func (s *Server) validateEntry(c fiber.Ctx) error {
	var d service.Decision
	if err := decode(c, &d); err != nil {
		return err
	}
	if err := s.Svc.ValidateEntry(c.Context(), s.actor(c), pathParam(c, "id"), d); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) bulkValidate(c fiber.Ctx) error {
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	n, err := s.Svc.BulkValidateEntries(c.Context(), s.actor(c), in.IDs)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"validated": n})
}

func (s *Server) validateRequest(c fiber.Ctx) error {
	var d service.Decision
	if err := decode(c, &d); err != nil {
		return err
	}
	if err := s.Svc.ValidateChangeRequest(c.Context(), s.actor(c), pathParam(c, "id"), d); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) saveExit(c fiber.Ctx) error {
	var in service.ExitInput
	if err := decode(c, &in); err != nil {
		return err
	}
	x, err := s.Svc.SaveExitRequest(c.Context(), s.actor(c), pathParam(c, "id"), in)
	if err != nil {
		return err
	}
	return c.JSON(x)
}

func (s *Server) saveMovement(c fiber.Ctx) error {
	var in service.MovementInput
	if err := decode(c, &in); err != nil {
		return err
	}
	m, err := s.Svc.SaveMovementRequest(c.Context(), s.actor(c), pathParam(c, "id"), in)
	if err != nil {
		return err
	}
	return c.JSON(m)
}

func (s *Server) reentry(c fiber.Ctx) error {
	var in service.ReentryInput
	if err := decode(c, &in); err != nil {
		return err
	}
	e, err := s.Svc.Reentry(c.Context(), s.actor(c), pathParam(c, "id"), in)
	if err != nil {
		return err
	}
	return c.JSON(e)
}

func (s *Server) addNote(c fiber.Ctx) error {
	var in service.NoteInput
	if err := decode(c, &in); err != nil {
		return err
	}
	if err := s.Svc.AddNote(c.Context(), s.actor(c), pathParam(c, "id"), in); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) setFlag(c fiber.Ctx) error {
	var in service.FlagInput
	if err := decode(c, &in); err != nil {
		return err
	}
	if err := s.Svc.SetFlag(c.Context(), s.actor(c), pathParam(c, "id"), in); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) getNeed(c fiber.Ctx) error {
	d, err := s.Svc.GetNeed(c.Context(), principal(c), pathParam(c, "id"))
	if err != nil {
		return err
	}
	return c.JSON(d)
}

func (s *Server) match(c fiber.Ctx) error {
	var in struct {
		EmployeeID      string `json:"employeeId"`
		ExpectedVersion *int   `json:"expectedVersion"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	n, err := s.Svc.Match(c.Context(), s.actor(c), pathParam(c, "id"), in.EmployeeID, in.ExpectedVersion)
	if err != nil {
		return err
	}
	return c.JSON(n)
}

func (s *Server) fulfill(c fiber.Ctx) error {
	var in struct {
		ExpectedVersion *int `json:"expectedVersion"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	n, err := s.Svc.Fulfill(c.Context(), s.actor(c), pathParam(c, "id"), in.ExpectedVersion)
	if err != nil {
		return err
	}
	return c.JSON(n)
}

func (s *Server) createProject(c fiber.Ctx) error {
	var in service.ProjectInput
	if err := decode(c, &in); err != nil {
		return err
	}
	p, err := s.Svc.SaveProject(c.Context(), s.actor(c), "", in)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(p)
}

func (s *Server) updateProject(c fiber.Ctx) error {
	var in service.ProjectInput
	if err := decode(c, &in); err != nil {
		return err
	}
	p, err := s.Svc.SaveProject(c.Context(), s.actor(c), pathParam(c, "id"), in)
	if err != nil {
		return err
	}
	return c.JSON(p)
}

func (s *Server) projectStatus(c fiber.Ctx) error {
	var in struct {
		Status string `json:"status"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	if err := s.Svc.SetProjectStatus(c.Context(), s.actor(c), pathParam(c, "id"), in.Status); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) saveQuota(c fiber.Ctx) error {
	var in struct {
		Quota int `json:"quota"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	if err := s.Svc.SaveQuota(c.Context(), s.actor(c), pathParam(c, "id"), pathParam(c, "period"), in.Quota); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) importOverview(c fiber.Ctx) error {
	ov, err := s.Svc.ImportOverview(c.Context(), principal(c), c.Query("status"))
	if err != nil {
		return err
	}
	return c.JSON(ov)
}

func (s *Server) importPreview(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return httpx.Validation(map[string]string{"file": "File .xlsx wajib dipilih."})
	}
	if fh.Size > int64(s.Cfg.ImportMaxBytes) {
		return httpx.NewError(fiber.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Ukuran file melebihi batas impor.")
	}
	f, err := fh.Open()
	if err != nil {
		return httpx.BadRequest("File tidak dapat dibaca.")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, int64(s.Cfg.ImportMaxBytes)+1))
	if err != nil {
		return httpx.BadRequest("File tidak dapat dibaca.")
	}
	if len(data) > s.Cfg.ImportMaxBytes {
		return httpx.NewError(fiber.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Ukuran file melebihi batas impor.")
	}
	res, err := s.Svc.PreviewImport(c.Context(), s.actor(c), fh.Filename, data)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

type previewRef struct {
	PreviewID string `json:"previewId"`
}

func (s *Server) importCommit(c fiber.Ctx) error {
	var in previewRef
	if err := decode(c, &in); err != nil {
		return err
	}
	res, err := s.Svc.CommitImport(c.Context(), s.actor(c), in.PreviewID)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) importCancel(c fiber.Ctx) error {
	var in previewRef
	if err := decode(c, &in); err != nil {
		return err
	}
	if err := s.Svc.CancelImport(c.Context(), principal(c), in.PreviewID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) batchExceptions(c fiber.Ctx) error {
	list, err := s.Svc.BatchExceptions(c.Context(), principal(c), pathParam(c, "id"))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"items": list})
}

func (s *Server) decideReview(c fiber.Ctx) error {
	var d service.ReviewDecision
	if err := decode(c, &d); err != nil {
		return err
	}
	if err := s.Svc.DecideReview(c.Context(), s.actor(c), pathParam(c, "id"), d); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) listNotifications(c fiber.Ctx) error {
	p := principal(c)
	if !p.Has(access.ViewNotifications) {
		return c.JSON(fiber.Map{"items": []any{}, "unreadCount": 0, "total": 0})
	}
	limit, err := queryInt(c, "limit", 100)
	if err != nil {
		return err
	}
	offset, err := queryInt(c, "offset", 0)
	if err != nil {
		return err
	}
	res, err := s.Svc.ListNotifications(c.Context(), p, service.NotificationQuery{Limit: limit, Offset: offset, UnreadOnly: c.Query("unread") == "true", Category: c.Query("category")})
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) markNotifications(c fiber.Ctx) error {
	var in struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
		All    bool     `json:"all"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	if in.All {
		if in.Action != "read" || len(in.IDs) > 0 {
			return httpx.BadRequest("all hanya untuk action read tanpa ids.")
		}
		n, err := s.Svc.MarkAllNotificationsRead(c.Context(), principal(c))
		if err != nil {
			return err
		}
		return c.JSON(fiber.Map{"updated": n})
	}
	n, err := s.Svc.MarkNotifications(c.Context(), principal(c), in.IDs, in.Action)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"updated": n})
}

func (s *Server) updateRole(c fiber.Ctx) error {
	var in service.RoleConfigInput
	if err := decode(c, &in); err != nil {
		return err
	}
	cfg, err := s.Svc.UpdateRoleConfig(c.Context(), s.actor(c), pathParam(c, "role"), in)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"permissionConfig": cfg})
}

func (s *Server) resetRoles(c fiber.Ctx) error {
	cfg, err := s.Svc.ResetRoleConfigs(c.Context(), s.actor(c))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"permissionConfig": cfg})
}

func (s *Server) setPolicy(c fiber.Ctx) error {
	var in struct {
		Authority string `json:"authority"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	pol, err := s.Svc.SetValidationPolicy(c.Context(), s.actor(c), pathParam(c, "transaction"), in.Authority)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"validationPolicy": pol})
}

func (s *Server) listUsers(c fiber.Ctx) error {
	list, err := s.Svc.ListUsers(c.Context(), principal(c))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"items": list})
}

func (s *Server) createUser(c fiber.Ctx) error {
	var in service.UserInput
	if err := decode(c, &in); err != nil {
		return err
	}
	id, err := s.Svc.CreateUser(c.Context(), s.actor(c), in)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id})
}

func (s *Server) updateUser(c fiber.Ctx) error {
	var in service.UserInput
	if err := decode(c, &in); err != nil {
		return err
	}
	if err := s.Svc.UpdateUser(c.Context(), s.actor(c), pathParam(c, "id"), in); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
