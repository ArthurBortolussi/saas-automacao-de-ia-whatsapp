# Arthur AI

Plataforma B2B **gerenciada** de atendimento automatizado pelo WhatsApp, com IA (Claude, da Anthropic).
Não é self-service: o **SUPERADMIN** cadastra empresas e usuários; cada empresa acessa apenas o próprio ambiente.

> **Estado atual: FASE 4** — fundação multi-tenant (Fase 1), contatos/conversas/Inbox (Fase 2), **WhatsApp Cloud API
> oficial da Meta** (Fase 3) e **atendimento automático com IA + base de conhecimento** (Fase 4).
>
> ⚠️ Tudo foi testado **apenas com simuladores**: Graph API simulada (Meta) e API da Anthropic simulada. Nem a Meta
> real nem o Claude real foram chamados até agora. Veja "Tipos de teste" abaixo antes de colocar em produção.
>
> Contexto para sessões do Claude Code (regras de segurança, convenções e estado do projeto): veja [`CLAUDE.md`](CLAUDE.md).

---

## Arquitetura

```
arthur-ai/
  apps/
    web/        Next.js 16 (App Router) + Tailwind v4 + shadcn/ui
    api/        NestJS 12 (ESM) — única camada que acessa o banco
  packages/
    database/   Prisma 7 (schema, migrations, client, seed, hash de senha)
    shared/     Schemas Zod (fonte única de validação web + api) e tipos de resposta
    ui/         Componentes shadcn/ui + tokens de tema
  docker-compose.yml   PostgreSQL 16 para desenvolvimento
```

```
Navegador ──► Next.js (:3000) ──rewrite /api/*──► NestJS (:4000) ──► PostgreSQL
                 │                                    ▲
                 └── Server Components (GET + cookie) ┘
```

- O navegador só conversa com o Next. `/api/*` é repassado para a API por rewrite, então o cookie de sessão é **first-party**.
- Server Components chamam a API diretamente (servidor→servidor), repassando só o cookie de sessão.
- **Toda autorização acontece na API.** O `proxy.ts` e os layouts do Next só redirecionam (UX).

### Autenticação

- Sessão **no banco** (`Session`). O cookie `httpOnly` + `SameSite=Lax` (+ `Secure` e prefixo `__Host-` quando `SESSION_COOKIE_SECURE=true`) carrega um token aleatório de 256 bits; o banco guarda **só o SHA-256** do token.
- A cada request a API confere: sessão existe, não expirou, usuário `ACTIVE`. Logout e desativação têm efeito imediato.
- Senhas com **argon2id** (m=19 MiB, t=2, p=1 — mínimo OWASP). Política: 10 a 128 caracteres.
- Login com erro genérico (“Credenciais inválidas.”) e verificação argon2 também para e-mail inexistente (tempo de resposta semelhante).
- **Rate limit** de login por IP e por e-mail (em memória — ver limitações).
- **CSRF**: além de `SameSite=Lax`, toda requisição mutável precisa ter `Origin` igual a `WEB_ORIGIN` (inclusive o login).
- Usuários criados pelo SUPERADMIN nascem com `mustChangePassword = true`: a API bloqueia tudo exceto `me`, `logout` e `change-password`; ao trocar, as outras sessões são revogadas.

### Autorização e multi-tenancy

Guards globais, em ordem: `OriginGuard` → `SessionGuard` (401) → `PasswordChangeGuard` (403).
Guards de rota: `SuperadminGuard` (rotas `/admin/*`) e `CompanyAccessGuard` (toda rota com `:companyId`).

O `CompanyAccessGuard` é a **resolução central de tenant**:

1. Lê o `companyId` da URL — que **nunca** é prova de acesso por si só.
2. SUPERADMIN: carrega a empresa (404 se não existir) e passa, sem precisar de vínculo.
3. Demais usuários: busca `CompanyMember(userId, companyId)` no banco. Sem vínculo → **403** (empresa alheia e inexistente respondem igual, para não vazar existência).
4. Empresa `PAUSED`/`INACTIVE` → **403** “Acesso suspenso. Contate o suporte.” (SUPERADMIN não é afetado).
5. Coloca `company` e `membership` no request; controllers leem via `@CurrentCompany()`/`@CurrentMembership()`, e os services recebem a empresa já validada.

Nesta fase um usuário pertence a no máximo uma empresa (`CompanyMember.userId` único), mas o guard usa sempre o par `(userId, companyId)`: remover essa unicidade no futuro é só uma migration.

---

### Contatos e conversas (Fase 2)

- `Contact`, `Conversation` e `Message` têm `companyId` e são acessados só por rotas `/companies/:companyId/...` atrás do `CompanyAccessGuard`.
- Os services buscam sempre pela chave composta `(id, companyId)`: um ID de outra empresa simplesmente não existe (404).
- **Integridade no banco**: `Conversation → Contact` e `Message → Conversation` usam FK composta `(id, companyId)`. O PostgreSQL recusa ligar uma conversa da empresa A a um contato da empresa B, mesmo que o código erre.
- Telefone salvo só com dígitos e DDI (`5511999990000`). Único por empresa (`@@unique([companyId, phone])`); empresas diferentes podem ter o mesmo telefone.
- **Modo de atendimento** (`AI` | `HUMAN` | `PAUSED`):

