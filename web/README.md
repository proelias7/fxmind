# Dashboard FXMIND

Interface de gerenciamento do FXMIND. **Não inclui chat**: as conversas continuam nos CLIs (Claude, Codex, OpenCode, Cursor etc.).

## Código-fonte

A dashboard tem fonte versionada neste repositório, em `web/dashboard/`:

- `index.html`: barra superior (projeto e três destinos) e a barra única de salvar;
- `dashboard.js`: telas, integração com as APIs locais e rascunhos das configurações;
- `memory-graph.js`: Canvas interativo das memórias;
- `orchestration-canvas.js`: mapa de roteamento da orquestração;
- `controls.js`: seletor acessível usado no lugar do `<select>` nativo;
- `design-system.css`: tokens e controles; `dashboard.css`: layout.

`web/dist/` é gerado por `npm run build:web` e incluído no pacote npm. O antigo bundle React de chat foi removido.

## Execução

```bash
npm run build:web
fxmind painel
# ou para desenvolver sem Vite:
npm run dev
```

Abre `http://localhost:3847/` direto no Canvas de memórias do projeto ativo.

## Telas

- **Memórias** (`/`): o Canvas ocupa a tela inteira. Busca e o modo (memórias ou fragmentos) flutuam sobre ele; os detalhes de um nó só aparecem quando ele é selecionado.
- **Orquestração** (`/orchestration`): o mapa é o editor. Selecione um agente ou o roteador para editar no painel ao lado.
- **Configurações** (`/settings`): agente, revisão, subagentes e provedores em uma página só.

Não há botão de salvar por seção: qualquer alteração pendente mostra a barra **Salvar / Descartar**. As rotas do layout anterior (`/overview`, `/agents`, `/subagents`, `/providers`, `/projects`) continuam abrindo a tela correspondente.

## Configurações

A fonte de verdade continua sendo o FXMIND, sem duplicar ajustes no navegador:

- configurações globais em `~/.fxmind/panel.json`;
- configurações de orquestração do projeto em `.fxmind/orchestration.json`;
- a dashboard utiliza as APIs `/api/orchestration/*`, `/api/settings/*`, `/api/cli/models`, `/api/projects` e `/api/health`.

O plugin Claude mantém apenas suas preferências de chat, com um link **Painel** para a dashboard local.

A dashboard é servida apenas no loopback, pela aplicação FXMIND. Não exponha essa API diretamente na internet sem autenticação e proteção apropriadas.

## Design system

A dashboard usa a identidade visual da página oficial em `docs/index.html`:
- `web/dashboard/design-system.css`: tokens oficiais (`#0d0f14`, `#131821`, `#7ee0b4`), Nunito e Geist Mono, botões em pílula, campos, seletor, alternadores;
- `web/dashboard/logo.png` e `favicon.png`: cópias byte a byte dos arquivos oficiais em `docs/assets/`;
- `dashboard.css`: somente layout e comportamento responsivo.

Regras do layout: páginas planas divididas por linhas finas, sem cards dentro de cards; uma ação primária por tela; nenhuma cor fora dos tokens. Os testes em `scripts/lib/dashboard.test.js` e `scripts/lib/dashboard-impeccable.test.js` verificam os tokens, os arquivos de marca e essas regras.

## Canvas de memórias

Interações: arrastar, zoom (roda do mouse, pinça ou botões), busca (Enter seleciona o primeiro resultado), seleção de nó, navegação pelas ligações no painel de detalhes e Esc para fechar. **Fragmentos** exibe fatos atômicos, sua proveniência e recursos relacionados.

O endpoint `GET /api/projects/:id/graph/view?mode=memories|fragments` produz uma projeção compacta do índice existente, limitada a 420 nós, sem enviar os milhares de símbolos de código ao navegador. **Gerar grafo** só aparece quando o projeto ainda não tem grafo e só executa por ação explícita.

Arquivos: `scripts/lib/panel-graph-view.js` e `web/dashboard/memory-graph.js`.

## Orquestração

O mapa exibe **regras de roteamento configuradas**; não representa as dependências reais de uma execução. A edição dos nós salva por meio da API de orquestração existente.
