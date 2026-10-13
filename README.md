# Ampara SESMT — Frontend

Aplicação React e TypeScript para agenda de serviços, gestão documental, equipes e Permissões de Trabalho (PT), Autorizações de Trabalho (AT) e preparação de PETs de espaços confinados. Versão: **0.5.0**.

O backend e o banco de dados pertencem a outro repositório. O modo padrão usa dados sintéticos em memória, interceptados no navegador pelo MSW. Recarregar a página restaura a demonstração e encerra sua sessão.

## Executar

Requisitos: Node.js 22.12 ou superior e npm.

```powershell
npm ci
npm run dev
```

Abra http://127.0.0.1:5173 e escolha um perfil de demonstração no login. As contas fictícias usam `Demo123!`; o administrador tem MFA ilustrativo com o código `123456`. Os botões `Engenheiro` e `Gestor SESMT` usam a mesma conta de demonstração.

## Funcionalidades

- Painéis de agenda, indicadores documentais, vencimentos e pendências.
- Agendamentos com múltiplos serviços, equipes, participantes e funções no serviço.
- Catálogo dos cinco serviços de PT, com perguntas editáveis, respostas bloqueadoras, rascunhos e publicação de templates por unidade.
- Documentos com metadados, arquivos, versões, revisão, aprovação e publicação.
- Trabalhadores, movimentações e estrutura organizacional.
- Matriz documental por unidade, serviço, função e local, com publicação versionada.
- PT: preparação, checklist, ciências, liberação, execução, suspensão, retomada, encerramento, revisão e correções com histórico.
- AT: preparação, ciências, autorização, revalidação, suspensão, cancelamento, encerramento e impressão.
- PET: preparação de rascunhos, pessoas e papéis previstos, verificações, controles, leituras atmosféricas, histórico e impressão por revisão.
- Notificações, auditoria demonstrativa, políticas documentais e administração de acessos.
- Identidade Ampara, fontes locais, navegação responsiva e proteção de formulários contra descarte acidental.

Rotas principais: `/app/dashboard`, `/app/agenda`, `/app/pts`, `/app/ats`, `/app/pets`, `/app/equipes`, `/app/documentos`, `/app/trabalhadores`, `/app/pendencias`, `/app/vencimentos` e `/app/configuracoes/requisitos`. O painel documental está em `/app/painel-documental`.

## Demonstração operacional

Técnicos e bombeiros operam atendimentos designados; o engenheiro revisa o encerramento da PT. Administradores gerenciam acessos, agenda e configurações. RH, auditor e trabalhador consultam conforme o escopo do perfil.

`AG-DEMO-220` tem uma evidência aguardando conferência e permite explorar o bloqueio documental. `AG-DEMO-221` possui requisitos conferidos para explorar o fluxo da PT. `PT-DEMO-230` já está concluída para explorar revisão e devolução. É possível sair e entrar com outro perfil sem recarregar para conservar os registros sintéticos.

Abrir atendimento inicia a conferência. Upload isolado permanece pendente; a execução exige liberação e requisitos conferidos. Os parâmetros de demonstração são ilustrativos. Nome e desenho são representações visuais, sem assinatura criptográfica. Informações restritas exibem apenas o mínimo administrativo. Rascunhos e impressões da PET não autorizam entrada em espaço confinado.

## Integração com a API

Copie `.env.example` para `.env.local`, selecione `VITE_API_MODE=api` e configure `VITE_API_BASE_URL`. Para desenvolvimento com proxy, configure `API_PROXY_TARGET`. Reinicie o Vite após alterar variáveis.

O frontend usa token em memória, CSRF, permissões, contexto por unidade e controle de revisão nas alterações. Endpoints, cookies, autenticação, regras e persistência precisam de homologação com o backend real. A demonstração não emite JWT real nem realiza antivírus ou auditoria persistente.

Os contratos consumidos estão em [`src/shared/contracts`](src/shared/contracts), incluindo os DTOs de [PT](src/shared/contracts/work-permits.ts), [AT](src/shared/contracts/work-authorizations.ts) e [PET](src/shared/contracts/confined-space-permits.ts).

O catálogo de serviços está em `/app/configuracoes/servicos`. Os contratos propostos de templates usam `GET /service-templates`, `PATCH /service-templates/{serviceId}/draft` e `POST /service-templates/{serviceId}/publish`, sempre com `unitId`; alterações exigem `If-Match`. Agendamentos novos enviam `serviceTypeIds` e o primeiro ID em `serviceTypeId` para compatibilidade. Registros antigos usam o campo único quando o conjunto não existe. A elegibilidade reúne as regras de todos os serviços, enquanto cada PT preserva os templates publicados na sua abertura, inclusive em correções e impressão. As perguntas e evidências iniciais são sintéticas e não estabelecem critérios legais de SST.

## Testes e build

```powershell
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_CHANNEL='chrome' # Usa o Chrome instalado.
npm run test:e2e
```

Para usar o Chromium gerenciado pelo Playwright, execute `npx playwright install chromium` e não defina `PLAYWRIGHT_CHANNEL`. Os testes de navegador usam a demonstração local; capturas e PDFs produzidos pelos testes ficam fora do versionamento.

## Estrutura

- `src/app`: rotas e layout.
- `src/features`: telas e fluxos por módulo.
- `src/shared`: componentes, sessão, cliente HTTP e contratos.
- `src/mocks`: dados sintéticos e respostas da demonstração.
- `public`: imagens utilizadas, fontes e licenças, service worker do MSW.
- `tests/e2e`: fluxos completos no navegador; testes unitários ficam junto ao código.

O repositório inclui os arquivos do sistema e suas ferramentas de execução e teste. Referências pessoais, documentos originais recebidos, relatórios locais e resultados gerados ficam excluídos pelo `.gitignore`.
