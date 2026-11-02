# Integração Ampara: frontend e API nesta branch

Esta branch contém a interface React na raiz e a API .NET em `backend/`. A API foi incorporada a partir do [SESMT-backend](https://github.com/ChancellorMarko/SESMT-backend), `main` em `3352263`, conciliada com as correções do pacote único atualizado. Os endpoints nativos e as projeções de navegador usam o mesmo processo e banco.

## Preparar o ambiente

Requisitos: Node.js >=22.12, npm, SDK .NET 10 e PostgreSQL. Docker Compose é opcional para o banco.

Um único checkout desta branch contém:

```text
SESMT-frontend/
  src/                  # frontend React
  backend/
    SESMT.slnx
    SESMT.API/
    SESMT.Application/
    SESMT.Domain/
    SESMT.Infrastructure/
    SESMT.Tests/
```

Na raiz:

```sh
npm ci
npm run integration:setup
npm run integration:db
npm run integration:migrate
npm run dev:integrated
```

`integration:setup` cria configurações e credenciais locais aleatórias em `.env.integration.local`, sem sobrescrever um arquivo existente. Consulte as credenciais nesse arquivo; não o envie ao GitHub. Se já houver PostgreSQL local configurado, use-o e dispense `integration:db`. O comando de migração atualiza o banco configurado: confira o destino e faça backup antes de atualizar uma base com dados importantes.

Os comandos npm `dev:integrated`, `integration:migrate`, `integration:check-schema` e `test:backend` usam a opção `--bundled`, selecionando sempre `backend/`. Isso preserva as credenciais/banco locais e ignora somente uma localização externa antiga da API. Não é necessário outro clone nem aplicar o ZIP por cima desta pasta: as alterações já estão nos fontes.

Para selecionar deliberadamente outro checkout pela ferramenta, configure o caminho local:

```dotenv
SESMT_BACKEND_PATH=../SESMT-backend
```

O caminho pode ser absoluto ou relativo à raiz. Use `node scripts/integration.mjs dev` sem `--bundled` para respeitar essa seleção externa. O resolvedor aceita a pasta interna `backend/` sem Git próprio ou um repositório/worktree externo completo. Outras cópias internas são recusadas. A ferramenta não faz pull, merge ou checkout.

O frontend integrado abre em `http://127.0.0.1:5175/login`, a API em `http://127.0.0.1:5047` e o banco opcional em `127.0.0.1:5434`. O início imprime o diretório selecionado da API. Ctrl+C encerra os processos iniciados pelo comando, sem encerrar o banco. Portas ocupadas são informadas antes de iniciar os servidores.

O armazenamento local é convertido em caminho absoluto relativo ao frontend, conservando `.local/storage` entre reinicializações e mudanças de diretório de execução. Arquivos, configurações, backups e relatórios de teste ficam fora do versionamento.

## Contratos na mesma API

Os endpoints nativos da equipe permanecem disponíveis sob `/api/v1`. As projeções de compatibilidade da interface ficam sob `/api/v1/browser` e usam os mesmos serviços, banco e processo da API oficial.

| Operação | Endpoint |
| --- | --- |
| CSRF | `GET /api/v1/auth/csrf` |
| Login, renovação e logout | `POST /api/v1/auth/login`, `/refresh`, `/logout` |
| Identidade, permissões e escopos | `GET /api/v1/auth/me` |
| Estrutura organizacional | `GET /api/v1/browser/organization` |
| Trabalhadores, detalhe e histórico | `GET /api/v1/browser/workers`, `/{id}`, `/{id}/movements` |
| Edição profissional | `GET/PATCH /api/v1/workers/{id}/professional-profile` |
| Documentos e metadados | `GET /api/v1/browser/documents`, `/{id}`, `/{id}/versions`, `/{id}/versions/{versionId}`, `/{id}/history` |
| Tipos documentais | `GET /api/v1/browser/document-types`, `/{id}` |
| Recuperação e redefinição de senha | `POST /api/v1/auth/forgot-password`, `/reset-password` |
| Usuários | `GET/POST /api/v1/users`, `GET /users/management-context?action=criar\|editar&userId=...`, `PUT /users/{id}/access`, `PATCH /users/{id}`, `POST /users/{id}/deactivate` |
| Cadastros organizacionais | `GET /api/v1/organization-management`, `POST /companies`, `/locations`, `/departments`, `/positions` e `GET /{recurso}/{id}` para conferência |
| Notificações pessoais | `GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/read` |
| Auditoria | `GET /api/v1/audit-logs` |
| Dashboard operacional | `GET /api/v1/dashboard/summary`, `/appointments`, `/document-pendencies`, `/review-pendencies`, `/activity-evolution` |
| Agenda | `GET/POST /api/v1/appointments`, `GET /{id}`, `POST /{id}/confirm`, `/reschedule`, `/cancel`, `PUT /{id}/context` |
| Equipes (consulta nativa) | `GET /api/v1/teams?locationId=...&pageNumber=...&pageSize=10`, `GET /api/v1/teams/{id}` |
| Equipes (cadastro/edição nativos) | `GET /api/v1/teams/management-context?locationId=...&action=criar\|editar`, `POST /api/v1/teams`, `PATCH /api/v1/teams/{id}` |
| Vínculo inicial de conta | `GET/PUT /api/v1/workers/{id}/account-binding`, `GET /api/v1/workers/{id}/account-binding/candidates?q=...&page=1`, `GET /api/v1/workers/{id}/account-binding/candidates/{userId}` |
| Designações | `GET/POST /api/v1/designations`, `POST /api/v1/designations/{id}/revoke` |
| PTs (consulta nativa) | `GET /api/v1/work-permits/search`, `GET /api/v1/work-permits/{id}`, `/{id}/history`, `/{id}/eligibility`, `/{id}/declarations` |
| PTs (operação nativa) | `POST /api/v1/work-permits/{id}/release`, `/start`, `/suspend`, `/resume`, `/cancel`, `/observations` |
| PTs (checklists e encerramento) | `GET /api/v1/work-permits/pt-templates?companyId=...`, `PATCH /api/v1/work-permits/{id}/checklist`, `POST /api/v1/work-permits/{id}/complete` |
| PTs (abertura) | `GET /api/v1/work-permits`, `GET /api/v1/workers/{id}` após leitura browser autorizada, `POST /api/v1/work-permits/appointments/{id}/pt` |

`dev:integrated` seleciona explicitamente `VITE_API_MODE=api`, `VITE_AUTH_API_CONTRACT=native`, `VITE_API_BROWSER_PREFIX=/browser` e o proxy da API. Para iniciar o Vite manualmente, configure os mesmos valores e `VITE_API_BASE_URL=/api/v1`, `API_PROXY_TARGET=http://127.0.0.1:5047`. A autenticação nativa e as projeções de leitura são escolhas independentes: o prefixo browser atua somente nas consultas de organização, trabalhadores, documentos e tipos documentais. Usuários, notificações e auditoria continuam nos endpoints nativos. Esta branch inclui o backend atualizado até o merge #33 (`3352263`) e as correções locais conciliadas. O comando não busca nem incorpora novos commits automaticamente.

O JWT fica em memória. No contrato nativo, o refresh usa o cookie `sesmt_refresh`, HttpOnly, SameSite Strict, Secure, caminho `/api/v1/auth`. O cliente sincroniza CSRF e envia `X-CSRF-Token`; o refresh nativo compara o token com o cookie. HTTPS é necessário fora do loopback de desenvolvimento. Falha ao revogar logout não informa sucesso nem remove a possibilidade de nova tentativa.

O modo alternativo `VITE_AUTH_API_CONTRACT=adapter` com prefixo `/browser` conserva a sessão em `/browser/auth/*` e `/browser/me`, cujo catálogo atual contém apenas leituras de organização, trabalhadores e documentos. Para acessar os módulos nativos, utilize a configuração integrada acima. O frontend não concede acesso a partir do nome ADMIN, de claims decodificadas ou de um perfil fixo. MFA ainda depende de um desafio suportado pelo backend; não há uma etapa fictícia de verificação na interface.

### Permissões nativas e consulta de usuários

O frontend preserva as permissões recebidas e compara equivalências explícitas em `src/shared/auth/permissions.ts`: `documento:ler` permite a verificação de `documents.read`, `trabalhador:ler` permite `workers.read`, e `usuario:ler` permite `users.read`. A consulta agregada `organization.read` exige as quatro leituras `empresa:ler`, `unidade:ler`, `setor:ler` e `cargo:ler`. Não há autorização pelo nome de um perfil, por wildcard ou por tradução automática de ações. Perfis novos não precisam ser cadastrados no frontend. Permissões de recursos novos são preservadas para comparação exata, mas uma funcionalidade nova precisa de uma tela e de um contrato próprios.

O catálogo `PERMISSIONS`/`ROLES` descreve os valores nativos conhecidos para autocomplete e conferência de contrato. `isPermission` e `isRole` classificam esse catálogo; não devem filtrar a identidade nem recusar concessões futuras retornadas pela API. O controle das telas usa `can()`, que também reconhece as capacidades específicas do frontend e as equivalências documentadas acima.

A capacidade `users.read` abre `GET /api/v1/users`, consumindo diretamente `{ id, name, email, roles, scopeIds, active }`. Busca e paginação são locais sobre a lista autorizada. `usuario:criar` habilita cadastro; `usuario:editar`, identificação e acessos; `usuario:excluir`, a confirmação de desativação. O formulário de identificação envia somente nome/e-mail, com limite de 200 caracteres conforme o banco. `usuario:ler` não concede `users.manage`.

`GET /users/management-context?action=criar` publica perfis ativos e locais delegáveis. Na edição, `action=editar&userId={id}` inclui a conta consultada e `accessVersion`. O servidor confere a ação efetiva, a conta ativa, todos os escopos do destino e a hierarquia ativa. Somente um vínculo ADMIN global com a permissão solicitada concede administração global. A existência de uma permissão no catálogo ou um papel customizado sem empresa não concede esse acesso. A política atual permite atribuir perfis customizados ativos dentro dos escopos autorizados; a interface conserva seus códigos exatos.

`POST /users` recebe nome, e-mail, perfis e locais. A senha inicial não é informada, retornada ou guardada no navegador: o cadastro gera um segredo impraticável e a pessoa deve usar “Esqueci minha senha”. Isso exige o serviço de e-mail configurado; criar a conta não significa que uma mensagem foi enviada. Convites e entrega de primeiro acesso continuam separados.

`PUT /users/{id}/access` recebe `{ roles, scopeIds, expectedVersion, confirmation: true }`. Uma transação substitui os dois conjuntos juntos, associa os perfis às empresas dos novos locais e registra auditoria com o alcance anterior e posterior. O token de versão corresponde aos vínculos consultados; duas edições da mesma versão resultam em uma gravação e um conflito. As rotas legadas de perfis/escopos compartilham a trava de conta. O formulário protege a própria conta e contas com concessões globais, preserva alterações em conflitos e bloqueia repetição de um resultado ambíguo. Confere o recibo e relê a lista antes de confirmar sucesso. A pessoa afetada deve entrar novamente. Os novos eventos manuais de usuários usam o JSON normalizado pelo PostgreSQL antes do hash, sem reescrever eventos históricos.

`/auth/me` usa o mesmo leitor de hierarquia dos recursos nativos. Escopo de empresa inclui unidades/setores ativos; escopo de unidade/setor inclui os ancestrais necessários aos seletores, sem conceder gestão da empresa inteira. O trabalhador conserva somente sua localização e `ownOnly`; ausência de vínculo verificável falha com `WORKSPACE_UNAVAILABLE`. O login escolhe o destino pelas capacidades: administração de usuários → contas; operação de PT → dashboard; gestão de trabalhadores → trabalhadores; auditoria → auditoria; consulta documental → documentos. Nomes de cargo não concedem direitos.

### Cadastros organizacionais nativos

`GET /organization-management` oferece empresas, unidades, setores e cargos autorizados, com capacidades específicas de criação. Funciona em uma instalação vazia para que o administrador global cadastre a primeira empresa. A tela nativa usa tabelas compactas e somente esses quatro recursos; os cadastros adicionais da demonstração não são apresentados como integrações prontas.

Criação usa `POST /companies`, `/locations`, `/departments` e `/positions` com os DTOs nativos. Empresa exige administração global; unidade/cargo exigem alcance da empresa inteira; setor exige alcance da unidade inteira. O contexto é relido antes do comando; o recibo e o recurso persistido são conferidos depois. Empresa/unidade novas atualizam a sessão para recompor os seletores. Não há edição/desativação organizacional nesta tela. Formulários legados não são enviados a essas rotas.

Para preparar uma instalação: entre com o administrador de bootstrap, abra Organização, cadastre empresa/unidade e os setores/cargos necessários; em Usuários e acesso, crie as contas e atribua perfis/locais; em Trabalhadores, cadastre os vínculos profissionais e associe as contas. Funções operacionais de PT também dependem de designações, vigência e requisitos; um cargo por si só não libera trabalho.

`alerta:ler` habilita notificações pessoais: `GET /notifications` retorna `{ items }`, sem paginação ou filtros de unidade. Filtros de leitura e paginação da tela são locais. Marcar como lida usa POST, espera 204 e relê os avisos para atualizar também o sino; não inventa `readAt` nem resolve a pendência. O DTO não informa unidade/tipo de recurso suficiente para links genéricos, portanto a tela apresenta os identificadores nos detalhes sem inventar destinos. Uma recusa oculta conteúdo e contador até uma nova consulta autorizada.

`auditoria:ler` habilita a tela nativa para `/audit-logs`, com `pageNumber`, `pageSize`, `action`, `resourceType`, `from` e `to`. A API também exige os perfis ADMIN ou AUDITOR. Não se envia `unitId`, nem se consulta um catálogo inexistente de ações. Datas dos filtros são dias UTC; horários visíveis são de Brasília. Respostas, páginas e correspondência dos filtros são verificadas antes de mostrar os registros. Identificadores nulos permanecem explicitamente não informados. Os detalhes mostram somente os campos públicos retornados, sem deduzir nomes de pessoas.

Com `VITE_API_BROWSER_PREFIX=` vazio, documentos, trabalhadores e organização retornam os DTOs nativos, ainda diferentes dos dessas telas. Reconhecer uma permissão não converte o formato dos dados. Prefira a projeção publicada para essas consultas. No contrato nativo, o dashboard autenticado é o destino de retorno quando não há outro módulo inicial reconhecido; nos demais contratos, a ausência de destino continua levando à conta conectada.

### Dashboard operacional nativo

O administrador global agora consulta atividades e pendências das empresas ativas com a concessão efetiva `pt:ler`. O vínculo global ADMIN e a ação são conferidos no banco; o rótulo do token não concede acesso. A mesma verificação recompõe o escopo de consulta das PTs e dos documentos administrativos. As proteções de documentos médicos/restritos permanecem aplicadas. Leitura administrativa não concede papel operacional, designação ou liberação.

No contrato `native`, `/app/dashboard` usa exclusivamente os cinco endpoints de dashboard listados acima. `DashboardController` exige autenticação, e `DashboardRepository` decide quais atividades, PTs e designações o ator pode consultar. A navegação espelha essa política, sem inventar `dashboard.read`, atribuir perfil ADMIN ou liberar os comandos de agenda/PT. O contrato da demonstração conserva seus controles e endpoints próprios. Inspeções, saúde e EPIs do dashboard antigo não são exibidos como módulos integrados nessa tela.

O período padrão cobre doze meses civis, terminando no último dia do mês atual em UTC. As cinco consultas recebem os mesmos `from`/`to` UTC; o limite de 36 meses da série histórica é validado antes do envio. Por padrão a abrangência é a conta. Escolher “Unidade selecionada” envia o UUID da unidade como `localId` (o backend usa Units para esses locais); trocar a unidade recompõe o contexto e cancela a consulta anterior. Não são enviados `unitId`, filtros textuais de local ou opções do contrato legado. Os parâmetros de URL aceitos são `from`, `to` e `scope=account|unit`; outros critérios precisam ser limpos, em vez de serem ignorados silenciosamente.

Indicadores e listas são exibidos apenas após validar o conjunto das cinco respostas. Recusas e dados incompatíveis ocultam os indicadores e registros anteriores; erros não viram zeros. Cada endpoint realiza sua própria leitura, então os totais não são artificialmente igualados entre consultas de instantes distintos. Atividades são filtradas pela data de início; requisitos, pela criação da PT; revisões, pelo encerramento. O gráfico contabiliza transições de estado, não PTs únicas. Seu detalhamento mensal em tabela é acessível por teclado.

Os requisitos são somados como requisitos faltantes, sem inventar número de trabalhadores ou arquivos. Identificadores e metadados ficam nos detalhes; não são criados códigos ou nomes ausentes nos DTOs, nem links para telas de agenda/PT com contratos ainda diferentes. O retorno vazio informa somente a ausência de registros consultados, sem declarar conformidade.

Limite atual da API: o repositório calcula empresas autorizadas a partir de UserScopes EMPRESA e não aplica nessa consulta o fallback global de `/auth/me`. ADMIN sem esses escopos, ou conta com somente escopo UNIDADE/SETOR, pode receber um conjunto vazio. Um `localId` fora de AllowedLocalIds recebe 403, inclusive quando a identidade lista a unidade. A interface respeita esses retornos; a revisão da política efetiva pertence ao backend.

### Agenda, equipes e designações nativas

As telas nativas têm DTOs próprios. Agenda usa `version`, `expectedVersion`, `REQUESTED/CONFIRMED/CANCELLED` e histórico Before/After; não envia `revision`, ETag ou estados da demonstração. A lista aceita `q`, `status`, `companyId`, `from`, `to`, `page` e `pageSize`; a API filtra sobreposição de intervalos, não somente a data de início. O fim do dia escolhido vira o início do dia UTC seguinte, exclusivo. O contexto da consulta é o da conta, sem filtro fictício de unidade sobre uma página parcialmente carregada.

Consulta, detalhe e retorno à lista preservam os filtros válidos. Solicitação de agendamento e configuração de equipe/participantes usam catálogos consultados na API: organização browser, equipes verificadas, serviços nativos e trabalhadores. Participantes são Worker.Id; responsável da confirmação é User.Id, vindo da consulta nativa de usuários. A confirmação continua dependendo de designação, período e capacidade no servidor. Alteração de contexto usa PUT e não troca empresa, local, título ou datas. Reagendamento exige motivo e período futuro em Brasília, convertido para UTC. Cancelamento exige motivo; a API recusa alterações quando já existe PT vinculada.

As entradas de consulta de agenda e designações permitem solicitar a leitura autenticada e respeitam as recusas específicas dos serviços. A interface não reconhece CONFIG/ADMIN por nome para conceder comandos: criação de agendamento exige `pt:criar`; gestão da agenda e criação/revogação de designações exigem `pt:editar`, além das consultas necessárias aos seletores. A API ainda exige os vínculos operacionais por empresa. O seeder atual não associa RolePermission aos quatro perfis SESMT_PT_*; alinhar essa política ou fornecer ações efetivas é trabalho da API. Permissões da sessão não são preenchidas pelo frontend.

Equipe exige `equipe:ler`, unidade explícita e empresas da identidade. A lista nativa é um array sem total nem contexto; cada detalhe é conferido por ID, empresa, local, estado e coerência com o resumo antes de mostrar a página. A paginação apresenta somente a página e a quantidade recebida; não inventa um total geral. A tabela compacta oferece cadastro/edição apenas com os grants explícitos `equipe:criar`/`equipe:editar`, leitura de trabalhadores e escopo que não seja próprio. Não se usa o formulário legado por um acesso direto à URL.

O formulário consulta `/teams/management-context` para a unidade e ação autorizadas. Empresa, local, nomes e raiz organizacional vêm do servidor: Company.OrganizationId quando configurada, ou Company.Id para empresa independente, sem criar UUIDs no navegador. Não há agregado/tabela Organization nesse contrato; os agrupamentos antigos não são reescritos. Chefe e participantes são Worker.Id selecionados no catálogo ativo, com busca/paginação. Pessoas já vinculadas em outra unidade da mesma empresa são preservadas quando autorizadas. Trocar o chefe não inclui automaticamente o anterior como participante. Alterar uma equipe não libera trabalhadores nem reescreve agendas ou PTs existentes.

Antes de gravar, a interface relê o contexto, a equipe original e cada vínculo selecionado. O POST envia empresa, local, organização, nome, descrição, chefe e participantes. O PATCH preserva empresa/local/organização, envia `expectedVersion` igual a `version` carregada e usa `clearDescription: true` para limpar uma descrição; omitir a descrição conserva a existente. A API exige revisão positiva, compara a precondição e usa CAS no PostgreSQL. Conflito obsoleto/concomitante recebe 409; ausência de revisão recebe 400. Vínculos encerrados são recusados também no servidor. O frontend confere o recibo e a leitura persistida, mantém o preenchimento em conflito/resultado ambíguo e não repete gravações automaticamente. O retorno à lista conserva a página na mesma sessão/unidade.

A migration `20261102014333_AddTeamOptimisticConcurrency` do mesmo pacote deve ser aplicada antes desse fluxo. Adiciona somente `core.equipe.versao`, com valor inicial 1 e token de concorrência, preservando os registros. Leituras antigas sem revisão continuam compatíveis, mas não recebem a ação de editar. Desativação de equipe permanece fora desta integração; seu fluxo ainda precisa fechar precondições e impactos.

Designações usam PersonId=Worker.Id, ServiceIds, LocationIds, Type (`atender/liberar/revisar/conferir`), vigência UTC, Origin e expectedVersion para revogar. A lista completa autorizada permite filtro/paginação locais sem enviar parâmetros que a rota não aceita. O detalhe é encontrado nessa lista; não se chama GET /designations/{id}, que não existe. “Não revogada” não é apresentado como autorização automática de uma operação fora de vigência.

Os editores mantêm a versão existente na abertura, mesmo se ocorrer nova leitura em segundo plano. Conflitos preservam o preenchimento e bloqueiam reenvio até atualizar; o frontend não incrementa a versão para tentar sobrescrever dados. Respostas incompatíveis e falhas de conclusão ambígua também bloqueiam repetição automática. Sucesso exige conferir os campos retornados e reler as consultas relacionadas, incluindo o dashboard. Testes com HTTP controlado não homologam a autorização, persistência ou idempotência da API real.

### Permissões de trabalho nativas

Contas de trabalhador com acesso próprio têm filtro obrigatório por autoria/participação antes da contagem e paginação da busca. Consulta direta, histórico e elegibilidade também recusam PTs de terceiros com 404. Um filtro `participantUserId` informado na URL não amplia esse alcance. A política usa os vínculos ativos do banco e não os papéis enviados no JWT.

A lista usa GET `/work-permits/search`, paginação real e filtros de título/serviço, estado, empresa, local, participante e período de sobreposição do agendamento. `locationId` é o filtro nativo opcional de unidade, não `unitId`; as datas da busca são dias UTC, incluindo o dia final. O detalhe usa WorkPermitResponse, com estados portugueses, Version e ContentVersion distintos, participantes por User.Id e modelos fixados por ID de versão. O retorno à lista preserva somente consultas internas válidas. Atalhos das filas do dashboard levam à PT ou ao agendamento nativo correspondente.

Histórico, elegibilidade e declarações são consultas independentes verificadas. Declarações precisam corresponder à PT, versões de registro/conteúdo, agendamento e conjunto de modelos fixados. Elegibilidade é uma avaliação administrativa do servidor, não um cálculo local nem uma confirmação automática de liberação. Ela não fornece versão no DTO atual; o comando continua reavaliando os requisitos no servidor. A interface não cria uma avaliação positiva quando a consulta falha.

Liberação, início, suspensão, retomada, cancelamento e observações enviam expectedVersion da abertura do editor. A janela de liberação usa Brasília na entrada e UTC na API, precisa estar contida no agendamento e exige confirmação explícita. Ações dependem dos grants explícitos `pt:liberar`, `pt:iniciar` ou `pt:editar`, do estado recebido e das regras do servidor; perfis por nome não concedem direitos na interface. Os comandos de liberação/início/retomada ficam indisponíveis enquanto a elegibilidade é desconhecida ou pendente. Conflitos, respostas incompatíveis e resultados ambíguos preservam o preenchimento e bloqueiam repetição automática. Sucesso exige resposta compatível e atualização das consultas relacionadas.

Os checklists são carregados sob demanda por `GET /work-permits/pts/{id}`, usando `pinnedTemplates` e os IDs exatos das versões fixadas. O recibo deve corresponder ao ID, versão, estados e participantes da PT consultada. Isso permite ler as perguntas sem acesso ao catálogo administrativo. Somente um recibo antigo válido, sem a propriedade `pinnedTemplates`, permite consultar o catálogo como compatibilidade; recusa, propriedade nula ou resposta inconsistente bloqueiam essa alternativa. Uma versão nova não substitui a fixada. Perguntas BOOLEAN, TEXT e NUMBER mantêm IDs e metadados recebidos, sem inventar NA. Respostas, justificativas e ausência de resposta são distintas. O preenchimento de abertura pode ser salvo parcialmente com PATCH/expectedVersion; não libera a operação e incrementa a versão de conteúdo, exigindo atualização das ciências conforme o backend. A propriedade nova depende da aplicação do pacote de correções do backend de 01/11/2026.

Valores NUMBER são preservados como strings decimais, sem arredondamento por Number do JavaScript. Entrada aceita ponto/vírgula decimal sem separador de milhar, valida o alcance de decimal .NET e envia cultura invariável. Respostas já armazenadas são lidas na cultura invariável da API. Os editores preservam a versão da abertura e o rascunho em conflitos, mesmo com nova leitura da PT em segundo plano.

Encerramento depende de verificações presentes em todos os modelos fixados, grant explícito `pt:concluir`, estado EM_EXECUCAO e autorização final da API. Exige as respostas obrigatórias, recusa respostas impeditivas e valida resumo, confirmação local e término efetivo em Brasília entre StartedAt e o instante atual. O corpo de POST /complete usa Summary, ActualEnd UTC e ClosingAnswers, sem campos da demonstração. A resposta precisa confirmar incremento de Version, manutenção de ContentVersion, CONCLUIDA e AGUARDANDO_REVISAO; conclusão não é aprovação da revisão.

O término efetivo aceita minutos ou segundos e preserva essa precisão na conversão para UTC, inclusive em serviço encerrado dentro do mesmo minuto de StartedAt. Calendário inválido, ano zero, segundos fora do intervalo e sufixos de fuso em uma entrada local são recusados.

A abertura fica disponível no agendamento confirmado com `pt:criar` e consulta de trabalhadores. Os modelos são escolhidos explicitamente, com uma versão por modelo, cobertura exata dos serviços e verificações de encerramento. O frontend consulta os IDs dos participantes na projeção browser antes de qualquer leitura do DTO nativo. A leitura especializada `readNativeWorker` aceita apenas um GUID e GET no contrato de autenticação nativo, com `cache: no-store` e preservação do ciclo de sessão/cancelamento; as consultas normais de trabalhadores continuam na projeção browser. Somente o vínculo Worker.Id/User.Id, nome e matrícula necessários à abertura chegam ao cache de consultas da interface, sem CPF/data de nascimento do DTO nativo.

GET /work-permits verifica registro existente e evita segunda criação. Antes do POST, a interface relê a agenda, os vínculos e os modelos, preservando a seleção se houver mudança. O corpo usa `expectedAppointmentVersion`, `templateVersoes: [{templateId, versao}]` e `participanteIds: User.Id[]`; IDs de versão não substituem TemplateId e IDs de trabalhador não substituem os de usuário. O recibo português, os conjuntos de serviços/participantes/modelos e o registro persistido são conferidos, incluindo a relação com o agendamento. A navegação mantém o retorno agenda → PT → agendamento → lista com filtros. Abertura não libera execução; erro ambíguo não provoca repetição automática.

A API desta branch inclui autorização dos recursos nativos e `expectedAppointmentVersion`, além de verificar agenda confirmada, serviços/modelos e os vínculos reais Worker/User em transação. O cadastro e a edição profissional de trabalhadores estão integrados conforme descrito abaixo; transferências entre unidades e mudanças nas datas do vínculo continuam com fluxos próprios pendentes. O índice único de AppointmentId em WorkPermitConfiguration também deve estar aplicado no banco utilizado pela implantação.

A ciência individual está integrada para o participante autenticado durante EM_VERIFICACAO. Exige a resposta completa de `/work-permits/{id}/declarations` com `canonicalContent`, `contentHash`, `templateId` e contexto incluindo `teamId`, disponibilizada no pacote de correções do backend. O frontend confere a correspondência semântica do conteúdo integral com as declarações/contexto; o hash é uma precondição opaca fornecida e verificada pelo servidor. Após nome e confirmação explícita, relê a PT e as declarações e envia POST `/acknowledge` com `expectedVersion`, `contentVersion`, `participantUserId` da própria sessão, `confirmedName`, `identificationMethod`, `confirmation` e `contentHash`. Confere o recibo e o registro persistido, sem repetição automática ou suposição de idempotência. Não coleta ciência de terceiros, não libera a atividade e não reutiliza assinaturas/snapshots da demonstração. A impressão completa/PDF e a decisão da revisão final continuam sem contrato integrado; a URL antiga de impressão informa indisponibilidade.

As leituras da PT usam empresas explícitas de UserScopes EMPRESA. Não implementam automaticamente os escopos UNIDADE/SETOR/ownOnly ou o fallback global de /auth/me; essa política deve ser homologada/alinhada pela equipe do backend, antes de afirmar isolamento por esses critérios. Testes com HTTP controlado não validam autorização, persistência ou regras da API/banco reais.

A projeção documental também aplica a política de acesso nativa, além dos escopos de empresa, unidade, setor e vínculo próprio. Dados restritos/médicos não são expostos por essa projeção. DTOs de leitura usam `sourceReadOnly: true` e `revision: null`; dados ausentes não são inventados. A lista conserva essa projeção, seus filtros e os retornos por trabalhador, consulta central, vencimentos e painel documental. Os comandos abaixo usam DTOs nativos próprios, sem aproveitar a revisão nula da projeção.

### Documentos: cadastro, arquivos e conferência nativos

No contrato native, `documento:criar` permite o cadastro geral com unidade/setor autorizados, tipo ativo, código, título, emissão, validade e classificação Pública/Interna. O catálogo vem de `/document-types` e `/document-types/{id}`. Tipos Restrito/Medico ou com campos obrigatórios em `metadataSchema.required` aguardam formulários específicos; não são cadastrados com metadados fictícios. Um tipo Interno não pode ser reduzido a Público. A criação usa POST `/documents`, `ownerId` da sessão, `personId` opcional como Worker.Id e `links: []`. A seleção opcional de trabalhador verifica vínculo, situação e unidade/setor antes do comando; a origem pelo trabalhador é preservada e confirmada na projeção após salvar. O cadastro é relido antes de navegar e permanece RASCUNHO/sem arquivo.

O detalhe consulta `/documents/{id}`, `/versions`, `/document-types/{id}` e `/documents/file-policy` com o transporte nativo autenticado, sem prefixo browser. Valida revisão, empresa/unidade/setor, número de versão, estados, IDs e hashes. `documento:editar` habilita anexar uma versão; documentos médicos também exigem `aso:editar`. O upload usa FormData com `file`, `expectedVersion` igual a Document.Revision e observação opcional; não envia autor arbitrário. Limite, MIME e extensão vêm da política, com teto de 50 MiB. O SHA-256 calculado no navegador deve corresponder ao recibo. A confirmação exige revisão incrementada, EM_REVISAO e versão ainda não vigente. Nenhum envio libera o trabalhador ou a PT.

`documento:aprovar` habilita a decisão da versão atual em conferência, sujeita à designação/concessão específica verificada pelo servidor. O frontend relê o registro e as versões e envia POST `/documents/{id}/versions/{versionId}/review` com `{ expectedVersion: Document.Revision, version: versionNumber, decision: 'aceita' | 'reprovada', reason }`. Reprovação exige motivo e ambas as decisões exigem confirmação explícita. O recibo, ator, hash, estado, revisão e registro persistido são conferidos. Tipos com `requiresSignature` não permitem aceite enquanto não houver comprovação implementada; reprovação permanece disponível. O pacote atualizado aplica essa recusa no serviço e na transação de publicação, protegendo a regra do tipo por bloqueio compartilhado até o commit. A elegibilidade também recusa evidências antigas publicadas desse tipo, com `ASSINATURA_PENDENTE`. Isso não implementa uma assinatura nem trata ciência/nome digitado como comprovação.

`documento:editar` permite editar título, descrição, emissão e validade de RASCUNHO/EM_REVISAO. Para documentos médicos também é necessário `aso:editar`, além da autorização do servidor. O editor relê o documento antes de PATCH `/documents/{id}` e envia `expectedVersion: Document.Revision`, preservando classificação, palavras-chave e Metadata JSON existentes. O servidor exige revisão positiva, confere a precondição e usa o token de concorrência de Document.Revision no PostgreSQL. Atualização obsoleta/concomitante recebe 409, sem sobrescrever a vencedora; revisão ausente recebe 400. O frontend confere incremento da revisão, campos alterados, manutenção de estado/versão/contexto e o registro persistido. Um conflito mantém o preenchimento e bloqueia repetição até atualizar. Documentos vigentes não recebem edição direta de dados nesse fluxo. O schema JSON específico permanece fora deste editor.

O download usa GET autenticado `/documents/{id}/versions/{versionId}/download`, sem URL externa ou redirecionamento. O transporte preserva renovação da sessão, cancelamento e `no-store`; limita bytes durante a leitura e rejeita arquivos vazios, truncados ou de MIME inesperado. Antes de oferecer o arquivo, compara SHA-256 com o da versão consultada. Usa Blob URL temporária com revogação. Falta de acesso oculta os dados anteriores. A verificação criptográfica exige um contexto seguro do navegador, como localhost.

`pt:editar` permite escolher uma PT EM_VERIFICACAO da mesma empresa pela busca nativa e vincular o documento por POST `/work-permits/{id}/documents` com `{ documentId, expectedVersion }`. O frontend relê documento/PT, exige confirmação, espera 204 e confere incremento de Version e ContentVersion no registro persistido. O vínculo exige nova ciência e reavaliação dos requisitos; não corresponde a uma liberação. Conflitos e resultados ambíguos preservam os formulários e bloqueiam repetição automática em todos esses comandos.

Esses fluxos foram verificados com contratos HTTP controlados. A homologação com a API real, PostgreSQL, armazenamento, concessões/designações e contas de escopos distintos continua necessária antes do uso com dados reais; builds e testes do frontend não comprovam essas condições.

### Cadastro inicial nativo de trabalhadores

`trabalhador:criar`, leitura de trabalhadores e consulta da organização habilitam `/app/trabalhadores/novo`. A unidade é a selecionada no contexto; empresa, setores e cargos vêm do catálogo autorizado e são conferidos novamente antes do comando. O formulário coleta nome, matrícula, CPF, nascimento e admissão, com setor/cargo opcionais. Normaliza o nome, valida dígitos do CPF e datas e envia POST `/workers` com o DTO nativo: `companyId`, `unitId`, `departmentId`, `positionId`, `name`, `enrollment`, `cpf`, `dateOfBirth`, `admissionDate`, `dismissalDate: null`, `userId: null`. Não usa os campos de contratação/gestor da demonstração nem cria uma conta implícita. O vínculo inicial com uma conta existente usa o fluxo separado descrito a seguir.

O transporte mantém autenticação/cancelamento, sem prefixo browser nem idempotência presumida. O recibo nativo precisa confirmar todos os dados e o CPF mascarado; somente o ID é retido, sem colocar CPF/nascimento no cache de consultas. Antes de navegar ao detalhe, o frontend verifica o perfil persistido pela projeção browser, que não contém esses campos de identidade. A navegação conserva a origem da lista na mesma sessão/unidade. Resposta incompatível, recusa de acesso ou resultado ambíguo não causam repetição automática do POST. A autorização, criptografia, unicidade e persistência continuam no backend; o pacote corrige o acesso nativo utilizado por este fluxo.

### Edição profissional sem dados pessoais adicionais

`GET /workers/{id}/professional-profile` exige leitura e edição de trabalhadores no escopo atual e oferece matrícula, nome, cargo, setor, unidade e revisão, com catálogos mínimos de cargos e setores autorizados. Não retorna CPF, nascimento, informações clínicas ou dados de outra empresa. A ficha nativa oferece o acesso ao editor com `trabalhador:editar`; não concede a capacidade legada `workers.write` para isso.

`PATCH` recebe `{ name, enrollment, departmentId, positionId, reason, expectedRevision, confirmation }`. Preserva CPF criptografado, nascimento, admissão, desligamento, unidade e conta vinculada. A mudança de cargo/setor exige ambos os campos válidos, fecha o histórico profissional anterior e abre um registro com o motivo. Histórico inconsistente, escopo insuficiente, matrícula duplicada e revisão obsoleta impedem a alteração. Worker.Revision protege contra edição simultânea e vínculo concorrente de conta; a transação mantém cadastro, histórico e auditoria juntos. O evento `PROFESSIONAL_PROFILE_UPDATED` usa JSON normalizado pelo PostgreSQL e sua integridade foi conferida após reler a linha.

O editor relê o contexto antes de gravar, confere recibo e leitura persistida e conserva a origem da ficha/lista. Resultados ambíguos e conflitos bloqueiam repetição automática. Esse fluxo não transfere pessoas entre unidades, não altera datas do vínculo e não libera execução de PT.

### Vínculo inicial entre trabalhador e conta

A ação **Conta de acesso**, na ficha nativa, abre `/app/trabalhadores/{id}/conta`. Requer leitura/edição de trabalhadores, `usuario:ler`, `usuario:editar` e escopo diferente de próprio. A API exige ainda alcance integral sobre a empresa do trabalhador; permissão de editar somente uma unidade não autoriza associar identidades. A consulta mínima retorna WorkerId, empresa/unidade, nome, matrícula, Revision, estado do vínculo e UserId, sem CPF/nascimento. A projeção browser profissional continua separada.

O catálogo paginado contém contas ativas, com associação vigente à empresa por perfil ativo ou escopo válido e sem outro trabalhador não excluído vinculado. A busca permite nome/e-mail e a consulta individual confere a conta selecionada. A associação não cria usuário, senha, perfil ou concessão; a matriz operacional da conta continua necessária. A confirmação exige que o administrador confira que a conta pertence à pessoa correta.

Antes de PUT, a interface relê trabalhador e conta e preserva a revisão e a identidade apresentadas. Envia `expectedVersion: Worker.Revision`, `userId`, `expectedAccountName`, `expectedAccountEmail` e `confirmation: true`. O servidor recusa trabalhador desligado, conta indisponível, revisão antiga, identidade alterada e trabalhador já associado. Não substitui/desvincula uma conta existente. A transação mantém a conta bloqueada contra alteração/desativação até o commit; Worker.Revision e o índice único parcial de UserId protegem as disputas de gravação, incluindo o caminho de criação anterior. O comando grava ACCOUNT_LINKED com ator, empresa, versões e IDs, sem CPF, na mesma transação. Os JSON desse evento usam a representação jsonb do PostgreSQL antes do hash, permitindo conferir a integridade após reler o registro.

A interface confere recibo e leitura persistida, retorna à ficha conservando a origem da lista e invalida o contexto de abertura de PT. Erro/conflito/resposta perdida mantém a seleção e bloqueia repetição automática do PUT. O titular deve entrar novamente para atualizar sua identificação. Associar a conta não altera participantes/ciências de PTs existentes nem libera trabalho.

A migration `20261102020948_AddWorkerAccountBindingConcurrency` acrescenta `core.trabalhador.revisao`, inicial 1, e o índice único `ux_trabalhador_usuario_vinculado` para contas em trabalhadores não excluídos. Alterações profissionais e de vínculo incrementam a revisão. Se houver UserIds duplicados históricos, a migração para com mensagem de revisão administrativa, preservando os registros. Não escolhe um titular nem apaga dados automaticamente. Transferência entre unidades, mudança das datas do vínculo e troca/desvinculação de conta permanecem com fluxos próprios pendentes.

## Banco existente e validação

O backend conciliado desta branch, com a inicial consolidada mais recente, gestão nativa de acessos e edição profissional, passou por build Release e pelos 448 testes, sem falhas ou testes ignorados, incluindo testes relacionais com PostgreSQL 17.11 descartável. A fixture aplicou as migrations e validou o schema em uma base exclusiva de QA. As migrações de revisão da equipe e do trabalhador foram testadas com downgrade/upgrade e preservação dos registros. Duplicidade histórica de conta impede a nova migration sem descartar os vínculos. Disputas entre editores e entre contas/trabalhadores não sobrescrevem o vencedor. Os testes também verificam a carga idempotente de exemplos, leitura administrativa global e isolamento das PTs do trabalhador. Esses testes não homologam a configuração de implantação ou as contas/dados reais da equipe.

A equipe consolidou o histórico anterior em `20261101172752_InitialCreate`. A cadeia desta branch é essa inicial, seguida de `20261102014333_AddTeamOptimisticConcurrency` e `20261102020948_AddWorkerAccountBindingConcurrency`. A instalação em banco vazio foi testada. Uma base já preenchida que possua IDs antigos em `__EFMigrationsHistory` não reconhece automaticamente a nova inicial como aplicada: é necessário comparar o schema e conciliar o baseline de forma administrativa após backup, antes de executar `integration:migrate`. Preserve tabelas, dados e histórico; não use uma recriação do banco como correção automática.

Para identificar o histórico de um banco existente, a equipe pode executar a consulta somente de leitura `SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";`. A confirmação de equivalência do schema e o procedimento de baseline dependem desse banco. Nenhum banco operacional é modificado pela montagem ou pelos testes desta branch.

```sh
npm run test:integration-tools
npm run integration:check-schema
npm run test:backend
npm run integration:smoke
npm run build
```

`test:backend` executa os testes da solução em `backend/`. Os cenários PostgreSQL exigem `SESMT_TEST_POSTGRES_ADMIN` apontando para o banco de manutenção `postgres` de uma instância local; cada fixture cria e remove apenas sua própria base isolada. Sem essa variável, esses cenários são explicitamente ignorados. `integration:smoke` exige os servidores integrados ativos e verifica sessão real pelo proxy; não usa MSW. Testes de navegador com respostas controladas são verificações de contrato, não substituem a integração real.

Para validar o frontend localmente, execute `npm test`, `npm run test:connection-ui` e `npm run build` em sequência. Reservar os recursos da máquina para cada etapa evita que a execução conjunta de navegador/build faça testes de interação excederem seus limites, sem precisar alterar as verificações ou os tempos dos testes.

A entrega de cadastros/acessos e edição profissional passou pelos 3.657 testes do frontend e build. A suíte de navegador com HTTP controlado contém 70 cenários. O teste real descrito abaixo passou por 29 verificações em base descartável, incluindo a edição profissional pela interface e a leitura posterior do cadastro. As fixtures de módulos usam uma concessão explícita de administração de usuários para manter a tela de preparação estável; os destinos por cargo são conferidos separadamente com contas reais e não são presumidos pelo nome ADMIN.

### Verificação real de cadastros e cargos

`npm run test:access:real` compila a API e verifica o fluxo navegador → API → PostgreSQL sem interceptação de requisições. Exige `.env.integration.local`, o cluster local em `127.0.0.1:5434`, SDK .NET, ferramentas PostgreSQL (`createdb`, `psql`, `dropdb`) e Chrome/Chromium. Defina `PG_BIN_DIR` se as ferramentas não estiverem no PATH; no Windows a instalação portátil em `.local/tools/postgresql-17.11/pgsql/bin` é reconhecida. `PLAYWRIGHT_CHANNEL` seleciona outro canal de navegador.

O teste usa somente uma base nova `ampara_uiqa_{identificador}`, com credenciais de QA e e-mail externo desabilitado. Usa as portas exclusivas 5059/5185, confere se estão disponíveis e remove apenas sua base ao finalizar. Não aplica migrations nem cria contas no banco configurado da equipe. Os registros, relatórios e capturas ficam em `.local/access-ui-qa`, fora do Git.

Os cenários incluem empresa → unidade → setor/cargo → usuário → alteração atômica de acessos, além de login de gestor, técnico, RH, auditor, médico e trabalhador vinculado. Também verificam bloqueio de cadastro administrativo na tela e por chamada direta à API, atualização dos seletores e largura de 390px. As senhas desses cenários são preparadas apenas no banco descartável; a entrega real de primeiro acesso por SMTP não é homologada por esse teste. A existência de um destino para médico/trabalhador não representa integração completa de ASO, EPI, AT ou PET.

### Dados de exemplo no banco local

`npm run seed:local-examples` usa a prévia identificada em `.local/fullstack-preview/credentials.json` ou, se esse arquivo não existir, o banco de prévia explicitamente configurado em `.env.integration.local`. O comando exige o cluster local `127.0.0.1:5434`, Development e nome `ampara_fullstack_preview_AAAAMMDD`. O banco deve estar criado e migrado. Ele não usa automaticamente o banco original `ampara_integration`. As ferramentas PostgreSQL precisam estar no PATH, em `PG_BIN_DIR` ou na instalação portátil local.

Antes da carga, gera um `pg_dump` em `.local/backups`. Um comando exclusivo de desenvolvimento da API (`SESMT_SEED_EXAMPLES=1`) executa a carga em transação com trava de concorrência. A inicialização normal não chama esse comando. Há verificações de ambiente, loopback, nome do banco, administrador responsável, colisões e identidade do conjunto reservado.

O conjunto contém uma empresa EXEMPLO, duas unidades/setores, oito cargos, oito contas vinculadas a trabalhadores, duas equipes, oito documentos administrativos em rascunho, dois modelos ilustrativos, seis agendamentos, três PTs em verificação e designações/notificações para explorar a operação. Os CPFs são dados sintéticos protegidos pelo mesmo serviço de criptografia; não entram no relatório. Não há exames, aptidões, assinaturas, ciências ou evidências aprovadas fabricadas. As PTs conservam requisitos pendentes e não são liberadas pela carga.

Os acessos estão em `.local/fullstack-preview/example-access.json`: administrador, gestor, técnico, bombeiro, RH, auditor, médico e trabalhador, todos com e-mails `@exemplo.ampara.local`. A senha é gerada localmente, persistida em arquivo privado e aplicada somente às novas contas. Uma nova execução conserva os registros editados e verifica a senha candidata contra os hashes antes de anunciá-la como utilizável. Se a senha de alguma conta tiver sido alterada, o arquivo não publica uma senha suposta. SMTP não é usado nessa carga.

A execução local foi conferida por login dos oito perfis e do administrador de bootstrap. O administrador consultou oito documentos e três PTs; o trabalhador consultou um documento próprio e duas PTs em que participa. As três PTs permaneceram sem elegibilidade para liberação. Os arquivos de acesso, backup, capturas e relatórios ficam fora do Git; não copie o conjunto para um ambiente operacional com dados reais.

## Trabalho da equipe

1. Use esta branch para revisar a versão conjunta; ela não altera automaticamente o histórico do repositório separado da API.
2. Faça alterações de API, autorização, banco e migrações em `backend/`, e de interface/cliente HTTP no frontend da raiz.
3. Combine rota, DTO, erros e permissões antes de implementar um fluxo entre os projetos. Concilie explicitamente alterações recebidas do repositório externo para manter uma única API em execução.
4. Execute os testes pertinentes e valide os dois projetos juntos. Disponibilize a API compatível antes do frontend que depende dela.
5. Integre por revisão de PR; os comandos locais não publicam nem fazem merge automático. Preserve credenciais, arquivos recebidos, banco e relatórios fora do Git.

`npm run dev` continua iniciando a demonstração com dados sintéticos no navegador, normalmente na porta 5173. Esse modo é independente do PostgreSQL e não constitui outro servidor backend. O botão de demonstração do login integrado aponta para essa instância separada.
