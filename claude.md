# CLAUDE.md

Contexto do projeto para agentes de código. Leia antes de qualquer alteração.

---

## O que é este sistema

Sistema self-hosted de **documentação e acesso a ativos de rede**, com topologia hierárquica visual. Usado por uma equipe de ISP/MSP.

O usuário final é **o técnico de campo**, de pé na rua, com celular na mão. O que ele precisa, em ordem de frequência:

1. Achar o ativo (quase sempre por busca, raramente navegando)
2. Copiar o IP ou abrir a interface do equipamento
3. Ver a última foto e a última configuração salva
4. Tirar foto e anexar

Toda decisão de design se resolve contra esses quatro pontos. Se uma feature bonita conflita com eles, os quatro pontos vencem.

## O que este sistema NÃO é

**Não é um sistema de monitoramento.** Zabbix e Grafana continuam existindo e são responsáveis por métricas, histórico, thresholds e alertas. Aqui o status é uma bolinha colorida e nada mais.

Consequências práticas — não implemente, e recuse se pedirem sem justificativa forte:

- Nenhum store de séries temporais (TimescaleDB, Prometheus, Influx, VictoriaMetrics)
- Nenhum histórico de latência, perda ou disponibilidade
- Nenhum motor de alertas, regras ou notificação de incidente
- Nenhuma coleta SNMP de contadores

O poller ICMP existe só para preencher `assets.status`. Se aparecer pressão para gravar o resultado ao longo do tempo, isso é sinal de que o requisito pertence ao Zabbix.

---

## Arquitetura

Tudo roda numa VM única via `docker-compose`, quatro serviços:

```
postgres  →  dados relacionais (árvore, metadados, sessões)
minio     →  arquivos (fotos, configs .txt, PDFs)
api       →  Go, único binário
web       →  build estático: desktop em /, PWA mobile em /m
```

### Stack

| Camada | Escolha | Observação |
|---|---|---|
| Backend | Go 1.22+, `chi`, `pgx/v5` | sem ORM; SQL direto ou `sqlc` |
| Migrations | `goose` | versionadas em `/migrations` |
| Banco | PostgreSQL 16 | árvore em adjacency list |
| Storage | MinIO em container local | S3-compatible, acesso via presigned |
| Frontend | React 18 + TS + Vite + TanStack Query | |
| Árvore | `react-arborist` | virtualizada |
| Canvas | React Flow | **desktop apenas** |
| Realtime | SSE | não use WebSocket |
| PWA | `vite-plugin-pwa` + `idb` | bundle separado |

---

## Regras que não se negociam

### 1. MinIO tem dois endpoints

A API fala com o MinIO por `MINIO_INTERNAL_ENDPOINT` (`http://minio:9000`), mas **presigned URLs devem ser assinadas com `MINIO_PUBLIC_ENDPOINT`** — o endereço que o navegador alcança. Usar o mesmo valor nos dois gera URLs que funcionam em teste de dentro do container e falham no browser. É o bug mais comum desta arquitetura.

### 2. Arquivo nunca passa pela API

Upload é presign → `PUT` direto no MinIO → confirm na API. Download é presigned `GET`. Nunca faça proxy de bytes pelo backend, nunca use `bytea` no Postgres para arquivo.

### 3. Foto é comprimida no cliente

Antes de qualquer upload de imagem: redimensionar para no máximo 1920px no maior lado e recomprimir em JPEG q80. Foto de celular tem 8-12MB; em 4G de poste esse upload falha. Preserve a coordenada GPS (EXIF ou `navigator.geolocation`) em `attrs.gps` e descarte o resto do EXIF.

### 4. Mobile não é o desktop responsivo

Bundles e telas separados. O canvas React Flow **não vai para o mobile** — grafo com pan/zoom em tela de 390px é inutilizável em campo. No mobile a topologia é drill-down com breadcrumb e lista de filhos. Componentes de domínio e hooks de API são compartilhados; as telas não.

Se você encontrar o canvas já implementado e a tentação de reaproveitar, não reaproveite.

### 5. A API não guarda estado em memória

Sessões no Postgres. A PWA depende de sessão longa e de restart transparente da API.

---

## Modelo de dados

