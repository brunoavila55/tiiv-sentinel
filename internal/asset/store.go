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
	qAttachRename       = q("attachment_rename.sql")
	qAttachSetSort      = q("attachment_set_sort.sql")
	qAuditInsert        = q("audit_insert.sql")
	qAuditList          = q("audit_list.sql")
	qFindByNameParent   = q("find_by_name_parent.sql")
	qFindByName         = q("find_by_name.sql")
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func scanAsset(row pgx.CollectableRow) (Asset, error) {
	var a Asset
	err := row.Scan(
		&a.ID, &a.ParentID, &a.Name, &a.Kind, &a.Description, &a.MgmtIP,
		&a.Attrs, &a.Status, &a.StatusAt, &a.PosX, &a.PosY, &a.CoverAttachmentID, &a.CreatedAt, &a.UpdatedAt,
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
		in.Has("cover_attachment_id"), in.CoverAttachmentID,
		in.Has("status"), in.Status,
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
		&a.MimeType, &a.SizeBytes, &a.SHA256, &a.SortOrder, &a.CapturedAt, &a.CreatedAt)
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

// Pool expoe o pool para operacoes que precisam de transacao explicita (o
// commit do import CSV: ou entra tudo, ou nada).
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

func (s *Store) RenameAttachment(ctx context.Context, id uuid.UUID, filename string) error {
	var out uuid.UUID
	err := s.pool.QueryRow(ctx, qAttachRename, id, filename).Scan(&out)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("attachment_not_found", "anexo nao encontrado")
	}
	if err != nil {
		return apperr.Internal(err, "renomeando anexo")
	}
	return nil
}

// SetAttachmentSort grava a ordem final de uma lista de anexos, todos do
// mesmo ativo (o filtro por asset_id evita que um id de outro ativo, por
// engano ou má-fe, mude ordem que nao e dele).
func (s *Store) SetAttachmentSort(ctx context.Context, assetID uuid.UUID, ids []uuid.UUID) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	positions := make([]int32, len(ids))
	for i := range ids {
		positions[i] = int32(i)
	}
	rows, err := s.pool.Query(ctx, qAttachSetSort, ids, positions, assetID)
	if err != nil {
		return 0, apperr.Internal(err, "gravando ordem de anexos")
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
	}
	return n, rows.Err()
}

func (s *Store) InsertAudit(ctx context.Context, e AuditEntry) error {
	if _, err := s.pool.Exec(ctx, qAuditInsert, e.AssetID, e.AssetName, e.UserID, e.UserEmail, e.Action, jsonOrNil(e.Changes)); err != nil {
		return apperr.Internal(err, "gravando auditoria")
	}
	return nil
}

func (s *Store) ListAudit(ctx context.Context, assetID uuid.UUID, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, qAuditList, assetID, limit)
	if err != nil {
		return nil, apperr.Internal(err, "listando auditoria")
	}
	defer rows.Close()
	list := make([]AuditEntry, 0, 16)
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.AssetID, &e.AssetName, &e.UserID, &e.UserEmail, &e.Action, &e.Changes, &e.CreatedAt); err != nil {
			return nil, apperr.Internal(err, "lendo auditoria")
		}
		if e.Changes == nil {
			e.Changes = map[string]any{}
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

// FindIDByNameUnderParent resolve duplicata/pai por nome dentro de um escopo
// conhecido (raiz quando parentID e nil). ok=false quando nao ha match.
func (s *Store) FindIDByNameUnderParent(ctx context.Context, name string, parentID *uuid.UUID) (uuid.UUID, bool, error) {
	rows, err := s.pool.Query(ctx, qFindByNameParent, name, parentID)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err, "procurando ativo por nome")
	}
	defer rows.Close()
	var id uuid.UUID
	found := false
	for rows.Next() {
		if err := rows.Scan(&id); err != nil {
			return uuid.Nil, false, apperr.Internal(err, "lendo ativo por nome")
		}
		found = true
	}
	return id, found, rows.Err()
}

// FindIDByNameUnderParentTx e a mesma busca de FindIDByNameUnderParent, mas
// dentro de uma transacao em andamento — precisa enxergar linhas ja inseridas
// neste mesmo commit de import, que ainda nao existem fora da transacao.
func (s *Store) FindIDByNameUnderParentTx(ctx context.Context, tx pgx.Tx, name string, parentID *uuid.UUID) (uuid.UUID, bool, error) {
	rows, err := tx.Query(ctx, qFindByNameParent, name, parentID)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err, "procurando ativo por nome")
	}
	defer rows.Close()
	var id uuid.UUID
	found := false
	for rows.Next() {
		if err := rows.Scan(&id); err != nil {
			return uuid.Nil, false, apperr.Internal(err, "lendo ativo por nome")
		}
		found = true
	}
	return id, found, rows.Err()
}

// FindByNameAnywhere resolve pai de import por nome em toda a arvore.
// Devolve erro de validacao (nao apperr.Internal) quando o nome e ambiguo,
// porque quem decide o que fazer e o usuario, nao o sistema.
func (s *Store) FindByNameAnywhere(ctx context.Context, name string) (id uuid.UUID, found bool, ambiguous bool, err error) {
	rows, qErr := s.pool.Query(ctx, qFindByName, name)
	if qErr != nil {
		return uuid.Nil, false, false, apperr.Internal(qErr, "procurando pai por nome")
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var thisID uuid.UUID
		var parentID *uuid.UUID
		if scanErr := rows.Scan(&thisID, &parentID); scanErr != nil {
			return uuid.Nil, false, false, apperr.Internal(scanErr, "lendo pai por nome")
		}
		ids = append(ids, thisID)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return uuid.Nil, false, false, apperr.Internal(rowsErr, "procurando pai por nome")
	}
	switch len(ids) {
	case 0:
		return uuid.Nil, false, false, nil
	case 1:
		return ids[0], true, false, nil
	default:
		return uuid.Nil, false, true, nil
	}
}

// InsertTx cria um ativo dentro de uma transacao existente — usado so pelo
// commit do import CSV, onde o lote inteiro precisa ser atomico.
func (s *Store) InsertTx(ctx context.Context, tx pgx.Tx, in CreateInput) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, qInsert,
		in.ParentID, in.Name, in.Kind, in.Description, in.MgmtIP, jsonOrNil(in.Attrs), in.PosX, in.PosY,
	).Scan(&id)
	if err != nil {
		return uuid.Nil, translate(err, "criando ativo")
	}
	return id, nil
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
