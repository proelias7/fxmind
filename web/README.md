# Dashboard FXMIND

Interface de gerenciamento do FXMIND. **Não inclui chat**: as conversas continuam nos CLIs (Claude, Codex, OpenCode, Cursor etc.).

## Código-fonte

A dashboard agora tem fonte versionada neste repositório, em `web/dashboard/`:

- `index.html`: estrutura e navegação;
- `dashboard.css`: design responsivo;
- `dashboard.js`: integração com APIs locais e formulários.

`web/dist/` é gerado por `npm run build:web` e incluído no pacote npm. O antigo bundle React de chat foi removido.

## Execução

```bash
npm run build:web
fxmind painel
# ou para desenvolver sem Vite:
npm run dev
```

Abre `http://localhost:3847/` com gestão de orquestração, CLIs, modelos, subagentes, provedores, projetos e estado da memória.

## Configurações

A fonte de verdade continua sendo o FXMIND, sem duplicar ajustes no navegador:

- configurações globais em `~/.fxmind/panel.json`;
- configurações de orquestração do projeto em `.fxmind/orchestration.json`;
- a dashboard utiliza as APIs `/api/orchestration/*`, `/api/settings/*`, `/api/cli/models`, `/api/projects` e `/api/health`.

O plugin Claude mantém apenas suas preferências de chat, com um link **Painel** para a dashboard local.

A dashboard é servida apenas no loopback, pela aplicação FXMIND. Não exponha essa API diretamente na internet sem autenticação e proteção apropriadas.

## Design system

A dashboard usa a identidade visual da página oficial em `docs/index.html`:
- `web/dashboard/design-system.css`: tokens oficiais (`#0d0f14`, `#131821`, `#7ee0b4`), Nunito e Geist Mono, superfícies, navegação, campos e botões;
- `web/dashboard/logo.png` e `favicon.png`: cópias byte a byte dos arquivos oficiais em `docs/assets/`;
- `dashboard.css`: somente layout e comportamento responsivo. As regras de identidade estão em `design-system.css`.

Os testes em `scripts/lib/dashboard.test.js` verificam os tokens e a identidade dos arquivos de marca para impedir divergências futuras.
## Canvas de memórias

Em **Projetos e memória → Canvas**, é possível explorar ligações confirmadas das memórias do projeto. O modo **Memórias e ligações** mostra os tópicos principais; **Fragmentos detalhados** exibe fatos atômicos, sua proveniência e recursos relacionados. Interações: arrastar, zoom, busca, seleção de nó, painel com arquivo e linha de origem.

O endpoint `GET /api/projects/:id/graph/view?mode=memories|fragments` produz uma projeção compacta do índice existente, limitada a 420 nós, sem enviar os milhares de símbolos de código ao navegador. O botão **Gerar grafo** só executa uma reconstrução por ação explícita.

Arquivos: `scripts/lib/panel-graph-view.js`, `web/dashboard/memory-graph.js` e `memory-graph.css`.