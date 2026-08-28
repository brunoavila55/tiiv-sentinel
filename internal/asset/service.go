package asset

import (
	"context"
	"net"
	"strings"

	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
	"github.com/tiiv/sentinel/internal/config"
	"github.com/tiiv/sentinel/internal/events"
	"github.com/tiiv/sentinel/internal/storage"
)

const maxNameLen = 200

type Service struct {
	store    *Store
	storage  *storage.Store
	hub      *events.Hub
	kinds    *config.Kinds
	maxBytes int64
	jobs     chan uuid.UUID
}

func NewService(store *Store, st *storage.Store, hub *events.Hub, kinds *config.Kinds, maxBytes int64) *Service {
	return &Service{
		store:    store,
		storage:  st,
		hub:      hub,
		kinds:    kinds,
		maxBytes: maxBytes,
		jobs:     make(chan uuid.UUID, 256),
	}
}

func (s *Service) Store() *Store { return s.store }

// Detail monta a resposta do painel: ativo, breadcrumb, filhos e anexos ja com
// as URLs assinadas — uma ida so ao servidor.
func (s *Service) Detail(ctx context.Context, id uuid.UUID) (*Detail, error) {
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	breadcrumb, err := s.store.Breadcrumb(ctx, id)
	if err != nil {
		return nil, err
	}
	children, err := s.store.Children(ctx, id)
	if err != nil {
		return nil, err
	}
	attachments, err := s.Attachments(ctx, id)
	if err != nil {
		return nil, err
	}
	descendants, err := s.DescendantCount(ctx, id)
	if err != nil {
		return nil, err
	}
	return &Detail{
		Asset:           *a,
		Breadcrumb:      emptyIfNil(breadcrumb),
		Children:        emptyIfNil(children),
		Attachments:     attachments,
		DescendantCount: descendants,
	}, nil
}

func (s *Service) Tree(ctx context.Context, root *uuid.UUID, maxDepth *int) ([]Asset, error) {
	if root != nil {
		if _, err := s.store.Get(ctx, *root); err != nil {
			return nil, err
		}
	}
	list, err := s.store.Subtree(ctx, root, maxDepth)
	if err != nil {
		return nil, err
	}
	return emptyIfNil(list), nil
}

func (s *Service) List(ctx context.Context, f ListFilter) ([]Asset, error) {
	list, err := s.store.List(ctx, f)
	if err != nil {
		return nil, err
	}
	return emptyIfNil(list), nil
}

func (s *Service) Search(ctx context.Context, term string, limit int) ([]Asset, error) {
	term = strings.TrimSpace(term)
	if term == "" {
		return []Asset{}, nil
	}
	list, err := s.store.Search(ctx, term, limit)
	if err != nil {
		return nil, err
	}
	return emptyIfNil(list), nil
}

// actorOf devolve o primeiro Actor da lista variadica, ou um Actor de sistema
// quando a chamada nao informa quem agiu (testes, poller, seed). Variadico em
// vez de parametro obrigatorio para nao quebrar toda chamada existente por
// causa da auditoria.
func actorOf(actors []Actor) Actor {
	if len(actors) > 0 {
		return actors[0]
	}
	return Actor{Email: "system"}
}

