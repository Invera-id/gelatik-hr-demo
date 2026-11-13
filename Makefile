# Developer task runner. Frontend commands use the npm workspace; backend commands run in apps/api.
API_DIR := apps/api
DB_URL ?= postgres://gelatik:gelatik-dev-only@localhost:55432/gelatik_hr?sslmode=disable
TEST_DB_URL ?= postgres://gelatik:gelatik-dev-only@localhost:55432/gelatik_hr_test?sslmode=disable

.PHONY: help db-up db-down migrate seed api web dev test test-web test-api lint build build-api contracts check

help:
	@echo "db-up | migrate | seed | api | web | test | lint | build | contracts | check"

db-up: ## start PostgreSQL (docker compose)
	docker compose up -d db

db-down:
	docker compose down

# apps/api/.env (e.g. from `npm run env:decrypt`) is loaded when present; its values win
# over the development defaults below.
LOAD_ENV := set -a; [ ! -f .env ] || . ./.env; set +a;

migrate: ## apply migrations (explicit step, also in production)
	cd $(API_DIR) && $(LOAD_ENV) DATABASE_URL="$${DATABASE_URL:-$(DB_URL)}" go run ./cmd/api migrate

seed: ## demo accounts only, no personnel/projects (refused when APP_ENV=production)
	cd $(API_DIR) && $(LOAD_ENV) DATABASE_URL="$${DATABASE_URL:-$(DB_URL)}" SEED_DEMO_PASSWORD="$${SEED_DEMO_PASSWORD:-gelatik-dev-password}" go run ./cmd/api seed

api: ## run the backend on :8080
	cd $(API_DIR) && $(LOAD_ENV) DATABASE_URL="$${DATABASE_URL:-$(DB_URL)}" ALLOWED_ORIGINS="$${ALLOWED_ORIGINS:-http://localhost:5173}" go run ./cmd/api serve

web: ## run the frontend on :5173 (proxies /api to :8080)
	npm run dev

test-web:
	npm run test

test-api:
	cd $(API_DIR) && gofmt -l . | (! grep .) && go vet ./... && TEST_DATABASE_URL="$(TEST_DB_URL)" go test -count=1 ./...

test: test-web test-api

lint:
	npm run lint
	cd $(API_DIR) && gofmt -l . | (! grep .) && go vet ./...

build-api:
	cd $(API_DIR) && go build -o bin/api ./cmd/api

build: build-api
	npm run build

contracts: ## regenerate TypeScript types from packages/contracts/openapi.yaml
	npm run contracts:generate

check: lint test build
	npm run contracts:check
