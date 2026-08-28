package asset

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tiiv/sentinel/internal/apperr"
)

func sampleJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 600, 400))
	for x := 0; x < 600; x++ {
		for y := 0; y < 400; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	buf := &bytes.Buffer{}
	if err := jpeg.Encode(buf, img, nil); err != nil {
		t.Fatalf("gerando jpeg de teste: %v", err)
	}
	return buf.Bytes()
}

func putObject(t *testing.T, url string, body []byte, contentType string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("montando PUT: %v", err)
	}
	req.Header.Set("Content-Type", contentType)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT no storage: %v", err)
	}
	defer res.Body.Close()
	io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

// TestCicloPresignUploadConfirm cobre o fluxo completo de anexo: o arquivo vai
// direto para o MinIO e so os metadados passam pela API.
func TestCicloPresignUploadConfirm(t *testing.T) {
	ctx := context.Background()
	svc, store := newService(t)

	ativo, err := svc.Create(ctx, CreateInput{Name: "OLT-01", Kind: "olt", MgmtIP: ptr("10.0.0.10")})
	if err != nil {
		t.Fatalf("criando ativo: %v", err)
	}
	photo := sampleJPEG(t)

	presign, err := svc.Presign(ctx, ativo.ID, PresignInput{
		Filename: "poste.jpg", MimeType: "image/jpeg", Kind: AttachmentPhoto, SizeBytes: int64(len(photo)),
	})
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	if !strings.HasPrefix(presign.ObjectKey, "assets/"+ativo.ID.String()+"/") {
		t.Fatalf("object_key fora do prefixo do ativo: %s", presign.ObjectKey)
	}

	if code := putObject(t, presign.UploadURL, photo, "image/jpeg"); code != http.StatusOK {
		t.Fatalf("upload direto no storage retornou %d", code)
	}

	att, err := svc.Confirm(ctx, ativo.ID, ConfirmInput{
		ObjectKey: presign.ObjectKey,
		Filename:  "poste.jpg",
		MimeType:  "image/jpeg",
		Kind:      AttachmentPhoto,
		SizeBytes: int64(len(photo)),
	})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if att.SizeBytes != int64(len(photo)) {
		t.Errorf("tamanho gravado %d, esperado %d", att.SizeBytes, len(photo))
	}
	if att.URL == "" {
		t.Error("confirm deveria devolver a URL assinada de leitura")
	}

	// Pos-processamento: thumbnail gravado e sha256 calculado.
	if err := svc.ProcessNow(ctx, att.ID); err != nil {
		t.Fatalf("processando anexo: %v", err)
	}
	processed, err := store.GetAttachment(ctx, att.ID)
	if err != nil {
		t.Fatalf("relendo anexo: %v", err)
	}
	if processed.ThumbKey == nil || *processed.ThumbKey == "" {
		t.Fatal("thumbnail nao foi gerado")
	}
	if processed.SHA256 == nil || len(*processed.SHA256) != 64 {
		t.Fatalf("sha256 invalido: %v", processed.SHA256)
	}

	// A galeria carrega o thumb por presigned GET; ele precisa abrir.
	list, err := svc.Attachments(ctx, ativo.ID)
	if err != nil {
		t.Fatalf("listando anexos: %v", err)
	}
	if len(list) != 1 || list[0].ThumbURL == "" {
		t.Fatalf("anexo deveria expor thumb_url, obtido %#v", list)
	}
	res, err := http.Get(list[0].ThumbURL)
	if err != nil {
		t.Fatalf("GET no thumbnail: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("presigned GET do thumbnail retornou %d", res.StatusCode)
	}

	// Apagar o ativo nao pode deixar objeto orfao no MinIO.
	if err := svc.Delete(ctx, ativo.ID); err != nil {
		t.Fatalf("apagando ativo: %v", err)
	}
	if _, err := svc.storage.Stat(ctx, processed.ObjectKey); err == nil {
		t.Error("objeto original continuou no storage depois do delete")
	}
	if _, err := svc.storage.Stat(ctx, *processed.ThumbKey); err == nil {
		t.Error("thumbnail continuou no storage depois do delete")
	}
}

func TestPresignRecusaMimeForaDaAllowlist(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	ativo, err := svc.Create(ctx, CreateInput{Name: "SW-01", Kind: "switch"})
	if err != nil {
		t.Fatalf("criando ativo: %v", err)
	}

	_, err = svc.Presign(ctx, ativo.ID, PresignInput{
		Filename: "backup.zip", MimeType: "application/zip", Kind: AttachmentDocument, SizeBytes: 10,
	})
	if e, ok := apperr.As(err); !ok || e.Kind != apperr.KindValidation {
		t.Fatalf("mime fora da allowlist deveria dar validacao, obtido %#v", err)
	}
}

func TestConfirmRecusaObjectKeyDeOutroAtivo(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	a, err := svc.Create(ctx, CreateInput{Name: "A", Kind: "switch"})
	if err != nil {
		t.Fatalf("criando A: %v", err)
	}
	b, err := svc.Create(ctx, CreateInput{Name: "B", Kind: "switch"})
	if err != nil {
		t.Fatalf("criando B: %v", err)
	}

	presign, err := svc.Presign(ctx, a.ID, PresignInput{
		Filename: "config.txt", MimeType: "text/plain", Kind: AttachmentConfig, SizeBytes: 12,
	})
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	if code := putObject(t, presign.UploadURL, []byte("/interface\n"), "text/plain"); code != http.StatusOK {
		t.Fatalf("upload retornou %d", code)
	}

	_, err = svc.Confirm(ctx, b.ID, ConfirmInput{
		ObjectKey: presign.ObjectKey, Filename: "config.txt", MimeType: "text/plain",
		Kind: AttachmentConfig, SizeBytes: 12,
	})
	if e, ok := apperr.As(err); !ok || e.Code != "invalid_object_key" {
		t.Fatalf("confirmar anexo de outro ativo deveria falhar, obtido %#v", err)
	}
}

func TestConfirmExigeObjetoNoStorage(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	ativo, err := svc.Create(ctx, CreateInput{Name: "AP-01", Kind: "ap"})
	if err != nil {
		t.Fatalf("criando ativo: %v", err)
	}

	_, err = svc.Confirm(ctx, ativo.ID, ConfirmInput{
		ObjectKey: objectPrefix(ativo.ID) + "inexistente.jpg",
		Filename:  "inexistente.jpg",
		MimeType:  "image/jpeg",
		Kind:      AttachmentPhoto,
		SizeBytes: 100,
	})
	if e, ok := apperr.As(err); !ok || e.Code != "upload_missing" {
		t.Fatalf("confirm sem upload deveria falhar com upload_missing, obtido %#v", err)
	}
}

// TestPresignedURLExpira garante que a URL nao vira link permanente.
func TestPresignedURLExpira(t *testing.T) {
	if testing.Short() {
		t.Skip("depende de espera real de expiracao")
	}
	ctx := context.Background()
	svc, _ := newService(t)
	ativo, err := svc.Create(ctx, CreateInput{Name: "OLT-02", Kind: "olt"})
	if err != nil {
		t.Fatalf("criando ativo: %v", err)
	}
	key := objectPrefix(ativo.ID) + "config.txt"
	if err := svc.storage.Put(ctx, key, strings.NewReader("linha"), 5, "text/plain"); err != nil {
		t.Fatalf("gravando objeto: %v", err)
	}

	url, err := svc.storage.PresignGet(ctx, key, "config.txt", false, 2*time.Second)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	time.Sleep(3 * time.Second)

	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET expirado: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("URL expirada deveria retornar 403, retornou %d", res.StatusCode)
	}
}