| Ação | De | Para |
|---|---|---|
| Assumir atendimento | AI, PAUSED | HUMAN (responsável = quem assumiu) |
| Devolver para IA | HUMAN, PAUSED | AI (sem responsável) |
| Pausar | AI, HUMAN | PAUSED (lembra o modo anterior) |
| Reativar | PAUSED | modo anterior à pausa |

- Humanos só enviam mensagem em `HUMAN` (evita IA e humano respondendo juntos). A futura integração com IA **deve** chamar `aiMayReply(mode)` de `@arthur-ai/shared` antes de responder: só `AI` permite.
- Trocas de modo usam concorrência otimista: duas pessoas clicando ao mesmo tempo → uma vence, a outra recebe 409.

### WhatsApp (Fase 3)

Usa **somente** a WhatsApp Business Platform — Cloud API oficial (Graph API). Nada de WhatsApp Web, QR Code ou bibliotecas não oficiais.

```
Cliente no WhatsApp ──► Meta ──POST assinado──► /api/webhooks/whatsapp ──► fila (PostgreSQL) ──► worker
                                                     │ valida X-Hub-Signature-256            │ roteia por phone_number_id
                                                     │ grava e responde 200 na hora          │ contato → conversa → mensagem
Inbox (funcionário) ──► API ──► Message PENDING ──► Graph API /{phone_number_id}/messages ──► SENT (wamid)
                                                                     status por webhook ──► DELIVERED → READ / FAILED
```

- **Uma conta por empresa** (`WhatsAppAccount`): WABA ID, Phone Number ID (**único na plataforma**, é por ele que o webhook chega à empresa certa), número, nome, status e token.
- **Token da Meta cifrado** em repouso com AES-256-GCM (`WHATSAPP_TOKEN_ENCRYPTION_KEY`). O `companyId` entra como dado autenticado: o token cifrado de uma empresa não decifra em outra. O token **nunca** volta pela API, não vai para o navegador, para a auditoria nem para os logs.
- **Webhook**: valida a assinatura sobre o corpo **bruto** com o App Secret, grava o evento na fila (`WhatsAppWebhookEvent`) e responde 200 imediatamente. Reenvios idênticos da Meta são descartados pelo hash do corpo.
- **Fila persistente sem infraestrutura nova**: o próprio PostgreSQL (`FOR UPDATE SKIP LOCKED`), processado por um worker dentro da API a cada `WHATSAPP_WORKER_INTERVAL_MS`. Se a API cair, os eventos pendentes são retomados. Funciona com mais de uma instância.
- **Sem duplicatas**: `@@unique([companyId, externalId])` nas mensagens (wamid).
- **Status monotônicos**: `delivered` depois de `read` não volta a mensagem para trás; `failed` não desfaz uma mensagem lida.
- **Envio (outbox)**: a mensagem nasce `PENDING` e só vira `SENT` com o wamid devolvido pela Meta. Erros de token, janela de 24h e destinatário → `FAILED` com motivo em português. Limite de taxa, 5xx e rede → nova tentativa com backoff (até 5).
- **Janela de 24h**: mensagem livre só até 24h após a última mensagem do cliente. Fora dela o envio é recusado antes de chamar a Meta. O cliente HTTP já aceita conteúdo do tipo `template` para o envio futuro de modelos aprovados.
- **Modos**: humanos só enviam em `HUMAN`; a IA só em `AI`. Mensagens recebidas nunca mudam o modo (só a passagem automática da IA para humano, Fase 4). Conversas novas do WhatsApp nascem no modo padrão da empresa (configurável; padrão `AI`).
- **"Nova conversa" pelo painel continua interna**: iniciar uma conversa no WhatsApp exige um modelo aprovado pela Meta, e o gerenciador de modelos fica para uma fase futura.
- **Inbox**: atualiza sozinha a cada 5 s (polling, só com a aba visível).

### Inteligência artificial (Fase 4)

O assistente responde sozinho as conversas do WhatsApp em modo `AI`, usando só a base de conhecimento da empresa, e
passa para a equipe quando não deve ou não consegue responder. Provedor: **API oficial da Anthropic** pelo SDK
`@anthropic-ai/sdk`, modelo **`claude-sonnet-5-5`** (Claude Sonnet 5.5; configurável por `AI_MODEL`).

