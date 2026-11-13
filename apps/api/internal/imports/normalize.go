// Package imports implements the authoritative personnel Excel import:
// workbook reading, normalization, fingerprinting, classification and reconciliation.
// The pure parts (everything except store.go/service.go) perform no I/O.
package imports

import (
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// CellKind is the type of a cell as stored in the workbook.
type CellKind int

const (
	CellEmpty CellKind = iota
	CellString
	CellNumber
	CellBool
	CellDate // ISO date string (t="d" cells)
)

type Cell struct {
	Kind CellKind
	S    string
	N    float64
	B    bool
}

func Str(s string) Cell      { return Cell{Kind: CellString, S: s} }
func Num(n float64) Cell     { return Cell{Kind: CellNumber, N: n} }
func Bool(b bool) Cell       { return Cell{Kind: CellBool, B: b} }
func DateCell(s string) Cell { return Cell{Kind: CellDate, S: s} }

var spaceRun = regexp.MustCompile(`\s+`)

func formatNumber(n float64) string {
	if n == math.Trunc(n) && !math.IsInf(n, 0) {
		if math.Abs(n) < 1e21 {
			return strconv.FormatFloat(n, 'f', -1, 64)
		}
	}
	return strconv.FormatFloat(n, 'g', -1, 64)
}

// CleanText collapses whitespace (incl. NBSP / line breaks) and trims.
func CleanText(c Cell) string {
	switch c.Kind {
	case CellEmpty:
		return ""
	case CellNumber:
		return formatNumber(c.N)
	case CellBool:
		return strconv.FormatBool(c.B)
	default:
		return strings.TrimSpace(spaceRun.ReplaceAllString(strings.ReplaceAll(c.S, " ", " "), " "))
	}
}

// NormalizeHeader is cleaned + lowercased text used for header matching.
func NormalizeHeader(s string) string {
	return strings.ToLower(strings.TrimSpace(spaceRun.ReplaceAllString(strings.ReplaceAll(s, " ", " "), " ")))
}

var emptyTokens = map[string]bool{"": true, "-": true, "tidak berlaku": true, "n/a": true, "na": true, "null": true, "#n/a": true}

// NormalizeText returns trimmed text or nil. Numbers (including 0) are values, never empty.
func NormalizeText(c Cell) *string {
	if c.Kind == CellNumber {
		s := formatNumber(c.N)
		return &s
	}
	t := CleanText(c)
	if emptyTokens[strings.ToLower(t)] {
		return nil
	}
	return &t
}

// IdentifierResult keeps identifiers as strings; precision loss and masking are flagged, never "fixed".
type IdentifierResult struct {
	Value         *string
	Masked        bool
	PrecisionLoss bool
}

var maskedPattern = regexp.MustCompile(`(?i)x{2,}`)

const maxSafeInteger = 9007199254740991

func NormalizeIdentifier(c Cell) IdentifierResult {
	var text string
	var precisionLoss bool
	switch c.Kind {
	case CellEmpty:
		return IdentifierResult{}
	case CellNumber:
		if math.Abs(c.N) >= 1e15 && (c.N != math.Trunc(c.N) || math.Abs(c.N) > maxSafeInteger) {
			precisionLoss = true
		}
		if c.N == math.Trunc(c.N) && !math.IsInf(c.N, 0) {
			bf := new(big.Float).SetFloat64(c.N)
			i, _ := bf.Int(nil)
			text = i.String()
		} else {
			text = formatNumber(c.N)
		}
	default:
		text = CleanText(c)
	}
	if emptyTokens[strings.ToLower(text)] {
		return IdentifierResult{}
	}
	return IdentifierResult{Value: &text, Masked: maskedPattern.MatchString(text), PrecisionLoss: precisionLoss}
}

var rtrwDigits = regexp.MustCompile(`^\d{1,3}$`)

func NormalizeRtRw(c Cell) *string {
	v := NormalizeIdentifier(c).Value
	if v == nil {
		return nil
	}
	if rtrwDigits.MatchString(*v) {
		s := fmt.Sprintf("%03s", *v)
		s = strings.ReplaceAll(s, " ", "0")
		return &s
	}
	return v
}

var months = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "mei": 5, "jun": 6, "jul": 7, "aug": 8, "agu": 8, "agt": 8, "sep": 9, "oct": 10, "okt": 10, "nov": 11, "dec": 12, "des": 12}

func expandYear(yy int) int {
	if yy <= 49 {
		return 2000 + yy
	}
	return 1900 + yy
}

func buildISODate(y, m, d int) *string {
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return nil
	}
	t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	if t.Year() != y || int(t.Month()) != m || t.Day() != d {
		return nil
	}
	s := fmt.Sprintf("%04d-%02d-%02d", y, m, d)
	return &s
}

