select id, asset_id, kind, object_key, thumb_key, filename, mime_type, size_bytes, sha256, sort_order, captured_at, created_at
  from asset_attachments
 where asset_id = $1
 order by sort_order, created_at desc;
