-- +goose Up

-- Auditoria: sem FK em asset_id de proposito. O rastro de "quem apagou esse
-- ativo" precisa sobreviver ao apagar do ativo; um FK com cascade destruiria a
-- prova exatamente na acao que mais importa registrar.
create table asset_audit (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null,
  asset_name text not null,
  user_id    uuid references users(id) on delete set null,
  user_email text not null,
  action     text not null,
  changes    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint asset_audit_action_check check (action in ('create', 'update', 'move', 'delete'))
);
create index asset_audit_asset_id_idx on asset_audit (asset_id, created_at desc);

-- Desativar em vez de apagar: um admin removido de fato perde a sessao (ja
-- cobria isso), mas "desativar" e o caminho para tirar acesso sem apagar o
-- rastro de quem fez o que no historico.
alter table users add column active boolean not null default true;

-- Ordem de exibicao de anexos (arrastar para reordenar fotos).
alter table asset_attachments add column sort_order integer not null default 0;

-- Foto de capa: a que aparece no card do canvas e na lista de filhos.
alter table assets add column cover_attachment_id uuid references asset_attachments(id) on delete set null;

-- +goose Down
alter table assets drop column if exists cover_attachment_id;
alter table asset_attachments drop column if exists sort_order;
alter table users drop column if exists active;
drop table if exists asset_audit;
