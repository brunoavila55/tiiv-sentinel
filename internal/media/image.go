// Package media processa imagens no servidor: extrai o GPS do EXIF, remove o
// restante dos metadados e gera o thumbnail que a galeria carrega.
package media

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"time"

	"github.com/disintegration/imaging"
	"github.com/rwcarlsen/goexif/exif"
	_ "golang.org/x/image/webp" // decode de webp

	"github.com/tiiv/sentinel/internal/apperr"
)

const (
	// ThumbMaxSide e o lado maior do thumbnail servido na galeria.
	ThumbMaxSide = 480
	// MaxSide limita a imagem original guardada; foto de celular de 12MP nao
	// acrescenta nada a documentacao de campo.
	MaxSide      = 2560
	thumbQuality = 78
	imageQuality = 88
)

type GPS struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type Result struct {
	// Sanitized e a imagem reescrita sem metadados. Nil quando o formato nao
	// permite reescrever com seguranca — nesse caso o original e preservado.
	Sanitized     []byte
	SanitizedMIME string
	Thumb         []byte
	GPS           *GPS
	CapturedAt    *time.Time
	Width         int
	Height        int
}

func IsImage(mime string) bool {
	switch mime {
	case "image/jpeg", "image/png", "image/webp":
		return true
	}
	return false
}

// Process le a imagem inteira em memoria: e a unica etapa do sistema em que
// bytes de arquivo passam pela API, e roda fora do caminho do request.
func Process(data []byte, mime string) (*Result, error) {
	res := &Result{}

	// EXIF primeiro: o re-encode abaixo descarta todos os metadados.
	if mime == "image/jpeg" {
		if x, err := exif.Decode(bytes.NewReader(data)); err == nil {
			res.GPS = gpsFrom(x)
			res.CapturedAt = capturedAt(x)
		}
	}

	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return nil, apperr.Validation("invalid_image", "imagem invalida ou corrompida: %v", err)
	}
	bounds := img.Bounds()
	res.Width, res.Height = bounds.Dx(), bounds.Dy()

	thumb := imaging.Fit(img, ThumbMaxSide, ThumbMaxSide, imaging.Lanczos)
	buf := &bytes.Buffer{}
	if err := jpeg.Encode(buf, thumb, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return nil, fmt.Errorf("codificando thumbnail: %w", err)
	}
	res.Thumb = buf.Bytes()

	sanitized, sanitizedMIME, err := sanitize(img, mime, res.Width, res.Height)
	if err != nil {
		return nil, err
	}
	res.Sanitized, res.SanitizedMIME = sanitized, sanitizedMIME
	return res, nil
}

// sanitize reescreve a imagem sem metadados. Webp nao tem encoder em Go puro,
// entao o original fica como esta (webp de camera nao carrega EXIF de GPS).
func sanitize(img image.Image, mime string, w, h int) ([]byte, string, error) {
	out := img
	if w > MaxSide || h > MaxSide {
		out = imaging.Fit(img, MaxSide, MaxSide, imaging.Lanczos)
	}
	buf := &bytes.Buffer{}
	switch mime {
	case "image/jpeg":
		if err := jpeg.Encode(buf, out, &jpeg.Options{Quality: imageQuality}); err != nil {
			return nil, "", fmt.Errorf("recodificando jpeg: %w", err)
		}
		return buf.Bytes(), "image/jpeg", nil
	case "image/png":
		enc := png.Encoder{CompressionLevel: png.DefaultCompression}
		if err := enc.Encode(buf, out); err != nil {
			return nil, "", fmt.Errorf("recodificando png: %w", err)
		}
		return buf.Bytes(), "image/png", nil
	default:
		return nil, "", nil
	}
}

func gpsFrom(x *exif.Exif) *GPS {
	lat, lon, err := x.LatLong()
	if err != nil || (lat == 0 && lon == 0) {
		return nil
	}
	if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return nil
	}
	return &GPS{Lat: lat, Lon: lon}
}

func capturedAt(x *exif.Exif) *time.Time {
	t, err := x.DateTime()
	if err != nil || t.IsZero() {
		return nil
	}
	return &t
}

var ErrUnsupported = errors.New("formato de imagem nao suportado")
