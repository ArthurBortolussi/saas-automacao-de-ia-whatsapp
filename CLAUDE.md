# CLAUDE.md — Arthur AI

Guia para sessões do Claude Code neste repositório. O README é a documentação de uso; este arquivo resume o
estado do projeto, as regras que não podem ser quebradas e as decisões já tomadas. **Mantenha os dois coerentes.**

## Propósito

SaaS B2B **gerenciado** (não self-service) de atendimento pelo WhatsApp com IA. O SUPERADMIN (dono da plataforma)
cadastra empresas e usuários; cada empresa acessa só o próprio ambiente. Público: pequenas e médias empresas
brasileiras (interface e mensagens em português do Brasil).

## Stack e monorepo (pnpm workspaces, sem Turborepo/Nx)

| Caminho | O que é |
|---|---|
| `apps/api` | NestJS 12 (**ESM-only**), única camada que acessa o banco. Prefixo `/api` |
| `apps/web` | Next.js 16 (App Router), Tailwind v4, shadcn/ui. O arquivo de interceptação é `proxy.ts` (antigo middleware) |
| `packages/database` | Prisma **7.10.0 (versão fixa)**, `prisma7.config.ts`, migrations, seed, hash de senha, `TokenCipher` |
| `packages/shared` | Schemas Zod (fonte única de validação para web e api), enums, tipos de resposta, regras de conversa |
| `packages/ui` | Componentes shadcn/ui copiados do código-fonte oficial + tokens de tema |

Versões escolhidas de propósito (não "atualizar" sem motivo): TypeScript **6.0** (`typescript-eslint` exige < 6.1),
ESLint **9** (plugins do `eslint-config-next` não suportam o 10), Vitest (Jest não carrega o Nest 12 ESM no Node 22),
Prisma 7.10.0 (a tag `latest` do CLI `prisma` no npm aponta para uma RC da v8). Node ≥ 22.12.

Fluxo: navegador → Next (`/api/*` reescrito para a API, cookie first-party) → NestJS → PostgreSQL.
Server Components chamam a API direto repassando só o cookie de sessão.

## O que existe

**Fase 1 — fundação.** Login com sessão no banco (cookie `httpOnly`, token guardado como SHA-256), argon2id,
checagem de `Origin` em requisições mutáveis, rate limit de login (memória), troca obrigatória de senha, AuditLog.
Painel `/admin` (dashboard, empresas, usuários, criação de usuário de empresa) e área `/dashboard` da empresa.

**Fase 2 — contatos e Inbox.** `/dashboard/contacts` (CRUD, busca, paginação) e `/dashboard/inbox` em 3 colunas.
Conversas com modo `AI | HUMAN | PAUSED` (assumir, devolver para IA, pausar, reativar), concorrência otimista.

**Fase 3 — WhatsApp Cloud API oficial.** Um número por empresa (`WhatsAppAccount`), token cifrado,
webhook assinado, fila persistente no PostgreSQL, recebimento (contato/conversa/mensagem automáticos), envio
pela Inbox (outbox com retentativas), status de entrega monotônicos, janela de 24h, configuração na aba WhatsApp
do admin, Inbox com polling de 5 s. Ferramentas de simulação local (`whatsapp:mock-graph`, `whatsapp:simulate`).

**Fase 4 — IA e base de conhecimento.** Atendimento automático com o Claude Sonnet (`apps/api/src/ai/`), base de
conhecimento por empresa, configurações da IA por empresa, transferência para humano, horário da IA, aba Uso
(tokens e custo estimado). Telas: admin → empresa → IA, Base de conhecimento, Uso; dashboard → Base de conhecimento,
Configurações (IA); aviso de transferência na Inbox. Simulador local `ai:mock-anthropic`. Detalhes na seção abaixo.

**Fase 5 — equipe e atendimento humano.** Aba Equipe (cadastro com senha provisória, perfis, ativação, limites,
disponibilidade), distribuição automática, fila persistente com mensagem de espera, transferências, encerramento manual
e por inatividade, reabertura no modo padrão da empresa. Detalhes na seção abaixo.

