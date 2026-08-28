-- Gravacao em lote das posicoes do canvas (arrastar com debounce e layout dagre).
update assets a
   set pos_x = v.x, pos_y = v.y
  from (select unnest($1::uuid[]) as id, unnest($2::float8[]) as x, unnest($3::float8[]) as y) v
 where a.id = v.id
returning a.id;
