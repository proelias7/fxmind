#!/usr/bin/env node
/**
 * fxmind MCP server (stdio, JSON-RPC 2.0).
 *
 * Tools:
 *   fxmind_list_memories / fxmind_validate_memories / fxmind_query / fxmind_graph / fxmind_check_update
 *   fxmind_drift_check / fxmind_start_task / fxmind_gate_status / fxmind_record_gate
 *   fxmind_record_correction / fxmind_list_corrections
 *   fxmind_fivem_install / fxmind_fivem_cmd / fxmind_fivem_console_tail / fxmind_fivem_status
 *   fxmind_fivem_nui_wire / fxmind_fivem_nui_dump / fxmind_fivem_nui_unwire
 *   fxmind_db_status / fxmind_db_query / fxmind_db_schema / fxmind_db_sample
 *   fxmind_db_explore / fxmind_db_analyze
 *   fxmind_storage_status / fxmind_storage_upload_image / fxmind_image_resize
 *   fxmind_panel_wait / fxmind_panel_pending / fxmind_panel_reply / fxmind_panel_fail
 *   fxmind_subagent_run
 *   Desktop agent (Windows, scripts/desktop-agent.js): view_screen / click_screen / type_text
 *   scroll_screen / drag_screen / hotkey / press_key / hover_screen / double_click_screen
 *   window_info / activate_window / desktop_observe / desktop_act
 *   inspect_background_ui / execute_background_ui / gui_sequence
 *
 * Gates are session state — use fxmind_start_task + fxmind_record_gate only.
 * Never Write .fxmind/state/fxmind-gates.json from the agent.
 */

const fs = require("fs");
const path = require("path");
const tools = require("./fxmind-tools");
const fivemRcon = require("./fivem-rcon");
const fivemNuiDump = require("./fivem-nui-dump");
const fxmindMysql = require("./fxmind-mysql");
const storage = require("./fxmind-storage");
const { resizeImage } = require("./lib/image-tools");
const { checkForUpdate } = require("./lib/update-check");
const panelHost = require("./lib/panel-host");
const { searchSource } = require("./lib/source-search");
const { readSource } = require("./lib/read-source");
const { routeTool } = require("./lib/tool-router");
const { formatQueryResult } = require("./lib/memory-retrieval");
const independentReview = require("./lib/independent-review");
const desktopAgent = require("./desktop-agent");

// Dual-era: the stateless 2026-07-28 revision (server/discover, per-request
// _meta) and the legacy initialize handshake for older clients.
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
const SERVER_INFO = { name: "fxmind", version: require("../package.json").version };
const SERVER_CAPABILITIES = { tools: {} };
// The tool list depends on env and installed version, so never let clients
// cache results beyond a single read.
const CACHE_HINTS = { ttlMs: 0, cacheScope: "private" };

const SESSION_ID_PROP = {
  sessionId: {
    type: "string",
    description: "Session id from fxmind_start_task (required with 2+ active sessions).",
  },
  conversationId: {
    type: "string",
    description: "Optional chat id binding the session to this tab.",
  },
};

function sessionExtra(args = {}) {
  return {
    sessionId: args.sessionId || process.env.FXMIND_SESSION_ID || undefined,
    conversationId: args.conversationId || undefined,
  };
}

