# roadmap.md

Estado do produto por fase. `[x]` implementado e verificado (build/testes/type-check),
`[~]` implementado parcialmente ou com ressalva, `[ ]` não iniciado.

Verificação nesta sessão: `go build`/`go vet`/`go test ./... -run '^$'` (compila
tudo, integração pula sem Postgres), `tsc --noEmit`, `vite build` dos dois
bundles, tela de login carregada num browser real. **Não rodei a stack
completa via `docker compose`** (sem daemon Docker no ambiente de
desenvolvimento usado) — os fluxos ponta a ponta (criar → ver na árvore →
excluir → conferir MinIO) não foram exercitados com banco e storage reais.
Isso é o maior risco em aberto, não a falta de funcionalidade.

---

## Fase 1 — Desktop/NOC

Já existia antes deste trabalho: schema, API completa de leitura/CRUD básico,
três painéis (árvore/canvas/detalhe), upload de anexos, autenticação por
sessão, poller ICMP, supressão de alerta em cascata.

## Fase 2 — PWA mobile

Já existia antes deste trabalho: bundle `/m` separado, drill-down com
breadcrumb, favoritos, pacote offline, fila de sincronização.

> `prompt-1-desktop.md` e `prompt-2-mobile-pwa.md`, referenciados pelo
> `claude.md`, não existem neste repositório.

---

## Fase 3 — CRUD completo, edição e preenchimento de lacunas

### P0.0 — Desbloquear o primeiro uso

- [x] P0.0.1 — Onboarding centralizado quando `count(assets) == 0` (criar primeiro ativo / importar CSV / carregar dados de exemplo), some ao criar o primeiro ativo, volta ao apagar o último
- [x] P0.0.2 — Botão "Novo ativo" em destaque no header, atalho `N`, `+` no hover de cada nó da árvore
- [x] P0.0.3 — Barra de controles do canvas escondida com banco vazio; chips de `kind` começam todos ativos; filtro persistido em `localStorage`; botão "limpar filtros"
- [x] P0.0.4 — Painéis redimensionáveis por arraste (largura persistida); acentuação corrigida em toda a UI desktop
  - [~] Hierarquia tipográfica e contraste: mantive o que já existia na fase 1, sem redesenho — não fiz uma auditoria formal de WCAG AA

### P0 — Tornar o sistema operável

- [x] P0.1 — Criar ativo: `AssetDrawer` único acionável dos três lugares pedidos (header, `+` da árvore, "adicionar filho" no detalhe), parent com busca, "salvar e criar outro" mantém pai/tipo, erros de campo inline
- [x] P0.2 — Editar ativo: inline (nome, IP, status) com `Enter`/`Esc` e rollback otimista; drawer completo para tipo/pai/attrs
- [x] P0.3 — Mover: drag-and-drop bloqueia ciclo visualmente antes da API; confirmação com contagem de descendentes tanto no drag quanto na troca de pai pelo formulário; `pos_x`/`pos_y` sobrevivem ao move
- [x] P0.4 — Excluir com guarda: folha pede confirmação simples; ativo com filhos oferece reparent pro avô (`DELETE ?reparent_children=1`); cascata nunca é oferecida
- [x] P0.5 — Editor de `attrs`: tabela chave/valor, template sugerido por `kind` (`internal/config/kind-templates.default.json`), chave duplicada bloqueada, tipo (string/número/booleano) preservado
- [x] P0.6 — Ciclo de vida de anexo: excluir, renomear, definir capa, reordenar fotos por arraste, indicador "alterada" quando o hash da config mais recente difere da anterior
  - [~] Capa não aparece no card do canvas nem na árvore — só no cabeçalho do Detail e na lista de filhos diretos (decisão documentada no `claude.md`: evitar presign por nó em telas com centenas de ativos)
- [x] P0.7 — Estados de tela: vazio com onboarding, skeleton em vez de spinner de página inteira, erro com retry, busca sem resultado sugere criar

### P1 — Manutenção em escala

- [x] P1.1 — Duplicar ativo (drawer prefilled, nome/IP em branco) e duplicar com subtree (nomes sufixados, transacional)
- [x] P1.2 — Import CSV em duas etapas (preview valida linha a linha, commit transacional — tudo ou nada), resolução de pai por nome com erro em ambiguidade, reimportar não duplica
- [x] P1.3 — Edição em massa: seleção múltipla na árvore, mudar tipo/pai/attrs/excluir em lote, falha parcial reportada por item
- [x] P1.4 — Auditoria: tabela `asset_audit`, aba "Histórico" no detalhe com diff legível
- [x] P1.5 — Gestão de usuários: criar (já existia), resetar senha, ativar/desativar (novo); `viewer` recebe 403 nas rotas de escrita (já existia)

### P2 — Refinamento

- [x] Undo para exclusão e movimentação — mover reverte com um segundo move; excluir adia o `DELETE` real ~10s (o ativo some da UI na hora, mas só é apagado de fato — anexos inclusive — se o "desfazer" não for clicado)
- [ ] Kinds configuráveis por interface, migrando de arquivo (`kinds.default.json`) para tabela, com ícone e cor definíveis — maior item pendente; muda validação de `kind` de estática para consulta no banco em vários pontos do domínio
- [ ] Validação de IP duplicado (aviso, não bloqueio, quando `mgmt_ip` já existe em outro ativo)
- [ ] Atalhos `E` (editar selecionado) e `Del` (excluir selecionado) — `N` (novo) e `Ctrl+K`/`/`-like busca já existem
- [ ] Tags livres além de `kind`, com filtro na árvore e no canvas

### P3 — Depois

- [ ] Diff visual entre versões de arquivo de config
- [ ] Exportar subtree em CSV/JSON
- [ ] Campos customizados com schema validado por `kind`
- [ ] Aprovação de alteração para `viewer` (sugestão vira pendência de admin)

---

## Dívidas e riscos abertos

- **Sem verificação end-to-end real.** Tudo verificado por build/type-check/testes que compilam; nenhum fluxo foi clicado contra Postgres/MinIO reais nesta sessão. Prioridade #1 antes de considerar a fase 3 "pronta": `docker compose up -d --build`, `make seed` (ou onboarding), e passar pelo checklist do `claude.md`.
- **Kinds ainda vêm de arquivo**, não de tabela — bloqueia o item de P2 mais citado (ícone/cor editáveis pela UI).
- **Sem teste de UI automatizado** (Playwright/Cypress não existe no projeto) — a validação de ciclo no drag-and-drop e os fluxos de drawer são cobertos só manualmente/visualmente, não por teste automatizado de interface. Os testes Go cobrem a validação de ciclo, reparent-on-delete e import CSV transacional no nível de serviço.
- **`prompt-1-desktop.md`/`prompt-2-mobile-pwa.md` ausentes** — se alguém for revisar a fase 1/2 contra a especificação original, essa especificação não está neste repositório.
