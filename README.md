# tiiv sentinel

Documentacao e acesso a ativos de rede com topologia hierarquica visual.
Self-hosted, tudo em uma VM, quatro containers.

**Nao e um sistema de monitoramento.** Zabbix e Grafana continuam donos de
metrica, historico e alerta. Aqui status e uma bolinha colorida — o que o
sistema resolve e: achar o ativo, ver foto e configuracao, copiar o IP e entrar
no equipamento.

Esta e a **fase 1 (desktop/NOC)**. A PWA mobile da fase 2 consome esta mesma
API; nada de mobile foi construido aqui.

---

## Setup do zero

```bash
git clone <este-repo> tiiv-sentinel
cd tiiv-sentinel
cp .env.example .env
$EDITOR .env                       # veja "As duas variaveis que importam"
docker compose up -d --build       # postgres, minio, api e web; migrations no boot
docker compose run --rm api seed   # opcional: ~57 ativos em 4 niveis
curl -s localhost:8080/healthz     # {"status":"ok", ...}
```

Abra `http://localhost:8080` e entre com o `ADMIN_EMAIL` / `ADMIN_PASSWORD` do
`.env` (a conta e criada no primeiro boot, se o banco estiver sem usuarios).

### As duas variaveis que importam

| Variavel | Para que serve |
|---|---|
| `MINIO_PUBLIC_ENDPOINT` | Endereco do MinIO **como o navegador o alcanca** (`http://IP-DA-VM:9000` ou `https://storage.dominio`). As presigned URLs sao assinadas com ele. |
| `MINIO_INTERNAL_ENDPOINT` | Endereco que a **API** usa (`http://minio:9000`, rede do Docker). |

Usar o mesmo valor nos dois gera URLs que funcionam em teste de dentro do
container e falham no navegador. E o bug mais comum desta arquitetura, entao a
API se recusa a subir sem `MINIO_PUBLIC_ENDPOINT`.

`COOKIE_SECURE=true` assim que houver HTTPS na frente.

---

## Servicos

```
postgres  →  arvore, metadados e sessoes      (volume pgdata)
minio     →  fotos, configs .txt, PDFs        (volume miniodata)
api       →  Go, binario unico                (:8081 no host, para debug)
web       →  build estatico + nginx com proxy (:8080 no host)
```

O container `web` serve dois bundles: o app do NOC em `/` e a PWA do tecnico de
campo em `/m`. Nao e o desktop com media query — sao telas proprias, e o service
worker tem escopo `/m/` para nao encostar no app do NOC.

`docker compose down && docker compose up -d` preserva dados e arquivos: ambos
estao em volumes nomeados.

## Comandos

```bash
make up            # sobe tudo (build incluso)
make seed          # rede de exemplo (FORCE=true semeia mesmo com dados)
make migrate       # migrations rodam no boot; isto e para rodar a mao
make logs          # logs da api
make test          # go test ./... (integracao usa o compose no ar)
make down
docker compose run --rm api adduser tecnico@isp.com senha-forte viewer
```

---

## Interface

Tres paineis, uma selecao so — clicar em qualquer um sincroniza os outros, e a
selecao vive na URL (`/assets/<id>`), entao o link de um ativo pode ser mandado
no WhatsApp.

```
┌──────────────┬────────────────────────┬───────────────┐
│ arvore       │ canvas de topologia    │ detalhe       │
│ (arborist,   │ (React Flow + dagre)   │ IP, acoes,    │
│ virtualizada)│ posicao persistida     │ fotos, config │
└──────────────┴────────────────────────┴───────────────┘
```

**Atalhos:** `Ctrl/Cmd+K` busca global (setas + Enter, sem mouse); `Ctrl/Cmd+C`
com um ativo selecionado copia o IP de gerencia; `N` abre o cadastro de um
ativo novo.

Banco vazio mostra uma tela de boas-vindas ("criar primeiro ativo" /
"importar CSV" / carregar dados de exemplo) em vez do layout de tres paineis —
excluir o ultimo ativo volta pra essa tela. Criar/editar ativo usa um drawer
unico com busca de pai, "salvar e criar outro" (mantem pai e tipo pro proximo
cadastro — montar um POP inteiro e uma sequencia de "adicionar filho", nao
uma escolha de pai repetida) e sugestao de atributos por `kind`. Mover por
drag-and-drop bloqueia visualmente soltar dentro do proprio subtree antes de
chegar na API; apagar ativo com filhos oferece mover os filhos diretos pro avo
em vez de exclusao em cascata (que nunca existe neste sistema). Largura dos
paineis e filtros do canvas (chips por `kind`) ficam salvos em `localStorage`.

