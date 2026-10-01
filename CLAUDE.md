# CLAUDE.md — Arthur AI

Guia para sessões do Claude Code neste repositório. O README é a documentação de uso; este arquivo resume o
estado do projeto, as regras que não podem ser quebradas e o plano da próxima fase. **Mantenha os dois coerentes.**

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

**Placeholders** (telas existem, sem lógica): admin → empresa → IA, Base de conhecimento, Uso; admin →
Configurações; dashboard → Analytics, Base de conhecimento, Equipe, Configurações.

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

pnpm lint && pnpm typecheck && pnpm build && pnpm test     # validação completa
```

No Windows (ambiente do desenvolvedor): `pnpm.cmd` no lugar de `pnpm`, no PowerShell.
Testes: **e2e contra PostgreSQL real** (`TEST_DATABASE_URL`, o nome precisa terminar em `_test` e é truncado),
pelo HTTP com cookie real; a Meta é substituída por um servidor HTTP falso (`test/whatsapp-helpers.ts`).
Estado atual: 9 arquivos, 148 testes passando. Testes que disparam o worker devem chamar `worker.drain()`
antes de limpar o banco (o webhook processa em segundo plano).

## WhatsApp: simulação × integração real

| | Situação |
|---|---|
| Graph API simulada (`WHATSAPP_GRAPH_API_BASE_URL=http://localhost:4010`) | Fluxo completo validado no navegador: receber, responder, status até "lida", falhas |
| Meta real (`https://graph.facebook.com`, Graph API `v25.0`) | **Não validada.** Nenhuma chamada real foi feita (domínios da Meta bloqueados no ambiente de desenvolvimento) |

Para conectar um número real: app na Meta com WhatsApp, WABA com número registrado, token permanente de
System User, App Secret, endpoint **HTTPS público** para o webhook (túnel em dev). Passo a passo no README.
Não declarar a integração real como funcionando antes de testá-la com um número de verdade.

## Limitações conhecidas

As principais (lista completa no README): rate limit em memória; Inbox por polling e limitada às 50 conversas
mais recentes; mídia recebida só como aviso e envio só de texto; sem gerenciador de modelos (templates), logo nada é
enviado fora da janela de 24h; "Nova conversa" pelo painel é interna; possível envio duplicado se a API cair entre
o aceite da Meta e a gravação do wamid; sem edição de empresa/usuário pelo painel; conversas novas do WhatsApp nascem
em modo `AI`, mas **nada responde automaticamente até a Fase 4**.

## Próximos passos (fora da Fase 4, quando o cliente pedir)

Validar o WhatsApp com número real; gerenciador de modelos aprovados; mídia; edição/pausa de empresas e usuários;
tempo real (websocket) se o polling pesar; rate limit compartilhado se houver mais de uma instância da API.

## Fase 4 — planejamento (NÃO implementado)

Objetivo: a IA responde automaticamente conversas em modo `AI`, usando a base de conhecimento da própria empresa,
e passa para um humano quando não souber ou quando o cliente pedir.

**Pontos de integração que já existem (usar, não recriar):**
- `ConversationEvents.onInboundMessage()` (`apps/api/src/whatsapp/conversation-events.ts`): emitido após o commit de
  cada mensagem recebida, com `companyId`, `conversationId`, `messageId`. Hoje sem assinantes.
- `aiMayReply(mode)` em `@arthur-ai/shared`: só `AI` permite resposta automática. Conferir **de novo imediatamente
  antes de enviar** (o humano pode ter assumido durante a geração).
- `WhatsAppOutboundService.send(company, conversationId, body, { type: "AI" })`: mesmo envio dos humanos; já recusa
  remetente IA fora do modo `AI` e respeita a janela de 24h.

**Desenho proposto (a confirmar com o desenvolvedor antes de codar):**
1. **Dados** (migration aditiva, tudo com `companyId` e acesso pelo `CompanyAccessGuard`):
   `KnowledgeEntry` (título, conteúdo, ativo/inativo, ordem; documentos/FAQs da empresa) e `AiSettings` por empresa
   (ligado/desligado, nome e tom do assistente, instruções da empresa, horário, mensagem de passagem para humano).
   Registro de cada execução da IA (modelo, tokens de entrada/saída/cache, custo estimado, resultado) para a aba **Uso**.
2. **Telas:** aba "Base de conhecimento" e "IA" do admin e da empresa (substituem os placeholders), com
   permissão de edição a definir (OWNER/ADMIN vs. AGENT).
3. **Serviço de IA** (`apps/api/src/ai/`): assina o evento, carrega histórico recente da conversa (só da empresa),
   chama o Claude e envia pelo `WhatsAppOutboundService`. Processamento assíncrono na mesma fila persistente
   (não chamar o modelo dentro do webhook). Uma resposta por mensagem recebida: idempotência por `messageId`;
   várias mensagens seguidas do cliente devem ser agrupadas em uma resposta (pequena espera antes de gerar).
4. **Passagem para humano:** ferramenta (tool use) `transferir_para_humano`, que muda o modo para `HUMAN` (ou
   `PAUSED`) e avisa o cliente. Também por regra: pedido explícito, IA sem resposta na base, recusa do modelo.

**Claude API (verificado em 2026-10):**
- SDK oficial `@anthropic-ai/sdk`; chave em `ANTHROPIC_API_KEY` (variável de ambiente, nunca no banco ou no front).
- Modelo configurável por env (ex.: `ANTHROPIC_MODEL`), padrão **`claude-opus-5-5`**. Alternativa mais barata:
  `claude-sonnet-5-5`. A escolha por custo é **decisão do desenvolvedor**, não do código.
- No `claude-opus-5-5`: o raciocínio não pode ser desligado (controle por `output_config.effort`; padrão `medium`,
  testar `low` para chat); `tool_choice` forçado (`any`/`tool`) retorna 400, então use `auto` + instrução no prompt,
  e `strict: true` nas ferramentas; prefill de resposta não existe.
- **Prompt caching:** prefixo estável primeiro (instruções fixas + base de conhecimento da empresa no `system` com
  `cache_control`), histórico e mensagem nova depois. Nada variável (data/hora, IDs) dentro do prefixo cacheado.
  Conferir `usage.cache_read_input_tokens`.
- Tratar `stop_reason` (`refusal` → passar para humano; `max_tokens` → não enviar resposta truncada) e erros pelas
  classes tipadas do SDK (`RateLimitError`, `APIError`...). Avaliar o `fallbacks` do servidor para recusas.
- **Segurança:** mensagens do cliente e conteúdo da base são **dados, não instruções** (prompt injection); o prompt
  nunca contém tokens, IDs internos de outras empresas nem dados de outros clientes; a base consultada é só a da
  empresa da conversa; limitar tamanho do histórico e da resposta (WhatsApp ≤ 4096 caracteres, nosso limite 4000).

**Base de conhecimento — decisão em aberto:** começar simples (entradas de texto da empresa inteiras no prompt
cacheado, enquanto couberem) e só adotar busca (full-text do PostgreSQL ou embeddings/pgvector) quando o volume
exigir. Upload de PDF/arquivos é uma etapa separada.

**Decisões a pedir ao desenvolvedor antes de implementar:** modelo/custo; modo padrão de conversas novas;
quem edita a base (perfis); horário de atendimento da IA; texto da passagem para humano; limites de gasto por empresa.
