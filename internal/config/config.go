// Package config carrega toda a configuracao a partir de env vars.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type MinIO struct {
	InternalEndpoint string // http://minio:9000  — usado pela API
	PublicEndpoint   string // http://ip-da-vm:9000 — usado para assinar presigned URLs
	AccessKey        string
	SecretKey        string
	Bucket           string
	Region           string
	PresignTTL       time.Duration
}

type Config struct {
	Env               string
	HTTPAddr          string
	DatabaseURL       string
	MinIO             MinIO
	SessionTTL        time.Duration
	CookieSecure      bool
	CookieName        string
	AdminEmail        string
	AdminPassword     string
	CORSOrigins       []string
	KindsFile         string
	KindTemplatesFile string
	MaxUploadBytes    int64
	PollEnabled       bool
	PollInterval      time.Duration
	PollConcurrency   int
	PollTimeout       time.Duration
	PollPrivileged    bool
}

func Load() (*Config, error) {
	c := &Config{
		Env:         env("APP_ENV", "production"),
		HTTPAddr:    env("HTTP_ADDR", ":8080"),
		DatabaseURL: env("DATABASE_URL", ""),
		MinIO: MinIO{
			InternalEndpoint: env("MINIO_INTERNAL_ENDPOINT", "http://minio:9000"),
			PublicEndpoint:   env("MINIO_PUBLIC_ENDPOINT", ""),
			AccessKey:        env("MINIO_ACCESS_KEY", ""),
			SecretKey:        env("MINIO_SECRET_KEY", ""),
			Bucket:           env("MINIO_BUCKET", "sentinel"),
			Region:           env("MINIO_REGION", "us-east-1"),
			PresignTTL:       envDuration("MINIO_PRESIGN_TTL", 15*time.Minute),
		},
		SessionTTL:        envDuration("SESSION_TTL", 30*24*time.Hour),
		CookieSecure:      envBool("COOKIE_SECURE", false),
		CookieName:        env("COOKIE_NAME", "sentinel_session"),
		AdminEmail:        env("ADMIN_EMAIL", ""),
		AdminPassword:     env("ADMIN_PASSWORD", ""),
		CORSOrigins:       envList("CORS_ORIGINS"),
		KindsFile:         env("KINDS_FILE", ""),
		KindTemplatesFile: env("KIND_TEMPLATES_FILE", ""),
		MaxUploadBytes:    int64(envInt("MAX_UPLOAD_BYTES", 50*1024*1024)),
		PollEnabled:       envBool("POLL_ENABLED", true),
		PollInterval:      envDuration("POLL_INTERVAL", 60*time.Second),
		PollConcurrency:   envInt("POLL_CONCURRENCY", 50),
		PollTimeout:       envDuration("POLL_TIMEOUT", 3*time.Second),
		PollPrivileged:    envBool("PING_PRIVILEGED", true),
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL e obrigatoria")
	}
	if c.MinIO.AccessKey == "" || c.MinIO.SecretKey == "" {
		return nil, fmt.Errorf("MINIO_ACCESS_KEY e MINIO_SECRET_KEY sao obrigatorias")
	}
	// Presigned URL assinada com o endpoint interno so funciona de dentro do
	// container. Sem MINIO_PUBLIC_ENDPOINT nao ha como acertar isso, entao falha
	// no boot em vez de gerar URLs quebradas em producao.
	if c.MinIO.PublicEndpoint == "" {
		return nil, fmt.Errorf("MINIO_PUBLIC_ENDPOINT e obrigatoria (endereco que o navegador alcanca)")
	}
	for _, raw := range []string{c.MinIO.InternalEndpoint, c.MinIO.PublicEndpoint} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return nil, fmt.Errorf("endpoint MinIO invalido %q: use http(s)://host:porta", raw)
		}
	}
	if c.PollConcurrency < 1 {
		c.PollConcurrency = 1
	}
	return c, nil
}

// SplitEndpoint devolve host:porta e se o esquema e https, no formato exigido
// pelo cliente minio-go.
func SplitEndpoint(raw string) (host string, secure bool, err error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", false, err
	}
	return u.Host, u.Scheme == "https", nil
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return b
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return n
}

func envDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return d
}

func envList(key string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