```
Webhook da Meta ─► fila do WhatsApp ─► grava Message + AiReplyTask NA MESMA TRANSAÇÃO (só se a conversa está em AI)
                                                          │
            worker da IA (PostgreSQL, a cada AI_WORKER_INTERVAL_MS) ◄─┘
              1. espera o cliente parar de escrever (agrupamento) e reserva a conversa
              2. checagens sem custo: modo AI? empresa ativa? IA ligada? chave? horário? janela 24h? WhatsApp ok?
              3. contexto: regras fixas + empresa + base ATIVA da empresa + histórico recente desta conversa
              4. Claude Sonnet (prompt caching) ─► resposta | transferir_para_humano | recusa | erro
              5. envio pelo WhatsAppOutboundService da Fase 3; a tarefa vira DONE na MESMA transação da mensagem
              6. AiRun: tokens (inclusive cache), custo estimado, resultado
```

**Confiabilidade**
- **Nada se perde numa queda**: a tarefa é gravada junto com a mensagem recebida (não depende do evento em memória,
  que só antecipa o ciclo). Lotes interrompidos têm a reserva vencida e são retomados por qualquer instância.
- **Sem resposta duplicada**: uma tarefa por mensagem (`messageId` único); a reserva trava a linha da conversa
  (`FOR UPDATE SKIP LOCKED`) e recusa conversas com lote em andamento; a tarefa só fica `DONE` na transação que grava a
  mensagem enviada. Se a tarefa não estiver mais `RUNNING`, a transação é desfeita e nada é enviado.
- **Humano assumiu**: qualquer troca de modo cancela as tarefas pendentes e em andamento da conversa. Uma resposta que
  estava sendo gerada é descartada (registrada como `DISCARDED`), mesmo que a conversa já tenha voltado para a IA.
  Devolver para a IA não responde mensagens antigas: só as que chegarem depois.
- **Retentativas limitadas**: erros temporários (429, 5xx/529, rede, timeout) → até 3 tentativas com espera crescente
  (o SDK faz mais 1 retentativa rápida em cada). Erros definitivos (chave inválida 401, 403, sem créditos 402, requisição
  inválida) não são repetidos. Esgotou ou é definitivo → passa para humano.
- **Proteção contra loop**: no máximo `AI_MAX_RUNS_PER_CONVERSATION_PER_HOUR` execuções por conversa por hora (ex.: um robô
  respondendo a IA). Acima disso, passa para humano.

**Agrupamento de mensagens** ("Olá." / "Queria saber o preço." / "Do clareamento."): a conversa só é processada quando
o cliente fica `AI_BATCH_DELAY_MS` (padrão 8 s) sem escrever, ou quando a primeira mensagem pendente passa de
`AI_BATCH_MAX_WAIT_MS` (padrão 30 s). Todas as tarefas pendentes da conversa entram no mesmo lote (`runId`) e geram
**uma** resposta. O agrupamento é por conversa, e cada conversa pertence a uma empresa: nada é misturado. Mensagens que
chegam durante a geração ficam para o lote seguinte.

**Quando a IA não responde** (sem chamar o modelo): conversa em `HUMAN`/`PAUSED` (nem cria tarefa), IA desligada,
chave ausente, fora do horário da IA, janela de 24h fechada, WhatsApp desligado/com erro, empresa pausada/inativa,
mensagem que não pede resposta (reação, figurinha). Áudio, imagem, documento e localização → passa para humano, porque
a IA não interpreta esses conteúdos.

**Transferência para humano**: o modelo usa a ferramenta `transferir_para_humano` quando o cliente pede uma pessoa ou
quando falta informação na base. Também transferem: recusa do modelo, resposta incompleta (`max_tokens`) ou
inadequada (vazia, longa demais, com trechos do prompt interno), erro do serviço, conteúdo não suportado e o limite
anti-loop. Na mesma transação: a mensagem de transferência (personalizada pela empresa ou a padrão) é gravada, a
conversa vai para `HUMAN` com motivo e horário (`aiHandoffReason`/`aiHandoffAt`, visíveis na Inbox) e a auditoria
registra `conversation.ai_handoff`. Se o WhatsApp não permitir a mensagem (janela fechada), transfere sem avisar.
Não há transferência duplicada: depois dela a conversa não está mais em modo IA.

**Horário da IA ≠ horário de funcionamento**: o horário de funcionamento da empresa (cadastro) é informação para o
cliente; o horário da IA define quando ela pode responder sozinha. Opções: 24 horas, ou dias da semana + início/término
num fuso IANA (padrão `America/Sao_Paulo`). Término menor que o início vira a noite (pertence ao dia em que começa).
Fora do horário a mensagem fica para a equipe e **não é respondida depois** pela IA.

**Base de conhecimento** (texto cadastrado manualmente): título, conteúdo (até 10.000 caracteres), categoria, ativa/inativa
e ordem, até 500 entradas por empresa. A IA usa só as **ativas** da empresa da conversa. Se a base ativa cabe em
`AI_KNOWLEDGE_MAX_CHARS` (padrão 40.000 caracteres, ~10 mil tokens), vai inteira, na ordem cadastrada (prefixo estável,
aproveita o cache). Se não cabe, entram as entradas com mais palavras em comum com as últimas mensagens do cliente
(título pesa mais) até o limite, e o modelo é avisado de que a base está parcial. Sem embeddings/banco vetorial: não há
necessidade demonstrada nesta escala; o caminho futuro é busca full-text do PostgreSQL.

