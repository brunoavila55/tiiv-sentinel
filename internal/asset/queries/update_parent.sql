update assets set parent_id = $2::uuid where id = $1 returning id;
