# SESSION_CONTEXT — Arthur AI (passagem de contexto)

## 1. Objetivo e tecnologias
SaaS B2B **gerenciado** de atendimento pelo WhatsApp com IA, para PMEs brasileiras (tudo em pt-BR). O SUPERADMIN
cadastra empresas; cada empresa só acessa o próprio ambiente.
Monorepo pnpm · NestJS 12 (ESM-only) · Next.js 16 (App Router, `proxy.ts`) · PostgreSQL 16 + Prisma **7.10.0 fixo** ·
Zod compartilhado · WhatsApp Cloud API (Graph v25.0) · Claude `claude-sonnet-5-5` (`@anthropic-ai/sdk`) · Vitest ·
TypeScript 6.0 · ESLint 9 · pdfkit + write-excel-file (exportações). Não atualizar versões sem motivo.

## 2. Branch e GitHub
- Repositório `ArthurBortolussi/saas-automacao-de-ia-whatsapp`, branch **`claude/new-session-fucivv`** (única
  autorizada; não usar outras branches nem mexer na `main`).
- Ambiente do desenvolvedor: Windows + PowerShell (instruções com `pnpm.cmd`).

## 3. Estado atual
Fases 1 a 6 concluídas, incluindo a correção pós-Fase 6 (encerramento automático da IA). Tudo validado localmente
**apenas com simuladores** (Meta e Anthropic reais nunca chamadas).

## 4. Fases (resumo)
- **F1** login com sessão no banco (cookie httpOnly, argon2id), troca obrigatória de senha, Origin check, rate limit,
  AuditLog, painéis `/admin` e `/dashboard`.
- **F2** contatos (CRUD) e Inbox 3 colunas (polling 5 s); modos `AI | HUMAN | PAUSED`.
- **F3** WhatsApp: um número por empresa, token AES-256-GCM, webhook assinado, fila de eventos no PG, outbox com
  retentativas, status monotônicos, janela de 24h.
- **F4** IA (Sonnet) com base de conhecimento, configurações por empresa, transferência para humano, aba Uso.
- **F5** equipe, disponibilidade manual, distribuição automática, fila com aviso, transferências, encerramento manual e
  por inatividade, reabertura no modo padrão da empresa.
- **F6** Analytics da empresa (OWNER/ADMIN, sem custos) e da plataforma (SUPERADMIN, com consumo/custo da IA), períodos
  hoje/7/30 dias, exportação PDF/.xlsx, ciclos de atendimento.
- **Pós-F6** prazo de inatividade próprio da IA por empresa (padrão 4 h) encerra atendimentos só com a IA.

## 5. Regras críticas
**Isolamento e segurança**
- Autorização só no backend. Rotas de empresa: `/companies/:companyId/...` + `CompanyAccessGuard` (alheia → 403);
  restrição de perfil com `@CompanyRoles`; rotas `/admin/...` com `SuperadminGuard`.
- Services filtram pelo `company.id` do guard; busca por ID com chave composta `id_companyId` (ID alheio → 404).
- FKs compostas `(id, companyId)` entre as tabelas da empresa; Zod `strictObject` (campo desconhecido → 400).
- Segredos (token Meta, `ANTHROPIC_API_KEY`) nunca em respostas, logs, auditoria ou front. Nunca commitar `.env`.
- Produção recusa cookie inseguro, APIs simuladas e valores fictícios do `.env.example`.
- Conteúdo de clientes e da base é dado, não instrução; o prompt só leva dados da empresa da conversa.

**Conversa** — três conceitos separados: `mode` AI/HUMAN/PAUSED (quem responde), `status` OPEN/QUEUED/ASSIGNED/CLOSED
(andamento), `CompanyMember.availability` AVAILABLE/BUSY/AWAY. CHECKs no banco impedem combinações inválidas.

**WhatsApp/IA/Equipe**
- Toda saída passa por `WhatsAppOutboundService.send` (janela de 24h e modo conferidos na transação; hook `inTransaction`).
- Mensagem recebida: grava mensagem + `AiReplyTask` (modo AI) na mesma transação, com a linha da conversa travada
  (FOR UPDATE); conversa CLOSED reabre a mesma conversa num ciclo novo, no modo padrão da empresa.
