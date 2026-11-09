# Solicitação à equipe de backend: lacunas da API oficial

Data: 2026-11-08. Base conferida: SESMT-backend `main` em `38c6270`; SESMT-frontend `main` em `8d1486a`.

Com a retirada da cópia `backend/` do frontend (PR #6 do frontend), a interface passou a depender somente do SESMT-backend oficial. Alguns módulos já entregues no frontend foram implementados e testados apenas na cópia embutida e não existem na API oficial. Enquanto essas capacidades não forem concedidas pela API, o frontend esconde os módulos correspondentes (as rotas e os atalhos dependem das permissões retornadas por `/auth/me` e de `canEdit` nas respostas), mas os fluxos ficam indisponíveis no modo integrado.

O código de referência continua no histórico do frontend, commit `4550db2`, em `backend/` (controllers, serviços, entidades, configurações EF, migrations e testes). Ele serve para portar a implementação para a sequência oficial; não deve ser copiado como pasta nem aplicado por cima do repositório.

## Situação em 2026-11-09

Cada item abaixo tem um PR próprio no SESMT-backend, criado a partir da `main` em `38c6270`. Os PRs são independentes entre si e aguardam revisão da equipe. Nenhum foi mesclado. Um contrato só passa a valer para o frontend depois de entrar na `main` do backend.

| Item | PR no SESMT-backend | Observações |
| --- | --- | --- |
| 0. Escrita de tipos documentais | [#34](https://github.com/ChancellorMarko/SESMT-backend/pull/34) | Concessão global de `parametro:editar`, política imutável (`409 IMMUTABLE_DOCUMENT_POLICY`), versão persistida e histórico `DOCUMENT_TYPE_*`. |
| 1. Motivo do histórico profissional | [#35](https://github.com/ChancellorMarko/SESMT-backend/pull/35) | Coluna `motivo` em `varchar(200)`. |
| 2. Renovação de sessão durante o refresh | [#40](https://github.com/ChancellorMarko/SESMT-backend/pull/40) | Token anterior aceito uma vez em até 30 s; depois disso, a reutilização revoga a sessão (`session_revoked`). |
| 3.1 EPIs | [#36](https://github.com/ChancellorMarko/SESMT-backend/pull/36) | Inclui `workerId` em `/auth/me`. |
| 3.2 Treinamentos e comprovantes | [#37](https://github.com/ChancellorMarko/SESMT-backend/pull/37) | Uma migration consolidada; inclui `workerId` em `/auth/me`. |
| 3.3 ASO administrativo | [#38](https://github.com/ChancellorMarko/SESMT-backend/pull/38) | ADMIN sem `aso:acompanhar`/`aso:detalhar`; chaves do Data Protection em volume dedicado (`DataProtection__KeysPath`). |
| 3.4 Edição organizacional | [#39](https://github.com/ChancellorMarko/SESMT-backend/pull/39) | As rotas `PATCH` antigas passam a exigir `If-Match` com a mesma versão. |

Cada PR foi verificado com `npm run test:access:real` contra a própria branch, e o módulo correspondente passou no navegador. Os PRs #36 a #38 repetem a mesma linha de `workerId` em `/auth/me`; se forem mesclados, o Git aceita a alteração idêntica sem conflito. Três decisões ainda dependem da confirmação da equipe e estão destacadas nos PRs: ADMIN sem acesso ao registro de ASO (#38), `If-Match` obrigatório nas rotas antigas de edição organizacional (#39) e revogação da sessão quando o token anterior reaparece depois da janela (#40).

## 0. Segurança: escrita de tipos documentais sem autorização

- Endpoints: `POST /api/v1/document-types`, `PATCH /api/v1/document-types/{id}`, `DELETE /api/v1/document-types/{id}` (`DocumentTypesController`, `DocumentTypeService`).
- O controller só exige `[Authorize]`; `CreateAsync`, `UpdateAsync` e `DeactivateAsync` não verificam permissão nem escopo. Qualquer conta autenticada (inclusive trabalhador) pode criar, alterar ou desativar tipos do catálogo global, que valem para todas as empresas.
- `GET /document-types/management-context` devolve `canManage = true` para quem tem `parametro:editar` ou `documento:editar` em qualquer escopo, inclusive restrito a uma empresa/unidade. O catálogo é global; a escrita deveria exigir concessão global explícita (como `RequireGlobalCompanyCreationAsync` faz para empresas).
- `UpdateAsync` aplica `SecrecyLevel`, `RequiresSignature`, `RequiresApproval`, periodicidade, guarda e `MetadataSchema` recebidos. Com isso, a exigência de assinatura/aprovação e o sigilo de um tipo em uso podem ser removidos silenciosamente, afetando documentos existentes. Proposta: na edição, aceitar apenas nome, descrição e categoria; mudança de política deve criar novo tipo (erro 409 `IMMUTABLE_DOCUMENT_POLICY` se o corpo tentar alterá-la).
- `DocumentTypeMapper.ToResponse` não preenche `Version`. As respostas de `POST`, `PATCH` e `GET /document-types/{id}` saem com `item.version = 0`, e o detalhe repete esse 0 no envelope (`new DocumentTypeDetailResponse(item, item.Version)`). Como o `PATCH` recusa `expectedVersion < 1`, nenhuma edição é possível pelo contrato oficial; o frontend também recusa a confirmação da criação (versão persistida inválida). Correção: `Version = type.Version` no mapper e teste de contrato que cria, relê e edita.
- Nenhum comando grava auditoria com `ResourceType = "document_type"`, então `GET /document-types/{id}/history` sempre retorna lista vazia (o próprio comentário em `GetHistoryAsync` registra isso). Gravar `DOCUMENT_TYPE_CREATED`, `DOCUMENT_TYPE_UPDATED` e `DOCUMENT_TYPE_DEACTIVATED` com ator e instante.
- Contrato de histórico esperado pelo frontend: `[{ id, action, actorName, occurredAt, version }]`, sem repetição de `id`; `version` é a versão do tipo após o evento. Se o backend preferir não enviar `version`, avise para o validador ser ajustado.
- Erros esperados: 401 sem sessão; 403 sem concessão global; 409 `VERSION_CONFLICT` para `expectedVersion` divergente; 409 `IMMUTABLE_DOCUMENT_POLICY` para tentativa de mudar política.
- Verificação: `npm run test:access:real` registra estes pontos como `BACKEND FINDING` (gestor com escopo restrito recebe interface de leitura e 403 na API; remoção de assinatura recusada; edição aparece no histórico).

## 1. Bug: motivo do histórico profissional maior que a coluna

- Endpoint: `PATCH /api/v1/workers/{id}/professional-profile` (`WorkerProfessionalProfilesController`).
- A API aceita `reason` com até 200 caracteres (validação na linha que compara `request.Reason.Trim().Length > 200`) e grava o mesmo texto em `trabalhador_historico.motivo` ao fechar e abrir históricos.
- A coluna está mapeada com `HasMaxLength(50)` em `WorkerHistoryConfiguration`.
- Efeito: um motivo entre 51 e 200 caracteres, permitido pela interface e pela validação da API, produz erro de banco (500) e nenhuma edição é salva.
- Correção esperada: migration que altera `motivo` para `varchar(200)` (a cópia embutida tinha `20261102194145_ExpandProfessionalHistoryReason`) e ajuste da configuração EF; teste relacional com motivo de 200 caracteres. Alternativa: reduzir a validação para 50, avisando o frontend para ajustar o limite.

## 2. Renovação de sessão perdida por navegação durante o refresh

- Endpoint: `POST /api/v1/auth/refresh` (`RefreshSessionService`).
- A rotação é estrita: o token anterior deixa de valer assim que o novo é gravado. Se o navegador abortar a resposta (recarga, troca de página, rede instável) depois de o servidor rotacionar, o cookie novo não é armazenado e o próximo refresh recebe 401; a pessoa é desconectada.
- O frontend já deixou de rotacionar o token após cadastros organizacionais (passa a reler `/auth/me`), mas o refresh na abertura da página e na expiração do access token continua sujeito a isso.
- Proposta: janela curta (por exemplo, 30 s) em que o token imediatamente anterior ainda é aceito uma única vez para a mesma sessão, devolvendo o par já rotacionado ou um novo par, com registro em auditoria; uso fora da janela continua revogando a sessão. Erro esperado fora da janela: 401 `session_revoked`/`invalid_refresh_token`, como hoje.

## 3. Módulos ausentes na API oficial

Para cada módulo: rotas sob `/api/v1`, todas com `Authorize`, escopo por empresa/unidade calculado pelas concessões persistidas (`NativeResourceAccess`), respostas com `Cache-Control: no-store`, comandos com confirmação explícita, `CommandId` para idempotência de criação e `ExpectedRevision`/`ExpectedVersion` para concorrência (409 em conflito). Auditoria em `audit.log_auditoria` para todo comando.

### 3.1 EPIs (catálogo, entrega e devolução)

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/equipment/context?unitId=` | Capacidades (`canCreate`, `canDeliver`, `canReturn`), trabalhadores e equipamentos da unidade |
| GET | `/equipment?unitId=&q=&page=` | Catálogo da unidade |
| POST | `/equipment` | Cadastrar equipamento (`EquipmentRequest`) |
| GET / PUT | `/equipment/{id}` | Consultar / editar com `ExpectedRevision` |
| GET | `/equipment/deliveries?unitId=&workerId=&page=` | Entregas (trabalhador vê somente as próprias) |
| GET | `/equipment/deliveries/{id}` | Detalhe e histórico da entrega |
| POST | `/equipment/deliveries` | Registrar entrega (`EquipmentDeliveryRequest`) |
| POST | `/equipment/deliveries/{id}/return` | Registrar devolução (`EquipmentReturnRequest`) |

- Permissões novas: `epi:ler`, `epi:criar`, `epi:editar`; entrega também exige `trabalhador:ler` e unidade completa.
- DTOs: `EquipmentRequest(UnitId, Code, Name, ApprovalCertificate?, Manufacturer?, Model?, Confirmation, ExpectedRevision?)`; `EquipmentDeliveryRequest(UnitId, WorkerId, EquipmentId, CommandId, Quantity, Size?, DeliveredOn, ReplacementOn?, Notes?, Confirmation)`; `EquipmentReturnRequest(UnitId, ExpectedRevision, ReturnedOn, Reason, Confirmation)`.
- Migration de referência: `20261102192522_AddEquipmentControl`.
- Limites que devem ser mantidos: CA é texto informado, sem consulta oficial; sem estoque, devolução parcial ou recibo assinado; entrega não libera PT.
- Contrato consumido pelo frontend: `src/features/native-equipment/contracts.ts`.

### 3.2 Treinamentos e comprovantes

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/trainings/context?unitId=` | Capacidades e trabalhadores |
| GET | `/trainings?unitId=&workerId=&status=&page=` | Registros (trabalhador vê os próprios) |
| GET | `/trainings/{id}` e `/trainings/{id}/history` | Detalhe e histórico |
| POST | `/trainings` | Registrar (`TrainingRequest`, com `CommandId`) |
| PUT | `/trainings/{id}` | Corrigir com motivo e `ExpectedRevision` |
| POST | `/trainings/{id}/revoke` | Invalidar sem excluir (`RevokeTrainingRequest`) |
| GET | `/trainings/{id}/evidence` e `/evidence/options` | Vínculo atual e versões documentais publicadas elegíveis |
| POST | `/trainings/{id}/evidence` e `/evidence/unlink` | Vincular versão (fixa SHA-256) / remover vínculo preservando documento e auditoria |

- Permissões novas: `treinamento:ler`, `treinamento:criar`, `treinamento:editar`; comprovantes exigem também `documento:ler`.
- Migrations de referência: `20261103113512_AddTrainingRecords`, `20261103120903_AddTrainingEvidence`.
- Limites: registro administrativo; não emite certificado, não habilita atividade nem libera PT. Mudança de metadados exige nova conferência do comprovante.
- Contrato consumido pelo frontend: `src/features/native-training/contracts.ts`.

### 3.3 Registro administrativo de ASO

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/occupational-health/context?unitId=` | `ownOnly`, `canEdit`, `canDetail`, trabalhadores |
| GET | `/occupational-health?unitId=&page=` | Registros no nível autorizado |
| GET | `/occupational-health/{id}` e `/{id}/history` | Detalhe (emitente/CRM só com `aso:detalhar` ou próprio trabalhador) |
| POST / PUT | `/occupational-health` e `/{id}` | Registrar / corrigir (`AsoRequest`) |
| POST | `/occupational-health/{id}/revoke` | Invalidar com `ReasonCode` |

- Permissões: a API oficial já semeia `aso:ler` e `aso:editar`; o frontend usa também `aso:acompanhar` (aptidão e datas) e `aso:detalhar` (identificação do emitente). Registrar exige `aso:acompanhar`, `aso:detalhar`, `aso:editar` e `trabalhador:ler` com unidade completa. Administração e auditoria gerais não concedem acesso médico.
- Migration de referência: `20261103132828_AddOccupationalCertificates` (campos protegidos com Data Protection; documentar backup e recuperação das chaves, pois o backup do PostgreSQL sozinho não recupera esses campos).
- Limites: não emite nem assina ASO, não substitui prontuário/PCMSO, não infere aptidão.
- Contrato consumido pelo frontend: `src/features/native-aso/`.

### 3.4 Edição organizacional com histórico

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/organization-management/{resource}/{id}` | Perfil editável com `version` (SHA-256) |
| GET | `/organization-management/{resource}/{id}/history` | Histórico administrativo |
| PATCH | `/organization-management/{resource}/{id}` | `OrganizationEditRequest(ExpectedVersion, Reason, Confirmation, Values)` |

- `resource`: `companies`, `units`, `departments`, `positions`. CNPJ, tipo de empresa e vínculos (empresa/unidade) são imutáveis na edição.
- O `GET /organization-management` oficial precisa voltar a informar `canEdit` por registro (`empresa:editar`, `unidade:editar`, `setor:editar`, `cargo:editar` no escopo completo). Sem esse campo, o frontend mantém a edição oculta.
- Contrato consumido pelo frontend: `src/features/organization/native-organization-edit.ts`.

## Ordem sugerida

1. Item 0 (segurança) e itens 1 e 2 (correções pequenas, afetam fluxos já disponíveis).
2. Edição organizacional (3.4), que reutiliza permissões já semeadas.
3. EPIs, treinamentos e ASO (3.1 a 3.3), cada um em PR próprio com migration aditiva.

Após cada PR do backend entrar na `main`, o frontend roda `npm run test:access:real` contra o checkout oficial e reativa a verificação do módulo correspondente.
