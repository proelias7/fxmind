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

test("Gate V Skip never submits a synthetic user message", () => {
  const source = read("effort.tsx");
  const start = source.indexOf("async function answerGateV(");
  const end = source.indexOf("async function saveDraft(", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /if \(decision === [\x27"]review[\x27"]\) await \$\.prompt\.submit\(/);
  assert.equal((handler.match(/\$\.prompt\.submit\(/g) || []).length, 1);
  assert.match(handler, /gate-v-choice\.json/);
});

test("All settings pages share a full-panel FXMIND texture", () => {
  const ui = read("effort.tsx");
  const art = read("brand-mark.ts");
  assert.match(ui, /textureLayer\(\{ Box, Svg \}, [\x27"]settings[\x27"], true\)/);
  assert.match(ui, /textureSvg\(960, height, BRAND_EDGE\)/);
  assert.match(art, /TEXTURE_TALL_SVG = textureSvg\(960, 160\)/);
  assert.match(art, /fxdots/);
});
test("Cards remain dark; only primary actions are light and readable on hover", () => {
  const ui = read("effort.tsx");
  const overview = ui.slice(ui.indexOf('key="settings-cards"'), ui.indexOf('key={`settings-${card}`}', ui.indexOf('key="settings-cards"')));
  assert.match(overview, /backgroundColor=\{term \? DASH_BG : config\.appearance/);
  assert.match(overview, /'#151b24'/);
  assert.match(overview, /'#f1f4f6'/);
  assert.match(overview, /'#2d3942'/);
  assert.match(overview, /'#e4ecec'/);
  assert.match(overview, /'#eef1ef'/);
  assert.doesNotMatch(overview, /#292220|#30262c|#f3f8f4/);
  const action = ui.slice(ui.indexOf('const panelAction ='), ui.indexOf('const skillNames ='));
  assert.match(action, /backgroundColor="#f5f8f5"/);
  assert.match(action, /color="#0b1610" bold hover=\{\{ color: "#0b1610" \}\}/);
  assert.match(action, /hover=\{\{ backgroundColor: "#00000000" \}\}/);
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
  for (const title of ["Prompt", "Effort", "Model", "Handoff", "Customize"]) assert.ok(cards.includes("title: '" + title + "'"));
  for (const legacy of ["title: 'Judge'", "title: 'Agents'", "title: 'fxmind'"]) assert.ok(!cards.includes(legacy));
  assert.match(source, /<Link href="http:\/\/localhost:3847\/" label="Painel"/);
  assert.doesNotMatch(source.slice(source.indexOf("card === 'fxmind' ?"), source.indexOf("card === 'effort' ?", source.indexOf("card === 'fxmind' ?"))), /settings-project-setup|settings-fxmind-/);
});
