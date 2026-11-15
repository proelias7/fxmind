const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DASHBOARD_SOURCE, WEB_DIST, hasDashboardSource } = require("./panel-build");
const { buildPainelArgs } = require("../serve");

describe("FXMIND management dashboard", () => {
  it("ships a maintained source instead of the old chat bundle", () => {
    assert.equal(hasDashboardSource(), true);
    for (const filename of ["index.html", "dashboard.css", "dashboard.js", "design-system.css", "workspace.css", "memory-graph.js", "memory-graph.css", "orchestration-canvas.js", "controls.js", "logo.png", "favicon.png"]) {
      const source = fs.readFileSync(path.join(DASHBOARD_SOURCE, filename));
      const published = fs.readFileSync(path.join(WEB_DIST, filename));
      assert.deepEqual(source, published, filename);
    }
    const html = fs.readFileSync(path.join(WEB_DIST, "index.html"), "utf8");
    assert.match(html, /FXMIND — Dashboard/);
    assert.doesNotMatch(html, /index-s5QWr5Tj|\/assets\/index-|chat-container|mensagens/);
    assert.equal(fs.existsSync(path.join(WEB_DIST, "assets")), false);
    assert.deepEqual(buildPainelArgs([]), ["--open", "--path", "/"]);
  });


  it("uses the exact official landing palette, fonts, application logo, and favicon", () => {
    const projectRoot = path.resolve(DASHBOARD_SOURCE, "..", "..");
    const officialHtml = fs.readFileSync(path.join(projectRoot, "docs", "index.html"), "utf8");
    const css = fs.readFileSync(path.join(DASHBOARD_SOURCE, "design-system.css"), "utf8");
    const html = fs.readFileSync(path.join(DASHBOARD_SOURCE, "index.html"), "utf8");
    for (const token of [
      "--ink: #0d0f14",
      "--ink-2: #131821",
      "--mint: #7ee0b4",
      "--mint-deep: #34c69a",
      "--text: #eef1ef",
      "--muted: #98a2a6",
    ]) {
      assert.ok(officialHtml.includes(token), "official site has "+token);
      assert.ok(css.includes(token), "dashboard has "+token);
    }
    for (const family of ["Nunito", "Geist Mono"]) {
      assert.ok(officialHtml.includes(family), "official site uses "+family);
      assert.ok(css.includes(family), "dashboard uses "+family);
    }
    assert.match(html, /class="brand-logo" src="\/logo\.png"/);
    assert.match(html, /href="\/favicon\.png"/);
    assert.match(html, /href="\/design-system\.css"/);
    assert.match(html, /meta name="theme-color" content="#0d0f14"/);
    const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    for (const filename of ["logo.png", "favicon.png"]) {
      assert.equal(
        sha(path.join(DASHBOARD_SOURCE, filename)),
        sha(path.join(projectRoot, "docs", "assets", filename)),
        filename+" must be the real official site asset"
      );
    }
  });

  it("exposes shared agent configuration without storing credentials from a GET payload", () => {
    const script = fs.readFileSync(path.join(DASHBOARD_SOURCE, "dashboard.js"), "utf8");
    assert.match(script, /\/orchestration\/config/);
    assert.match(script, /\/cli\/models/);
    assert.match(script, /\/settings\/subagents/);
    assert.match(script, /\/settings\/providers/);
    assert.match(script, /cliId:a.cliId, model:a.model, effort:a.effort/);
    assert.doesNotMatch(script, /await api\('\/settings\/agent','PUT',state\.agentDraft\)/);
    assert.doesNotMatch(script, /\/api\/chat|\/threads\/inject|role=['"]user['"]/);
  });
});
