package asset

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
	"github.com/tiiv/sentinel/internal/events"
	"github.com/tiiv/sentinel/internal/media"
	"github.com/tiiv/sentinel/internal/storage"
)

// Allowlist de mime por tipo de anexo. Foto de campo, config em texto e
// documento em PDF cobrem o uso real; o resto fica de fora de proposito.
var allowedMIME = map[string]map[string]string{
	AttachmentPhoto: {
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/webp": ".webp",
	},
	AttachmentConfig: {
		"text/plain": ".txt",
	},
	AttachmentDocument: {
		"application/pdf": ".pdf",
		"text/plain":      ".txt",
	},
}

// maxProcessBytes limita o que a API le em memoria ao gerar thumbnail.
const maxProcessBytes = 40 << 20

type PresignInput struct {
	Filename  string `json:"filename"`
	MimeType  string `json:"mime_type"`
	Kind      string `json:"kind"`
	SizeBytes int64  `json:"size_bytes"`
}

type PresignOutput struct {
	UploadURL string    `json:"upload_url"`
	ObjectKey string    `json:"object_key"`
	ExpiresAt time.Time `json:"expires_at"`
	MaxBytes  int64     `json:"max_bytes"`
}

// GPS e a coordenada da foto. A PWA comprime a imagem antes de subir e o EXIF
// nao sobrevive a recompressao, entao a coordenada — o unico metadado que
// interessa — vem no corpo do confirm.
type GPS struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type ConfirmInput struct {
	ObjectKey  string     `json:"object_key"`
	Filename   string     `json:"filename"`
	MimeType   string     `json:"mime_type"`
	Kind       string     `json:"kind"`
	SizeBytes  int64      `json:"size_bytes"`
	SHA256     *string    `json:"sha256"`
	CapturedAt *time.Time `json:"captured_at"`
	// Campo opcional: cliente antigo que nao envia continua funcionando.
	GPS *GPS `json:"gps"`
}

// Presign devolve a URL de upload direto para o MinIO. O arquivo nunca passa
// pela API: e isso que mantem o backend leve com foto de 10MB.
func (s *Service) Presign(ctx context.Context, assetID uuid.UUID, in PresignInput) (*PresignOutput, error) {
	if _, err := s.store.Get(ctx, assetID); err != nil {
		return nil, err
	}
	ext, err := s.validateAttachment(in.Kind, in.MimeType, in.SizeBytes)
	if err != nil {
		return nil, err
	}
	if e := strings.ToLower(filepath.Ext(in.Filename)); e != "" && len(e) <= 6 {
		ext = e
	}
	key := objectPrefix(assetID) + uuid.NewString() + ext
	url, err := s.storage.PresignPut(ctx, key, s.storage.TTL())
	if err != nil {
		return nil, apperr.Internal(err, "gerando URL de upload")
	}
	return &PresignOutput{
		UploadURL: url,
		ObjectKey: key,
		ExpiresAt: time.Now().Add(s.storage.TTL()),
		MaxBytes:  s.maxBytes,
	}, nil
}

// Confirm grava os metadados depois que o cliente subiu o arquivo. Confere no
// MinIO se o objeto existe mesmo e qual o tamanho real.
func (s *Service) Confirm(ctx context.Context, assetID uuid.UUID, in ConfirmInput) (*Attachment, error) {
	if _, err := s.store.Get(ctx, assetID); err != nil {
		return nil, err
	}
	if _, err := s.validateAttachment(in.Kind, in.MimeType, in.SizeBytes); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(in.ObjectKey, objectPrefix(assetID)) {
		return nil, apperr.Validation("invalid_object_key", "object_key nao pertence a este ativo")
	}
	if strings.TrimSpace(in.Filename) == "" {
		return nil, apperr.Validation("invalid_filename", "filename e obrigatorio")
	}
	info, err := s.storage.Stat(ctx, in.ObjectKey)
	if err != nil {
		if storage.IsNotFound(err) {
			return nil, apperr.Validation("upload_missing", "objeto nao encontrado no storage; refaca o upload")
		}
		return nil, apperr.Internal(err, "consultando objeto no storage")
	}
	if info.Size > s.maxBytes {
		_ = s.storage.Remove(ctx, in.ObjectKey)
		return nil, apperr.Validation("too_large", "arquivo excede o limite de %d bytes", s.maxBytes)
	}

	att, err := s.store.InsertAttachment(ctx, Attachment{
		AssetID:    assetID,
		Kind:       in.Kind,
		ObjectKey:  in.ObjectKey,
		Filename:   filepath.Base(strings.TrimSpace(in.Filename)),
		MimeType:   in.MimeType,
		SizeBytes:  info.Size,
		SHA256:     in.SHA256,
		CapturedAt: in.CapturedAt,
	})
	if err != nil {
		return nil, err
	}
	// GPS do cliente entra antes do pos-processamento: a imagem ja veio sem EXIF
	// e o processImage nao teria de onde extrair a coordenada.
	if in.GPS != nil {
		if err := s.SetGPS(ctx, assetID, *in.GPS); err != nil {
			logWarn("falha gravando GPS informado pelo cliente", err)
		}
	}

	s.enqueue(att.ID)
	s.signAttachment(ctx, att)
	s.hub.Publish(events.Event{Type: events.TypeAttachmentAdded, Data: att})
	return att, nil
}

