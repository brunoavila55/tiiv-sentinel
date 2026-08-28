package asset

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
	"github.com/tiiv/sentinel/internal/auth"
	"github.com/tiiv/sentinel/internal/httpx"
)

type Handler struct {
	svc  *Service
	auth *auth.Handler
}

func NewHandler(svc *Service, authHandler *auth.Handler) *Handler {
	return &Handler{svc: svc, auth: authHandler}
}

// Routes registra as rotas de ativo e anexo. Leitura para qualquer sessao,
// escrita da arvore so para admin; viewer pode anexar foto.
func (h *Handler) Routes(r chi.Router) {
	r.Route("/assets", func(r chi.Router) {
		r.Get("/", h.list)
		r.Get("/tree", h.tree)
		r.Get("/{id}", h.get)

		r.With(h.auth.RequireAdmin).Post("/", h.create)
		r.With(h.auth.RequireAdmin).Patch("/{id}", h.update)
		r.With(h.auth.RequireAdmin).Delete("/{id}", h.delete)
		r.With(h.auth.RequireAdmin).Patch("/{id}/parent", h.move)
		r.With(h.auth.RequireAdmin).Post("/positions", h.positions)
		r.With(h.auth.RequireAdmin).Post("/bulk", h.bulk)
		r.With(h.auth.RequireAdmin).Post("/{id}/duplicate-subtree", h.duplicateSubtree)
		r.With(h.auth.RequireAdmin).Post("/{id}/attachments/reorder", h.reorderAttachments)
		r.With(h.auth.RequireAdmin).Post("/import/preview", h.importPreview)
		r.With(h.auth.RequireAdmin).Post("/import/commit", h.importCommit)
		r.Get("/{id}/audit", h.audit)

		r.Post("/{id}/attachments/presign", h.presign)
		r.Post("/{id}/attachments", h.confirm)

		// Pacote offline de POP: subtree + anexos assinados numa ida so.
		r.Get("/{id}/package", h.offlinePackage)
	})

	r.Get("/search", h.search)

	// Favoritos do tecnico. Sempre do usuario da sessao — nao ha como ler ou
	// escrever a lista de outro.
	r.Route("/favorites", func(r chi.Router) {
		r.Get("/", h.listFavorites)
		r.Put("/{id}", h.addFavorite)
		r.Delete("/{id}", h.removeFavorite)
	})

	r.Route("/attachments", func(r chi.Router) {
		r.Get("/{id}/url", h.attachmentURL)
		r.With(h.auth.RequireAdmin).Patch("/{id}", h.renameAttachment)
		r.With(h.auth.RequireAdmin).Delete("/{id}", h.deleteAttachment)
	})
}

// actorFrom monta o Actor de auditoria a partir da sessao autenticada.
func actorFrom(r *http.Request) Actor {
	u := auth.UserFrom(r.Context())
	if u == nil {
		return Actor{Email: "desconhecido"}
	}
	id := u.ID
	return Actor{UserID: &id, Email: u.Email}
}

func pathUUID(r *http.Request, key string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, key))
	if err != nil {
		return uuid.Nil, apperr.Validation("invalid_id", "id invalido")
	}
	return id, nil
}

func queryUUID(r *http.Request, key string) (*uuid.UUID, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, apperr.Validation("invalid_id", "%s invalido", key)
	}
	return &id, nil
}

func queryString(r *http.Request, key string) *string {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil
	}
	return &raw
}

func queryInt(r *http.Request, key string, def int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return n
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	// parent_id=root pede as raizes da arvore — e o primeiro nivel do
	// drill-down mobile. Precisa ser tratado antes do parse de UUID, senao
	// "root" e recusado como id invalido e o filtro nunca e alcancado.
	rootOnly := strings.TrimSpace(r.URL.Query().Get("parent_id")) == "root"
	var (
		parentID *uuid.UUID
		err      error
	)
	if !rootOnly {
		if parentID, err = queryUUID(r, "parent_id"); err != nil {
			httpx.Fail(w, r, err)
			return
		}
	}
	f := ListFilter{
		Kind:     queryString(r, "kind"),
		Status:   queryString(r, "status"),
		ParentID: parentID,
		RootOnly: rootOnly,
		Limit:    queryInt(r, "limit", 200),
		Offset:   queryInt(r, "offset", 0),
	}
	if q := queryString(r, "q"); q != nil {
		pattern := "%" + escapeLike(*q) + "%"
		f.Query = &pattern
	}
	list, err := h.svc.List(r.Context(), f)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list})
}

