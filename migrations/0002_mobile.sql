-- +goose Up

-- Favoritos do tecnico. Local-first na PWA: a estrela funciona offline e
-- sincroniza depois, mas a lista canonica mora aqui para seguir o usuario
-- quando ele troca de aparelho.
create table user_favorites (
  user_id    uuid not null references users(id) on delete cascade,
  asset_id   uuid not null references assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
create index user_favorites_asset_id_idx on user_favorites (asset_id);

-- +goose Down
drop table if exists user_favorites;
