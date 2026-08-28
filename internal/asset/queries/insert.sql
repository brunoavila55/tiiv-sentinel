insert into assets (parent_id, name, kind, description, mgmt_ip, attrs, pos_x, pos_y)
values ($1::uuid, $2::text, $3::text, $4::text, $5::inet, coalesce($6::jsonb, '{}'::jsonb), $7::float8, $8::float8)
returning id;