func (h *Handler) tree(w http.ResponseWriter, r *http.Request) {
	root, err := queryUUID(r, "root")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var maxDepth *int
	if d := queryInt(r, "depth", -1); d >= 0 {
		maxDepth = &d
	}
	list, err := h.svc.Tree(r.Context(), root, maxDepth)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	detail, err := h.svc.Detail(r.Context(), id)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, detail)
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	term := strings.TrimSpace(r.URL.Query().Get("q"))
	list, err := h.svc.Search(r.Context(), term, queryInt(r, "limit", 30))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list, "query": term})
}

func (h *Handler) offlinePackage(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	pkg, err := h.svc.Package(r.Context(), id)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, pkg)
}

func (h *Handler) listFavorites(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Favorites(r.Context(), auth.UserFrom(r.Context()).ID)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list})
}

func (h *Handler) addFavorite(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.AddFavorite(r.Context(), auth.UserFrom(r.Context()).ID, id); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) removeFavorite(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.RemoveFavorite(r.Context(), auth.UserFrom(r.Context()).ID, id); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in CreateInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	created, err := h.svc.Create(r.Context(), in, actorFrom(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, created)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in UpdateInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	updated, err := h.svc.Update(r.Context(), id, in, actorFrom(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, updated)
}

func (h *Handler) move(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in MoveInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	moved, err := h.svc.Move(r.Context(), id, in.ParentID, actorFrom(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, moved)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	// reparent_children=1 e o unico jeito de apagar um ativo com filhos: eles
	// sobem para o avo antes da exclusao. Sem o parametro, comportamento
	// identico a antes (409 quando ha filhos) — nenhum consumidor existente
	// da API quebra.
	var deleteErr error
	if r.URL.Query().Get("reparent_children") == "1" {
		deleteErr = h.svc.DeleteWithReparent(r.Context(), id, actorFrom(r))
	} else {
		deleteErr = h.svc.Delete(r.Context(), id, actorFrom(r))
	}
	if deleteErr != nil {
		httpx.Fail(w, r, deleteErr)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) audit(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	list, err := h.svc.Audit(r.Context(), id, queryInt(r, "limit", 100))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": list})
}

func (h *Handler) bulk(w http.ResponseWriter, r *http.Request) {
	var in BulkInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	results, err := h.svc.Bulk(r.Context(), in, actorFrom(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"results": results})
}

func (h *Handler) duplicateSubtree(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in DuplicateSubtreeInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	created, err := h.svc.DuplicateSubtree(r.Context(), id, in.Suffix, actorFrom(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, created)
}

func (h *Handler) reorderAttachments(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in ReorderInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	n, err := h.svc.ReorderAttachments(r.Context(), id, in.OrderedIDs)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"updated": n})
}

func (h *Handler) renameAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in RenameAttachmentInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.RenameAttachment(r.Context(), id, in.Filename); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) importPreview(w http.ResponseWriter, r *http.Request) {
	var in ImportInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	result, err := h.svc.ImportPreview(r.Context(), in.CSV)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (h *Handler) importCommit(w http.ResponseWriter, r *http.Request) {
	var in ImportInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	result, err := h.svc.ImportCommit(r.Context(), in.CSV, actorFrom(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (h *Handler) positions(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Positions []Position `json:"positions"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	n, err := h.svc.SetPositions(r.Context(), in.Positions)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"updated": n})
}

// canAttach: viewer sobe foto (o tecnico documenta o que encontrou), o resto e
// de admin.
func canAttach(r *http.Request, kind string) error {
	if auth.UserFrom(r.Context()).IsAdmin() {
		return nil
	}
	if kind == AttachmentPhoto {
		return nil
	}
	return apperr.Forbidden("forbidden", "viewer pode anexar apenas fotos")
}

func (h *Handler) presign(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in PresignInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := canAttach(r, in.Kind); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	out, err := h.svc.Presign(r.Context(), id, in)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) confirm(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in ConfirmInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := canAttach(r, in.Kind); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	att, err := h.svc.Confirm(r.Context(), id, in)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, att)
}

func (h *Handler) attachmentURL(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	download := r.URL.Query().Get("download") == "1"
	url, expires, err := h.svc.AttachmentURL(r.Context(), id, download)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"url": url, "expires_at": expires})
}

func (h *Handler) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "id")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.DeleteAttachment(r.Context(), id); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.NoContent(w)
}
