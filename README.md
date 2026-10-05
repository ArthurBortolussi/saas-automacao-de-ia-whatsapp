# Vortrix AI

Plataforma B2B **gerenciada** de atendimento automatizado pelo WhatsApp, com IA (Claude, da Anthropic).
Não é self-service: o **SUPERADMIN** cadastra empresas e usuários; cada empresa acessa apenas o próprio ambiente.

> **Marca:** o produto se chamava **Arthur AI** até a Fase 7. Identificadores internos foram mantidos de propósito
> para não quebrar compatibilidade: pacotes `@arthur-ai/*`, bancos `arthur_ai`/`arthur_ai_test`, cookie de sessão
> `aai_session` e os e-mails do seed (`admin@arthurai.local`). Tudo o que o usuário vê usa **Vortrix AI**.

> **Estado atual: FASE 8** — rebranding para Vortrix AI, design system e redesign completo da interface (Fase 8), sobre
> as Fases 1 a 7: fundação multi-tenant (Fase 1), contatos/conversas/Inbox (Fase 2), **WhatsApp Cloud API
> oficial da Meta** (Fase 3), **atendimento automático com IA + base de conhecimento** (Fase 4), **equipe,
> distribuição automática, fila de espera, transferências e encerramento de atendimentos** (Fase 5), **Analytics e
> relatórios com exportação em PDF e Excel** (Fase 6) e **configurações e administração da plataforma** (Fase 7:
> permissões individuais, três horários, feriados, mensagens automáticas, pausa e limite mensal da IA, suspensão de
> empresas, contatos de suporte e estado das integrações).
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
- `system`: (1) regras fixas da Vortrix AI, (2) empresa + assistente + orientações + base, (3) data/hora atual.
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
preço fica com custo nulo e é contado à parte. Limite mensal de custo estimado: ver Fase 7.

**Permissões**
| | SUPERADMIN | OWNER / ADMIN | AGENT |
|---|---|---|---|
| Ligar/desligar a IA, modo inicial das novas conversas | ✔ (aba IA do admin) | — | — |
| Nome, tom, orientações, mensagem de transferência (Fase 7: grupo "IA"; horário: grupo "Horários"; fuso: só o proprietário) | ✔ | ✔ com a permissão individual (Configurações) | vê; edita com a permissão |
| Base de conhecimento: criar, editar, ativar/desativar, excluir | ✔ (qualquer empresa) | ✔ (só a própria) | vê só as ativas |
| Aba Uso (consumo e custo) | ✔ | — | — |

Tudo conferido no backend: a rota da empresa recusa os campos técnicos (400) e as edições exigem o grupo de permissão
correspondente (403; Fase 7).
IDs de outra empresa respondem 404; rotas de outra empresa, 403.

### Equipe e atendimento humano (Fase 5)

Três conceitos **separados** (nunca no mesmo campo):

| Conceito | Onde | Valores | Significado |
|---|---|---|---|
| Modo da conversa | `Conversation.mode` | `AI`, `HUMAN`, `PAUSED` | Quem pode responder |
| Estado operacional | `Conversation.status` | `OPEN`, `QUEUED`, `ASSIGNED`, `CLOSED` | Andamento: com a IA ou sem responsável, na fila, com um funcionário, encerrada |
| Disponibilidade | `CompanyMember.availability` | `AVAILABLE`, `BUSY`, `AWAY` | Se o funcionário recebe conversas **novas** |

Regras garantidas pelo banco (CHECK): conversa `ASSIGNED` tem responsável; `QUEUED` tem horário de entrada na fila e
nenhum responsável; conversa no modo IA nunca está na fila nem atribuída. O responsável é uma **FK composta**
`(companyId, assignedUserId) → CompanyMember`: o banco recusa um responsável de outra empresa.

**Distribuição automática** (`apps/api/src/team/distribution.service.ts`), sem IA: candidatos são os funcionários da
empresa **ativos**, com permissão de atender (`canAttend`), em `AVAILABLE` e com vaga (`atendimentos atribuídos <
maxConcurrent`). Escolha: **menos atendimentos**; empate → quem recebeu **há mais tempo** (`lastAssignedAt`, rotação);
depois o id. Roda quando: uma conversa nova nasce em modo humano, a IA transfere, alguém fica disponível, uma vaga é
liberada (encerramento, transferência, devolução à IA), limite aumentado, funcionário reativado, e a cada ciclo do
worker (`TEAM_WORKER_INTERVAL_MS`, recuperação após reinício).

**Concorrência**: toda mudança de atribuição acontece numa transação sob uma **trava por empresa**
(`pg_advisory_xact_lock`), inclusive entre várias instâncias da API. Atribuições são condicionais ao estado lido.
Resultado testado: nenhuma conversa com dois responsáveis, nenhum limite ultrapassado, empresas diferentes não esperam
umas pelas outras.

**Fila**: a própria conversa guarda `status = QUEUED` e `queuedAt` (uma entrada por conversa, por definição; ordem de
chegada por empresa; persistente). Conversas pausadas ficam na fila mas não são distribuídas até serem reativadas.
A posição mostrada na Inbox é calculada do banco. **Mensagem de espera**: texto fixo (`QUEUE_WAITING_MESSAGE`), sem IA,
enviada **uma vez por entrada na fila** pelo envio da Fase 3 (remetente `SYSTEM`); a marcação acontece na mesma
transação da mensagem. Se não puder enviar (janela de 24h fechada, conversa interna, WhatsApp desligado), a conversa
continua na fila e o motivo fica em `queueNoticeError`.

**Transferência**: funcionário transfere só as próprias conversas; OWNER/ADMIN transferem qualquer conversa humana da
empresa (inclusive da fila ou sem responsável). Destinatário: mesma empresa, ativo, habilitado, `AVAILABLE` e com vaga
— conferido **sob a trava**; se mudar no meio do caminho, a transferência é recusada. A tela lista só os elegíveis.

**Encerramento**: manual ("Finalizar atendimento": responsável ou OWNER/ADMIN) ou **automático por inatividade**
(prazo por empresa, padrão 240 min, aba Equipe). Critério de inatividade: `lastActivityAt` — atualizado por mensagem
recebida, mensagem enviada pela equipe/IA/sistema e pela própria atribuição. Não encerra se houver mensagem ainda sendo
enviada; o encerramento é condicional à última atividade lida, e a mensagem recebida trava a linha da conversa: se o
cliente escrever durante o encerramento, ou o encerramento desiste, ou a mensagem reabre o atendimento.

**Encerramento automático da IA** (pós-Fase 6): atendimentos **só com a IA** (modo `AI`, estado `OPEN`) têm prazo
próprio, independente do prazo da equipe: `AiSettings.inactivityTimeoutMinutes`, padrão **240 min (4 h)**, de 5 min a
30 dias, editável por OWNER/ADMIN (e SUPERADMIN) em **Configurações → Encerramento automático** (dashboard) ou na aba
**IA** do admin. Roda no mesmo worker da equipe (`TEAM_WORKER_INTERVAL_MS`), sem depender de navegador aberto.
Conversas `HUMAN` e `PAUSED` nunca são encerradas por esse prazo. Não encerra se houver mensagem sendo enviada ou
tarefa da IA pendente/em geração; a gravação é condicional ao modo `AI`, ao estado `OPEN` e à última atividade lida
(sob a trava da empresa), então execuções simultâneas encerram cada atendimento uma vez e uma mensagem do cliente no
meio do caminho cancela o encerramento. O encerramento usa o mesmo caminho da Fase 5 (`closeReason = INACTIVITY`,
ciclo do Analytics fechado, tarefas da IA canceladas, auditoria). O cliente que volta reabre a mesma conversa no modo
padrão da empresa. Encerrar por inatividade **não** significa que o problema do cliente foi resolvido.

