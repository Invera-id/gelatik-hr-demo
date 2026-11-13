package imports

import (
	"fmt"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
)

// Existing state relevant to the business keys present in a file (loaded inside the commit lock).
type ExistingMaster struct {
	ID          string
	BusinessKey string
	AreaID      *string
	Fields      Fields
	Version     int
}

type ExistingSource struct {
	ID          string
	BusinessKey string
	Fingerprint string
	RowNumber   int
	Fields      Fields
}

type ExistingReview struct {
	ID        string
	Status    string
	CreatedAt string
}

type RefArea struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type RefProject struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	ClientName string  `json:"clientName"`
	AreaID     string  `json:"areaId"`
	SubArea    *string `json:"subArea"`
}

type Existing struct {
	Masters map[string]ExistingMaster
	Sources map[string][]ExistingSource // by business key
	Reviews map[string]ExistingReview   // by id, for the business keys in the file
	// OtherPendingReviews counts pending items of identities not present in the file.
	OtherPendingReviews int
	Areas               []RefArea
	Projects            []RefProject
}

type Options struct {
	BatchID   string
	FileName  string
	CreatedBy string
	Now       string
	// AllowedAreaIDs nil means all-area scope.
	AllowedAreaIDs []string
}

type MasterPlan struct {
	ID              string             `json:"id"`
	BusinessKey     string             `json:"businessKey"`
	PersonnelID     string             `json:"personnelId"`
	Name            string             `json:"name"`
	NationalID      *string            `json:"nationalId"`
	AreaID          *string            `json:"areaId"`
	ProjectID       *string            `json:"projectId"`
	SubArea         *string            `json:"subArea"`
	Position        *string            `json:"position"`
	JoinDate        *string            `json:"joinDate"`
	ContractStart   *string            `json:"contractStartDate"`
	ContractEnd     *string            `json:"contractEndDate"`
	ExitDate        *string            `json:"exitDate"`
	ExitReason      *string            `json:"exitReason"`
	Employment      string             `json:"employmentStatus"`
	ConditionStatus string             `json:"conditionStatus"`
	Profile         map[string]*string `json:"profile"`
	Fingerprint     string             `json:"fingerprint"`
}

type SourcePlan struct {
	ID                   string         `json:"id"`
	BusinessKey          string         `json:"businessKey"`
	PersonnelID          string         `json:"personnelId"`
	Name                 string         `json:"name"`
	RowNumber            int            `json:"rowNumber"`
	Raw                  map[string]any `json:"raw"`
	Fields               Fields         `json:"fields"`
	Structured           Structured     `json:"structured"`
	Fingerprint          string         `json:"fingerprint"`
	Warnings             []FieldIssue   `json:"warnings"`
	ReconciliationStatus string         `json:"reconciliationStatus"`
	AreaID               *string        `json:"areaId"`
}

type Candidate struct {
	Label        string `json:"label"`
	MovementType string `json:"movementType,omitempty"`
	Note         string `json:"note"`
}

type ReviewPlan struct {
	ID                  string     `json:"id"`
	Preserve            bool       `json:"preserve"` // already decided: only refresh linkage
	BusinessKey         string     `json:"businessKey"`
	PersonnelID         string     `json:"personnelId"`
	PersonnelName       string     `json:"personnelName"`
	Kind                string     `json:"kind"`
	Aspects             []string   `json:"aspects"`
	AreaID              *string    `json:"areaId"`
	RecordIDs           []string   `json:"recordIds"`
	CurrentMasterFields Fields     `json:"currentMasterFields"`
	DiffFields          []string   `json:"diffFields"`
	Dates               []DateFact `json:"dates"`
	RowNumbers          []int      `json:"rowNumbers"`
	Reason              string     `json:"reason"`
	Candidate           *Candidate `json:"candidate"`
}

type ExceptionPlan struct {
	ID        string            `json:"id"`
	RowNumber int               `json:"rowNumber"`
	Reason    string            `json:"reason"`
	RawValues map[string]string `json:"rawValues"`
}

type ExcludedRow struct {
	RowNumber   int    `json:"rowNumber"`
	PersonnelID string `json:"personnelId"`
	Name        string `json:"name"`
	AreaName    string `json:"areaName"`
	Message     string `json:"message"`
}

