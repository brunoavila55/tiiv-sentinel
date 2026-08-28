-- $1 = user_id, $2 = asset_id. Idempotente: favoritar duas vezes nao e erro,
-- e a fila offline pode reenviar a mesma operacao.
insert into user_favorites (user_id, asset_id)
values ($1, $2)
on conflict (user_id, asset_id) do nothing;
