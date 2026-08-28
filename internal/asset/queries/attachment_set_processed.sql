update asset_attachments
   set thumb_key = coalesce($2::text, thumb_key),
       size_bytes = coalesce($3::bigint, size_bytes),
       sha256 = coalesce($4::text, sha256),
       captured_at = coalesce($5::timestamptz, captured_at)
 where id = $1
returning id;
