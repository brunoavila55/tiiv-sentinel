-- Favoritos de um usuario, com o ativo completo: a PWA guarda o payload
-- inteiro em IndexedDB, entao a estrela abre offline sem depender de um GET.
-- $1 = user_id.
select a.id, a.parent_id, a.name, a.kind, a.description, host(a.mgmt_ip) as mgmt_ip,
       a.attrs, a.status, a.status_at, a.pos_x, a.pos_y, a.created_at, a.updated_at,
       coalesce(f.ancestor_down, false) as suppressed,
       (select count(*) from assets c where c.parent_id = a.id) as child_count,
       0 as depth
  from user_favorites uf
  join assets a on a.id = uf.asset_id
  left join asset_flags f on f.id = a.id
 where uf.user_id = $1
 order by a.name;
