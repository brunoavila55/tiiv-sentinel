package asset

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiiv/sentinel/internal/apperr"
)

//go:embed queries/*.sql
var queryFS embed.FS

// q carrega uma query do disco embutido. Falhar aqui e erro de programacao,
// entao entra em panic no boot e nao em runtime de request.
func q(name string) string {
	b, err := queryFS.ReadFile("queries/" + name)
	if err != nil {
		panic(fmt.Sprintf("query %q ausente: %v", name, err))
	}
	return string(b)
}

var (
	qGet                = q("get.sql")
	qList               = q("list.sql")
	qChildren           = q("children.sql")
	qSubtree            = q("subtree.sql")
	qBreadcrumb         = q("breadcrumb.sql")
	qSearch             = q("search.sql")
	qIsDescendant       = q("is_descendant.sql")
	qInsert             = q("insert.sql")
	qUpdate             = q("update.sql")
	qUpdateParent       = q("update_parent.sql")
	qUpdatePositions    = q("update_positions.sql")
	qDelete             = q("delete.sql")
	qCountChildren      = q("count_children.sql")
	qListPollable       = q("list_pollable.sql")
	qUpdateStatus       = q("update_status.sql")
	qAttachInsert       = q("attachment_insert.sql")
	qAttachList         = q("attachment_list.sql")
	qAttachGet          = q("attachment_get.sql")
	qAttachDelete       = q("attachment_delete.sql")
	qAttachSetProcessed = q("attachment_set_processed.sql")
	qAttachKeysByAsset  = q("attachment_keys_by_asset.sql")
	qAttachSubtree      = q("attachment_subtree.sql")
	qAssetSetGPS        = q("asset_set_gps.sql")
	qFavoriteList       = q("favorite_list.sql")
	qFavoriteAdd        = q("favorite_add.sql")
	qFavoriteRemove     = q("favorite_remove.sql")
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func scanAsset(row pgx.CollectableRow) (Asset, error) {
	var a Asset
	err := row.Scan(
		&a.ID, &a.ParentID, &a.Name, &a.Kind, &a.Description, &a.MgmtIP,
		&a.Attrs, &a.Status, &a.StatusAt, &a.PosX, &a.PosY, &a.CreatedAt, &a.UpdatedAt,
		&a.Suppressed, &a.ChildCount, &a.Depth,
	)
	if a.Attrs == nil {
		a.Attrs = map[string]any{}
	}
	return a, err
}

func (s *Store) collect(ctx context.Context, sql string, args ...any) ([]Asset, error) {
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, apperr.Internal(err, "consultando ativos")
	}
	list, err := pgx.CollectRows(rows, scanAsset)
	if err != nil {
		return nil, apperr.Internal(err, "lendo ativos")
	}
	return list, nil
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (*Asset, error) {
	list, err := s.collect(ctx, qGet, id)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, apperr.NotFound("asset_not_found", "ativo nao encontrado")
	}
	return &list[0], nil
}

func (s *Store) List(ctx context.Context, f ListFilter) ([]Asset, error) {
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 200
	}
	return s.collect(ctx, qList, f.Kind, f.Status, f.ParentID, f.RootOnly, f.Query, f.Limit, f.Offset)
}

func (s *Store) Children(ctx context.Context, parentID uuid.UUID) ([]Asset, error) {
	return s.collect(ctx, qChildren, parentID)
}

// Subtree desce a arvore por CTE recursiva. root nil comeca pelas raizes;
// maxDepth nil traz a arvore inteira.
func (s *Store) Subtree(ctx context.Context, root *uuid.UUID, maxDepth *int) ([]Asset, error) {
	return s.collect(ctx, qSubtree, root, maxDepth)
}

// Breadcrumb sobe a arvore ate a raiz, ordenado da raiz para o pai direto.
func (s *Store) Breadcrumb(ctx context.Context, id uuid.UUID) ([]Asset, error) {
	return s.collect(ctx, qBreadcrumb, id)
}

func (s *Store) Search(ctx context.Context, term string, limit int) ([]Asset, error) {
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	pattern := "%" + escapeLike(term) + "%"
	return s.collect(ctx, qSearch, pattern, strings.TrimSpace(term), limit)
}

// IsDescendant responde se candidate esta dentro do subtree de root. E a
// validacao de ciclo do move.
func (s *Store) IsDescendant(ctx context.Context, root, candidate uuid.UUID) (bool, error) {
	var ok bool
	if err := s.pool.QueryRow(ctx, qIsDescendant, root, candidate).Scan(&ok); err != nil {
		return false, apperr.Internal(err, "verificando ciclo na arvore")
	}
	return ok, nil
}

