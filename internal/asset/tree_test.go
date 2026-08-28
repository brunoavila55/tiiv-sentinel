package asset

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
)

// buildFixture cria POP > switch > OLT > cliente e devolve os ids na ordem.
func buildFixture(t *testing.T, ctx context.Context, svc *Service) (pop, sw, olt, cliente uuid.UUID) {
	t.Helper()
	create := func(name, kind string, parent *uuid.UUID) uuid.UUID {
		a, err := svc.Create(ctx, CreateInput{Name: name, Kind: kind, ParentID: parent})
		if err != nil {
			t.Fatalf("criando %s: %v", name, err)
		}
		return a.ID
	}
	pop = create("POP Centro", "pop", nil)
	sw = create("SW-01", "switch", &pop)
	olt = create("OLT-01", "olt", &sw)
	cliente = create("Cliente 1", "cliente", &olt)
	return
}

func TestSubtreeCTE(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, sw, olt, cliente := buildFixture(t, ctx, svc)

	// Um segundo POP nao pode aparecer no subtree do primeiro.
	if _, err := svc.Create(ctx, CreateInput{Name: "POP Norte", Kind: "pop"}); err != nil {
		t.Fatalf("criando segundo POP: %v", err)
	}

	items, err := svc.Tree(ctx, &pop, nil)
	if err != nil {
		t.Fatalf("subtree: %v", err)
	}
	if len(items) != 4 {
		t.Fatalf("subtree deveria ter 4 ativos, tem %d", len(items))
	}

	depths := map[uuid.UUID]int{}
	for _, item := range items {
		depths[item.ID] = item.Depth
	}
	for id, want := range map[uuid.UUID]int{pop: 0, sw: 1, olt: 2, cliente: 3} {
		if got := depths[id]; got != want {
			t.Errorf("profundidade de %s: esperado %d, obtido %d", id, want, got)
		}
	}

	// Sem raiz a CTE parte das raizes e traz a arvore inteira.
	all, err := svc.Tree(ctx, nil, nil)
	if err != nil {
		t.Fatalf("arvore completa: %v", err)
	}
	if len(all) != 5 {
		t.Fatalf("arvore completa deveria ter 5 ativos, tem %d", len(all))
	}

	// Limite de profundidade corta o subtree.
	shallow, err := svc.Tree(ctx, &pop, ptr(1))
	if err != nil {
		t.Fatalf("subtree com depth=1: %v", err)
	}
	if len(shallow) != 2 {
		t.Fatalf("subtree com depth=1 deveria ter 2 ativos, tem %d", len(shallow))
	}
}

func TestBreadcrumbSobeAteARaiz(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, sw, olt, cliente := buildFixture(t, ctx, svc)

	detail, err := svc.Detail(ctx, cliente)
	if err != nil {
		t.Fatalf("detalhe: %v", err)
	}
	want := []uuid.UUID{pop, sw, olt}
	if len(detail.Breadcrumb) != len(want) {
		t.Fatalf("breadcrumb deveria ter %d ancestrais, tem %d", len(want), len(detail.Breadcrumb))
	}
	for i, id := range want {
		if detail.Breadcrumb[i].ID != id {
			t.Errorf("breadcrumb[%d] = %s, esperado %s", i, detail.Breadcrumb[i].ID, id)
		}
	}
}

func TestMoveValidaCiclo(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, sw, olt, _ := buildFixture(t, ctx, svc)

	// Mover o POP para dentro do proprio subtree cria um ciclo.
	for _, destino := range []uuid.UUID{sw, olt} {
		if _, err := svc.Move(ctx, pop, &destino); err == nil {
			t.Fatalf("mover POP para %s deveria falhar", destino)
		} else if e, ok := apperr.As(err); !ok || e.Kind != apperr.KindValidation || e.Code != "cycle" {
			t.Fatalf("erro esperado de validacao/cycle, obtido %#v", err)
		}
	}

	// Ser pai de si mesmo tambem e ciclo.
	if _, err := svc.Move(ctx, sw, &sw); err == nil {
		t.Fatal("mover ativo para si mesmo deveria falhar")
	}

	// Movimento legitimo: OLT passa a pendurar direto no POP.
	moved, err := svc.Move(ctx, olt, &pop)
	if err != nil {
		t.Fatalf("movimento valido falhou: %v", err)
	}
	if moved.ParentID == nil || *moved.ParentID != pop {
		t.Fatalf("parent_id apos o move = %v, esperado %s", moved.ParentID, pop)
	}

	// E virar raiz e permitido.
	if _, err := svc.Move(ctx, olt, nil); err != nil {
		t.Fatalf("mover para raiz falhou: %v", err)
	}
}

func TestDeleteRecusaAtivoComFilhos(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, sw, _, _ := buildFixture(t, ctx, svc)

	err := svc.Delete(ctx, pop)
	if e, ok := apperr.As(err); !ok || e.Kind != apperr.KindConflict {
		t.Fatalf("apagar POP com filhos deveria dar conflito, obtido %#v", err)
	}
	if err := svc.Delete(ctx, sw); err == nil {
		t.Fatal("apagar switch com filhos deveria dar conflito")
	}
}

func TestBuscaPriorizaIPExato(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)

	if _, err := svc.Create(ctx, CreateInput{
		Name: "Switch com IP no nome 10.0.0.10", Kind: "switch", MgmtIP: ptr("10.0.0.99"),
	}); err != nil {
		t.Fatalf("criando isca: %v", err)
	}
	alvo, err := svc.Create(ctx, CreateInput{Name: "OLT do bairro", Kind: "olt", MgmtIP: ptr("10.0.0.10")})
	if err != nil {
		t.Fatalf("criando alvo: %v", err)
	}

	results, err := svc.Search(ctx, "10.0.0.10", 10)
	if err != nil {
		t.Fatalf("busca: %v", err)
	}
	if len(results) < 2 {
		t.Fatalf("busca deveria achar os dois ativos, achou %d", len(results))
	}
	if results[0].ID != alvo.ID {
		t.Fatalf("match exato de IP deveria vir primeiro, veio %q", results[0].Name)
	}
}

func TestSupressaoEmCascata(t *testing.T) {
	ctx := context.Background()
	svc, store := newService(t)
	pop, sw, olt, _ := buildFixture(t, ctx, svc)

	if err := svc.SetStatus(ctx, pop, StatusUnknown, StatusDown); err != nil {
		t.Fatalf("marcando POP como down: %v", err)
	}
	if err := svc.SetStatus(ctx, sw, StatusUnknown, StatusDown); err != nil {
		t.Fatalf("marcando switch como down: %v", err)
	}

	causa, err := store.Get(ctx, pop)
	if err != nil {
		t.Fatalf("lendo POP: %v", err)
	}
	if causa.Suppressed {
		t.Error("o POP e a causa: nao pode vir suprimido")
	}
	for _, id := range []uuid.UUID{sw, olt} {
		sintoma, err := store.Get(ctx, id)
		if err != nil {
			t.Fatalf("lendo descendente: %v", err)
		}
		if !sintoma.Suppressed {
			t.Errorf("descendente %s de um POP down deveria vir suprimido", sintoma.Name)
		}
	}
}
