package service

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

// Validation readiness: a pre-check of every submitted entry so HR can see, before
// validating, which records need attention and why, without opening each one. It only
// reports rules and data that already exist (bulk-validation exclusions, the document
// gate, import warnings, contract state); it adds no new business rule.

const (
	IssuePlacement = "PLACEMENT_INCOMPLETE" // blocks bulk validation
	IssueReview    = "IMPORT_REVIEW"        // blocks bulk validation
	IssueDocuments = "DOCUMENTS_INCOMPLETE" // blocks final validation
	IssueWarning   = "IMPORT_WARNING"       // informational: value kept raw at import
	IssueContract  = "CONTRACT_CHECK"       // informational: contract data incomplete or already ended
)

const readinessIssuesPerItem = 20

type ReadinessIssue struct {
	Code      string `json:"code"`
	Blocking  bool   `json:"blocking"`
	Message   string `json:"message"`
	RowNumber *int   `json:"rowNumber,omitempty"`
	Column    string `json:"column,omitempty"`
	RawValue  string `json:"rawValue,omitempty"`
}

type ReadinessItem struct {
	EmployeeID string           `json:"employeeId"`
	Issues     []ReadinessIssue `json:"issues"`
}

type ReadinessCount struct {
	Code     string `json:"code"`
	Blocking bool   `json:"blocking"`
	Count    int    `json:"count"` // personnel
}

type ColumnCount struct {
	Column string `json:"column"`
	Count  int    `json:"count"` // personnel
}

type ValidationReadiness struct {
	BusinessDate string           `json:"businessDate"`
	Total        int              `json:"total"`      // submitted entries in scope
	Ready        int              `json:"ready"`      // no issue at all
	NeedsCheck   int              `json:"needsCheck"` // informational issues only
	Blocked      int              `json:"blocked"`    // at least one blocking issue
	Issues       []ReadinessCount `json:"issues"`
	Columns      []ColumnCount    `json:"warningColumns"`
	Items        []ReadinessItem  `json:"items"` // only entries with issues
}

