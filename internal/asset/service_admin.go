package asset

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiiv/sentinel/internal/apperr"
)

// RenameAttachment troca so o nome de exibicao — object_key nunca muda.
func (s *Service) RenameAttachment(ctx context.Context, id uuid.UUID, filename string) error {
	if filename == "" {
		return apperr.Validation("invalid_filename", "nome do arquivo e obrigatorio")
	}
	return s.store.RenameAttachment(ctx, id, filename)
}

// ReorderAttachments grava a ordem final (arrastar a galeria). Ids que nao
// pertencem ao ativo informado sao ignorados pela query, entao o retorno e
// "quantos de fato mudaram" para a UI perceber um id invalido.
func (s *Service) ReorderAttachments(ctx context.Context, assetID uuid.UUID, ids []uuid.UUID) (int, error) {
	return s.store.SetAttachmentSort(ctx, assetID, ids)
}

// DuplicateSubtree recria o subtree inteiro do ativo como irmao do original
// (mesmo pai), com nomes sufixados. Tudo numa transacao: ou a copia inteira
// entra, ou nada entra.
func (s *Service) DuplicateSubtree(ctx context.Context, id uuid.UUID, suffix string, actor ...Actor) (*Asset, error) {
	if suffix == "" {
		suffix = " (copia)"
	}
	subtree, err := s.store.Subtree(ctx, &id, nil)
	if err != nil {
		return nil, err
	}
	if len(subtree) == 0 {
		return nil, apperr.NotFound("asset_not_found", "ativo nao encontrado")
	}
	root := subtree[0]

	var newRootID uuid.UUID
	txErr := pgx.BeginFunc(ctx, s.store.Pool(), func(tx pgx.Tx) error {
		mapped := make(map[uuid.UUID]uuid.UUID, len(subtree))
		for _, a := range subtree {
			parentID := a.ParentID
			if a.ID == root.ID {
				parentID = root.ParentID // a copia da raiz vira irma do original
			} else if mappedParent, ok := mapped[*a.ParentID]; ok {
				parentID = &mappedParent
			}
			name := a.Name
			if a.ID == root.ID {
				name = name + suffix
			}
			newID, err := s.store.InsertTx(ctx, tx, CreateInput{
				ParentID: parentID, Name: name, Kind: a.Kind,
				Description: a.Description, MgmtIP: a.MgmtIP, Attrs: a.Attrs,
			})
			if err != nil {
				return err
			}
			mapped[a.ID] = newID
			if a.ID == root.ID {
				newRootID = newID
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}

	created, err := s.store.Get(ctx, newRootID)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, created.ID, created.Name, actorOf(actor), AuditCreate, map[string]any{
		"via": "duplicate_subtree", "source_id": id, "descendants": len(subtree) - 1,
	})
	return created, nil
}

// Bulk aplica uma unica operacao a varios ativos. Cada item e independente:
// uma falha nao aborta os demais, e o chamador ve exatamente quais ids
// falharam e por que.
func (s *Service) Bulk(ctx context.Context, in BulkInput, actor ...Actor) ([]BulkResult, error) {
	if len(in.IDs) == 0 {
		return nil, apperr.Validation("empty_selection", "nenhum ativo selecionado")
	}
	results := make([]BulkResult, 0, len(in.IDs))
	for _, id := range in.IDs {
		err := s.bulkOne(ctx, id, in, actor...)
		res := BulkResult{ID: id, OK: err == nil}
		if err != nil {
			if e, ok := apperr.As(err); ok {
				res.Error = e.Message
			} else {
				res.Error = "falha inesperada"
			}
		}
		results = append(results, res)
	}
	return results, nil
}

func (s *Service) bulkOne(ctx context.Context, id uuid.UUID, in BulkInput, actor ...Actor) error {
	switch in.Op {
	case BulkSetKind:
		if in.Kind == nil {
			return apperr.Validation("missing_kind", "tipo e obrigatorio")
		}
		upd := UpdateInput{Kind: in.Kind}
		upd.setPresent("kind")
		_, err := s.Update(ctx, id, upd, actor...)
		return err
	case BulkSetParent:
		_, err := s.Move(ctx, id, in.ParentID, actor...)
		return err
	case BulkAddAttr:
		if in.AttrKey == nil || *in.AttrKey == "" {
			return apperr.Validation("missing_attr_key", "chave de atributo e obrigatoria")
		}
		a, err := s.store.Get(ctx, id)
		if err != nil {
			return err
		}
		attrs := map[string]any{}
		for k, v := range a.Attrs {
			attrs[k] = v
		}
		attrs[*in.AttrKey] = in.AttrVal
		upd := UpdateInput{Attrs: attrs}
		upd.setPresent("attrs")
		_, err = s.Update(ctx, id, upd, actor...)
		return err
	case BulkDelete:
		return s.Delete(ctx, id, actor...)
	default:
		return apperr.Validation("invalid_op", "operacao em lote invalida: %s", in.Op)
	}
}
