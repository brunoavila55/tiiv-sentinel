// Package httpx concentra as helpers de request/response e a traducao de erros
// de dominio para HTTP.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/tiiv/sentinel/internal/apperr"
)

type ErrorBody struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	enc := json.NewEncoder(w)
	// Sem escape de HTML: presigned URL cheia de "&" fica legivel para clientes
	// que nao sao o navegador (curl, scripts de operacao).
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		slog.Error("falha ao escrever resposta json", "err", err)
	}
}

func NoContent(w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }

// Fail traduz erro de dominio em status HTTP. Erro desconhecido vira 500 com
// mensagem generica; o detalhe fica no log, nunca na resposta.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	if e, ok := apperr.As(err); ok {
		if e.Kind == apperr.KindInternal {
			slog.ErrorContext(r.Context(), "erro interno", "err", e, "path", r.URL.Path)
			JSON(w, http.StatusInternalServerError, ErrorBody{
				Error: "internal", Code: "internal", Message: "erro interno",
			})
			return
		}
		JSON(w, e.HTTPStatus(), ErrorBody{Error: e.Code, Code: e.Code, Message: e.Message})
		return
	}
	slog.ErrorContext(r.Context(), "erro nao tratado", "err", err, "path", r.URL.Path)
	JSON(w, http.StatusInternalServerError, ErrorBody{
		Error: "internal", Code: "internal", Message: "erro interno",
	})
}

// Decode le um corpo JSON com limite de tamanho e rejeita campos desconhecidos.
func Decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return apperr.Validation("invalid_body", "corpo JSON invalido: %v", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return apperr.Validation("invalid_body", "corpo deve conter um unico objeto JSON")
	}
	return nil
}
