package domain

import (
	"strings"
	"testing"
)

func TestParseMeasurementWeight(t *testing.T) {
	ok := map[string]string{"60": "60", "60.5": "60.5", "60,5": "60.5", "60 kg": "60", "60,50 KG": "60.5", "060": "60", "0,5": "0.5"}
	for in, want := range ok {
		got, msg := ParseMeasurement(in, WeightSpec)
		if msg != "" || got == nil || *got != want {
			t.Errorf("%q: got %v %q want %s", in, got, msg, want)
		}
	}
	bad := map[string]string{"abc": "harus berupa angka", "enam puluh": "harus berupa angka", "-60": "harus berupa angka", "0": "lebih dari 0",
		"0,00": "lebih dari 0", "1.234": "ambigu", "60 lbs": "satuan kg", "60.5.1": "harus berupa angka", "60 cm": "satuan kg"}
	for in, want := range bad {
		got, msg := ParseMeasurement(in, WeightSpec)
		if got != nil || !strings.Contains(msg, want) {
			t.Errorf("%q: got %v %q want message containing %q", in, got, msg, want)
		}
	}
}

func TestParseMeasurementEmptyIsNotZero(t *testing.T) {
	for _, in := range []string{"", "   "} {
		if got, msg := ParseMeasurement(in, WeightSpec); got != nil || msg != "" {
			t.Fatalf("%q: empty must stay empty, got %v %q", in, got, msg)
		}
	}
}
