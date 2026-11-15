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
