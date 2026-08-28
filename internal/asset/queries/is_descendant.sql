-- Validacao de ciclo: $2 esta dentro do subtree de $1?
with recursive subtree as (
  select id from assets where id = $1
  union all
  select a.id from assets a join subtree s on a.parent_id = s.id
)
select exists (select 1 from subtree where id = $2);
