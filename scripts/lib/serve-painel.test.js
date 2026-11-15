const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildPainelArgs } = require("../serve");

describe("serve painel", () => {
  it("buildPainelArgs adds --open and --path / by default", () => {
    assert.deepEqual(buildPainelArgs([]), ["--open", "--path", "/"]);
  });

  it("buildPainelArgs keeps custom --path", () => {
    assert.deepEqual(buildPainelArgs(["--path", "/inbox"]), ["--open", "--path", "/inbox"]);
  });
});