func (s *Store) CountChildren(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	if err := s.pool.QueryRow(ctx, qCountChildren, id).Scan(&n); err != nil {
		return 0, apperr.Internal(err, "contando filhos")
	}
	return n, nil
}

func (s *Store) Insert(ctx context.Context, in CreateInput) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, qInsert,
		in.ParentID, in.Name, in.Kind, in.Description, in.MgmtIP, jsonOrNil(in.Attrs), in.PosX, in.PosY,
	).Scan(&id)
	if err != nil {
		return uuid.Nil, translate(err, "criando ativo")
	}
	return id, nil
}

func (s *Store) Update(ctx context.Context, id uuid.UUID, in UpdateInput) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qUpdate, id,
		in.Has("name"), in.Name,
		in.Has("kind"), in.Kind,
		in.Has("description"), in.Description,
		in.Has("mgmt_ip"), in.MgmtIP,
		in.Has("attrs"), jsonOrNil(in.Attrs),
		in.Has("pos_x"), in.PosX,
		in.Has("pos_y"), in.PosY,
	).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("asset_not_found", "ativo nao encontrado")
	}
	if err != nil {
		return translate(err, "atualizando ativo")
	}
	return nil
}

func (s *Store) UpdateParent(ctx context.Context, id uuid.UUID, parentID *uuid.UUID) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qUpdateParent, id, parentID).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("asset_not_found", "ativo nao encontrado")
	}
	if err != nil {
		return translate(err, "movendo ativo")
	}
	return nil
}

func (s *Store) UpdatePositions(ctx context.Context, positions []Position) (int, error) {
	if len(positions) == 0 {
		return 0, nil
	}
	ids := make([]uuid.UUID, len(positions))
	xs := make([]float64, len(positions))
	ys := make([]float64, len(positions))
	for i, p := range positions {
		ids[i], xs[i], ys[i] = p.ID, p.X, p.Y
	}
	rows, err := s.pool.Query(ctx, qUpdatePositions, ids, xs, ys)
	if err != nil {
		return 0, apperr.Internal(err, "gravando posicoes")
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
	}
	if err := rows.Err(); err != nil {
		return 0, apperr.Internal(err, "gravando posicoes")
	}
	return n, nil
}

func (s *Store) Delete(ctx context.Context, id uuid.UUID) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qDelete, id).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("asset_not_found", "ativo nao encontrado")
	}
	if err != nil {
		return translate(err, "removendo ativo")
	}
	return nil
}

type Pollable struct {
	ID     uuid.UUID
	IP     string
	Status string
}

func (s *Store) ListPollable(ctx context.Context) ([]Pollable, error) {
	rows, err := s.pool.Query(ctx, qListPollable)
	if err != nil {
		return nil, apperr.Internal(err, "listando ativos com IP")
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Pollable, error) {
		var p Pollable
		err := row.Scan(&p.ID, &p.IP, &p.Status)
		return p, err
	})
	if err != nil {
		return nil, apperr.Internal(err, "lendo ativos com IP")
	}
	return list, nil
}

func (s *Store) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qUpdateStatus, id, status).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // ativo apagado durante a varredura
	}
	if err != nil {
		return apperr.Internal(err, "atualizando status")
	}
	return nil
}

func (s *Store) SetGPS(ctx context.Context, id uuid.UUID, lat, lon float64) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qAssetSetGPS, id, lat, lon).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return apperr.Internal(err, "gravando GPS no ativo")
	}
	return nil
}

func scanAttachment(row pgx.CollectableRow) (Attachment, error) {
	var a Attachment
	err := row.Scan(&a.ID, &a.AssetID, &a.Kind, &a.ObjectKey, &a.ThumbKey, &a.Filename,
		&a.MimeType, &a.SizeBytes, &a.SHA256, &a.CapturedAt, &a.CreatedAt)
	return a, err
}

func (s *Store) InsertAttachment(ctx context.Context, a Attachment) (*Attachment, error) {
	rows, err := s.pool.Query(ctx, qAttachInsert,
		a.AssetID, a.Kind, a.ObjectKey, a.Filename, a.MimeType, a.SizeBytes, a.SHA256, a.CapturedAt)
	if err != nil {
		return nil, translate(err, "gravando anexo")
	}
	list, err := pgx.CollectRows(rows, scanAttachment)
	if err != nil {
		return nil, translate(err, "gravando anexo")
	}
	if len(list) == 0 {
		return nil, apperr.Internal(nil, "anexo nao gravado")
	}
	return &list[0], nil
}

func (s *Store) ListAttachments(ctx context.Context, assetID uuid.UUID) ([]Attachment, error) {
	rows, err := s.pool.Query(ctx, qAttachList, assetID)
	if err != nil {
		return nil, apperr.Internal(err, "listando anexos")
	}
	list, err := pgx.CollectRows(rows, scanAttachment)
	if err != nil {
		return nil, apperr.Internal(err, "lendo anexos")
	}
	return list, nil
}