func (s *Service) Create(ctx context.Context, in CreateInput, actor ...Actor) (*Asset, error) {
	in.Name = strings.TrimSpace(in.Name)
	if err := s.validateName(in.Name); err != nil {
		return nil, err
	}
	if err := s.validateKind(in.Kind); err != nil {
		return nil, err
	}
	ip, err := normalizeIP(in.MgmtIP)
	if err != nil {
		return nil, err
	}
	in.MgmtIP = ip
	if in.ParentID != nil {
		if _, err := s.store.Get(ctx, *in.ParentID); err != nil {
			if apperr.IsKind(err, apperr.KindNotFound) {
				return nil, apperr.Validation("parent_not_found", "ativo pai nao existe")
			}
			return nil, err
		}
	}
	id, err := s.store.Insert(ctx, in)
	if err != nil {
		return nil, err
	}
	created, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.hub.Publish(events.Event{Type: events.TypeAssetCreated, Data: created})
	s.audit(ctx, created.ID, created.Name, actorOf(actor), AuditCreate, map[string]any{
		"kind": created.Kind, "parent_id": created.ParentID,
	})
	return created, nil
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, in UpdateInput, actor ...Actor) (*Asset, error) {
	if in.Empty() {
		return s.store.Get(ctx, id)
	}
	before, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if in.Has("name") {
		if in.Name == nil {
			return nil, apperr.Validation("invalid_name", "nome nao pode ser nulo")
		}
		trimmed := strings.TrimSpace(*in.Name)
		in.Name = &trimmed
		if err := s.validateName(trimmed); err != nil {
			return nil, err
		}
	}
	if in.Has("kind") {
		if in.Kind == nil {
			return nil, apperr.Validation("invalid_kind", "tipo nao pode ser nulo")
		}
		if err := s.validateKind(*in.Kind); err != nil {
			return nil, err
		}
	}
	if in.Has("mgmt_ip") {
		ip, err := normalizeIP(in.MgmtIP)
		if err != nil {
			return nil, err
		}
		in.MgmtIP = ip
	}
	if in.Has("status") {
		if in.Status == nil || (*in.Status != StatusUp && *in.Status != StatusDown && *in.Status != StatusUnknown) {
			return nil, apperr.Validation("invalid_status", "status deve ser up, down ou unknown")
		}
	}
	if in.Has("cover_attachment_id") && in.CoverAttachmentID != nil {
		att, err := s.store.GetAttachment(ctx, *in.CoverAttachmentID)
		if err != nil {
			return nil, err
		}
		if att.AssetID != id {
			return nil, apperr.Validation("invalid_cover", "anexo nao pertence a este ativo")
		}
		if att.Kind != AttachmentPhoto {
			return nil, apperr.Validation("invalid_cover", "capa precisa ser uma foto")
		}
	}
	if err := s.store.Update(ctx, id, in); err != nil {
		return nil, err
	}
	updated, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.hub.Publish(events.Event{Type: events.TypeAssetUpdated, Data: updated})
	s.audit(ctx, updated.ID, updated.Name, actorOf(actor), AuditUpdate, diffAsset(before, updated))
	return updated, nil
}

// Move troca o pai validando ciclo: o destino nao pode estar dentro do proprio
// subtree do ativo movido.
func (s *Service) Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID, actor ...Actor) (*Asset, error) {
	before, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if parentID != nil {
		if *parentID == id {
			return nil, apperr.Validation("cycle", "um ativo nao pode ser pai de si mesmo")
		}
		if _, err := s.store.Get(ctx, *parentID); err != nil {
			if apperr.IsKind(err, apperr.KindNotFound) {
				return nil, apperr.Validation("parent_not_found", "ativo pai nao existe")
			}
			return nil, err
		}
		inside, err := s.store.IsDescendant(ctx, id, *parentID)
		if err != nil {
			return nil, err
		}
		if inside {
			return nil, apperr.Validation("cycle", "destino esta dentro do subtree do ativo movido")
		}
	}
	if err := s.store.UpdateParent(ctx, id, parentID); err != nil {
		return nil, err
	}
	moved, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.hub.Publish(events.Event{Type: events.TypeAssetUpdated, Data: moved})
	s.audit(ctx, moved.ID, moved.Name, actorOf(actor), AuditMove, map[string]any{
		"parent_id": map[string]any{"from": before.ParentID, "to": moved.ParentID},
	})
	return moved, nil
}

// DescendantCount conta o subtree inteiro (nao so filhos diretos) — usado
// pela UI para avisar quantos ativos um move ou um exclude-com-reparent afeta.
func (s *Service) DescendantCount(ctx context.Context, id uuid.UUID) (int, error) {
	list, err := s.store.Subtree(ctx, &id, nil)
	if err != nil {
		return 0, err
	}
	if len(list) == 0 {
		return 0, nil
	}
	return len(list) - 1, nil
}

// Delete recusa ativo com filhos (409) e limpa os objetos do MinIO para nao
// deixar orfao.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor ...Actor) error {
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return err
	}
	n, err := s.store.CountChildren(ctx, id)
	if err != nil {
		return err
	}
	if n > 0 {
		return apperr.Conflict("has_children", "ativo possui %d filho(s); mova ou remova antes", n)
	}
	keys, err := s.store.AttachmentKeys(ctx, id)
	if err != nil {
		return err
	}
	if err := s.store.Delete(ctx, id); err != nil {
		return err
	}
	if len(keys) > 0 {
		if err := s.storage.Remove(ctx, keys...); err != nil {
			logWarn("falha removendo objetos do ativo", err)
		}
	}
	// Varredura do prefixo: pega tambem upload presignado que nunca foi confirmado.
	if err := s.storage.RemovePrefix(ctx, objectPrefix(id)); err != nil {
		logWarn("falha limpando prefixo do ativo", err)
	}
	s.hub.Publish(events.Event{Type: events.TypeAssetDeleted, Data: map[string]any{"id": id}})
	s.audit(ctx, a.ID, a.Name, actorOf(actor), AuditDelete, map[string]any{"kind": a.Kind, "parent_id": a.ParentID})
	return nil
}

