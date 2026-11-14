/**
 * Keep topic memories in git, keep generated graph/session files out.
 *
 * Source of truth for sync: `.fxmind/memory/*.md` (and corrections).
 * Graph JSON/HTML, memory-index, cache, metrics and gates are rebuilt locally.
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  PROJECT_GITIGNORE_LINES,
  PROJECT_GITIGNORE_UNTRACK,
  WORKTREE_INCLUDE,
  sharedFxmindFile,
} = require("./layout");

function runGit(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 10_000,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function isGitWorkTree(root) {
  try {
    runGit(root, ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function untrackGeneratedFxmindFiles(targetRoot) {
  const root = path.resolve(targetRoot);
  if (!isGitWorkTree(root)) {
    return [];
  }

  let listed = "";
  try {
    listed = runGit(root, ["ls-files", "-z", "--", ...PROJECT_GITIGNORE_UNTRACK, ".fxmind"]);
  } catch {
    return [];
  }

  // Generated paths, plus every installed .fxmind/ file that is not shared knowledge (memory, corrections).
  const tracked = [...new Set(listed
    .split("\0")
    .map((entry) => entry.replace(/\\/g, "/").trim())
    .filter(Boolean)
    .filter((file) => !sharedFxmindFile(file)))];

  // dev/dev.cfg is untracked only when fxmind wrote it: a team's own dev config stays in git (the ignore line only
  // keeps a new one out).
  const devCfg = path.join(root, "dev", "dev.cfg");
  try {
    if (fs.existsSync(devCfg) && /^# Created by fxmind/.test(fs.readFileSync(devCfg, "utf8")) &&
        runGit(root, ["ls-files", "--", "dev/dev.cfg"]).trim()) {
      tracked.push("dev/dev.cfg");
    }
  } catch { /* not tracked or unreadable */ }
  if (tracked.length === 0) {
    return [];
  }

  try {
    for (let i = 0; i < tracked.length; i += 200) {
      runGit(
        root,
        ["rm", "--cached", "--ignore-unmatch", "-q", "--", ...tracked.slice(i, i + 200)],
        { stdio: "ignore", timeout: 15_000 },
      );
    }
  } catch {
    return [];
  }

  return tracked;
}

const WORKTREE_BEGIN = "# >>> fxmind (installed files a new worktree needs; managed by fxmind)";
const WORKTREE_END = "# <<< fxmind";

/** Keeps fxmind's block in `.worktreeinclude`, so every worktree Claude Code creates gets fxmind's installed files
 * (they are gitignored, so a fresh checkout lacks them). Lines outside the block are the team's and stay. */
function ensureWorktreeInclude(targetRoot) {
  const file = path.join(path.resolve(targetRoot), ".worktreeinclude");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
  const block = [WORKTREE_BEGIN, ...WORKTREE_INCLUDE, WORKTREE_END].join("\n");
  const start = current.indexOf(WORKTREE_BEGIN);
  const end = current.indexOf(WORKTREE_END, start);
  let next;
  if (start >= 0 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + WORKTREE_END.length);
  } else {
    next = current + (current && !current.endsWith("\n") ? "\n" : "") + (current ? "\n" : "") + block + "\n";
  }
  if (next === current) return false;
  fs.writeFileSync(file, next, "utf8");
  return true;
}

function ensureProjectGitignore(targetRoot) {
  const gitignorePath = path.join(path.resolve(targetRoot), ".gitignore");
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const added = [];
  for (const line of PROJECT_GITIGNORE_LINES) {
    const re = new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (re.test(content)) continue;
    if (content.length && !content.endsWith("\n")) content += "\n";
    if (!content.includes("# fxmind session") && !content.includes("# fxmind generated")) {
      content += "\n# fxmind generated (rebuild from .fxmind/memory/; do not commit)\n";
    }
    content += `${line}\n`;
    added.push(line);
  }
  if (added.length) {
    fs.writeFileSync(gitignorePath, content, "utf8");
  }

  const untracked = untrackGeneratedFxmindFiles(targetRoot);
  let worktreeInclude = false;
  try { worktreeInclude = ensureWorktreeInclude(targetRoot); } catch { /* best effort */ }
  return { path: ".gitignore", added, untracked, worktreeInclude };
}

module.exports = {
  ensureProjectGitignore,
  ensureWorktreeInclude,
  untrackGeneratedFxmindFiles,
};
