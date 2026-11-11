const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const selfUpdate = require("./self-update");

describe("self-update fallback", () => {
  it("treats a missing or unreadable global dir as unusable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxself-"));
    assert.equal(selfUpdate.isReadableDir(dir), true);
    assert.equal(selfUpdate.isReadableDir(path.join(dir, "missing")), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects npx cache runs so first installs get a global runtime", () => {
    assert.equal(selfUpdate.isNpxRun("C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\1f2e\\node_modules\\fxmind"), true);
    assert.equal(selfUpdate.isNpxRun("/home/a/.npm/_npx/1f2e/node_modules/fxmind"), true);
    assert.equal(selfUpdate.isNpxRun("/usr/local/lib/node_modules/fxmind"), false);
    assert.equal(selfUpdate.isNpxRun(path.resolve(__dirname, "..")), false);
  });

  it("keeps the fallback install under ~/.fxmind/npm", () => {
    const prefix = selfUpdate.fallbackPrefix();
    assert.equal(prefix, path.join(os.homedir(), ".fxmind", "npm"));
    assert.ok(selfUpdate.fallbackInstallScript().startsWith(prefix));
    assert.ok(selfUpdate.fallbackInstallScript().endsWith(path.join("fxmind", "scripts", "install.js")));
  });
});
