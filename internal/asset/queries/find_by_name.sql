-- Resolucao de pai por nome quando o CSV nao restringe a arvore: qualquer
-- ativo existente com esse nome, em qualquer lugar. Ambiguidade (2+ linhas) e
-- erro de validacao, nao escolha silenciosa.
select id, parent_id from assets where lower(name) = lower($1::text) limit 2;
