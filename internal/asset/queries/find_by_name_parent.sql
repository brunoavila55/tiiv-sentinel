-- Resolucao de pai por nome (import CSV) e deteccao de duplicata: nome
-- comparado sem acento/caixa nao seria seguro (colisao falsa), entao e so
-- lower(); "$1 is null" cobre raiz.
select id from assets
 where lower(name) = lower($1::text)
   and (($2::uuid is null and parent_id is null) or parent_id = $2::uuid)
 limit 2;
