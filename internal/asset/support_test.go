package asset

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiiv/sentinel/internal/config"
	"github.com/tiiv/sentinel/internal/db"
	"github.com/tiiv/sentinel/internal/events"
	"github.com/tiiv/sentinel/internal/storage"
)

// Os testes de integracao usam o Postgres e o MinIO do docker-compose. Sem eles
// no ar, cada teste faz Skip com a instrucao de como subir.
const (
	defaultTestDB    = "postgres://sentinel:sentinel@localhost:5432/sentinel_test?sslmode=disable"
	defaultMinIOHost = "http://localhost:9000"
)

var migrateOnce sync.Once

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func testDatabaseURL() string { return env("TEST_DATABASE_URL", defaultTestDB) }

// ensureDatabase cria o banco de teste se ele ainda nao existir.
func ensureDatabase(ctx context.Context, url string) error {
	pool, err := db.Open(ctx, url)
	if err == nil {
		pool.Close()
		return nil
	}
	if !strings.Contains(err.Error(), "does not exist") && !strings.Contains(err.Error(), "3D000") {
		return err
	}
	name := url[strings.LastIndex(url, "/")+1:]
	if i := strings.Index(name, "?"); i >= 0 {
		name = name[:i]
	}
	admin := strings.Replace(url, "/"+name, "/postgres", 1)
	adminPool, err := db.Open(ctx, admin)
	if err != nil {
		return err
	}
	defer adminPool.Close()
	_, err = adminPool.Exec(ctx, fmt.Sprintf("create database %q", name))
	return err
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	url := testDatabaseURL()
	if err := ensureDatabase(ctx, url); err != nil {
		t.Skipf("postgres indisponivel (%v); suba com: docker compose up -d postgres", err)
	}
	var migrateErr error
	migrateOnce.Do(func() { migrateErr = db.Migrate(ctx, url) })
	if migrateErr != nil {
		t.Fatalf("migrations no banco de teste: %v", migrateErr)
	}
	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Skipf("postgres indisponivel (%v)", err)
	}
	if _, err := pool.Exec(ctx, `truncate assets, asset_attachments restart identity cascade`); err != nil {
		t.Fatalf("limpando tabelas: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func testStorage(t *testing.T) *storage.Store {
	t.Helper()
	cfg := config.MinIO{
		InternalEndpoint: env("TEST_MINIO_ENDPOINT", defaultMinIOHost),
		PublicEndpoint:   env("TEST_MINIO_ENDPOINT", defaultMinIOHost),
		AccessKey:        env("TEST_MINIO_ACCESS_KEY", "sentinel"),
		SecretKey:        env("TEST_MINIO_SECRET_KEY", "sentinel123"),
		Bucket:           env("TEST_MINIO_BUCKET", "sentinel-test"),
		Region:           "us-east-1",
		PresignTTL:       10 * time.Minute,
	}
	store, err := storage.New(cfg)
	if err != nil {
		t.Skipf("minio indisponivel (%v)", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := store.EnsureBucket(ctx, cfg.Region); err != nil {
		t.Skipf("minio indisponivel (%v); suba com: docker compose up -d minio", err)
	}
	return store
}

func testKinds(t *testing.T) *config.Kinds {
	t.Helper()
	kinds, err := config.LoadKinds("")
	if err != nil {
		t.Fatalf("carregando kinds: %v", err)
	}
	return kinds
}

// newService monta o servico completo apontando para a infra de teste.
func newService(t *testing.T) (*Service, *Store) {
	t.Helper()
	pool := testPool(t)
	store := NewStore(pool)
	svc := NewService(store, testStorage(t), events.NewHub(), testKinds(t), 50<<20)
	return svc, store
}

func ptr[T any](v T) *T { return &v }
