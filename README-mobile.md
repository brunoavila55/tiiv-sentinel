# PWA de campo (`/m`)

Interface para o técnico de pé na rua, com o celular na mão. Consome a mesma API
da fase 1; nenhum contrato existente mudou.

O desktop continua em `/`. Esta PWA é um **bundle separado** em `/m` — telas
próprias, não o layout de três painéis com media query. O canvas React Flow
**não** foi portado: grafo com pan/zoom em tela de 390px é hostil em campo. Aqui
a topologia é drill-down com breadcrumb.

---

## O que existe

| | |
|---|---|
| Home | busca com foco automático, debounce de 250ms, histórico dos 10 últimos e favoritos |
| Topologia | drill-down por níveis, breadcrumb rolável, swipe da borda esquerda sobe um nível |
| Detalhe | `COPIAR IP` de largura total, botões de protocolo por `kind`, fotos, configs, descrição, `attrs`, filhos |
| Câmera | botão flutuante; compressão no cliente, fila offline, preview imediato |
| Offline | app shell precacheado, pacote de POP baixável, fila de upload persistente |
| Sessão | 30 dias com renovação silenciosa e aviso 3 dias antes de vencer |

Endpoints novos no backend (todos aditivos):

```
GET    /api/favorites            lista os favoritos do usuário da sessão, com o ativo completo
PUT    /api/favorites/{id}       favorita (idempotente)
DELETE /api/favorites/{id}       desfavorita (idempotente)
GET    /api/assets/{id}/package  subtree + anexos assinados + tamanho estimado
POST   /api/auth/refresh         empurra a validade da sessão, mesmo token
GET    /api/auth/me              passou a devolver também `session.expires_at`
```

`POST /api/assets/{id}/attachments` ganhou o campo opcional `gps: {lat, lon}`.
A PWA recomprime a foto antes de subir e o EXIF não sobrevive à recompressão,
então a coordenada — o único metadado que interessa — viaja no corpo do confirm
e vira `attrs.gps` do ativo. Cliente que não envia o campo continua funcionando.

---

## Rodar

```bash
docker compose up -d --build
```

Desktop em `http://localhost:8080/`, PWA em `http://localhost:8080/m/`.

Desenvolvimento com hot reload (a API precisa estar no ar):

```bash
make dev-mobile
```

Serve em `http://localhost:5174/m/`. O service worker fica desligado no modo dev
— para testar offline, use o build.

### HTTPS não é opcional

Service worker, câmera (`getUserMedia`), `navigator.clipboard` e
`crypto.randomUUID` só existem em **contexto seguro**: HTTPS ou `localhost`.
Servindo em `http://192.168.x.x:8080`, nada disso funciona e a PWA vira um site
comum — sem instalação e sem offline.

Em produção, ponha a VM atrás de um proxy com TLS e ajuste:

```
COOKIE_SECURE=true
MINIO_PUBLIC_ENDPOINT=https://storage.seudominio.com.br
```

O app degrada com elegância onde falta: a cópia do IP cai num `textarea` +
`execCommand`, o id da fila usa um gerador próprio, e o leitor de código de
barras simplesmente não aparece.

---

## Roteiro de teste offline

Precisa de um aparelho ou do Chrome com DevTools. Faça na ordem.

### 1. Instalar

1. Abra `https://<host>/m/` no Chrome do Android.
2. Menu → **Adicionar à tela inicial**. Confira o ícone e que abre sem barra de
   endereço (`display: standalone`).
3. No iOS, Safari → Compartilhar → **Adicionar à Tela de Início**.

**Esperado:** ícone na gaveta, app em tela cheia.

### 2. Aquecer o cache

1. Faça login.
2. Abra 2 ou 3 ativos diferentes — isso preenche o histórico local e o cache de
   `GET /api/assets*`.
3. Abra um POP → **Baixar para uso offline** → confira o tamanho estimado →
   **Baixar**.

**Esperado:** “Baixado em … · N ativos · X KB”.

### 3. Modo avião

1. Ative o modo avião.
2. Feche o app completamente e abra de novo.

**Esperado:** o app abre normalmente (app shell precacheado), **não** a tela de
dinossauro. O chip `offline` aparece no topo.

3. Home: histórico e favoritos aparecem com nome, IP e tipo — payload completo,
   não só o id.
4. Busque pelo nome de um ativo do pacote.

**Esperado:** resultados com a etiqueta `offline`.

5. Abra um ativo do pacote baixado.

**Esperado:** faixa “Dados offline do pacote *X*, de *data*”. A config abre
integral, em monoespaçada, sem quebra de linha e sem baixar arquivo.

### 4. Fotografar sem rede

1. Ainda em modo avião, no ativo aberto: toque na câmera e tire **3 fotos**.

**Esperado, a cada foto:**
- toast “foto guardada; sobe quando houver rede”;
- a miniatura aparece na hora na galeria, marcada como **pendente**;
- o chip do topo conta `3 pendentes`.

2. Feche o app de vez (não só minimize) e abra de novo, ainda sem rede.

**Esperado:** o chip continua em `3 pendentes` — a fila mora no IndexedDB.

### 5. Religar

1. Desligue o modo avião.

**Esperado:** em segundos as 3 sobem sozinhas, o chip some e as fotos passam de
“pendente” para miniatura normal. Confira no desktop que estão no ativo.

Se alguma falhar cinco vezes, ela fica marcada como **falhou** e não some da
tela: Ajustes → Fila de envio → *tentar de novo* ou *descartar*.

### 6. Conferir no desktop

Abra `/` no navegador do NOC e verifique que as fotos estão no ativo, com
thumbnail gerado. Se o ativo tinha GPS na foto, `attrs.gps` foi preenchido.

---

## Como o offline funciona

