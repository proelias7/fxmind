const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MODEL_DEFAULT,
  MODEL_CUSTOM,
  orchestrationModelOptions,
  orchestrationModelChoice,
  sanitizeOrchestrationModel,
} = require("../../plugins/fxmind/hooks/orchestration-models.ts");

describe("orchestration model selection", () => {
  it("offers provider-specific models and an explicit custom model ID", () => {
    for (const provider of ["claude", "codex", "opencode", "cursor-agent", "hermes", null]) {
      const opts = orchestrationModelOptions(provider);
      assert.equal(opts[0].value, MODEL_DEFAULT);
      assert.equal(opts[opts.length - 1].value, MODEL_CUSTOM);
      assert.equal(new Set(opts.map((m) => m.value)).size, opts.length);
    }
    assert.ok(orchestrationModelOptions("claude").some((m) => m.value === "opus"));
    assert.ok(orchestrationModelOptions("codex").some((m) => m.value === "gpt-5.4-codex"));
    assert.ok(orchestrationModelOptions("opencode").some((m) => m.value.includes("/")));
  });

  it("keeps unknown configured model IDs editable and defaults as null", () => {
    assert.equal(orchestrationModelChoice("claude", null), MODEL_DEFAULT);
    assert.equal(orchestrationModelChoice("claude", "opus"), "opus");
    assert.equal(orchestrationModelChoice("claude", "custom/org-model"), MODEL_CUSTOM);
    assert.equal(orchestrationModelChoice("claude", "opus", true), MODEL_CUSTOM);
    assert.equal(orchestrationModelChoice(null, "provider/anything"), MODEL_CUSTOM);
  });

  it("sanitizes custom IDs before passing them to a CLI", () => {
    assert.equal(sanitizeOrchestrationModel(" cloudflare-ai-gateway/anthropic/claude-opus-5.5 "), "cloudflare-ai-gateway/anthropic/claude-opus-5.5");
    assert.equal(sanitizeOrchestrationModel(""), null);
    assert.equal(sanitizeOrchestrationModel("bad;rm -rf /"), null);
    assert.equal(sanitizeOrchestrationModel("bad\nnext"), null);
    assert.equal(sanitizeOrchestrationModel("x".repeat(161)), null);
  });
});
