-- Gravacao em lote da ordem de anexos (arrastar a galeria de fotos).
update asset_attachments a
   set sort_order = v.pos
  from (select unnest($1::uuid[]) as id, unnest($2::int[]) as pos) v
 where a.id = v.id and a.asset_id = $3::uuid
returning a.id;
