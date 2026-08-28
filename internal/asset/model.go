// Package asset e o dominio central: a arvore de ativos, seus anexos e as
// regras que os handlers HTTP apenas traduzem.
package asset

import (
	"encoding/json"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Asset struct {
	ID          uuid.UUID      `json:"id"`
	ParentID    *uuid.UUID     `json:"parent_id"`
	Name        string         `json:"name"`
	Kind        string         `json:"kind"`
	Description *string        `json:"description"`
	MgmtIP      *string        `json:"mgmt_ip"`
	Attrs       map[string]any `json:"attrs"`
	Status      string         `json:"status"`
	StatusAt    *time.Time     `json:"status_at"`
	// Suppressed marca o ativo como sintoma: algum ancestral esta down, entao a
	// UI atenua em vez de pintar de vermelho.
	Suppressed        bool       `json:"suppressed"`
	PosX              *float64   `json:"pos_x"`
	PosY              *float64   `json:"pos_y"`
	CoverAttachmentID *uuid.UUID `json:"cover_attachment_id"`
	ChildCount        int        `json:"child_count"`
	Depth             int        `json:"depth"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type Attachment struct {
	ID         uuid.UUID  `json:"id"`
	AssetID    uuid.UUID  `json:"asset_id"`
	Kind       string     `json:"kind"`
	ObjectKey  string     `json:"object_key"`
	ThumbKey   *string    `json:"thumb_key"`
	Filename   string     `json:"filename"`
	MimeType   string     `json:"mime_type"`
	SizeBytes  int64      `json:"size_bytes"`
	SHA256     *string    `json:"sha256"`
	SortOrder  int        `json:"sort_order"`
	CapturedAt *time.Time `json:"captured_at"`
	CreatedAt  time.Time  `json:"created_at"`

	// Preenchidos na resposta HTTP, nunca persistidos.
	URL      string `json:"url,omitempty"`
	ThumbURL string `json:"thumb_url,omitempty"`
}

// AuditEntry e uma linha do historico de um ativo. AssetName e UserEmail sao
// uma copia do momento da acao: sobrevivem a apagar o ativo ou o usuario.
type AuditEntry struct {
	ID        uuid.UUID      `json:"id"`
	AssetID   uuid.UUID      `json:"asset_id"`
	AssetName string         `json:"asset_name"`
	UserID    *uuid.UUID     `json:"user_id"`
	UserEmail string         `json:"user_email"`
	Action    string         `json:"action"`
	Changes   map[string]any `json:"changes"`
	CreatedAt time.Time      `json:"created_at"`
}

const (
	AuditCreate = "create"
	AuditUpdate = "update"
	AuditMove   = "move"
	AuditDelete = "delete"
)

// Actor identifica quem fez a acao, para gravar na auditoria. E passado
// explicitamente (em vez de lido de context) porque o Service nao depende do
// pacote auth.
type Actor struct {
	UserID *uuid.UUID
	Email  string
}

// Detail e a resposta de GET /api/assets/:id: o ativo com tudo que o painel de
// detalhe precisa em uma unica ida ao servidor.
type Detail struct {
	Asset       Asset        `json:"asset"`
	Breadcrumb  []Asset      `json:"breadcrumb"`
	Children    []Asset      `json:"children"`
	Attachments []Attachment `json:"attachments"`
	// DescendantCount e o subtree inteiro (nao so filhos diretos) — a UI usa
	// para avisar quantos ativos um exclude-com-reparent ou um move afetam.
	DescendantCount int `json:"descendant_count"`
}

const (
	StatusUp      = "up"
	StatusDown    = "down"
	StatusUnknown = "unknown"
)

const (
	AttachmentPhoto    = "photo"
	AttachmentConfig   = "config"
	AttachmentDocument = "document"
)

// CreateInput e o corpo de POST /api/assets.
type CreateInput struct {
	ParentID    *uuid.UUID     `json:"parent_id"`
	Name        string         `json:"name"`
	Kind        string         `json:"kind"`
	Description *string        `json:"description"`
	MgmtIP      *string        `json:"mgmt_ip"`
	Attrs       map[string]any `json:"attrs"`
	PosX        *float64       `json:"pos_x"`
	PosY        *float64       `json:"pos_y"`
}

// UpdateInput distingue "campo ausente" de "campo enviado como null": o
// primeiro preserva o valor, o segundo limpa.
type UpdateInput struct {
	Name              *string        `json:"name"`
	Kind              *string        `json:"kind"`
	Description       *string        `json:"description"`
	MgmtIP            *string        `json:"mgmt_ip"`
	Attrs             map[string]any `json:"attrs"`
	Status            *string        `json:"status"`
	PosX              *float64       `json:"pos_x"`
	PosY              *float64       `json:"pos_y"`
	CoverAttachmentID *uuid.UUID     `json:"cover_attachment_id"`

	present map[string]bool
}

func (u *UpdateInput) UnmarshalJSON(data []byte) error {
	type alias UpdateInput
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*u = UpdateInput(a)
	u.present = make(map[string]bool, len(raw))
	for k := range raw {
		u.present[k] = true
	}
	return nil
}

func (u *UpdateInput) Has(field string) bool { return u.present[field] }

// setPresent marca um campo como "enviado" quando o UpdateInput e montado em
// Go (bulk edit) em vez de decodificado de JSON.
func (u *UpdateInput) setPresent(field string) {
	if u.present == nil {
		u.present = map[string]bool{}
	}
	u.present[field] = true
}

func (u *UpdateInput) Empty() bool { return len(u.present) == 0 }

type MoveInput struct {
	ParentID *uuid.UUID `json:"parent_id"`
}

type Position struct {
	ID uuid.UUID `json:"id"`
	X  float64   `json:"pos_x"`
	Y  float64   `json:"pos_y"`
}

type ListFilter struct {
	Kind     *string
	Status   *string
	ParentID *uuid.UUID
	RootOnly bool
	Query    *string
	Limit    int
	Offset   int
}

// RenameAttachmentInput e o corpo de PATCH /api/attachments/:id: so o nome de
// exibicao muda, object_key nunca e tocado.
type RenameAttachmentInput struct {
	Filename string `json:"filename"`
}

// ReorderInput e o corpo de POST /api/assets/:id/attachments/reorder: a ordem
// final, do primeiro ao ultimo.
type ReorderInput struct {
	OrderedIDs []uuid.UUID `json:"ordered_ids"`
}

// DuplicateSubtreeInput e o corpo de POST /api/assets/:id/duplicate-subtree.
type DuplicateSubtreeInput struct {
	Suffix string `json:"suffix"`
}

const (
	BulkSetKind   = "set_kind"
	BulkSetParent = "set_parent"
	BulkAddAttr   = "add_attr"
	BulkDelete    = "delete"
)

// BulkInput e o corpo de POST /api/assets/bulk: uma unica operacao aplicada a
// varios ativos, cada um processado de forma independente (falha parcial nao
// aborta o lote).
type BulkInput struct {
	IDs      []uuid.UUID `json:"ids"`
	Op       string      `json:"op"`
	Kind     *string     `json:"kind"`
	ParentID *uuid.UUID  `json:"parent_id"`
	AttrKey  *string     `json:"attr_key"`
	AttrVal  any         `json:"attr_value"`
}

type BulkResult struct {
	ID    uuid.UUID `json:"id"`
	OK    bool      `json:"ok"`
	Error string    `json:"error,omitempty"`
}

// ImportInput e o corpo de POST /api/assets/import/preview e .../commit: o
// mesmo CSV bruto nas duas fases, para que o commit valide de novo em vez de
// confiar num preview que pode estar desatualizado.
type ImportInput struct {
	CSV string `json:"csv"`
}

const (
	ImportRowOK     = "ok"
	ImportRowExists = "exists"
	ImportRowError  = "error"
)

// ImportRow e uma linha do CSV apos validacao: pronta para criar (ok), ja
// existente com o mesmo nome sob o mesmo pai (exists, nao recriada) ou com
// problema (error).
type ImportRow struct {
	Line        int        `json:"line"`
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	ParentName  string     `json:"parent_name"`
	MgmtIP      string     `json:"mgmt_ip"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Error       string     `json:"error,omitempty"`
	ExistingID  *uuid.UUID `json:"existing_id,omitempty"`
}

type ImportResult struct {
	Rows      []ImportRow `json:"rows"`
	Total     int         `json:"total"`
	OKCount   int         `json:"ok_count"`
	Exists    int         `json:"exists_count"`
	ErrCount  int         `json:"error_count"`
	Committed bool        `json:"committed"`
}

// LooksLikeIP diz se o termo de busca e um IP. Usado para priorizar o match
// exato no topo dos resultados.
func LooksLikeIP(q string) bool {
	q = strings.TrimSpace(q)
	if q == "" {
		return false
	}
	return net.ParseIP(q) != nil
}
