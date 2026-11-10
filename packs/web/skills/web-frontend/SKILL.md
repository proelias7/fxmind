---
name: web-frontend
description: Builds web user interfaces with React, Next.js, Vue/Nuxt, Svelte/SvelteKit or Angular plus Tailwind/CSS. Covers component design, server vs client components, state management, data fetching in the UI, forms and validation, loading/empty/error states, styling and design systems, responsive layout and accessibility (WCAG). Use when the user mentions pages, components, UI, layout, CSS, Tailwind, forms, modals, dashboards, React, Vue, Svelte, Next.js or frontend.
---

# Web Frontend

> Load [accessibility.md](accessibility.md) for any interactive UI. General rules (security, API, performance, style, tests) live in [../web-development/SKILL.md](../web-development/SKILL.md).

Principles: U1–U3, A2, P2, C1–C5 from `.fxmind/policy/web-principles.md`.

## §1 Before writing UI

1. Find the **design system / component library** the project uses (`components/ui`, shadcn/ui, MUI, Chakra, Vuetify, PrimeVue, Angular Material) and reuse its primitives (Button, Input, Dialog) — never re-style a raw element that already exists as a component.
2. Find the closest existing page/component and copy its patterns (data loading, layout, naming, styling approach).
3. Check the styling approach (Tailwind, CSS Modules, styled-components, SCSS) and design tokens (theme colors, spacing, typography) — use tokens, not hardcoded hex/px.

## §2 Components (C1, C2)

- A component = one UI unit with a clear name and props; split when a part is reused or the file mixes unrelated concerns, not by line count.
- Props: typed, minimal, named by meaning (`onSave`, `isDisabled`); avoid boolean-prop explosions — compose with `children`/slots.
- Lists render with stable keys (ids, never array index for reorderable/editable lists).
- No side effects during render; effects only to sync with external systems (subscriptions, DOM APIs), not to derive state or fetch when the framework has a data mechanism.
- **React/Next App Router**: server components by default; `"use client"` only on leaves that need state, effects or browser APIs. Never import server-only modules (DB, secrets) into client components.
- **Vue**: `<script setup>` + composables; computed for derived data; `v-for` with `:key`; avoid `v-html` with user content.
- **Svelte**: runes/stores per the installed version; `load` functions for data.

## §3 State (A2)

| State | Tool |
|-------|------|
| Server data | server components / loaders / React Query / SWR / `useFetch` |
| URL-shareable (filters, page, tab) | search params / route params |
| Form | the form library (React Hook Form, Formik, VeeValidate, SvelteKit actions) |
| Local UI | `useState` / `ref` / `$state` |
| Global client (theme, session snapshot) | the existing store (Zustand, Redux, Pinia, context) |

- Derived values are computed, not stored. Don't mirror props into state.
- Global store only for state that is truly shared and client-owned.

## §4 Data views and async states (U2)

Every data view handles: **loading** (skeleton/spinner sized like the content), **empty** (message + next action), **error** (what happened + retry), **success**.

- Mutations: disable the trigger while pending, show success feedback, show errors next to the relevant field or as a toast/alert; keep user input on failure.
- Optimistic UI only with rollback.
- Use the framework's loading/error conventions (`loading.tsx`/`error.tsx`, Suspense boundaries, `<NuxtErrorBoundary>`).

## §5 Forms (S1, U1)

- Labels for every field (`<label for>` or wrapping); never placeholder-only.
- Client validation with the same schema as the server when possible (shared zod schema) — the server still validates.
- Show errors inline, linked with `aria-describedby`; move focus to the first error on submit.
- Correct input types and `autocomplete` (`email`, `tel`, `current-password`, `one-time-code`); `inputmode` for numeric data.
- Submit with a real `<button type="submit">` inside a `<form>` so Enter works.

## §6 Layout and styling (U3)

- Mobile first; test 360 px, tablet and desktop; no horizontal page scroll; touch targets ≥ 24–44 px.
- Use the layout primitives of the design system / Tailwind utilities consistently; avoid fixed heights for text containers; let text wrap.
- Respect dark mode/theme tokens if the project has them.
- Reserve space for images/embeds (`width`/`height`, aspect-ratio) to avoid layout shift.
- Animations: short, purposeful, respect `prefers-reduced-motion`.

## §7 Security in the UI (S3, S4)

- Never put secrets in client code or public env vars.
- Render user content as text; sanitize before any HTML injection API.
- Don't rely on hidden/disabled UI for permissions — the server decides; the UI only reflects it.

## §8 Verification (UI)

Open the page in a browser (dev server), exercise the changed flow, check the console (no errors/warnings introduced) and network (expected requests, no duplicates), tab through with the keyboard, check a narrow viewport. Build/typecheck alone does not prove the UI works.
