package asset

import (
	"encoding/json"
	"testing"
)

func TestLooksLikeIP(t *testing.T) {
	cases := map[string]bool{
		"10.0.0.1":    true,
		"192.168.1.1": true,
		"2001:db8::1": true,
		"10.0.0":      false,
		"OLT-01":      false,
		"":            false,
	}
	for input, want := range cases {
		if got := LooksLikeIP(input); got != want {
			t.Errorf("LooksLikeIP(%q) = %v, esperado %v", input, got, want)
		}
	}
}

func TestEscapeLikeNeutralizaCuringas(t *testing.T) {
	if got := escapeLike("10%_0"); got != `10\%\_0` {
		t.Errorf("escapeLike = %q", got)
	}
}

// UpdateInput precisa separar "campo ausente" de "campo enviado como null":
// o primeiro preserva o valor, o segundo limpa.
func TestUpdateInputDistingueAusenteDeNulo(t *testing.T) {
	var ausente UpdateInput
	if err := json.Unmarshal([]byte(`{"name":"SW-02"}`), &ausente); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !ausente.Has("name") || ausente.Has("description") {
		t.Fatal("presenca de campo calculada errado")
	}
	if ausente.Name == nil || *ausente.Name != "SW-02" {
		t.Fatalf("name = %v", ausente.Name)
	}

	var nulo UpdateInput
	if err := json.Unmarshal([]byte(`{"description":null}`), &nulo); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !nulo.Has("description") || nulo.Description != nil {
		t.Fatal("description enviada como null deveria estar presente e nula")
	}
	if nulo.Empty() {
		t.Fatal("patch com um campo nao esta vazio")
	}
}

func TestNormalizeIP(t *testing.T) {
	vazio := ""
	got, err := normalizeIP(&vazio)
	if err != nil || got != nil {
		t.Fatalf("string vazia deveria virar nil, obtido %v / %v", got, err)
	}
	invalido := "10.0.0.999"
	if _, err := normalizeIP(&invalido); err == nil {
		t.Fatal("IP invalido deveria ser rejeitado antes do inet do Postgres")
	}
	valido := " 10.0.0.1 "
	got, err = normalizeIP(&valido)
	if err != nil || got == nil || *got != "10.0.0.1" {
		t.Fatalf("IP valido = %v / %v", got, err)
	}
}