// serialToDate converts an Excel serial date honoring the 1900 (leap-bug) or 1904 system.
func serialToDate(serial float64, date1904 bool) *string {
	if math.IsNaN(serial) || math.IsInf(serial, 0) || serial <= 0 {
		return nil
	}
	days := int(math.Floor(serial))
	epoch := time.Date(1899, 12, 31, 0, 0, 0, 0, time.UTC)
	if date1904 {
		epoch = time.Date(1904, 1, 1, 0, 0, 0, 0, time.UTC)
	} else if days >= 60 {
		days-- // skip the phantom 1900-02-29
	}
	t := epoch.AddDate(0, 0, days)
	return buildISODate(t.Year(), int(t.Month()), t.Day())
}

var (
	isoDate      = regexp.MustCompile(`^(\d{4})-(\d{1,2})-(\d{1,2})$`)
	monthName    = regexp.MustCompile(`^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$`)
	numericDMY   = regexp.MustCompile(`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$`)
	isoDateTimeP = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})T`)
)

type DateResult struct {
	Value   *string
	Invalid bool
}

func yearOf(s string) int {
	n, _ := strconv.Atoi(s)
	if len(s) <= 2 {
		return expandYear(n)
	}
	return n
}

// NormalizeDate returns YYYY-MM-DD without timezone shift. Ambiguous text is invalid, not guessed.
func NormalizeDate(c Cell, date1904 bool) DateResult {
	switch c.Kind {
	case CellEmpty:
		return DateResult{}
	case CellNumber:
		v := serialToDate(c.N, date1904)
		return DateResult{Value: v, Invalid: v == nil}
	case CellDate:
		if m := isoDateTimeP.FindStringSubmatch(c.S); m != nil {
			return NormalizeDate(Str(m[1]), date1904)
		}
	}
	text := CleanText(c)
	if emptyTokens[strings.ToLower(text)] {
		return DateResult{}
	}
	atoi := func(s string) int { n, _ := strconv.Atoi(s); return n }
	if m := isoDate.FindStringSubmatch(text); m != nil {
		v := buildISODate(atoi(m[1]), atoi(m[2]), atoi(m[3]))
		return DateResult{Value: v, Invalid: v == nil}
	}
	if m := monthName.FindStringSubmatch(text); m != nil {
		mon, ok := months[strings.ToLower(m[2][:3])]
		if !ok {
			return DateResult{Invalid: true}
		}
		v := buildISODate(yearOf(m[3]), mon, atoi(m[1]))
		return DateResult{Value: v, Invalid: v == nil}
	}
	if m := numericDMY.FindStringSubmatch(text); m != nil {
		v := buildISODate(yearOf(m[3]), atoi(m[2]), atoi(m[1]))
		return DateResult{Value: v, Invalid: v == nil}
	}
	return DateResult{Invalid: true}
}

type ScoreValue struct {
	Raw        string   `json:"raw"`
	Score      *float64 `json:"score"`
	MaxScore   *float64 `json:"maxScore"`
	Percentage *float64 `json:"percentage"`
}

type MeasureValue struct {
	Raw   string   `json:"raw"`
	Value *float64 `json:"value"`
}

var (
	fractionScore = regexp.MustCompile(`^(-?\d+(?:[.,]\d+)?)\s*/\s*(-?\d+(?:[.,]\d+)?)$`)
	singleScore   = regexp.MustCompile(`^-?\d+(?:[.,]\d+)?$`)
	measurePat    = regexp.MustCompile(`^(\d+)(?:[.,](\d+))?\s*([A-Za-z]+)?$`)
)

func parseDecimal(s string) float64 {
	f, _ := strconv.ParseFloat(strings.Replace(s, ",", ".", 1), 64)
	return f
}

func rawOf(c Cell) string {
	if c.Kind == CellNumber {
		return formatNumber(c.N)
	}
	return CleanText(c)
}

func NormalizeScore(c Cell) (ScoreValue, string) {
	raw := rawOf(c)
	if c.Kind == CellEmpty || emptyTokens[strings.ToLower(raw)] {
		return ScoreValue{Raw: raw}, ""
	}
	if m := fractionScore.FindStringSubmatch(raw); m != nil {
		score, max := parseDecimal(m[1]), parseDecimal(m[2])
		if max == 0 {
			return ScoreValue{Raw: raw, Score: &score}, "Penyebut nilai 0 tidak valid; nilai mentah dipertahankan."
		}
		pct := math.Round(score/max*10000) / 100
		warning := ""
		if score > max {
			warning = "Nilai melebihi penyebut; tidak dikoreksi otomatis."
		}
		return ScoreValue{Raw: raw, Score: &score, MaxScore: &max, Percentage: &pct}, warning
	}
	if singleScore.MatchString(raw) {
		v := parseDecimal(raw)
		return ScoreValue{Raw: raw, Score: &v}, ""
	}
	return ScoreValue{Raw: raw}, "Format nilai tidak dikenal: " + raw + "."
}

var unitToCM = map[string]float64{"cm": 1, "m": 100, "mm": 0.1}
var unitToKG = map[string]float64{"kg": 1, "g": 0.001, "gr": 0.001, "gram": 0.001}

func NormalizeMeasure(c Cell, kind string) (MeasureValue, string) {
	raw := rawOf(c)
	if c.Kind == CellEmpty || emptyTokens[strings.ToLower(raw)] {
		return MeasureValue{Raw: raw}, ""
	}
	label := "berat"
	table := unitToKG
	if kind == "height" {
		label, table = "tinggi", unitToCM
	}
	// Same grammar as manual forms (domain.ParseMeasurement): no sign, one decimal
	// separator, at most 2 decimals. Ambiguous or non-positive values are kept raw
	// with a warning instead of being silently rewritten.
	if c.Kind == CellNumber {
		if c.N <= 0 {
			return MeasureValue{Raw: raw}, fmt.Sprintf("Nilai %s harus lebih dari 0: %s.", label, raw)
		}
		v := math.Round(c.N*100) / 100
		return MeasureValue{Raw: raw, Value: &v}, ""
	}
	m := measurePat.FindStringSubmatch(raw)
	if m == nil {
		return MeasureValue{Raw: raw}, fmt.Sprintf("Nilai %s tidak terbaca (harus angka, contoh 60 atau 60,5): %s.", label, raw)
	}
	if len(m[2]) > 2 {
		return MeasureValue{Raw: raw}, fmt.Sprintf("Format angka %s ambigu (lebih dari 2 desimal / pemisah ribuan?): %s. Tidak dinormalisasi.", label, raw)
	}
	num := parseDecimal(m[1] + "." + m[2])
	if num <= 0 {
		return MeasureValue{Raw: raw}, fmt.Sprintf("Nilai %s harus lebih dari 0: %s.", label, raw)
	}
	unit := strings.ToLower(m[3])
	if unit == "" {
		return MeasureValue{Raw: raw, Value: &num}, ""
	}
	factor, ok := table[unit]
	if !ok {
		return MeasureValue{Raw: raw}, fmt.Sprintf("Satuan tidak dikenal (%s) pada %s.", m[3], raw)
	}
	v := math.Round(num*factor*100) / 100
	return MeasureValue{Raw: raw, Value: &v}, ""
}

func NormalizeBoolean(c Cell) (*bool, string) {
	text := strings.ToLower(CleanText(c))
	t, f := true, false
	switch text {
	case "", "-":
		return nil, ""
	case "ya", "y", "true":
		return &t, ""
	case "tidak", "t", "no", "false":
		return &f, ""
	}
	return nil, "Nilai seleksi fisik tidak dikenal: " + CleanText(c) + "."
}

var slashSpaces = regexp.MustCompile(`\s*/\s*`)

func NormalizeStatusCode(c Cell) (*string, string) {
	text := CleanText(c)
	if text == "" || text == "-" {
		return nil, ""
	}
	canonical := strings.ToUpper(slashSpaces.ReplaceAllString(text, "/"))
	if canonical == "R/P" || canonical == "N/A" {
		return &canonical, ""
	}
	return &text, "Kode Status tidak dikenal dipertahankan apa adanya: " + text + "."
}

func NormalizeGender(c Cell) *string {
	text := strings.ToLower(CleanText(c))
	if text == "" {
		return nil
	}
	var v string
	switch text {
	case "l", "laki-laki", "laki laki", "pria", "male", "m":
		v = "Laki-laki"
	case "p", "perempuan", "wanita", "female", "f":
		v = "Perempuan"
	default:
		v = CleanText(c)
	}
	return &v
}

var (
	tenureYears  = regexp.MustCompile(`(\d+)\s*tahun`)
	tenureMonths = regexp.MustCompile(`(\d+)\s*bulan`)
)

func ParseTenureMonths(c Cell) *int {
	text := strings.ToLower(CleanText(c))
	if text == "" || text == "-" {
		return nil
	}
	y, m := tenureYears.FindStringSubmatch(text), tenureMonths.FindStringSubmatch(text)
	if y == nil && m == nil {
		return nil
	}
	total := 0
	if y != nil {
		n, _ := strconv.Atoi(y[1])
		total += n * 12
	}
	if m != nil {
		n, _ := strconv.Atoi(m[1])
		total += n
	}
	return &total
}