function targetRoot() {
  return (
    process.env.FXMIND_TARGET ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

function callerCliId() {
  const agent = String(process.env.FXMIND_AGENT_ID || "").trim().toLowerCase();
  return {
    cursor: "cursor-agent",
    "cursor-agent": "cursor-agent",
    claude: "claude",
    codex: "codex",
    opencode: "opencode",
  }[agent] || null;
}

const DB_ENVIRONMENT = {
  environment: {
    type: "string", enum: ["dev", "production"], default: "dev",
    description: "dev (default): existing cfg/FXMIND_MYSQL_URL. production: FXMIND_MYSQL_PRODUCTION_URL in the target project's .env; always read-only, no fallback to dev.",
  },
};

const IMAGE_PROPERTIES = {
  path: { type: "string", description: "Local source image; absolute or relative to the project. Max input 50 MiB / 40 megapixels; single-frame raster only." },
  width: { type: "integer", minimum: 1, maximum: 8192, description: "Target width. Omit both dimensions for a 2048x2048 bounding box (storage defaults may override)." },
  height: { type: "integer", minimum: 1, maximum: 8192, description: "Target height. With just one dimension, keep the aspect ratio." },
  fit: { type: "string", enum: ["inside", "cover", "contain", "fill"], default: "inside", description: "inside: fit without enlargement, dimensions may differ. For exact width x height use cover (crop), contain (pad) or fill (stretch); both dimensions required." },
  format: { type: "string", enum: ["png", "webp", "jpeg"], default: "png" },
  quality: { type: "integer", minimum: 1, maximum: 100, default: 80, description: "Initial JPEG/WebP quality, reduced toward 40 if necessary to meet maxBytes. PNG is lossless." },
  maxBytes: { type: "integer", minimum: 1, maximum: 52428800, description: "Maximum encoded bytes (default 5 MiB). Upload cannot exceed the configured storage limit. Fails before writing/uploading if compression cannot fit; dimensions are preserved." },
};

const TOOL_DEFS = [
  {
    name: "fxmind_route_tool",
    description: "Recommend (never execute) the next read-only FxMind MCP discovery tool. Uses deterministic rules first, optional Jev for ambiguous choices only; respects exposed tools and read-only mode. Does NOT approve gates, mutate files, invoke a tool, or change permissions. Use once when unsure which FxMind tool is appropriate; avoid repetitive routing calls.",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", minLength: 1, maxLength: 1500, description: "Task summary or question. The router sends only fixed, whitelisted intent signals to Jev; no raw text or project paths." },
        context: {
          type: "object",
          properties: {
            hasPlaybook: { type: "boolean", description: "A verified playbook is already loaded." },
            memoriesPreloaded: { type: "boolean", description: "Relevant FxMind memories have already been preloaded." },
            hasFileHit: { type: "boolean", description: "A path was obtained from a trusted prior file search." },
            searchAttempted: { type: "boolean", description: "The current literal search has already been attempted." },
            memoryQueryAttempted: { type: "boolean", description: "A memory query was already attempted." },
          },
          additionalProperties: false,
        },
      },
      required: ["request"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fxmind_storage_status",
    description: "Inspect S3-compatible storage configuration from the project .env, .fxmind/storage.json and FXMIND_S3_* process env. No network request; credentials are never returned or verified. Put AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in the target project's .env.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fxmind_image_resize",
    description: "Resize/compress a local image into a NEW local file. Source is preserved; existing output is refused. Defaults: PNG, fit inside 2048x2048, 5 MiB maximum. Use cover/contain/fill with width+height for an exact resolution. Does not upload.",
    inputSchema: {
      type: "object", properties: {
        ...IMAGE_PROPERTIES,
        outputPath: { type: "string", description: "New local file path; extension must match format (.webp, .png, .jpg/.jpeg). Parent directories are created." },
      }, required: ["path", "outputPath"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "fxmind_storage_upload_image",
    description: "Resize/compress a local image IN MEMORY and upload to the configured S3-compatible bucket. Default bounding box 2048x2048, PNG, at most 5 MiB (project config may override); originals are preserved. Exact resolutions use width+height and cover/contain/fill. Returns key, bytes, actual dimensions and publicUrl only if configured; never changes bucket permissions. Existing keys are refused unless overwrite=true.",
    inputSchema: {
      type: "object", properties: {
        ...IMAGE_PROPERTIES,
        key: { type: "string", description: "Optional object name relative to the configured prefix, e.g. banners/home.png. Extension must match format; appended if absent. Default: source name + UUID." },
        overwrite: { type: "boolean", default: false, description: "Allow replacement of an existing object only when intended. Default uses If-None-Match:*; incompatible providers fail safely." },
      }, required: ["path"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "fxmind_list_memories",
    description:
      "List all fxmind topic memories under .fxmind/memory/ with frontmatter summary. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_validate_memories",
    description:
      "Validate memory frontmatter schema (required fields, paths/triggers, missing files). Also reports duplicate triggers/paths.",
    inputSchema: {
      type: "object",
      properties: {
        checkPaths: {
          type: "boolean",
          description: "Verify paths[] exist on disk (default true).",
          default: true,
        },
      },
    },
  },
  {
    name: "fxmind_query",
    description:
      "Find source-grounded atomic facts, functions and events (PT/EN) within a small token budget; legacy Markdown and bounded source search remain fallbacks. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural-language question." },
        dfs: { type: "boolean", description: "Also load related memories with leftover budget.", default: false },
        budget: { type: "number", description: "Token budget (default 1500).", default: 1500 },
      },
      required: ["question"],
    },
  },
  {
    name: "fxmind_graph",
    description:
      "Incrementally index source symbols and atomic memory fragments, then rebuild knowledge-graph.json and memory-index.json (HTML optional).",
    inputSchema: {
      type: "object",
      properties: {
        updateHtml: {
          type: "boolean",
          description:
            "Also sync knowledge-graph.html (default true). Set false for JSON + index only.",
          default: true,
        },
        addFact: {
          type: "object",
          description: "Optional source-grounded atomic fact to learn before rebuilding; no full topic Markdown is written.",
          properties: {
            topic: { type: "string" },
            text: { type: "string", description: "One concise factual behavior or rule (12-900 characters)." },
            path: { type: "string", description: "Existing project-relative source file." },
            evidence: { type: "string", description: "Exact substring present in the source file." },
            kind: { type: "string", description: "rule, behavior, pitfall, decision or mapping." },
            symbols: { type: "array", items: { type: "string" } },
            events: { type: "array", items: { type: "string" } },
          },
          required: ["topic", "text", "path", "evidence"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    name: "fxmind_check_update",
    description:
      "Check whether a newer fxmind version or project layout is available on GitHub. Read-only — does not run update.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Bypass 24h throttle and re-fetch remote version (default false).",
          default: false,
        },
      },
    },
  },
  {
    name: "fxmind_drift_check",
    description:
      "Check which topic and atomic memory records reference a changed source file (broken or stale-candidate).",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Changed file path (absolute or relative)." },
      },
      required: ["file"],
    },
  },
  {
    name: "fxmind_search",
    description: "Read-only literal (case-insensitive) source search when memories lack coverage or for twin checks. In Git projects it covers every tracked and untracked file; returns total count, paths, line numbers and short excerpts. When the note says absence is confirmed, do not retry the same literal or trivial variants — change the term or read the likely file. Prefer a specific directory to narrow large result sets.",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory inside the project, preferably the affected area. Default: project root." },
        query: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        ext: { type: "string", description: "Only files with this extension, e.g. lua. Skips generated bundles and data files." },
      },
      required: ["query"],
    },
  },
  {
    name: "fxmind_read_file",
    description: "Read-only excerpt of one project source/text file (numbered lines, at most 250 per call). Use after fxmind_search to read the code around a hit. Config/credential files (.cfg, .env, keys) are refused and inline secrets are masked.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root, as returned by fxmind_search." },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
      required: ["path"],
    },
  },
  {
    name: "fxmind_start_task",
    description:
      "Start a Task session (sets taskActive). Preferred over writing gates JSON. Call before Gate A. Pass trivial=true for one-file tiny edits to auto-complete Gates A and B. From this gate on, user-facing replies stay short and direct: outcome first, no long text.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Optional goal/scope note." },
        ui: { type: "boolean", description: "Planning hint: true only for expected visual/interaction changes. Assess actual UI impact during normal testing; unchanged interfaces do not need browser tests." },
        trivial: {
          type: "boolean",
          description:
            "If true, marks Gates A and B complete immediately (tiny one-file edits). Gate C can close directly.",
        },
        kind: {
          type: "string",
          enum: ["config", "fix", "mechanic", "create"],
          description: "Task kind confirmed at Gate A (config entry, defect, behavior change, new resource).",
        },
        playbook: {
          type: "string",
          description: "Playbook id being followed. A verified, non-stale playbook auto-completes Gates A and B (C still applies).",
        },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: "fxmind_playbook",
    description:
      "Playbooks are surgical instructions for repeated tasks (files, anchors, snippets, verify). action=list | match (query) | get (id, anchors resolved to current lines) | check (id, or all). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "match", "get", "check"] },
        id: { type: "string", description: "Playbook id (get/check)." },
        query: { type: "string", description: "User request (match)." },
      },
      required: ["action"],
    },
  },
  {
    name: "fxmind_health",
    description:
      "Check the project's fxmind setup, memories, playbooks and graph (no LLM). fix=true applies only safe repairs: Claude prompt hook, paths of files that moved to a unique new location (memories + playbooks), graph rebuild. Items left as warn carry the agent command to run (/fxmind teach <id>, /fxmind memory health <topic> fix). Use when a playbook is reported stale or memories point at missing files.",
    inputSchema: {
      type: "object",
      properties: {
        fix: { type: "boolean", description: "Apply the safe repairs (writes memory/playbook files). Default false: report only." },
      },
    },
  },
  {
    name: "fxmind_gate_status",
    description: "Read Task Gate A/B/C session status. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: SESSION_ID_PROP.sessionId,
      },
    },
  },
  {
    name: "fxmind_record_gate",
    description:
      "Record lightweight Task steps in START → A → B → C order. C closes after B and releases claimed files. Run appropriate tests and review before closing; no independent review gate or automatic user prompts.",
    inputSchema: {
      type: "object",
      properties: {
        gate: {
          type: "string",
          enum: ["START", "A", "B", "C"],
          description:
            "START begins a task; A/B unlock edits; C closes after normal checks.",
        },
        note: { type: "string", description: "Optional note (e.g. memories loaded). Gate A also restates: user replies stay short and direct." },
        playbook_verified: {
          type: "boolean",
          description: "Gate C of a task started with a playbook: true only if you ran every Verify check of that playbook and they passed. Promotes a draft playbook to verified; omit otherwise.",
        },
        ...SESSION_ID_PROP,
      },
      required: ["gate"],
    },
  },
  {
    name: "fxmind_claim_paths",
    description:
      "Exclusive file lease for parallel Task sessions. Call after Gate B with every repo path you will edit. Required before code edits when 2+ sessions are active.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Repo-relative paths (or absolute under the project root).",
        },
        ...SESSION_ID_PROP,
      },
      required: ["paths"],
    },
  },
  {
    name: "fxmind_release_paths",
    description: "Release previously claimed paths for this Task session (optional before Gate C).",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
        },
        ...SESSION_ID_PROP,
      },
      required: ["paths"],
    },
  },
  {
    name: "fxmind_session_status",
    description:
      "List active Task sessions, gates, and claimed paths (parallel IDE tabs / panel threads). Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_record_correction",
    description:
      "Save a human correction of an agent mistake into .fxmind/corrections/ (skill-improvement backlog — separate from topic memories).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the mistake." },
        category: {
          type: "string",
          enum: ["architecture", "communication", "security", "performance", "style", "api"],
          description: "Maps to best-practices skill area.",
        },
        bad: { type: "string", description: "What the agent did wrong (code/pattern)." },
        good: { type: "string", description: "Correct approach after human fix." },
        rule: { type: "string", description: "One-line rule to add to the skill." },
        notes: { type: "string" },
        commit: { type: "string", description: "Optional git commit SHA." },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        paths: { type: "array", items: { type: "string" } },
        resources: { type: "array", items: { type: "string" } },
        skill_target: { type: "string" },
      },
      required: ["title", "category", "bad", "good"],
    },
  },
  {
    name: "fxmind_list_corrections",
    description: "List skill-improvement corrections under .fxmind/corrections/. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "promoted", "dismissed"] },
        category: {
          type: "string",
          enum: ["architecture", "communication", "security", "performance", "style", "api"],
        },
      },
    },
  },
  {
    name: "fxmind_fivem_install",
    description:
      "Dev-only: configure local FiveM RCON + Cursor fivem-start task. Writes rcon_password only to dev/dev.cfg and .fxmind/state/rcon.json (never server.cfg). Run once per project before fxmind_fivem_cmd. After adding password, user must restart FXServer.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Overwrite .vscode/fivem-start.ps1 even if it already exists.",
        },
        password: {
          type: "string",
          description: "Optional local rcon_password (default fxmind-local-dev). Dev only.",
        },
      },
    },
  },
  {
    name: "fxmind_fivem_status",
    description:
      "Check local FiveM RCON install marker and probe FXServer (UDP status). available:true only when fxmind fivem install was run AND the console responds. Call BEFORE fxmind_fivem_cmd or fxmind_fivem_console_tail. installed:false → fxmind_fivem_install once. configured but serverReachable:false → ask user to start fivem-start; do not call cmd/tail.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_fivem_cmd",
    description:
      "Send allowlisted FXServer console command over local UDP RCON. Requires fxmind fivem install. Call fxmind_fivem_status first — only when available:true. Never auto-runs install. If install missing or console not running, returns an error (do not claim success).",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: 'e.g. "ensure my_resource", "restart vrp", "refresh"',
        },
      },
      required: ["command"],
    },
  },
  {
    name: "fxmind_fivem_console_tail",
    description:
      "Read .fxmind/state/fivem-console.log and optional server-debug.log. Requires fxmind fivem install (.fxmind/state/rcon.json). Call fxmind_fivem_status first when possible. Never auto-runs install.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "Lines to return (default 80, max 500)." },
      },
    },
  },
  {
    name: "fxmind_fivem_nui_wire",
    description:
      "TEMP agent setup: patch a NUI resource (fxmanifest client-hook + DOM probe in ui_page) so fxmind_fivem_nui_dump works. You configure this yourself — do not ask the user to edit scripts. ALWAYS call fxmind_fivem_nui_unwire when finished (or before Gate C). Ensures fxmind-nui-bridge is present.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Resource folder name that owns the ui_page (e.g. my_police).",
        },
      },
      required: ["resource"],
    },
  },
  {
    name: "fxmind_fivem_nui_dump",
    description:
      "Read structured NUI state for agent vision (better than screenshots). Prefer after fxmind_fivem_nui_wire. Triggers RCON fxmind_nui_dump (unless trigger=false), then reads .fxmind/state/nui-dump.json. Call fxmind_fivem_status first when triggering. Player must be in-game with the NUI open. After debugging, call fxmind_fivem_nui_unwire.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Optional resource name filter (only that NUI responds).",
        },
        trigger: {
          type: "boolean",
          description: "Request a fresh dump via RCON (default true). Set false to only read the last file.",
          default: true,
        },
        timeoutMs: {
          type: "number",
          description: "How long to wait for the dump file after trigger (default 3000, max 15000).",
        },
      },
    },
  },
  {
    name: "fxmind_fivem_nui_unwire",
    description:
      "Remove temporary NUI dump wiring added by fxmind_fivem_nui_wire (markers, probe script, wire state, dump file). MANDATORY cleanup after using nui_dump / when the task ends. If resource omitted, uses .fxmind/state/nui-wire.json.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Optional; defaults to the currently wired resource.",
        },
        clearDump: {
          type: "boolean",
          description: "Also delete .fxmind/state/nui-dump.json (default true).",
          default: true,
        },
      },
    },
  },
  {
    name: "fxmind_db_status",
    description:
      "Check the selected MySQL environment (dev by default, production from project .env). No network request; never returns the password. Use environment=production to check production configuration.",
    inputSchema: { type: "object", properties: { ...DB_ENVIRONMENT } },
  },
  {
    name: "fxmind_db_query",
    description:
      "Execute one SQL statement against the selected MySQL environment. production is ALWAYS read-only, even with approvedByUser=true. dev is the default: SELECT/SHOW/DESCRIBE and INSERT/UPDATE are allowed; DELETE/DROP/TRUNCATE require approvedByUser=true AFTER explicit user approval.",
    inputSchema: {
      type: "object",
      properties: {
        ...DB_ENVIRONMENT,
        query: { type: "string", description: "Single SQL statement." },
        approvedByUser: {
          type: "boolean",
          description:
            "Required true for DELETE/DROP/TRUNCATE after the user approved. Do not set true without asking.",
        },
        limit: {
          type: "number",
          description: "Max rows returned for SELECT (default 200).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fxmind_db_schema",
    description:
      "Get column metadata for a table, or list all tables if table_name is omitted. Like get_schema_info.",
    inputSchema: {
      type: "object",
      properties: {
        ...DB_ENVIRONMENT,
        table_name: {
          type: "string",
          description: "Optional bare table or database.table.",
        },
      },
    },
  },
  {
    name: "fxmind_db_sample",
    description:
      "Fetch a small sample of rows from a table (default 5, max 20). Like get_table_sample.",
    inputSchema: {
      type: "object",
      properties: {
        ...DB_ENVIRONMENT,
        table_name: { type: "string" },
        limit: { type: "number" },
      },
      required: ["table_name"],
    },
  },
  {
    name: "fxmind_db_explore",
    description:
      "List tables in the configured database with approx row counts / engines. Like explore_database.",
    inputSchema: { type: "object", properties: { ...DB_ENVIRONMENT } },
  },
  {
    name: "fxmind_db_analyze",
    description:
      "Analyze one table: status, exact COUNT(*), columns, indexes. Like analyze_table.",
    inputSchema: {
      type: "object",
      properties: {
        ...DB_ENVIRONMENT,
        table_name: { type: "string" },
      },
      required: ["table_name"],
    },
  },
  {
    name: "fxmind_panel_wait",
    description:
      "Host-chat dispatcher for /fxmind painel. Long-poll the local panel (localhost:3847) until demandas are clicked, then claim them. Returns { jobs: [{ id, title, prompt, projectRoot }] }. Empty jobs = keep waiting. Do not use an API key.",
    inputSchema: {
      type: "object",
      properties: {
        timeoutMs: {
          type: "number",
          description: "Wait up to this many ms (default 20000, max 25000).",
          default: 20000,
        },
      },
    },
  },
  {
    name: "fxmind_panel_pending",
    description:
      "List queued panel chat jobs without claiming them. Also heartbeats so the panel shows this chat as connected.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fxmind_panel_reply",
    description:
      "Post the host agent result into a panel thread after finishing a demanda (or follow-up).",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Panel thread id (job.id)." },
        content: { type: "string", description: "Assistant reply shown in the panel chat." },
      },
      required: ["threadId", "content"],
    },
  },
  {
    name: "fxmind_panel_fail",
    description: "Mark a panel thread as failed with an error message.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        error: { type: "string" },
      },
      required: ["threadId", "error"],
    },
  },
  {
    name: "fxmind_independent_review",
    description:
      "Optional independent read-only reviewer, invoked only when explicitly requested. Does not block closing a task. Results are retained as review artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: SESSION_ID_PROP.sessionId,
        executorCliId: {
          type: "string",
          description: "Optional executor CLI id so FxMind can prefer the same provider for the reviewer while selecting a stronger review model.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional task files when Git discovery/claims are unavailable.",
        },
      },
    },
  },
  {
    name: "fxmind_subagent_run",
    description:
      "Run a scoped sub-task on a fxmind subagent (provider set per role in the panel) and wait for its final text. explore: discovery; reader: known paths; general: bounded implementation; scout: external docs; reviewer: independent read-only verification.",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Subagent id: explore | reader | general | scout | reviewer.",
        },
        prompt: { type: "string", description: "The scoped task/question for the subagent." },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Known file paths to hand over (mainly for 'reader').",
        },
      },
      required: ["agent", "prompt"],
    },
  },
  {
    name: "fxmind_orchestrate",
    description:
      "Decompose a complex task into a DAG of subtasks and dispatch them across configured multi-provider CLI agents (OpenCode, Claude, Codex, Cursor Agent, Hermes).",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Overall orchestration goal." },
        strategy: {
          type: "string",
          enum: ["smart", "parallel", "sequential"],
          description: "Execution strategy (defaults to configured strategy).",
        },
        wait: {
          type: "boolean",
          description: "Wait for completion before returning consolidated subtask outputs (default: true).",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum wait timeout in milliseconds (default: 300000).",
        },
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              type: {
                type: "string",
                enum: ["explore", "implement", "review", "test", "query"],
              },
              provider: { type: "string", description: "Optional CLI provider override." },
              model: { type: "string", description: "Optional model id override." },
              effort: {
                type: "string",
                enum: ["low", "medium", "high", "max"],
              },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "Subtask IDs that must complete before this subtask starts.",
              },
              readOnly: {
                type: "boolean",
                description: "Force read-only mode for this subtask.",
              },
            },
            required: ["id", "description"],
          },
        },
      },
      required: ["task", "subtasks"],
    },
  },
  {
    name: "fxmind_orchestration_status",
    description:
      "Get progress, subtask states, and partial/final outputs for an orchestration session (or the active/latest session).",
    inputSchema: {
      type: "object",
      properties: {
        orchestrationId: {
          type: "string",
          description: "Optional orchestration id; omit for active or most recent session.",
        },
      },
    },
  },
  {
    name: "fxmind_orchestration_control",
    description:
      "Approve an orchestration awaiting confirmation or cancel a running orchestration.",
    inputSchema: {
      type: "object",
      properties: {
        orchestrationId: { type: "string", description: "Target orchestration id." },
        action: {
          type: "string",
          enum: ["approve", "cancel"],
          description: "Control action to apply.",
        },
      },
      required: ["orchestrationId", "action"],
    },
  },
  {
    name: "fxmind_orchestration_config",
    description:
      "Read or update multi-agent orchestration settings (mode, strategy, maxConcurrent, routing rules, allowedProviders).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set"],
          description: "Read ('get') or update ('set') configuration.",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Target config scope when action is 'set' (default: 'project').",
        },
        config: {
          type: "object",
          description: "Partial orchestration configuration fields to merge when action is 'set'.",
        },
      },
    },
  },
  // Desktop agent: listed on Windows only (tool group "desktop").
  ...desktopAgent.TOOL_DEFS,
];

