update assets set status = $2::text, status_at = now() where id = $1 returning id;
