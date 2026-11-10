# Accessibility — web UI (U1)

Target WCAG 2.2 AA. References: MDN Accessibility, WAI-ARIA Authoring Practices (https://www.w3.org/WAI/ARIA/apg/).

## §1 Semantics first

- Actions are `<button>`; navigation is `<a href>`. Never a clickable `<div>`/`<span>` (no keyboard, no role).
- Structure with landmarks (`header`, `nav`, `main`, `footer`) and one `h1` per page with headings in order.
- Lists are `ul/ol`, tables for tabular data with `th` + `scope`.
- Use native elements (`<dialog>`, `<details>`, `<select>`, `<input type="checkbox">`) or the design system's accessible primitives (Radix, Headless UI, Reka, Angular CDK) before building custom widgets.

## §2 Accessible names

- Every interactive element has a name: visible text, `<label>`, or `aria-label` for icon-only buttons (`<button aria-label="Fechar">`).
- Images: meaningful `alt`; decorative images `alt=""`.
- Links say where they go ("Ver pedido #123", not "clique aqui").
- Don't duplicate names with redundant ARIA; ARIA only fills gaps (`aria-expanded`, `aria-controls`, `aria-current`, `aria-live`).

## §3 Keyboard and focus

- Everything operable with the keyboard: Tab order follows visual order; no positive `tabindex`.
- Visible focus indicator (never `outline: none` without a replacement).
- Dialogs: move focus inside on open, trap it, close with Esc, return focus to the trigger on close.
- Menus, tabs, comboboxes follow the APG keyboard patterns (arrow keys, Home/End).
- Skip link to main content on pages with long navigation.

## §4 Forms

- Labels tied to inputs; required fields marked in text, not only color.
- Errors in text, associated with `aria-describedby`, announced (`aria-live="polite"` or focus move); `aria-invalid` on invalid fields.
- Group related controls with `fieldset` + `legend` (radio groups, address blocks).

## §5 Visual

- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and UI component boundaries).
- Never convey information by color alone (add icon/text).
- Content works at 200% zoom and 320 px width without loss.
- Respect `prefers-reduced-motion`; no flashing content.

## §6 Dynamic content

- Loading and result messages announced via `aria-live` regions or `role="status"`/`role="alert"`.
- Route changes in SPAs move focus to the new page heading or announce the title (use the framework's support).
- Toasts that require action must be reachable and not disappear before they can be read.

## §7 Testing

- Query by role/label in component tests (`getByRole`) — failures there often reveal a11y bugs.
- Automated: `axe` (`@axe-core/playwright`, `vitest-axe`, Lighthouse) catches ~30–40% of issues.
- Manual pass for each changed flow: keyboard only, then zoom 200%, then a screen reader spot check when the change is significant.