let activeHostThreadId = null;
let pendingCalls = 0;
let inputClosed = false;

// Pipes are asynchronous on Windows: exit only once the last reply is written.
function exitAfterFlush() {
  process.stdout.write("", () => process.exit(0));
}

function hostToolDetail(args = {}) {
  const value =
    args.question ||
    args.query ||
    args.file ||
    args.table_name ||
    args.gate ||
    args.resource ||
    args.note ||
    args.command ||
    "";
  if (typeof value === "string") return value.slice(0, 240);
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return "";
  }
}

function reportHostMcp(threadId, toolName, args, status) {
  const name = String(toolName || "");
  if (!threadId || !name || name.startsWith("fxmind_panel_")) {
    return Promise.resolve();
  }
  return panelHost
    .activity(threadId, {
      kind: "mcp",
      name,
      server: SERVER_INFO.name,
      label: name,
      detail: hostToolDetail(args),
      status,
    })
    .catch(() => {});
}

async function playbookTool(root, args = {}) {
  const playbooks = require("./lib/playbooks");
  const action = args.action || "list";
  if (action === "list") return { ok: true, playbooks: playbooks.loadPlaybooks(root).map(playbooks.summarize) };
  if (action === "match") {
    const plan = await playbooks.planTaskAsync(root, args.query || "");
    return {
      ok: true,
      kind: plan.kind,
      confidence: plan.confidence,
      playbook: plan.playbook,
      stale: plan.stale,
      text: plan.playbookText || undefined,
    };
  }
  const targets = args.id ? [playbooks.getPlaybook(root, args.id)] : action === "check" ? playbooks.loadPlaybooks(root) : [];
  if (!targets.length || targets.includes(null)) return { ok: false, error: `Playbook not found: ${args.id || "(id required)"}` };
  if (action === "get") {
    return { ok: true, text: playbooks.renderPlaybook(root, targets[0], playbooks.resolveSteps(root, targets[0])) };
  }
  if (action === "check") {
    const results = targets.map((pb) => ({ id: pb.id, ...playbooks.checkPlaybook(root, pb) }));
    return { ok: results.every((r) => r.ok), results };
  }
  return { ok: false, error: `Unknown action: ${action}` };
}