func (s *Service) Attachments(ctx context.Context, assetID uuid.UUID) ([]Attachment, error) {
	list, err := s.store.ListAttachments(ctx, assetID)
	if err != nil {
		return nil, err
	}
	out := make([]Attachment, 0, len(list))
	for i := range list {
		s.signAttachment(ctx, &list[i])
		out = append(out, list[i])
	}
	return out, nil
}

// URL devolve o presigned GET de um anexo. download=true forca o "salvar como".
func (s *Service) AttachmentURL(ctx context.Context, id uuid.UUID, download bool) (string, time.Time, error) {
	att, err := s.store.GetAttachment(ctx, id)
	if err != nil {
		return "", time.Time{}, err
	}
	url, err := s.storage.PresignGet(ctx, att.ObjectKey, att.Filename, download, s.storage.TTL())
	if err != nil {
		return "", time.Time{}, apperr.Internal(err, "gerando URL de download")
	}
	return url, time.Now().Add(s.storage.TTL()), nil
}

func (s *Service) DeleteAttachment(ctx context.Context, id uuid.UUID) error {
	att, err := s.store.DeleteAttachment(ctx, id)
	if err != nil {
		return err
	}
	keys := []string{att.ObjectKey}
	if att.ThumbKey != nil {
		keys = append(keys, *att.ThumbKey)
	}
	if err := s.storage.Remove(ctx, keys...); err != nil {
		logWarn("falha removendo objeto do anexo", err)
	}
	s.hub.Publish(events.Event{Type: events.TypeAttachmentRemoved, Data: map[string]any{
		"id": att.ID, "asset_id": att.AssetID,
	}})
	return nil
}

func (s *Service) signAttachment(ctx context.Context, att *Attachment) {
	url, err := s.storage.PresignGet(ctx, att.ObjectKey, att.Filename, false, s.storage.TTL())
	if err != nil {
		logWarn("falha assinando URL do anexo", err)
		return
	}
	att.URL = url
	if att.ThumbKey != nil && *att.ThumbKey != "" {
		if turl, err := s.storage.PresignGet(ctx, *att.ThumbKey, "", false, s.storage.TTL()); err == nil {
			att.ThumbURL = turl
		}
	}
}

func (s *Service) validateAttachment(kind, mime string, size int64) (string, error) {
	allowed, ok := allowedMIME[kind]
	if !ok {
		return "", apperr.Validation("invalid_attachment_kind", "tipo de anexo deve ser photo, config ou document")
	}
	ext, ok := allowed[strings.ToLower(strings.TrimSpace(mime))]
	if !ok {
		return "", apperr.Validation("invalid_mime", "mime %q nao permitido para anexo do tipo %s", mime, kind)
	}
	if size < 0 {
		return "", apperr.Validation("invalid_size", "size_bytes invalido")
	}
	if size > s.maxBytes {
		return "", apperr.Validation("too_large", "arquivo excede o limite de %d bytes", s.maxBytes)
	}
	return ext, nil
}

func logWarn(msg string, err error) { slog.Warn(msg, "err", err) }

