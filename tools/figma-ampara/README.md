# Ampara SESMT · Figma

Arquivo real: [Ampara SESMT · Produto e componentes](https://www.figma.com/design/hCWLv9vUe1nWFx8LdRY7GX).

Concluído e verificado em 22/10/2026: 30 telas selecionadas em desktop e mobile, um mapa de navegação para cada formato, 86 componentes, 62 variáveis e 622 conexões do protótipo com transições. As páginas finais são Sistema Ampara, Desktop e Mobile. A captura temporária foi removida após a comparação.

O design parte do frontend e dos estados selecionados da demonstração em 21/10/2026. Preserva a logo original, Inter, azul Ampara e superfícies em branco quente. O conteúdo representa o frontend demonstrativo; não comprova integração com API, persistência nem autorização operacional.

## Fontes e reprodução

- `screens-operation.json` e `screens-management.json`: 30 telas selecionadas e links de navegação.
- `build-bundle.mjs`: combina os conteúdos, valida os destinos e extrai os vetores originais de `DashboardHero.tsx` e `lucide-react`.
- `bundle.json`: conteúdo e assets usados na construção.
- `generator.js`: criação das bases e dos componentes com Figma Plugin API.
- `renderer.js`: composição das telas com instâncias da biblioteca existente.
- `figma-state.json`: arquivo, captura de referência e identificadores de continuidade.
- `audit-page.js`: inspeção de fontes, instâncias, vetores, imagens e elementos colapsados.
- `desktop-final-audit.json` e `mobile-final-audit.json`: verificação final das páginas; apenas fontes Inter, sem imagens de telas inteiras, textos fora dos frames ou destinos inválidos.

Para atualizar o conteúdo local:

```powershell
node tools/figma-ampara/build-bundle.mjs
```

Os hashes das imagens pertencem ao arquivo Figma indicado. Não são URLs públicas nem substituem o upload dos assets em outro arquivo. A criação por fases usa os IDs retornados pela fase anterior; executar novamente sem consultar o estado pode duplicar conteúdo.

## Limites

O conjunto cobre telas representativas para desktop e celular. Não inclui todos os estados de formulários, permissões, validações e erros do aplicativo. Os links do protótipo navegam entre as telas incluídas; as ações não executam operações reais.

Os arquivos `ui.html`, `manifest.template.json` e `prepare-plugin.mjs` pertencem à alternativa local preparada antes da conexão. Não são necessários para acessar o arquivo criado no Figma e não constituem um plugin publicado.
