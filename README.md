# Arthur AI

Plataforma B2B **gerenciada** de atendimento automatizado (futuramente via WhatsApp + IA).
Não é self-service: o **SUPERADMIN** cadastra empresas e usuários; cada empresa acessa apenas o próprio ambiente.

> **Estado atual: FASE 3** — fundação multi-tenant (Fase 1), contatos/conversas/Inbox (Fase 2) e integração com a
> **WhatsApp Cloud API oficial da Meta** (Fase 3). A IA (respostas automáticas) **ainda não existe**: chega na Fase 4.
>
> ⚠️ A integração foi testada **apenas com uma Graph API simulada**. Ela ainda não foi validada com um número real da Meta.
>
> Contexto para sessões do Claude Code (regras de segurança, convenções e o plano da Fase 4): veja [`CLAUDE.md`](CLAUDE.md).

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
- **Modos**: humanos só enviam em `HUMAN`. Mensagens recebidas nunca mudam o modo. Conversas novas do WhatsApp nascem em `AI`, mas **nada responde automaticamente** até a Fase 4: alguém precisa clicar em "Assumir atendimento".
- **Preparado para a Fase 4**: `ConversationEvents.onInboundMessage()` avisa sobre cada mensagem nova, e `WhatsAppOutboundService.send(..., { type: "AI" })` é o mesmo envio dos humanos (recusa se `aiMayReply(mode)` for falso).
- **"Nova conversa" pelo painel continua interna**: iniciar uma conversa no WhatsApp exige um modelo aprovado pela Meta, e o gerenciador de modelos fica para uma fase futura.
- **Inbox**: atualiza sozinha a cada 5 s (polling, só com a aba visível).

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

As três primeiras ligam o WhatsApp: **todas ou nenhuma**. Sem nenhuma, a integração fica desligada e o resto do sistema funciona normalmente. Com só uma ou duas, a API não sobe (é quase sempre erro de configuração). Em produção, a API também se recusa a subir com os valores fictícios do `.env.example`.

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

## Rodando

```bash
pnpm dev:api        # http://localhost:4000/api  (NestJS em watch)
pnpm dev:web        # http://localhost:3000      (Next.js)
```

- **SUPERADMIN**: entre em http://localhost:3000/login com `admin@arthurai.local` → `/admin`.
- **Usuário de empresa**: entre com `owner@demo.local` → `/dashboard`, `/dashboard/contacts` e `/dashboard/inbox`.
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

## Limitações conhecidas

- **Rate limit em memória**: zera quando a API reinicia e não é compartilhado entre instâncias. Com mais de uma instância, precisa de store compartilhado (ex.: Redis — fora do escopo desta fase). Veja também `TRUST_PROXY` acima.
- **Lockout por e-mail**: 5 falhas em 15 min bloqueiam aquele e-mail, inclusive para o dono legítimo (troca consciente de disponibilidade por proteção contra força bruta).
- **Sessões expiradas** são removidas quando usadas; não há job de limpeza periódica.
- **Sem edição de empresa/usuário** pelo painel (pausar, desativar, trocar role): nesta fase só pelo banco.
- **Inbox por polling** (5 s): simples e confiável, mas gera uma requisição por aba aberta a cada ciclo; websocket fica para quando o volume justificar.
- **Inbox mostra as 50 conversas mais recentes** do filtro (com aviso quando há mais); paginação da lista fica para depois.
- **WhatsApp validado só com simulador**: a integração real depende das credenciais da Meta (ver "Conectar um número real").
- **Mídia**: imagens, áudios, documentos e localização são registrados com um aviso ("tipo X recebido"), mas o conteúdo ainda não é baixado nem exibido. O envio é só de texto.
- **Modelos (templates)**: não há gerenciador. Fora da janela de 24h não é possível escrever ao cliente.
- **Envio duplicado em caso extremo**: se a API cair depois que a Meta aceitou a mensagem e antes de gravar o wamid, a retentativa pode reenviar (a Cloud API não oferece chave de idempotência).
- **Status de mensagens enviadas fora do Arthur AI** (pelo app do WhatsApp Business ou outra ferramenta) são ignorados.
- **Busca de contatos** usa `ILIKE` (varredura); com muitos milhares de contatos por empresa, considerar índice trigram.
- **Telefone**: o 9º dígito de celulares brasileiros é tratado ao vincular mensagens recebidas a contatos existentes; contatos cadastrados à mão continuam com o número digitado.
- **CSP parcial** (`frame-ancestors`, `base-uri`, `form-action`, `object-src`); `script-src` com nonce fica para depois.
