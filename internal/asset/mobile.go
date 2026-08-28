package asset

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
)

// thumbEstimateBytes e o tamanho tipico de um thumbnail (480px q78) gerado pelo
// pos-processamento. Serve para mostrar o tamanho do pacote offline antes de
// baixar sem precisar de um STAT no MinIO por foto.
const thumbEstimateBytes int64 = 45 << 10

// OfflinePackage e o que a PWA baixa para trabalhar dentro de um armario de
// rede sem sinal: o subtree inteiro, os anexos e as URLs assinadas. Foto em
// resolucao original fica de fora — o cliente baixa so thumbnail e config.
type OfflinePackage struct {
	Root        Asset        `json:"root"`
	GeneratedAt time.Time    `json:"generated_at"`
	Assets      []Asset      `json:"assets"`
	Attachments []Attachment `json:"attachments"`
	// EstimatedBytes cobre o que o cliente realmente vai baixar: texto integral
	// das configs mais uma estimativa dos thumbnails.
	EstimatedBytes int64 `json:"estimated_bytes"`
}

func (s *Service) Package(ctx context.Context, rootID uuid.UUID) (*OfflinePackage, error) {
	root, err := s.store.Get(ctx, rootID)
	if err != nil {
		return nil, err
	}
	assets, err := s.store.Subtree(ctx, &rootID, nil)
	if err != nil {
		return nil, err
	}
	attachments, err := s.store.SubtreeAttachments(ctx, rootID)
	if err != nil {
		return nil, err
	}

	var estimated int64
	for i := range attachments {
		s.signAttachment(ctx, &attachments[i])
		switch attachments[i].Kind {
		case AttachmentConfig:
			estimated += attachments[i].SizeBytes
		case AttachmentPhoto:
			if attachments[i].ThumbKey != nil && *attachments[i].ThumbKey != "" {
				estimated += thumbEstimateBytes
			}
		}
	}

	return &OfflinePackage{
		Root:           *root,
		GeneratedAt:    time.Now().UTC(),
		Assets:         emptyIfNil(assets),
		Attachments:    attachments,
		EstimatedBytes: estimated,
	}, nil
}

// Favorites devolve o ativo completo, nao so o id: a PWA guarda o payload
// inteiro em IndexedDB para a lista abrir sem rede.
func (s *Service) Favorites(ctx context.Context, userID uuid.UUID) ([]Asset, error) {
	list, err := s.store.Favorites(ctx, userID)
	if err != nil {
		return nil, err
	}
	return emptyIfNil(list), nil
}

// AddFavorite e idempotente de proposito: a fila offline pode reenviar a mesma
// operacao depois de uma falha de rede.
func (s *Service) AddFavorite(ctx context.Context, userID, assetID uuid.UUID) error {
	if _, err := s.store.Get(ctx, assetID); err != nil {
		return err
	}
	return s.store.AddFavorite(ctx, userID, assetID)
}

func (s *Service) RemoveFavorite(ctx context.Context, userID, assetID uuid.UUID) error {
	return s.store.RemoveFavorite(ctx, userID, assetID)
}

// SetGPS grava a coordenada da foto em attrs.gps. Vem do cliente porque a PWA
// comprime a imagem antes de subir e o EXIF nao sobrevive a recompressao — a
// coordenada e o unico metadado que interessa preservar.
func (s *Service) SetGPS(ctx context.Context, assetID uuid.UUID, gps GPS) error {
	if gps.Lat < -90 || gps.Lat > 90 || gps.Lon < -180 || gps.Lon > 180 {
		return apperr.Validation("invalid_gps", "coordenada fora de faixa")
	}
	return s.store.SetGPS(ctx, assetID, gps.Lat, gps.Lon)
}
