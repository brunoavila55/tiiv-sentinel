package auth

import "testing"

func TestHashPasswordVerifica(t *testing.T) {
	hash, err := HashPassword("senha-do-noc-2026")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	ok, err := VerifyPassword("senha-do-noc-2026", hash)
	if err != nil || !ok {
		t.Fatalf("senha correta deveria validar (%v / %v)", ok, err)
	}
	ok, err = VerifyPassword("senha-errada", hash)
	if err != nil || ok {
		t.Fatalf("senha errada nao pode validar (%v / %v)", ok, err)
	}
}

func TestHashPasswordUsaSaltDiferente(t *testing.T) {
	a, _ := HashPassword("mesma-senha")
	b, _ := HashPassword("mesma-senha")
	if a == b {
		t.Fatal("dois hashes da mesma senha nao podem ser iguais")
	}
}

func TestVerifyPasswordRejeitaHashInvalido(t *testing.T) {
	if _, err := VerifyPassword("x", "nao-e-um-hash"); err == nil {
		t.Fatal("hash malformado deveria retornar erro")
	}
}
