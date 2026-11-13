package imports

import (
	"regexp"
	"sort"
	"strings"
)

var placementFields = map[string]bool{"areaCbs": true, "subArea": true, "clientName": true, "projectName": true, "position": true, "teamLeader": true, "outlet": true, "coverageArea": true, "program": true}

// ChangeGroup classifies which kind of change a differing field implies.
func ChangeGroup(field string) string {
	switch {
	case placementFields[field]:
		return "PLACEMENT"
	case field == "exitDate" || field == "exitReason":
		return "EXIT"
	case field == "mutationDate":
		return "MUTATION"
	case field == "joinDate" || field == "contractStartDate" || field == "contractEndDate":
		return "EMPLOYMENT"
	case field == "personnelId" || field == "name" || field == "nationalId":
		return "IDENTITY"
	}
	return "PROFILE"
}

type ClassifyRecord struct {
	ID          string
	Fingerprint string
	RowNumber   int
	Fields      Fields
}

type DateFact struct {
	Label string  `json:"label"`
	Value *string `json:"value"`
}

type AutoEvent struct {
	MovementType   string
	EffectiveDate  string
	BeforeRecordID string
	AfterRecordID  string
	Note           string
}

type Aspect struct {
	Kind          string
	DiffFields    []string
	Dates         []DateFact
	Reason        string
	CandidateNote string
}

type GroupAnalysis struct {
	Distinct         []ClassifyRecord
	IdentityConflict bool
	ConflictingKTPs  []string
	Aspects          []Aspect
	AutoConfirmable  *AutoEvent
	NeedsReview      bool
	PrimaryKind      string
	DiffFields       []string
}

var completeKTP = regexp.MustCompile(`^\d{15,16}$`)

var dateLabels = [][2]string{{"joinDate", "Tanggal Bergabung"}, {"contractStartDate", "Tanggal Kontrak"}, {"contractEndDate", "Tanggal Berakhir Kontrak"}, {"mutationDate", "Tanggal Mutasi"}, {"exitDate", "Tanggal Keluar"}}

func collectDates(records []ClassifyRecord, keys ...string) []DateFact {
	var facts []DateFact
	for _, dl := range dateLabels {
		if !contains(keys, dl[0]) {
			continue
		}
		seen := map[string]bool{}
		for _, r := range records {
			if v := r.Fields.Get(dl[0]); v != "" && !seen[v] {
				seen[v] = true
				facts = append(facts, DateFact{Label: dl[1], Value: sp(v)})
			}
		}
	}
	return facts
}

func movementTypeFor(diff []string) string {
	var placement []string
	for _, f := range diff {
		if ChangeGroup(f) == "PLACEMENT" {
			placement = append(placement, f)
		}
	}
	all := func(ok func(string) bool) bool {
		for _, f := range placement {
			if !ok(f) {
				return false
			}
		}
		return true
	}
	switch {
	case all(func(f string) bool { return f == "position" }):
		return "POSITION_CHANGE"
	case all(func(f string) bool { return f == "areaCbs" || f == "subArea" || f == "coverageArea" }):
		return "AREA_CHANGE"
	case all(func(f string) bool {
		return f == "projectName" || f == "clientName" || f == "outlet" || f == "teamLeader"
	}):
		return "PROJECT_CHANGE"
	}
	return "MUTATION"
}

func fieldsThatVary(records []ClassifyRecord) []string {
	keys := map[string]bool{}
	for _, r := range records {
		for k := range r.Fields {
			keys[k] = true
		}
	}
	var varying []string
	for k := range keys {
		values := map[string]bool{}
		for _, r := range records {
			values[strings.TrimSpace(r.Fields.Get(k))] = true
		}
		if len(values) > 1 {
			varying = append(varying, k)
		}
	}
	sort.Strings(varying)
	return varying
}

