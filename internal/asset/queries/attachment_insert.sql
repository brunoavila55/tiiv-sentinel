insert into asset_attachments (asset_id, kind, object_key, filename, mime_type, size_bytes, sha256, captured_at)
values ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::bigint, $7::text, $8::timestamptz)
returning id, asset_id, kind, object_key, thumb_key, filename, mime_type, size_bytes, sha256, sort_order, captured_at, created_at;