async function dispatchTool(name, args, ctx = {}) {
  const root = targetRoot();
  const dbOptions = { root, environment: args.environment, readOnly: isReadonly() };
  if (desktopAgent.TOOL_NAMES.has(name)) {
    return desktopAgent.dispatch(name, args);
  }
  switch (name) {
    case "fxmind_route_tool":
      return routeTool(args.request || "", {
        availableTools: listTools(root).map((tool) => tool.name),
        context: args.context || {},
      });

    case "fxmind_storage_status":
      return storage.status(root);

    case "fxmind_image_resize":
      return resizeImage(root, args);

    case "fxmind_storage_upload_image":
      return storage.uploadImage(root, args);

    case "fxmind_list_memories":
      return { ok: true, memories: tools.listMemories(root) };

    case "fxmind_validate_memories": {
      const validation = tools.validateMemories(root, {
        checkPaths: args.checkPaths !== false,
      });
      return {
        ...validation,
        duplicates: tools.findMemoryDuplicates(root),
      };
    }

    case "fxmind_query":
      return tools.queryGraphAsync(root, args.question || "", {
        dfs: Boolean(args.dfs),
        budget: Number(args.budget) || 1500,
      });

    case "fxmind_graph": {
      const fact = args.addFact
        ? require("./lib/atomic-memory").addFact(root, args.addFact)
        : null;
      const graph = tools.buildGraph(root, {
        updateHtml: args.updateHtml !== false,
      });
      return fact ? { ...graph, fact } : graph;
    }

    case "fxmind_check_update":
      return checkForUpdate({
        projectRoot: root,
        force: Boolean(args.force),
      });

    case "fxmind_drift_check":
      return tools.driftCheck(root, args.file || "");

    case "fxmind_start_task":
      return {
        ok: true,
        ...tools.startTask(root, {
          note: args.note || "",
          trivial: Boolean(args.trivial),
          ui: Boolean(args.ui),
          kind: args.kind,
          playbook: args.playbook,
          ...sessionExtra(args),
        }),
      };

    case "fxmind_playbook":
      return playbookTool(root, args);

    case "fxmind_health":
      return require("./lib/health").runHealth(root, { fix: args.fix === true });

    case "fxmind_search":
      return searchSource(root, args);

    case "fxmind_read_file":
      return readSource(root, args);

    case "fxmind_gate_status":
      return tools.gateStatus(root, sessionExtra(args));

    case "fxmind_record_gate": {
      const gate = String(args.gate ?? "").toUpperCase();
      if (gate === "V") {
        // Old Claude sessions may still call V. Acknowledge without writing state,
        // running a reviewer, or triggering a retry loop.
        return { ok: true, removed: true, message: "Gate V removed. Continue with C after B." };
      }
      const data = tools.recordGate(root, gate, true, {
        note: args.note || "",
        evidence: args.evidence,
        playbookVerified: args.playbook_verified === true,
        ...sessionExtra(args),
      });
      if (data?.error === "multiple_active_sessions") {
        return data;
      }
      // Legacy verified sessions may still have eligible memory. New sessions do not invent verification.
      if (gate === "C" && data?.gates?.C?.complete) {
        try {
          const autoMemory = require("./lib/auto-memory");
          const memory = await autoMemory.learnAfterGate(root, data);
          if (memory.status === "learned") {
            tools.buildGraph(root, { updateHtml: false });
          }
          tools.appendMetric(root, { event: "auto_memory", status: memory.status, reason: memory.reason || null, topic: memory.topic || null });
          return { ok: true, ...data, autoMemory: memory };
        } catch (error) {
          // Learning must not retroactively fail a successfully recorded Gate C.
          return { ok: true, ...data, autoMemory: { status: "error", reason: "learning_failed" } };
        }
      }
      return { ok: true, ...data };
    }

    case "fxmind_claim_paths":
      return tools.claimPaths(root, args.paths || [], sessionExtra(args));

    case "fxmind_release_paths":
      return tools.releasePaths(root, args.paths || [], sessionExtra(args));

    case "fxmind_session_status":
      return tools.sessionStatus(root);

    case "fxmind_record_correction":
      return tools.recordCorrection(root, {
        title: args.title,
        category: args.category,
        bad: args.bad,
        good: args.good,
        rule: args.rule,
        notes: args.notes,
        commit: args.commit,
        severity: args.severity,
        paths: args.paths,
        resources: args.resources,
        skill_target: args.skill_target,
      });

    case "fxmind_list_corrections":
      return {
        ok: true,
        corrections: tools.listCorrections(root, {
          status: args.status || undefined,
          category: args.category || undefined,
        }),
      };

    case "fxmind_fivem_install":
      return fivemRcon.installFivemDev({
        force: Boolean(args.force),
        password: args.password || undefined,
      });

    case "fxmind_fivem_status":
      return fivemRcon.statusProbe();

    case "fxmind_fivem_cmd":
      return tools.withFileLockAsync(root, "fivem-rcon", () =>
        fivemRcon.execRcon(args.command || ""),
      );

    case "fxmind_fivem_console_tail":
      return fivemRcon.consoleTail({ lines: args.lines });

    case "fxmind_fivem_nui_wire":
      return fivemNuiDump.wireNuiDump({
        resource: args.resource || "",
      });

    case "fxmind_fivem_nui_dump":
      return fivemNuiDump.nuiDump({
        resource: args.resource || undefined,
        trigger: args.trigger !== false,
        timeoutMs: args.timeoutMs,
      });

    case "fxmind_fivem_nui_unwire":
      return fivemNuiDump.unwireNuiDump({
        resource: args.resource || undefined,
        clearDump: args.clearDump !== false,
      });

    case "fxmind_db_status":
      return fxmindMysql.status(dbOptions);

    case "fxmind_db_query":
      return fxmindMysql.executeSql(args.query || "", {
        ...dbOptions,
        approvedByUser: isReadonly() ? false : Boolean(args.approvedByUser),
        limit: args.limit,
        readOnly: isReadonly(),
      });

    case "fxmind_db_schema":
      return fxmindMysql.getSchemaInfo({ ...dbOptions, table_name: args.table_name });

    case "fxmind_db_sample":
      return fxmindMysql.getTableSample({
        ...dbOptions,
        table_name: args.table_name,
        limit: args.limit,
      });

    case "fxmind_db_explore":
      return fxmindMysql.exploreDatabase(dbOptions);

    case "fxmind_db_analyze":
      return fxmindMysql.analyzeTable({ ...dbOptions, table_name: args.table_name });

    case "fxmind_panel_wait":
      return panelHost.wait(args.timeoutMs);

    case "fxmind_panel_pending":
      return panelHost.pending();

    case "fxmind_panel_reply":
      return panelHost.reply(args.threadId, args.content);

    case "fxmind_panel_fail":
      return panelHost.fail(args.threadId, args.error);

    case "fxmind_independent_review": {
      const session = tools.gateStatus(root, sessionExtra(args));
      if (!session?.taskActive || !session.sessionId) {
        return { ok: false, error: "no_active_session", message: "Start the Task before independent review." };
      }
      const files = Array.isArray(args.files) && args.files.length
        ? [...new Set(args.files)]
        : session.claimedPaths?.length
          ? [...session.claimedPaths]
          : independentReview.changedFiles(root);
      if (!files.length) {
        return { ok: false, error: "no_changed_files", message: "No task files are available for independent review." };
      }
      const panelCli = require("./lib/panel-cli");
      return Promise.resolve(panelCli.runSubagentTask(root, {
        agent: "reviewer",
        prompt: independentReview.buildPrompt(root, session, files, {}),
        paths: files,
        preferredCliId: args.executorCliId || callerCliId() || undefined,
      })).then((result) => {
        if (!result?.ok) return result;
        const record = independentReview.recordReview(root, {
          sessionId: session.sessionId,
          session,
          files,
          reviewer: {
            agent: "reviewer",
            cliId: result.cliId || null,
            model: result.model || null,
            effort: result.effort || null,
          },
          output: result.output || "",
        });
        return {
          ok: record.verdict === "verified",
          reviewId: record.reviewId,
          verdict: record.verdict,
          reviewer: record.reviewer,
          fingerprint: record.fingerprint,
          output: result.output || "",
        };
      });
    }

    case "fxmind_subagent_run": {
      // Lazy require: panel-cli.js pulls in the panel's thread store on
      // load, which every agent session spinning up this stdio server
      // shouldn't pay for unless a subagent is actually invoked.
      const panelCli = require("./lib/panel-cli");
      return panelCli.runSubagentTask(root, {
        agent: args.agent,
        prompt: args.prompt || "",
        paths: Array.isArray(args.paths) ? args.paths : [],
      });
    }

    case "fxmind_orchestrate": {
      const { brokerCall } = require("./lib/orchestration-client");
      const started = await brokerCall(root, "start", {
        plan: { task: args.task || "", strategy: args.strategy, subtasks: args.subtasks || [] },
        timeoutMs: args.timeoutMs,
      });
      if (started.ok && started.orchestrationId) ctx.onOrchestrationStarted?.(started.orchestrationId);
      if (!started.ok || started.awaitingApproval || args.wait === false) return started;
      return brokerCall(root, "wait", {
        id: started.orchestrationId, timeoutMs: args.timeoutMs,
      }, (Number(args.timeoutMs) || 300000) + 10000);
    }
    case "fxmind_orchestration_status": {
      const { brokerCall } = require("./lib/orchestration-client");
      return brokerCall(root, "status", { id: args.orchestrationId || "" });
    }
    case "fxmind_orchestration_control": {
      const { brokerCall } = require("./lib/orchestration-client");
      const id = String(args.orchestrationId || "").trim();
      if (!id) return { ok: false, error: "orchestrationId is required" };
      if (!["approve", "cancel"].includes(args.action)) {
        return { ok: false, error: "Unknown control action: " + args.action };
      }
      return brokerCall(root, args.action, { id });
    }
    case "fxmind_orchestration_config": {
      const { brokerCall } = require("./lib/orchestration-client");
      const action = args.action || "get";
      if (action === "get") return brokerCall(root, "config_get");
      if (action === "set") return brokerCall(root, "config_set", {
        scope: args.scope || "project", config: args.config || {},
      });
      return { ok: false, error: "Unknown config action: " + action };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

/** Compact text for the agent: Markdown for memory queries, unindented JSON otherwise. */
function formatToolResult(toolName, result) {
  if (toolName === "fxmind_query" && result && result.ok !== false) {
    return formatQueryResult(result);
  }
  if (toolName === "fxmind_playbook" && result?.ok && result.text && !result.playbook) {
    return result.text;
  }
  return JSON.stringify(result);
}

/**
 * Optional tool groups. Core tools are always listed; groups that cannot work
 * in this project are hidden so their schemas do not cost context every turn.
 * FXMIND_MCP_TOOLS=all|fivem,db,panel,storage overrides the detection.
 */
const TOOL_GROUPS = {
  storage: (name) => name === "fxmind_storage_upload_image",
  fivem: (name) => name.startsWith("fxmind_fivem_"),
  db: (name) => name.startsWith("fxmind_db_") && name !== "fxmind_db_status",
  panel: (name) =>
    name.startsWith("fxmind_panel_") ||
    name === "fxmind_subagent_run" ||
    name.startsWith("fxmind_orchestrat"),
  // Windows-only: off Windows every call fails, so the schemas would only cost context.
  desktop: (name) => desktopAgent.TOOL_NAMES.has(name),
};

function toolGroupOf(name) {
  return Object.keys(TOOL_GROUPS).find((group) => TOOL_GROUPS[group](name)) || null;
}

function hasFivemPack(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".fxmind", "packs.json"), "utf8"));
    const packs = Array.isArray(manifest.packs) ? manifest.packs : [];
    return packs.some((pack) => (typeof pack === "string" ? pack : pack?.id) === "fivem");
  } catch {
    // No manifest (older install / global store): keep the tools available.
    return true;
  }
}

