"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { uiFile, uiImpact } = require("./ui-impact");

// This file is also bundled into .cursor/hooks/lib without the package tree;
// package-only modules load lazily and degrade to the local .fxmind layout.
function optionalPackageModule(name) {
  try { return require(name); } catch { return null; }
}

function resolveSkillsRoot(root) {
  const store = optionalPackageModule("../global-store");
  return store ? store.resolveSkillsRoot(root) : path.join(root, ".fxmind", "skills");
}

function stateDir(root) {
  return path.join(path.resolve(root), ".fxmind", "state", "reviews");
}

function safeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

function reviewPath(root, sessionId) {
  return path.join(stateDir(root), safeId(sessionId) + ".json");
}

function repoPath(root, value) {
  const rel = path.relative(path.resolve(root), path.resolve(root, value)).replace(/\\/g, "/");
  if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    throw new Error("Independent review path must stay inside project: " + value);
  }
  return rel;
}

function changedFiles(root) {
  try {
    const git = (args) => execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).split("\0").filter(Boolean);
    return [...new Set([
      ...git(["diff", "--relative", "--name-only", "-z", "--"]),
      ...git(["diff", "--relative", "--cached", "--name-only", "-z", "--"]),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ])].filter((file) => !file.startsWith(".fxmind/")).sort();
  } catch (error) {
    if (/not a git repository/i.test(String(error.stderr || ""))) return [];
    throw error;
  }
}

function snapshot(root, files) {
  const out = {};
  for (const input of files || []) {
    const file = repoPath(root, input);
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      out[file] = "deleted";
      continue;
    }
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) continue;
    out[file] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  }
  return out;
}

function fingerprint(snap) {
  return crypto.createHash("sha256").update(JSON.stringify(snap)).digest("hex");
}

function reviewContext(session) {
  const goal = session?.gates?.A?.note || session?.note || "";
  return {
    goal: String(goal),
    kind: session?.kind || null,
    playbook: session?.playbook || null,
    ui: Boolean(session?.ui),
  };
}

function contextFingerprint(session) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(reviewContext(session)))
    .digest("hex");
}

function parseVerdict(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // Models often wrap the line in markdown (`**VERDICT: VERIFIED**`); the words themselves stay strict.
  const finalLine = (lines.at(-1) || "").replace(/^[>*_`#\s-]+|[*_`.\s]+$/g, "");
  if (/^VERDICT:\s*REFUTED$/i.test(finalLine)) return "refuted";
  if (/^VERDICT:\s*VERIFIED WITH CAVEATS$/i.test(finalLine)) return "verified_with_caveats";
  if (/^VERDICT:\s*VERIFIED$/i.test(finalLine)) return "verified";
  if (/^VERDICT:\s*SKIPPED BY USER$/i.test(finalLine)) return "skipped";
  return "unverifiable";
}

function requiresIndependentReview(session, files) {
  if (!session || session.trivial) return false;
  const list = files || [];
  if (list.some((file) => /\.lua$/i.test(file))) return true;
  if (list.length > 1) return true;
  return ["fix", "mechanic", "create"].includes(String(session.kind || "").toLowerCase());
}

// `.fxmind/skills/...` may live in the shared global skills folder.
function fxmindPath(root, rel) {
  const unix = String(rel).replace(/\\/g, "/");
  const prefix = ".fxmind/skills/";
  return unix.startsWith(prefix)
    ? path.join(resolveSkillsRoot(root), unix.slice(prefix.length))
    : path.join(root, rel);
}

function safeRead(root, rel, maxChars) {
  const absolute = fxmindPath(root, rel);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const body = fs.readFileSync(absolute, "utf8").trim();
  if (!body) return null;
  return {
    path: rel.replace(/\\/g, "/"),
    body: body.length > maxChars ? body.slice(0, maxChars) + "\n[excerpt truncated]" : body,
  };
}

function installedSkillRouters(root, isUi) {
  const base = resolveSkillsRoot(root);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isUi && /(?:^|-)(?:ui|nui|frontend|react)(?:-|$)/i.test(entry.name)) continue;
    const rel = path.join(".fxmind", "skills", entry.name, "SKILL.md");
    const hit = safeRead(root, rel, 1200);
    if (hit) out.push(hit);
  }
  return out;
}

/** Each pack declares its reviewer rubric in pack.json `review` (paths relative to .fxmind/). */
function packReviewRubrics(root) {
  const packs = optionalPackageModule("../packs");
  return packs ? packs.installedPacks(root).map((pack) => pack.review).filter(Boolean) : [];
}