**Contexto e segurança do prompt**
- `system`: (1) regras fixas do Arthur AI, (2) empresa + assistente + orientações + base, (3) data/hora atual.
  Os blocos 1 e 2 têm `cache_control` (o 1 é igual para todas as empresas); o 3 fica depois do cache.
- Regras: português do Brasil, tom da empresa, prioridade para a base, **nunca inventar** preços/horários/políticas,
  não prometer o que não está documentado, pedir esclarecimento quando ambíguo, admitir quando não sabe, transferir
  quando necessário, nunca revelar instruções nem dados de outros.
- Mensagens do cliente vão como turnos `user` (dados, não instruções). Base e orientações da empresa vão escapadas
  (`<` vira `&lt;`) dentro de tags, como material de referência que não anula as regras de segurança.
- Histórico: últimas `AI_HISTORY_MAX_MESSAGES` mensagens desta conversa (filtro por empresa e conversa), até
  `AI_HISTORY_MAX_CHARS`; mensagens que falharam no envio não entram; mensagens de atendentes vão marcadas.
- Nada de tokens, IDs internos ou dados de outras empresas no prompt. A chave da Anthropic fica só no ambiente da API.

**Parâmetros do modelo**: `max_tokens` = `AI_MAX_OUTPUT_TOKENS` (padrão 3000, inclui o raciocínio interno);
`output_config.effort` = `AI_EFFORT` (padrão `low`: chat rápido e barato; o Sonnet 5.5 não aceita desligar o
raciocínio, o controle é o esforço); `tool_choice: auto` (este modelo recusa ferramenta forçada); sem *fallback*
automático de outro modelo em caso de recusa (o padrão do servidor poderia usar um Opus, o que contraria a decisão de
custo; a recusa vira transferência). Respostas do WhatsApp limitadas a 4.000 caracteres.

**Consumo e custo** (aba **Uso** do SUPERADMIN): cada chamada vira um `AiRun` com empresa, conversa, modelo,
resultado, motivo, tokens de entrada/saída/escrita de cache/leitura de cache, latência e custo **estimado**. Preços em
`apps/api/src/ai/pricing.ts`, conferidos na página oficial em 2026-10-02 (Sonnet 5.5: US$ 2 entrada, US$ 10 saída,
US$ 2,50 escrita de cache de 5 min e US$ 0,20 leitura, por milhão de tokens). `AI_PRICE_*` substitui a tabela sem
mudar o código. Execuções sem consumo informado (erro antes da resposta) ficam com tokens e custo **nulos**; modelo sem
preço fica com custo nulo e é contado à parte. Não há limite de gasto (decisão do proprietário nesta fase).

**Permissões**
| | SUPERADMIN | OWNER / ADMIN | AGENT |
|---|---|---|---|
| Ligar/desligar a IA, modo inicial das novas conversas | ✔ (aba IA do admin) | — | — |
| Nome, tom, orientações, mensagem de transferência, horário e fuso | ✔ | ✔ (Configurações) | vê |
| Base de conhecimento: criar, editar, ativar/desativar, excluir | ✔ (qualquer empresa) | ✔ (só a própria) | vê só as ativas |
| Aba Uso (consumo e custo) | ✔ | — | — |

Tudo conferido no backend: a rota da empresa recusa os campos técnicos (400) e as edições exigem OWNER/ADMIN (403).
IDs de outra empresa respondem 404; rotas de outra empresa, 403.

## Pré-requisitos

- Node.js **22.12+** (o NestJS 12 é ESM-only e depende de `require(esm)`)
- pnpm **10+** (`corepack enable`)
- Docker (para o PostgreSQL) **ou** um PostgreSQL 16 local

## Instalação

```bash
pnpm install
cp .env.example .env
docker compose up -d          # PostgreSQL + banco de teste (arthur_ai_test)
pnpm db:deploy                # aplica as migrations
pnpm db:seed                  # dados de DESENVOLVIMENTO (opcional)
```

Sem Docker: crie o usuário `arthur` e os bancos `arthur_ai` e `arthur_ai_test` no seu PostgreSQL e ajuste as URLs no `.env`.

## Variáveis de ambiente

Um único `.env` na raiz, lido pela API, pelo Prisma e pelo Next. Tudo é validado no boot: se faltar algo, o processo não sobe.

