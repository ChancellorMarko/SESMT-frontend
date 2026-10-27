# Contrato de sessão por cookie e rotas — 27/10/2026

## O que já existe no frontend

O `SessionDto` interno contém `accessToken`, `tokenType` e `accessExpiresAt`. Ele não contém `refreshToken` nem `refreshTokenExpiresAtUtc`, e o login não usa `setRefreshToken`. O access token permanece em memória.

`renewSession()` envia `POST /auth/refresh` sem corpo. A saída envia `POST /auth/logout` sem corpo. O cliente usa `credentials: 'include'` nas requisições de sessão e o header `X-CSRF-Token` nas mutações, a partir do token recebido por `GET /auth/csrf`. O frontend não precisa e não deve ler o cookie HttpOnly de renovação.

Os convites públicos demonstrativos têm uma política separada, sem credenciais ou renovação da sessão de quem abriu o link. Isso não comprova que a mesma funcionalidade já existe no backend independente.

## Formato HTTP e formato interno

A nota recebida corresponde ao [AuthController da branch marcos-dev](https://github.com/ChancellorMarko/SESMT-backend/blob/marcos-dev/SESMT.API/Controllers/AuthController.cs), confirmado em 27/10/2026 pelo blob `7a590e3b533538c618c2cca23efaf8830adeedab`. Login e refresh retornam `accessToken`, `expiresAtUtc`, `userId`, `roles` e `scopes`, enquanto o refresh token vai somente no cookie. A fronteira HTTP agora valida esse formato e normaliza a expiração para `accessExpiresAt`, conservando o formato interno usado pelo restante da aplicação. A resposta do adaptador integrado local continua aceita.

Nenhum dos formatos exige refresh token no JSON. Normalizar a resposta não significa persistir tokens, copiar campos desconhecidos para a sessão ou conceder permissões a partir dos nomes dos perfis.

O frontend ainda precisa de um contrato de identidade completo, compatível com `MeDto`, para obter usuário, permissões e escopo. O `GET /auth/me` nativo da `main` consultada retorna apenas `userId`; a `marcos-dev` mantém essa resposta reduzida. Isso não equivale ao `GET /api/v1/me` do adaptador integrado. Não é seguro transformar os `roles`/`scopes` do login em permissões operacionais ou inventar unidades acessíveis.

## Cookies, CSRF, proxy e CORS

- O backend deve criar e renovar os cookies; o navegador administra seu armazenamento e envio. A aplicação usa o token CSRF do JSON para montar o header, sem depender de acesso JavaScript ao cookie.
- A `marcos-dev` usa double-submit: o refresh compara o cookie `sesmt_csrf` com o header `X-CSRF-Token`. Esse cookie tem `Path=/api/v1/auth`, `SameSite=Strict` e `Secure`. O adaptador integrado local usa antiforgery do ASP.NET Core. A presença do mesmo nome de endpoint não torna os dois protocolos automaticamente equivalentes.
- O login da `marcos-dev` rotaciona o cookie CSRF sem retornar o novo valor no JSON. Após login/MFA concluído, o frontend agora faz outro `GET /auth/csrf`, antes de estabelecer a sessão, e usa esse token nas mutações seguintes. Manter o token obtido antes do login gera um par cookie/header divergente. Isso não comprova a existência de um fluxo MFA completo nessa branch.
- O refresh cookie da `marcos-dev` chama-se `sesmt_refresh`, é HttpOnly, `SameSite=Strict`, `Secure` e tem `Path=/api/v1/auth/refresh`. Esse caminho não acompanha a chamada a `/api/v1/auth/logout`. O logout consulta o mesmo cookie para revogar a sessão, portanto o backend precisa corrigir o caminho para `/api/v1/auth` e usar o mesmo caminho ao removê-lo, ou implementar outro mecanismo explícito de revogação. Essa é uma pendência do backend; o frontend não pode alterar o `Path` de um cookie HttpOnly. O adaptador incluído neste repositório já usa o caminho comum.
- O frontend integrado pode usar a base relativa `/api/v1` e o proxy Vite, com `API_PROXY_TARGET` definido no ambiente local. O proxy não implementa endpoints ou adapta DTOs ausentes.
- Se a base da API for absoluta, ela deve incluir o prefixo esperado, inclusive `/api/v1` quando esse for o contrato implantado. Informar somente a origem/porta altera o caminho final de todas as chamadas.
- Em acesso direto entre origens, o backend precisa permitir a origem efetiva do frontend e credenciais. Um wildcard de origem não substitui a configuração de CORS com cookies. `Domain`, `Path`, `SameSite`, `Secure` e o protocolo real também precisam ser compatíveis.

Configurações privadas e credenciais não pertencem a variáveis públicas `VITE_*`. As origens devem vir da configuração do ambiente; este documento não determina endereços ou credenciais de implantação.

## Rotas: main e marcos-dev confirmadas

Na consulta de 27/10/2026 ao [controller da main do backend independente](https://github.com/ChancellorMarko/SESMT-backend/blob/main/SESMT.API/Controllers/WorkPermitsController.cs), o arquivo ainda tinha `[Route("work-permits")]` e as rotas absolutas abaixo. O `Program.cs` da `main` consultada usa `AddControllers`/`MapControllers`, sem uma convenção global que acrescente `/api/v1` a essas rotas.

O [WorkPermitsController da marcos-dev](https://github.com/ChancellorMarko/SESMT-backend/blob/marcos-dev/SESMT.API/Controllers/WorkPermitsController.cs), blob `f7a83aadcb8f62fd97f210b2efbfbf85f5633cf7`, remove as barras iniciais e agrupa essas ações sob `work-permits`. O [Program.cs dessa branch](https://github.com/ChancellorMarko/SESMT-backend/blob/marcos-dev/SESMT.API/Program.cs), blob `a0ad5dc3c0c3b1cacff1410a48c26feb77c5bee0`, usa `UsePathBase("/api/v1")`. Assim, a `marcos-dev` confirma os caminhos descritos na nota:

| Recurso | Arquivo da `main` consultado | Caminho na `marcos-dev` confirmada |
| --- | --- | --- |
| Serviços | `/services` | `/api/v1/work-permits/services` |
| Templates de PT | `/pt-templates` | `/api/v1/work-permits/pt-templates` |
| Abertura por agendamento | `/appointments/{id}/pt` | `/api/v1/work-permits/appointments/{id}/pt` |
| Checklist da PT | `/pts/{id}` | `/api/v1/work-permits/pts/{id}` |

A branch correspondente à nota está confirmada: `marcos-dev`. Isso não confirma sua implantação nem muda o contrato atual da `main`. O adaptador `/api/v1` incluído na pasta `SESMT-backend/` deste repositório é uma integração própria; ele não prova que o backend independente executado tenha as mesmas rotas ou respostas.

No frontend atual, `/app/pts` e suas páginas de detalhe/impressão são rotas da interface, não URLs da API. Elas não devem ser renomeadas por causa de uma mudança no controller.

Também existem diferenças de conteúdo que uma troca de caminho não resolve:

- O detalhe completo usa `/work-permits/{id}` e espera `WorkPermitDto`, com atendimento, situação operacional, revisão e ações. O `/pts/{id}` nativo retorna um checklist, com outro contrato.
- A ação demonstrativa de abertura usa `/appointments/{id}/open-permit`. A abertura nativa `/appointments/{id}/pt`, agrupada sob `/api/v1/work-permits` na `marcos-dev`, exige `templateVersions` e `participantIds`; encaminhar o corpo vazio da demonstração não atende a essa entrada.
- A configuração demonstrativa usa `/service-templates` e um `ServiceCatalogDto` composto, com rascunho e publicação. Ela não é intercambiável com a lista nativa de `/pt-templates`.
- As demais operações de agenda têm contratos próprios. Não se deve mover todo o grupo `/appointments/*` para `/work-permits/*` apenas porque uma ação de abertura mudou de prefixo.

As rotas operacionais só devem ser adaptadas após conferir a versão implantada, entradas, respostas, autorização, paginação e conflitos. A demonstração deve continuar identificada e funcional enquanto esses contratos são homologados.

## Por que os testes de cliente continuam ativos

Os testes citados na nota usam respostas HTTP controladas ou `fetch` simulado. Eles verificam comportamento do cliente: credenciais de convites, ausência de renovação indevida, `PUT`, headers de revisão/idempotência, preservação de erros e coordenação de refresh. A ausência desses endpoints no servidor real não invalida esses testes e não é motivo para adicionar `it.skip`.

Enviar `If-Match` ou `Idempotency-Key` não comprova que o backend aplica concorrência ou deduplicação. Essa garantia precisa ser testada também no servidor correspondente. O frontend não deve apresentar um teste de transporte como aceite da regra persistente.

Testes de navegador com servidor HTTP controlado podem verificar o armazenamento e envio efetivo de cookies, inclusive HttpOnly e caminhos. Eles comprovam o comportamento do navegador nesse cenário; não homologam o backend de produção, seu banco, CORS ou sua política de sessão. Um mock de `fetch` que devolve um header `Set-Cookie` sozinho não testa o cookie jar do navegador.

## Validação do frontend nesta alteração

- `npm run build`: TypeScript e build aprovados.
- `npm test`: 2.995 testes aprovados em 182 arquivos; nenhum teste foi desativado nesta alteração.
- `npm run test:connection-ui`: 6 cenários aprovados, incluindo cookies reais no navegador por um proxy Vite e uma API HTTP controlada, CSRF rotacionado no login, saída imediata sem recarga e restauração com rotação do refresh cookie.
- `npm run test:e2e -- tests/e2e/auth-continuity.spec.ts tests/e2e/login-experience.spec.ts --project=chromium`: 7 cenários demonstrativos aprovados, incluindo login, MFA, recuperação, animações e uso em 320px.

O servidor controlado usa dados fictícios e HTTP local. Esses resultados não comprovam a configuração de cookies `Secure`, CORS ou o funcionamento da API .NET independente. O script `integration:smoke` foi atualizado para os dois formatos de sessão e para a ressincronização CSRF, mas não foi executado contra essa API nesta alteração.

## Pendências para aceite integrado

1. Validar a revisão efetivamente implantada da `marcos-dev`, incluindo um contrato de identidade completo compatível com `MeDto`.
2. Corrigir no backend o caminho do refresh cookie para o logout e validar login, rotação, renovação do CSRF após autenticação e revogação com os cookies realmente implantados.
3. Conferir origem/base/proxy e CORS no ambiente de execução, sem expor credenciais.
4. Adaptar e homologar os contratos operacionais de PT, templates e agenda antes de habilitar suas permissões no modo API.
5. Validar `If-Match` e idempotência no servidor antes de declarar garantidas essas regras.

Essas pendências não exigem desativar os testes válidos da demonstração ou do cliente.