**Canvas:** mostra o trecho ao redor da selecao (profundidade ajustavel), com
filtro por tipo, minimapa e fit-to-view no subtree — nao na rede inteira.
Arrastar um no grava `pos_x`/`pos_y` com debounce de 500ms; quem ainda nao tem
posicao recebe layout hierarquico automatico na primeira renderizacao.

**Acoes por equipamento** (`ssh://`, `http://`, `winbox://`, …) vem do mapa por
`kind` em `internal/config/kinds.default.json`, servido em `GET /api/config`.
Para ajustar sem recompilar, monte um JSON no container e aponte `KINDS_FILE`.

---

## API

Sessao por cookie `HttpOnly`; escrita exige `admin`, `viewer` le tudo e anexa
fotos.

```
POST   /api/auth/login | /api/auth/logout      GET /api/auth/me
GET    /api/auth/users     POST /api/auth/users     DELETE /api/auth/users/:id
GET    /api/assets                       filtros: kind, status, parent_id, q
GET    /api/assets/tree?root=&depth=     subtree por CTE recursiva
GET    /api/assets/:id                   ativo + breadcrumb + filhos + anexos
POST   /api/assets    PATCH /api/assets/:id    DELETE /api/assets/:id  (409 com filhos)
DELETE /api/assets/:id?reparent_children=1   apaga movendo os filhos diretos para o avo antes (sem cascata)
PATCH  /api/assets/:id/parent            move validando ciclo (400)
POST   /api/assets/positions             gravacao em lote das posicoes do canvas
POST   /api/assets/bulk                  operacao em lote (set_kind/set_parent/add_attr/delete), item a item
POST   /api/assets/:id/duplicate-subtree recria o subtree como irmao, nomes sufixados, transacional
POST   /api/assets/import/preview        valida CSV (name,kind,parent_name,mgmt_ip,description) sem gravar
POST   /api/assets/import/commit         grava o CSV inteiro numa transacao — ou tudo, ou nada
GET    /api/assets/:id/audit             historico do ativo (asset_audit)
GET    /api/search?q=                    IP exato vem em primeiro
POST   /api/assets/:id/attachments/presign   → upload_url (PUT direto no MinIO)
POST   /api/assets/:id/attachments           confirma e grava metadados
POST   /api/assets/:id/attachments/reorder   grava sort_order (arrastar a galeria)
GET    /api/attachments/:id/url?download=1   presigned GET (15min)
PATCH  /api/attachments/:id              renomeia (so filename; object_key nunca muda)
DELETE /api/attachments/:id
PATCH  /api/auth/users/:id/active        desativa/reativa (derruba sessoes ao desativar)
POST   /api/auth/users/:id/reset-password
GET    /api/events                       SSE: status_changed, updated, attachment.added
GET    /api/config                       mapa de kinds, acoes e kind_templates (attrs sugeridos por tipo)
GET    /healthz                          valida Postgres e MinIO
```

`GET /api/assets/:id` (Detail) agora tambem devolve `descendant_count` (subtree
inteiro, nao so filhos diretos) e `asset.cover_attachment_id` — nenhum campo
existente mudou de forma.

### Templates de atributos por tipo

`internal/config/kind-templates.default.json` sugere as chaves usuais de
`attrs` quando o formulario troca de `kind` (porta PON pro OLT, SSID pro AP,
etc.) — sem apagar valor ja preenchido e bloqueando chave duplicada. Segue o
mesmo padrao do `kinds.default.json`: `KIND_TEMPLATES_FILE` aponta pra um JSON
externo pra ajustar sem recompilar, do jeito que `KINDS_FILE` ja fazia.

### Auditoria

`asset_audit` grava `create`/`update`/`move`/`delete` com `changes jsonb` (so
os campos que mudaram) e uma copia de `asset_name`/`user_email` no momento da
acao — sobrevive a apagar o ativo ou o usuario, porque "quem apagou esse
ativo" e a pergunta que essa tabela existe pra responder. Sem FK em `asset_id`
de proposito, pelo mesmo motivo.

Acrescentados pela PWA de campo (aditivos; nada acima mudou de contrato):

```
POST   /api/auth/refresh                 renova a sessao longa, mesmo token
GET    /api/favorites                    favoritos do usuario, com o ativo completo
PUT    /api/favorites/:id                favorita       (idempotente)
DELETE /api/favorites/:id                desfavorita    (idempotente)
GET    /api/assets/:id/package           subtree + anexos assinados + tamanho estimado
```

`GET /api/auth/me` passou a devolver tambem `session.expires_at`, e o confirm de
anexo aceita o campo opcional `gps` — a PWA recomprime a foto antes de subir e o
EXIF nao sobrevive a recompressao. Ver [README-mobile.md](README-mobile.md).

### Anexos