function reviewGuidance(root, files, isUi = (files || []).some(uiFile)) {
  const normalized = (files || []).map((file) => String(file).replace(/\\/g, "/").toLowerCase());
  const rubrics = packReviewRubrics(root);
  const candidates = [];
  const add = (entry, fallbackMax = 1800) => {
    const file = typeof entry === "string" ? entry : entry?.file;
    if (!file) return;
    const hit = safeRead(root, path.join(".fxmind", file), Number(entry?.max) || fallbackMax);
    if (hit) candidates.push(hit);
  };

  // Budget order: binding policy, rubrics matched by the changed files, the
  // pack's base rubric, then generic skill routers.
  for (const rubric of rubrics) for (const entry of rubric.policy || []) add(entry, 3200);

  for (const rubric of rubrics) {
    for (const rule of rubric.rules || []) {
      let matches = false;
      if (rule.ui) matches = isUi;
      else if (rule.match) {
        try {
          const pattern = new RegExp(rule.match, "i");
          matches = normalized.some((file) => pattern.test(file));
        } catch { matches = false; }
      }
      if (matches) for (const entry of rule.files || []) add(entry);
    }
  }
  for (const rubric of rubrics) for (const entry of rubric.always || []) add(entry);
  const index = safeRead(root, ".fxmind/skills/_index.md", 1200);
  if (index) candidates.push(index);
  candidates.push(...installedSkillRouters(root, isUi));

  const seen = new Set();
  let budget = 14000;
  const sections = [];
  for (const item of candidates) {
    if (!item || seen.has(item.path) || budget <= 0) continue;
    seen.add(item.path);
    const body = item.body.slice(0, budget);
    sections.push("### " + item.path + "\n" + body);
    budget -= body.length;
  }
  return sections.join("\n\n");
}

const DIFF_MAX_CHARS = 24000;

/** The candidate change itself, so the reviewer needs no Bash or MCP to see it (`claude -p` and read-only
 * sandboxes deny both by default, and a reviewer without the diff ends without a verdict). */
function candidateDiff(root, files) {
  const list = (files || []).map((file) => repoPath(root, file));
  if (!list.length) return "";
  const git = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
    } catch {
      return "";
    }
  };
  let out = git(["diff", "HEAD", "--no-color", "--", ...list]) || git(["diff", "--no-color", "--", ...list]);
  const untracked = new Set(git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...list]).split("\0").filter(Boolean));
  for (const file of untracked) {
    const absolute = path.join(root, file);
    try {
      if (!fs.statSync(absolute).isFile()) continue;
      const body = fs.readFileSync(absolute, "utf8");
      out += "\n--- /dev/null\n+++ b/" + file + " (new file)\n" + body.split("\n").map((line) => "+" + line).join("\n") + "\n";
    } catch { /* unreadable: the reviewer reads it from disk */ }
  }
  out = out.trim();
  return out.length > DIFF_MAX_CHARS ? out.slice(0, DIFF_MAX_CHARS) + "\n[diff truncated; read the remaining files from disk]" : out;
}

function buildPrompt(root, session, files, evidence = {}) {
  const goal = session && session.gates && session.gates.A && session.gates.A.note
    ? session.gates.A.note
    : (session && session.note ? session.note : "(goal not recorded)");
  const ui = uiImpact(root, files, evidence, session);
  const guidance = reviewGuidance(root, files, ui.changed);
  const lines = [
    "Review this candidate change independently. You did not implement it.",
    "This review IS Gate V: treat it as the final adversarial validation before completion.",
    "Do not trust or request the executor's explanation, reasoning or completion report. Work from the original goal, current source, git diff/status, real evidence and the project rules below.",
    "This is READ-ONLY: do not edit files and do not record FxMind gates.",
    "",
    "Original goal / Gate A: " + goal,
    "Task kind: " + ((session && session.kind) || "unknown"),
    "UI impact assessment: " + JSON.stringify(ui),
    "Prioritize lint/syntax, typecheck where applicable, code quality, correctness and focused regression tests for the actual changed code. Use the project's existing commands; do not introduce tooling just to satisfy this review.",
    "Check the UI impact assessment against the actual diff. Browser/visual verification is required ONLY for actual changes to rendered content, layout, styles or user interactions (including backend changes that alter those outcomes).",
    "Do not open an interface or demand screenshots for unchanged UI context or backend/tests/config/tooling/comments/formatting/refactors that preserve rendered output and user interactions. A frontend path, installed UI skill or old planning flag alone does not prove UI impact. If the assessment is false but the diff changes UI behavior, report the concrete mismatch; do not accept an unjustified exemption.",
    "Files under review:",
  ];
  for (const file of files || []) lines.push("- " + file);
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  if (checks.length) {
    lines.push("", "## Executor observations (claims; verify independently)");
    for (const check of checks.slice(0, 12)) {
      lines.push(
        "- " + [check.kind, check.target, check.status, check.observed].filter(Boolean).join(" | "),
      );
    }
  }
  if (evidence?.browser) {
    lines.push(
      "- browser | " + [
        evidence.browser.status,
        evidence.browser.url,
        evidence.browser.visual,
        evidence.browser.console,
      ].filter(Boolean).join(" | "),
    );
  }
  lines.push(
    "",
    "Inspect the actual diff and relevant callers. Try to falsify the change: requirement gaps, lexical/scope errors, accidental globals, wrong function order, missed twins, stale assumptions, edge cases, security/performance regressions, scope creep and unsupported verification claims.",
    "Lean review (no extra gate): check whether the patch needlessly duplicates an existing helper/event/component, introduces a speculative abstraction/dependency, or modifies unrelated code. Name a concrete reusable alternative and its callers before flagging. Do NOT demand fewer lines when it removes security, validation, accessibility, error handling or essential tests. Do not invent savings.",
    "For new branching logic, parsers, security, persistence or money, check for one focused regression test that would fail on a real defect. Verify the tests and their behavior, not just their existence.",
    "For Lua, explicitly check that every local callee is lexically visible to its callers and that a later local declaration did not turn an earlier reference into a global lookup.",
  );
  const diff = candidateDiff(root, files);
  if (diff) lines.push("", "## Candidate diff (git, against HEAD)", "```diff", diff, "```");
  if (guidance) {
    lines.push(
      "",
      "## Binding/relevant review guidance",
      "Apply these project/pack rules as the review rubric. Inspect the referenced current source files when an excerpt points to a relevant section.",
      guidance,
    );
  }
  lines.push(
    "",
    "End with exactly one final line:",
    "VERDICT: VERIFIED",
    "VERDICT: VERIFIED WITH CAVEATS",
    "VERDICT: REFUTED"
  );
  return lines.join("\n");
}

