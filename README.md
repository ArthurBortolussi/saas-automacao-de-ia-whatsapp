# Arthur AI

Plataforma B2B **gerenciada** de atendimento automatizado (futuramente via WhatsApp + IA).
Não é self-service: o **SUPERADMIN** cadastra empresas e usuários; cada empresa acessa apenas o próprio ambiente.

> **Estado atual: FASE 2** — fundação multi-tenant (Fase 1) + contatos, conversas e caixa de entrada internas (Fase 2).
> IA, WhatsApp e integrações externas **não** estão implementados: mensagens existem só dentro do sistema.

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

## Qualidade e testes

```bash
pnpm lint           # ESLint (typescript-eslint strictTypeChecked nos pacotes Node; config do Next no web)
pnpm typecheck      # tsc strict em todos os pacotes
pnpm build          # build de todos os pacotes
pnpm test           # testes e2e da API
```

Os testes e2e rodam contra um **PostgreSQL real** (`TEST_DATABASE_URL`): o setup aplica as migrations com `prisma migrate deploy`, cada suíte trunca as tabelas, e tudo passa pelo HTTP com cookie de sessão real (sem mocks do Prisma).

## Limitações conhecidas (FASE 1)

- **Rate limit em memória**: zera quando a API reinicia e não é compartilhado entre instâncias. Com mais de uma instância, precisa de store compartilhado (ex.: Redis — fora do escopo desta fase). Veja também `TRUST_PROXY` acima.
- **Lockout por e-mail**: 5 falhas em 15 min bloqueiam aquele e-mail, inclusive para o dono legítimo (troca consciente de disponibilidade por proteção contra força bruta).
- **Sessões expiradas** são removidas quando usadas; não há job de limpeza periódica.
- **Sem edição de empresa/usuário** pelo painel (pausar, desativar, trocar role): nesta fase só pelo banco.
- **Inbox sem tempo real**: a lista e o chat atualizam ao agir ou recarregar a página (sem polling/websocket).
- **Inbox mostra as 50 conversas mais recentes** do filtro (com aviso quando há mais); paginação da lista fica para depois.
- **Mensagens recebidas** só existem via seed: não há canal de entrada nesta fase.
- **Busca de contatos** usa `ILIKE` (varredura); com muitos milhares de contatos por empresa, considerar índice trigram.
- **Telefone**: a ambiguidade do 9º dígito de celulares brasileiros no WhatsApp ainda não é tratada.
- **CSP parcial** (`frame-ancestors`, `base-uri`, `form-action`, `object-src`); `script-src` com nonce fica para depois.