Árvore em **adjacency list** (`assets.parent_id`), navegada por CTE recursiva. Não migre para `ltree`, closure table ou banco de grafo sem medir que a CTE virou gargalo real — a topologia é uma árvore, não um grafo com travessias arbitrárias.

```sql
-- descer (subtree)
with recursive subtree as (
  select *, 0 as depth from assets where id = $1
  union all
  select a.*, s.depth + 1 from assets a join subtree s on a.parent_id = s.id
)
select * from subtree order by depth, name;

-- subir (breadcrumb): mesma CTE com o join invertido
--   join subtree s on a.id = s.parent_id
```

Pontos de atenção:

- `parent_id` é `on delete restrict` de propósito. Ninguém apaga um POP e leva 300 ativos junto.
- Mover nó valida ciclo na aplicação (destino não pode estar no próprio subtree) → 400.
- `attrs jsonb` absorve campos específicos por tipo (OLT tem porta PON, AP tem SSID). Não crie coluna nova para cada tipo de equipamento; índice GIN já existe.
- `sha256` em anexo `kind=config` serve para detectar mudança de configuração sem diff completo.

---

## Convenções de código

### Go

```
/cmd/api          entrypoint
/internal/asset   domínio: handlers, service, queries
/internal/storage cliente MinIO
/internal/poller  ICMP
/internal/auth    sessão, argon2id
/migrations
```

- Erros de domínio tipados, traduzidos para HTTP na borda (handler). Não retorne `error` cru como 500.
- Contexto propagado em toda query; timeout por request.
- Poller com worker pool de concorrência limitada (~50), nunca uma goroutine por ativo.
- Log estruturado (`slog`), sem log de payload de upload.

### SQL

Queries em arquivo, não em string concatenada dentro de handler. Sempre parametrizadas. Cada migration é reversível.

### Frontend

- TanStack Query para todo estado de servidor; nada de `useEffect` + `fetch` manual.
- Estado de seleção na URL (`/assets/:id`) — link de ativo precisa ser compartilhável no WhatsApp.
- Ações por equipamento (`ssh://`, `http://`, `winbox://`) vêm de um mapa configurável por `kind`, nunca hardcoded em componente.
- Alvos de toque ≥ 44px em toda a PWA. O técnico pode estar de luva.

---

## Supressão de alerta em cascata

Ao marcar um ativo como `down`, caminhe até a raiz. Se algum ancestral também está `down`, o filho é **sintoma**, não causa: exiba atenuado, não em vermelho.

Sem isso, um POP caindo pinta 400 nós de vermelho e ninguém enxerga a origem. Essa é a regra que faz a tela ser útil num incidente real.

---

## Fluxo de trabalho

```bash
docker compose up -d          # sobe tudo do zero, sem passo manual
make migrate                  # aplica migrations
make seed                     # ~50 ativos em 4 níveis, desenvolvimento
make test
```

`GET /healthz` valida conectividade com Postgres e MinIO.

Antes de considerar uma tarefa pronta, verifique:

- [ ] Migration roda e reverte limpo
- [ ] `docker compose down && up` preserva dados e arquivos
- [ ] Presigned URL abre no navegador (não só de dentro do container)
- [ ] Deletar ativo não deixa objeto órfão no MinIO
- [ ] Teste cobre: CTE de subtree, validação de ciclo, ciclo presign/upload/confirm

---

## Ordem de construção

**Fase 1 — desktop/NOC.** Backend completo, três painéis (árvore, canvas, detalhe), anexos, auth. Ver `prompt-1-desktop.md`.

**Fase 2 — PWA mobile.** Consome a mesma API; endpoints novos são aditivos, contratos existentes não mudam. Ver `prompt-2-mobile-pwa.md`.

Não construa nada de mobile durante a fase 1 além de manter a API preparada (sessão persistida, sem estado em memória).

---

## Quando estiver em dúvida

Pergunte: **isso ajuda o técnico na rua a chegar no ativo e resolver mais rápido?**

Se a resposta for "ajuda o NOC a analisar tendência", provavelmente pertence ao Zabbix. Se for "fica mais bonito na demo", provavelmente atrapalha em campo sob sol.