| Variável | Uso |
|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `DATABASE_URL` | PostgreSQL da aplicação |
| `TEST_DATABASE_URL` | PostgreSQL dos testes e2e — **é truncado**; o nome do banco precisa terminar em `_test` |
| `API_PORT` | Porta da API (padrão 4000) |
| `WEB_ORIGIN` | Origem pública do web; requisições mutáveis com outro `Origin` recebem 403 |
| `SESSION_TTL_HOURS` | Duração da sessão (padrão 168 = 7 dias) |
| `SESSION_COOKIE_SECURE` | `true` em produção (obrigatório — a API recusa subir sem isso); `false` em dev http |
| `TRUST_PROXY` | De quais proxies aceitar `X-Forwarded-For` (ver abaixo) |
| `API_URL` | URL interna da API, usada pelo rewrite e pelos Server Components. Precisa existir **no build** do web (o rewrite é gravado no build) |
| `WHATSAPP_APP_SECRET` | App Secret do app na Meta. Valida a assinatura dos webhooks |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Texto que você define e informa à Meta no cadastro do webhook |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | 32 bytes em base64. Cifra os tokens das empresas. Se a chave for trocada, os tokens precisam ser cadastrados de novo |
| `WHATSAPP_GRAPH_API_VERSION` | Padrão `v25.0` |
| `WHATSAPP_GRAPH_API_BASE_URL` | Oficial: `https://graph.facebook.com`. Em dev pode apontar para o simulador; **produção só aceita a oficial** |
| `WHATSAPP_WORKER_INTERVAL_MS` | Intervalo do worker (padrão 5000; `0` desliga o timer) |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic. **Sem ela a IA fica "não configurada"** e o resto funciona. Nunca vai para o banco, o navegador ou os logs |
| `ANTHROPIC_BASE_URL` | Padrão: API oficial. Em dev pode apontar para o simulador (`http://localhost:4020`); **produção só aceita a oficial** |
| `AI_MODEL` | Padrão `claude-sonnet-5-5` |
| `AI_EFFORT` | `low` (padrão), `medium` ou `high` |
| `AI_MAX_OUTPUT_TOKENS` | Teto por resposta, incluindo o raciocínio (padrão 3000) |
| `AI_BATCH_DELAY_MS` / `AI_BATCH_MAX_WAIT_MS` | Agrupamento: espera após a última mensagem (8000) e teto de espera (30000) |
| `AI_HISTORY_MAX_MESSAGES` / `AI_HISTORY_MAX_CHARS` | Histórico enviado ao modelo (30 mensagens / 12.000 caracteres) |
| `AI_KNOWLEDGE_MAX_CHARS` | Tamanho máximo da base no prompt (40.000 caracteres) |
| `AI_MAX_RUNS_PER_CONVERSATION_PER_HOUR` | Proteção contra loop (20) |
| `AI_WORKER_INTERVAL_MS` | Intervalo do worker da IA (padrão 2000; `0` desliga o timer) |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK`, `AI_PRICE_CACHE_WRITE_PER_MTOK`, `AI_PRICE_CACHE_READ_PER_MTOK` | Preço do `AI_MODEL` em US$ por milhão de tokens (os quatro ou nenhum); sem eles vale a tabela interna |

As três primeiras ligam o WhatsApp: **todas ou nenhuma**. Sem nenhuma, a integração fica desligada e o resto do sistema funciona normalmente. Com só uma ou duas, a API não sobe (é quase sempre erro de configuração). Em produção, a API também se recusa a subir com os valores fictícios do `.env.example`.

**Variáveis já definidas no sistema têm precedência sobre o `.env`** (o `.env` não sobrescreve). Se o seu computador ou
servidor já tiver `ANTHROPIC_BASE_URL` ou `ANTHROPIC_API_KEY` definidas (algumas ferramentas definem), elas valem no
lugar das do `.env`. O log de boot da API mostra se a IA está configurada e, quando não é a API oficial, para onde ela
aponta; nunca mostra a chave.

Gerar valores reais (PowerShell ou bash):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # chave de criptografia
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # verify token
```

### `TRUST_PROXY` e o rate limit por IP (leia antes de publicar)

Verificado na prática: **o rewrite do Next.js não adiciona o IP do cliente ao `X-Forwarded-For`**; ele repassa o header que o cliente mandou. Então:

- **Sem proxy de borda** (nginx/Caddy/load balancer) na frente do Next → use `TRUST_PROXY=false`. A API vê todas as requisições com o IP do Next, e **o limite por IP vira um limite global** (um atacante pode bloquear o login de todos por 15 min). O limite por e-mail continua funcionando. Em produção a API avisa isso no log de boot.
- **Com proxy de borda** que reescreve/anexa `X-Forwarded-For` → use `TRUST_PROXY=1` (confia só no último hop).
- `TRUST_PROXY=true` é recusado: permitiria qualquer cliente forjar o próprio IP.
- A API **não** deve ficar exposta publicamente; só o Next (ou o proxy de borda) deve alcançá-la.

## Banco de dados

```bash
pnpm db:migrate     # desenvolvimento: cria/aplica migrations (prisma migrate dev)
pnpm db:deploy      # produção/CI: aplica migrations existentes (prisma migrate deploy)
pnpm db:status      # estado das migrations
```

Prisma **7.10.0** com versão fixa (a tag `latest` do CLI `prisma` no npm aponta para um release candidate da v8).
A configuração fica em `packages/database/prisma7.config.ts`, nome preferido pelo CLI 7.10 (`prisma.config.ts` é tratado como legado). O client é gerado em `packages/database/src/generated` (ignorado pelo git; gerado no build).