### Service worker (`src/mobile/sw.ts`)

Escrito à mão sobre a Cache API — o Vite injeta só o manifesto de precache.
Quatro estratégias:

| Recurso | Estratégia |
|---|---|
| App shell (JS/CSS/HTML) | precache, cache-first |
| `GET /api/assets*`, `/api/favorites` | network-first com fallback no cache |
| Thumbnail do MinIO (`*_thumb.jpg`) | cache-first, 30 dias, teto de 400 arquivos |
| Foto em resolução original | sem cache |

A chave de cache do thumbnail descarta a query string: a assinatura muda a cada
leitura e, sem isso, o mesmo arquivo entraria no cache a cada abertura da
galeria. Por isso a busca é feita em `mode: 'cors'` — `Cache.put` recusa
resposta opaca. O MinIO libera CORS para presigned URL por padrão; é a mesma
permissão que o upload direto do desktop já exige.

O escopo é `/m/`, então o worker não intercepta nada do app do NOC em `/`.

Atualização é por **prompt**, nunca automática: uma faixa azul aparece e o
técnico decide quando recarregar. Recarregar sozinho no meio de um upload em 3G
ruim é a pior hora possível.

### IndexedDB (`src/mobile/db/`)

Banco `sentinel-mobile`, um módulo por assunto:

| Store | Conteúdo |
|---|---|
| `recents` | 10 últimos ativos abertos, **com o payload inteiro** |
| `favorites` | favoritos, com `pending: 'add' \| 'remove' \| null` |
| `queue` | fila de upload: blob comprimido + metadados + backoff |
| `packages` / `packageAssets` / `packageFiles` | pacotes de POP |

A regra: nada é gravado só como id. Um id offline não serve para nada.

Todo acesso passa por `safely()` — modo anônimo, cota estourada ou Safari com
storage bloqueado derrubam o IndexedDB inteiro, e nada disso pode quebrar a
tela. Sem armazenamento local, o app vira online-only e continua funcionando.

### Fila de upload (`src/mobile/lib/sync.ts`)

Um item por vez (em 3G ruim, upload paralelo só faz os dois falharem), backoff
exponencial de 5s a 5min, 5 tentativas. Erro de regra (403, mime recusado,
ativo apagado) vai direto para `failed` em vez de queimar as cinco.

Gatilhos: evento `online`, app voltando ao primeiro plano, intervalo de 30s e
Background Sync onde existe.

**Limite conhecido:** o upload roda na aba, não dentro do service worker — o
blob e a sessão vivem lá. O Background Sync acorda o worker, que avisa as abas
abertas; se não houver nenhuma, a fila sobe na próxima vez que o técnico abrir o
app. Na prática o app fica aberto no bolso e a diferença não aparece. No iOS não
há Background Sync de qualquer forma.

### Compressão (`src/mobile/lib/image.ts`)

Redimensiona para no máximo 1920px no maior lado e recomprime em JPEG q80 via
Canvas. Medido no navegador: **7,5 MB → 554 KB** com uma imagem cheia de grão de
sensor (pior caso); foto normal fica perto de 400 KB.

`createImageBitmap(file, { imageOrientation: 'from-image' })` resolve a
orientação do EXIF — sem isso a foto tirada em pé sobe deitada.

O EXIF é lido antes (`lib/exif.ts`, leitor mínimo escrito à mão: só GPS e data
da captura) e a recompressão apaga o resto de graça. Se a foto não trouxer
coordenada, o app tenta `navigator.geolocation` com timeout de 4s — não bloqueia
o fluxo.

### Pacote offline de POP

`GET /api/assets/{id}/package` devolve o subtree, os anexos e as URLs assinadas
numa ida só. O cliente baixa **thumbnails e o texto integral das configs**;
foto em resolução original fica de fora — são os megabytes que não cabem e não é
o que se olha dentro de um armário de rede.

A estimativa mostrada antes do download soma o tamanho real das configs mais
45 KB por thumbnail (o pós-processamento gera 480px q78). É estimativa mesmo; o
tamanho real aparece depois de baixar. Um STAT no MinIO por foto deixaria a
prévia lenta sem melhorar a decisão.

---

## Decisões que valem explicar

**Nenhuma biblioteca de UI.** CSS próprio, ~12 KB. O bundle inteiro (React +
Router + Query + app) dá 84 KB gzip.

**Descrição em texto, não Markdown.** O desktop usa `react-markdown`; trazê-lo
para cá custaria quase metade do bundle atual por um campo que quase sempre tem
duas linhas. Aqui a descrição preserva quebras de linha e nada mais.

**Leitor de código de barras só com `BarcodeDetector`.** Onde a API nativa não
existe (iOS, Firefox) o botão não aparece. O `zxing-js` resolveria, mas pesa
mais que o app inteiro — se virar requisito, entra por `import()` sob demanda.

**Alvos de toque.** Linha de lista com 56px, botão de ação com 56px, qualquer
alvo com no mínimo 44px. O técnico pode estar de luva.

**Modo sol** (Ajustes → Tela) inverte para fundo branco com contraste máximo.
O tema escuro é o padrão — economiza bateria e não cega em armário de rede à
noite —, mas ao meio-dia na rua nenhum tema escuro se lê.

**Voltar respeita a hierarquia.** Entrar direto num nó fundo (link do WhatsApp,
resultado de busca) deixaria o "voltar" do navegador saindo do app. A tela de
drill-down semeia a pilha de histórico com a cadeia de ancestrais, então voltar
sobe um nível — verificado: `SW-Cen-01 → RB-Centro → POP Centro → raiz`.

**Status continua sendo uma bolinha.** Sem gráfico, sem histórico, sem alerta.
Isso é do Zabbix, e o rodapé da tela de detalhe diz isso em voz alta.