function enabledToolGroups(root, env = process.env, platform = process.platform) {
  const explicit = String(env.FXMIND_MCP_TOOLS || "").trim().toLowerCase();
  if (explicit) {
    const wanted = new Set(explicit.split(/[\s,]+/).filter(Boolean));
    const groups = wanted.has("all")
      ? new Set(Object.keys(TOOL_GROUPS))
      : new Set(Object.keys(TOOL_GROUPS).filter((group) => wanted.has(group)));
    // Desktop tools never work off Windows, whatever the override says.
    if (platform !== "win32") groups.delete("desktop");
    return groups;
  }
  const groups = new Set(["panel"]);
  if (platform === "win32") groups.add("desktop");
  if (storage.status(root, env).configured) groups.add("storage");
  if (hasFivemPack(root)) groups.add("fivem");
  try {
    if (fxmindMysql.status({ root }).configured || fxmindMysql.status({ root, environment: "production" }).configured) groups.add("db");
  } catch {
    // Unparseable connection string: fxmind_db_status still reports it.
  }
  return groups;
}

/**
 * FXMIND_MCP_READONLY=1: query-only mode for hosts that put the MCP in front
 * of people who must not change anything (e.g. the PortSpace FiveHub staff
 * chat, which reaches this server through the Portspace Agent). Only tools
 * that never write are listed or callable, and fxmind_db_query accepts a
 * single read statement run inside a READ ONLY transaction.
 */