## Seed de desenvolvimento

```bash
pnpm db:seed
```

- Idempotente (upsert) e **recusa rodar com `NODE_ENV=production`**. Nunca roda automaticamente.
- Re-executar redefine as senhas abaixo.

| Perfil | E-mail | Senha (somente DEV) | Empresa |
|---|---|---|---|
| SUPERADMIN | `admin@arthurai.local` | `admin-dev-password-123` | — |
| OWNER | `owner@demo.local` | `demo-owner-dev-123` | Empresa Demo (DEV) — `ACTIVE` |
| OWNER | `owner@outra.local` | `outra-owner-dev-123` | Outra Empresa (DEV) — `ACTIVE` |

A segunda empresa existe para testar o isolamento manualmente: logado como `owner@demo.local`, tente `GET /api/companies/<id da Outra Empresa>` → 403.

Contatos e conversas fictícios (nomes terminam em "Exemplo", telefones `55 11 90000-01xx`):

| Empresa | Contatos | Conversas |
|---|---|---|
| Empresa Demo (DEV) | 5 (todos os status) | Mariana: IA, 2 não lidas · Carlos: humano · Fernanda: pausada, 1 não lida |
| Outra Empresa (DEV) | 2 (um com o **mesmo telefone** da Mariana) | 1 com a IA, 1 não lida |

O seed não recria conversas de contatos que já têm alguma; para voltar ao estado inicial, apague as tabelas `Message`, `Conversation` e `Contact` do banco de dev e rode `pnpm db:seed`.

IA (Fase 4): a Empresa Demo ganha a IA **ligada** (assistente "Sofia", tom amigável) e 6 informações fictícias na base
(horário, endereço, preços, convênios; 1 inativa). Só é criado o que não existe: configurações e bases que você já
alterou **não são sobrescritas**.

## Rodando

```bash
pnpm dev:api        # http://localhost:4000/api  (NestJS em watch)
pnpm dev:web        # http://localhost:3000      (Next.js)
```

- **SUPERADMIN**: entre em http://localhost:3000/login com `admin@arthurai.local` → `/admin`.
- **Usuário de empresa**: entre com `owner@demo.local` → `/dashboard`, `/dashboard/contacts`, `/dashboard/inbox`, `/dashboard/knowledge-base` e `/dashboard/settings` (IA).
- Usuário criado pelo painel: no primeiro login é levado a `/change-password`.

Produção: `pnpm build`, depois `node apps/api/dist/main.js` e `pnpm --filter @arthur-ai/web start`.

## Testar o WhatsApp localmente (SIMULADO)

Sem credenciais da Meta, dá para testar o fluxo inteiro com uma **Graph API simulada**. Ela nunca fala com a Meta, e o painel exibe o aviso "Graph API SIMULADA".

1. Copie o bloco `WHATSAPP_*` do `.env.example` para o seu `.env` (os valores fictícios já apontam para o simulador) e rode `pnpm db:seed`. A Empresa Demo ganha um número simulado (`phone_number_id 990000000000101`).
2. Em três terminais:
   ```
   pnpm whatsapp:mock-graph     # Graph API simulada em http://localhost:4010
   pnpm dev:api
   pnpm dev:web
   ```
3. Simule a mensagem de um cliente (num quarto terminal):
   ```
   pnpm whatsapp:simulate --from 5511988887777 --name "Cliente Teste" --text "Olá!"
   ```
4. Entre como `owner@demo.local` → **Inbox**. A conversa aparece em até 5 s. Clique em **Assumir atendimento** e responda: o status passa de ✓ (enviada) para ✓✓ (entregue) e para ✓✓ azul (lida).
5. Para simular falhas, escreva no texto da resposta: `#falha` (destinatário inválido), `#token` (token recusado, que deixa a conta "com erro") ou `#limite` (limite da Meta, com nova tentativa automática).

No Windows, use `pnpm.cmd` no lugar de `pnpm`.

## Testar a IA localmente (SIMULADO) — Windows / PowerShell

O simulador `pnpm ai:mock-anthropic` imita a API da Anthropic em `http://localhost:4020`. **Não é o Claude**: responde
por regras simples, procurando na base de conhecimento enviada no prompt. Serve para validar o fluxo (fila,
agrupamento, envio pelo WhatsApp, transferência, consumo) sem chave e sem custo.

### Tipos de teste

| Teste | Anthropic | Meta | Como | Situação |
|---|---|---|---|---|
| Automatizado (`pnpm test`) | servidor falso no próprio teste | servidor falso no próprio teste | — | ✅ 207 testes |
| Local simulado | `pnpm ai:mock-anthropic` | `pnpm whatsapp:mock-graph` | roteiro abaixo | ✅ validado (em Linux) |
| IA real + Meta simulada | `ANTHROPIC_API_KEY` real, sem `ANTHROPIC_BASE_URL` | simulada | "Usar o Claude de verdade" | ⚠️ não testado |
| Meta real | simulada ou real | número real + túnel HTTPS | "Conectar um número real" | ⚠️ não testado |

