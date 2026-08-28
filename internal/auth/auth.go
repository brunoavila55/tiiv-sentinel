// Package auth cuida de usuarios e sessoes. Sessao vive no Postgres — a API nao
// guarda estado em memoria, entao restart nao derruba ninguem (e a PWA da fase 2
// depende disso).
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiiv/sentinel/internal/apperr"
)

type Role string

const (
	RoleAdmin  Role = "admin"
	RoleViewer Role = "viewer"
)

type User struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Role      Role      `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

func (u *User) IsAdmin() bool { return u != nil && u.Role == RoleAdmin }

// Session e a sessao resolvida a partir do cookie. ExpiresAt sai na resposta de
// /auth/me para a PWA avisar o tecnico antes de vencer, em vez de deslogar sem
// aviso no meio da rua.
type Session struct {
	User      *User     `json:"-"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Service struct {
	pool       *pgxpool.Pool
	sessionTTL time.Duration
}

func NewService(pool *pgxpool.Pool, sessionTTL time.Duration) *Service {
	return &Service{pool: pool, sessionTTL: sessionTTL}
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func (s *Service) CreateUser(ctx context.Context, email, password string, role Role) (*User, error) {
	email = normalizeEmail(email)
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, apperr.Validation("invalid_email", "email invalido")
	}
	if len(password) < 8 {
		return nil, apperr.Validation("weak_password", "senha deve ter pelo menos 8 caracteres")
	}
	if role != RoleAdmin && role != RoleViewer {
		return nil, apperr.Validation("invalid_role", "papel deve ser admin ou viewer")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, apperr.Internal(err, "gerando hash de senha")
	}
	var (
		u       User
		roleStr string
	)
	err = s.pool.QueryRow(ctx,
		`insert into users (email, password_hash, role) values ($1, $2, $3)
		 returning id, email, role, created_at`,
		email, hash, string(role),
	).Scan(&u.ID, &u.Email, &roleStr, &u.CreatedAt)
	u.Role = Role(roleStr)
	if err != nil {
		if strings.Contains(err.Error(), "users_email_lower_idx") {
			return nil, apperr.Conflict("email_taken", "ja existe usuario com esse email")
		}
		return nil, apperr.Internal(err, "criando usuario")
	}
	return &u, nil
}

func (s *Service) CountUsers(ctx context.Context) (int, error) {
	var n int
	if err := s.pool.QueryRow(ctx, `select count(*) from users`).Scan(&n); err != nil {
		return 0, apperr.Internal(err, "contando usuarios")
	}
	return n, nil
}

// Login valida a senha e abre uma sessao. Devolve o token que vai no cookie.
func (s *Service) Login(ctx context.Context, email, password string) (*User, string, time.Time, error) {
	email = normalizeEmail(email)
	var (
		u       User
		hash    string
		roleStr string
	)
	err := s.pool.QueryRow(ctx,
		`select id, email, role, created_at, password_hash from users where lower(email) = $1`, email,
	).Scan(&u.ID, &u.Email, &roleStr, &u.CreatedAt, &hash)
	u.Role = Role(roleStr)
	if errors.Is(err, pgx.ErrNoRows) {
		// Hash descartavel para o tempo de resposta nao denunciar se o email existe.
		_, _ = HashPassword(password)
		return nil, "", time.Time{}, apperr.Unauthorized("invalid_credentials", "email ou senha invalidos")
	}
	if err != nil {
		return nil, "", time.Time{}, apperr.Internal(err, "buscando usuario")
	}
	ok, err := VerifyPassword(password, hash)
	if err != nil {
		return nil, "", time.Time{}, apperr.Internal(err, "verificando senha")
	}
	if !ok {
		return nil, "", time.Time{}, apperr.Unauthorized("invalid_credentials", "email ou senha invalidos")
	}

	token, err := newToken()
	if err != nil {
		return nil, "", time.Time{}, apperr.Internal(err, "gerando token de sessao")
	}
	expires := time.Now().Add(s.sessionTTL)
	if _, err := s.pool.Exec(ctx,
		`insert into sessions (id, user_id, expires_at) values ($1, $2, $3)`,
		tokenID(token), u.ID, expires,
	); err != nil {
		return nil, "", time.Time{}, apperr.Internal(err, "gravando sessao")
	}
	return &u, token, expires, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	if _, err := s.pool.Exec(ctx, `delete from sessions where id = $1`, tokenID(token)); err != nil {
		return apperr.Internal(err, "encerrando sessao")
	}
	return nil
}

