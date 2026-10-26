# Backend incorporado à branch de integração

Origem: https://github.com/ChancellorMarko/SESMT-backend.git

Referência recebida: `main`, commit `5b42993` (Merge pull request #18 from usuarios-permissoes-isolamento).

Nesta branch `Teste`, os fontes passam a ser versionados pelo repositório principal, junto do frontend. Não é um submódulo. O diretório Git original foi preservado localmente em `.git/integration-backups/SESMT-backend-5b42993.git`; ele não é publicado. Nenhum commit do repositório de origem foi alterado ou enviado.

O `appsettings.Development.json` recebido permanece local e ignorado pelo repositório principal. A execução conjunta usa variáveis de ambiente próprias, descritas em `INTEGRACAO.md` na raiz. Arquivos `bin`, `obj`, storage e configurações locais não devem ser versionados.
