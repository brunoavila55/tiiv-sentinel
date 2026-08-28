-- $1 = padrao ilike, $2 = termo cru (IP exato quando parece IP), $3 = limite.
-- Match exato de IP vem primeiro: e o caso mais comum na rua.
select a.id, a.parent_id, a.name, a.kind, a.description, host(a.mgmt_ip) as mgmt_ip,
       a.attrs, a.status, a.status_at, a.pos_x, a.pos_y, a.created_at, a.updated_at,
       coalesce(f.ancestor_down, false) as suppressed,
       (select count(*) from assets c where c.parent_id = a.id) as child_count,
       0 as depth
  from assets a
  left join asset_flags f on f.id = a.id
 where a.name ilike $1
    or a.description ilike $1
    or host(a.mgmt_ip) ilike $1
 order by case
            when $2::text <> '' and host(a.mgmt_ip) = $2::text then 0
            when lower(a.name) = lower($2::text) then 1
            when a.name ilike $1 then 2
            when host(a.mgmt_ip) ilike $1 then 3
            else 4
          end,
          a.name
 limit $3::int;
