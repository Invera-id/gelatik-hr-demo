package imports

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
)

type FieldIssue struct {
	RowNumber int    `json:"rowNumber"`
	Column    string `json:"column"`
	Field     string `json:"field,omitempty"`
	Reason    string `json:"reason"`
	RawValue  string `json:"rawValue,omitempty"`
	Severity  string `json:"severity"`
}

type Structured struct {
	Scores       map[string]ScoreValue   `json:"scores"`
	Measures     map[string]MeasureValue `json:"measures"`
	Booleans     map[string]*bool        `json:"booleans"`
	TenureMonths *int                    `json:"tenureMonths"`
}

// Fields maps canonical field keys to normalized string values (nil = empty).
type Fields map[string]*string

func (f Fields) Get(key string) string {
	if v := f[key]; v != nil {
		return *v
	}
	return ""
}

type MappedRow struct {
	RowNumber  int
	Fields     Fields
	Structured Structured
	Raw        map[string]any
	RawValues  map[string]string
	Warnings   []FieldIssue
	IsBlank    bool
}

func rawJSON(c Cell) any {
	switch c.Kind {
	case CellEmpty:
		return nil
	case CellNumber:
		return c.N
	case CellBool:
		return c.B
	}
	return c.S
}

func sp(s string) *string { return &s }

// MapRow normalizes one data row given in template order.
func MapRow(row []Cell, rowNumber int, date1904 bool) MappedRow {
	m := MappedRow{RowNumber: rowNumber, Fields: Fields{}, Raw: map[string]any{}, RawValues: map[string]string{},
		Structured: Structured{Scores: map[string]ScoreValue{}, Measures: map[string]MeasureValue{}, Booleans: map[string]*bool{}}}
	hasValue := false
	warn := func(col ColumnDef, reason, raw string) {
		m.Warnings = append(m.Warnings, FieldIssue{RowNumber: rowNumber, Column: col.Header, Field: col.Field, Reason: reason, RawValue: raw, Severity: "WARNING"})
	}
	for _, col := range Template {
		if col.Kind == KindMarker || col.Kind == KindIgnore || col.Field == "" {
			continue
		}
		var cell Cell
		if col.Index < len(row) {
			cell = row[col.Index]
		}
		key := col.Field
		cleaned := CleanText(cell)
		if cleaned != "" {
			hasValue = true
		}
		m.Raw[key] = rawJSON(cell)
		m.RawValues[key] = cleaned
		switch col.Kind {
		case KindText:
			m.Fields[key] = NormalizeText(cell)
		case KindGender:
			m.Fields[key] = NormalizeGender(cell)
		case KindIdentifier:
			out := NormalizeIdentifier(cell)
			m.Fields[key] = out.Value
			if out.Masked {
				warn(col, "Nomor tersamarkan (xxx); teks dipertahankan tanpa menebak digit.", cleaned)
			}
			if out.PrecisionLoss {
				warn(col, "Identifier panjang tersimpan sebagai angka; presisi digit mungkin hilang.", cleaned)
			}
		case KindRtRw:
			m.Fields[key] = NormalizeRtRw(cell)
		case KindDate:
			out := NormalizeDate(cell, date1904)
			m.Fields[key] = out.Value
			if out.Invalid {
				warn(col, "Tanggal tidak valid dan diabaikan: "+cleaned+".", cleaned)
			}
		case KindScore:
			v, w := NormalizeScore(cell)
			m.Structured.Scores[key] = v
			if v.Raw != "" {
				m.Fields[key] = sp(v.Raw)
			} else {
				m.Fields[key] = nil
			}
			if w != "" {
				warn(col, w, cleaned)
			}
		case KindHeight, KindWeight:
			kind, unit := "weight", "kg"
			if col.Kind == KindHeight {
				kind, unit = "height", "cm"
			}
			v, w := NormalizeMeasure(cell, kind)
			m.Structured.Measures[key] = v
			switch {
			case v.Value != nil:
				m.Fields[key] = sp(formatNumber(*v.Value) + " " + unit)
			case cleaned != "":
				m.Fields[key] = sp(cleaned)
			default:
				m.Fields[key] = nil
			}
			if w != "" {
				warn(col, w, cleaned)
			}
		case KindBoolean:
			v, w := NormalizeBoolean(cell)
			m.Structured.Booleans[key] = v
			switch {
			case v == nil:
				m.Fields[key] = nil
			case key == "agreementTermination" && *v:
				m.Fields[key] = sp("YA")
			case key == "agreementTermination":
				m.Fields[key] = sp("TIDAK")
			case *v:
				m.Fields[key] = sp("Ya")
			default:
				m.Fields[key] = sp("Tidak")
			}
			if w != "" {
				warn(col, w, cleaned)
			}
		case KindStatusCode:
			v, w := NormalizeStatusCode(cell)
			m.Fields[key] = v
			if w != "" {
				warn(col, w, cleaned)
			}
		case KindTenure:
			if cleaned != "" {
				m.Fields[key] = sp(cleaned)
			} else {
				m.Fields[key] = nil
			}
			m.Structured.TenureMonths = ParseTenureMonths(cell)
		}
	}
	m.IsBlank = !hasValue
	return m
}