// StartProcessing sobe os workers que fazem o pos-processamento de anexo:
// thumbnail, GPS do EXIF e sha256. Fica fora do caminho do request.
func (s *Service) StartProcessing(ctx context.Context, workers int) {
	if workers < 1 {
		workers = 1
	}
	for i := 0; i < workers; i++ {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case id := <-s.jobs:
					jobCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
					if err := s.process(jobCtx, id); err != nil {
						slog.Error("processando anexo", "attachment_id", id, "err", err)
					}
					cancel()
				}
			}
		}()
	}
}

func (s *Service) enqueue(id uuid.UUID) {
	select {
	case s.jobs <- id:
	default:
		slog.Warn("fila de processamento cheia, anexo fica sem thumbnail", "attachment_id", id)
	}
}

// ProcessNow roda o pos-processamento de forma sincrona. Usado nos testes e no
// reprocessamento manual.
func (s *Service) ProcessNow(ctx context.Context, id uuid.UUID) error { return s.process(ctx, id) }

func (s *Service) process(ctx context.Context, id uuid.UUID) error {
	att, err := s.store.GetAttachment(ctx, id)
	if err != nil {
		return err
	}
	if media.IsImage(att.MimeType) {
		return s.processImage(ctx, att)
	}
	return s.processFile(ctx, att)
}

// processImage baixa a imagem do MinIO, extrai o GPS, reescreve o original sem
// metadados e grava o thumbnail que a galeria carrega.
func (s *Service) processImage(ctx context.Context, att *Attachment) error {
	data, err := s.download(ctx, att.ObjectKey)
	if err != nil {
		return err
	}
	res, err := media.Process(data, att.MimeType)
	if err != nil {
		return err
	}

	size := att.SizeBytes
	sum := sha256Hex(data)
	if res.Sanitized != nil {
		if err := s.storage.Put(ctx, att.ObjectKey, bytes.NewReader(res.Sanitized),
			int64(len(res.Sanitized)), res.SanitizedMIME); err != nil {
			return fmt.Errorf("regravando imagem sem metadados: %w", err)
		}
		size = int64(len(res.Sanitized))
		sum = sha256Hex(res.Sanitized)
	}

	thumbKey := strings.TrimSuffix(att.ObjectKey, filepath.Ext(att.ObjectKey)) + "_thumb.jpg"
	if err := s.storage.Put(ctx, thumbKey, bytes.NewReader(res.Thumb),
		int64(len(res.Thumb)), "image/jpeg"); err != nil {
		return fmt.Errorf("gravando thumbnail: %w", err)
	}

	captured := res.CapturedAt
	if att.CapturedAt != nil {
		captured = att.CapturedAt
	}
	if err := s.store.SetAttachmentProcessed(ctx, att.ID, &thumbKey, &size, &sum, captured); err != nil {
		return err
	}

	if res.GPS != nil {
		if err := s.store.SetGPS(ctx, att.AssetID, res.GPS.Lat, res.GPS.Lon); err != nil {
			return err
		}
	}
	if updated, err := s.store.Get(ctx, att.AssetID); err == nil {
		s.hub.Publish(events.Event{Type: events.TypeAssetUpdated, Data: updated})
	}
	return nil
}

// processFile confere o sha256 de config/documento. Para kind=config e isso que
// permite detectar mudanca de configuracao sem diff completo.
func (s *Service) processFile(ctx context.Context, att *Attachment) error {
	rc, err := s.storage.Get(ctx, att.ObjectKey)
	if err != nil {
		return fmt.Errorf("lendo objeto: %w", err)
	}
	defer rc.Close()

	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(rc, maxProcessBytes)); err != nil {
		return fmt.Errorf("calculando sha256: %w", err)
	}
	sum := hex.EncodeToString(h.Sum(nil))
	if att.SHA256 != nil && *att.SHA256 != "" && !strings.EqualFold(*att.SHA256, sum) {
		slog.Warn("sha256 informado pelo cliente diverge do objeto",
			"attachment_id", att.ID, "cliente", *att.SHA256, "storage", sum)
	}
	return s.store.SetAttachmentProcessed(ctx, att.ID, nil, nil, &sum, nil)
}

func (s *Service) download(ctx context.Context, key string) ([]byte, error) {
	rc, err := s.storage.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("lendo objeto: %w", err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxProcessBytes))
	if err != nil {
		return nil, fmt.Errorf("baixando objeto: %w", err)
	}
	return data, nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
