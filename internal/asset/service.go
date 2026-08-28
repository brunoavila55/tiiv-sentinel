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
	return &Detail{
		Asset:       *a,
		Breadcrumb:  emptyIfNil(breadcrumb),
		Children:    emptyIfNil(children),
		Attachments: attachments,
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

func (s *Service) Create(ctx context.Context, in CreateInput) (*Asset, error) {
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
	return created, nil
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, in UpdateInput) (*Asset, error) {
	if in.Empty() {
		return s.store.Get(ctx, id)
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
	if err := s.store.Update(ctx, id, in); err != nil {
		return nil, err
	}
	updated, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.hub.Publish(events.Event{Type: events.TypeAssetUpdated, Data: updated})
	return updated, nil
}

// Move troca o pai validando ciclo: o destino nao pode estar dentro do proprio
// subtree do ativo movido.
func (s *Service) Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID) (*Asset, error) {
	if _, err := s.store.Get(ctx, id); err != nil {
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
	return moved, nil
}

// Delete recusa ativo com filhos (409) e limpa os objetos do MinIO para nao
// deixar orfao.
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	if _, err := s.store.Get(ctx, id); err != nil {
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
	return nil
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