**Fase 6 — Analytics e relatórios.** `/dashboard/analytics` (OWNER/ADMIN, só operacional) e `/admin/analytics`
(SUPERADMIN, com consumo e custo estimado da IA), períodos hoje/7/30 dias, exportação PDF e .xlsx, ciclos de
atendimento (`ConversationCycle`). Detalhes na seção abaixo.

**Placeholder** (tela existe, sem lógica): admin → Configurações.

## Regras de segurança e multi-tenancy (obrigatórias)

- **Autorização é sempre no backend.** O Next só redireciona.
- Toda rota com dados de empresa fica em `/companies/:companyId/...` (ou `/admin/companies/:companyId/...`) e usa o
  **`CompanyAccessGuard`**: confere o vínculo `(userId, companyId)` no banco; empresa alheia ou inexistente → 403;
  empresa `PAUSED`/`INACTIVE` → 403; SUPERADMIN passa. Controllers leem a empresa com `@CurrentCompany()`.
- Services **sempre** filtram pelo `company.id` recebido do guard; buscas por ID usam a chave composta
  `id_companyId`. Um ID de outra empresa deve resultar em 404, nunca em dado alheio.
- O banco reforça o isolamento: FKs compostas `(id, companyId)` em `Conversation → Contact` e `Message → Conversation`;
  `CompanyMember.userId` é único nesta fase, mas a autorização nunca depende disso.
- Validação: schemas Zod do `@arthur-ai/shared` com `strictObject` (campos desconhecidos → 400), aplicados por
  `@Body({ schema })`, `@Query({ schema })`, `@Param("x", { schema })`. Nada de class-validator.
- Segredos: tokens da Meta cifrados com AES-256-GCM e `companyId` como dado autenticado; **nunca** em respostas,
  logs, auditoria ou frontend. Erros da Meta são traduzidos para mensagens próprias (texto bruto não é exibido).
  A chave da Anthropic (`ANTHROPIC_API_KEY`) só existe em `env.ai` e no `AiModelClient`; nunca em banco, respostas ou logs.
- IA: conteúdo de clientes e da base é **dado, não instrução**; o prompt só recebe dados da empresa da conversa.
- Analytics: relatório e exportação da empresa **nunca** têm tokens, custos ou consumo da IA (DTO próprio montado campo a
  campo); dados financeiros só em `/admin/...` (SUPERADMIN). AGENT recebe 403 no backend.
- Webhooks: `@Public()` + `@SkipOriginCheck()` e autenticação pela assinatura `X-Hub-Signature-256` sobre o corpo bruto.
- `TRUST_PROXY`: o rewrite do Next **não** adiciona o IP do cliente ao `X-Forwarded-For`. Veja o README antes de publicar.
- Produção: a API recusa subir sem `SESSION_COOKIE_SECURE=true`, com WhatsApp configurado pela metade, com a Graph
  API simulada ou com os valores fictícios do `.env.example`.
- Nunca commitar `.env`. Dados de seed são fictícios e o seed recusa `NODE_ENV=production`.

## Convenções de código

