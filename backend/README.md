# API Ampara SESMT

API .NET 10 com os projetos API, Application, Domain, Infrastructure e Tests. Nesta branch os fontes ficam em `backend/`, com o frontend React na raiz do mesmo repositório.

Origem: [SESMT-backend](https://github.com/ChancellorMarko/SESMT-backend), `main` no commit `3352263461780935099b7204697f615ebc2c06a6`, conciliada com as correções do pacote atualizado de backend (SHA-256 `156545c4be00d42e2e4a562780df06e335bfafb1ad82bed2904cc4f312773ec2`). Inclui as mudanças recentes da equipe em autenticação, administradores, auditoria e migrations, junto das correções de documentos, equipes e vínculo de contas. Configuração de desenvolvimento contém logging; credenciais são fornecidas pelo ambiente. Arquivos pessoais, relatórios acadêmicos, `.git` aninhado e artefatos compilados ficam fora desta cópia.

## Executar

Se estiver usando somente a pasta/ZIP do backend, copie `.env.example` para `.env` e configure conexão, chave JWT e bootstrap. O arquivo privado de configuração da prévia é separado dos fontes. No PowerShell desta pasta:

```powershell
. ./Iniciar-backend.ps1 -ImportOnly
dotnet tool restore
dotnet ef database update --project SESMT.Infrastructure --startup-project SESMT.API
./Iniciar-backend.ps1
```

`-CheckOnly` valida o arquivo sem importar as variáveis ou iniciar serviços. O .NET recebe variáveis de ambiente; ele não carrega `.env` sozinho. As migrações devem ser aplicadas no banco correto, após backup de dados existentes. A configuração local não transfere PostgreSQL, arquivos nem chaves de proteção de dados para outra máquina. Os comandos npm a seguir pertencem à versão conjunta com frontend.

Na raiz do repositório:

A API atual usa a inicial consolidada `20261101172752_InitialCreate`. Para uma instalação nova, utilize um banco vazio. Bancos com o histórico antigo precisam de conciliação administrativa do schema e do baseline de migrations, após backup, antes de executar `integration:migrate`. Preserve os dados e o histórico existentes; consulte [Banco existente e validação](../INTEGRACAO.md#banco-existente-e-validação).

```sh
npm ci
npm run integration:setup
npm run integration:db
npm run integration:migrate
npm run dev:integrated
```

Use PostgreSQL existente se preferir, configurando `.env.integration.local` e dispensando `integration:db`. O setup gera chaves/senhas locais aleatórias e conserva uma configuração que já exista. Os comandos npm desta branch selecionam esta pasta `backend/`, mesmo com uma localização externa antiga no arquivo local. Não versionar esse arquivo nem copiar valores operacionais para appsettings.

Frontend: `http://127.0.0.1:5175/login`. API: `http://127.0.0.1:5047`. A aplicação do banco usa as migrations existentes; não gere outra InitialCreate. Confira o destino e faça backup antes de migrar dados existentes.

As migrations adicionais desta entrega são `20261102014333_AddTeamOptimisticConcurrency`, `20261102020948_AddWorkerAccountBindingConcurrency`, `20261102192522_AddEquipmentControl` e `20261102194145_ExpandProfessionalHistoryReason`. Contas historicamente vinculadas a vários trabalhadores interrompem a migration de vínculo para revisão administrativa. A última migration amplia o motivo profissional para os 200 caracteres aceitos pelo formulário; seu downgrade bloqueia a redução se houver textos maiores que 50.

O módulo EPI publica `/equipment`, `/equipment/context`, `/equipment/deliveries` e o comando de devolução. Exige concessões `epi:ler`, `epi:criar` e `epi:editar` por ação, com isolamento de empresa/unidade e vínculo próprio. Preserva os dados do equipamento no histórico da entrega, revisão concorrente e auditoria. Não consulta CA automaticamente, não gera assinatura do trabalhador e não libera PT por registrar uma entrega.

Agenda e designações usam `agenda:ler/criar/editar` e `designacao:ler/editar`. Editar PT não concede administração desses recursos. `/appointments/{id}/responsibles` oferece somente profissionais designados para a atividade, sem exigir administração de usuários. Os perfis padrão têm concessões explícitas no seeder; perfis customizados dependem dos vínculos de permissão e escopo registrados no banco.

Treinamentos administrativos usam `/trainings`, `/trainings/context`, `/{id}/history` e `/{id}/revoke`, com `treinamento:ler/criar/editar`, alcance por empresa/unidade/setor e vínculo próprio. A migration `20261103113512_AddTrainingRecords` cria `core.treinamento_registro`, sem substituir o histórico anterior. Registros têm revisão, prevenção de comando duplicado e auditoria; invalidação preserva o registro. Certificação, assinaturas e liberação de PT não são realizadas por esse cadastro.

## Verificar

```sh
dotnet build backend/SESMT.slnx -c Release
npm run integration:check-schema
npm run test:backend
```

Os testes relacionais exigem `SESMT_TEST_POSTGRES_ADMIN` apontando para `postgres` de uma instância exclusiva de testes em loopback. As fixtures criam e removem somente bancos `sesmt_it_*`. Sem a variável, esses cenários ficam explicitamente ignorados. O workflow Backend CI fornece PostgreSQL efêmero e executa os testes a partir desta pasta.

O snapshot conciliado, com gestão nativa de acessos, hierarquia da sessão e edição profissional do trabalhador, passou por build Release e 462 testes, incluindo cenários PostgreSQL com migrations e schema reais em bancos descartáveis. Os cenários cobrem também a carga idempotente de exemplos, leitura administrativa global e isolamento das PTs do trabalhador. A conciliação de um banco legado depende do schema e do histórico efetivamente presentes nesse banco. Na raiz, `npm run test:access:real` verifica cadastro organizacional, contas, edição profissional e login por cargo em outro banco descartável, sem MSW; consulte os requisitos em INTEGRACAO.md.

Para criar a imagem da API, use `docker build -f backend/SESMT.API/Dockerfile backend`. A configuração de conexão, JWT, bootstrap, SMTP e armazenamento deve ser fornecida no ambiente de execução.

Consulte [INTEGRACAO.md](../INTEGRACAO.md) para contratos, permissões, fluxos disponíveis e pendências. A incorporação do código não homologa as contas, o armazenamento ou a implantação com dados reais. Revisão final/PDF da PT, troca/desvinculação de conta e demais pendências documentadas continuam exigindo seus fluxos próprios.
