package service

import (
	"context"
	"slices"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

// Employee document warnings: active employees in scope without an accepted PKWT (the
// employee document required by migration 0004 under TxEmployeeFile). Warning only; it
// never blocks validation.

type EmployeeDocumentGap struct {
	EmployeeID string   `json:"employeeId"`
	Missing    []string `json:"missing"`  // no file uploaded
	Pending    []string `json:"pending"`  // uploaded, waiting for review
	Rejected   []string `json:"rejected"` // rejected, needs a new file
}

type EmployeeDocumentSummary struct {
	Monitored  int `json:"monitored"`  // active employees in scope
	Incomplete int `json:"incomplete"` // employees with any gap
	Missing    int `json:"missing"`    // employees with a required document not uploaded
	Pending    int `json:"pending"`    // employees with a document waiting for review
	Rejected   int `json:"rejected"`   // employees with a rejected document
}

type EmployeeDocumentStatus struct {
	EmployeeDocumentSummary
	Required []DocumentType        `json:"required"`
	Items    []EmployeeDocumentGap `json:"items"` // only incomplete employees
}

func (s *Service) EmployeeDocumentStatus(ctx context.Context, p *access.Principal, areaID string) (*EmployeeDocumentStatus, error) {
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	if areaID != "" && !p.CoversArea(&areaID) {
		return nil, httpx.Forbidden()
	}
	types, req, err := loadCatalog(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	res := &EmployeeDocumentStatus{Required: []DocumentType{}, Items: []EmployeeDocumentGap{}}
	codes := req[TxEmployeeFile]
	for _, t := range types {
		if slices.Contains(codes, t.Code) {
			res.Required = append(res.Required, t)
		}
	}
	scope := scopeArgs(p)
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM personnel WHERE employment_status = 'ACTIVE' AND ($1::text[] IS NULL OR area_id = ANY($1)) AND ($2 = '' OR area_id = $2)`, scope, areaID).Scan(&res.Monitored); err != nil {
		return nil, err
	}
	if len(codes) == 0 {
		return res, nil
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT p.id, r.code, v.review_status
		FROM personnel p
		CROSS JOIN unnest($2::text[]) AS r(code)
		LEFT JOIN document_versions v ON v.subject_type = 'PERSONNEL' AND v.subject_id = p.id AND v.document_type_code = r.code AND v.superseded_at IS NULL
		WHERE p.employment_status = 'ACTIVE' AND ($1::text[] IS NULL OR p.area_id = ANY($1)) AND ($3 = '' OR p.area_id = $3) AND v.review_status IS DISTINCT FROM 'ACCEPTED'
		ORDER BY p.id, r.code`, scope, codes, areaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, code string
		var status *string
		if err := rows.Scan(&id, &code, &status); err != nil {
			return nil, err
		}
		if n := len(res.Items); n == 0 || res.Items[n-1].EmployeeID != id {
			res.Items = append(res.Items, EmployeeDocumentGap{EmployeeID: id, Missing: []string{}, Pending: []string{}, Rejected: []string{}})
		}
		it := &res.Items[len(res.Items)-1]
		switch {
		case status == nil:
			it.Missing = append(it.Missing, code)
		case *status == "REJECTED":
			it.Rejected = append(it.Rejected, code)
		default:
			it.Pending = append(it.Pending, code)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	res.Incomplete = len(res.Items)
	for _, it := range res.Items {
		if len(it.Missing) > 0 {
			res.Missing++
		}
		if len(it.Pending) > 0 {
			res.Pending++
		}
		if len(it.Rejected) > 0 {
			res.Rejected++
		}
	}
	return res, nil
}
