-- GPS da foto vira atributo do ativo; o restante do EXIF e descartado.
update assets
   set attrs = jsonb_set(attrs, '{gps}', jsonb_build_object('lat', $2::float8, 'lon', $3::float8), true)
 where id = $1
returning id;
