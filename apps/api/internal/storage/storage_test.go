package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestLocalRoundTripAndKeyValidation(t *testing.T) {
	ctx := context.Background()
	l, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key, _ := NewKey()
	if err := l.Put(ctx, key, strings.NewReader("synthetic")); err != nil {
		t.Fatal(err)
	}
	f, err := l.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(f)
	f.Close()
	if string(b) != "synthetic" {
		t.Fatalf("content %q", b)
	}
	keys, _ := l.List(ctx, time.Now().Add(time.Minute))
	if len(keys) != 1 || keys[0] != key {
		t.Fatalf("list %v", keys)
	}
	if err := l.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Open(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted object: %v", err)
	}
	for _, bad := range []string{"../etc/passwd", "ab", strings.Repeat("A", 64)} {
		if err := l.Put(ctx, bad, strings.NewReader("x")); err == nil {
			t.Errorf("key %q accepted", bad)
		}
	}
}