### Roteiro (PowerShell, na pasta do projeto)

1. Atualize o código e o banco (o Docker Desktop precisa estar aberto):
   ```powershell
   git pull
   pnpm.cmd install
   docker compose up -d
   pnpm.cmd db:deploy
   pnpm.cmd db:seed
   ```
2. No seu `.env`, acrescente o bloco **"Inteligência artificial"** do `.env.example` (os valores fictícios já apontam para
   o simulador). Confira se não há variáveis `ANTHROPIC_*` definidas no Windows: `Get-ChildItem Env:ANTHROPIC*`
   (se aparecer alguma, ela vence o `.env`; remova-a da sessão com `Remove-Item Env:ANTHROPIC_BASE_URL`).
3. Abra **quatro** janelas do PowerShell, uma para cada comando:
   ```powershell
   pnpm.cmd whatsapp:mock-graph      # Meta simulada (:4010)
   pnpm.cmd ai:mock-anthropic        # Anthropic simulada (:4020)
   pnpm.cmd dev:api                  # API (:4000) — o log deve dizer "IA: configurada (... API SIMULADA ...)"
   pnpm.cmd dev:web                  # painel (:3000)
   ```
4. Numa quinta janela, simule um cliente mandando três mensagens seguidas:
   ```powershell
   pnpm.cmd whatsapp:simulate --from 5511988887777 --text "Olá"
   pnpm.cmd whatsapp:simulate --from 5511988887777 --text "Queria saber o preço"
   pnpm.cmd whatsapp:simulate --from 5511988887777 --text "Do clareamento"
   ```
   Uns 10 segundos depois (espera do agrupamento), a janela do simulador da Anthropic mostra **uma** chamada e a da Meta
   mostra **uma** resposta com o preço do clareamento da base.
5. Entre em http://localhost:3000 como `owner@demo.local` → **Inbox**: a resposta aparece marcada como "IA".
6. Transferência: `pnpm.cmd whatsapp:simulate --from 5511988887777 --text "Quero falar com um atendente"`. A conversa vai
   para "Humano atendendo", com o aviso do motivo, e a IA para de responder. Use **Devolver para IA** para voltar.
7. Outros gatilhos do simulador (no texto do cliente): `#seminfo` (falta informação), `#recusa`, `#corta` (resposta
   truncada), `#erro` (529, com nova tentativa), `#chave` (chave inválida), `#lento` (8 s; dá tempo de clicar em
   **Assumir atendimento** e ver a resposta ser descartada).
8. Como `admin@arthurai.local`: **Empresas → Empresa Demo → IA** (ligar/desligar, modo inicial, horário),
   **Base de conhecimento** e **Uso** (execuções, tokens, cache e custo estimado).

Para testar o horário: na aba IA, desmarque "Atendimento 24 horas", deixe um intervalo que não inclua agora e simule
uma mensagem: ela fica para a equipe e não é respondida.

## Usar o Claude de verdade (chave da Anthropic)

1. Crie uma chave em https://console.anthropic.com (Settings → API Keys) numa conta com créditos.
2. No `.env` (nunca no código, em commits, prints ou mensagens), troque o valor de `ANTHROPIC_API_KEY` pela sua chave e
   **apague a linha `ANTHROPIC_BASE_URL`** (sem ela, a API oficial é usada). Não digite a chave em comandos que fiquem no
   histórico do terminal; edite o arquivo:
   ```powershell
   notepad .env
   ```
3. Pare o simulador da Anthropic e reinicie a API (`Ctrl+C` e `pnpm.cmd dev:api`). O log deve dizer
   `IA: configurada (modelo claude-sonnet-5-5, esforço low)` **sem** "SIMULADA".
4. Repita o passo 4 do roteiro acima (a Meta pode continuar simulada). Na aba **Uso**, confira tokens e custo.
5. Erros comuns: 401 (chave errada) e 402 (sem créditos) aparecem na aba Uso como "Erro" e a conversa vai para humano.

## Conectar um número real (Meta)

O que é preciso:

1. **App na Meta for Developers** com o produto WhatsApp, e uma **conta do WhatsApp Business (WABA)** com um número registrado e verificado.
2. **Token permanente** de um *System User* do Business Manager com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. O token temporário de 24h do painel de testes serve só para um teste rápido.
3. **Endpoint HTTPS público** acessível pela Meta (`localhost` não funciona). Em produção, o domínio da API (com TLS). Para testar a partir do seu computador, um túnel HTTPS, como Cloudflare Tunnel ou ngrok, apontando para a porta 4000.
4. No painel do app (WhatsApp → Configuração), cadastre o **Callback URL** `https://SEU-DOMINIO/api/webhooks/whatsapp`, o **Verify token** igual a `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e assine o campo **`messages`**.
5. No `.env` do servidor: `WHATSAPP_APP_SECRET` (Configurações do app → Básico), `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, uma `WHATSAPP_TOKEN_ENCRYPTION_KEY` nova, `WHATSAPP_GRAPH_API_BASE_URL=https://graph.facebook.com`. Reinicie a API.
6. No Arthur AI, como SUPERADMIN: **Empresas → empresa → aba WhatsApp**. Informe o WABA ID, o Phone Number ID, o número e o token, salve e clique em **Testar conexão** (deve ficar "Conectado").
7. Mande uma mensagem do seu celular para o número da empresa: ela deve aparecer na Inbox. Responda em até 24h.