**Reabertura**: mensagem nova numa conversa encerrada reabre **a mesma conversa** (histórico preservado) num ciclo novo,
no **modo padrão da empresa**: IA → modo IA, sem responsável, a IA responde; humano → fila e distribuição. Mensagens
repetidas da Meta (mesmo wamid) não reabrem duas vezes.

**IA (Fase 4)**: quando a IA transfere, a conversa vai para a fila na mesma transação e é distribuída. Devolver para a IA
tira o responsável e a fila, libera a vaga e cancela tarefas da IA; a IA só responde mensagens que chegarem depois.

**Desativar um funcionário** encerra as sessões dele e devolve as conversas dele para a fila (sem nova mensagem de
espera). Mudar para Ocupado/Ausente **não** mexe nas conversas atuais.

**Conversas antigas (antes da Fase 5)**: humanas/pausadas com responsável que é membro da empresa viraram `ASSIGNED`
para essa mesma pessoa; responsável que não é membro (ex.: SUPERADMIN) foi removido; humanas sem responsável ficaram
`OPEN` ("Sem responsável" na Inbox) — sem fila nem mensagem automática, até o cliente escrever de novo (aí entram na
fila) ou um OWNER/ADMIN atribuir pelo botão "Atribuir a alguém".

**Permissões**
| | SUPERADMIN | OWNER | ADMIN | AGENT |
|---|---|---|---|---|
| Ver a equipe | ✔ (aba Equipe do admin, só consulta) | ✔ | ✔ | ✔ (sem e-mails) |
| Cadastrar funcionário (senha provisória + troca obrigatória) | ✔ pela aba Usuários (Fase 1) | ✔ | ✔ (exceto proprietário) | — |
| Perfil, ativar/desativar, limite, "recebe atendimentos" | — | ✔ | ✔ (exceto proprietários) | — |
| Própria disponibilidade | — | ✔ | ✔ | ✔ |
| Transferir / finalizar | — (supervisão) | qualquer atendimento humano | qualquer atendimento humano | só os próprios |
| Responder conversa atribuída a outra pessoa | ✔ | ✔ | ✔ | — |
| Tempo de inatividade da empresa | — | ✔ | ✔ | — |

Ninguém altera o próprio perfil nem se desativa; a empresa sempre mantém um proprietário ativo.

### Analytics e relatórios (Fase 6)

Dois painéis com finalidades diferentes, ambos com seletor único de período (**Hoje**, **Últimos 7 dias**, **Últimos 30
dias**) e exportação em **PDF** e **Excel (.xlsx)**:

| | Quem acessa | Fuso | Conteúdo |
|---|---|---|---|
| `/dashboard/analytics` | **OWNER e ADMIN** da empresa (AGENT: 403 na API e item fora do menu) | `Company.timezone` (padrão `America/Sao_Paulo`) | Indicadores operacionais. **Nenhum** consumo, token ou custo da IA |
| `/admin/analytics` | **SUPERADMIN** | `America/Sao_Paulo` (referência da plataforma) | Consolidado, mensagens, consumo e custo estimado da IA por origem e por empresa, consulta de uma empresa |

**Atendimento = ciclo** (`ConversationCycle`): da criação ou reabertura da conversa até o encerramento. A mesma
conversa reaberta gera um novo atendimento; o encerramento anterior continua contado no período em que aconteceu.
Os marcos de cada ciclo são gravados **nas mesmas transações** dos fluxos das Fases 3 a 5 (`analytics/cycle-tracker.ts`):
um webhook duplicado é desfeito junto com a mensagem e não cria ciclo; transferências entre funcionários não criam
novo atendimento. No máximo um ciclo aberto por conversa (índice único parcial no banco).

**Definições** (atendimentos iniciados no período, classificados pelo histórico até o instante de referência):

| Indicador | Regra |
|---|---|
| Atendimentos | Ciclos com início no período |
| Somente pela IA | A IA respondeu ou transferiu, **sem** entrada na fila e **sem** funcionário. Separado em encerrados × em andamento. Não prova que o problema foi resolvido |
| Atendimento humano | Teve atribuição a um funcionário **ou** mensagem de funcionário (entrar na fila não basta). Vale o histórico: devolvido à IA depois continua "humano" |
| Aguardando humano | Entrou na fila (pedido ou transferência da IA) e ainda não teve funcionário |
| Sem resposta | Nem IA nem equipe (ex.: IA desligada ou fora do horário) |
| Transferidos pela IA | Atendimentos com pelo menos uma transferência feita pela IA (cada um conta uma vez) |
| Encerrados | Pelo **horário do encerramento** (inclusive de ciclos iniciados antes), separados em manual × inatividade. "Somente pela IA" mostra à parte quantos foram encerrados por inatividade (o cliente parou de responder) |
| Em andamento / na fila | Situação **agora** (independe do período; a tela mostra "Agora · hh:mm") |
| Primeira resposta humana | Do pedido de atendimento humano (1ª entrada na fila ou atribuição direta, o que vier antes) até a 1ª mensagem de funcionário. IA, aviso de fila e mensagens do sistema não contam. Sem resposta = fora da média (contado em "pedidos sem resposta") |
| Espera na fila | Por atendimento: **soma das esperas concluídas por atribuição** (várias entradas na fila são somadas; saída sem atribuição descarta a espera; espera em andamento não entra). Média por atendimento |
| Mensagens (admin) | Recebidas (únicas por wamid) e enviadas por origem: IA, equipe, avisos do sistema; falhas à parte |
| Custo (admin) | Soma de `AiRun.costUsd` (estimado na execução por `pricing.ts`; nenhuma fórmula nova), em **USD**, separado por origem. Custo médio por atendimento = custo das execuções do período ligadas a um atendimento ÷ atendimentos distintos com custo |

Médias sem amostras aparecem como **"Sem dados"** (nunca zero); valores sem base de cálculo, como **"Indisponível"**.

**Períodos**: calendário no fuso do relatório, sempre incluindo o dia atual — `today` = 00:00 de hoje até agora;
`last7days` = hoje + 6 dias anteriores; `last30days` = hoje + 29 dias anteriores. O início do dia é calculado pelo
PostgreSQL (`AT TIME ZONE`), correto também em dias de mudança de horário.

**Exportações** (`GET .../analytics/export?format=pdf|xlsx&period=...&at=...`): geradas em memória (nada é gravado em
disco), com `Content-Disposition: attachment`, `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`; mesmas
permissões dos relatórios; limite de 20 exportações por usuário a cada 10 minutos (em memória); auditadas
(`analytics.exported`). A tela envia o **instante de referência** (`at`, até 24 h atrás) do relatório exibido: o arquivo
usa o mesmo recorte, e os atendimentos e marcos posteriores a esse instante não entram. A "situação atual" é sempre a
do momento da geração. O PDF e o Excel são desenhados do mesmo conteúdo (`report-content.ts`); o Excel tem abas
Resumo, Diário, Notas e, no admin, Consumo IA e Por empresa, com números reais e formatos de duração, data e US$.

**Origem do consumo da IA** (`AiRun.apiSource`), gravada na execução: `OFFICIAL` (api.anthropic.com) ou `SIMULATED`
(qualquer outro endereço). Registros anteriores à Fase 6 ficam **nulos = origem não verificada** (não são deduzidos).
Simulado e não verificado nunca entram no custo oficial. A aba **Uso** (admin → empresa) usa o mesmo período, fuso e
separação por origem do Analytics.

