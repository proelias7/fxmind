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
test("Settings actions and navigation use light surfaces with dark labels", () => {
  const ui = read("effort.tsx");
  assert.match(ui, /backgroundColor="#f5f8f5"/);
  assert.match(ui, /color="#0b1610"/);
  assert.match(ui, /backgroundColor=\{term \? DASH_BG : "#f3f8f4"\}/);
  for (const key of ["settings-check-update", "settings-back", "settings-save", "settings-judge-test", "settings-model-"]) {
    assert.ok(ui.includes("panelAction(") && ui.includes(key), key);
  }
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