// SessionByToken resolve a sessao. Renova seen_at, mas nao estende a expiracao
// a cada request para nao escrever no banco em todo hit — quem estende e o
// Renew, chamado pela PWA quando falta pouco para vencer.
func (s *Service) SessionByToken(ctx context.Context, token string) (*Session, error) {
	if token == "" {
		return nil, apperr.Unauthorized("no_session", "sessao ausente")
	}
	var (
		sess    Session
		u       User
		roleStr string
	)
	err := s.pool.QueryRow(ctx,
		`update sessions s set seen_at = now()
		   from users u
		  where s.id = $1 and s.expires_at > now() and u.id = s.user_id
		 returning u.id, u.email, u.role, u.created_at, s.expires_at`,
		tokenID(token),
	).Scan(&u.ID, &u.Email, &roleStr, &u.CreatedAt, &sess.ExpiresAt)
	u.Role = Role(roleStr)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.Unauthorized("invalid_session", "sessao expirada ou invalida")
	}
	if err != nil {
		return nil, apperr.Internal(err, "carregando sessao")
	}
	sess.User = &u
	return &sess, nil
}

func (s *Service) UserByToken(ctx context.Context, token string) (*User, error) {
	sess, err := s.SessionByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	return sess.User, nil
}

// Renew empurra a expiracao para frente sem trocar o token. O tecnico de campo
// nao pode ser deslogado no meio da rua: a PWA chama isto em background bem
// antes do vencimento, e o token que ja esta no aparelho continua valendo.
func (s *Service) Renew(ctx context.Context, token string) (*Session, error) {
	if token == "" {
		return nil, apperr.Unauthorized("no_session", "sessao ausente")
	}
	var (
		sess    Session
		u       User
		roleStr string
	)
	err := s.pool.QueryRow(ctx,
		`update sessions s
		    set expires_at = now() + make_interval(secs => $2::float8), seen_at = now()
		   from users u
		  where s.id = $1 and s.expires_at > now() and u.id = s.user_id
		 returning u.id, u.email, u.role, u.created_at, s.expires_at`,
		tokenID(token), s.sessionTTL.Seconds(),
	).Scan(&u.ID, &u.Email, &roleStr, &u.CreatedAt, &sess.ExpiresAt)
	u.Role = Role(roleStr)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.Unauthorized("invalid_session", "sessao expirada ou invalida")
	}
	if err != nil {
		return nil, apperr.Internal(err, "renovando sessao")
	}
	sess.User = &u
	return &sess, nil
}

// PurgeExpired limpa sessoes vencidas; roda periodicamente no boot da API.
func (s *Service) PurgeExpired(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `delete from sessions where expires_at < now()`)
	if err != nil {
		return 0, apperr.Internal(err, "limpando sessoes expiradas")
	}
	return tag.RowsAffected(), nil
}

// EnsureAdmin cria o admin inicial na primeira subida. Sem isso nao ha como
// entrar num deploy novo.
func (s *Service) EnsureAdmin(ctx context.Context, email, password string) error {
	n, err := s.CountUsers(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if email == "" || password == "" {
		return fmt.Errorf("banco sem usuarios: defina ADMIN_EMAIL e ADMIN_PASSWORD")
	}
	if _, err := s.CreateUser(ctx, email, password, RoleAdmin); err != nil {
		return err
	}
	return nil
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// tokenID guarda o hash do token: vazamento do dump de sessions nao vira sessao
// valida.
func tokenID(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx, `select id, email, role, created_at from users order by email`)
	if err != nil {
		return nil, apperr.Internal(err, "listando usuarios")
	}
	defer rows.Close()
	users := make([]User, 0, 8)
	for rows.Next() {
		var (
			u       User
			roleStr string
		)
		if err := rows.Scan(&u.ID, &u.Email, &roleStr, &u.CreatedAt); err != nil {
			return nil, apperr.Internal(err, "lendo usuarios")
		}
		u.Role = Role(roleStr)
		users = append(users, u)
	}
	return users, rows.Err()
}

// DeleteUser remove o usuario e, por cascade, as sessoes dele.
func (s *Service) DeleteUser(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from users where id = $1`, id)
	if err != nil {
		return apperr.Internal(err, "removendo usuario")
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("user_not_found", "usuario nao encontrado")
	}
	return nil
}