- ESM com NodeNext: imports relativos com extensão `.js` na api e nos pacotes.
- TypeScript strict, sem `any`, sem `@ts-ignore`/`@ts-expect-error`, **sem `eslint-disable`** e sem pular testes.
- Comentários só para decisões não óbvias, em português. Mensagens ao usuário em português.
- Migrations: o `prisma migrate dev` falha em terminal não interativo; gere o SQL com
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` dentro de uma pasta
  `prisma/migrations/<timestamp>_<nome>/` e aplique com `migrate deploy`. Migrations devem ser **aditivas**;
  `CHECK`s extras são escritos à mão no SQL.
- Enums existem no Prisma e no `shared`; `packages/database/src/enum-parity.ts` falha o typecheck se divergirem.
- `next dev` gera `apps/web/AGENTS.md` e `apps/web/CLAUDE.md` automaticamente: não são deste projeto, não commitar.

## Comandos

```bash
pnpm install
cp .env.example .env          # valores de DEV; o bloco WHATSAPP_* liga o modo SIMULADO
docker compose up -d          # PostgreSQL 16 (+ banco arthur_ai_test)
pnpm db:deploy                # migrations
pnpm db:seed                  # dados fictícios (logins de dev no README)
pnpm dev:api                  # http://localhost:4000/api
pnpm dev:web                  # http://localhost:3000
pnpm whatsapp:mock-graph      # Graph API simulada em :4010 (opcional)
pnpm whatsapp:simulate --from 5511988887777 --text "Olá"   # mensagem de cliente simulada
pnpm ai:mock-anthropic        # API da Anthropic simulada em :4020 (NÃO é o Claude)

pnpm lint && pnpm typecheck && pnpm build && pnpm test     # validação completa
```

No Windows (ambiente do desenvolvedor): `pnpm.cmd` no lugar de `pnpm`, no PowerShell.
Testes: **e2e contra PostgreSQL real** (`TEST_DATABASE_URL`, o nome precisa terminar em `_test` e é truncado),
pelo HTTP com cookie real; a Meta e a Anthropic são substituídas por servidores HTTP falsos (`test/whatsapp-helpers.ts`,
`test/ai-helpers.ts`; o SDK oficial roda de verdade contra eles). Estado atual: 16 arquivos, 276 testes passando.
`test/ai-simulator.e2e.test.ts` sobe o próprio `scripts/ai-mock-anthropic.mjs` com a base da Empresa Demo.
Testes que disparam os workers devem chamar `whatsapp.drain()` / `ai.drain()` / `team.drain()` antes de limpar o banco
(`TEAM_WORKER_INTERVAL_MS=0` nos testes). Helpers da equipe em `test/team-helpers.ts`.
`test/test-env.ts` zera todas as `AI_*`/`ANTHROPIC_*` do `.env` do desenvolvedor: nenhum teste chama a Anthropic real.

## WhatsApp: simulação × integração real

| | Situação |
|---|---|
| Graph API simulada (`WHATSAPP_GRAPH_API_BASE_URL=http://localhost:4010`) | Fluxo completo validado no navegador: receber, responder, status até "lida", falhas |
| Meta real (`https://graph.facebook.com`, Graph API `v25.0`) | **Não validada.** Nenhuma chamada real foi feita (domínios da Meta bloqueados no ambiente de desenvolvimento) |
| Anthropic simulada (`ANTHROPIC_BASE_URL=http://localhost:4020`) | Fluxo completo validado (agrupamento, resposta, transferência, consumo, cache) |
| Anthropic real (`claude-sonnet-5-5`) | **Não validada.** Nenhuma chamada real foi feita; qualidade e custo reais ainda desconhecidos |

Para conectar um número real: app na Meta com WhatsApp, WABA com número registrado, token permanente de
System User, App Secret, endpoint **HTTPS público** para o webhook (túnel em dev). Passo a passo no README.
Não declarar a integração real como funcionando antes de testá-la com um número de verdade. O mesmo vale para o Claude.

Armadilha: variáveis já definidas no sistema vencem o `.env` (`process.loadEnvFile` não sobrescreve). O ambiente
do Claude Code na nuvem define `ANTHROPIC_BASE_URL`: para testar com o simulador ali, rode a API com
`ANTHROPIC_BASE_URL=http://localhost:4020 pnpm dev:api`.

## Limitações conhecidas

