# Ampara · integração frontend e backend

Estado em 24/10/2026, branch **Teste**. Frontend na raiz; backend .NET 10 em `SESMT-backend/`. A branch já existia e foi reutilizada, preservando as alterações locais, inclusive o primeiro acesso demonstrativo. A integração é versionada nesta branch; o envio ao remoto é uma etapa separada.

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

A pasta recebida era um repositório Git próprio. Seu histórico foi preservado localmente em `.git/integration-backups/SESMT-backend-5b42993.git`, antes de incorporar os fontes como arquivos normais no repositório principal. A origem e o commit estão em `SESMT-backend/ORIGEM.md`. O backup não é enviado ao remoto; o histórico original permanece no repositório de origem. Os commits da integração pertencem à branch `Teste` do repositório principal.
