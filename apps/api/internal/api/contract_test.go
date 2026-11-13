package api

import (
	"bufio"
	"io"
	"log/slog"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/config"
)

// TestRoutesMatchOpenAPI fails when a Fiber route is missing from
// packages/contracts/openapi.yaml or the spec documents a route that does not exist.
func TestRoutesMatchOpenAPI(t *testing.T) {
	f, err := os.Open("../../../../packages/contracts/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	pathRe := regexp.MustCompile(`^  (/[^:]*):\s*$`)
	methodRe := regexp.MustCompile(`^    (get|post|put|patch|delete):`)
	spec := map[string]bool{}
	current := ""
	inPaths := false
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if line == "paths:" {
			inPaths = true
			continue
		}
		if inPaths && len(line) > 0 && line[0] != ' ' {
			break
		}
		if m := pathRe.FindStringSubmatch(line); m != nil {
			current = m[1]
		} else if m := methodRe.FindStringSubmatch(line); m != nil && current != "" {
			spec[strings.ToUpper(m[1])+" /api/v1"+current] = true
		}
	}
	app := New(&Server{Cfg: config.Config{ImportMaxBytes: 1 << 20}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	param := regexp.MustCompile(`:([A-Za-z]+)`)
	routes := map[string]bool{}
	for _, r := range Routes(app) {
		if !strings.HasPrefix(r[1], "/api/v1") {
			continue
		}
		routes[r[0]+" "+param.ReplaceAllString(r[1], "{$1}")] = true
	}
	var missing, extra []string
	for r := range routes {
		if !spec[r] {
			missing = append(missing, r)
		}
	}
	for r := range spec {
		if !routes[r] {
			extra = append(extra, r)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 || len(extra) > 0 {
		t.Fatalf("contract drift\n  routes missing from openapi.yaml: %v\n  spec paths without a route: %v", missing, extra)
	}
}
