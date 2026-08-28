// Package storage encapsula o MinIO. Arquivo de usuario nunca trafega pela API:
// o cliente sobe direto via presigned PUT e baixa via presigned GET. Os unicos
// bytes que passam por aqui sao os do processamento de imagem (thumbnail).
package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/tiiv/sentinel/internal/config"
)

type Store struct {
	internal *minio.Client // fala com o MinIO pela rede do Docker
	public   *minio.Client // so assina URLs, com o host que o navegador alcanca
	bucket   string
	ttl      time.Duration
}

func New(cfg config.MinIO) (*Store, error) {
	internal, err := client(cfg.InternalEndpoint, cfg)
	if err != nil {
		return nil, fmt.Errorf("cliente interno: %w", err)
	}
	public, err := client(cfg.PublicEndpoint, cfg)
	if err != nil {
		return nil, fmt.Errorf("cliente publico: %w", err)
	}
	return &Store{internal: internal, public: public, bucket: cfg.Bucket, ttl: cfg.PresignTTL}, nil
}

func client(endpoint string, cfg config.MinIO) (*minio.Client, error) {
	host, secure, err := config.SplitEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	return minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: secure,
		Region: cfg.Region, // fixar a regiao evita lookup de rede ao assinar
	})
}

func (s *Store) Bucket() string     { return s.bucket }
func (s *Store) TTL() time.Duration { return s.ttl }

// EnsureBucket cria o bucket no boot se nao existir. Nao aplicamos policy
// anonima: todo acesso e por presigned URL.
func (s *Store) EnsureBucket(ctx context.Context, region string) error {
	exists, err := s.internal.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("verificando bucket: %w", err)
	}
	if exists {
		return nil
	}
	if err := s.internal.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{Region: region}); err != nil {
		// Corrida entre replicas no boot: se ja existe, segue.
		if exists, errEx := s.internal.BucketExists(ctx, s.bucket); errEx == nil && exists {
			return nil
		}
		return fmt.Errorf("criando bucket: %w", err)
	}
	return nil
}

func (s *Store) Health(ctx context.Context) error {
	if _, err := s.internal.BucketExists(ctx, s.bucket); err != nil {
		return err
	}
	return nil
}

// PresignPut devolve a URL de upload direto, assinada com o endpoint publico.
func (s *Store) PresignPut(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := s.public.PresignedPutObject(ctx, s.bucket, key, ttl)
	if err != nil {
		return "", fmt.Errorf("presign put: %w", err)
	}
	return u.String(), nil
}

// PresignGet devolve a URL de leitura. filename define o nome sugerido e
// download alterna entre inline (visualizar) e attachment (baixar).
func (s *Store) PresignGet(ctx context.Context, key, filename string, download bool, ttl time.Duration) (string, error) {
	params := url.Values{}
	if filename != "" {
		disp := "inline"
		if download {
			disp = "attachment"
		}
		params.Set("response-content-disposition", fmt.Sprintf("%s; filename=%q", disp, filename))
	}
	u, err := s.public.PresignedGetObject(ctx, s.bucket, key, ttl, params)
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return u.String(), nil
}

type ObjectInfo struct {
	Size        int64
	ContentType string
	ETag        string
}

func (s *Store) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	info, err := s.internal.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{Size: info.Size, ContentType: info.ContentType, ETag: info.ETag}, nil
}

func IsNotFound(err error) bool {
	return minio.ToErrorResponse(err).Code == "NoSuchKey"
}

func (s *Store) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.internal.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

func (s *Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := s.internal.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (s *Store) Remove(ctx context.Context, keys ...string) error {
	for _, key := range keys {
		if key == "" {
			continue
		}
		if err := s.internal.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
			return fmt.Errorf("removendo %s: %w", key, err)
		}
	}
	return nil
}

// RemovePrefix limpa todos os objetos de um prefixo (usado ao apagar um ativo,
// para nao deixar orfao no MinIO).
func (s *Store) RemovePrefix(ctx context.Context, prefix string) error {
	objects := s.internal.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true})
	for err := range s.internal.RemoveObjects(ctx, s.bucket, objects, minio.RemoveObjectsOptions{}) {
		return fmt.Errorf("removendo prefixo %s: %w", prefix, err.Err)
	}
	return nil
}