const READONLY_TOOLS = new Set([
  "fxmind_route_tool",
  "fxmind_storage_status",
  "fxmind_list_memories",
  "fxmind_query",
  "fxmind_search",
  "fxmind_read_file",
  "fxmind_check_update",
  "fxmind_fivem_status",
  "fxmind_db_status",
  "fxmind_db_query",
  "fxmind_db_schema",
  "fxmind_db_sample",
  "fxmind_db_explore",
  "fxmind_db_analyze",
  "fxmind_orchestration_status",
]);

function isReadonly(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.FXMIND_MCP_READONLY || "").trim());
}

// Codex requires explicit MCP annotations to auto-approve read-only calls in
// a non-interactive review. Never annotate gate/task/write tools as read-only.
const SAFE_MEMORY_TOOLS = new Set([
  "fxmind_route_tool", "fxmind_list_memories", "fxmind_query",
  "fxmind_search", "fxmind_read_file",
]);
function listTools(root = targetRoot(), env = process.env, platform = process.platform) {
  const groups = enabledToolGroups(root, env, platform);
  const readonly = isReadonly(env);
  return TOOL_DEFS.filter((tool) => {
    if (readonly && !READONLY_TOOLS.has(tool.name)) return false;
    const group = toolGroupOf(tool.name);
    return !group || groups.has(group);
  }).map((tool) => SAFE_MEMORY_TOOLS.has(tool.name)
    ? { ...tool, annotations: {
      readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false,
    } }
    : tool);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** Runs a tool with host reporting and returns a CallToolResult (never rejects). */
function runToolCall(toolName, args, ctx = {}) {
  const isPanelTool = String(toolName || "").startsWith("fxmind_panel_");
  const trackedThreadId = isPanelTool ? null : activeHostThreadId;
  return Promise.resolve()
    .then(() => reportHostMcp(trackedThreadId, toolName, args, "running"))
    .then(() => dispatchTool(toolName, args, ctx))
    .then((result) => {
      if (toolName === "fxmind_panel_wait" && result?.jobs?.length) {
        activeHostThreadId = String(result.jobs[0].id || "");
      }
      if (toolName === "fxmind_panel_reply" || toolName === "fxmind_panel_fail") {
        activeHostThreadId = null;
      }
      const status = result && result.ok === false ? "error" : "done";
      return reportHostMcp(trackedThreadId, toolName, args, status).then(() => ({
        // Tools may return MCP content blocks (view_screen sends an image).
        content: Array.isArray(result?.mcpContent)
          ? result.mcpContent
          : [{ type: "text", text: formatToolResult(toolName, result) }],
        isError: Boolean(result && result.ok === false),
      }));
    })
    .catch((error) =>
      reportHostMcp(trackedThreadId, toolName, args, "error").then(() => ({
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      })));
}

// ---- MCP tasks extension (io.modelcontextprotocol/tasks, 2026-07-28) ----
// Tasks live in this process: the stdio client owns the process, so a
// restart loses them (tasks/get then answers "Task not found", which the
// spec allows). The orchestration broker keeps its own durable state.
const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
const TASK_TOOLS = new Set(["fxmind_orchestrate", "fxmind_independent_review", "fxmind_subagent_run"]);
const TASK_TTL_MS = 60 * 60 * 1000;
const TASK_POLL_INTERVAL_MS = 2000;
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);
const tasksById = new Map();

