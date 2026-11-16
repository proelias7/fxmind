# fxmind — Task verification

Success requires observed behavior matching the user's request. A green build or a completion report alone cannot establish it. Applies to all domains and quick/full modes.

## Verification before closing

Review the task diff against Done and applicable pack rules. Confirm invariants for refactors, inspect error paths, remove unnecessary constants/helpers/files, debug remnants and unrelated churn. Do not replace required validation with cosmetic brevity.

For a defect, search the affected area for the same failure pattern (TWINS); fix in-scope equivalents or identify remaining sites. FiveM NUI CEF background bugs also inspect the whole resource's shell, popup/modal, styles and Vite output names using the relevant style reference.

Prioritize **lint/syntax, typecheck where applicable and code quality** on the actual changed code. Run the project's existing checks, then focused regression tests and build/runtime checks only where they establish Done. If no linter is configured, record the applicable syntax/static check; do not install tooling or invent a passing lint result. Tests must detect the original failure or assert observable behavior, not mirror the implementation. Reuse results only while the tested code is unchanged.

## UI: browser verification only for real interface changes

Assess the final diff and record `ui: { changed: boolean, reason: "specific diff-based explanation" }` in your verification notes. Browser verification is required only when the change actually alters rendered content, layout/styles or user interactions, including backend changes that alter those outcomes. Merely touching a frontend path, reviewing an unchanged UI file, having `ui_page` in a manifest, an installed UI skill, or an old task planning flag does not require opening an interface.

When rendered output and user interactions are preserved, backend-only code, tooling/config/tests, comments/formatting and behavior-preserving refactors use `ui.changed: false` with a reason. Complete lint/static checks and code review without opening a browser. A claim of no UI impact cannot exempt actual visual/interaction changes from validation.

For visual or interaction changes, use the available browser tool or installed browser automation to:

1. Start/reuse the project's documented local preview and open the actual affected route.
2. Reproduce the user's flow: click/type/submit/navigate and check the resulting state. Exercise relevant empty/loading/error states and a narrower viewport when layout is affected.
3. Capture and inspect a screenshot of the resulting UI. Check clipping, overlap, spacing, contrast and expected content; inspect console/runtime errors and relevant failed requests.
4. Correct observed defects, repeat the affected interactions and inspect a fresh screenshot after the final edit.
5. Save the screenshot or trace produced by the browser tool, preferably in OS temp, and record its path with URL, interactions and observations.

Do not substitute curl, source review, DOM assertions alone or a build for visual inspection. Never fabricate screenshots, traces or tool observations. If the browser/runtime/login is unavailable, finish feasible checks, record blocked evidence with the concrete reason and explain what remains. Do not describe the UI as verified.

FiveM NUI: browser preview checks web behavior; CEF-specific claims require the NUI open in-game, actual visual evidence and console/DOM evidence when available. Clean up temporary wire/probe before final validation. If only browser preview was possible, record the missing in-game verification as a blocked runtime check.

## Optional independent review

The `fxmind_independent_review` tool is available on request for complex or sensitive tasks. It does not run automatically and never blocks closing a task. If it reports findings, apply and verify the relevant corrections.

## Task completion

After A and B, run relevant checks, inspect the final diff, and close directly with `fxmind_record_gate { gate: "C", sessionId }`. This releases the task's path claims. Do not call Gate V; that mechanism was removed.

Keep checks in your task notes: command or interaction, expected result, actual result and limitations. Never claim a test or screenshot you did not obtain. For UI changes, record the real URL, interactions, observed visual state and any screenshot/trace path if available.

## Judge

Use Judge only when warranted by sensitive authorization, money, user data, unresolved intent or explicit proof requests; Judge does not require a separate review gate. If a critical check is blocked, report the blocker and do not claim success.
