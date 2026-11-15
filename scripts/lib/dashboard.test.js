const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DASHBOARD_SOURCE, WEB_DIST, hasDashboardSource } = require("./panel-build");
const { buildPainelArgs } = require("../serve");

describe("FXMIND management dashboard", () => {
  it("ships a maintained source instead of the old chat bundle", () => {
    assert.equal(hasDashboardSource(), true);
    for (const filename of ["index.html", "dashboard.css", "dashboard.js"]) {
      const source = fs.readFileSync(path.join(DASHBOARD_SOURCE, filename), "utf8");
      const published = fs.readFileSync(path.join(WEB_DIST, filename), "utf8");
      assert.equal(source, published, filename);
    }
    const html = fs.readFileSync(path.join(WEB_DIST, "index.html"), "utf8");
    assert.match(html, /FXMIND — Dashboard/);
    assert.doesNotMatch(html, /index-s5QWr5Tj|\/assets\/index-|chat-container|mensagens/);
    assert.equal(fs.existsSync(path.join(WEB_DIST, "assets")), false);
    assert.deepEqual(buildPainelArgs([]), ["--open", "--path", "/"]);
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
