package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"

	"github.com/disintegration/imaging"
)

func jpegDe(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: 90, B: uint8(y % 255), A: 255})
		}
	}
	buf := &bytes.Buffer{}
	if err := jpeg.Encode(buf, img, nil); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

func TestProcessGeraThumbnailDentroDoLimite(t *testing.T) {
	res, err := Process(jpegDe(t, 1200, 900), "image/jpeg")
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	thumb, err := imaging.Decode(bytes.NewReader(res.Thumb))
	if err != nil {
		t.Fatalf("thumb invalido: %v", err)
	}
	b := thumb.Bounds()
	if b.Dx() > ThumbMaxSide || b.Dy() > ThumbMaxSide {
		t.Fatalf("thumb %dx%d excede %d", b.Dx(), b.Dy(), ThumbMaxSide)
	}
	if len(res.Thumb) >= len(res.Sanitized) {
		t.Error("thumbnail deveria ser menor que o original")
	}
}

func TestProcessReduzImagemMuitoGrande(t *testing.T) {
	res, err := Process(jpegDe(t, MaxSide+800, 600), "image/jpeg")
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	img, err := imaging.Decode(bytes.NewReader(res.Sanitized))
	if err != nil {
		t.Fatalf("original sanitizado invalido: %v", err)
	}
	if img.Bounds().Dx() > MaxSide {
		t.Fatalf("largura %d excede o limite %d", img.Bounds().Dx(), MaxSide)
	}
}

func TestProcessRejeitaArquivoQueNaoEImagem(t *testing.T) {
	if _, err := Process([]byte("isto nao e uma imagem"), "image/jpeg"); err == nil {
		t.Fatal("conteudo invalido deveria falhar")
	}
}

func TestIsImage(t *testing.T) {
	for mime, want := range map[string]bool{
		"image/jpeg":      true,
		"image/png":       true,
		"image/webp":      true,
		"text/plain":      false,
		"application/pdf": false,
	} {
		if got := IsImage(mime); got != want {
			t.Errorf("IsImage(%q) = %v", mime, got)
		}
	}
}