func (s *Store) GetAttachment(ctx context.Context, id uuid.UUID) (*Attachment, error) {
	rows, err := s.pool.Query(ctx, qAttachGet, id)
	if err != nil {
		return nil, apperr.Internal(err, "buscando anexo")
	}
	list, err := pgx.CollectRows(rows, scanAttachment)
	if err != nil {
		return nil, apperr.Internal(err, "lendo anexo")
	}
	if len(list) == 0 {
		return nil, apperr.NotFound("attachment_not_found", "anexo nao encontrado")
	}
	return &list[0], nil
}

func (s *Store) DeleteAttachment(ctx context.Context, id uuid.UUID) (*Attachment, error) {
	rows, err := s.pool.Query(ctx, qAttachDelete, id)
	if err != nil {
		return nil, apperr.Internal(err, "removendo anexo")
	}
	list, err := pgx.CollectRows(rows, scanAttachment)
	if err != nil {
		return nil, apperr.Internal(err, "removendo anexo")
	}
	if len(list) == 0 {
		return nil, apperr.NotFound("attachment_not_found", "anexo nao encontrado")
	}
	return &list[0], nil
}

func (s *Store) SetAttachmentProcessed(ctx context.Context, id uuid.UUID, thumbKey *string, size *int64, sha *string, capturedAt *time.Time) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qAttachSetProcessed, id, thumbKey, size, sha, capturedAt).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return apperr.Internal(err, "atualizando anexo processado")
	}
	return nil
}

// SubtreeAttachments traz os anexos de todo o subtree de uma vez: o pacote
// offline de um POP com 80 ativos vira uma consulta, nao 80.
func (s *Store) SubtreeAttachments(ctx context.Context, rootID uuid.UUID) ([]Attachment, error) {
	rows, err := s.pool.Query(ctx, qAttachSubtree, rootID)
	if err != nil {
		return nil, apperr.Internal(err, "listando anexos do subtree")
	}
	list, err := pgx.CollectRows(rows, scanAttachment)
	if err != nil {
		return nil, apperr.Internal(err, "lendo anexos do subtree")
	}
	return list, nil
}

func (s *Store) Favorites(ctx context.Context, userID uuid.UUID) ([]Asset, error) {
	return s.collect(ctx, qFavoriteList, userID)
}

func (s *Store) AddFavorite(ctx context.Context, userID, assetID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx, qFavoriteAdd, userID, assetID); err != nil {
		if strings.Contains(err.Error(), "user_favorites_asset_id_fkey") {
			return apperr.NotFound("asset_not_found", "ativo nao encontrado")
		}
		return apperr.Internal(err, "favoritando ativo")
	}
	return nil
}

func (s *Store) RemoveFavorite(ctx context.Context, userID, assetID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx, qFavoriteRemove, userID, assetID); err != nil {
		return apperr.Internal(err, "removendo favorito")
	}
	return nil
}

// AttachmentKeys lista os objetos de um ativo, para limpar o MinIO ao apagar.
func (s *Store) AttachmentKeys(ctx context.Context, assetID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, qAttachKeysByAsset, assetID)
	if err != nil {
		return nil, apperr.Internal(err, "listando objetos do ativo")
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var object, thumb string
		if err := rows.Scan(&object, &thumb); err != nil {
			return nil, apperr.Internal(err, "lendo objetos do ativo")
		}
		keys = append(keys, object)
		if thumb != "" {
			keys = append(keys, thumb)
		}
	}
	return keys, rows.Err()
}

func jsonOrNil(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

// escapeLike neutraliza os curingas do ILIKE: buscar "10.0.0.1_" nao pode virar
// um padrao que casa com meia rede.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(strings.TrimSpace(s))
}

// translate converte erros do Postgres que representam regra de negocio.
func translate(err error, action string) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "assets_parent_id_fkey"):
		return apperr.Validation("parent_not_found", "ativo pai nao existe")
	case strings.Contains(msg, "assets_status_check"):
		return apperr.Validation("invalid_status", "status deve ser up, down ou unknown")
	case strings.Contains(msg, "assets_not_own_parent"):
		return apperr.Validation("cycle", "um ativo nao pode ser pai de si mesmo")
	case strings.Contains(msg, "invalid input syntax for type inet"):
		return apperr.Validation("invalid_ip", "IP de gerencia invalido")
	case strings.Contains(msg, "violates foreign key constraint"):
		return apperr.Conflict("has_children", "ativo possui filhos vinculados")
	}
	return apperr.Internal(err, "%s", action)
}