// ClassifyGroup decides whether same-ID records are an identical duplicate or a
// movement / exit / re-entry / identity conflict. Row order, running numbers,
// file names and import time are never used as chronology evidence.
func ClassifyGroup(records []ClassifyRecord) GroupAnalysis {
	byFP := map[string]bool{}
	var distinct []ClassifyRecord
	for _, r := range records {
		if !byFP[r.Fingerprint] {
			byFP[r.Fingerprint] = true
			distinct = append(distinct, r)
		}
	}
	a := GroupAnalysis{Distinct: distinct, PrimaryKind: "IDENTICAL_DUPLICATE"}
	if len(distinct) <= 1 {
		return a
	}
	ktps := map[string]bool{}
	for _, r := range distinct {
		if v := strings.TrimSpace(r.Fields.Get("nationalId")); completeKTP.MatchString(v) {
			ktps[v] = true
		}
	}
	a.DiffFields = fieldsThatVary(distinct)
	if len(ktps) >= 2 {
		for k := range ktps {
			a.ConflictingKTPs = append(a.ConflictingKTPs, k)
		}
		sort.Strings(a.ConflictingKTPs)
		a.IdentityConflict, a.NeedsReview, a.PrimaryKind = true, true, "IDENTITY_CONFLICT"
		return a
	}
	groups := map[string]bool{}
	var placementDiffs, exitDiffs []string
	for _, f := range a.DiffFields {
		g := ChangeGroup(f)
		groups[g] = true
		if g == "PLACEMENT" {
			placementDiffs = append(placementDiffs, f)
		}
		if g == "EXIT" {
			exitDiffs = append(exitDiffs, f)
		}
	}
	if len(placementDiffs) > 0 {
		a.Aspects = append(a.Aspects, Aspect{Kind: "PLACEMENT_CHANGE", DiffFields: placementDiffs, Dates: collectDates(distinct, "mutationDate", "joinDate", "contractStartDate"),
			Reason: "Penempatan (area/project/posisi) berbeda antar catatan.", CandidateNote: "Kemungkinan mutasi/perubahan penempatan — arah dan tanggal perlu dikonfirmasi."})
	}
	hasAnyExit := false
	for _, r := range distinct {
		if r.Fields.Get("exitDate") != "" || r.Fields.Get("exitReason") != "" {
			hasAnyExit = true
		}
	}
	exitDiffers := len(exitDiffs) > 0
	if hasAnyExit && exitDiffers {
		a.Aspects = append(a.Aspects, Aspect{Kind: "EXIT", DiffFields: exitDiffs, Dates: collectDates(distinct, "exitDate"),
			Reason: "Sebagian catatan memuat Tanggal/Alasan Keluar.", CandidateNote: "Perlu dikonfirmasi: akhir penempatan, akhir hubungan kerja, atau koreksi."})
	}
	maxExit := ""
	for _, r := range distinct {
		if v := r.Fields.Get("exitDate"); v > maxExit {
			maxExit = v
		}
	}
	reentry := false
	if maxExit != "" {
		for _, r := range distinct {
			if r.Fields.Get("joinDate") > maxExit {
				reentry = true
			}
		}
	}
	if reentry {
		a.Aspects = append(a.Aspects, Aspect{Kind: "REENTRY", DiffFields: []string{"joinDate", "exitDate"}, Dates: collectDates(distinct, "exitDate", "joinDate"),
			Reason: "Ada tanggal keluar lalu tanggal bergabung yang lebih kemudian.", CandidateNote: "Kemungkinan re-entry — perlu dikonfirmasi."})
	}
	if len(placementDiffs) == 0 && !(hasAnyExit && exitDiffers) && !reentry && len(a.DiffFields) > 0 {
		a.Aspects = append(a.Aspects, Aspect{Kind: "PROFILE_VARIATION", DiffFields: a.DiffFields, Dates: collectDates(distinct, "joinDate", "contractStartDate", "contractEndDate"),
			Reason: "Variasi data profil/informasi tanpa indikasi perpindahan penempatan.", CandidateNote: "Tandai field yang perlu ditinjau; jangan tentukan nilai terkini dari urutan baris."})
	}
	// Auto-confirm only a clear, source-supported before/after: exactly two records,
	// placement is the only change (besides the mutation date), one record carries it.
	delete(groups, "MUTATION")
	if len(distinct) == 2 && len(groups) == 1 && groups["PLACEMENT"] && !hasAnyExit && !reentry {
		var with, without []ClassifyRecord
		for _, r := range distinct {
			if r.Fields.Get("mutationDate") != "" {
				with = append(with, r)
			} else {
				without = append(without, r)
			}
		}
		if len(with) == 1 && len(without) == 1 {
			a.AutoConfirmable = &AutoEvent{MovementType: movementTypeFor(placementDiffs), EffectiveDate: with[0].Fields.Get("mutationDate"),
				BeforeRecordID: without[0].ID, AfterRecordID: with[0].ID, Note: "Perubahan penempatan dengan tanggal mutasi yang jelas (Import Excel)."}
		}
	}
	a.NeedsReview = len(a.Aspects) > 0 && a.AutoConfirmable == nil
	a.PrimaryKind = "UNDETERMINED"
	for _, k := range []string{"PLACEMENT_CHANGE", "EXIT", "REENTRY"} {
		for _, as := range a.Aspects {
			if as.Kind == k && a.PrimaryKind == "UNDETERMINED" {
				a.PrimaryKind = k
			}
		}
	}
	if a.PrimaryKind == "UNDETERMINED" && len(a.Aspects) > 0 {
		a.PrimaryKind = a.Aspects[0].Kind
	} else if a.PrimaryKind == "UNDETERMINED" && a.AutoConfirmable != nil {
		a.PrimaryKind = "PLACEMENT_CHANGE"
	}
	return a
}
