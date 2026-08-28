package config

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
)

//go:embed kind-templates.default.json
var defaultTemplates []byte

// TemplateField e uma linha sugerida quando o formulario de criacao/edicao
// troca de kind — o que evita attrs virarem lixo com "ip_gerencia",
// "IP_Gerencia" e "mgmt" convivendo no mesmo sistema.
type TemplateField struct {
	Key     string `json:"key"`
	Type    string `json:"type"` // string | number | boolean
	Default any    `json:"default"`
}

type Templates struct {
	Templates map[string][]TemplateField `json:"templates"`
}

// LoadTemplates segue o mesmo padrao de LoadKinds: KIND_TEMPLATES_FILE
// sobrepoe o embutido, sem precisar recompilar para ajustar os templates.
func LoadTemplates(path string) (*Templates, error) {
	raw := defaultTemplates
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("lendo KIND_TEMPLATES_FILE %q: %w", path, err)
		}
		raw = b
	}
	var t Templates
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, fmt.Errorf("kind-templates json invalido: %w", err)
	}
	if t.Templates == nil {
		t.Templates = map[string][]TemplateField{}
	}
	return &t, nil
}
