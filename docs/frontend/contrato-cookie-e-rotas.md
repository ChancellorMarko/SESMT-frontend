# Contrato de sessão por cookie e rotas — 28/10/2026

Referência publicada auditada: [main do backend no commit 134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2](https://github.com/ChancellorMarko/SESMT-backend/tree/134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2), consultada em 28/10/2026. Os controllers de autenticação e PT e o `Program.cs` mantêm os mesmos blobs da revisão anterior `b34b30e`, que reuniu a PR #24 da `marcos-dev`. Os arquivos foram consultados nesse SHA imutável. Leitura do código publicado não comprova qual revisão da API está em execução.

Após a auditoria, o responsável informou ter corrigido o backend localmente, ainda sem commit, e autorizou explicitamente o registro do frontend em nova branch. As diferenças descritas neste documento pertencem à referência publicada auditada; não são uma avaliação das correções locais informadas. A branch de entrega do frontend é `codex/frontend-main-auth-compat`.

## O que já existe no frontend

O `SessionDto` interno contém `accessToken`, `tokenType` e `accessExpiresAt`. Ele não contém `refreshToken` nem `refreshTokenExpiresAtUtc`, e o login não usa `setRefreshToken`. O access token permanece em memória.

`renewSession()` envia `POST /auth/refresh` sem corpo. A saída envia `POST /auth/logout` sem corpo. O cliente usa `credentials: 'include'` nas requisições de sessão e o header `X-CSRF-Token` nas mutações, a partir do token recebido por `GET /auth/csrf`. O frontend não precisa e não deve ler o cookie HttpOnly de renovação.

Os convites públicos demonstrativos têm uma política separada, sem credenciais ou renovação da sessão de quem abriu o link. Isso não comprova que a mesma funcionalidade já existe no backend independente.

## Seleção dos caminhos de autenticação

O modo API usa `VITE_AUTH_API_CONTRACT=native` por padrão. O adaptador incluído no repositório pode ser selecionado com `VITE_AUTH_API_CONTRACT=adapter`; o comando `dev:integrated` já faz essa seleção. O modo demonstrativo continua com seu contrato sintético, independentemente dessa opção.

| Operação | Contrato `native` | Contrato `adapter` |
| --- | --- | --- |
| Identidade | `/auth/me` | `/me` |
| Solicitar recuperação | `/auth/forgot-password` | `/auth/password/forgot` |
| Redefinir senha | `/auth/reset-password` | `/auth/password/reset` |

Os caminhos são relativos à base `/api/v1`. O cliente seleciona um contrato antes de enviar a requisição; não tenta repetir comandos de senha em endpoints alternativos. Depois de alterar o ambiente, reinicie o servidor Vite.

A redefinição valida o mínimo de 12 caracteres antes de obter CSRF ou enviar a senha. A dica é associada ao campo para leitores de tela. O formulário preserva código e preenchimento quando a validação falha e não remove espaços da senha.

## Formato HTTP e formato interno

A nota recebida corresponde ao [AuthController da main de referência](https://github.com/ChancellorMarko/SESMT-backend/blob/134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2/SESMT.API/Controllers/AuthController.cs), reconferido em 28/10/2026 pelo blob `7a590e3b533538c618c2cca23efaf8830adeedab`. Login e refresh retornam `accessToken`, `expiresAtUtc`, `userId`, `roles` e `scopes`, enquanto o refresh token vai somente no cookie. A fronteira HTTP agora valida esse formato e normaliza a expiração para `accessExpiresAt`, conservando o formato interno usado pelo restante da aplicação. A resposta do adaptador integrado local continua aceita.

Nenhum dos formatos exige refresh token no JSON. Normalizar a resposta não significa persistir tokens, copiar campos desconhecidos para a sessão ou conceder permissões a partir dos nomes dos perfis.

O frontend ainda precisa de um contrato de identidade completo, compatível com `MeDto`, para obter usuário, permissões e escopo. O `GET /api/v1/auth/me` nativo da `main` de referência retorna apenas `userId`. Isso não equivale ao `GET /api/v1/me` do adaptador integrado. O cliente valida essa resposta antes de liberar acesso: perfil incompleto, inválido ou endpoint ausente apresenta uma orientação para procurar o administrador e mantém a sessão local sem permissões. Falhas transitórias da API preservam sua mensagem. Não é seguro transformar os `roles`/`scopes` do login em permissões operacionais ou inventar unidades acessíveis.

## Cookies, CSRF, proxy e CORS

- O backend deve criar e renovar os cookies; o navegador administra seu armazenamento e envio. A aplicação usa o token CSRF do JSON para montar o header, sem depender de acesso JavaScript ao cookie.
- A `main` de referência usa double-submit: o refresh compara o cookie `sesmt_csrf` com o header `X-CSRF-Token`. Esse cookie tem `Path=/api/v1/auth`, `SameSite=Strict` e `Secure`. O adaptador integrado local usa antiforgery do ASP.NET Core. A presença do mesmo nome de endpoint não torna os dois protocolos automaticamente equivalentes.
- O login da `main` rotaciona o cookie CSRF sem retornar o novo valor no JSON. Após login/MFA concluído, o frontend agora faz outro `GET /auth/csrf`, antes de estabelecer a sessão, e usa esse token nas mutações seguintes. Manter o token obtido antes do login gera um par cookie/header divergente. Isso não comprova a existência de um fluxo MFA completo nessa API.
- O refresh cookie da `main` chama-se `sesmt_refresh`, é HttpOnly, `SameSite=Strict`, `Secure` e tem `Path=/api/v1/auth/refresh`. Esse caminho não acompanha a chamada a `/api/v1/auth/logout`. O logout consulta o mesmo cookie para revogar a sessão, portanto o backend precisa corrigir o caminho para `/api/v1/auth` e usar o mesmo caminho ao removê-lo, ou implementar outro mecanismo explícito de revogação. Essa é uma pendência do backend; o frontend não pode alterar o `Path` de um cookie HttpOnly. O adaptador incluído neste repositório já usa o caminho comum.
- O frontend integrado pode usar a base relativa `/api/v1` e o proxy Vite, com `API_PROXY_TARGET` definido no ambiente local. O proxy não implementa endpoints ou adapta DTOs ausentes.
- Se a base da API for absoluta, ela deve incluir o prefixo esperado, inclusive `/api/v1` quando esse for o contrato implantado. Informar somente a origem/porta altera o caminho final de todas as chamadas.
- Em acesso direto entre origens, o backend precisa permitir a origem efetiva do frontend e credenciais. Um wildcard de origem não substitui a configuração de CORS com cookies. `Domain`, `Path`, `SameSite`, `Secure` e o protocolo real também precisam ser compatíveis.
- O CORS da `main` de referência permite somente `http://localhost:5173` e `http://localhost:4173`. O frontend observado em `http://127.0.0.1:5174` deve usar a base relativa `/api/v1` pelo proxy Vite já configurado. O navegador então conversa com sua própria origem; a configuração de proxy precisa apontar para a API correta. Chamar a API diretamente dessa origem exige ajuste de CORS no backend.

Configurações privadas e credenciais não pertencem a variáveis públicas `VITE_*`. As origens devem vir da configuração do ambiente; este documento não determina endereços ou credenciais de implantação.

## Rotas na main de referência

O [WorkPermitsController da main](https://github.com/ChancellorMarko/SESMT-backend/blob/134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2/SESMT.API/Controllers/WorkPermitsController.cs), blob `f7a83aadcb8f62fd97f210b2efbfbf85f5633cf7`, usa `[Route("work-permits")]` e caminhos relativos nas ações abaixo. O [Program.cs da mesma revisão](https://github.com/ChancellorMarko/SESMT-backend/blob/134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2/SESMT.API/Program.cs), blob `a0ad5dc3c0c3b1cacff1410a48c26feb77c5bee0`, usa `UsePathBase("/api/v1")`. A referência vigente confirma os caminhos descritos na nota:

| Recurso | Caminho na `main` de referência |
| --- | --- |
| Serviços | `/api/v1/work-permits/services` |
| Templates de PT | `/api/v1/work-permits/pt-templates` |
| Abertura por agendamento | `/api/v1/work-permits/appointments/{id}/pt` |
| Checklist da PT | `/api/v1/work-permits/pts/{id}` |

O adaptador `/api/v1` incluído na pasta `SESMT-backend/` deste repositório é uma integração própria. Suas respostas e permissões não substituem os contratos da `main` independente, mesmo quando os caminhos se parecem.

No frontend atual, `/app/pts` e suas páginas de detalhe/impressão são rotas da interface, não URLs da API. Elas não devem ser renomeadas por causa de uma mudança no controller.

Também existem diferenças de conteúdo que uma troca de caminho não resolve:

- O detalhe completo usa `/work-permits/{id}` e espera `WorkPermitDto`, com atendimento, situação operacional, revisão e ações. O `/pts/{id}` nativo retorna um checklist, com outro contrato.
- A ação demonstrativa de abertura usa `/appointments/{id}/open-permit`. A abertura nativa `/appointments/{id}/pt`, agrupada sob `/api/v1/work-permits` na `main`, exige `templateVersions` e `participantIds`; encaminhar o corpo vazio da demonstração não atende a essa entrada.
- A configuração demonstrativa usa `/service-templates` e um `ServiceCatalogDto` composto, com rascunho e publicação. Ela não é intercambiável com a lista nativa de `/pt-templates`.
- As demais operações de agenda têm contratos próprios. Não se deve mover todo o grupo `/appointments/*` para `/work-permits/*` apenas porque uma ação de abertura mudou de prefixo.

As rotas operacionais só devem ser adaptadas após conferir a versão implantada, entradas, respostas, autorização, paginação e conflitos. A demonstração deve continuar identificada e funcional enquanto esses contratos são homologados.

## Outras lacunas de autenticação na main

| Fluxo | Frontend/adaptador local | API nativa da `main` de referência |
| --- | --- | --- |
| Solicitar recuperação | `POST /auth/password/forgot` | `POST /api/v1/auth/forgot-password` |
| Redefinir senha | `POST /auth/password/reset` | `POST /api/v1/auth/reset-password` |
| MFA | Fluxo demonstrativo com desafio e verificação | Login retorna `403` com `ErrorDto.code=MFA_REQUIRED`; não foi identificado protocolo de desafio ou endpoint de verificação correspondente |
| Renovar após expiração durante o uso | Cliente renova automaticamente quando recebe `401` com `code=TOKEN_EXPIRED` | Autenticação JWT padrão pode responder `401` sem esse código, portanto essa resposta não aciona a mesma renovação |

Os corpos de recuperação são compatíveis em seus campos básicos (`{ email }` e `{ token, newPassword }`), e os retornos nativos de sucesso são `202` e `204`, respectivamente. A seleção de contrato agora direciona os caminhos correspondentes. O backend exige nova senha com pelo menos 12 caracteres, requisito também validado na interface. A entrega de mensagens continua sendo responsabilidade do serviço de recuperação; os testes controlados não enviam e-mails.

O erro `MFA_REQUIRED` sozinho não fornece um desafio verificável. No contrato nativo, a interface orienta a procurar o administrador para concluir a verificação adicional. Não inventa identificador, código, confirmação de MFA ou sessão autenticada. É necessário definir o protocolo real antes de conectar esse fluxo ao modo API.

A diferença na resposta JWT impede concluir que a renovação automática durante o uso está integrada. O aceite precisa definir como distinguir expiração de credencial inválida ou revogação, e testar essa resposta contra o cliente. Alterar todos os `401` para uma renovação indiscriminada não está validado por esta análise. Os testes controlados de refresh e o fluxo de restauração de sessão não comprovam esse comportamento da API nativa.

O contrato demonstrativo de MFA continua disponível. A seleção de caminhos mantém a recuperação do adaptador local, e o comportamento de renovação automática não foi ampliado para todos os erros `401`.

## Link de recuperação alterado na main 134d5bb

O [serviço de recuperação dessa revisão](https://github.com/ChancellorMarko/SESMT-backend/blob/134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2/SESMT.API/Services/SmtpPasswordResetNotificationService.cs), blob `17c6747370ed00e3888ac75a86024322617c8c7c`, passou a montar `${ResetUrl}?token=...`. A configuração consultada aponta a rota `/reset-password`. A aplicação atual oferece `/redefinir-senha` e importa o código do fragmento `#token`, portanto esse link ainda não abre o fluxo correto automaticamente.

A compatibilização precisa definir a URL da aplicação e a forma de transportar/importar o código. O sucesso de testes com código preenchido manualmente não é aceite do link enviado. Nenhuma configuração de envio de e-mail foi alterada ou mensagem real foi enviada nesta tarefa.

## Por que os testes de cliente continuam ativos

Os testes citados na nota usam respostas HTTP controladas ou `fetch` simulado. Eles verificam comportamento do cliente: credenciais de convites, ausência de renovação indevida, `PUT`, headers de revisão/idempotência, preservação de erros e coordenação de refresh. A ausência desses endpoints no servidor real não invalida esses testes e não é motivo para adicionar `it.skip`.

Enviar `If-Match` ou `Idempotency-Key` não comprova que o backend aplica concorrência ou deduplicação. Essa garantia precisa ser testada também no servidor correspondente. O frontend não deve apresentar um teste de transporte como aceite da regra persistente.

Testes de navegador com servidor HTTP controlado podem verificar o armazenamento e envio efetivo de cookies, inclusive HttpOnly e caminhos. Eles comprovam o comportamento do navegador nesse cenário; não homologam o backend de produção, seu banco, CORS ou sua política de sessão. Um mock de `fetch` que devolve um header `Set-Cookie` sozinho não testa o cookie jar do navegador.

## Validação anterior do frontend no commit e9e52b9

Os resultados abaixo pertencem à verificação anterior do frontend, antes da revalidação da `main` no SHA `b34b30ee8cdd717b0c7daf4305139b4186f54635`. Somam 2.995 testes de unidade e 13 cenários de navegador com respostas ou servidores controlados; não são resultados de uma execução integrada com essa API .NET.

- `npm run build`: TypeScript e build aprovados.
- `npm test`: 2.995 testes aprovados em 182 arquivos; nenhum teste foi desativado naquela alteração.
- `npm run test:connection-ui`: 6 cenários aprovados, incluindo cookies reais no navegador por um proxy Vite e uma API HTTP controlada, CSRF rotacionado no login, saída imediata sem recarga e restauração com rotação do refresh cookie.
- `npm run test:e2e -- tests/e2e/auth-continuity.spec.ts tests/e2e/login-experience.spec.ts --project=chromium`: 7 cenários demonstrativos aprovados, incluindo login, MFA, recuperação, animações e uso em 320px.

O servidor controlado usa dados fictícios e HTTP local. Esses resultados não comprovam a configuração de cookies `Secure`, CORS ou o funcionamento da API .NET independente. O script `integration:smoke` foi atualizado para os dois formatos de sessão e para a ressincronização CSRF, mas não foi executado contra essa API na verificação anterior. A rodada atual também não executa smoke test com a API .NET e o banco reais; uma nova validação focada do frontend continua sendo um teste controlado.

## Revalidação anterior contra a referência main (f152b6c)

Naquela rodada, o código-fonte publicado no SHA `b34b30ee8cdd717b0c7daf4305139b4186f54635` foi comparado ao frontend. `npm run typecheck` passou e os cinco arquivos `client.test`, `session-response.test`, `SessionProvider.test`, `AuthPages.test` e `ConnectedAccountPage.test` aprovaram 118/118 testes.

Esses testes usaram cenários controlados; nenhuma API .NET ativa foi homologada. A suíte completa e os testes de navegador não foram repetidos naquela revalidação, que alterou somente documentação. Os 2.995 testes de unidade e 13 cenários de navegador do commit `e9e52b9` permanecem registrados somente como histórico.

## Validação das alterações e entrega do frontend

- Build do frontend e TypeScript aprovados.
- Suíte completa: 3.048 testes aprovados em 184 arquivos.
- Navegador, contratos de API: 9 cenários aprovados, sendo 6 do adaptador e 3 do contrato nativo com servidor HTTP controlado.
- Navegador, demonstração: 7 cenários de login, MFA, recuperação, animações e uso em 320px aprovados.

O teste de restauração foi corrigido para consultar o aviso com papel acessível `status`; o erro de uma tentativa de login continua sendo verificado como `alert`. O comportamento do runtime não precisou ser alterado para essa correção.

As verificações acima não homologam a API .NET independente. O pedido inicial de commit estava condicionado à compatibilidade com o backend. Após informar a correção local do backend, o responsável solicitou explicitamente o commit das mudanças do frontend em nova branch. O registro em `codex/frontend-main-auth-compat` segue essa autorização; as correções locais do backend ainda precisam de homologação com a aplicação em execução.

## Pendências para aceite integrado

1. Validar a API em execução contra a `main` de referência, incluindo um contrato de identidade completo compatível com `MeDto`.
2. Corrigir no backend o caminho do refresh cookie para o logout e validar login, rotação, renovação do CSRF após autenticação e revogação com os cookies realmente implantados.
3. Conferir origem/base/proxy e CORS no ambiente de execução, sem expor credenciais.
4. Adaptar e homologar os contratos operacionais de PT, templates e agenda antes de habilitar suas permissões no modo API.
5. Validar `If-Match` e idempotência no servidor antes de declarar garantidas essas regras.
6. Homologar as rotas de recuperação já selecionáveis no frontend e um protocolo MFA real antes de conectar a verificação à API.
7. Definir e validar a resposta de expiração JWT que dispara a renovação automática, distinguindo sessão expirada de credencial inválida ou revogada.
8. Conciliar a rota e o transporte do código no link de redefinição gerado pela revisão `134d5bb` e testar o acesso a partir desse link.

Essas pendências não exigem desativar os testes válidos da demonstração ou do cliente.