**Dados anteriores à Fase 6**: a migration cria um ciclo `BACKFILL` por conversa, só com fatos verificáveis (início do
ciclo atual, encerramento, espera em andamento, primeira resposta da IA/atribuição/mensagem de funcionário dentro do
ciclo). Ciclos anteriores de conversas já reabertas não existem nos dados e **não** são inventados. Ciclos reconstruídos
entram nas contagens, mas não nas médias de tempo (não há como saber quando o atendimento humano foi pedido); a tela
e os arquivos avisam quantos são.

### Configurações e administração da plataforma (Fase 7)

**Configurações da empresa** (`/dashboard/settings`, seis abas; todos os membros consultam, a edição é conferida na API):

| Aba | O que tem | Quem edita |
|---|---|---|
| Empresa | Nome comercial, logotipo, fuso horário; dados cadastrais (só leitura) | Somente o **proprietário** |
| IA | Pausar/retomar a IA (com confirmação), nome, tom, orientações, mensagem de transferência, encerramento da IA | Grupo **IA** |
| Atendimento | Tempo máximo de espera na fila (alerta) e encerramento por inatividade da equipe | Grupo **Atendimento e fila** |
| Horários | Horário geral do negócio, da IA e da equipe; calendário com feriados nacionais e datas especiais | Grupo **Horários** |
| Mensagens | Boas-vindas, espera na fila, fora do expediente, encerramento (liga/desliga e texto) | Grupo **Mensagens** |
| Permissões | Quem edita cada grupo | Somente o **proprietário** |

**Permissões individuais** (`CompanyMember.settingsPermissions`): o proprietário tem tudo; administradores e
funcionários editam só os grupos concedidos pelo proprietário (`PUT /companies/:id/settings/permissions/:userId`, com
`confirm: true`). Ninguém altera as próprias permissões; proprietários não precisam de concessão; o alvo precisa ser
membro da mesma empresa (outra → 404). A permissão é relida do banco a cada requisição: uma revogação vale na próxima
ação, mesmo com a tela aberta. Migração: **administradores existentes receberam todos os grupos** (nenhum acesso foi
retirado). Novos membros: ADMIN cadastrado pelo proprietário (ou pelo SUPERADMIN) recebe todos os grupos; cadastrado
por outro ADMIN, recebe **no máximo os grupos de quem cadastrou** (sem escalonamento por uma conta criada por ele);
funcionários começam sem grupos; promover a ADMIN não concede nada. O SUPERADMIN edita a IA (rotas da Fase 4), mas não
as configurações operacionais da empresa nem as permissões. A base de conhecimento continua com OWNER/ADMIN (Fase 4).