func (s *Service) ValidationReadiness(ctx context.Context, p *access.Principal) (*ValidationReadiness, error) {
	if err := require(p, access.ViewEmployee, access.ValidateEntryEdit); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, employeeSelect+` WHERE p.record_status = 'SUBMITTED' AND ($1::text[] IS NULL OR p.area_id = ANY($1)) ORDER BY p.id`, scopeArgs(p))
	if err != nil {
		return nil, err
	}
	emps, err := collectEmployees(rows, false)
	if err != nil {
		return nil, err
	}
	st, err := loadContractSettings(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	docs, err := s.documentQueue(ctx, p, "")
	if err != nil {
		return nil, err
	}
	docIncomplete := map[string]DocumentQueueItem{}
	for _, d := range docs {
		if d.SubjectType == SubjectEntry && d.RequiredTotal > 0 && !d.Complete {
			docIncomplete[d.SubjectID] = d
		}
	}
	warnings, err := s.importWarnings(ctx, emps)
	if err != nil {
		return nil, err
	}

	today := s.Today()
	res := &ValidationReadiness{BusinessDate: today, Total: len(emps), Issues: []ReadinessCount{}, Columns: []ColumnCount{}, Items: []ReadinessItem{}}
	counts := map[string]int{}
	columns := map[string]int{}
	for _, e := range emps {
		var issues []ReadinessIssue
		add := func(i ReadinessIssue) {
			if len(issues) < readinessIssuesPerItem {
				issues = append(issues, i)
			}
		}
		seen := map[string]bool{}
		mark := func(code string) {
			if !seen[code] {
				seen[code] = true
				counts[code]++
			}
		}
		if !domain.HasCompletePlacement(e.AreaID, e.ProjectID, e.Position) {
			mark(IssuePlacement)
			add(ReadinessIssue{Code: IssuePlacement, Blocking: true, Message: "Area, project, atau posisi belum lengkap."})
		}
		if e.ConditionStatus == "NEEDS_REVIEW" {
			mark(IssueReview)
			add(ReadinessIssue{Code: IssueReview, Blocking: true, Message: "Masih ada catatan import yang perlu ditinjau (antrean review import)."})
		}
		if d, ok := docIncomplete[e.ID]; ok {
			mark(IssueDocuments)
			add(ReadinessIssue{Code: IssueDocuments, Blocking: true, Message: docMessage(d)})
		}
		if cs := domain.EvaluateContract(e, today, st.ReminderDays); cs.Status == domain.ContractIncomplete || cs.Status == domain.ContractExpired {
			mark(IssueContract)
			msg := "Kontrak sudah berakhir sebelum tanggal bisnis."
			if cs.Status == domain.ContractIncomplete {
				msg = "Data kontrak belum lengkap"
				if cs.IncompleteReason != nil {
					msg += ": " + *cs.IncompleteReason
				}
			}
			add(ReadinessIssue{Code: IssueContract, Message: msg})
		}
		cols := map[string]bool{}
		for _, w := range warnings[e.ID] {
			mark(IssueWarning)
			if !cols[w.Column] {
				cols[w.Column] = true
				columns[w.Column]++
			}
			row := w.RowNumber
			add(ReadinessIssue{Code: IssueWarning, Message: w.Reason, RowNumber: &row, Column: w.Column, RawValue: w.RawValue})
		}
		blocking := seen[IssuePlacement] || seen[IssueReview] || seen[IssueDocuments]
		switch {
		case len(seen) == 0:
			res.Ready++
			continue
		case blocking:
			res.Blocked++
		default:
			res.NeedsCheck++
		}
		res.Items = append(res.Items, ReadinessItem{EmployeeID: e.ID, Issues: issues})
	}
	for _, code := range []string{IssuePlacement, IssueReview, IssueDocuments, IssueWarning, IssueContract} {
		if counts[code] > 0 {
			res.Issues = append(res.Issues, ReadinessCount{Code: code, Blocking: code == IssuePlacement || code == IssueReview || code == IssueDocuments, Count: counts[code]})
		}
	}
	for c, n := range columns {
		res.Columns = append(res.Columns, ColumnCount{Column: c, Count: n})
	}
	sort.Slice(res.Columns, func(i, j int) bool {
		if res.Columns[i].Count != res.Columns[j].Count {
			return res.Columns[i].Count > res.Columns[j].Count
		}
		return res.Columns[i].Column < res.Columns[j].Column
	})
	return res, nil
}

func docMessage(d DocumentQueueItem) string {
	return "Dokumen wajib belum lengkap: " + strconv.Itoa(d.RequiredOK) + " dari " + strconv.Itoa(d.RequiredTotal) + " diterima."
}

// importWarnings returns the import warnings (row + column) of every source record that
// belongs to the given personnel, keyed by personnel id.
func (s *Service) importWarnings(ctx context.Context, emps []domain.Employee) (map[string][]imports.FieldIssue, error) {
	out := map[string][]imports.FieldIssue{}
	if len(emps) == 0 {
		return out, nil
	}
	byKey := map[string]string{}
	keys := make([]string, 0, len(emps))
	for _, e := range emps {
		k := imports.BusinessKey(e.PersonnelID)
		byKey[k] = e.ID
		keys = append(keys, k)
	}
	rows, err := s.Pool.Query(ctx, `SELECT business_key, warnings FROM import_source_records
		WHERE business_key = ANY($1) AND jsonb_array_length(warnings) > 0 ORDER BY business_key, row_number`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		var ws []imports.FieldIssue
		if err := json.Unmarshal(raw, &ws); err != nil {
			return nil, err
		}
		id := byKey[key]
		out[id] = append(out[id], ws...)
	}
	return out, rows.Err()
}
