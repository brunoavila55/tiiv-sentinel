As queries deste diretorio compartilham a mesma lista de colunas de `assets`,
sempre com `left join asset_flags f` para trazer `suppressed` (supressao de
alerta em cascata) e o `child_count`. Nenhuma query e montada por concatenacao:
filtros opcionais usam o padrao `($n::tipo is null or coluna = $n)`.
