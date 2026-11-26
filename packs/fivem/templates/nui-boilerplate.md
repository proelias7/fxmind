# NUI boilerplate — start every new FiveM interface from it

Repo: https://github.com/proelias7/fivem-nui-boilerplate (React 18 + TS + Vite 5 + Tailwind 3.4.17 + Zustand). It already encodes every CEF rule of `fivem-react-nui`; its own `AGENTS.md` is binding for the generated UI.

## When
- **New interface / new resource with UI** → scaffold from the boilerplate. Never hand-build `vite.config.ts`, `nui.lua`, providers or hooks from scratch.
- **Existing resource that needs a UI** → `--ui-only`.
- **Editing an existing UI** → keep its structure; use the boilerplate only as the reference for the patterns below.

## Scaffold
```bash
git clone https://github.com/proelias7/fivem-nui-boilerplate   # once, outside the resources folder
node fivem-nui-boilerplate/create.mjs "resources/[local]/<resource>"             # full resource
node fivem-nui-boilerplate/create.mjs "resources/[local]/<resource>" --ui-only   # UI + src/client/nui.lua only
cd "resources/[local]/<resource>/src/ui/project" && pnpm install && pnpm dev     # browser, simulated data
pnpm build                                                                       # writes src/ui/build (what FiveM loads)
```
`create.mjs` never overwrites existing files and renames `package.json`/title after the folder. If the clone is missing, ask before cloning.

## What it provides (reuse, do not rewrite)
| Piece | File | Use |
|---|---|---|
| `Nui.Open/Close/Send/Notify` | `src/client/nui.lua` | Lua bridge; focus handled, `removeFocus` callback, focus released on resource stop. Load first in `client_scripts`. |
| `VisibilityProvider` / `useVisibility()` | `providers/Visibility.tsx` | Screens opened by `setNui`; ESC closes and returns focus. |
| `ThemeProvider` / `setTheme()` | `providers/Theme.tsx` | `--main-color` from `public/config.ui.json` or Lua. |
| `useObserve` / `Post.create` / `useListen` | `hooks/` | Lua→UI events, UI→Lua callbacks (with browser mock), DOM events. |
| `useConfig` | `hooks/useConfig.ts` | Reads `config.ui.json` (in game: `src/ui/build/config.ui.json`, editable without rebuild). |
| `Debugger` | `utils/debugger.ts` | Simulates Lua in the browser (`isEnvBrowser()`). |
| `Panel`, `Button`, `Tabs`, `Notifications` | `components/` | CEF-safe base components. |
| `useAppStore` | `stores/` | Zustand store example (one store per domain). |

## Adding a screen
1. Add the name to `UIMode` in `src/types.ts`.
2. Add a `case` in `AppContent` (`src/app.tsx`).
3. Open it from Lua: `Nui.Open("<name>", data)`.
4. Cover it in the `Debugger` of `main.tsx` and give each `Post.create` a mock.
5. Independent modules (HUD, Notify, Progress, world overlays) go **outside** `VisibilityProvider`, without `SetNuiFocus`.

## Non-negotiable (inherited from the boilerplate)
- `rem` only, no animations/transitions, no `backdrop-filter`/`blur`/`drop-shadow`, opaque hex panel fills, no Tailwind v4, no CDN fonts/scripts.
- Every `RegisterNUICallback` calls `cb({...})` with a table, always.
- Server validates everything; the UI only asks.
- Before delivering: `pnpm build` clean, tested in browser and in game (ESC returns focus).
