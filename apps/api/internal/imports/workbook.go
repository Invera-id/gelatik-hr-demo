package imports

import (
	"bytes"
	"fmt"
	"strconv"

	"github.com/xuri/excelize/v2"
)

// AbortError is a fatal import problem; nothing is staged or written.
type AbortError struct{ Message string }

func (e *AbortError) Error() string { return e.Message }

func abort(format string, args ...any) error {
	return &AbortError{Message: fmt.Sprintf(format, args...)}
}

const (
	TargetSheetName      = "Database"
	SheetNotFoundMessage = "Sheet Database tidak ditemukan. Ubah nama sheet data menjadi Database lalu impor ulang."
	maxColumns           = 200
	// Decompression limits guard against zip bombs.
	unzipSizeLimit    = 256 << 20
	unzipXMLSizeLimit = 128 << 20
)

type SheetTable struct {
	Name string
	Rows [][]Cell
}

type Workbook struct {
	Sheets   []SheetTable
	Date1904 bool
}

// ReadWorkbook reads an .xlsx from memory. Only the Database sheet is materialized
// cell-by-cell; other sheets contribute their names (needed for the ambiguity check).
func ReadWorkbook(data []byte, maxRows int) (*Workbook, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{UnzipSizeLimit: unzipSizeLimit, UnzipXMLSizeLimit: unzipXMLSizeLimit})
	if err != nil {
		return nil, abort("File tidak dapat dibaca. Pastikan file berupa .xlsx yang valid, tidak rusak, dan tidak terenkripsi.")
	}
	defer func() { _ = f.Close() }()
	wb := &Workbook{}
	if props, err := f.GetWorkbookProps(); err == nil && props.Date1904 != nil {
		wb.Date1904 = *props.Date1904
	}
	target := NormalizeHeader(TargetSheetName)
	for _, name := range f.GetSheetList() {
		table := SheetTable{Name: name}
		if NormalizeHeader(name) == target {
			rows, err := f.GetRows(name, excelize.Options{RawCellValue: true})
			if err != nil {
				return nil, abort("Sheet Database tidak dapat dibaca.")
			}
			if len(rows) > maxRows+30 {
				return nil, abort("Jumlah baris melebihi batas %d baris per impor.", maxRows)
			}
			table.Rows = make([][]Cell, len(rows))
			for r, row := range rows {
				if len(row) > maxColumns {
					row = row[:maxColumns]
				}
				cells := make([]Cell, len(row))
				for c, raw := range row {
					if raw == "" {
						continue
					}
					ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
					kind, _ := f.GetCellType(name, ref)
					cells[c] = typedCell(kind, raw)
				}
				table.Rows[r] = cells
			}
		}
		wb.Sheets = append(wb.Sheets, table)
	}
	return wb, nil
}

func typedCell(kind excelize.CellType, raw string) Cell {
	switch kind {
	case excelize.CellTypeUnset, excelize.CellTypeNumber:
		if n, err := strconv.ParseFloat(raw, 64); err == nil {
			return Num(n)
		}
	case excelize.CellTypeBool:
		return Bool(raw == "1" || raw == "TRUE" || raw == "true")
	case excelize.CellTypeDate:
		return DateCell(raw)
	}
	return Str(raw)
}

// SelectDatabaseSheet picks exactly one sheet named "Database" (trim + case-fold); no fallback.
func SelectDatabaseSheet(sheets []SheetTable) (*SheetTable, error) {
	target := NormalizeHeader(TargetSheetName)
	var matches []*SheetTable
	for i := range sheets {
		if NormalizeHeader(sheets[i].Name) == target {
			matches = append(matches, &sheets[i])
		}
	}
	switch len(matches) {
	case 0:
		return nil, abort(SheetNotFoundMessage)
	case 1:
		return matches[0], nil
	}
	return nil, abort("Ditemukan %d sheet bernama Database setelah normalisasi; impor dihentikan karena ambigu.", len(matches))
}

type HeaderLocation struct {
	RowIndex        int
	Headers         []string
	MatchesTemplate bool
}

func normalizedRow(row []Cell) []string {
	out := make([]string, len(row))
	for i, c := range row {
		out[i] = NormalizeHeader(CleanText(c))
	}
	return out
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// LocateHeaderRow finds the header row in the first 30 rows by its signature headers.
func LocateHeaderRow(rows [][]Cell) (*HeaderLocation, error) {
	limit := min(30, len(rows))
	for i := 0; i < limit; i++ {
		headers := normalizedRow(rows[i])
		present := 0
		for _, s := range SignatureHeaders {
			if contains(headers, s) {
				present++
			}
		}
		if present == len(SignatureHeaders) {
			return &HeaderLocation{RowIndex: i, Headers: headers, MatchesTemplate: MatchesTemplate(headers)}, nil
		}
	}
	return nil, abort("Baris header tidak ditemukan. Pastikan sheet Database memuat kolom ID Personil, Nama, Tanggal Bergabung, dan Posisi.")
}

// MatchesTemplate is true when headers equal the 83-column template in order (trailing blanks ignored).
func MatchesTemplate(headers []string) bool {
	trimmed := headers
	for len(trimmed) > len(Template) && trimmed[len(trimmed)-1] == "" {
		trimmed = trimmed[:len(trimmed)-1]
	}
	if len(trimmed) != len(Template) {
		return false
	}
	for i, h := range TemplateHeadersNormalized {
		if trimmed[i] != h {
			return false
		}
	}
	return true
}

// TemplateColumnMap maps each template column to its source index by name and
// occurrence order; missing columns are -1 (never shifted positionally).
func TemplateColumnMap(headers []string) []int {
	source := map[string][]int{}
	for i, h := range headers {
		if h != "" {
			source[h] = append(source[h], i)
		}
	}
	seen := map[string]int{}
	out := make([]int, len(TemplateHeadersNormalized))
	for i, h := range TemplateHeadersNormalized {
		n := seen[h]
		seen[h] = n + 1
		if idx := source[h]; n < len(idx) {
			out[i] = idx[n]
		} else {
			out[i] = -1
		}
	}
	return out
}
