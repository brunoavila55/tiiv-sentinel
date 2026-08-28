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
	Suppressed bool      `json:"suppressed"`
	PosX       *float64  `json:"pos_x"`
	PosY       *float64  `json:"pos_y"`
	ChildCount int       `json:"child_count"`
	Depth      int       `json:"depth"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
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
	CapturedAt *time.Time `json:"captured_at"`
	CreatedAt  time.Time  `json:"created_at"`

	// Preenchidos na resposta HTTP, nunca persistidos.
	URL      string `json:"url,omitempty"`
	ThumbURL string `json:"thumb_url,omitempty"`
}

// Detail e a resposta de GET /api/assets/:id: o ativo com tudo que o painel de
// detalhe precisa em uma unica ida ao servidor.
type Detail struct {
	Asset       Asset        `json:"asset"`
	Breadcrumb  []Asset      `json:"breadcrumb"`
	Children    []Asset      `json:"children"`
	Attachments []Attachment `json:"attachments"`
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
	Name        *string        `json:"name"`
	Kind        *string        `json:"kind"`
	Description *string        `json:"description"`
	MgmtIP      *string        `json:"mgmt_ip"`
	Attrs       map[string]any `json:"attrs"`
	PosX        *float64       `json:"pos_x"`
	PosY        *float64       `json:"pos_y"`

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

// LooksLikeIP diz se o termo de busca e um IP. Usado para priorizar o match
// exato no topo dos resultados.
func LooksLikeIP(q string) bool {
	q = strings.TrimSpace(q)
	if q == "" {
		return false
	}
	return net.ParseIP(q) != nil
}