type Summary struct {
	FileName              string `json:"fileName"`
	SheetName             string `json:"sheetName"`
	NonEmptyRows          int    `json:"nonEmptyRows"`
	UniqueIdentities      int    `json:"uniqueIdentities"`
	NewMasters            int    `json:"newMasters"`
	NewSourceRecords      int    `json:"newSourceRecords"`
	IdenticalDuplicates   int    `json:"identicalDuplicates"`
	MovementCandidates    int    `json:"movementCandidates"`
	ExitReentryCandidates int    `json:"exitReentryCandidates"`
	AmbiguousCases        int    `json:"ambiguousCases"`
	IdentityConflicts     int    `json:"identityConflicts"`
	ConfirmedEvents       int    `json:"confirmedEvents"`
	WarningRows           int    `json:"warningRows"`
	ExceptionRows         int    `json:"exceptionRows"`
	OutOfScopeRows        int    `json:"outOfScopeRows"`
	BlankRowsSkipped      int    `json:"blankRowsSkipped"`
	PendingReviewItems    int    `json:"pendingReviewItems"`
}

type ScopePreview struct {
	ValidInScopeRows  int           `json:"validInScopeRows"`
	WarningReviewRows int           `json:"warningReviewRows"`
	ErrorRows         int           `json:"errorRows"`
	OutOfScopeRows    int           `json:"outOfScopeRows"`
	ExcludedRows      []ExcludedRow `json:"excludedRows"`
}

type Plan struct {
	BatchID      string          `json:"batchId"`
	FileName     string          `json:"fileName"`
	SheetName    string          `json:"sheetName"`
	NewAreas     []RefArea       `json:"newAreas"`
	NewProjects  []RefProject    `json:"newProjects"`
	Masters      []MasterPlan    `json:"masters"`
	Sources      []SourcePlan    `json:"sources"`
	Reviews      []ReviewPlan    `json:"reviews"`
	Exceptions   []ExceptionPlan `json:"exceptions"`
	Summary      Summary         `json:"summary"`
	Status       string          `json:"status"`
	ScopePreview ScopePreview    `json:"scopePreview"`
	BusinessKeys []string        `json:"businessKeys"`
}

// NameKey normalizes reference labels (trim, collapse spaces, upper-case).
func NameKey(s string) string {
	return strings.ToUpper(strings.Join(strings.Fields(s), " "))
}

func stableHash(s string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return strconv.FormatUint(h.Sum64(), 36)
}

const outOfScopeMessage = "Di luar cakupan area — tidak diimpor."

