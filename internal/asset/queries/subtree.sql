-- Descer a arvore. Sem $1 comeca pelas raizes; com $1 comeca no ativo dado.
-- A parte recursiva carrega so id/parent_id; as colunas entram no join final.
with recursive subtree as (
  select a.id, a.parent_id, 0 as depth
    from assets a
   where case when $1::uuid is null then a.parent_id is null else a.id = $1::uuid end
  union all
  select c.id, c.parent_id, s.depth + 1
    from assets c
    join subtree s on c.parent_id = s.id
   where $2::int is null or s.depth + 1 <= $2::int
)
select a.id, a.parent_id, a.name, a.kind, a.description, host(a.mgmt_ip) as mgmt_ip,
       a.attrs, a.status, a.status_at, a.pos_x, a.pos_y, a.cover_attachment_id, a.created_at, a.updated_at,
       coalesce(f.ancestor_down, false) as suppressed,
       (select count(*) from assets c where c.parent_id = a.id) as child_count,
       s.depth
  from subtree s
  join assets a on a.id = s.id
  left join asset_flags f on f.id = a.id
 order by s.depth, a.name;
