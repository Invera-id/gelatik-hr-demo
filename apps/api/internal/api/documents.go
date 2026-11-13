package api

import (
	"io"
	"mime"

	"github.com/gofiber/fiber/v3"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/service"
)

func (s *Server) contractMonitoring(c fiber.Ctx) error {
	page, err := queryInt(c, "page", 1)
	if err != nil {
		return err
	}
	size, err := queryInt(c, "pageSize", 50)
	if err != nil {
		return err
	}
	res, err := s.Svc.ContractMonitoring(c.Context(), principal(c), service.ContractFilters{Status: c.Query("status"), AreaID: c.Query("areaId"), ProjectID: c.Query("projectId"), Page: page, PageSize: size})
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) getContractSettings(c fiber.Ctx) error {
	res, err := s.Svc.ContractSettings(c.Context(), principal(c))
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) saveContractSettings(c fiber.Ctx) error {
	var in struct {
		ReminderDays []int `json:"reminderDays"`
	}
	if err := decode(c, &in); err != nil {
		return httpx.Validation(map[string]string{"reminderDays": "Ambang pengingat harus berupa daftar angka hari, contoh: [30, 14, 7]."})
	}
	res, err := s.Svc.SaveContractSettings(c.Context(), s.actor(c), in.ReminderDays)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) compliance(c fiber.Ctx) error {
	res, err := s.Svc.Compliance(c.Context(), principal(c), c.Query("areaId"))
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) documentCatalog(c fiber.Ctx) error {
	res, err := s.Svc.DocumentCatalog(c.Context(), principal(c))
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) saveDocumentType(c fiber.Ctx) error {
	var in service.DocumentTypeInput
	if err := decode(c, &in); err != nil {
		return err
	}
	res, err := s.Svc.SaveDocumentType(c.Context(), s.actor(c), pathParam(c, "code"), in)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) saveDocumentRequirements(c fiber.Ctx) error {
	var in struct {
		DocumentTypeCodes []string `json:"documentTypeCodes"`
	}
	if err := decode(c, &in); err != nil {
		return err
	}
	res, err := s.Svc.SaveDocumentRequirements(c.Context(), s.actor(c), pathParam(c, "transaction"), in.DocumentTypeCodes)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) employeeDocuments(c fiber.Ctx) error {
	res, err := s.Svc.EmployeeDocuments(c.Context(), principal(c), pathParam(c, "id"))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"subjects": res})
}

func (s *Server) employeeDocumentStatus(c fiber.Ctx) error {
	res, err := s.Svc.EmployeeDocumentStatus(c.Context(), principal(c), c.Query("areaId"))
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) validationReadiness(c fiber.Ctx) error {
	res, err := s.Svc.ValidationReadiness(c.Context(), principal(c))
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) documentQueue(c fiber.Ctx) error {
	res, err := s.Svc.DocumentQueue(c.Context(), principal(c), c.Query("status"), c.Query("areaId"))
	if err != nil {
		return err
	}
	return c.JSON(res)
}

func (s *Server) uploadDocument(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return httpx.Validation(map[string]string{"file": "Pilih file dokumen yang akan diunggah."})
	}
	tooLarge := httpx.NewError(fiber.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Ukuran file melebihi batas unggah dokumen.")
	if fh.Size > int64(s.Svc.DocMaxBytes) {
		return tooLarge
	}
	f, err := fh.Open()
	if err != nil {
		return httpx.BadRequest("File tidak dapat dibaca.")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, int64(s.Svc.DocMaxBytes)+1))
	if err != nil {
		return httpx.BadRequest("File tidak dapat dibaca.")
	}
	if len(data) > s.Svc.DocMaxBytes {
		return tooLarge
	}
	res, err := s.Svc.UploadDocument(c.Context(), s.actor(c), service.UploadInput{SubjectType: pathParam(c, "subjectType"), SubjectID: pathParam(c, "subjectId"),
		DocumentType: pathParam(c, "documentType"), FileName: fh.Filename, Data: data})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(res)
}

func (s *Server) reviewDocument(c fiber.Ctx) error {
	var in service.DocumentReview
	if err := decode(c, &in); err != nil {
		return err
	}
	res, err := s.Svc.ReviewDocument(c.Context(), s.actor(c), pathParam(c, "id"), in)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

// documentContent streams a private file. Files are always downloaded as attachments,
// never cached, and typed from the server-verified content type.
func (s *Server) documentContent(c fiber.Ctx) error {
	f, err := s.Svc.OpenDocument(c.Context(), s.actor(c), pathParam(c, "id"))
	if err != nil {
		return err
	}
	defer f.Body.Close()
	data, err := io.ReadAll(io.LimitReader(f.Body, f.Size+1))
	if err != nil {
		return err
	}
	c.Set(fiber.HeaderContentType, f.ContentType)
	c.Set(fiber.HeaderContentDisposition, mime.FormatMediaType("attachment", map[string]string{"filename": f.Name}))
	c.Set(fiber.HeaderCacheControl, "private, no-store")
	c.Set("X-Content-Type-Options", "nosniff")
	return c.Send(data)
}