Durante o teste com o número de teste da Meta, só os destinatários cadastrados na lista de permitidos recebem mensagens (erro 131030 caso contrário).

## Qualidade e testes

```bash
pnpm lint           # ESLint (typescript-eslint strictTypeChecked nos pacotes Node; config do Next no web)
pnpm typecheck      # tsc strict em todos os pacotes
pnpm build          # build de todos os pacotes
pnpm test           # testes e2e da API
```

Os testes e2e rodam contra um **PostgreSQL real** (`TEST_DATABASE_URL`): o setup aplica as migrations com `prisma migrate deploy`, cada suíte trunca as tabelas, e tudo passa pelo HTTP com cookie de sessão real (sem mocks do Prisma).

A Meta e a Anthropic são substituídas por servidores HTTP falsos (`test/whatsapp-helpers.ts`, `test/ai-helpers.ts`):
o SDK oficial da Anthropic é usado de verdade contra o servidor falso, então erros, retentativas e formato das
respostas passam pelo mesmo código de produção. Os testes **não leem** `ANTHROPIC_*`/`AI_*` do seu `.env` e nunca chamam
a Anthropic real. Estado atual: 12 arquivos, 207 testes.

## Limitações conhecidas

- **Rate limit em memória**: zera quando a API reinicia e não é compartilhado entre instâncias. Com mais de uma instância, precisa de store compartilhado (ex.: Redis — fora do escopo desta fase). Veja também `TRUST_PROXY` acima.
- **Lockout por e-mail**: 5 falhas em 15 min bloqueiam aquele e-mail, inclusive para o dono legítimo (troca consciente de disponibilidade por proteção contra força bruta).
- **Sessões expiradas** são removidas quando usadas; não há job de limpeza periódica.
- **Sem edição de empresa/usuário** pelo painel (pausar, desativar, trocar role): nesta fase só pelo banco.
- **Inbox por polling** (5 s): simples e confiável, mas gera uma requisição por aba aberta a cada ciclo; websocket fica para quando o volume justificar.
- **Inbox mostra as 50 conversas mais recentes** do filtro (com aviso quando há mais); paginação da lista fica para depois.
- **WhatsApp validado só com simulador**: a integração real depende das credenciais da Meta (ver "Conectar um número real").
- **Mídia**: imagens, áudios, documentos e localização são registrados com um aviso ("tipo X recebido"), mas o conteúdo ainda não é baixado nem exibido. O envio é só de texto.
- **Modelos (templates)**: não há gerenciador. Fora da janela de 24h não é possível escrever ao cliente (nem a IA).
- **IA validada só com simulador**: o Claude real nunca foi chamado neste projeto; a qualidade das respostas e o custo
  real precisam ser conferidos com uma chave de verdade e conversas reais antes de ligar para clientes.
- **IA fora do horário não responde depois**: a mensagem fica para a equipe; não há "mensagem de ausência" automática.
- **Base de conhecimento só com texto**: sem upload de PDF/arquivos. Bases maiores que `AI_KNOWLEDGE_MAX_CHARS` usam
  seleção por palavras em comum (pode deixar de fora uma entrada relevante escrita com outras palavras).
- **Mídia e IA**: áudio, imagem e documentos vão direto para humano (a IA não interpreta).
- **Sem limite de gasto**: nada interrompe a IA por orçamento (decisão desta fase); só o limite anti-loop por conversa.
- **Custo é estimativa**: calculado pela tabela de preços configurada; a fatura oficial é a do console da Anthropic.
- **Respostas geradas durante uma troca de modo** são pagas e descartadas (aparecem como "Descartada" no Uso).
- **Envio duplicado em caso extremo**: se a API cair depois que a Meta aceitou a mensagem e antes de gravar o wamid, a retentativa pode reenviar (a Cloud API não oferece chave de idempotência).
- **Status de mensagens enviadas fora do Arthur AI** (pelo app do WhatsApp Business ou outra ferramenta) são ignorados.
- **Busca de contatos** usa `ILIKE` (varredura); com muitos milhares de contatos por empresa, considerar índice trigram.
- **Telefone**: o 9º dígito de celulares brasileiros é tratado ao vincular mensagens recebidas a contatos existentes; contatos cadastrados à mão continuam com o número digitado.
- **CSP parcial** (`frame-ancestors`, `base-uri`, `form-action`, `object-src`); `script-src` com nonce fica para depois.