function clientSupportsTasks(msg) {
  const extensions = msg.params?._meta?.[META_CLIENT_CAPS]?.extensions;
  return Boolean(extensions && typeof extensions === "object" && extensions[TASKS_EXTENSION]);
}

function touchTask(task, status, fields = {}) {
  Object.assign(task, fields, { status, lastUpdatedAt: new Date().toISOString() });
}

function createTask(toolName, args) {
  const now = new Date().toISOString();
  const task = {
    taskId: require("crypto").randomUUID(),
    toolName,
    status: "working",
    statusMessage: `${toolName} is running.`,
    createdAt: now,
    lastUpdatedAt: now,
    createdAtMs: Date.now(),
    result: null,
    orchestrationId: null,
  };
  // Registered before the reply so a tasks/get for this id always resolves.
  tasksById.set(task.taskId, task);
  const ctx = { onOrchestrationStarted: (orchestrationId) => { task.orchestrationId = orchestrationId; } };
  runToolCall(toolName, args, ctx).then((result) => {
    if (TERMINAL_TASK_STATUSES.has(task.status)) return; // cancelled meanwhile
    // A tool error (isError) is still a completed task per the extension spec.
    touchTask(task, "completed", { result, statusMessage: `${toolName} finished.` });
  });
  return task;
}

function getTask(taskId) {
  pruneExpiredTasks();
  return typeof taskId === "string" ? tasksById.get(taskId) || null : null;
}

function pruneExpiredTasks(now = Date.now()) {
  for (const [taskId, task] of tasksById) {
    if (now - task.createdAtMs > TASK_TTL_MS) tasksById.delete(taskId);
  }
}

