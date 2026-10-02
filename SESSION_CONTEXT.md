# SESSION_CONTEXT — Arthur AI (passagem de contexto)

## 1. Objetivo e tecnologias
SaaS B2B **gerenciado** de atendimento pelo WhatsApp com IA, para PMEs brasileiras (tudo em pt-BR). O SUPERADMIN
cadastra empresas; cada empresa só acessa o próprio ambiente.
Monorepo pnpm · NestJS 12 (ESM-only) · Next.js 16 (App Router, `proxy.ts`) · PostgreSQL 16 + Prisma **7.10.0 fixo** ·
Zod compartilhado · WhatsApp Cloud API oficial (Graph v25.0) · Claude `claude-sonnet-5-5` via `@anthropic-ai/sdk` ·
Vitest · TypeScript 6.0 · ESLint 9. Não atualizar versões sem motivo.

## 2. Branch e GitHub
- Repositório `ArthurBortolussi/saas-automacao-de-ia-whatsapp`, branch **`claude/new-session-fucivv`** (única autorizada; não mexer na `main`).
- Fases 1–5 publicadas e sincronizadas; último commit de funcionalidade `bffb6bc`.
- Ambiente do desenvolvedor: Windows + PowerShell (usar `pnpm.cmd` nas instruções).

## 3. Fases concluídas
- **F1 Fundação:** login com sessão no banco (cookie httpOnly, argon2id), troca obrigatória de senha, Origin check,
  rate limit de login, AuditLog, painel `/admin` e área `/dashboard`.
- **F2 Contatos e Inbox:** CRUD de contatos; Inbox 3 colunas (polling 5 s); modos `AI | HUMAN | PAUSED`.
- **F3 WhatsApp:** um número por empresa, token AES-256-GCM, webhook assinado, fila de eventos no PG, outbox com
  retentativas, status monotônicos, janela de 24h. Simuladores locais.
- **F4 IA:** respostas automáticas com Sonnet, base de conhecimento por empresa, config da IA por empresa (horário,
  tom, transferência), agrupamento de mensagens, transferência para humano, aba Uso (tokens/custo estimado).
- **F5 Equipe:** aba Equipe (cadastro com senha provisória, perfis, limites, ativação), disponibilidade manual,
  distribuição automática, fila com aviso único, transferências, encerramento manual/inatividade, reabertura.

## 4. Estrutura e arquivos-chave
```
apps/api/src/  auth/ common/(guards, decorators) companies/ contacts/ conversations/ whatsapp/ ai/ team/ config/
apps/api/test/ e2e + helpers (helpers.ts, whatsapp-helpers.ts, ai-helpers.ts, team-helpers.ts)
apps/api/scripts/ simuladores (whatsapp-mock-graph, whatsapp-simulate-inbound, ai-mock-anthropic)
apps/web/src/  app/admin/companies/[companyId]/*, app/dashboard/*, components/(ai, team), lib/(api-server, api-client, format)
packages/database/prisma/ schema.prisma + migrations/ (5 migrations) · src/seed.ts · src/enum-parity.ts
packages/shared/src/ schemas.ts, types.ts, enums.ts, ai-rules.ts, team-rules.ts, conversation-rules.ts
```
- Tenant: `common/guards/company-access.guard.ts`, decorators `@CurrentCompany/@CurrentMembership/@CompanyRoles`.
- WhatsApp: `whatsapp/webhook-processor.service.ts` (recebe, reabre/enfileira), `whatsapp-outbound.service.ts` (único envio).
- IA: `ai/ai-worker.service.ts`, `ai-reply.service.ts`, `prompt.ts`, `pricing.ts`, `ai-model.client.ts` (único uso do SDK).
- Equipe: `team/distribution.service.ts`, `team-lock.ts`, `team-worker.service.ts`, `conversation-state.ts`, `team.service.ts`.
- Conversas: `conversations/conversations.service.ts` (modo, fechar, transferir, filtros).
- Consumo: tabela `AiRun`; histórico de responsáveis: `ConversationAssignment`.

