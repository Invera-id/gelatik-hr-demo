package service

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestWriteXLSXNeutralizesFormulas(t *testing.T) {
	data, err := writeXLSX([]string{"Name", "Gap"}, [][]any{{"=HYPERLINK(\"x\")", 3}, {"-12", nil}, {"@SUM(A1)", ptrInt(2)}})
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := f.GetRows("Data")
	if rows[1][0] != "'=HYPERLINK(\"x\")" || rows[2][0] != "-12" || rows[3][0] != "'@SUM(A1)" || rows[1][1] != "3" {
		t.Fatalf("unexpected cells: %q", rows)
	}
	if formula, _ := f.GetCellFormula("Data", "A2"); formula != "" {
		t.Fatal("no cell may become a formula")
	}
}

func ptrInt(v int) *int { return &v }
