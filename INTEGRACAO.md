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
| CSRF | `GET /api/v1/browser/auth/csrf` |
| Login, renovação e logout | `POST /api/v1/browser/auth/login`, `/refresh`, `/logout` |
| Identidade, capacidades e escopos efetivos | `GET /api/v1/browser/me` |
| Estrutura organizacional | `GET /api/v1/browser/organization` |
| Trabalhadores, detalhe e histórico | `GET /api/v1/browser/workers`, `/{id}`, `/{id}/movements` |
| Documentos e metadados | `GET /api/v1/browser/documents`, `/{id}`, `/{id}/versions`, `/{id}/versions/{versionId}`, `/{id}/history` |
| Tipos documentais | `GET /api/v1/browser/document-types`, `/{id}` |
| Recuperação e redefinição de senha | `POST /api/v1/auth/forgot-password`, `/reset-password` |

`dev:integrated` seleciona explicitamente `VITE_API_MODE=api`, `VITE_AUTH_API_CONTRACT=adapter`, `VITE_API_BROWSER_PREFIX=/browser` e o proxy da API. Para iniciar o Vite manualmente com essa projeção, configure os mesmos valores e `VITE_API_BASE_URL=/api/v1`, `API_PROXY_TARGET=http://127.0.0.1:5047`. O prefixo não é aplicado a outros módulos nem à demonstração. A configuração `native`, sem prefixo browser, continua disponível para consumidores do contrato nativo.

O JWT fica em memória. O refresh usa cookie HttpOnly, SameSite Strict, caminho `/api/v1/browser/auth`, Secure obrigatório fora de Development. O antiforgery usa cookie protegido e token no header `X-CSRF-Token`, incluindo login, refresh e logout. Falha ao revogar logout não informa sucesso nem remove o cookie de nova tentativa.

As capacidades de consulta `organization.read`, `workers.read` e `documents.read` vêm dos grants e escopos ativos no banco. ADMIN não recebe autorização operacional por inferência. Uma conta sem grants efetivos vê a orientação para solicitar acesso. MFA exigido ou vínculo de trabalhador ausente/ambíguo bloqueiam o acesso correspondente.

### Permissões nativas e consulta de usuários

O frontend preserva as permissões recebidas e compara equivalências explícitas em `src/shared/auth/permissions.ts`: `documento:ler` permite a verificação de `documents.read`, `trabalhador:ler` permite `workers.read`, e `usuario:ler` permite `users.read`. A consulta agregada `organization.read` exige as quatro leituras `empresa:ler`, `unidade:ler`, `setor:ler` e `cargo:ler`. Não há autorização pelo nome de um perfil, por wildcard ou por tradução automática de ações. Perfis novos não precisam ser cadastrados no frontend. Permissões de recursos novos são preservadas para comparação exata, mas uma funcionalidade nova precisa de uma tela e de um contrato próprios.

O catálogo `PERMISSIONS`/`ROLES` descreve os valores nativos conhecidos para autocomplete e conferência de contrato. `isPermission` e `isRole` classificam esse catálogo; não devem filtrar a identidade nem recusar concessões futuras retornadas pela API. O controle das telas usa `can()`, que também reconhece as capacidades específicas do frontend e as equivalências documentadas acima.

A capacidade `users.read` abre uma tela de consulta para `GET /api/v1/users`, consumindo diretamente a lista nativa `{ id, name, email, roles, scopeIds, active }`. Ela não exige unidade selecionada, não envia filtro de unidade que a rota não suporta e informa que o escopo da listagem é o da conta. Busca e paginação ocorrem sobre a resposta autorizada pela API. Essa tela não envia convites ou edições do contrato legado. A capacidade preexistente `users.manage` continua usando seu fluxo de gestão específico; `usuario:ler` não concede essa capacidade.

Para autenticação nativa, configure `VITE_API_MODE=api`, `VITE_AUTH_API_CONTRACT=native` e `VITE_API_BROWSER_PREFIX=` vazio, além da base e do proxy. Isso seleciona `/auth/me`; não adapta os DTOs dos demais módulos automaticamente. Reconhecer a permissão documental não converte a resposta nativa de documentos no DTO da projeção browser. Para documentos, trabalhadores e organização, use a projeção publicada acima ou conclua os adaptadores de dados antes de considerar a entrega integrada. A ausência de um destino reconhecido leva à conta conectada, sem encaminhar para Notificações sem permissão. A tela permite atualizar o acesso e conferir as permissões recebidas.

A projeção documental também aplica a política de acesso nativa, além dos escopos de empresa, unidade, setor e vínculo próprio. Dados restritos/médicos não são expostos por essa projeção. DTOs de leitura usam `sourceReadOnly: true` e `revision: null`; dados ausentes não são inventados. Escrita, upload, download, aprovação e módulos operacionais precisam de contratos próprios antes de serem habilitados na interface. A existência de endpoints nativos não significa que todos os fluxos da demonstração estejam integrados.

## Banco existente e validação

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
