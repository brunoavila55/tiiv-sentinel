package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/apperr"
	"github.com/tiiv/sentinel/internal/httpx"
)

type ctxKey struct{}

type sessionCtxKey struct{}

var (
	userKey    ctxKey
	sessionKey sessionCtxKey
)

// UserFrom devolve o usuario autenticado do contexto.
func UserFrom(ctx context.Context) *User {
	u, _ := ctx.Value(userKey).(*User)
	return u
}

// SessionFrom devolve a sessao (com a expiracao) do contexto.
func SessionFrom(ctx context.Context) *Session {
	s, _ := ctx.Value(sessionKey).(*Session)
	return s
}

type Handler struct {
	svc          *Service
	cookieName   string
	cookieSecure bool
	sessionTTL   time.Duration
}

func NewHandler(svc *Service, cookieName string, cookieSecure bool, sessionTTL time.Duration) *Handler {
	return &Handler{svc: svc, cookieName: cookieName, cookieSecure: cookieSecure, sessionTTL: sessionTTL}
}

func (h *Handler) Routes(r chi.Router) {
	r.Post("/login", h.login)
	r.Post("/logout", h.logout)
	r.With(h.RequireUser).Get("/me", h.me)
	// Renovacao silenciosa da PWA: mesmo token, validade empurrada para frente.
	r.With(h.RequireUser).Post("/refresh", h.refresh)
	r.Route("/users", h.usersRoutes)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	user, token, expires, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(h.cookieName); err == nil {
		if err := h.svc.Logout(r.Context(), c.Value); err != nil {
			httpx.Fail(w, r, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.NoContent(w)
}

// me devolve o usuario e, aditivamente, a expiracao da sessao — a PWA usa para
// renovar em background e avisar dias antes de vencer.
func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"user":    UserFrom(r.Context()),
		"session": SessionFrom(r.Context()),
	})
}

// refresh estende a sessao e reemite o cookie com o mesmo token. Nao ha troca
// de credencial: o token que ja esta no aparelho continua valendo.
func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(h.cookieName)
	if err != nil {
		httpx.Fail(w, r, apperr.Unauthorized("no_session", "autenticacao necessaria"))
		return
	}
	sess, err := h.svc.Renew(r.Context(), c.Value)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    c.Value,
		Path:     "/",
		Expires:  sess.ExpiresAt,
		MaxAge:   int(time.Until(sess.ExpiresAt).Seconds()),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.JSON(w, http.StatusOK, map[string]any{"user": sess.User, "session": sess})
}

// RequireUser rejeita request sem sessao valida.
func (h *Handler) RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(h.cookieName)
		if err != nil {
			httpx.Fail(w, r, apperr.Unauthorized("no_session", "autenticacao necessaria"))
			return
		}
		sess, err := h.svc.SessionByToken(r.Context(), c.Value)
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, sess.User)
		ctx = context.WithValue(ctx, sessionKey, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin protege as rotas de escrita de ativo. Viewer le tudo e anexa
// foto, mas nao mexe na arvore.
func (h *Handler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !UserFrom(r.Context()).IsAdmin() {
			httpx.Fail(w, r, apperr.Forbidden("forbidden", "acao permitida apenas para admin"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Users expoe a gestao minima de contas: sem ela nao ha como existir um viewer.
func (h *Handler) usersRoutes(r chi.Router) {
	r.Use(h.RequireUser, h.RequireAdmin)
	r.Get("/", h.listUsers)
	r.Post("/", h.createUser)
	r.Delete("/{id}", h.deleteUser)
}

func (h *Handler) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListUsers(r.Context())
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": users})
}

func (h *Handler) createUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     Role   `json:"role"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if req.Role == "" {
		req.Role = RoleViewer
	}
	user, err := h.svc.CreateUser(r.Context(), req.Email, req.Password, req.Role)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, user)
}

func (h *Handler) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Fail(w, r, apperr.Validation("invalid_id", "id invalido"))
		return
	}
	if current := UserFrom(r.Context()); current != nil && current.ID == id {
		httpx.Fail(w, r, apperr.Validation("self_delete", "voce nao pode remover a propria conta"))
		return
	}
	if err := h.svc.DeleteUser(r.Context(), id); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.NoContent(w)
}
