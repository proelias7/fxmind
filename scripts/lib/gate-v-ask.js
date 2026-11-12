"use strict";

// Gate V asks the person first, in the fxmind mod's panel above the prompt: review now, and with which agent, or skip.
// Three small files under .fxmind/state carry the exchange:
//   gate-v-ask.json     the mod's "I can ask" marker (written at session start while the setting is on, refreshed per turn)
//   gate-v-pending.json the server's question: the task, its files, the reviewers installed here
//   gate-v-choice.json  the person's answer, kept for the task: a review cycle after fixes asks no second time
// Without a fresh marker (another client, or the mod is off) Gate V runs its reviewer at once, as before.

const fs = require("fs");
const path = require("path");

/** A marker older than this is a mod that is no longer running: Gate V stops waiting on it. */
const MARKER_TTL_MS = 12 * 60 * 60 * 1000;

const stateDir = (root) => path.join(root, ".fxmind", "state");
const file = (root, name) => path.join(stateDir(root), name);

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** Whether Gate V should ask in the panel: a fresh marker from the mod, and a caller that is Claude Code (or unnamed). */
function askEnabled(root, callerCliId, now = Date.now()) {
  if (callerCliId && callerCliId !== "claude") return false;
  const marker = readJson(file(root, "gate-v-ask.json"));
  if (!marker || marker.ask !== true) return false;
  const at = Date.parse(marker.at || "");
  return Number.isFinite(at) && now - at >= 0 && now - at < MARKER_TTL_MS;
}

/** The person's answer for this task; null when there is none yet (or it was for another task). */
function readChoice(root, sessionId) {
  const choice = readJson(file(root, "gate-v-choice.json"));
  if (!choice || !sessionId || choice.sessionId !== sessionId) return null;
  if (choice.decision === "skip") return { decision: "skip" };
  if (choice.decision === "review") return { decision: "review", cliId: typeof choice.cliId === "string" && choice.cliId ? choice.cliId : null };
  return null;
}

function writePending(root, pending) {
  writeJson(file(root, "gate-v-pending.json"), { ...pending, at: new Date().toISOString() });
}

function clearPending(root) {
  fs.rmSync(file(root, "gate-v-pending.json"), { force: true });
}

/** The reviewers the person can pick: the CLIs installed here that the reviewer can run on. */
function reviewerChoices(scan) {
  return (scan || [])
    .filter((c) => c && c.id && (c.installed || c.status === "installed" || c.status === "host"))
    .map((c) => ({ id: c.id, label: c.label || c.name || c.id }));
}

module.exports = { askEnabled, readChoice, writePending, clearPending, reviewerChoices, MARKER_TTL_MS };
