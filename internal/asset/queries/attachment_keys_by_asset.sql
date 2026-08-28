select object_key, coalesce(thumb_key, '') from asset_attachments where asset_id = $1;
