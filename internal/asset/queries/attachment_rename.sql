-- Renomear so troca o nome de exibicao; object_key nunca e tocado.
update asset_attachments set filename = $2::text
where id = $1
returning id;
