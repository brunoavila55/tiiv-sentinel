insert into asset_audit (asset_id, asset_name, user_id, user_email, action, changes)
values ($1::uuid, $2::text, $3::uuid, $4::text, $5::text, coalesce($6::jsonb, '{}'::jsonb));
