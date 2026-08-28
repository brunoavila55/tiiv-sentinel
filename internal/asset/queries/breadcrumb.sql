-- Subir a arvore: mesma CTE do subtree com o join invertido.
with recursive up as (
  select a.id, a.parent_id, 0 as depth
    from assets a
   where a.id = $1
  union all
  select p.id, p.parent_id, u.depth + 1
    from assets p
    join up u on p.id = u.parent_id
)
select a.id, a.parent_id, a.name, a.kind, a.description, host(a.mgmt_ip) as mgmt_ip,
       a.attrs, a.status, a.status_at, a.pos_x, a.pos_y, a.cover_attachment_id, a.created_at, a.updated_at,
       coalesce(f.ancestor_down, false) as suppressed,
       (select count(*) from assets c where c.parent_id = a.id) as child_count,
       u.depth
  from up u
  join assets a on a.id = u.id
  left join asset_flags f on f.id = a.id
 where u.depth > 0
 order by u.depth desc;
