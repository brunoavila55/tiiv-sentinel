-- Anexos de todo o subtree de um ativo, para montar o pacote offline de POP
-- em uma ida so ao banco. $1 = raiz do subtree.
with recursive subtree as (
  select id from assets where id = $1
  union all
  select c.id from assets c join subtree s on c.parent_id = s.id
)
select at.id, at.asset_id, at.kind, at.object_key, at.thumb_key, at.filename,
       at.mime_type, at.size_bytes, at.sha256, at.sort_order, at.captured_at, at.created_at
  from asset_attachments at
  join subtree s on s.id = at.asset_id
 order by at.asset_id, at.sort_order, at.created_at desc;
