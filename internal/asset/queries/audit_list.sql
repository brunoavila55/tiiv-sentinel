select id, asset_id, asset_name, user_id, user_email, action, changes, created_at
  from asset_audit
 where asset_id = $1
 order by created_at desc
 limit $2::int;
