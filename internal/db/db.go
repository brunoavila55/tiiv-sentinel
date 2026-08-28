// Package db abre o pool do Postgres e aplica as migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/tiiv/sentinel/migrations"
)

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL invalida: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MaxConnLifetime = time.Hour
	cfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("abrindo pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres indisponivel: %w", err)
	}
	return pool, nil
}

// WaitFor tenta conectar ate o deadline; o Postgres do compose pode demorar a
// aceitar conexoes no primeiro boot.
func WaitFor(ctx context.Context, url string, timeout time.Duration) (*pgxpool.Pool, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		pool, err := Open(ctx, url)
		if err == nil {
			return pool, nil
		}
		lastErr = err
		if time.Now().After(deadline) {
			return nil, lastErr
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// sqlDB abre uma conexao database/sql sobre o pgx: o goose precisa dela para
// aplicar as migrations.
func sqlDB(url string) (*sql.DB, error) {
	conn, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL invalida: %w", err)
	}
	return conn, nil
}

func Migrate(ctx context.Context, url string) error {
	conn, err := sqlDB(url)
	if err != nil {
		return err
	}
	defer conn.Close()

	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.UpContext(ctx, conn, "."); err != nil {
		return fmt.Errorf("aplicando migrations: %w", err)
	}
	return nil
}

func MigrateDown(ctx context.Context, url string) error {
	conn, err := sqlDB(url)
	if err != nil {
		return err
	}
	defer conn.Close()

	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.DownContext(ctx, conn, ".")
}