// Reconcile computes the full change set for an import without touching storage.
// Out-of-scope rows are excluded before reference discovery, so they can never
// create areas or projects, and existing masters outside the importer's scope are
// never disclosed through review items.
func Reconcile(ex Existing, parsed *ParseResult, opt Options) *Plan {
	p := &Plan{BatchID: opt.BatchID, FileName: opt.FileName, SheetName: parsed.SheetName}
	allowed := map[string]bool{}
	for _, id := range opt.AllowedAreaIDs {
		allowed[id] = true
	}
	allAreas := opt.AllowedAreaIDs == nil
	areaByKey := map[string]*RefArea{}
	for i := range ex.Areas {
		areaByKey[NameKey(ex.Areas[i].Name)] = &ex.Areas[i]
	}
	addException := func(row int, reason string, raw map[string]string) {
		p.Exceptions = append(p.Exceptions, ExceptionPlan{ID: fmt.Sprintf("exc-%s-%d-%d", opt.BatchID, row, len(p.Exceptions)), RowNumber: row, Reason: reason, RawValues: raw})
	}
	for _, e := range parsed.Exceptions {
		addException(e.RowNumber, e.Reason, e.RawValues)
	}

	// 1. Area scope, applied before anything can create references.
	var kept []ParsedRecord
	for _, r := range parsed.Records {
		areaName := strings.TrimSpace(r.Fields.Get("areaCbs"))
		if allAreas {
			kept = append(kept, r)
			continue
		}
		if areaName == "" {
			addException(r.RowNumber, "Area tidak dapat dipetakan. Baris tidak diimpor.", r.RawValues)
			continue
		}
		area := areaByKey[NameKey(areaName)]
		if area == nil || !allowed[area.ID] {
			p.ScopePreview.ExcludedRows = append(p.ScopePreview.ExcludedRows, ExcludedRow{RowNumber: r.RowNumber, PersonnelID: r.PersonnelID, Name: r.Name, AreaName: areaName, Message: outOfScopeMessage})
			continue
		}
		if m, ok := ex.Masters[r.BusinessKey]; ok && (m.AreaID == nil || !allowed[*m.AreaID]) {
			// The person already exists outside this importer's scope: do not reveal or touch it.
			p.ScopePreview.ExcludedRows = append(p.ScopePreview.ExcludedRows, ExcludedRow{RowNumber: r.RowNumber, PersonnelID: r.PersonnelID, Name: r.Name, AreaName: areaName, Message: outOfScopeMessage})
			continue
		}
		kept = append(kept, r)
	}
	scoped := &ParseResult{SheetName: parsed.SheetName, Records: kept}

	// 2. Reference discovery from in-scope rows only.
	projectByKey := map[string]*RefProject{}
	for i := range ex.Projects {
		projectByKey[ex.Projects[i].AreaID+"|"+NameKey(ex.Projects[i].Name)] = &ex.Projects[i]
	}
	for _, r := range kept {
		areaName := strings.TrimSpace(r.Fields.Get("areaCbs"))
		if areaName == "" {
			continue
		}
		key := NameKey(areaName)
		area := areaByKey[key]
		if area == nil {
			na := RefArea{ID: "import-area-" + stableHash(key), Name: areaName}
			p.NewAreas = append(p.NewAreas, na)
			area = &na
			areaByKey[key] = area
		}
		projectName := strings.TrimSpace(r.Fields.Get("projectName"))
		if projectName == "" {
			continue
		}
		pk := area.ID + "|" + NameKey(projectName)
		if projectByKey[pk] != nil {
			continue
		}
		client := strings.TrimSpace(r.Fields.Get("clientName"))
		if client == "" {
			client = "Belum tersedia"
		}
		var sub *string
		if s := strings.TrimSpace(r.Fields.Get("subArea")); s != "" {
			sub = &s
		}
		np := RefProject{ID: "import-project-" + stableHash(pk), Name: projectName, ClientName: client, AreaID: area.ID, SubArea: sub}
		p.NewProjects = append(p.NewProjects, np)
		projectByKey[pk] = &np
	}
	findArea := func(name string) *string {
		if a := areaByKey[NameKey(name)]; a != nil && strings.TrimSpace(name) != "" {
			id := a.ID
			return &id
		}
		return nil
	}
	findProject := func(name string, areaID *string) *string {
		if strings.TrimSpace(name) == "" || areaID == nil {
			return nil
		}
		if pr := projectByKey[*areaID+"|"+NameKey(name)]; pr != nil {
			id := pr.ID
			return &id
		}
		return nil
	}

	// 3. Per-identity reconciliation.
	order, groups := scoped.Groups()
	p.BusinessKeys = order
	sm := &p.Summary
	sm.IdenticalDuplicates = parsed.IdenticalDuplicatesInFile
	existingSourceIDs := map[string]bool{}
	for _, list := range ex.Sources {
		for _, s := range list {
			existingSourceIDs[s.ID] = true
		}
	}
	touched := map[string]bool{}
	for _, key := range order {
		group := groups[key]
		prior, hasPrior := ex.Masters[key]
		allKnown := true
		for _, r := range group {
			if !existingSourceIDs[r.BusinessKey+":"+r.Fingerprint] {
				allKnown = false
			}
		}
		if allKnown {
			sm.IdenticalDuplicates += len(group)
			continue
		}
		var combined []ClassifyRecord
		if hasPrior {
			combined = append(combined, ClassifyRecord{ID: "master:" + key, Fingerprint: Fingerprint(prior.Fields), Fields: prior.Fields})
		}
		for _, s := range ex.Sources[key] {
			combined = append(combined, ClassifyRecord{ID: s.ID, Fingerprint: s.Fingerprint, RowNumber: s.RowNumber, Fields: s.Fields})
		}
		for _, r := range group {
			combined = append(combined, ClassifyRecord{ID: r.BusinessKey + ":" + r.Fingerprint, Fingerprint: r.Fingerprint, RowNumber: r.RowNumber, Fields: r.Fields})
		}
		analysis := ClassifyGroup(combined)
		representative := group[0]
		for _, r := range group {
			if r.Fields.Get("exitDate") == "" {
				representative = r
				break
			}
		}
		areaID := findArea(representative.Fields.Get("areaCbs"))
		projectID := findProject(representative.Fields.Get("projectName"), areaID)
		unknownPlacement := areaID == nil || projectID == nil || representative.Fields.Get("position") == "" || representative.Fields.Get("joinDate") == ""
		route := "IDENTICAL"
		switch {
		case analysis.IdentityConflict:
			route = "CONFLICT"
		case len(analysis.Aspects) > 0 || analysis.AutoConfirmable != nil || unknownPlacement:
			route = "REVIEW"
		}
		status := "PENDING_REVIEW"
		if route == "IDENTICAL" {
			status = "IDENTICAL"
		}
		reviewArea := areaID
		if hasPrior {
			reviewArea = prior.AreaID
		}
		for _, r := range group {
			id := r.BusinessKey + ":" + r.Fingerprint
			if existingSourceIDs[id] {
				sm.IdenticalDuplicates++
				continue
			}
			p.Sources = append(p.Sources, SourcePlan{ID: id, BusinessKey: key, PersonnelID: r.PersonnelID, Name: r.Name, RowNumber: r.RowNumber,
				Raw: r.Raw, Fields: r.Fields, Structured: r.Structured, Fingerprint: r.Fingerprint, Warnings: r.Warnings, ReconciliationStatus: status, AreaID: reviewArea})
			sm.NewSourceRecords++
		}
		if !hasPrior {
			cond := "CONFIRMED"
			if route != "IDENTICAL" || analysis.NeedsReview || unknownPlacement {
				cond = "NEEDS_REVIEW"
			}
			f := representative.Fields
			employment := "ACTIVE"
			if f.Get("exitDate") != "" {
				employment = "INACTIVE"
			}
			profile := map[string]*string{}
			for k, v := range f {
				if !EmployeeFieldKeys[k] {
					profile[k] = v
				}
			}
			contractStart := f["contractStartDate"]
			if contractStart == nil {
				contractStart = f["joinDate"]
			}
			p.Masters = append(p.Masters, MasterPlan{ID: "personnel-" + key, BusinessKey: key, PersonnelID: representative.PersonnelID, Name: representative.Name,
				NationalID: f["nationalId"], AreaID: areaID, ProjectID: projectID, SubArea: f["subArea"], Position: f["position"], JoinDate: f["joinDate"],
				ContractStart: contractStart, ContractEnd: f["contractEndDate"], ExitDate: f["exitDate"], ExitReason: f["exitReason"],
				Employment: employment, ConditionStatus: cond, Profile: profile, Fingerprint: representative.Fingerprint})
			sm.NewMasters++
		}
		if route == "IDENTICAL" {
			continue
		}
		var fps, recordIDs []string
		for _, d := range analysis.Distinct {
			fps = append(fps, d.Fingerprint)
			recordIDs = append(recordIDs, d.ID)
		}
		rowSet := map[int]bool{}
		var rows []int
		for _, r := range group {
			if !rowSet[r.RowNumber] {
				rowSet[r.RowNumber] = true
				rows = append(rows, r.RowNumber)
			}
		}
		sort.Ints(rows)
		var current Fields
		if hasPrior {
			current = prior.Fields
		}
		emit := func(kind string, aspects []string, reason string, dates []DateFact, cand *Candidate) {
			id := "rv:" + key + ":" + kind + ":" + ContentHash(fps)
			touched[id] = true
			prev, seen := ex.Reviews[id]
			p.Reviews = append(p.Reviews, ReviewPlan{ID: id, Preserve: seen && prev.Status != "PENDING", BusinessKey: key, PersonnelID: group[0].PersonnelID,
				PersonnelName: group[len(group)-1].Name, Kind: kind, Aspects: aspects, AreaID: reviewArea, RecordIDs: recordIDs, CurrentMasterFields: current,
				DiffFields: analysis.DiffFields, Dates: dates, RowNumbers: rows, Reason: reason, Candidate: cand})
		}
		if route == "CONFLICT" {
			sm.IdentityConflicts++
			emit("IDENTITY_CONFLICT", []string{"IDENTITY_CONFLICT"},
				fmt.Sprintf("ID %s memiliki NoKTP lengkap berbeda (%s). Tidak digabung otomatis.", group[0].PersonnelID, strings.Join(analysis.ConflictingKTPs, " vs ")),
				[]DateFact{}, &Candidate{Label: "Konflik identitas — perlu peninjauan", Note: "Jangan gabungkan tanpa kebijakan bisnis."})
			continue
		}
		var kinds, reasons, notes []string
		var dates []DateFact
		seenDate := map[string]bool{}
		for _, as := range analysis.Aspects {
			kinds = append(kinds, as.Kind)
			reasons = append(reasons, as.Reason)
			notes = append(notes, as.CandidateNote)
			for _, d := range as.Dates {
				k := d.Label + ":" + *d.Value
				if !seenDate[k] {
					seenDate[k] = true
					dates = append(dates, d)
				}
			}
		}
		if contains(kinds, "PLACEMENT_CHANGE") {
			sm.MovementCandidates++
		}
		if contains(kinds, "EXIT") || contains(kinds, "REENTRY") {
			sm.ExitReentryCandidates++
		}
		if !contains(kinds, "PLACEMENT_CHANGE") && !contains(kinds, "EXIT") && !contains(kinds, "REENTRY") {
			sm.AmbiguousCases++
		}
		cand := &Candidate{Label: "Perlu ditinjau", Note: strings.Join(notes, " ")}
		if len(analysis.Aspects) > 0 {
			cand.Label = analysis.Aspects[0].CandidateNote
		}
		if analysis.AutoConfirmable != nil {
			cand.MovementType = analysis.AutoConfirmable.MovementType
		}
		if dates == nil {
			dates = []DateFact{}
		}
		if unknownPlacement && len(kinds) == 0 {
			emit("UNDETERMINED", []string{"UNDETERMINED"}, "Area atau Project belum dikenal pada master referensi. Perlu pemetaan manual.", dates, cand)
		} else {
			emit(analysis.PrimaryKind, kinds, strings.Join(reasons, " "), dates, cand)
		}
	}

	warningRows := map[int]bool{}
	for _, r := range kept {
		if len(r.Warnings) > 0 {
			sm.WarningRows++
		}
	}
	for _, s := range p.Sources {
		if len(s.Warnings) > 0 {
			warningRows[s.RowNumber] = true
		}
	}
	pending := 0
	for _, r := range p.Reviews {
		if !r.Preserve {
			pending++
		} else if st := ex.Reviews[r.ID].Status; st == "KEPT_PENDING" {
			pending++
		}
	}
	for id, r := range ex.Reviews {
		if !touched[id] && (r.Status == "PENDING" || r.Status == "KEPT_PENDING") {
			pending++
		}
	}
	pending += ex.OtherPendingReviews
	sm.FileName, sm.SheetName = opt.FileName, parsed.SheetName
	sm.NonEmptyRows = parsed.NonEmptyRows
	sm.UniqueIdentities = len(order)
	sm.ExceptionRows = len(p.Exceptions)
	sm.BlankRowsSkipped = parsed.BlankRowsSkipped
	sm.PendingReviewItems = pending
	sm.OutOfScopeRows = len(p.ScopePreview.ExcludedRows)
	switch {
	case len(p.Exceptions) > 0:
		p.Status = "COMPLETED_WITH_EXCEPTIONS"
	case pending > 0:
		p.Status = "COMPLETED_WITH_REVIEW"
	case sm.WarningRows > 0:
		p.Status = "COMPLETED_WITH_WARNINGS"
	default:
		p.Status = "COMPLETED"
	}
	reviewRows := map[int]bool{}
	for _, r := range p.Reviews {
		for _, n := range r.RowNumbers {
			reviewRows[n] = true
		}
	}
	for n := range warningRows {
		reviewRows[n] = true
	}
	p.ScopePreview.WarningReviewRows = len(reviewRows)
	p.ScopePreview.ValidInScopeRows = max(0, len(kept)-len(reviewRows))
	p.ScopePreview.ErrorRows = len(p.Exceptions)
	p.ScopePreview.OutOfScopeRows = len(p.ScopePreview.ExcludedRows)
	if p.ScopePreview.ExcludedRows == nil {
		p.ScopePreview.ExcludedRows = []ExcludedRow{}
	}
	return p
}
