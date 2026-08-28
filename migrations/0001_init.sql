-- +goose Up
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  role          text not null default 'viewer',
  created_at    timestamptz not null default now(),
  constraint users_role_check check (role in ('admin', 'viewer'))
);
create unique index users_email_lower_idx on users (lower(email));

create table sessions (
  id         text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz not null default now()
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table assets (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references assets(id) on delete restrict,
  name         text not null,
  kind         text not null,
  description  text,
  mgmt_ip      inet,
  attrs        jsonb not null default '{}',
  status       text not null default 'unknown',
  status_at    timestamptz,
  pos_x        double precision,
  pos_y        double precision,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint assets_status_check check (status in ('up', 'down', 'unknown')),
  constraint assets_not_own_parent check (parent_id is null or parent_id <> id)
);
create index assets_parent_id_idx on assets (parent_id);
create index assets_kind_idx on assets (kind);
create index assets_attrs_idx on assets using gin (attrs);
create index assets_name_trgm_idx on assets using gin (name gin_trgm_ops);
create index assets_description_trgm_idx on assets using gin (description gin_trgm_ops);
create index assets_mgmt_ip_idx on assets (mgmt_ip);

create table asset_attachments (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets(id) on delete cascade,
  kind         text not null,
  object_key   text not null,
  thumb_key    text,
  filename     text not null,
  mime_type    text not null,
  size_bytes   bigint not null,
  sha256       text,
  captured_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint asset_attachments_kind_check check (kind in ('photo', 'config', 'document'))
);
create index asset_attachments_asset_id_kind_idx on asset_attachments (asset_id, kind);

-- Supressao de alerta em cascata: um ativo cujo ancestral esta down e sintoma,
-- nao causa. A view caminha da raiz para as folhas propagando a flag.
create view asset_flags as
with recursive walk as (
  select a.id, a.status, false as ancestor_down
    from assets a
   where a.parent_id is null
  union all
  select c.id, c.status, w.ancestor_down or w.status = 'down'
    from assets c
    join walk w on c.parent_id = w.id
)
select id, ancestor_down from walk;

-- +goose StatementBegin
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
-- +goose StatementEnd

create trigger assets_set_updated_at
  before update on assets
  for each row execute function set_updated_at();

-- +goose Down
drop trigger if exists assets_set_updated_at on assets;
drop function if exists set_updated_at();
drop view if exists asset_flags;
drop table if exists asset_attachments;
drop table if exists assets;
drop table if exists sessions;
drop table if exists users;
