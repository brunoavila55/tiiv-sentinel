package config

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
)

//go:embed kinds.default.json
var defaultKinds []byte

// Action e um link acionavel para um equipamento. O template aceita {ip} e
// {name}. Ficam aqui (e nao no componente) porque o mapa e configuravel.
type Action struct {
	ID       string     `json:"id"`
	Label    string     `json:"label"`
	Template string     `json:"template"`
	WhenAttr *AttrMatch `json:"when_attr,omitempty"`
}

type AttrMatch struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Kind struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Icon    string   `json:"icon"`
	Color   string   `json:"color"`
	Actions []Action `json:"actions"`
}

type Kinds struct {
	Kinds []Kind `json:"kinds"`
}

// LoadKinds usa o arquivo apontado por KINDS_FILE quando existe, senao o
// embutido no binario.
func LoadKinds(path string) (*Kinds, error) {
	raw := defaultKinds
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("lendo KINDS_FILE %q: %w", path, err)
		}
		raw = b
	}
	var k Kinds
	if err := json.Unmarshal(raw, &k); err != nil {
		return nil, fmt.Errorf("kinds json invalido: %w", err)
	}
	if len(k.Kinds) == 0 {
		return nil, fmt.Errorf("kinds json vazio")
	}
	return &k, nil
}

func (k *Kinds) Has(id string) bool {
	for _, kind := range k.Kinds {
		if kind.ID == id {
			return true
		}
	}
	return false
}

func (k *Kinds) IDs() []string {
	out := make([]string, 0, len(k.Kinds))
	for _, kind := range k.Kinds {
		out = append(out, kind.ID)
	}
	return out
}