**Logotipo**: `PUT /companies/:id/logo` com o arquivo como corpo binário (`Content-Type` image/png, image/jpeg ou
image/webp; até 512 KB). O tipo é conferido pelos **bytes** (SVG e outros formatos são recusados) e precisa bater com o
cabeçalho; um upload inválido não toca no logotipo atual. Fica no **PostgreSQL** (tabela `CompanyLogo`), não em disco:
sobrevive a reinícios e funciona com várias instâncias. É servido pela rota da empresa (`GET .../logo`, mesmo
isolamento das outras rotas) com `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e ETag.
Limitação para o deploy: imagens no banco aumentam o backup; com muitos arquivos, um armazenamento de objetos (S3)
seria melhor.

**Fuso horário único** (`Company.timezone`, editado pelo proprietário): vale para os três horários, as datas especiais,
os relatórios da empresa e o mês do limite da IA. A migração copiou o fuso que a empresa tinha escolhido para a IA
(`AiSettings.timezone`, que continua existindo só em sincronia). Horários são sempre locais (HH:MM no fuso), nunca
convertidos para UTC.

**Três horários independentes** (mesma regra para os três: dias da semana + abertura/fechamento, ou 24 h; intervalos
que viram a noite pertencem ao dia em que começam):

| Horário | Onde fica | Para que serve |
|---|---|---|
| Geral do negócio | `CompanySettings` (padrão: seg–sex 8h–18h) | Só o aviso de atendimento fora do expediente |
| IA | `AiSettings` (o mesmo da Fase 4) | Fora dele a IA não gera nem envia |
| Equipe | `TeamSettings` (padrão: **24 h**, como na Fase 5) | Distribuição de **novos** atendimentos |

Quando o expediente da equipe termina, ninguém recebe conversas novas (elas esperam na fila), mas quem está atendendo
continua com as suas. Transferir e assumir manualmente continuam permitidos (é uma ação de quem está trabalhando).
Quando o expediente começa, o worker da equipe (a cada `TEAM_WORKER_INTERVAL_MS`) distribui a fila sozinho, com as
regras da Fase 5 (só Disponível, com vaga) — inclusive depois de um reinício da API. Alterar horários ou datas
especiais também dispara uma verificação imediata.

**Feriados e datas especiais**: os feriados **nacionais** são calculados localmente (sem API externa), conforme o
calendário anual do governo federal: Confraternização Universal, Paixão de Cristo (móvel), Tiradentes, Dia do
Trabalho, Independência, Nossa Senhora Aparecida, Finados, Proclamação da República, Consciência Negra (nacional desde
2024, Lei 14.759/2023) e Natal. Pontos facultativos (Carnaval, Quarta-feira de Cinzas, Corpus Christi) e feriados
estaduais/municipais **não** entram. Os feriados aparecem só como referência: **não fecham a empresa**. Para mudar o
funcionamento de uma data, a empresa cadastra uma **data especial** (`ScheduleException`), com regra separada para cada
horário (segue a semana, fechado ou horário especial). A data especial prevalece sobre a semana.

**Mensagens automáticas** (operacionais, sem o Claude; aparecem na Inbox como "Sistema"):

| Mensagem | Padrão | Quando |
|---|---|---|
| Boas-vindas | desligada | Só no **primeiro contato** do cliente com a empresa (`Contact.welcomeHandledAt`, gravado uma vez na transação da 1ª mensagem; reaberturas e webhooks repetidos não repetem). Clientes que já tinham escrito antes da Fase 7 foram marcados na migração |
| Espera na fila | **ligada** (a da Fase 5) | Uma vez por entrada na fila; mudar o texto não reenvia |
| Fora do expediente | desligada | Pelo **horário geral**, uma vez por **período fechado contínuo** (identificado pelo fim da última abertura, ex.: `2026-10-02T18:00`); várias mensagens na mesma noite = um aviso; depois que a empresa abre e fecha de novo, novo aviso. Vale mesmo que a IA continue respondendo |
| Encerramento | desligada | Só no encerramento **manual** por um funcionário; nunca no automático |

No primeiro contato fora do expediente, a ordem é boas-vindas → aviso. Boas-vindas, aviso e encerramento são gravados
na **mesma transação** do evento (exatamente uma vez) e enviados pelo outbox da Fase 3 (janela de 24h, retentativas e
falhas iguais). Não saem em conversa interna, pausada ou com a janela fechada (o encerramento registra o motivo na
auditoria). Para evitar sequências desnecessárias, o aviso de fila não é enviado se o cliente acabou de receber o aviso
de fora do expediente do mesmo período (`queueNoticeError = AFTER_HOURS_NOTICE`).

**Espera excessiva na fila**: o tempo é contado no **relógio**, desde a entrada **atual** na fila (`queuedAt`),
inclusive fora do expediente. Acima do limite (`TeamSettings.maxQueueWaitMinutes`, padrão 30), a conversa ganha
destaque na Inbox (`ConversationSummary.queueOverdue`) e entra na contagem do painel (`GET /companies/:id/alerts`,
OWNER/ADMIN). Nada é encerrado nem reordenado. Diferença para o Analytics (Fase 6, sem mudança): lá a "espera na
fila" é a soma das esperas concluídas por atribuição desde a primeira entrada do ciclo.

**Pausa da IA pela empresa** (`POST /companies/:id/ai/pause`, grupo IA; pausar exige `confirm: true`): estado separado
da habilitação do SUPERADMIN (`AiSettings.pausedAt` × `enabled`). Ao pausar, sob a trava da equipe: tarefas
pendentes/em geração são canceladas (uma resposta já em geração não é enviada — o envio exige a tarefa ainda em
andamento) e os clientes que esperavam a IA vão para a fila humana. Durante a pausa, novas mensagens (e conversas
novas/reabertas) vão direto para a equipe, com o motivo `AI_PAUSED` (não conta como transferência feita pela IA no
Analytics). Ao retomar, a IA atende só as **próximas** mensagens; conversas humanas continuam humanas. Se o SUPERADMIN
desligou a IA, a empresa não consegue retomá-la (409).

**Limite mensal de custo estimado da IA** (USD, mês de calendário no fuso da empresa; só o SUPERADMIN vê e altera):
- **Limite padrão** em **Configurações** do admin: copiado para a empresa no momento em que a IA é habilitada, se ela
  nunca teve limite. Mudar o padrão depois não altera empresas que já têm limite. Empresas já habilitadas antes da
  Fase 7 continuam **sem limite** até o SUPERADMIN definir um (estado preservado).
- **Limite individual** na aba IA da empresa (admin). Em branco = sem limite.
- **Gasto** = soma de `AiRun.costUsd` do mês (a mesma estimativa da aba Uso e do Analytics). Nada é zerado: o mês novo
  simplesmente não soma o anterior.
- **Proteção contra execuções simultâneas**: antes de chamar o modelo, a execução **reserva** uma estimativa
  conservadora (`AiBudgetReservation`; ~3 caracteres por token na entrada, pelo maior preço entre entrada e escrita de
  cache, mais a saída máxima `AI_MAX_OUTPUT_TOKENS`) sob uma trava por empresa. Gasto + reservas + estimativa acima do
  limite → a IA não inicia a geração e transfere para a equipe (`AI_LIMIT_REACHED`, com a mensagem de transferência).
  Ao gravar o custo real, a reserva sai na mesma transação.
- **Falhas e cancelamentos**: erro da API sem consumo informado não soma nada (reserva liberada); resposta descartada
  (troca de modo/pausa) soma o custo real (foi paga); execução que custa mais do que o previsto pode ultrapassar o
  limite **no máximo pela diferença das execuções em andamento** — as seguintes ficam bloqueadas. Reserva de uma API
  que caiu vence sozinha (10 min). Sem preço conhecido para o modelo e com limite definido, a IA não gera (falha
  fechada).
- **Origens separadas**: o bloqueio soma só a origem deste servidor (API oficial **ou** simulador). Consumo simulado
  nunca vira custo real; registros sem origem (antes da Fase 6) não entram. O teste com o simulador funciona sem
  chave real.
- **Alertas**: a empresa (OWNER/ADMIN) vê "próximo do limite" (80%) e "limite atingido" (100%) **sem valores**; o
  SUPERADMIN vê valores na aba IA, no dashboard (`GET /admin/alerts`) e em Configurações. A primeira vez que cada
  patamar é atingido no mês fica registrada (`AiUsageAlert` + auditoria `ai.usage_threshold`) uma única vez.
- Para a IA voltar no mesmo mês, o SUPERADMIN aumenta o limite; ela volta se estiver habilitada, não pausada, com a
  empresa ativa e dentro do horário da IA.

**Suspensão de empresas** (admin → empresa → **Suspender empresa**, com confirmação; `POST /admin/companies/:id/suspend`
e `/reactivate` com `confirm: true`): suspensa = `status = PAUSED` + `suspendedAt` (o status anterior é guardado para a
reativação). Na mesma transação: sessões dos usuários da empresa encerradas, tarefas da IA canceladas, mensagens ainda
não enviadas marcadas como falha (`COMPANY_SUSPENDED`; não saem nem depois) e reservas liberadas. Toda rota da empresa
responde 403 `COMPANY_SUSPENDED` (já era assim na Fase 1); o painel mostra a tela `/suspended` com os contatos do
suporte. Recebimento, IA, distribuição, encerramento automático e envio conferem a suspensão **dentro das próprias
transações** (linha da empresa travada para leitura), então nada iniciado antes escapa depois. O SUPERADMIN continua
consultando e administrando. **Nada é apagado.**

**Webhooks durante a suspensão**: o endpoint continua recebendo e validando a assinatura. A mensagem de uma empresa
suspensa é **descartada** (nada de contato, conversa, mensagem, fila ou resposta); o evento fica `IGNORED` com
`ignoredReason = COMPANY_SUSPENDED` e **nunca é reprocessado**. Status de entrega de mensagens antigas continuam sendo
aplicados. **Limitação: mensagens enviadas pelos clientes durante a suspensão não são recuperadas.**

**Reativação**: volta ao status anterior; os usuários ativos fazem login de novo; o WhatsApp volta a registrar
mensagens; a fila volta a ser distribuída (no expediente). Nada é respondido retroativamente e o prazo de inatividade
recomeça na reativação (`Company.reactivatedAt`), para conversas preservadas não serem encerradas em massa.

**Contatos de suporte** (admin → **Configurações**): e-mail e WhatsApp validados, mostrados na tela de suspensão com
links seguros (`mailto:` e `https://wa.me/<dígitos>`). `GET /api/support` exige login (qualquer usuário). Sem contato
configurado, a tela orienta a procurar o responsável da empresa.

**Estado básico das integrações** (admin → **Configurações**): WhatsApp e Anthropic com configurada/não configurada,
ambiente **Oficial × Simulado**, contas por estado, empresas com a IA ligada/pausada e a última atividade observada
(último webhook, último envio aceito, última resposta pela API oficial e pelo simulador). Credencial configurada não é
apresentada como conexão validada, o simulador é sempre identificado e nenhum segredo aparece.

**Confirmação e auditoria**: pausar a IA, alterar permissões, suspender e reativar exigem confirmação na tela (com o
efeito explicado) **e** `confirm: true` na API. Alterações relevantes são auditadas com empresa, autor, horário, ação e
grupo: `company.profile_updated`, `company.logo_updated/removed`, `company.suspended/reactivated`,
`settings.permissions_changed` (concedidas e revogadas), `settings.schedules_updated`,
`settings.exception_created/updated/deleted`, `settings.messages_updated`, `settings.service_updated`,
`ai.paused/resumed`, `ai.limit_updated`, `ai.usage_threshold`, `platform.settings_updated`. Nunca senhas, tokens ou chaves.

### Identidade visual e design system (Fase 8)

Direção **Premium Híbrido**: conteúdo claro, sidebar escura (midnight), destaque índigo/violeta, cards brancos com
bordas discretas e sombras mínimas. Só um tema (claro com sidebar escura); não há dark mode completo.

**Tokens** (fonte única: `packages/ui/src/styles/globals.css`; componentes usam as classes do Tailwind geradas a partir
deles, nunca hexadecimais soltos):