As principais (lista completa no README): rate limit em memória; Inbox por polling e limitada às 50 conversas
mais recentes; mídia recebida só como aviso e envio só de texto; sem gerenciador de modelos (templates), logo nada é
enviado fora da janela de 24h; "Nova conversa" pelo painel é interna; possível envio duplicado se a API cair entre
o aceite da Meta e a gravação do wamid; sem edição de empresa/usuário pelo painel; IA validada só com simulador;
base só com texto; mídia vai direto para humano; sem limite de gasto (decisão do proprietário); disponibilidade
manual (não depende de presença); funcionário não puxa conversa da fila manualmente; conversas só com a IA nunca são
encerradas automaticamente (Analytics: "somente IA encerrados" ≈ 0 e "em andamento" acumula — decisão de produto
pendente); fuso da empresa sem edição pelo painel; custo da IA só em USD e estimado.

## Próximos passos (fora da Fase 4, quando o cliente pedir)

Validar o WhatsApp com número real e a IA com a chave real (conversas de teste, medir custo por conversa, revisar o
prompt com respostas reais); gerenciador de modelos aprovados; mídia; edição/pausa de empresas e usuários;
tempo real (websocket) se o polling pesar; rate limit compartilhado se houver mais de uma instância da API;
upload de documentos e busca na base (full-text do PostgreSQL) se as bases crescerem; decidir o encerramento
automático de conversas da IA; edição do fuso da empresa.

## Fase 4 — implementada (IA e base de conhecimento)

**Decisões do proprietário (definitivas):**
1. Modo inicial das conversas configurável por empresa (`AI` ou `HUMAN`; padrão `AI`), só pelo SUPERADMIN. Afeta só
   conversas novas.
2. Base de conhecimento: SUPERADMIN (qualquer empresa) e OWNER/ADMIN (a própria) editam; AGENT só consulta (as ativas).
3. Horário da IA por empresa: 24h ou dias + início/término + fuso IANA (padrão `America/Sao_Paulo`). Fora dele a IA não
   gera nem envia. Não confundir com o horário de funcionamento da empresa (`Company.businessHours`).
4. Mensagem de transferência personalizável (SUPERADMIN e OWNER/ADMIN); padrão em `DEFAULT_HANDOFF_MESSAGE`.
5. Modelo: Claude **Sonnet** pela API oficial, `claude-sonnet-5-5` (configurável por `AI_MODEL`). **Não usar Opus como padrão.**
6. Sem limite mensal de gasto; consumo obrigatório registrado (`AiRun`) e visível ao SUPERADMIN (aba Uso).

Decisões de implementação (minhas, revisáveis): IA nasce **desligada** por empresa (`AiSettings.enabled=false`; ligar é
do SUPERADMIN); OWNER/ADMIN editam nome, tom, orientações, mensagem de transferência e horário; `AI_EFFORT=low`;
sem `fallbacks` de servidor na recusa (poderia cair num Opus; recusa vira transferência).

**Peças (apps/api/src/ai/):**
- `AiReplyTask`: uma tarefa por mensagem recebida, criada pelo `webhook-processor` **na mesma transação** da mensagem e
  só se a conversa está em `AI`. O evento `ConversationEvents` só antecipa o ciclo do worker.
- `ai-worker.service.ts`: fila no PostgreSQL. Agrupa por conversa (`AI_BATCH_DELAY_MS`/`AI_BATCH_MAX_WAIT_MS`), reserva
  com `FOR UPDATE SKIP LOCKED` na linha da conversa, lote = `runId`, reserva vencida é retomada.
- `ai-reply.service.ts`: checagens sem custo → contexto → modelo → envio pelo `WhatsAppOutboundService` com
  `inTransaction` (marca a tarefa `DONE` na transação da mensagem; se não estiver `RUNNING`, aborta) → `AiRun`.
- `conversations.service.changeMode` cancela tarefas `PENDING`/`RUNNING` em qualquer troca de modo.
- `prompt.ts` (regras fixas, bloco da empresa escapado, histórico, seleção da base), `pricing.ts` (preços oficiais
  conferidos em 2026-10-02; `AI_PRICE_*` sobrescreve), `ai-model.client.ts` (único uso do SDK; classifica erros).
- Histórico ordenado por `Message.id` (UUIDv7 = ordem de gravação), não por `createdAt` (recebidas usam o horário da
  Meta, em segundos).
