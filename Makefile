# Atalhos do dia a dia. Tudo roda sobre o docker-compose da mesma VM.
COMPOSE ?= docker compose

.PHONY: up down restart logs build migrate migrate-down seed test test-unit fmt vet dev-api dev-web dev-mobile health

up:                ## sobe todos os servicos (migrations rodam no boot da api)
	$(COMPOSE) up -d --build

down:              ## derruba os servicos (volumes preservados)
	$(COMPOSE) down

restart:
	$(COMPOSE) restart api web

logs:
	$(COMPOSE) logs -f api

build:
	$(COMPOSE) build

migrate:           ## aplica as migrations manualmente
	$(COMPOSE) run --rm api migrate

migrate-down:      ## reverte a ultima migration
	$(COMPOSE) run --rm api migrate-down

seed:              ## ~50 ativos em 4 niveis para desenvolvimento
	$(COMPOSE) run --rm -e SEED_FORCE=$(FORCE) api seed

health:
	@curl -fsS http://localhost:$${WEB_PORT:-8080}/healthz && echo

# Os testes de integracao usam o Postgres e o MinIO do compose (banco separado,
# sentinel_test). Sem eles no ar, cada teste faz skip com a instrucao.
test:
	go test ./...

test-unit:         ## so o que nao precisa de infra
	go test ./internal/media/... ./internal/auth/... ./internal/config/...

fmt:
	gofmt -w ./cmd ./internal ./migrations

vet:
	go vet ./...

dev-api:           ## api local apontando para o compose
	go run ./cmd/api serve

dev-web:
	cd web && npm run dev

dev-mobile:        ## PWA de campo em http://localhost:5174/m/
	cd web && npm run dev:mobile