| Token | Valor | Uso |
|---|---|---|
| `--vx-midnight` → `--sidebar` | `#0B1220` | Sidebar, barra do mobile, painel do login, sobreposição de modais |
| `--vx-indigo-strong` → `--primary` | `#4F46E5` | Botão principal, aba ativa, links de destaque, gráfico "IA" |
| `--vx-indigo` → `--brand`/`--ring` | `#6366F1` | Destaques, foco, indicador do menu ativo |
| `--vx-lavender` → `--brand-soft` | `#E9ECFF` | Fundos de ícones, selos de marca, balão da IA |
| `--vx-mist` → `--background` | `#F4F6FB` | Fundo do conteúdo |
| `--card` | `#FFFFFF` | Cards, tabelas, formulários |
| `--success` / `--warning` / `--destructive` / `--info` | `#15803D` / `#B45309` / `#DC2626` / `#4F46E5` | Estados (texto com contraste ≥ 4,5:1); cada um tem uma versão `-soft` para fundos |
| `--chart-1..3`, `--chart-muted` | `#4F46E5`, `#0D9488`, `#D97706`, `#CBD2DE` | Gráficos: IA, equipe, aguardando, residual (validados para daltonismo) |
| `--bubble-*` | — | Mensagens da Inbox: cliente (branco), IA (lavanda), equipe (grafite), automática (areia) |

**Tipografia:** Geist Sans (texto, números tabulares nos indicadores) e Geist Mono, via pacote `geist` (sem download
de fontes no build). Hierarquia: título de página 24 px (20 no mobile), título de card 15 px, corpo 14 px, legendas
12–13 px, rótulos de seção 11 px em caixa alta.

**Ícones:** somente `lucide-react`, 16–18 px, sempre com texto ao lado nas ações importantes.

**Componentes compartilhados** (`packages/ui/src/components`): `Button` (`default`, `secondary`, `outline`, `ghost`,
`destructive`, `destructive-outline`, `link`), `Badge` (`success`, `warning`, `info`, `destructive`, `brand`,
`neutral`, `outline`), `Alert` (`default`, `success`, `warning`, `info`, `destructive`), `Card`, `Input`,
`NativeSelect`, `Textarea`, `Table`, `Empty`, `Skeleton`, `Dialog` e `Sheet` (Radix). No web (`apps/web/src/components`):
`AppShell`/`SidebarNav`/`MobileNav` (shell), `PageHeader`, `SectionCard`, `NavTabs`, `StatCard`, `Avatar`,
`ConfirmAction` (modal de confirmação), `ErrorState`, `PageSkeleton`, `Logo`/`VortrixMark`.

**Regras visuais:**
- Estado nunca só por cor: selos sempre com texto; origem das mensagens com posição, cor **e** rótulo com ícone.
- Ações críticas (suspender, pausar a IA, desativar funcionário/WhatsApp, excluir, finalizar atendimento) passam pelo
  `ConfirmAction`; a ação principal da tela é o botão índigo, as perigosas usam vermelho.
- Checkbox e radio continuam nativos (os formulários leem `FormData`), coloridos com `accent-color`.
- Animações só em hover, abertura de modal/drawer e troca de estado (≤ 200 ms); `prefers-reduced-motion` desliga.
- A partir de `lg` (1024 px) a sidebar é fixa; abaixo disso vira drawer. A Inbox mostra lista + conversa a partir de
  `md` e o painel do contato a partir de `xl`; no celular, uma coluna por vez.

**Logo:** o monograma V + X atual é **provisório** (SVG inline em `apps/web/src/components/logo.tsx`). Arquivos para
substituição em `apps/web/public/brand/` (símbolo, horizontal claro/escuro) e `apps/web/src/app/icon.svg` (favicon);
veja `apps/web/public/brand/README.md`.

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
| `TEAM_WORKER_INTERVAL_MS` | Ciclo do worker da equipe: fila, avisos de espera, encerramento por inatividade (padrão 5000; `0` desliga o timer) |
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
| AGENT | `atendente@demo.local` | `demo-agent-dev-123` | Empresa Demo (DEV) — Fase 5; criada só se não existir |

A segunda empresa existe para testar o isolamento manualmente: logado como `owner@demo.local`, tente `GET /api/companies/<id da Outra Empresa>` → 403.

Contatos e conversas fictícios (nomes terminam em "Exemplo", telefones `55 11 90000-01xx`):

| Empresa | Contatos | Conversas |
|---|---|---|
| Empresa Demo (DEV) | 5 (todos os status) | Mariana: IA, 2 não lidas · Carlos: humano · Fernanda: pausada, 1 não lida |
| Outra Empresa (DEV) | 2 (um com o **mesmo telefone** da Mariana) | 1 com a IA, 1 não lida |

O seed não recria conversas de contatos que já têm alguma; para voltar ao estado inicial, apague as tabelas `Message`, `Conversation` e `Contact` do banco de dev e rode `pnpm db:seed`.

Fase 7: re-executar o seed **não altera empresas que já existem** (nome comercial, fuso e suspensão podem ter sido
mudados pelo painel); só cria o que falta.

IA (Fase 4): a Empresa Demo ganha a IA **ligada** (assistente "Sofia", tom amigável) e 6 informações fictícias na base
(horário, endereço, preços, convênios; 1 inativa). Só é criado o que não existe: configurações e bases que você já
alterou **não são sobrescritas**.

## Rodando

```bash
pnpm dev:api        # http://localhost:4000/api  (NestJS em watch)
pnpm dev:web        # http://localhost:3000      (Next.js)
```

- **SUPERADMIN**: entre em http://localhost:3000/login com `admin@arthurai.local` → `/admin`.
- **Usuário de empresa**: entre com `owner@demo.local` → `/dashboard`, `/dashboard/contacts`, `/dashboard/inbox`, `/dashboard/knowledge-base`, `/dashboard/settings` (IA) e `/dashboard/team` (Equipe). A disponibilidade fica no menu lateral.
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

| | Simulador | Claude real |
|---|---|---|
| Como responde | Copia **inteira** a entrada da base com mais palavras em comum com o último turno do cliente (palavra inteira, sem acento, no singular; título vale 3) | Lê a base inteira e escreve uma resposta própria, no tom configurado |
| Sinônimos e intenção | Não entende ("abrem" não leva a "funcionamento"; só acerta se houver palavra em comum, como "domingo") | Entende |
| Pergunta sem palavra em comum com a base | Pede transferência (`sem_informacao`) | Responde se a informação existir com outras palavras, ou transfere |
| Várias perguntas na mesma mensagem | Responde só com a entrada de maior pontuação | Responde todas |
| Histórico da conversa | Ignora (usa só o último turno do cliente) | Usa |

Ou seja: uma resposta estranha do simulador **não** indica, por si só, erro no prompt enviado. Para conferir o que foi
enviado, os testes automatizados verificam o conteúdo do prompt; a qualidade real só se mede com a chave real.

### Tipos de teste

| Teste | Anthropic | Meta | Como | Situação |
|---|---|---|---|---|
| Automatizado (`pnpm test`) | servidor falso no próprio teste (e o próprio simulador, em `ai-simulator.e2e.test.ts`) | servidor falso no próprio teste | — | ✅ 249 testes |
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

## Testar a equipe localmente (Fase 5) — Windows / PowerShell

Usa os mesmos simuladores da Meta e da Anthropic (nenhuma chave real). Antes, atualize o projeto (comandos no fim do
roteiro da IA acima: `git pull`, `pnpm.cmd install`, `pnpm.cmd db:deploy`, `pnpm.cmd db:seed`) e acrescente ao `.env`
a linha `TEAM_WORKER_INTERVAL_MS=5000` (do `.env.example`). Suba as quatro janelas (`whatsapp:mock-graph`,
`ai:mock-anthropic`, `dev:api`, `dev:web`).

