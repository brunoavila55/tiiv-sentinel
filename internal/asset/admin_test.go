package asset

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
)

func TestDeleteComReparentPreservaDescendentes(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	pop, sw, olt, cliente := buildFixture(t, ctx, svc)

	// Apagar direto ainda recusa (comportamento antigo intacto).
	if err := svc.Delete(ctx, sw); err == nil {
		t.Fatal("apagar switch com filhos deveria dar conflito sem reparent")
	}

	if err := svc.DeleteWithReparent(ctx, sw); err != nil {
		t.Fatalf("delete com reparent falhou: %v", err)
	}

	if _, err := svc.Detail(ctx, sw); !apperr.IsKind(err, apperr.KindNotFound) {
		t.Fatalf("switch deveria ter sido apagado, err=%v", err)
	}

	movedOLT, err := svc.Detail(ctx, olt)
	if err != nil {
		t.Fatalf("lendo OLT: %v", err)
	}
	if movedOLT.Asset.ParentID == nil || *movedOLT.Asset.ParentID != pop {
		t.Fatalf("OLT deveria ter subido para o avo %s, parent_id=%v", pop, movedOLT.Asset.ParentID)
	}

	clienteDetail, err := svc.Detail(ctx, cliente)
	if err != nil {
		t.Fatalf("cliente deveria ter sobrevivido intacto: %v", err)
	}
	if clienteDetail.Asset.ParentID == nil || *clienteDetail.Asset.ParentID != olt {
		t.Fatalf("cliente deveria continuar sob a OLT, parent_id=%v", clienteDetail.Asset.ParentID)
	}
}

func TestAuditoriaRegistraCicloDeVida(t *testing.T) {
	ctx := context.Background()
	svc, store := newService(t)
	actor := Actor{Email: "admin@teste.local"}

	created, err := svc.Create(ctx, CreateInput{Name: "SW-AUD", Kind: "switch"}, actor)
	if err != nil {
		t.Fatalf("criando: %v", err)
	}
	newName := "SW-AUD-renomeado"
	upd := UpdateInput{Name: &newName}
	upd.setPresent("name")
	if _, err := svc.Update(ctx, created.ID, upd, actor); err != nil {
		t.Fatalf("atualizando: %v", err)
	}
	if err := svc.Delete(ctx, created.ID, actor); err != nil {
		t.Fatalf("apagando: %v", err)
	}

	entries, err := store.ListAudit(ctx, created.ID, 10)
	if err != nil {
		t.Fatalf("lendo auditoria: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("esperava 3 entradas de auditoria (create/update/delete), obtive %d", len(entries))
	}
	// created_at desc: delete, update, create.
	wantActions := []string{AuditDelete, AuditUpdate, AuditCreate}
	for i, want := range wantActions {
		if entries[i].Action != want {
			t.Errorf("entries[%d].Action = %s, esperado %s", i, entries[i].Action, want)
		}
		if entries[i].UserEmail != actor.Email {
			t.Errorf("entries[%d].UserEmail = %s, esperado %s", i, entries[i].UserEmail, actor.Email)
		}
	}
	// A auditoria sobrevive ao ativo ter sido apagado.
	if entries[0].AssetName == "" {
		t.Error("asset_name deveria ficar gravado mesmo depois do ativo apagado")
	}
}

const validCSV = `name,kind,parent_name,mgmt_ip,description
POP Import,pop,,,
SW Import,switch,POP Import,10.9.0.1,
OLT Import,olt,SW Import,,
`

func TestImportCSVTransacional(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)
	actor := Actor{Email: "import@teste.local"}

	// CSV com uma linha invalida: nada pode ser criado.
	broken := validCSV + "Quebrado,tipo_que_nao_existe,POP Import,,\n"
	preview, err := svc.ImportPreview(ctx, broken)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.ErrCount != 1 {
		t.Fatalf("esperava 1 erro no preview, obteve %d", preview.ErrCount)
	}

	commitBroken, err := svc.ImportCommit(ctx, broken, actor)
	if err != nil {
		t.Fatalf("commit com erro nao deveria retornar erro de transporte: %v", err)
	}
	if commitBroken.Committed {
		t.Fatal("commit com linha invalida nao deveria ter sido efetivado")
	}
	all, err := svc.List(ctx, ListFilter{Limit: 100})
	if err != nil {
		t.Fatalf("listando: %v", err)
	}
	if len(all) != 0 {
		t.Fatalf("import invalido nao deveria ter criado nada, criou %d", len(all))
	}

	// CSV valido: entra tudo, com o pai resolvido por nome dentro do proprio CSV.
	result, err := svc.ImportCommit(ctx, validCSV, actor)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}
	if !result.Committed || result.OKCount != 3 {
		t.Fatalf("commit deveria criar 3 ativos, resultado=%+v", result)
	}

	tree, err := svc.List(ctx, ListFilter{Limit: 100})
	if err != nil {
		t.Fatalf("listando arvore: %v", err)
	}
	byName := map[string]uuid.UUID{}
	parentOf := map[uuid.UUID]*uuid.UUID{}
	for _, a := range tree {
		byName[a.Name] = a.ID
		parentOf[a.ID] = a.ParentID
	}
	sw, ok := byName["SW Import"]
	if !ok {
		t.Fatal("SW Import nao foi criado")
	}
	if parentOf[sw] == nil || *parentOf[sw] != byName["POP Import"] {
		t.Fatal("SW Import deveria estar sob POP Import")
	}

	// Rodar de novo com o mesmo CSV nao duplica: tudo vira "exists".
	again, err := svc.ImportCommit(ctx, validCSV, actor)
	if err != nil {
		t.Fatalf("segundo commit: %v", err)
	}
	if again.Exists != 3 || again.OKCount != 0 {
		t.Fatalf("reimportar deveria marcar tudo como existente, resultado=%+v", again)
	}
	afterSecond, err := svc.List(ctx, ListFilter{Limit: 100})
	if err != nil {
		t.Fatalf("listando depois do segundo commit: %v", err)
	}
	if len(afterSecond) != 3 {
		t.Fatalf("reimportar nao pode duplicar; esperava 3 ativos, tem %d", len(afterSecond))
	}
}
