package asset

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiiv/sentinel/internal/events"
)

// newServiceWithPool e o newService do support_test devolvendo tambem o pool:
// favorito depende de um usuario, que nao passa pelo Service.
func newServiceWithPool(t *testing.T) (*Service, *pgxpool.Pool) {
	t.Helper()
	pool := testPool(t)
	svc := NewService(NewStore(pool), testStorage(t), events.NewHub(), testKinds(t), 50<<20)
	return svc, pool
}

func testUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := "tec-" + uuid.NewString() + "@local"
	err := pool.QueryRow(ctx,
		`insert into users (email, password_hash, role) values ($1, 'x', 'viewer') returning id`,
		email,
	).Scan(&id)
	if err != nil {
		t.Fatalf("criando usuario de teste: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `delete from users where id = $1`, id)
	})
	return id
}

func TestFavoritesRoundTrip(t *testing.T) {
	ctx := context.Background()
	svc, pool := newServiceWithPool(t)
	user := testUser(t, ctx, pool)
	pop, sw, _, _ := buildFixture(t, ctx, svc)

	if list, err := svc.Favorites(ctx, user); err != nil || len(list) != 0 {
		t.Fatalf("lista inicial deveria estar vazia: %v %v", list, err)
	}

	if err := svc.AddFavorite(ctx, user, pop); err != nil {
		t.Fatalf("favoritando: %v", err)
	}
	// Idempotente: a fila offline reenvia a mesma operacao depois de falha de rede.
	if err := svc.AddFavorite(ctx, user, pop); err != nil {
		t.Fatalf("favoritar duas vezes deveria ser no-op: %v", err)
	}
	if err := svc.AddFavorite(ctx, user, sw); err != nil {
		t.Fatalf("favoritando segundo ativo: %v", err)
	}

	list, err := svc.Favorites(ctx, user)
	if err != nil {
		t.Fatalf("listando favoritos: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("esperava 2 favoritos, tem %d", len(list))
	}
	// A PWA guarda o payload inteiro: sem nome e kind a lista nao abre offline.
	for _, a := range list {
		if a.Name == "" || a.Kind == "" {
			t.Fatalf("favorito veio sem payload completo: %+v", a)
		}
	}

	if err := svc.RemoveFavorite(ctx, user, pop); err != nil {
		t.Fatalf("desfavoritando: %v", err)
	}
	if err := svc.RemoveFavorite(ctx, user, pop); err != nil {
		t.Fatalf("desfavoritar duas vezes deveria ser no-op: %v", err)
	}
	list, err = svc.Favorites(ctx, user)
	if err != nil {
		t.Fatalf("listando favoritos: %v", err)
	}
	if len(list) != 1 || list[0].ID != sw {
		t.Fatalf("deveria sobrar so o switch, sobrou %+v", list)
	}

	if err := svc.AddFavorite(ctx, user, uuid.New()); err == nil {
		t.Fatal("favoritar ativo inexistente deveria falhar")
	}
}

// attachConfig faz o ciclo real presign -> PUT no storage -> confirm.
func attachConfig(t *testing.T, ctx context.Context, svc *Service, assetID uuid.UUID, text string) *Attachment {
	t.Helper()
	body := []byte(text)
	presign, err := svc.Presign(ctx, assetID, PresignInput{
		Filename: "backup.txt", MimeType: "text/plain", Kind: AttachmentConfig, SizeBytes: int64(len(body)),
	})
	if err != nil {
		t.Fatalf("presign da config: %v", err)
	}
	if code := putObject(t, presign.UploadURL, body, "text/plain"); code != http.StatusOK {
		t.Fatalf("upload da config no storage retornou %d", code)
	}
	att, err := svc.Confirm(ctx, assetID, ConfirmInput{
		ObjectKey: presign.ObjectKey,
		Filename:  "backup.txt",
		MimeType:  "text/plain",
		Kind:      AttachmentConfig,
		SizeBytes: int64(len(body)),
	})
	if err != nil {
		t.Fatalf("confirm da config: %v", err)
	}
	return att
}

// TestOfflinePackage cobre o pacote de POP: subtree completo, anexos assinados
// e estimativa que ignora a foto em resolucao original.
func TestOfflinePackage(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, sw, _, _ := buildFixture(t, ctx, svc)

	// Um POP vizinho nao pode entrar no pacote.
	if _, err := svc.Create(ctx, CreateInput{Name: "POP Norte", Kind: "pop"}); err != nil {
		t.Fatalf("criando segundo POP: %v", err)
	}

	cfgText := strings.Repeat("interface ether1\n", 100)
	att := attachConfig(t, ctx, svc, sw, cfgText)

	pkg, err := svc.Package(ctx, pop)
	if err != nil {
		t.Fatalf("montando pacote: %v", err)
	}
	if pkg.Root.ID != pop {
		t.Fatalf("raiz errada: %v", pkg.Root.ID)
	}
	if len(pkg.Assets) != 4 {
		t.Fatalf("pacote deveria trazer os 4 ativos do subtree, trouxe %d", len(pkg.Assets))
	}
	if len(pkg.Attachments) != 1 || pkg.Attachments[0].ID != att.ID {
		t.Fatalf("pacote deveria trazer o anexo do subtree, trouxe %+v", pkg.Attachments)
	}
	// URL assinada com o endpoint publico: sem ela o config nao baixa no celular.
	if pkg.Attachments[0].URL == "" {
		t.Fatal("anexo do pacote veio sem URL assinada")
	}
	if pkg.EstimatedBytes != int64(len(cfgText)) {
		t.Fatalf("estimativa deveria ser o texto da config (%d), veio %d",
			len(cfgText), pkg.EstimatedBytes)
	}
}

func TestSetGPSFromClient(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, _, _, _ := buildFixture(t, ctx, svc)

	if err := svc.SetGPS(ctx, pop, GPS{Lat: -23.5505, Lon: -46.6333}); err != nil {
		t.Fatalf("gravando GPS: %v", err)
	}
	a, err := svc.store.Get(ctx, pop)
	if err != nil {
		t.Fatalf("relendo ativo: %v", err)
	}
	gps, ok := a.Attrs["gps"].(map[string]any)
	if !ok {
		t.Fatalf("attrs.gps ausente: %+v", a.Attrs)
	}
	if gps["lat"] != -23.5505 || gps["lon"] != -46.6333 {
		t.Fatalf("coordenada gravada errada: %+v", gps)
	}

	if err := svc.SetGPS(ctx, pop, GPS{Lat: 200, Lon: 0}); err == nil {
		t.Fatal("latitude fora de faixa deveria ser rejeitada")
	}
}