Use **duas janelas do navegador** (uma normal e uma anônima) para ter dois funcionários logados ao mesmo tempo:
`owner@demo.local` / `demo-owner-dev-123` e `atendente@demo.local` / `demo-agent-dev-123`.

1. **Criar funcionário**: como `owner@demo.local` → **Equipe** → **Cadastrar funcionário** (nome, e-mail, senha provisória
   de 10+ caracteres, perfil, limite). Entre com esse e-mail numa janela anônima: o sistema pede a troca da senha.
2. **Disponibilidade**: no menu lateral, "Minha disponibilidade" → **Disponível**. Na aba Equipe aparece "Disponível".
3. **Fila de espera**: deixe todos como **Ausente** e simule um cliente pedindo atendente (a IA transfere):
   ```powershell
   pnpm.cmd whatsapp:simulate --from 5511977771111 --text "Quero falar com um atendente"
   ```
   Na janela do simulador da Meta aparecem duas mensagens: a de transferência da IA e a de espera ("todos os nossos
   atendentes estão ocupados..."). Na Inbox, filtro **Na fila**, a conversa mostra "Posição na fila: 1".
4. **Distribuição automática**: como `atendente@demo.local`, mude para **Disponível**. Em até 5 s a conversa vai para
   ela (filtro **Minhas**). Mande outros clientes (`--from 5511977772222`, `5511977773333`...) com os dois disponíveis:
   quem tem menos atendimentos recebe primeiro; empate alterna entre os dois.
5. **Ocupado/Ausente**: mude para **Ocupado**. As conversas dela continuam com ela; as novas vão para outra pessoa ou
   para a fila.
6. **Transferência**: abra a conversa → **Transferir** → escolha um colega disponível → **Confirmar**. A lista só mostra
   quem está disponível e com vaga.
7. **Encerramento**: **Finalizar atendimento**. A vaga é liberada (a próxima da fila é distribuída). Para o automático,
   em **Equipe → Encerramento automático**, coloque 5 minutos e espere sem mandar mensagens.
8. **Reabertura**: com a conversa encerrada, simule outra mensagem do mesmo cliente:
   ```powershell
   pnpm.cmd whatsapp:simulate --from 5511977771111 --text "Qual o endereço?"
   ```
   Com o padrão **IA** (Empresa Demo), a mesma conversa reabre e a IA (simulada) responde. Para testar o padrão
   **humano**: como `admin@arthurai.local` → Empresas → Empresa Demo → **IA** → "Modo inicial das novas conversas" =
   "Atendimento humano"; aí a reabertura vai para a fila/distribuição.
9. **Supervisão**: como `admin@arthurai.local` → Empresas → Empresa Demo → **Equipe** (somente consulta).

## Testar o Analytics localmente (Fase 6) — Windows / PowerShell

Usa os mesmos simuladores (nenhuma chave real). Na pasta do projeto, atualize e aplique a migration nova:

```powershell
git pull origin claude/new-session-fucivv
pnpm.cmd install
pnpm.cmd db:deploy
pnpm.cmd db:seed
```

Suba as quatro janelas (`pnpm.cmd whatsapp:mock-graph`, `pnpm.cmd ai:mock-anthropic`, `pnpm.cmd dev:api`,
`pnpm.cmd dev:web`) e siga, um passo de cada vez:

1. **Analytics da Empresa Demo**: entre como `owner@demo.local` / `demo-owner-dev-123` → **Analytics**.
2. **Gerar atendimentos simulados** (outra janela do PowerShell):
   ```powershell
   pnpm.cmd whatsapp:simulate --from 5511966661111 --text "Qual o horário de funcionamento?"
   pnpm.cmd whatsapp:simulate --from 5511966662222 --text "Quero falar com um atendente"
   ```
   O primeiro é respondido pela IA (simulada); o segundo é transferido para a equipe.
3. **Atualizar os indicadores**: recarregue a página (F5). "Atendimentos" sobe 2; "Atendidos somente pela IA" e
   "Transferidos pela IA" sobem 1 cada. Deixe `atendente@demo.local` **Disponível** (janela anônima), responda a
   conversa transferida pela Inbox e recarregue: aparece a "Primeira resposta humana".
4. **Filtros de período**: alterne **Hoje / Últimos 7 dias / Últimos 30 dias**; a linha abaixo dos botões mostra o
   início, o fim e o fuso. Cards, gráficos e "Ver os números em tabela" mudam juntos.
5. **Exportar PDF**: botão **PDF** → abre/baixa `analytics-empresa-demo-dev-....pdf` com período, fuso e indicadores.
6. **Exportar Excel**: botão **Excel** → abas Resumo, Diário e Notas.
7. **Funcionário sem acesso**: entre como `atendente@demo.local` / `demo-agent-dev-123`: o menu não mostra
   **Analytics**; abrindo `http://localhost:3000/dashboard/analytics` à mão aparece "Acesso restrito" (a API responde 403).
8. **Analytics do Super Admin**: entre como `admin@arthurai.local` / `admin-dev-password-123` → **Analytics**.
9. **Consolidado e custos**: confira "Consumo da IA na plataforma": as execuções aparecem como **Simulador (não é custo
   real)** e o custo oficial fica em US$ 0,00. Clique numa empresa no "Resumo por empresa" para ver só ela; o link
   **Execuções da IA** abre a aba Uso com os mesmos números.
10. **Custos fora do painel da empresa**: volte como `owner@demo.local`: o Analytics da empresa e os arquivos exportados
    não mostram tokens nem custos.
11. **Encerramento automático da IA**: como `owner@demo.local` → **Configurações** → aba **IA** → "Encerramento automático" → coloque
    `5` e salve. Simule um cliente (`pnpm.cmd whatsapp:simulate --from 5511966663333 --text "Qual o horário?"`) e espere
    5 minutos sem mandar mensagens: em até alguns segundos depois do prazo a conversa aparece como finalizada na Inbox e,
    no Analytics, em "encerrados por inatividade". Simule outra mensagem do mesmo número: a mesma conversa reabre com a
    IA. Volte o prazo para `240` ao terminar.

## Testar a Fase 7 localmente — Windows / PowerShell

Tudo com os simuladores (nenhuma chave real). Atualize o projeto e aplique a migration nova:

```powershell
git pull origin claude/new-session-fucivv
pnpm.cmd install
pnpm.cmd db:deploy
pnpm.cmd db:seed
```

Suba as quatro janelas, como nas fases anteriores:

```powershell
pnpm.cmd whatsapp:mock-graph      # janela 1
pnpm.cmd ai:mock-anthropic        # janela 2
pnpm.cmd dev:api                  # janela 3
pnpm.cmd dev:web                  # janela 4
```

Use `owner@demo.local` / `demo-owner-dev-123` (proprietário), `atendente@demo.local` / `demo-agent-dev-123`
(funcionário, de preferência numa janela anônima) e `admin@arthurai.local` / `admin-dev-password-123` (Superadmin).
Para simular clientes, abra uma quinta janela e use `pnpm.cmd whatsapp:simulate --from <número> --text "<texto>"`.

1. **Seis abas**: como proprietário → **Configurações**. Abra Empresa, IA, Atendimento, Horários, Mensagens e Permissões.
2. **Nome e logotipo**: aba Empresa → **Enviar imagem** (PNG/JPEG/WEBP até 512 KB) → o logo aparece no menu lateral.
   Mude o nome comercial e salve. Teste um arquivo `.txt` renomeado para `.png`: aparece erro e o logo anterior fica.
3. **Permissões**: aba Permissões → marque "Mensagens automáticas" para a Atendente Demo → **Salvar permissões** → leia a
   confirmação → **Confirmar**. Na janela da atendente, a aba Mensagens fica editável e as outras só para consulta.
   Desmarque e confirme: na próxima tentativa de salvar, a atendente recebe "sem permissão" (sem recarregar).
4. **Três horários**: aba Horários. Cada agenda mostra "Aberto agora"/"Fechado agora". Mude só o horário da equipe e
   salve: o geral e o da IA continuam iguais.
5. **Feriados e datas especiais**: no calendário, os feriados nacionais do ano aparecem como referência ("Funcionamento
   normal"). Clique em **Adicionar data especial** → data de **hoje** → descrição "Teste" → Horário geral **Fechado**,
   IA e equipe **Segue a semana** → salvar.
6. **Mensagens**: aba Mensagens → ligue **Boas-vindas** e **Atendimento fora do expediente** (personalize um texto) → salvar.
7. **Envio das mensagens**: `pnpm.cmd whatsapp:simulate --from 5511977771111 --text "Olá"`. Na Inbox: boas-vindas e
   aviso de fora do expediente ("Sistema"), nessa ordem, e depois a resposta da IA (simulada). Mande outra mensagem do
   mesmo número: nenhuma das duas se repete. Remova a data especial de hoje ao terminar.
8. **Espera excessiva**: aba Atendimento → tempo máximo de espera **1** minuto → salvar. Deixe todos como **Ausente**
   (seletor no menu), simule `--from 5511977772222 --text "Quero falar com um atendente"` e espere 1 minuto: na Inbox,
   filtro **Na fila**, a conversa fica destacada ("Espera excessiva"); o **Dashboard** mostra a contagem. Fique
   **Disponível**: a conversa é atribuída e o destaque some.
9. **Pausa da IA**: aba IA → **Pausar a IA** → leia o efeito → **Pausar agora**. O Dashboard mostra "A IA está pausada".
10. **Encaminhamento durante a pausa**: simule `--from 5511977773333 --text "Oi"`: a conversa vai para a equipe (fila ou
    funcionário disponível), sem resposta da IA. Volte em **Retomar a IA**: a próxima mensagem de um cliente novo é
    respondida pela IA; a conversa que foi para a equipe continua com a equipe.
11. **Limites mensais**: como Superadmin → **Configurações** → limite padrão `5` → salvar. Empresas → Empresa Demo →
    aba **IA** → "Limite mensal de custo estimado" `0.01` → salvar. O cartão "Limite mensal da IA" mostra o gasto do
    mês por origem (o simulador não é custo real).
12. **Alertas de consumo**: simule mais uma mensagem de um cliente novo. Com o limite tão baixo, a IA não gera e
    transfere para a equipe ("limite mensal de uso da IA atingido"); como proprietário, o Dashboard e a aba IA mostram
    o aviso **sem valores**; como Superadmin, o Dashboard lista a empresa em "Alertas". Volte o limite para vazio
    (sem limite) ou um valor maior: a IA volta a responder.
13. **Suspensão**: como Superadmin → Empresas → Empresa Demo → **Suspender empresa** → leia o efeito → **Suspender agora**.
14. **Tela de suspensão**: na janela do proprietário, clique em qualquer item: a sessão foi encerrada. Entre de novo:
    aparece "Acesso temporariamente suspenso" com os contatos de suporte, sem menu. Simule uma mensagem
    (`--from 5511977774444`): nada aparece em lugar nenhum (descartada).
15. **Reativação**: como Superadmin → **Reativar empresa** → confirme. O proprietário entra normalmente; a mensagem do
    passo 14 **não** aparece (não é recuperada); novas mensagens voltam a funcionar.
16. **Contatos de suporte**: como Superadmin → **Configurações** → e-mail e WhatsApp de suporte → salvar. Repita a
    suspensão para ver os links na tela (e reative).
17. **Estado das integrações**: em **Configurações** do Superadmin, WhatsApp e Anthropic aparecem como **Simulado**, com
    a última atividade observada e o aviso de que isso não valida a conexão real. Nenhum token ou chave aparece.
18. **Analytics preservado**: **Analytics** da empresa e do Superadmin abrem como antes, com os atendimentos de hoje;
    exporte PDF e Excel normalmente.

## Revisar o novo design (Fase 8) — Windows / PowerShell

1. `pnpm.cmd install`, `pnpm.cmd db:deploy`, depois `pnpm.cmd dev:api` e `pnpm.cmd dev:web` (opcional:
   `pnpm.cmd whatsapp:mock-graph`, `pnpm.cmd ai:mock-anthropic` e `pnpm.cmd whatsapp:simulate --from 5511988887777 --text "Olá"`
   para ter conversas com cliente, IA e mensagens automáticas).
2. **Login** (`/login`): painel escuro à esquerda (desktop), formulário à direita; teste senha errada.
3. Como `owner@demo.local`: **Dashboard** (situação agora, WhatsApp, atalhos), **Inbox** (filtros, conversa, origem de
   cada mensagem, Finalizar atendimento → modal), **Contatos**, **Base de conhecimento**, **Equipe**, **Analytics**,
   **Configurações** (seis abas; "Pausar a IA" abre a confirmação).
4. Como `admin@arthurai.local`: **Dashboard da plataforma**, **Empresas → empresa** (faixa "dados da empresa", abas,
   Suspender), **Usuários**, **Analytics**, **Configurações**.
5. Suspenda uma empresa e entre com um usuário dela: **tela de suspensão**. Reative em seguida.
6. Responsividade: DevTools (F12) → modo dispositivo, larguras ~390 px (menu vira drawer; Inbox em uma coluna),
   ~820 px (tablet) e ≥ 1280 px. Teclado: Tab mostra o link "Pular para o conteúdo" e o foco visível.

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
6. Na Vortrix AI, como SUPERADMIN: **Empresas → empresa → aba WhatsApp**. Informe o WABA ID, o Phone Number ID, o número e o token, salve e clique em **Testar conexão** (deve ficar "Conectado").
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
a Anthropic real. Estado atual: 22 arquivos, 356 testes (inclui corridas: distribuição simultânea, transferências
simultâneas, encerramento × mensagem nova; Analytics com virada de dia no fuso, reabertura, exportações e isolamento;
Fase 7: boas-vindas com webhooks simultâneos, reservas de orçamento concorrentes, geração em andamento durante a
pausa, suspensão com eventos já na fila).

## Limitações conhecidas

**Visuais (Fase 8):**
- **Logo provisório**: monograma V + X simples, sem a arte definitiva; os SVGs horizontais usam texto (dependem da fonte instalada).
- **Sem dark mode** (só o tema claro com sidebar escura) e **sem toasts**: o retorno das ações aparece junto do formulário/botão.
- A Inbox identifica as mensagens da IA como "IA", sem o nome configurado do assistente (ex.: Sofia): o nome não vem na
  API de mensagens e buscá-lo a cada atualização da Inbox (5 s) teria custo.
- Selects, checkboxes, radios e campos de hora são **nativos** (estilizados, não substituídos): a aparência do menu
  aberto e o formato 12/24 h seguem o navegador e o idioma do sistema.
- Tabelas largas (Equipe, Uso, Usuários) rolam na horizontal dentro do card no celular, em vez de virarem cards.
- Formulários da Fase 7 (Configurações) foram ajustados pelos tokens e componentes, não redesenhados campo a campo.

**Funcionais:**

- **Rate limit em memória**: zera quando a API reinicia e não é compartilhado entre instâncias. Com mais de uma instância, precisa de store compartilhado (ex.: Redis — fora do escopo desta fase). Veja também `TRUST_PROXY` acima.
- **Lockout por e-mail**: 5 falhas em 15 min bloqueiam aquele e-mail, inclusive para o dono legítimo (troca consciente de disponibilidade por proteção contra força bruta).
- **Sessões expiradas** são removidas quando usadas; não há job de limpeza periódica.
- **Edição de empresa pelo painel**: o proprietário muda nome comercial, logotipo e fuso; os demais dados cadastrais
  (CNPJ, endereço etc.) ainda só pelo banco. Suspender/reativar é do SUPERADMIN (Fase 7).
- **Inbox por polling** (5 s): simples e confiável, mas gera uma requisição por aba aberta a cada ciclo; websocket fica para quando o volume justificar.
- **Inbox mostra as 50 conversas mais recentes** do filtro (com aviso quando há mais); paginação da lista fica para depois.
- **WhatsApp validado só com simulador**: a integração real depende das credenciais da Meta (ver "Conectar um número real").
- **Mídia**: imagens, áudios, documentos e localização são registrados com um aviso ("tipo X recebido"), mas o conteúdo ainda não é baixado nem exibido. O envio é só de texto.
- **Modelos (templates)**: não há gerenciador. Fora da janela de 24h não é possível escrever ao cliente (nem a IA).
- **IA validada só com simulador**: o Claude real nunca foi chamado neste projeto; a qualidade das respostas e o custo
  real precisam ser conferidos com uma chave de verdade e conversas reais antes de ligar para clientes.
- **IA fora do horário não responde depois**: a mensagem fica para a equipe. O aviso automático de fora do expediente
  (Fase 7) segue o horário **geral** do negócio, não o da IA.
- **Base de conhecimento só com texto**: sem upload de PDF/arquivos. Bases maiores que `AI_KNOWLEDGE_MAX_CHARS` usam
  seleção por palavras em comum (palavra inteira, sem acento, singular aproximado; pode deixar de fora uma entrada
  relevante escrita com outras palavras, ex.: sinônimos).
- **Mídia e IA**: áudio, imagem e documentos vão direto para humano (a IA não interpreta).
- **Limite mensal da IA é sobre a ESTIMATIVA** (tabela de preços), não sobre a fatura. Pode ser ultrapassado no máximo
  pela diferença entre o previsto e o real das execuções em andamento. Empresas habilitadas antes da Fase 7 ficam sem
  limite até o SUPERADMIN definir um. Sem créditos extras nem cobrança.
- **Custo é estimativa**: calculado pela tabela de preços configurada; a fatura oficial é a do console da Anthropic.
- **Respostas geradas durante uma troca de modo** são pagas e descartadas (aparecem como "Descartada" no Uso).
- **Equipe**: um usuário pertence a uma empresa (regra da Fase 1); desativar alguém desativa o login dele.
- **Disponibilidade é manual**: quem fecha o navegador sem mudar para Ausente continua recebendo conversas (decisão do
  proprietário: não depende de presença). O encerramento por inatividade evita conversas presas para sempre.
- **Fila sem "pegar a próxima"**: funcionário não puxa conversa da fila manualmente; a distribuição é automática e
  OWNER/ADMIN podem atribuir pela transferência.
- **Conversas pausadas** continuam contando na vaga do responsável e ficam na fila sem serem distribuídas até reativar.
- **Mensagens automáticas** só com a janela de 24h aberta (sem modelos aprovados). Se a boas-vindas falhar e for
  reenviada depois pela retentativa, ela pode chegar depois do aviso de fora do expediente.
- **Inatividade** é verificada a cada ciclo do worker (5 s por padrão): o encerramento pode acontecer alguns segundos
  depois do prazo.
- **Envio duplicado em caso extremo**: se a API cair depois que a Meta aceitou a mensagem e antes de gravar o wamid, a retentativa pode reenviar (a Cloud API não oferece chave de idempotência).
- **Status de mensagens enviadas fora da Vortrix AI** (pelo app do WhatsApp Business ou outra ferramenta) são ignorados.
- **Busca de contatos** usa `ILIKE` (varredura); com muitos milhares de contatos por empresa, considerar índice trigram.
- **Telefone**: o 9º dígito de celulares brasileiros é tratado ao vincular mensagens recebidas a contatos existentes; contatos cadastrados à mão continuam com o número digitado.
- **Primeira execução do encerramento da IA**: conversas da IA que já estavam paradas além do prazo são encerradas no
  primeiro ciclo do worker após a atualização, com o **horário real** desse encerramento (nunca retroativo). Por isso,
  no dia da atualização, "Encerrados por inatividade" pode ter um pico com conversas antigas.
- **Mensagem ainda na fila do webhook** (recebida pela Meta, mas não processada) não é visível ao encerramento: se ele
  acontecer antes do processamento (segundos), a mensagem reabre o atendimento num ciclo novo, como se o cliente
  tivesse voltado a escrever.
- **IA desligada ou fora do horário**: conversas no modo IA sem resposta também são encerradas pelo prazo da IA (o
  critério é o modo, não se a IA respondeu); no Analytics aparecem como "sem resposta", encerradas.
- **Analytics**: dados anteriores à Fase 6 só têm o ciclo atual de cada conversa (reaberturas antigas não foram
  registradas) e não entram nas médias de tempo; consumo antigo da IA aparece como "origem não verificada".
- **Fuso da empresa**: editável pelo proprietário (Fase 7). Mudá-lo muda também o início/fim dos dias nos relatórios
  da empresa e o mês do limite da IA. O Analytics do SUPERADMIN usa sempre `America/Sao_Paulo`. Na migração da Fase 7,
  empresas que tinham escolhido outro fuso para a IA passaram a usá-lo como fuso da empresa.
- **Primeira resposta humana** usa o momento em que o funcionário enviou a mensagem (registro no sistema), mesmo que
  o WhatsApp depois a recuse.
- **Exportação**: a "situação atual" reflete o momento da geração; os números históricos usam o instante de referência
  da tela (até 24 h). Limite de exportações em memória (como o rate limit de login).
- **Custo da IA em USD**, sem conversão para reais e sem custos de infraestrutura/WhatsApp.
- **CSP parcial** (`frame-ancestors`, `base-uri`, `form-action`, `object-src`); `script-src` com nonce fica para depois.
- **Fase 7 — suspensão**: mensagens recebidas durante a suspensão são descartadas e **não** são recuperadas; uma
  mensagem já em envio no instante exato da suspensão pode sair. Os usuários precisam entrar de novo após a reativação.
- **Fase 7 — horários**: precisão de minuto; em mudanças de horário de verão, os horários seguem o relógio local.
  Não há escalas individuais nem calendários por unidade. O expediente da equipe não impede transferências manuais.
- **Fase 7 — feriados nacionais** seguem a lei federal atual (incluindo o 20 de novembro a partir de 2024); mudanças
  futuras na lei exigem atualizar `brazilianNationalHolidays`.
- **Fase 7 — logotipo no banco**: simples e consistente entre instâncias, mas aumenta o backup; sem redimensionamento.
- **Fase 7 — IA desligada pelo SUPERADMIN**: conversas no modo IA continuam sem resposta (comportamento da Fase 4);
  só a **pausa** da empresa encaminha para a equipe.
- **Fase 7 — alertas** são visuais (painel e Inbox); não há notificação externa (e-mail, push).