function cancelTask(task) {
  if (TERMINAL_TASK_STATUSES.has(task.status)) return;
  touchTask(task, "cancelled", { statusMessage: "Cancelled by the client." });
  // Cooperative: only orchestrations can actually be stopped; subagent and
  // review runs finish in the background and their result is dropped.
  if (task.orchestrationId) {
    const { brokerCall } = require("./lib/orchestration-client");
    Promise.resolve(brokerCall(targetRoot(), "cancel", { id: task.orchestrationId })).catch(() => {});
  }
}

function taskView(task, { withOutcome = false } = {}) {
  const view = {
    taskId: task.taskId,
    status: task.status,
    statusMessage: task.statusMessage,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: TASK_TTL_MS,
  };
  if (!TERMINAL_TASK_STATUSES.has(task.status)) view.pollIntervalMs = TASK_POLL_INTERVAL_MS;
  if (withOutcome && task.status === "completed") view.result = task.result;
  return view;
}

// Request ids in flight / cancelled by notifications/cancelled. JSON-encoded
// so 1 and "1" stay distinct.
const inFlightCalls = new Set();
const cancelledCalls = new Set();

function isModernRequest(msg) {
  const meta = msg.params?._meta;
  return msg.method === "server/discover" ||
    Boolean(meta && typeof meta === "object" && Object.prototype.hasOwnProperty.call(meta, META_VERSION));
}

/** Validates the per-request _meta of a 2026-07-28 request; returns a JSON-RPC error or null. */
function modernRequestError(msg) {
  const meta = msg.params?._meta;
  const version = meta?.[META_VERSION];
  if (typeof version !== "string" || !version) {
    return { code: -32602, message: `Invalid params: missing _meta["${META_VERSION}"]` };
  }
  if (version !== MODERN_PROTOCOL_VERSION) {
    return {
      code: -32022,
      message: "Unsupported protocol version",
      data: { supported: [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS], requested: version },
    };
  }
  const caps = meta[META_CLIENT_CAPS];
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) {
    return { code: -32602, message: `Invalid params: missing _meta["${META_CLIENT_CAPS}"]` };
  }
  return null;
}

/** Adds the 2026-07-28 result envelope (resultType + serverInfo) when the request was modern. */
function shapeResult(result, modern) {
  if (!modern) return result;
  return {
    resultType: "complete",
    ...result,
    _meta: { ...(result._meta || {}), [META_SERVER_INFO]: SERVER_INFO },
  };
}

function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0") {
    return;
  }
  const id = msg.id;
  const method = msg.method;
  const modern = isModernRequest(msg);
  const reply = (result) => send({ jsonrpc: "2.0", id, result: shapeResult(result, modern) });

  if (method === "notifications/cancelled") {
    // Unknown, finished or malformed cancellations are ignored (spec).
    const key = JSON.stringify(msg.params?.requestId);
    if (key !== undefined && inFlightCalls.has(key)) cancelledCalls.add(key);
    return;
  }

  if (modern && id !== undefined) {
    const error = modernRequestError(msg);
    if (error) {
      send({ jsonrpc: "2.0", id, error });
      return;
    }
  }

  if (method === "server/discover") {
    reply({
      supportedVersions: [MODERN_PROTOCOL_VERSION],
      capabilities: { ...SERVER_CAPABILITIES, extensions: { [TASKS_EXTENSION]: {} } },
      ...CACHE_HINTS,
    });
    return;
  }

  if (method === "initialize") {
    const requested = msg.params?.protocolVersion;
    send({
      jsonrpc: "2.0",
      id,
      result: {
        // Echo a legacy version we speak; otherwise offer our newest legacy one.
        protocolVersion: LEGACY_PROTOCOL_VERSIONS.includes(requested) ? requested : LEGACY_PROTOCOL_VERSIONS[0],
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  // Legacy liveness check: the spec requires an empty result.
  if (method === "ping") {
    if (id !== undefined) reply({});
    return;
  }

  if (method === "tools/list") {
    reply(modern ? { tools: listTools(), ...CACHE_HINTS } : { tools: listTools() });
    return;
  }

  if (method === "tools/call") {
    const toolName = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (isReadonly() && !READONLY_TOOLS.has(String(toolName || ""))) {
      reply({
        content: [{ type: "text", text: `${toolName} is disabled in read-only mode (FXMIND_MCP_READONLY).` }],
        isError: true,
      });
      return;
    }
    // Long-running tools become MCP tasks for clients that declared the
    // extension; the call returns at once and the client polls tasks/get.
    if (modern && TASK_TOOLS.has(String(toolName)) && clientSupportsTasks(msg)) {
      const task = createTask(toolName, args);
      reply({ ...taskView(task), resultType: "task" });
      return;
    }
    const callKey = JSON.stringify(id);
    inFlightCalls.add(callKey);
    pendingCalls += 1;
    runToolCall(toolName, args)
      .then((result) => {
        // A cancelled request gets no response (spec); the tool itself still
        // runs to completion because dispatchTool has no abort signal.
        if (!cancelledCalls.has(callKey)) reply(result);
      })
      .finally(() => {
        inFlightCalls.delete(callKey);
        cancelledCalls.delete(callKey);
        pendingCalls -= 1;
        if (pendingCalls === 0 && inputClosed) exitAfterFlush();
      });
    return;
  }

  if (method === "tasks/get" || method === "tasks/cancel" || method === "tasks/update") {
    if (!modern || !clientSupportsTasks(msg)) {
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32021,
          message: "Missing required client capability",
          data: { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
        },
      });
      return;
    }
    const task = getTask(msg.params?.taskId);
    if (!task) {
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Failed to retrieve task: Task not found" } });
      return;
    }
    if (method === "tasks/get") {
      reply(taskView(task, { withOutcome: true }));
    } else if (method === "tasks/cancel") {
      cancelTask(task);
      reply({});
    } else {
      // No fxmind task asks for input, so there is nothing to apply.
      reply({});
    }
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

function startServer() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // JSON-RPC 2.0: unparseable request → Parse error with a null id.
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      try {
        handleMessage(message);
      } catch (error) {
        if (message && message.id !== undefined) {
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: `Internal error: ${error.message}` } });
        }
      }
    }
  });

  // Answer the calls already in flight before leaving (e.g. a client that
  // sends its last request and closes stdin).
  process.stdin.on("end", () => {
    inputClosed = true;
    if (pendingCalls === 0) exitAfterFlush();
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  SERVER_INFO,
  TOOL_DEFS,
  listTools,
  enabledToolGroups,
  formatToolResult,
  // Exposed for tests only.
  _tasks: { cancelTask, taskView },
};
