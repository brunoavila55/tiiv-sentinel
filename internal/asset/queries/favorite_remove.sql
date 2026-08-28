-- $1 = user_id, $2 = asset_id. Tambem idempotente, pelo mesmo motivo.
delete from user_favorites where user_id = $1 and asset_id = $2;
