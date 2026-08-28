// Command api e o unico binario do backend: serve a API, aplica migrations e
// roda o seed de desenvolvimento.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tiiv/sentinel/internal/asset"
	"github.com/tiiv/sentinel/internal/auth"
	"github.com/tiiv/sentinel/internal/config"
	"github.com/tiiv/sentinel/internal/db"
	"github.com/tiiv/sentinel/internal/events"
	"github.com/tiiv/sentinel/internal/poller"
	"github.com/tiiv/sentinel/internal/storage"
)

func main() {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}

	cfg, err := config.Load()
	if err != nil {
		fatal("configuracao invalida", err)
	}
	setupLogger(cfg.Env)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch command {
	case "serve":
		if err := serve(ctx, cfg); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("api encerrou com erro", err)
		}
	case "migrate":
		if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
			fatal("migrate", err)
		}
		slog.Info("migrations aplicadas")
	case "migrate-down":
		if err := db.MigrateDown(ctx, cfg.DatabaseURL); err != nil {
			fatal("migrate-down", err)
		}
		slog.Info("ultima migration revertida")
	case "seed":
		if err := runSeed(ctx, cfg); err != nil {
			fatal("seed", err)
		}
	case "adduser":
		if err := runAddUser(ctx, cfg, os.Args[2:]); err != nil {
			fatal("adduser", err)
		}
	default:
		fmt.Fprintf(os.Stderr, "uso: api [serve|migrate|migrate-down|seed|adduser <email> <senha> <admin|viewer>]\n")
		os.Exit(2)
	}
}

func serve(ctx context.Context, cfg *config.Config) error {
	pool, err := db.WaitFor(ctx, cfg.DatabaseURL, 60*time.Second)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer pool.Close()

	// Migration no boot: `docker compose up` sobe tudo sem passo manual.
	if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}

	store, err := storage.New(cfg.MinIO)
	if err != nil {
		return fmt.Errorf("minio: %w", err)
	}
	bucketCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := store.EnsureBucket(bucketCtx, cfg.MinIO.Region); err != nil {
		return fmt.Errorf("minio: %w", err)
	}

	kinds, err := config.LoadKinds(cfg.KindsFile)
	if err != nil {
		return err
	}
	templates, err := config.LoadTemplates(cfg.KindTemplatesFile)
	if err != nil {
		return err
	}

	hub := events.NewHub()
	authSvc := auth.NewService(pool, cfg.SessionTTL)
	if err := authSvc.EnsureAdmin(ctx, cfg.AdminEmail, cfg.AdminPassword); err != nil {
		return fmt.Errorf("admin inicial: %w", err)
	}
	assetSvc := asset.NewService(asset.NewStore(pool), store, hub, kinds, cfg.MaxUploadBytes)
	assetSvc.StartProcessing(ctx, 4)

	if cfg.PollEnabled {
		p := poller.New(assetSvc, poller.Options{
			Interval:    cfg.PollInterval,
			Concurrency: cfg.PollConcurrency,
			Timeout:     cfg.PollTimeout,
			Privileged:  cfg.PollPrivileged,
		})
		go p.Run(ctx)
	} else {
		slog.Warn("poller ICMP desabilitado (POLL_ENABLED=false)")
	}

	go purgeSessions(ctx, authSvc)

	router := newRouter(cfg, pool, store, hub, authSvc, assetSvc, kinds, templates)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("api ouvindo", "addr", cfg.HTTPAddr, "env", cfg.Env)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("desligando api")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

// purgeSessions limpa sessoes vencidas de hora em hora. Sessao vive no
// Postgres, entao restart da API nao derruba ninguem.
func purgeSessions(ctx context.Context, svc *auth.Service) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := svc.PurgeExpired(ctx); err != nil {
				slog.Error("limpando sessoes", "err", err)
			} else if n > 0 {
				slog.Info("sessoes expiradas removidas", "quantidade", n)
			}
		}
	}
}

func setupLogger(env string) {
	level := slog.LevelInfo
	var handler slog.Handler
	if env == "development" {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	} else {
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	}
	slog.SetDefault(slog.New(handler))
}

func fatal(msg string, err error) {
	slog.Error(msg, "err", err)
	os.Exit(1)
}

// runAddUser cria contas pela linha de comando — util para o primeiro viewer
// antes de alguem entrar na interface.
func runAddUser(ctx context.Context, cfg *config.Config, args []string) error {
	if len(args) < 3 {
		return fmt.Errorf("uso: api adduser <email> <senha> <admin|viewer>")
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	svc := auth.NewService(pool, cfg.SessionTTL)
	user, err := svc.CreateUser(ctx, args[0], args[1], auth.Role(args[2]))
	if err != nil {
		return err
	}
	slog.Info("usuario criado", "email", user.Email, "role", user.Role)
	return nil
}
