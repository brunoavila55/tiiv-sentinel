delete from asset_attachments where id = $1
returning id, asset_id, kind, object_key, thumb_key, filename, mime_type, size_bytes, sha256, captured_at, created_at;
