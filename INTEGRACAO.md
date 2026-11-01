# Integração Ampara: dois repositórios, uma API

O código da API pertence exclusivamente ao [SESMT-backend](https://github.com/ChancellorMarko/SESMT-backend). Este repositório contém a interface React, seus contratos e testes. As consultas de navegador anteriormente incorporadas ao frontend foram transferidas para a API oficial, preservando os endpoints nativos da equipe.

## Preparar o ambiente

Requisitos: Node.js >=22.12, npm, SDK .NET 10 e PostgreSQL. Docker Compose é opcional para o banco.

Clone os dois repositórios lado a lado:

```text
GitHub/
  SESMT-frontend/
  SESMT-backend/
```

No frontend:

```sh
npm ci
npm run integration:setup
npm run integration:db
npm run integration:migrate
npm run dev:integrated
```

`integration:setup` cria configurações e credenciais locais aleatórias em `.env.integration.local`, sem sobrescrever um arquivo existente. Consulte as credenciais nesse arquivo; não o envie ao GitHub. Se já houver PostgreSQL local configurado, use-o e dispense `integration:db`. O comando de migração atualiza o banco configurado: confira o destino e faça backup antes de atualizar uma base com dados importantes.

Para outra localização ou uma worktree do backend, acrescente ao arquivo local:

```dotenv
SESMT_BACKEND_PATH=../SESMT-backend
```

O caminho pode ser absoluto ou relativo ao frontend. O comando exige um repositório backend externo com a solução e os projetos esperados; recusa uma cópia dentro do frontend. Ele não faz pull, merge, checkout ou atualização automática do código da equipe.

O frontend integrado abre em `http://127.0.0.1:5175/login`, a API em `http://127.0.0.1:5047` e o banco opcional em `127.0.0.1:5434`. O início imprime o diretório exato do backend. Ctrl+C encerra os processos iniciados pelo comando, sem encerrar o banco. Portas ocupadas são informadas antes de iniciar os servidores.

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
| Documentos e metadados | `GET /api/v1/browser/documents`, `/{id}`, `/{id}/versions`, `/{id}/versions/{versionId}`, `/{id}/history` |
| Tipos documentais | `GET /api/v1/browser/document-types`, `/{id}` |
| Recuperação e redefinição de senha | `POST /api/v1/auth/forgot-password`, `/reset-password` |
| Usuários | `GET /api/v1/users`, `PATCH /api/v1/users/{id}`, `POST /api/v1/users/{id}/deactivate` |
| Notificações pessoais | `GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/read` |
| Auditoria | `GET /api/v1/audit-logs` |
| Dashboard operacional | `GET /api/v1/dashboard/summary`, `/appointments`, `/document-pendencies`, `/review-pendencies`, `/activity-evolution` |
| Agenda | `GET/POST /api/v1/appointments`, `GET /{id}`, `POST /{id}/confirm`, `/reschedule`, `/cancel`, `PUT /{id}/context` |
| Equipes (consulta nativa) | `GET /api/v1/teams?locationId=...&pageNumber=...&pageSize=10`, `GET /api/v1/teams/{id}` |
| Designações | `GET/POST /api/v1/designations`, `POST /api/v1/designations/{id}/revoke` |
| PTs (consulta nativa) | `GET /api/v1/work-permits/search`, `GET /api/v1/work-permits/{id}`, `/{id}/history`, `/{id}/eligibility`, `/{id}/declarations` |
| PTs (operação nativa) | `POST /api/v1/work-permits/{id}/release`, `/start`, `/suspend`, `/resume`, `/cancel`, `/observations` |
| PTs (checklists e encerramento) | `GET /api/v1/work-permits/pt-templates?companyId=...`, `PATCH /api/v1/work-permits/{id}/checklist`, `POST /api/v1/work-permits/{id}/complete` |
| PTs (abertura) | `GET /api/v1/work-permits`, `GET /api/v1/workers/{id}` após leitura browser autorizada, `POST /api/v1/work-permits/appointments/{id}/pt` |

`dev:integrated` seleciona explicitamente `VITE_API_MODE=api`, `VITE_AUTH_API_CONTRACT=native`, `VITE_API_BROWSER_PREFIX=/browser` e o proxy da API. Para iniciar o Vite manualmente, configure os mesmos valores e `VITE_API_BASE_URL=/api/v1`, `API_PROXY_TARGET=http://127.0.0.1:5047`. A autenticação nativa e as projeções de leitura são escolhas independentes: o prefixo browser atua somente nas consultas de organização, trabalhadores, documentos e tipos documentais. Usuários, notificações e auditoria continuam nos endpoints nativos. Use o backend atualizado com os merges #31 e #32 (referência conferida: `41d31e9`). O comando não atualiza o checkout do backend automaticamente.

O JWT fica em memória. No contrato nativo, o refresh usa o cookie `sesmt_refresh`, HttpOnly, SameSite Strict, Secure, caminho `/api/v1/auth`. O cliente sincroniza CSRF e envia `X-CSRF-Token`; o refresh nativo compara o token com o cookie. HTTPS é necessário fora do loopback de desenvolvimento. Falha ao revogar logout não informa sucesso nem remove a possibilidade de nova tentativa.

O modo alternativo `VITE_AUTH_API_CONTRACT=adapter` com prefixo `/browser` conserva a sessão em `/browser/auth/*` e `/browser/me`, cujo catálogo atual contém apenas leituras de organização, trabalhadores e documentos. Para acessar os módulos nativos, utilize a configuração integrada acima. O frontend não concede acesso a partir do nome ADMIN, de claims decodificadas ou de um perfil fixo. MFA ainda depende de um desafio suportado pelo backend; não há uma etapa fictícia de verificação na interface.

### Permissões nativas e consulta de usuários

O frontend preserva as permissões recebidas e compara equivalências explícitas em `src/shared/auth/permissions.ts`: `documento:ler` permite a verificação de `documents.read`, `trabalhador:ler` permite `workers.read`, e `usuario:ler` permite `users.read`. A consulta agregada `organization.read` exige as quatro leituras `empresa:ler`, `unidade:ler`, `setor:ler` e `cargo:ler`. Não há autorização pelo nome de um perfil, por wildcard ou por tradução automática de ações. Perfis novos não precisam ser cadastrados no frontend. Permissões de recursos novos são preservadas para comparação exata, mas uma funcionalidade nova precisa de uma tela e de um contrato próprios.

O catálogo `PERMISSIONS`/`ROLES` descreve os valores nativos conhecidos para autocomplete e conferência de contrato. `isPermission` e `isRole` classificam esse catálogo; não devem filtrar a identidade nem recusar concessões futuras retornadas pela API. O controle das telas usa `can()`, que também reconhece as capacidades específicas do frontend e as equivalências documentadas acima.

A capacidade `users.read` abre `GET /api/v1/users`, consumindo diretamente a lista nativa `{ id, name, email, roles, scopeIds, active }`. Busca e paginação são locais sobre a lista autorizada, sem filtro fictício de unidade. `usuario:editar` habilita somente `PATCH /users/{id}` com `{ name, email }`; `usuario:excluir` habilita a confirmação de desativação por `POST /users/{id}/deactivate`, sem corpo. A própria conta não pode ser desativada na tela. Conflitos preservam o preenchimento; uma resposta incompatível bloqueia nova tentativa até atualizar a lista. A API continua responsável por conferir perfis e escopos. Cadastro, atribuição de perfis/escopos e convites não são enviados pelo contrato legado no modo nativo: falta uma fonte publicada de opções delegáveis para esses formulários. `usuario:ler` não concede `users.manage`.

`alerta:ler` habilita notificações pessoais: `GET /notifications` retorna `{ items }`, sem paginação ou filtros de unidade. Filtros de leitura e paginação da tela são locais. Marcar como lida usa POST, espera 204 e relê os avisos para atualizar também o sino; não inventa `readAt` nem resolve a pendência. O DTO não informa unidade/tipo de recurso suficiente para links genéricos, portanto a tela apresenta os identificadores nos detalhes sem inventar destinos. Uma recusa oculta conteúdo e contador até uma nova consulta autorizada.

`auditoria:ler` habilita a tela nativa para `/audit-logs`, com `pageNumber`, `pageSize`, `action`, `resourceType`, `from` e `to`. A API também exige os perfis ADMIN ou AUDITOR. Não se envia `unitId`, nem se consulta um catálogo inexistente de ações. Datas dos filtros são dias UTC; horários visíveis são de Brasília. Respostas, páginas e correspondência dos filtros são verificadas antes de mostrar os registros. Identificadores nulos permanecem explicitamente não informados. Os detalhes mostram somente os campos públicos retornados, sem deduzir nomes de pessoas.

Com `VITE_API_BROWSER_PREFIX=` vazio, documentos, trabalhadores e organização retornam os DTOs nativos, ainda diferentes dos dessas telas. Reconhecer uma permissão não converte o formato dos dados. Prefira a projeção publicada para essas consultas. No contrato nativo, o dashboard autenticado é o destino de retorno quando não há outro módulo inicial reconhecido; nos demais contratos, a ausência de destino continua levando à conta conectada.

### Dashboard operacional nativo

No contrato `native`, `/app/dashboard` usa exclusivamente os cinco endpoints de dashboard listados acima. `DashboardController` exige autenticação, e `DashboardRepository` decide quais atividades, PTs e designações o ator pode consultar. A navegação espelha essa política, sem inventar `dashboard.read`, atribuir perfil ADMIN ou liberar os comandos de agenda/PT. O contrato da demonstração conserva seus controles e endpoints próprios. Inspeções, saúde e EPIs do dashboard antigo não são exibidos como módulos integrados nessa tela.

O período padrão cobre doze meses civis, terminando no último dia do mês atual em UTC. As cinco consultas recebem os mesmos `from`/`to` UTC; o limite de 36 meses da série histórica é validado antes do envio. Por padrão a abrangência é a conta. Escolher “Unidade selecionada” envia o UUID da unidade como `localId` (o backend usa Units para esses locais); trocar a unidade recompõe o contexto e cancela a consulta anterior. Não são enviados `unitId`, filtros textuais de local ou opções do contrato legado. Os parâmetros de URL aceitos são `from`, `to` e `scope=account|unit`; outros critérios precisam ser limpos, em vez de serem ignorados silenciosamente.

Indicadores e listas são exibidos apenas após validar o conjunto das cinco respostas. Recusas e dados incompatíveis ocultam os indicadores e registros anteriores; erros não viram zeros. Cada endpoint realiza sua própria leitura, então os totais não são artificialmente igualados entre consultas de instantes distintos. Atividades são filtradas pela data de início; requisitos, pela criação da PT; revisões, pelo encerramento. O gráfico contabiliza transições de estado, não PTs únicas. Seu detalhamento mensal em tabela é acessível por teclado.

Os requisitos são somados como requisitos faltantes, sem inventar número de trabalhadores ou arquivos. Identificadores e metadados ficam nos detalhes; não são criados códigos ou nomes ausentes nos DTOs, nem links para telas de agenda/PT com contratos ainda diferentes. O retorno vazio informa somente a ausência de registros consultados, sem declarar conformidade.

Limite atual da API: o repositório calcula empresas autorizadas a partir de UserScopes EMPRESA e não aplica nessa consulta o fallback global de `/auth/me`. ADMIN sem esses escopos, ou conta com somente escopo UNIDADE/SETOR, pode receber um conjunto vazio. Um `localId` fora de AllowedLocalIds recebe 403, inclusive quando a identidade lista a unidade. A interface respeita esses retornos; a revisão da política efetiva pertence ao backend.

### Agenda, equipes e designações nativas

As telas nativas têm DTOs próprios. Agenda usa `version`, `expectedVersion`, `REQUESTED/CONFIRMED/CANCELLED` e histórico Before/After; não envia `revision`, ETag ou estados da demonstração. A lista aceita `q`, `status`, `companyId`, `from`, `to`, `page` e `pageSize`; a API filtra sobreposição de intervalos, não somente a data de início. O fim do dia escolhido vira o início do dia UTC seguinte, exclusivo. O contexto da consulta é o da conta, sem filtro fictício de unidade sobre uma página parcialmente carregada.

Consulta, detalhe e retorno à lista preservam os filtros válidos. Solicitação de agendamento e configuração de equipe/participantes usam catálogos consultados na API: organização browser, equipes verificadas, serviços nativos e trabalhadores. Participantes são Worker.Id; responsável da confirmação é User.Id, vindo da consulta nativa de usuários. A confirmação continua dependendo de designação, período e capacidade no servidor. Alteração de contexto usa PUT e não troca empresa, local, título ou datas. Reagendamento exige motivo e período futuro em Brasília, convertido para UTC. Cancelamento exige motivo; a API recusa alterações quando já existe PT vinculada.

As entradas de consulta de agenda e designações permitem solicitar a leitura autenticada e respeitam as recusas específicas dos serviços. A interface não reconhece CONFIG/ADMIN por nome para conceder comandos: criação de agendamento exige `pt:criar`; gestão da agenda e criação/revogação de designações exigem `pt:editar`, além das consultas necessárias aos seletores. A API ainda exige os vínculos operacionais por empresa. O seeder atual não associa RolePermission aos quatro perfis SESMT_PT_*; alinhar essa política ou fornecer ações efetivas é trabalho da API. Permissões da sessão não são preenchidas pelo frontend.

Equipe exige `equipe:ler`, unidade explícita e empresas da identidade. A lista nativa é um array sem total nem contexto; cada detalhe é conferido por ID, empresa, local e estado antes de mostrar a página. A paginação apresenta somente a página e a quantidade recebida; não inventa um total geral. Criação/edição/desativação de equipes não foram habilitadas: a cadeia TeamsController → TeamService → TeamRepository da referência atual não confere ator, permissões de recurso ou escopo, e não há filtro global correspondente no DbContext. A verificação na interface não substitui essa correção no servidor. Não se usa o formulário legado por um acesso direto à URL.

Designações usam PersonId=Worker.Id, ServiceIds, LocationIds, Type (`atender/liberar/revisar/conferir`), vigência UTC, Origin e expectedVersion para revogar. A lista completa autorizada permite filtro/paginação locais sem enviar parâmetros que a rota não aceita. O detalhe é encontrado nessa lista; não se chama GET /designations/{id}, que não existe. “Não revogada” não é apresentado como autorização automática de uma operação fora de vigência.

Os editores mantêm a versão existente na abertura, mesmo se ocorrer nova leitura em segundo plano. Conflitos preservam o preenchimento e bloqueiam reenvio até atualizar; o frontend não incrementa a versão para tentar sobrescrever dados. Respostas incompatíveis e falhas de conclusão ambígua também bloqueiam repetição automática. Sucesso exige conferir os campos retornados e reler as consultas relacionadas, incluindo o dashboard. Testes com HTTP controlado não homologam a autorização, persistência ou idempotência da API real.

### Permissões de trabalho nativas

A lista usa GET `/work-permits/search`, paginação real e filtros de título/serviço, estado, empresa, local, participante e período de sobreposição do agendamento. `locationId` é o filtro nativo opcional de unidade, não `unitId`; as datas da busca são dias UTC, incluindo o dia final. O detalhe usa WorkPermitResponse, com estados portugueses, Version e ContentVersion distintos, participantes por User.Id e modelos fixados por ID de versão. O retorno à lista preserva somente consultas internas válidas. Atalhos das filas do dashboard levam à PT ou ao agendamento nativo correspondente.

Histórico, elegibilidade e declarações são consultas independentes verificadas. Declarações precisam corresponder à PT, versões de registro/conteúdo, agendamento e conjunto de modelos fixados. Elegibilidade é uma avaliação administrativa do servidor, não um cálculo local nem uma confirmação automática de liberação. Ela não fornece versão no DTO atual; o comando continua reavaliando os requisitos no servidor. A interface não cria uma avaliação positiva quando a consulta falha.

Liberação, início, suspensão, retomada, cancelamento e observações enviam expectedVersion da abertura do editor. A janela de liberação usa Brasília na entrada e UTC na API, precisa estar contida no agendamento e exige confirmação explícita. Ações dependem dos grants explícitos `pt:liberar`, `pt:iniciar` ou `pt:editar`, do estado recebido e das regras do servidor; perfis por nome não concedem direitos na interface. Os comandos de liberação/início/retomada ficam indisponíveis enquanto a elegibilidade é desconhecida ou pendente. Conflitos, respostas incompatíveis e resultados ambíguos preservam o preenchimento e bloqueiam repetição automática. Sucesso exige resposta compatível e atualização das consultas relacionadas.

Os checklists são carregados sob demanda por `GET /work-permits/pts/{id}`, usando `pinnedTemplates` e os IDs exatos das versões fixadas. O recibo deve corresponder ao ID, versão, estados e participantes da PT consultada. Isso permite ler as perguntas sem acesso ao catálogo administrativo. Somente um recibo antigo válido, sem a propriedade `pinnedTemplates`, permite consultar o catálogo como compatibilidade; recusa, propriedade nula ou resposta inconsistente bloqueiam essa alternativa. Uma versão nova não substitui a fixada. Perguntas BOOLEAN, TEXT e NUMBER mantêm IDs e metadados recebidos, sem inventar NA. Respostas, justificativas e ausência de resposta são distintas. O preenchimento de abertura pode ser salvo parcialmente com PATCH/expectedVersion; não libera a operação e incrementa a versão de conteúdo, exigindo atualização das ciências conforme o backend. A propriedade nova depende da aplicação do pacote de correções do backend de 01/11/2026.

Valores NUMBER são preservados como strings decimais, sem arredondamento por Number do JavaScript. Entrada aceita ponto/vírgula decimal sem separador de milhar, valida o alcance de decimal .NET e envia cultura invariável. Respostas já armazenadas são lidas na cultura invariável da API. Os editores preservam a versão da abertura e o rascunho em conflitos, mesmo com nova leitura da PT em segundo plano.

Encerramento depende de verificações presentes em todos os modelos fixados, grant explícito `pt:concluir`, estado EM_EXECUCAO e autorização final da API. Exige as respostas obrigatórias, recusa respostas impeditivas e valida resumo, confirmação local e término efetivo em Brasília entre StartedAt e o instante atual. O corpo de POST /complete usa Summary, ActualEnd UTC e ClosingAnswers, sem campos da demonstração. A resposta precisa confirmar incremento de Version, manutenção de ContentVersion, CONCLUIDA e AGUARDANDO_REVISAO; conclusão não é aprovação da revisão.

O término efetivo aceita minutos ou segundos e preserva essa precisão na conversão para UTC, inclusive em serviço encerrado dentro do mesmo minuto de StartedAt. Calendário inválido, ano zero, segundos fora do intervalo e sufixos de fuso em uma entrada local são recusados.

A abertura fica disponível no agendamento confirmado com `pt:criar` e consulta de trabalhadores. Os modelos são escolhidos explicitamente, com uma versão por modelo, cobertura exata dos serviços e verificações de encerramento. O frontend consulta os IDs dos participantes na projeção browser antes de qualquer leitura do DTO nativo. A leitura especializada `readNativeWorker` aceita apenas um GUID e GET no contrato de autenticação nativo, com `cache: no-store` e preservação do ciclo de sessão/cancelamento; as consultas normais de trabalhadores continuam na projeção browser. Somente o vínculo Worker.Id/User.Id, nome e matrícula necessários à abertura chegam ao cache de consultas da interface, sem CPF/data de nascimento do DTO nativo.

GET /work-permits verifica registro existente e evita segunda criação. Antes do POST, a interface relê a agenda, os vínculos e os modelos, preservando a seleção se houver mudança. O corpo usa `expectedAppointmentVersion`, `templateVersoes: [{templateId, versao}]` e `participanteIds: User.Id[]`; IDs de versão não substituem TemplateId e IDs de trabalhador não substituem os de usuário. O recibo português, os conjuntos de serviços/participantes/modelos e o registro persistido são conferidos, incluindo a relação com o agendamento. A navegação mantém o retorno agenda → PT → agendamento → lista com filtros. Abertura não libera execução; erro ambíguo não provoca repetição automática.

O backend oficial consultado em `41d31e9` não tinha verificação de recurso/escopo na cadeia nativa de trabalhadores nem proteção da versão da agenda na abertura. O pacote de correções de 01/11/2026 adiciona autorização dos recursos nativos e `expectedAppointmentVersion`, além de verificar agenda confirmada, serviços/modelos e os vínculos reais Worker/User em transação. Essas correções precisam ser incorporadas pela equipe responsável; o frontend não as publica. Não foi habilitada escrita nativa de trabalhadores. Já existe índice único de AppointmentId em WorkPermitConfiguration; confirmar sua aplicação e concorrência no PostgreSQL real.

A ciência individual está integrada para o participante autenticado durante EM_VERIFICACAO. Exige a resposta completa de `/work-permits/{id}/declarations` com `canonicalContent`, `contentHash`, `templateId` e contexto incluindo `teamId`, disponibilizada no pacote de correções do backend. O frontend confere a correspondência semântica do conteúdo integral com as declarações/contexto; o hash é uma precondição opaca fornecida e verificada pelo servidor. Após nome e confirmação explícita, relê a PT e as declarações e envia POST `/acknowledge` com `expectedVersion`, `contentVersion`, `participantUserId` da própria sessão, `confirmedName`, `identificationMethod`, `confirmation` e `contentHash`. Confere o recibo e o registro persistido, sem repetição automática ou suposição de idempotência. Não coleta ciência de terceiros, não libera a atividade e não reutiliza assinaturas/snapshots da demonstração. A impressão completa/PDF e a decisão da revisão final continuam sem contrato integrado; a URL antiga de impressão informa indisponibilidade.

As leituras da PT usam empresas explícitas de UserScopes EMPRESA. Não implementam automaticamente os escopos UNIDADE/SETOR/ownOnly ou o fallback global de /auth/me; essa política deve ser homologada/alinhada pela equipe do backend, antes de afirmar isolamento por esses critérios. Testes com HTTP controlado não validam autorização, persistência ou regras da API/banco reais.

A projeção documental também aplica a política de acesso nativa, além dos escopos de empresa, unidade, setor e vínculo próprio. Dados restritos/médicos não são expostos por essa projeção. DTOs de leitura usam `sourceReadOnly: true` e `revision: null`; dados ausentes não são inventados. A lista conserva essa projeção, seus filtros e os retornos por trabalhador, consulta central, vencimentos e painel documental. Os comandos abaixo usam DTOs nativos próprios, sem aproveitar a revisão nula da projeção.

### Documentos: cadastro, arquivos e conferência nativos

No contrato native, `documento:criar` permite o cadastro geral com unidade/setor autorizados, tipo ativo, código, título, emissão, validade e classificação Pública/Interna. O catálogo vem de `/document-types` e `/document-types/{id}`. Tipos Restrito/Medico ou com campos obrigatórios em `metadataSchema.required` aguardam formulários específicos; não são cadastrados com metadados fictícios. Um tipo Interno não pode ser reduzido a Público. A criação usa POST `/documents`, `ownerId` da sessão, `personId` opcional como Worker.Id e `links: []`. A seleção opcional de trabalhador verifica vínculo, situação e unidade/setor antes do comando; a origem pelo trabalhador é preservada e confirmada na projeção após salvar. O cadastro é relido antes de navegar e permanece RASCUNHO/sem arquivo.

O detalhe consulta `/documents/{id}`, `/versions`, `/document-types/{id}` e `/documents/file-policy` com o transporte nativo autenticado, sem prefixo browser. Valida revisão, empresa/unidade/setor, número de versão, estados, IDs e hashes. `documento:editar` habilita anexar uma versão; documentos médicos também exigem `aso:editar`. O upload usa FormData com `file`, `expectedVersion` igual a Document.Revision e observação opcional; não envia autor arbitrário. Limite, MIME e extensão vêm da política, com teto de 50 MiB. O SHA-256 calculado no navegador deve corresponder ao recibo. A confirmação exige revisão incrementada, EM_REVISAO e versão ainda não vigente. Nenhum envio libera o trabalhador ou a PT.

`documento:aprovar` habilita a decisão da versão atual em conferência, sujeita à designação/concessão específica verificada pelo servidor. O frontend relê o registro e as versões e envia POST `/documents/{id}/versions/{versionId}/review` com `{ expectedVersion: Document.Revision, version: versionNumber, decision: 'aceita' | 'reprovada', reason }`. Reprovação exige motivo e ambas as decisões exigem confirmação explícita. O recibo, ator, hash, estado, revisão e registro persistido são conferidos. Tipos com `requiresSignature` não permitem aceite na interface até existir verificação correspondente no servidor; reprovação permanece disponível. Edição de metadados está indisponível: DocumentUpdateRequest ainda não recebe uma versão esperada para detectar perda de atualização.

O download usa GET autenticado `/documents/{id}/versions/{versionId}/download`, sem URL externa ou redirecionamento. O transporte preserva renovação da sessão, cancelamento e `no-store`; limita bytes durante a leitura e rejeita arquivos vazios, truncados ou de MIME inesperado. Antes de oferecer o arquivo, compara SHA-256 com o da versão consultada. Usa Blob URL temporária com revogação. Falta de acesso oculta os dados anteriores. A verificação criptográfica exige um contexto seguro do navegador, como localhost.

`pt:editar` permite escolher uma PT EM_VERIFICACAO da mesma empresa pela busca nativa e vincular o documento por POST `/work-permits/{id}/documents` com `{ documentId, expectedVersion }`. O frontend relê documento/PT, exige confirmação, espera 204 e confere incremento de Version e ContentVersion no registro persistido. O vínculo exige nova ciência e reavaliação dos requisitos; não corresponde a uma liberação. Conflitos e resultados ambíguos preservam os formulários e bloqueiam repetição automática em todos esses comandos.

Esses fluxos foram verificados com contratos HTTP controlados. A homologação com a API real, PostgreSQL, armazenamento, concessões/designações e contas de escopos distintos continua necessária antes do uso com dados reais; builds e testes do frontend não comprovam essas condições.

## Banco existente e validação

A revisão 2 do pacote de correções de 01/11/2026 passou por build Release e pelos 380 testes do backend, sem falhas ou testes ignorados, incluindo os 107 testes relacionais com PostgreSQL 17.11 descartável. A fixture aplicou as migrations e validou o schema em uma base exclusiva de QA. Essa execução não homologou a configuração de implantação, as contas operacionais nem o fluxo navegador → API com os dados reais da equipe.

A migração antiga `20261029200000_AddWorkerDepartmentColumn`, quando já aplicada em uma base local, pode continuar no histórico. O backend oficial possui o reparo idempotente `20261027035114_RepairHistoricalWorkerDepartment`; não copie uma segunda migração nem apague dados/histórico para reconciliar os repositórios. Execute as migrações oficiais pendentes após backup.

```sh
npm run test:integration-tools
npm run integration:check-schema
npm run test:backend
npm run integration:smoke
npm run build
```

`test:backend` executa os testes no repositório oficial selecionado. Os cenários PostgreSQL do backend exigem `SESMT_TEST_POSTGRES_ADMIN` apontando para o banco de manutenção `postgres` de uma instância local; cada fixture cria e remove apenas sua própria base isolada. Sem essa variável, esses cenários são explicitamente ignorados. `integration:smoke` exige os servidores integrados ativos e verifica sessão real pelo proxy; não usa MSW. Testes de navegador com respostas controladas são verificações de contrato, não substituem a integração real.

## Trabalho da equipe

1. Atualize a `main` do repositório responsável e crie uma branch de funcionalidade.
2. Faça alterações de API, autorização, banco e migrações somente no backend oficial. Faça alterações de interface e cliente HTTP no frontend.
3. Combine rota, DTO, erros e permissões antes de implementar um fluxo entre os dois. Abra PRs relacionados quando a mudança afetar os dois repositórios.
4. Execute os testes pertinentes e valide os dois projetos juntos. Disponibilize a API compatível antes do frontend que depende dela.
5. Integre por revisão de PR; o comando local não publica nem faz merge automático. Não volte a copiar fontes da API para dentro do frontend.

`npm run dev` continua iniciando a demonstração com dados sintéticos no navegador, normalmente na porta 5173. Esse modo é independente do PostgreSQL e não constitui outro servidor backend. O botão de demonstração do login integrado aponta para essa instância separada.