- Rotas: `GET /companies/:id/ai`, `PATCH /companies/:id/ai/settings` (OWNER/ADMIN), `/companies/:id/knowledge-base`
  (CRUD; escrita OWNER/ADMIN), `PATCH /admin/companies/:id/ai/settings` e `GET /admin/companies/:id/ai/usage` (SUPERADMIN).

**Simulador ≠ Claude:** `ai-mock-anthropic.mjs` devolve a entrada da base com mais palavras em comum com o último turno
do cliente (palavra inteira, singular aproximado). Resposta errada do simulador não prova erro no prompt: confira o prompt
enviado (testes) antes de mexer na produção. Corrigido em 2026-10-02: casava substring ("atendem" ⊂ "Atendemos") e
pegava a primeira entrada, não a melhor. A seleção de produção (`keywords`/`singular` em `prompt.ts`) usa a mesma ideia.

**Pontos de atenção para a próxima fase:** validar com o Claude real (qualidade das respostas, taxa de transferência,
custo por conversa, `cache_read_input_tokens` > 0 a partir da 2ª mensagem); respostas descartadas por troca de modo são
pagas; a seleção da base por palavras pode errar em bases grandes.

## Fase 5 — implementada (equipe e atendimento humano)

**Decisões do proprietário (definitivas):** distribuição automática para quem tem menos atendimentos, empate em
rotação; disponibilidade manual `AVAILABLE | BUSY | AWAY` persistida (só AVAILABLE recebe novas); BUSY/AWAY mantêm as
conversas (sem redistribuição automática); limite individual definido por OWNER/ADMIN e aplicado na distribuição e nas
transferências; encerramento manual e automático por inatividade (prazo por empresa); cliente que volta após o
encerramento segue o modo padrão da empresa (IA ou fila humana), na mesma conversa; administração cotidiana da equipe é
do OWNER/ADMIN, SUPERADMIN só supervisiona; fila com mensagem de espera fixa enviada uma vez por entrada.

**Três conceitos separados — não misturar:** `Conversation.mode` (AI/HUMAN/PAUSED: quem responde),
`Conversation.status` (OPEN/QUEUED/ASSIGNED/CLOSED: andamento) e `CompanyMember.availability`. CHECKs no banco impedem
combinações contraditórias (ver a migration `20261003120000_team_distribution`); o responsável tem FK composta para
`CompanyMember(companyId, userId)`.

**Regras de implementação (minhas, revisáveis):** membros nascem `AWAY`; desativar devolve as conversas da pessoa à
fila (sem nova mensagem de espera) e encerra as sessões; "Assumir" respeita o limite e só é permitido a membros da
empresa; AGENT pode assumir uma conversa PAUSADA de outra pessoa (regra da Fase 2 preservada), mas não mexe em
atendimento ativo de colega; SUPERADMIN não transfere/encerra/administra equipe (403), mas mantém a criação técnica de
usuários (aba Usuários, Fase 1) e pode consultar tudo; conversas humanas antigas sem responsável ficam `OPEN` até o
cliente escrever (entram na fila) ou serem atribuídas.

**Peças (apps/api/src/team/):**
- `team-lock.ts`: `lockCompanyTeam(tx, companyId)` = `pg_advisory_xact_lock` por empresa. **Toda** mudança de
  atribuição (distribuir, transferir, encerrar, assumir, devolver à IA, disponibilidade, limites, ativação) usa essa trava.
- `distribution.service.ts`: candidatos (SQL), `distribute`, `assign` (condicional ao status esperado),
  `transfer`, `closeManually`, `closeInactive`, `sendQueueNotices`, `requeueMemberConversations`.
- `conversation-state.ts`: `queuedData`, `releasedData`, `endOpenAssignment` (puros; usados por webhook, IA e conversas).
- `team.service.ts`/`team.controller.ts`: `GET /companies/:id/team`, `POST .../team/members`, `PATCH .../team/members/:userId`,
  `PATCH .../team/me/availability`, `PATCH .../team/settings`.
