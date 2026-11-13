package domain

import (
	"regexp"
	"strings"
)

// Physical measurements entered in forms (Berat Badan in kg, Tinggi Badan in cm).
// Accepted: "60", "60.5", "60,5", "60 kg" (unit optional, must match). One decimal
// separator with at most 2 decimals; "1.234" is rejected as ambiguous (could be a
// thousands separator). Values must be > 0. Empty means "no value", never 0.
// Plausibility ranges are not enforced (no confirmed rule; TBC).
var measureInput = regexp.MustCompile(`^(\d+)(?:[.,](\d+))?\s*([A-Za-z]+)?$`)

type MeasureSpec struct {
	Label string // e.g. "Berat badan"
	Unit  string // "kg" | "cm"
	Hint  string // e.g. "60 atau 60,5"
}

var (
	WeightSpec = MeasureSpec{Label: "Berat badan", Unit: "kg", Hint: "60 atau 60,5"}
	HeightSpec = MeasureSpec{Label: "Tinggi badan", Unit: "cm", Hint: "165 atau 165,5"}
)

// ParseMeasurement returns the canonical decimal text (dot separator, no trailing
// zeros, no unit), nil for empty input, or a user-facing error message.
func ParseMeasurement(raw string, spec MeasureSpec) (*string, string) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, ""
	}
	m := measureInput.FindStringSubmatch(text)
	if m == nil {
		return nil, spec.Label + " harus berupa angka dalam " + spec.Unit + ", contoh: " + spec.Hint + "."
	}
	if m[3] != "" && !strings.EqualFold(m[3], spec.Unit) {
		return nil, "Gunakan satuan " + spec.Unit + " untuk " + strings.ToLower(spec.Label) + ", contoh: " + spec.Hint + "."
	}
	if len(m[2]) > 2 {
		return nil, "Format angka ambigu: gunakan paling banyak 2 angka desimal, contoh: " + spec.Hint + "."
	}
	whole := strings.TrimLeft(m[1], "0")
	frac := strings.TrimRight(m[2], "0")
	if whole == "" && frac == "" {
		return nil, spec.Label + " harus lebih dari 0 " + spec.Unit + "."
	}
	if whole == "" {
		whole = "0"
	}
	out := whole
	if frac != "" {
		out += "." + frac
	}
	return &out, ""
}
