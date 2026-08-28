-- Patch parcial sem concatenacao: cada campo tem um par (presente?, valor).
update assets set
  name                = case when $2::boolean  then $3::text   else name end,
  kind                = case when $4::boolean  then $5::text   else kind end,
  description         = case when $6::boolean  then $7::text   else description end,
  mgmt_ip             = case when $8::boolean  then $9::inet   else mgmt_ip end,
  attrs               = case when $10::boolean then coalesce($11::jsonb, '{}'::jsonb) else attrs end,
  pos_x               = case when $12::boolean then $13::float8 else pos_x end,
  pos_y               = case when $14::boolean then $15::float8 else pos_y end,
  cover_attachment_id = case when $16::boolean then $17::uuid  else cover_attachment_id end,
  status              = case when $18::boolean then $19::text  else status end,
  status_at           = case when $18::boolean then now()      else status_at end
where id = $1
returning id;