- `team-worker.service.ts`: a cada `TEAM_WORKER_INTERVAL_MS` distribui as filas (recuperação), envia avisos e encerra
  inativos; `ConversationEvents.emitHumanQueued` antecipa o ciclo.
- Conversas: `POST .../conversations/:id/close`, `POST .../:id/transfer`, `GET .../:id/assignees`, filtros
  `mine|queued|unassigned|closed` e `assigneeId`. `webhook-processor` trava a linha da conversa (FOR UPDATE) antes de
  decidir reabrir/enfileirar. A IA (`ai-reply.service` `switchToHuman`) coloca na fila na mesma transação.
- `lastActivityAt` = critério de inatividade: mensagem recebida, envio (equipe/IA/sistema) e atribuição.

## Fase 6 — implementada (Analytics e relatórios)

**Decisões do proprietário (definitivas):** dois painéis (empresa: OWNER/ADMIN; plataforma: SUPERADMIN); AGENT sem
acesso (403 no backend); custos/tokens só para o SUPERADMIN; períodos apenas `today`/`last7days`/`last30days`
(calendário, incluindo hoje) com um seletor único por painel; exportação PDF e .xlsx; "somente pela IA" não é prova de
resolução e separa encerrados × em andamento; equipe só agregada (sem ranking); tempo de primeira resposta HUMANA
(IA não conta) e espera na fila à parte; painel simples (cards + poucos gráficos).

**Modelo:** `ConversationCycle` = um atendimento (criação/reabertura → encerramento). Índice único parcial: um ciclo
aberto por conversa; CHECKs na migration `20261004120000_analytics_cycles`. Marcos gravados por
`apps/api/src/analytics/cycle-tracker.ts` **dentro das transações existentes** (depois da gravação condicional que trava
a conversa): `startCycle` (webhook novo/reabertura, "Nova conversa"), `markQueued` (toda entrada na fila),
`markLeftQueue` (saída sem atribuição), `markAssigned` (toda atribuição; conclui a espera), `markAiActivity`/`markAiHandoff`,
`markHumanReply` (mensagem AGENT), `closeCycle`. "Primeiro X" usa `LEAST` (menor horário). **Qualquer fluxo novo que
mude fila/atribuição/encerramento ou envie mensagem precisa chamar o marco correspondente.**
`Company.timezone` (padrão `America/Sao_Paulo`, sem UI); `AiRun.apiSource` (`OFFICIAL`|`SIMULATED`, gravado na
execução a partir de `env.ai.simulated`; nulo = origem não verificada, nunca deduzido) e `AiRun.cycleId`.

**Cálculo (`analytics-queries.service.ts`, só leitura, SQL agregado):** coorte = ciclos com `startedAt` no período,
classificados pelos marcos `<= instante de referência (at)`; encerrados pelo `closedAt`; "agora" pelo estado atual das
conversas. Escopo da empresa sempre pelo id do `CompanyAccessGuard`. Admin usa o fuso da plataforma em tudo (inclusive
a aba Uso, que reaproveita `aiUsage`). Custo = soma de `AiRun.costUsd` (já estimado por `pricing.ts`), em USD.

**Exportação:** `report-content.ts` monta o conteúdo uma vez a partir do mesmo objeto da API; `report-pdf.ts` (pdfkit) e
`report-xlsx.ts` (write-excel-file) só desenham. Em memória, `no-store`, `nosniff`, limite por usuário
(`ExportRateLimiter`), auditoria `analytics.exported`. A tela passa `at` (até 24 h) para o arquivo reproduzir o recorte.
Testes leem o .xlsx com `fflate` (devDependency).

**Dados antigos:** um ciclo `BACKFILL` por conversa (só o ciclo atual; `humanRequestedAt` nulo ⇒ fora das médias).
Não reconstruir ciclos antigos por suposição.
