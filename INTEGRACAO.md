# Ampara · integração frontend e backend

Estado em 26/10/2026. Frontend na raiz; backend .NET 10 em `SESMT-backend/`. A integração foi iniciada na branch **Teste** e reunida na **main**, preservando as alterações locais, inclusive o primeiro acesso demonstrativo. Arquivos de compilação e configurações locais permanecem fora do versionamento.

## Revisão do contrato em 28/10/2026

O [levantamento de sessão por cookie e rotas](docs/frontend/contrato-cookie-e-rotas.md) registra a referência publicada auditada da [main do backend independente no commit 134d5bb](https://github.com/ChancellorMarko/SESMT-backend/tree/134d5bb8dcdb40f9ef50a84e16668abe77c5f3f2), consultada em 28/10/2026. Os controllers de autenticação e PT e o `Program.cs` mantêm os mesmos contratos da revisão anterior `b34b30e`. Os estados e números de validação registrados nas seções históricas abaixo pertencem ao adaptador integrado local; não comprovam o funcionamento desta `main` da API.

Após essa auditoria, o responsável informou ter corrigido o backend localmente, ainda sem commit, e solicitou explicitamente o commit do frontend em nova branch. A entrega do frontend é registrada em `codex/frontend-main-auth-compat`. As divergências abaixo descrevem a referência publicada auditada; a homologação com as correções locais do backend permanece uma etapa separada.

O frontend já não armazena refresh token no `SessionDto` e já envia refresh/logout sem corpo. O cliente agora valida e normaliza a resposta HTTP com `expiresAtUtc` para o formato interno `accessExpiresAt`, preservando a resposta anterior do adaptador; isso não substitui um contrato de identidade completo compatível com `MeDto`. O `/auth/me` nativo da `main` retorna somente `userId` e não autoriza a criação de permissões ou escopos fictícios.

As mudanças de prefixo de PT descritas na nota já estão na `main` de referência. Além dos caminhos, os DTOs de checklist, detalhe completo, templates e abertura por agendamento diferem. `/app/pts` continua sendo uma rota da interface. A mudança desses contratos precisa ser validada contra a API em execução.

Na `main` de referência, o cookie HttpOnly `sesmt_refresh` tem `SameSite=Strict` e `Path=/api/v1/auth/refresh`; ele não acompanha `/api/v1/auth/logout`, que precisa lê-lo para revogar a sessão. Essa correção depende do backend: usar um caminho comum `/api/v1/auth`, como o adaptador local já faz, e manter a remoção do cookie coerente. O frontend não consegue corrigir o `Path` de um cookie HttpOnly.

O login da `main` também rotaciona `sesmt_csrf`, com `Path=/api/v1/auth`, sem devolver o novo token no JSON. O cliente agora consulta `GET /auth/csrf` novamente após login/MFA concluído e antes de estabelecer a sessão; manter o token obtido antes do login pode causar `CSRF_INVALID` no refresh. A etapa de MFA precisa seguir o contrato efetivamente implantado. A configuração CORS dessa `main` permite apenas `http://localhost:5173` e `http://localhost:4173`. Para o frontend aberto em `http://127.0.0.1:5174`, usar a base relativa `/api/v1` pelo proxy Vite já configurado; acesso direto à API depende de ajuste do CORS no backend. Uma base absoluta deve incluir `/api/v1`.

Os testes de cliente com respostas controladas continuam ativos: a falta de um endpoint real não é motivo para ignorar um teste do transporte. Testes de cookies em navegador com servidor controlado também não substituem a validação com a API e o banco reais.

O cliente seleciona os caminhos de autenticação conforme o ambiente. Em modo API, o contrato `native` é o padrão: identidade em `/auth/me`, recuperação em `/auth/forgot-password` e redefinição em `/auth/reset-password`. O contrato `adapter` preserva `/me` e `/auth/password/forgot` e `/auth/password/reset`. A nova senha exige pelo menos 12 caracteres, com orientação acessível antes do envio. Não há repetição automática de comandos em caminhos alternativos.

Uma identidade incompleta ou inválida mantém o acesso bloqueado e apresenta orientação para procurar o administrador. O cliente exige usuário, permissões e escopo explícitos; não cria esses dados a partir dos perfis do login. MFA nativo retorna apenas `403` com `MFA_REQUIRED`, sem protocolo de desafio/verificação; a interface explica a necessidade de verificação adicional sem abrir uma etapa fictícia. A autenticação JWT ainda pode responder `401` sem o código `TOKEN_EXPIRED` esperado para renovação automática durante o uso. Esse protocolo e o caminho do cookie de logout continuam pendentes no backend.

Na revalidação anterior (`f152b6c`), `npm run typecheck` passou e cinco arquivos focados em autenticação aprovaram 118/118 testes. Os resultados da implementação atual são registrados no levantamento de contrato acima; os resultados dos commits anteriores permanecem históricos.

A revisão `134d5bb` também alterou o gerador de links de recuperação: o serviço usa `?token=...` e a configuração consultada aponta para `/reset-password`. A interface atual usa `/redefinir-senha#token=...`. Portanto o acesso pelo link enviado ainda exige conciliar rota e transporte do código. As rotas de API e o preenchimento manual do código já são selecionáveis, mas isso não comprova que o link recebido abre a tela correta.

As alterações do frontend passaram no build, em 3.048 testes de unidade e em 16 cenários de navegador (9 dos contratos de API e 7 demonstrativos). Esses testes usam dados e serviços controlados. A autorização posterior para registrar o frontend em nova branch não representa, por si só, a homologação das correções locais do backend.

## Escolher o contrato de autenticação

Para a API independente da `main`, configure o ambiente local do Vite e reinicie o servidor:

```dotenv
VITE_API_MODE=api
VITE_AUTH_API_CONTRACT=native
VITE_API_BASE_URL=/api/v1
API_PROXY_TARGET=http://127.0.0.1:5047
```

A porta do exemplo deve corresponder ao serviço de desenvolvimento em execução. A `main` de referência ainda retorna identidade reduzida, portanto o login permanece bloqueado após a conferência do perfil até que o backend disponibilize o contrato completo. Isso não impede a interface de usar as rotas nativas de recuperação de acesso.

O comando `npm run dev:integrated` seleciona explicitamente `VITE_AUTH_API_CONTRACT=adapter` para o backend incluído neste repositório. Quem inicia o Vite manualmente com esse backend deve selecionar `adapter` também. No modo `demo`, o contrato dos dados sintéticos é usado automaticamente. O comando `integration:smoke` continua destinado ao adaptador local e não é um aceite da API independente.

## O que está conectado

O contrato de navegador `/api/v1` adapta os serviços existentes do backend para o protocolo do frontend:

| Recurso | Comportamento |
| --- | --- |
| `GET /api/v1/auth/csrf` | Cookie protegido e token CSRF para requisições de sessão |
| `POST /api/v1/auth/login` | Credenciais validadas pelo serviço existente; JWT em memória no frontend |
| `POST /api/v1/auth/refresh` | Rotação pelo serviço existente, usando cookie HttpOnly; token de renovação fora do JSON |
| `POST /api/v1/auth/logout` | Revogação pelo serviço existente e remoção do cookie |
| `GET /api/v1/me` | Identidade, perfis e referências diretas de escopo consultados no banco |

O CSRF usa seu par protegido cookie/token independentemente da identidade bearer transitória. O cookie de refresh tem `HttpOnly`, `SameSite=Strict`, caminho `/api/v1/auth` e `Secure` fora de Development ou em HTTPS. As rotas nativas anteriores continuam com seus contratos originais; o frontend integrado consome exclusivamente `/api/v1` pelo proxy de mesma origem.

O `/me` retorna `permissions: []` enquanto os módulos não têm contratos compatíveis. Após entrar, a tela **Conta conectada** apresenta a identidade real e informa essa etapa. Não se atribuem permissões operacionais fictícias para abrir telas que ainda não possuem endpoints compatíveis. MFA exigido permanece bloqueado, sem um desafio fictício. Conta de trabalhador com vínculo ausente ou ambíguo também permanece bloqueada.

## Executar localmente

Requisitos: Node.js ≥22.12, npm, SDK .NET 10 e PostgreSQL. Docker com Compose é uma alternativa para executar somente o banco. As portas desta integração são **5175** (frontend), **5047** (API) e **5434** (PostgreSQL local opcional). O comando não encerra serviços que já estejam usando essas portas.

```powershell
npm.cmd ci
npm.cmd run integration:setup
```

O setup cria `.env.integration.local`, ignorado pelo Git, com chave JWT, senha do banco e credenciais do administrador local geradas aleatoriamente. Rodar novamente preserva o arquivo existente. Abra esse arquivo local para consultar o e-mail e a senha inicial. Essas credenciais pertencem exclusivamente ao ambiente local de integração. Se o administrador já existe no banco, mudar o arquivo não altera sua senha.

Com Docker disponível:

```powershell
npm.cmd run integration:db
```

Esse comando cria o banco dedicado `ampara_integration` e um volume próprio. Não aponta para o banco antigo do backend. Se já usa PostgreSQL instalado, prepare um banco de desenvolvimento e ajuste `ConnectionStrings__Sesmt` em `.env.integration.local`. Confira o destino antes de aplicar migrations.

```powershell
npm.cmd run integration:migrate
npm.cmd run dev:integrated
```

O primeiro comando restaura a ferramenta EF com versão definida e aplica as migrations existentes. Não cria outra `InitialCreate`. O segundo verifica a conexão TCP do banco, inicia a API, aguarda seu endpoint de saúde e abre o Vite com `VITE_API_MODE=api`, sem MSW. A configuração privada permanece no processo do servidor; variáveis públicas `VITE_*` contêm apenas configuração do cliente. O `appsettings.Development.json` recebido permanece local e é ignorado; as variáveis explícitas do ambiente integrado prevalecem.

Abra **http://127.0.0.1:5175/login** e use as credenciais locais. `Ctrl+C` encerra os processos iniciados pelo comando. A demonstração pode continuar separadamente em outra porta, por exemplo `npm.cmd run dev -- --port 5174`.

## Verificação e evidência

```powershell
npm.cmd run build
npm.cmd run test:backend
npm.cmd run integration:check-schema
npx.cmd vitest run src/features/auth/ConnectedAccountPage.test.tsx src/shared/auth/SessionProvider.test.tsx src/shared/api/client.test.ts src/app/navigation/page-title.test.ts --pool=threads --maxWorkers=1
npm.cmd run test:connection-ui
```

Os testes HTTP do backend usam TestServer, antiforgery real e JWT assinado, substituindo os repositórios/serviços por doubles controlados. Exercitam o protocolo, os cookies e os bloqueios; não comprovam migrations ou persistência PostgreSQL.

O check de schema compara o modelo EF com o snapshot das migrations, sem aplicar alterações no banco. O teste de navegador usa respostas HTTP controladas para validar login, redirecionamento, restauração, saída, ausência de atalhos para módulos pendentes e responsividade em 320px; também não comprova persistência. Evidências visuais locais: `docs/frontend/qa/integration-connected-desktop.png` e `docs/frontend/qa/integration-connected-mobile.png`.

Validação local desta etapa: build do frontend aprovado; 82 testes backend aprovados (70 existentes e 12 HTTP novos); 77 testes frontend aprovados em cinco arquivos, incluindo 33 cenários de navegação; um cenário Playwright aprovado em desktop e 320px, com restauração e saída; comparação EF sem alterações pendentes no modelo. Os workflows na raiz passam a contemplar o backend e a tela de conexão, mas ainda não foram executados no GitHub nesta etapa.

Com banco, migrations e os dois processos em execução, rode em outro terminal:

```powershell
npm.cmd run integration:smoke
```

Esse smoke atravessa o proxy Vite e a API real: recusa login sem CSRF, entra com o administrador local, consulta identidade, renova, encerra e verifica que a sessão encerrada não renova. Não usa MSW nem substitui os repositórios. As credenciais nunca são impressas pelo script.

Na máquina desta implementação, o SDK .NET está disponível, mas não foi encontrado Docker e o PostgreSQL configurado em `localhost:5433` não estava acessível. Portanto, a execução completa com PostgreSQL e o smoke real continuam **pendentes de validação**. `/health` apenas comprova que o processo respondeu; não é uma verificação específica do banco.

## Próximos contratos a adaptar

| Área | Diferença encontrada / trabalho necessário |
| --- | --- |
| Organização e usuários | DTOs, paginação, perfis/permissões, escopos por empresa/unidade e revisão diferem do frontend |
| Documentos e trabalhadores | Harmonizar listagem, detalhe, arquivos, versões e políticas; aplicar isolamento e autorização no servidor |
| Agenda, equipes e PT | IDs, participantes, estados, revisão e rotas diferem; preservar a elegibilidade e validar cada transição no servidor |
| ASO, AT e PET | Não habilitar telas por semelhança de nome; homologar os contratos e o tratamento dos dados sensíveis |
| Primeiro acesso | Frontend demonstrativo recuperado; convites, entrega, aceite persistente e MFA ainda dependem do backend |
| Recuperação de senha | Frontend já renova CSRF, confirma a solicitação sem revelar existência de conta e aceita código manual ou `#token`. Backend nativo existente; contrato de navegador e entrega de e-mail ainda dependem de adaptação/homologação |
| Escopo | `/me` apresenta referências diretas; expansão de empresa em unidades e equipes ainda precisa de contrato explícito |

Endpoints de navegador ainda ausentes retornam erro JSON `INTEGRATION_PENDING` com status 501. As permissões devem ser habilitadas junto da implementação, autorização e validação de cada contrato. O upload isolado continua sem poder liberar um trabalhador.

## Histórico e versionamento

A pasta recebida era um repositório Git próprio. Seu histórico foi preservado localmente em `.git/integration-backups/SESMT-backend-5b42993.git`, antes de incorporar os fontes como arquivos normais no repositório principal. A origem e o commit estão em `SESMT-backend/ORIGEM.md`. O backup não é enviado ao remoto; o histórico original permanece no repositório de origem. Os commits da integração foram criados na branch `Teste` e incorporados à `main` do repositório principal.
