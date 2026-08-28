// Package apperr define os erros de dominio. Handlers traduzem para HTTP na
// borda; nenhum erro cru vira 500 sem passar por aqui.
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

type Kind int

const (
	KindInternal Kind = iota
	KindValidation
	KindNotFound
	KindConflict
	KindUnauthorized
	KindForbidden
	KindTooLarge
)

type Error struct {
	Kind    Kind
	Code    string
	Message string
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Err }

func (e *Error) HTTPStatus() int {
	switch e.Kind {
	case KindValidation:
		return http.StatusBadRequest
	case KindNotFound:
		return http.StatusNotFound
	case KindConflict:
		return http.StatusConflict
	case KindUnauthorized:
		return http.StatusUnauthorized
	case KindForbidden:
		return http.StatusForbidden
	case KindTooLarge:
		return http.StatusRequestEntityTooLarge
	default:
		return http.StatusInternalServerError
	}
}

func new(kind Kind, code, format string, args ...any) *Error {
	return &Error{Kind: kind, Code: code, Message: fmt.Sprintf(format, args...)}
}

func Validation(code, format string, args ...any) *Error {
	return new(KindValidation, code, format, args...)
}
func NotFound(code, format string, args ...any) *Error {
	return new(KindNotFound, code, format, args...)
}
func Conflict(code, format string, args ...any) *Error {
	return new(KindConflict, code, format, args...)
}
func Unauthorized(code, format string, args ...any) *Error {
	return new(KindUnauthorized, code, format, args...)
}
func Forbidden(code, format string, args ...any) *Error {
	return new(KindForbidden, code, format, args...)
}
func Internal(err error, format string, args ...any) *Error {
	e := new(KindInternal, "internal", format, args...)
	e.Err = err
	return e
}

// As extrai um *Error de uma cadeia de erros.
func As(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}

func IsKind(err error, kind Kind) bool {
	e, ok := As(err)
	return ok && e.Kind == kind
}