## 5. Regras críticas
**Segurança e isolamento**
- Autorização só no backend. Toda rota de empresa: `/companies/:companyId/...` + `CompanyAccessGuard` (alheia → 403).
- Services filtram por `company.id` do guard; busca por ID com chave composta `id_companyId` (ID alheio → 404).
- FKs compostas `(id, companyId)` entre Contact/Conversation/Message/IA; responsável da conversa → FK composta para
  `CompanyMember(companyId, userId)`.
- Zod `strictObject` em body/query/params (campo desconhecido → 400). Sem class-validator.
- Segredos (token Meta, `ANTHROPIC_API_KEY`) nunca em respostas, logs, auditoria ou front. Nunca commitar `.env`.
- Produção recusa: cookie inseguro, APIs simuladas, valores fictícios do `.env.example`.
- Conteúdo de cliente e da base é **dado, não instrução**; o prompt só leva dados da empresa da conversa.

**Modelo de conversa (não misturar)**
- `mode` AI/HUMAN/PAUSED = quem responde · `status` OPEN/QUEUED/ASSIGNED/CLOSED = andamento ·
  `CompanyMember.availability` AVAILABLE/BUSY/AWAY. CHECKs no banco impedem combinações inválidas.

**Integração WhatsApp ↔ IA ↔ equipe**
- Toda saída passa por `WhatsAppOutboundService.send` (janela de 24h, modo conferido na transação; hook `inTransaction`).
- Mensagem recebida: grava mensagem + `AiReplyTask` (se modo AI) na mesma transação; trava a linha (FOR UPDATE);
  conversa CLOSED reabre a mesma conversa no modo padrão da empresa (AI → IA; HUMAN → fila).
- IA: tarefa só fica DONE na transação que grava a resposta; troca de modo cancela tarefas; transferência da IA põe
  na fila na mesma transação e emite `emitHumanQueued`.
- Equipe: **toda** mudança de atribuição usa `lockCompanyTeam` (advisory lock por empresa). Distribuição: menos
  atendimentos, empate por rotação (`lastAssignedAt`); só AVAILABLE, ativo, `canAttend`, com vaga.
- Workers (whatsapp, ai, team) rodam dentro da API, com fila no PostgreSQL; eventos em memória só antecipam ciclos.
- Migrations sempre **aditivas** (gerar com `prisma migrate diff ... --script`; CHECKs à mão); enums espelhados no shared.

## 6. Comandos
```bash
pnpm install && cp .env.example .env && docker compose up -d
pnpm db:deploy && pnpm db:seed
pnpm dev:api            # :4000/api
pnpm dev:web            # :3000
pnpm whatsapp:mock-graph   # Meta simulada :4010
pnpm ai:mock-anthropic     # Anthropic simulada :4020 (NÃO é o Claude)
pnpm whatsapp:simulate --from 5511988887777 --text "Olá"
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```
- Logins de dev (fictícios, criados pelo seed): ver README.
- Armadilha: variáveis do sistema vencem o `.env`; na nuvem do Claude Code rode
  `ANTHROPIC_BASE_URL=http://localhost:4020 pnpm dev:api`. Não commitar `apps/web/AGENTS.md`/`CLAUDE.md` (gerados pelo `next dev`).

## 7. Testes e limitações
- **249 testes passando** (15 arquivos), e2e contra PostgreSQL real (`TEST_DATABASE_URL` termina em `_test`), Meta e
  Anthropic substituídas por servidores falsos; inclui corridas de concorrência. Workers drenados com `drain()`.
- **Não validados com APIs reais:** Meta e Claude (só simuladores). Qualidade e custo reais da IA desconhecidos.
- Limitações: rate limit em memória; Inbox por polling e 50 conversas; mídia só como aviso e envio só de texto; sem
  templates (nada fora da janela de 24h); cada usuário pertence a uma só empresa; disponibilidade manual; funcionário não puxa da fila;
  base só texto e seleção por palavras; sem limite de gasto (decisão do proprietário); custo é estimativa.

## 8. Próxima etapa
**Fase 6 — Analytics e Relatórios: NÃO iniciada.** Placeholder atual: `/dashboard/analytics` (e admin → Configurações).
Dados já disponíveis para ela: `Message`, `Conversation` (status, timestamps de fila/atribuição/encerramento),
`ConversationAssignment`, `AiRun` (consumo), `AuditLog`. Aguardar o prompt da Fase 6 antes de implementar.
