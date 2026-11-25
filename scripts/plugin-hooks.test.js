"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const hooks = path.join(__dirname, "..", "plugins", "fxmind", "hooks");
const read = (name) => fs.readFileSync(path.join(hooks, name), "utf8");

test("Claude mod registers unfiltered lifecycle hooks only once", () => {
  const sources = ["effort.tsx", "refine.tsx", "orchestration.tsx"].map(read);
  for (const event of ["session.start", "tool.call", "turn.complete"]) {
    const escaped = event.replace(".", "\\.");
    const regex = new RegExp("on\\(['\"]" + escaped + "['\"]\\s*,", "g");
    const count = sources.reduce((sum, source) => sum + [...source.matchAll(regex)].length, 0);
    assert.equal(count, 1, event + " should have exactly one registering module");
  }
  const registration = read("register.tsx");
  assert.match(registration, /registerEffort\(on, options\)/);
  assert.doesNotMatch(registration, /registerOrchestration\(/);
});

test("Orchestration does not access unsupported Claude host APIs directly", () => {
  const source = read("orchestration.tsx");
  assert.doesNotMatch(source, /(?:const|let)\s+\w+\s*=\s*\$\.fs(?:\s|;|as)/);
  assert.doesNotMatch(source, /\$\.fs\.stat\(/);
});

test("Settings opens before loading slow project config and CLI skills", () => {
  const source = read("effort.tsx");
  const settings = source.slice(source.indexOf("async function openPluginSettings("));
  assert.ok(settings.indexOf("await update($, settingsOpen, () => true)") <
            settings.indexOf("void loadInstalledSkills($)"));
  assert.ok(settings.indexOf("await update($, settingsOpen, () => true)") <
            settings.indexOf("void readProjectOrchestrationConfig($)"));
});

test("Claude plugin never renders or submits Gate V again", () => {
  const source=read("effort.tsx");
  for(const forbidden of ["settings-gate-v","gatev-title","gatev-review","gatev-skip","markGateV(","readGateVAsk(","answerGateV(","gate-v-choice.json","gate-v-pending.json"]){
    assert.equal(source.includes(forbidden),false,forbidden);
  }
  const config=read("refine.tsx");
  assert.doesNotMatch(config,/verify and review \(Gate V\)/);
});

test("All settings pages share a full-panel FXMIND texture", () => {
  const ui = read("effort.tsx");
  const art = read("brand-mark.ts");
  assert.match(ui, /textureLayer\(\{ Box, Svg \}, [\x27"]settings[\x27"], true\)/);
  // Sized to the band: the desktop draws nothing for an Svg wider than its box.
  assert.match(ui, /textureSvg\(width, height, BRAND_EDGE\)/);
  assert.match(ui, /const width = fitPx\(960\)/);
  assert.match(art, /TEXTURE_TALL_SVG = textureSvg\(960, 160\)/);
  assert.match(art, /fxdots/);
});
test("Cards remain dark; only primary actions are light and readable on hover", () => {
  const ui = read("effort.tsx");
  const overview = ui.slice(ui.indexOf('key="settings-cards"'), ui.indexOf('key={`settings-${card}`}', ui.indexOf('key="settings-cards"')));
  assert.match(overview, /backgroundColor=\{term \? DASH_BG : DASH_HEAD\}/);
  assert.match(overview, /borderColor=\{DASH_EDGE\}/);
  assert.match(overview, /backgroundColor: CARD_HOVER, borderColor: CARD_HOVER_EDGE/);
  assert.match(overview, /rowIconSvg\(c\.id, ACCENT\)/);
  assert.match(overview, /color=\{DASH_TEXT\} bold/);
  assert.doesNotMatch(overview, /#292220|#30262c|#f3f8f4/);
  const action = ui.slice(ui.indexOf('const panelAction ='), ui.indexOf('const skillNames ='));
  // Primary: white with dark ink. Quiet (secondary): an outline with light ink.
  assert.match(action, /backgroundColor=\{quiet \? '#ffffff0a' : '#f5f8f5'\}/);
  assert.match(action, /color=\{quiet \? DASH_TEXT : '#0b1610'\} bold=\{!quiet\}/);
  assert.match(action, /hover=\{\{ backgroundColor: "#00000000" \}\}/);
  // Looking for updates is secondary: a white "Updates" read as "an update is waiting".
  assert.match(ui, /panelAction\("settings-check-update", "Check for updates", \(\) => checkUpdateNow\(\$\), undefined, true\)/);
  assert.match(ui, /panelAction\("settings-update", "Update " \+ checking\.slice\(6\)/);
  for (const key of ["settings-check-update", "settings-back", "settings-save"]) {
    assert.ok(ui.includes('panelAction(') && ui.includes(key), key);
  }
  assert.match(ui, /<Button key=\{"settings-model-" \+ c.value\} variant="secondary"/);
  assert.doesNotMatch(ui, /panelAction\("settings-model-"/);
});

test("Handoff CTA stays white and text stays dark, while Compact remains secondary", () => {
  const ui = read("effort.tsx");
  assert.match(ui, /handoffPillSvg\(handoffLevel\(\), false, handoffSlot\(\)\)/);
  assert.match(ui, /handoffPillSvg\(handoffLevel\(\), true, handoffSlot\(\)\)/);
  assert.match(ui, /handoffSlot\(\) \? '#111715' : handoffLook\(handoffLevel\(\)\)\.label/);
  assert.match(ui, /fill: hovered \? '#e5ece7' : '#f5f8f5'/);
});


test("FXMIND texture SVG is visibly nonempty at modal dimensions", async () => {
  const { textureSvg } = require('../plugins/fxmind/hooks/brand-mark.ts');
  const sharp = require('sharp');
  const svg = textureSvg(960, 160, '#9d5642');
  const { data, info } = await sharp(Buffer.from(svg)).extract({ left: 180, top: 15, width: 760, height: 130 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] > 24) visible++;
  assert.ok(visible / (info.width * info.height) > .10, 'texture should cover a visible portion of the actual modal area');
  assert.match(svg, /fxdots/);
  assert.match(svg, /#9d5642/);
});


test("Agents settings render per-role CLI and model pickers and a custom ID input", () => {
  const ui = read("effort.tsx");
  assert.match(ui, /settings-orch-model-/);
  assert.match(ui, /orchestrationModelOptions\(provider\)/);
  assert.match(ui, /onSelect: v => setRuleProvider\(idx, v\)/);
  assert.match(ui, /setRuleModel\(idx, v === MODEL_DEFAULT \? null : v\)/);
  assert.match(ui, /model: r.provider === nextProvider \? r.model : null/);
  assert.match(ui, /settings-orch-model-role/);
  assert.match(ui, /settings-orch-model-id/);
  assert.match(ui, /sanitizeOrchestrationModel\(v\)/);
  assert.match(ui, /writeProjectOrchestrationConfig\(\$, savedOrch\)/);
});

test("Claude settings expose only chat preferences and a real link to management dashboard", () => {
  const source = read("effort.tsx");
  const cards = source.slice(source.indexOf("const CARDS:"), source.indexOf("const MODEL_CHOICES", source.indexOf("const CARDS:")));
  // Judge stays: its key and test are chat-local and the web dashboard has no place for them.
  for (const title of ["Prompt", "Effort", "Model", "Judge", "Handoff", "Customize", "System"]) assert.ok(cards.includes("title: '" + title + "'"));
  for (const legacy of ["title: 'Agents'", "title: 'fxmind'"]) assert.ok(!cards.includes(legacy));
  assert.match(source, /card === 'system'/);
  assert.match(source, /settings-system-panel/);
  assert.match(source, /const args = \['panel-open', '--cwd', dir\]/);
  // The CLI is found without PATH too (npm's global bin is often off PATH on Windows).
  assert.match(source, /runFxmind\(\$, args, \{ timeoutMs: 25_000 \}\)/);
  assert.match(source, /export function fxmindCandidates\(/);
  assert.match(source, /settings-check-update/);
  assert.doesNotMatch(source, /<Link href="http:\/\/localhost:3847\/" label="Painel"/);
  assert.match(source, /label="Report"/);
  assert.doesNotMatch(source.slice(source.indexOf("card === 'fxmind' ?"), source.indexOf("card === 'effort' ?", source.indexOf("card === 'fxmind' ?"))), /settings-project-setup|settings-fxmind-/);
});