Upload em duas fases — presign, `PUT` direto no MinIO, confirm na API. **O
arquivo nunca passa pelo backend.** Depois da confirmacao a API le o objeto uma
unica vez, fora do request, para: extrair o GPS do EXIF (vai para `attrs.gps`),
reescrever a imagem sem o resto dos metadados, gerar o thumbnail que a galeria
carrega e calcular o `sha256` — que em `kind=config` serve para detectar
mudanca de configuracao sem diff completo.

Allowlist de mime: `image/jpeg`, `image/png`, `image/webp`, `text/plain`,
`application/pdf`.

---

## Modelo de dados

Arvore em adjacency list (`assets.parent_id`), navegada por CTE recursiva —
descer e subir usam a mesma CTE com o join invertido. `parent_id` e
`on delete restrict` de proposito: ninguem apaga um POP e leva 300 ativos junto.
Campos especificos por tipo (porta PON, SSID, vendor) vivem em `attrs jsonb`,
com indice GIN — sem coluna nova por equipamento. `asset_attachments.sort_order`
guarda a ordem de exibicao (arrastar a galeria) e `assets.cover_attachment_id`
a foto de capa (`on delete set null`, some sozinho se a foto for removida).
`users.active` desativa conta sem apagar o rastro de auditoria dela.

### Supressao de alerta em cascata

A view `asset_flags` caminha da raiz para as folhas propagando "algum ancestral
esta down". Um ativo assim marcado e **sintoma**, nao causa: aparece atenuado na
arvore e no canvas, nunca em vermelho. Sem isso, um POP caindo pinta 400 nos de
vermelho e ninguem enxerga a origem.

### Poller ICMP

Worker pool com concorrencia limitada (padrao 50) pinga todo ativo com
`mgmt_ip` a cada 60s e atualiza `status`/`status_at`. **Nao grava historico** —
serie temporal e trabalho do Zabbix. Em container o ping usa socket ICMP nao
privilegiado (`PING_PRIVILEGED=false` + `net.ipv4.ping_group_range` no compose);
com `NET_RAW` disponivel, `PING_PRIVILEGED=true` tambem funciona.

Ativo que responde sai em ~200ms, entao uma rede saudavel de 1000 ativos e
varrida em poucos segundos. O pior caso e a rede toda inalcancavel, quando cada
ping consome o `POLL_TIMEOUT` inteiro: o limite fica em
`POLL_TIMEOUT × teto(ativos ÷ POLL_CONCURRENCY)`. Com os padroes (3s e 50) isso
da ~60s para 1000 ativos todos mudos — se a sua planta for grande, suba
`POLL_CONCURRENCY` ou baixe `POLL_TIMEOUT`. Cada varredura loga duracao,
quantidade e numero de mudancas.

---

## Desenvolvimento

```bash
docker compose up -d postgres minio    # so a infra
go run ./cmd/api serve                 # api local (exporte as env do .env)
cd web && npm install && npm run dev    # vite em :5173, proxy para :8081
```

### Testes

```bash
make test        # tudo; integracao usa postgres/minio do compose
make test-unit   # so o que nao precisa de infra
```

Cobrem a CTE de subtree e o breadcrumb, a validacao de ciclo no move, o 409 de
ativo com filhos, a prioridade do IP exato na busca, a supressao em cascata, o
ciclo presign/upload/confirm com MinIO real (incluindo thumbnail, limpeza dos
objetos ao apagar o ativo e o 403 da URL expirada), o hash argon2id e o
processamento de imagem.

Os testes de integracao usam o banco `sentinel_test` (criado sozinho) e o bucket
`sentinel-test` — nunca os dados de desenvolvimento. Sem a infra no ar eles
fazem skip com a instrucao de como subir.

## Estrutura

```
cmd/api            entrypoint: serve | migrate | migrate-down | seed | adduser
internal/asset     dominio: model, store (queries em arquivo), service, handlers
internal/auth      argon2id, sessao no Postgres, middleware de papel
internal/storage   cliente MinIO (dois endpoints)
internal/media     thumbnail e GPS do EXIF
internal/poller    ICMP
internal/events    hub SSE
migrations         goose, embutidas no binario
web/src            React 18 + TS + Vite + TanStack Query  (desktop, servido em /)
web/src/mobile     PWA de campo, bundle proprio            (servido em /m)
```

`web/src/api` e `web/src/components` sao compartilhados entre os dois bundles;
as telas nao. Ver [README-mobile.md](README-mobile.md).

## Fora de escopo, de proposito

Sem TimescaleDB/Prometheus/Influx, sem historico de latencia ou disponibilidade,
sem motor de alerta, sem coleta SNMP, sem WebSocket onde SSE resolve, sem
`bytea` para arquivo. Se aparecer pressao para gravar o resultado do ping ao
longo do tempo, o requisito pertence ao Zabbix.
