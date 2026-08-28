package main

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiiv/sentinel/internal/asset"
	"github.com/tiiv/sentinel/internal/auth"
	"github.com/tiiv/sentinel/internal/config"
	"github.com/tiiv/sentinel/internal/events"
	"github.com/tiiv/sentinel/internal/httpx"
	"github.com/tiiv/sentinel/internal/storage"
)

func newRouter(
	cfg *config.Config,
	pool *pgxpool.Pool,
	store *storage.Store,
	hub *events.Hub,
	authSvc *auth.Service,
	assetSvc *asset.Service,
	kinds *config.Kinds,
	templates *config.Templates,
) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)

	// CORS existe so para o `vite dev` em outra porta; em producao o nginx serve
	// front e API na mesma origem e a lista fica vazia.
	if len(cfg.CORSOrigins) > 0 {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   cfg.CORSOrigins,
			AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Content-Type", "Accept"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	authHandler := auth.NewHandler(authSvc, cfg.CookieName, cfg.CookieSecure, cfg.SessionTTL)
	assetHandler := asset.NewHandler(assetSvc, authHandler)

	r.Get("/healthz", healthz(pool, store))

	r.Route("/api", func(r chi.Router) {
		r.Route("/auth", authHandler.Routes)

		// SSE fica fora do timeout: a conexao e longa por natureza.
		r.With(authHandler.RequireUser).Get("/events", hub.Handler())

		r.Group(func(r chi.Router) {
			r.Use(authHandler.RequireUser)
			r.Use(middleware.Timeout(30 * time.Second))
			r.Get("/config", func(w http.ResponseWriter, r *http.Request) {
				httpx.JSON(w, http.StatusOK, map[string]any{
					"kinds":          kinds.Kinds,
					"kind_templates": templates.Templates,
					"max_upload":     cfg.MaxUploadBytes,
					"poll_interval":  cfg.PollInterval.Seconds(),
					"poll_enabled":   cfg.PollEnabled,
				})
			})
			assetHandler.Routes(r)
		})
	})

	return r
}

// healthz valida conectividade com Postgres e MinIO — nao e um 200 vazio.
func healthz(pool *pgxpool.Pool, store *storage.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		checks := map[string]string{"postgres": "ok", "minio": "ok"}
		status := http.StatusOK

		if err := pool.Ping(ctx); err != nil {
			checks["postgres"] = err.Error()
			status = http.StatusServiceUnavailable
		}
		if err := store.Health(ctx); err != nil {
			checks["minio"] = err.Error()
			status = http.StatusServiceUnavailable
		}

		body := map[string]any{"status": "ok", "checks": checks}
		if status != http.StatusOK {
			body["status"] = "degraded"
		}
		httpx.JSON(w, status, body)
	}
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		// Log estruturado, sem corpo: upload nao entra no log.
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"bytes", ww.BytesWritten(),
			"duracao_ms", time.Since(started).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}