// BusinessKey normalizes ID Personil (trim + upper-case) into the unique key.
func BusinessKey(personnelID string) string {
	return strings.ToUpper(CleanText(Str(personnelID)))
}

// FingerprintVersion identifies the canonicalization rule below.
//
// v2: take every field with a non-empty trimmed value, sort by key, join as
// key U+001F value pairs separated by U+001E, SHA-256, first 32 hex chars, prefix "v2:".
// Row number, running "No", file name, sheet and import time are never included.
const FingerprintVersion = 2

func Fingerprint(fields map[string]*string) string {
	keys := make([]string, 0, len(fields))
	for k, v := range fields {
		if v != nil && strings.TrimSpace(*v) != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(0x1e)
		}
		b.WriteString(k)
		b.WriteByte(0x1f)
		b.WriteString(strings.TrimSpace(*fields[k]))
	}
	sum := sha256.Sum256([]byte(b.String()))
	return "v2:" + hex.EncodeToString(sum[:16])
}

// ContentHash is an order-free hash over a set of fingerprints.
func ContentHash(fingerprints []string) string {
	sorted := append([]string(nil), fingerprints...)
	sort.Strings(sorted)
	sum := sha256.Sum256([]byte(strings.Join(sorted, "|")))
	return hex.EncodeToString(sum[:12])
}

type ParsedRecord struct {
	MappedRow
	BusinessKey string
	PersonnelID string
	Name        string
	Fingerprint string
}

type ParseException struct {
	RowNumber int               `json:"rowNumber"`
	Reason    string            `json:"reason"`
	RawValues map[string]string `json:"rawValues"`
}

type ParseResult struct {
	SheetName                 string
	NonEmptyRows              int
	BlankRowsSkipped          int
	IdenticalDuplicatesInFile int
	Records                   []ParsedRecord
	Exceptions                []ParseException
}

// Groups returns distinct records grouped by business key, in first-seen order.
func (p ParseResult) Groups() ([]string, map[string][]ParsedRecord) {
	var order []string
	groups := map[string][]ParsedRecord{}
	for _, r := range p.Records {
		if _, ok := groups[r.BusinessKey]; !ok {
			order = append(order, r.BusinessKey)
		}
		groups[r.BusinessKey] = append(groups[r.BusinessKey], r)
	}
	return order, groups
}

func looksLikeHeaderRepeat(row []Cell) bool {
	n := normalizedRow(row)
	for _, s := range SignatureHeaders {
		if !contains(n, s) {
			return false
		}
	}
	return true
}

// Parse turns the Database sheet into distinct, identity-valid source records.
// Rows are never merged; only byte-identical business content collapses.
func Parse(wb *Workbook) (*ParseResult, error) {
	sheet, err := SelectDatabaseSheet(wb.Sheets)
	if err != nil {
		return nil, err
	}
	header, err := LocateHeaderRow(sheet.Rows)
	if err != nil {
		return nil, err
	}
	var colMap []int
	if !header.MatchesTemplate {
		colMap = TemplateColumnMap(header.Headers)
	}
	res := &ParseResult{SheetName: sheet.Name}
	seen := map[string]bool{}
	for i := header.RowIndex + 1; i < len(sheet.Rows); i++ {
		row := sheet.Rows[i]
		rowNumber := i + 1
		canonical := row
		if colMap != nil {
			canonical = make([]Cell, len(colMap))
			for t, src := range colMap {
				if src >= 0 && src < len(row) {
					canonical[t] = row[src]
				}
			}
		}
		mapped := MapRow(canonical, rowNumber, wb.Date1904)
		if mapped.IsBlank {
			res.BlankRowsSkipped++
			continue
		}
		if looksLikeHeaderRepeat(row) {
			continue
		}
		res.NonEmptyRows++
		pid, name := mapped.Fields.Get("personnelId"), mapped.Fields.Get("name")
		var missing []string
		if pid == "" {
			missing = append(missing, "ID Personil")
		}
		if name == "" {
			missing = append(missing, "Nama")
		}
		if len(missing) > 0 {
			res.Exceptions = append(res.Exceptions, ParseException{RowNumber: rowNumber, Reason: "Field kritikal belum lengkap: " + strings.Join(missing, ", ") + ".", RawValues: mapped.RawValues})
			continue
		}
		key := BusinessKey(pid)
		fp := Fingerprint(mapped.Fields)
		if seen[key+":"+fp] {
			res.IdenticalDuplicatesInFile++
			continue
		}
		seen[key+":"+fp] = true
		res.Records = append(res.Records, ParsedRecord{MappedRow: mapped, BusinessKey: key, PersonnelID: pid, Name: name, Fingerprint: fp})
	}
	return res, nil
}