- Toda mudança de atribuição/encerramento usa `lockCompanyTeam` (advisory lock por empresa) e gravação condicional.
- Workers (whatsapp, ai, team) rodam dentro da API com fila no PostgreSQL; eventos em memória só antecipam ciclos.
- Inatividade (`lastActivityAt`): prazo da equipe (`TeamSettings`) só para ASSIGNED; prazo da IA (`AiSettings.
  inactivityTimeoutMinutes`, 5–43.200) só para `mode=AI` + `OPEN`, sem envio ou tarefa da IA pendente. HUMAN/PAUSED nunca.

**Analytics**
- `ConversationCycle` = um atendimento (criação/reabertura → encerramento), no máximo um aberto por conversa.
- Marcos gravados por `analytics/cycle-tracker.ts` dentro das transações existentes. **Todo fluxo novo que mude
  fila/atribuição/encerramento ou envie mensagem precisa chamar o marco correspondente.**
- Relatório/exportação da empresa nunca têm tokens/custos (DTO próprio). AGENT → 403.
- `AiRun.apiSource` (OFFICIAL/SIMULATED gravado na execução; nulo = não verificado). Custo em USD, só estimativa.
- Migrations sempre **aditivas** (`prisma migrate diff ... --script`; CHECKs à mão); enums espelhados no shared
  (`enum-parity.ts`).

## 6. Arquivos-chave
```
apps/api/src/
  common/guards/ (company-access, superadmin, session, origin)  common/decorators/  config/env.ts
  companies/  admin/  auth/  audit/audit.service.ts (AUDIT_ACTIONS)
  conversations/conversations.service.ts   whatsapp/ (webhook-processor, whatsapp-outbound, workers)
  ai/ (ai-settings.service, ai-reply.service, ai-usage.service, pricing.ts, prompt.ts, ai-model.client.ts)
  team/ (distribution.service: distribute/assign/transfer/close*/closeInactiveAi, team-worker, team-lock, team.service)
  analytics/ (cycle-tracker, analytics-queries.service, analytics.service, controller, report-content/pdf/xlsx)
apps/api/test/  e2e + helpers (helpers, whatsapp-helpers, ai-helpers, team-helpers)
apps/web/src/app/admin/ (companies/[companyId]/* abas, analytics, settings = placeholder)
apps/web/src/app/dashboard/ (inbox, contacts, analytics, knowledge-base, team, settings)
apps/web/src/components/ (ai/, team/, analytics/, sidebar-nav, app-shell)  lib/(api-server, api-client, format)
packages/database/prisma/ schema.prisma + migrations/ (7)  src/seed.ts  src/enum-parity.ts
packages/shared/src/ schemas.ts types.ts enums.ts analytics.ts ai-rules.ts team-rules.ts conversation-rules.ts
```

## 7. Comandos
```bash
pnpm install && cp .env.example .env && docker compose up -d
pnpm db:deploy && pnpm db:seed           # logins de dev fictícios: ver README
pnpm dev:api                             # :4000/api
pnpm dev:web                             # :3000
pnpm whatsapp:mock-graph                 # Meta simulada :4010
pnpm ai:mock-anthropic                   # Anthropic simulada :4020 (NÃO é o Claude)
pnpm whatsapp:simulate --from 5511988887777 --text "Olá"
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```
- Na nuvem do Claude Code: `ANTHROPIC_BASE_URL=http://localhost:4020 pnpm dev:api` (variáveis do sistema vencem o `.env`).
- Não commitar `apps/web/AGENTS.md`/`CLAUDE.md` (gerados pelo `next dev`).

## 8. Testes e limitações
- **286 testes passando** (17 arquivos), e2e contra PostgreSQL real (`TEST_DATABASE_URL` termina em `_test`), Meta e
  Anthropic substituídas por servidores falsos; inclui corridas de concorrência. Workers drenados com `drain()`.
- **Não validados com APIs reais:** Meta e Claude; qualidade e custo reais da IA desconhecidos.
- Limitações: rate limits (login e exportação) em memória; Inbox por polling e 50 conversas; mídia só como aviso e envio
  só de texto; sem templates (nada fora da janela de 24h); um usuário por empresa; disponibilidade manual; sem edição
  de empresa/usuário pelo painel; fuso da empresa (`Company.timezone`) sem UI; custo só em USD e estimado; dados
  anteriores à F6 só com o ciclo atual (fora das médias); 1º ciclo do encerramento da IA fecha o acúmulo antigo
  (horário real).

## 9. Próxima etapa
**Fase 7 — Configurações e Administração da Plataforma: NÃO iniciada.** Placeholder atual: admin → Configurações
(`apps/web/src/app/admin/settings/page.tsx`). Aguardar o prompt da Fase 7 (com as decisões detalhadas) antes de implementar.
