select id, asset_id, kind, object_key, thumb_key, filename, mime_type, size_bytes, sha256, captured_at, created_at
  from asset_attachments
 where asset_id = $1
 order by created_at desc;