function recordReview(root, options) {
  const sessionId = options && options.sessionId;
  if (!sessionId) throw new Error("Independent review requires sessionId.");
  const files = options && options.files ? options.files : [];
  const normalized = [...new Set(files.map((file) => repoPath(root, file)))].sort();
  const snap = snapshot(root, normalized);
  const record = {
    schemaVersion: 2,
    reviewId: crypto.randomUUID(),
    sessionId,
    at: new Date().toISOString(),
    reviewer: (options && options.reviewer) || {},
    verdict: parseVerdict(options && options.output),
    files: normalized,
    snapshot: snap,
    fingerprint: fingerprint(snap),
    contextFingerprint: contextFingerprint(options?.session || {}),
    uiFingerprint: fingerprint(uiImpact(root, normalized, options?.evidence || {}, options?.session || {})),
    output: String((options && options.output) || "").slice(0, 16000),
  };
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(reviewPath(root, sessionId), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

/** The person chose, in the fxmind panel, to skip the independent review: recorded as theirs and bound to the same
 * files, contents and task context as a review, so a later change still makes it stale. */
function recordSkip(root, options) {
  return recordReview(root, {
    ...options,
    reviewer: { agent: "reviewer", cliId: null, model: null, effort: null, skippedBy: "user" },
    output: "VERDICT: SKIPPED BY USER",
  });
}

function readReview(root, sessionId) {
  const file = reviewPath(root, sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function assertVerifiedFresh(root, session, files, evidence = {}) {
  if (!requiresIndependentReview(session, files)) return null;
  const record = readReview(root, session.sessionId);
  if (!record) {
    throw new Error("Gate V requires its automatic independent reviewer to finish first.");
  }
  if (record.schemaVersion !== 2 || !record.reviewId || record.reviewer?.agent !== "reviewer") {
    throw new Error("Gate V independent review artifact is invalid; run Gate V again.");
  }
  const skipped = record.verdict === "skipped" && record.reviewer?.skippedBy === "user";
  if (record.verdict !== "verified" && !skipped) {
    throw new Error("Gate V reviewer did not verify the change (verdict: " + record.verdict + "). Fix findings and run Gate V again.");
  }
  const normalized = [...new Set((files || []).map((file) => repoPath(root, file)))].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(record.files || [])) {
    throw new Error("Gate V review is stale: reviewed file set differs from current Gate V files. Run Gate V again.");
  }
  const current = snapshot(root, normalized);
  if (fingerprint(current) !== record.fingerprint) {
    throw new Error("Gate V review is stale: code changed after review. Run Gate V again.");
  }
  if (!record.contextFingerprint || record.contextFingerprint !== contextFingerprint(session)) {
    throw new Error("Gate V review is stale: task goal/kind/playbook changed after review. Run Gate V again.");
  }
  if (record.uiFingerprint !== fingerprint(uiImpact(root, normalized, evidence, session))) {
    throw new Error("Gate V review is stale: UI impact assessment changed after review. Run Gate V again.");
  }
  return {
    reviewId: record.reviewId,
    reviewer: record.reviewer,
    verdict: record.verdict,
    fingerprint: record.fingerprint,
    contextFingerprint: record.contextFingerprint,
  };
}

module.exports = {
  changedFiles,
  snapshot,
  fingerprint,
  reviewContext,
  contextFingerprint,
  parseVerdict,
  requiresIndependentReview,
  reviewGuidance,
  buildPrompt,
  candidateDiff,
  recordReview,
  readReview,
  assertVerifiedFresh,
  recordSkip,
};
