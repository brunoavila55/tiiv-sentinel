select a.id, a.parent_id, a.name, a.kind, a.description, host(a.mgmt_ip) as mgmt_ip,
       a.attrs, a.status, a.status_at, a.pos_x, a.pos_y, a.cover_attachment_id, a.created_at, a.updated_at,
       coalesce(f.ancestor_down, false) as suppressed,
       (select count(*) from assets c where c.parent_id = a.id) as child_count,
       0 as depth
  from assets a
  left join asset_flags f on f.id = a.id
 where ($1::text is null or a.kind = $1::text)
   and ($2::text is null or a.status = $2::text)
   and ($3::uuid is null or a.parent_id = $3::uuid)
   and ($4::boolean is not true or a.parent_id is null)
   and ($5::text is null
        or a.name ilike $5::text
        or a.description ilike $5::text
        or host(a.mgmt_ip) ilike $5::text)
 order by a.name
 limit $6::int offset $7::int;
