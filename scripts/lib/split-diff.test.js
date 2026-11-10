const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");

// The panel source lives in the FXMIND monorepo, next to this package.
const PANEL_SOURCE = path.resolve(__dirname, "../../../panel/src/lib/split-diff.ts");

async function load() {
  return import("../../../panel/src/lib/split-diff.ts");
}

describe("splitUnifiedPatch", { skip: !fs.existsSync(PANEL_SOURCE) && "panel source not in this checkout" }, () => {
  it("pairs a replacement into left/right rows", async () => {
    const { splitUnifiedPatch, firstChangedLine } = await load();
    const patch = [
      "diff --git a/a.lua b/a.lua",
      "--- a/a.lua",
      "+++ b/a.lua",
      "@@ -10,3 +10,4 @@",
      " keep",
      "-old",
      "+new",
      " tail",
    ].join("\n");
    const rows = splitUnifiedPatch(patch);
    const hunk = rows.find((row) => row.kind === "hunk");
    assert.ok(hunk);
    const pairs = rows.filter((row) => row.kind === "pair");
    assert.equal(pairs[0].left.text, "keep");
    assert.equal(pairs[0].right.text, "keep");
    assert.equal(pairs[1].left.type, "del");
    assert.equal(pairs[1].left.text, "old");
    assert.equal(pairs[1].right.type, "add");
    assert.equal(pairs[1].right.text, "new");
    assert.equal(firstChangedLine(rows), 11);
  });
});