// DeleteWithReparent move os filhos diretos para o avo (o pai do ativo
// apagado) e so entao apaga — a alternativa a exclusao em cascata, que nunca
// existe neste sistema. Cada reparent passa pela validacao de ciclo normal do
// Move.
func (s *Service) DeleteWithReparent(ctx context.Context, id uuid.UUID, actor ...Actor) error {
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return err
	}
	children, err := s.store.Children(ctx, id)
	if err != nil {
		return err
	}
	for _, c := range children {
		if _, err := s.Move(ctx, c.ID, a.ParentID, actor...); err != nil {
			return err
		}
	}
	return s.Delete(ctx, id, actor...)
}

// audit e melhor-esforco: uma falha em gravar auditoria nao pode derrubar a
// escrita que ela documenta.
func (s *Service) audit(ctx context.Context, assetID uuid.UUID, assetName string, actor Actor, action string, changes map[string]any) {
	if err := s.store.InsertAudit(ctx, AuditEntry{
		AssetID: assetID, AssetName: assetName, UserID: actor.UserID, UserEmail: actor.Email,
		Action: action, Changes: changes,
	}); err != nil {
		logWarn("falha gravando auditoria", err)
	}
}

func (s *Service) Audit(ctx context.Context, assetID uuid.UUID, limit int) ([]AuditEntry, error) {
	return s.store.ListAudit(ctx, assetID, limit)
}

// diffAsset monta o changes jsonb do audit de update: so os campos que
// realmente aparecem diferentes depois do patch.
func diffAsset(before, after *Asset) map[string]any {
	changes := map[string]any{}
	if before.Name != after.Name {
		changes["name"] = map[string]any{"from": before.Name, "to": after.Name}
	}
	if before.Kind != after.Kind {
		changes["kind"] = map[string]any{"from": before.Kind, "to": after.Kind}
	}
	if strPtr(before.Description) != strPtr(after.Description) {
		changes["description"] = map[string]any{"from": before.Description, "to": after.Description}
	}
	if strPtr(before.MgmtIP) != strPtr(after.MgmtIP) {
		changes["mgmt_ip"] = map[string]any{"from": before.MgmtIP, "to": after.MgmtIP}
	}
	if before.Status != after.Status {
		changes["status"] = map[string]any{"from": before.Status, "to": after.Status}
	}
	return changes
}

func strPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (s *Service) SetPositions(ctx context.Context, positions []Position) (int, error) {
	return s.store.UpdatePositions(ctx, positions)
}

// SetStatus e chamado pelo poller. So publica evento quando o status muda de
// fato — a UI nao precisa de ruido a cada varredura.
func (s *Service) SetStatus(ctx context.Context, id uuid.UUID, previous, status string) error {
	if err := s.store.UpdateStatus(ctx, id, status); err != nil {
		return err
	}
	if previous == status {
		return nil
	}
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return err
	}
	s.hub.Publish(events.Event{Type: events.TypeStatusChanged, Data: a})
	return nil
}

func (s *Service) validateName(name string) error {
	if name == "" {
		return apperr.Validation("invalid_name", "nome e obrigatorio")
	}
	if len(name) > maxNameLen {
		return apperr.Validation("invalid_name", "nome deve ter no maximo %d caracteres", maxNameLen)
	}
	return nil
}

func (s *Service) validateKind(kind string) error {
	if !s.kinds.Has(kind) {
		return apperr.Validation("invalid_kind", "tipo invalido: use um de %s", strings.Join(s.kinds.IDs(), ", "))
	}
	return nil
}

// normalizeIP trata string vazia como "sem IP" e valida o endereco antes de
// chegar no inet do Postgres.
func normalizeIP(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, nil
	}
	if net.ParseIP(trimmed) == nil {
		return nil, apperr.Validation("invalid_ip", "IP de gerencia invalido: %q", trimmed)
	}
	return &trimmed, nil
}

func emptyIfNil(list []Asset) []Asset {
	if list == nil {
		return []Asset{}
	}
	return list
}

func objectPrefix(assetID uuid.UUID) string { return "assets/" + assetID.String() + "/" }
