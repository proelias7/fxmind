/**
 * Desktop agent tools for the fxmind MCP server (Windows).
 *
 * Ported from the Portspace Agent: the MCP contract (names, input schemas,
 * argument checks) comes from the Portspace hub, and the behaviour from the
 * agent's vision.* operations. The native part runs in a long-lived Windows
 * PowerShell 5.1 helper (lib/desktop-host.ps1 + lib/desktop-native.cs), with
 * no npm dependency. desktop_observe/desktop_act run the pinned agent-desktop
 * release (lib/agent-desktop.js), downloaded and hash-checked on first use.
 *
 * Adaptations: the tools act on this machine (agent_id is accepted for schema
 * compatibility and ignored); the host's own tool approval replaces the
 * Portspace tray consent; long flows wait for completion instead of returning
 * RUNNING + get_command.
 */

const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");
const agentDesktop = require("./lib/agent-desktop");

const NATIVE_SOURCE = path.join(__dirname, "lib", "desktop-native.cs");
const HOST_SCRIPT = path.join(__dirname, "lib", "desktop-host.ps1");
const STARTUP_TIMEOUT_MS = 60_000;
const UNSUPPORTED = "Desktop control is available only on Windows with an interactive desktop session.";

const AGENT_ID = { agent_id: { type: "string" } };

const TOOL_DEFS = [
  {
    name: "view_screen",
    description: "Capture the Windows screen and return a JPEG image for visual inspection. The screenshot is never written to disk.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID,
      screen: { type: "string", enum: ["all", "active"], description: "Whole virtual screen or the active window." },
      max_width: { type: "number", description: "Output width between 320 and 1920 pixels (default 1280)." },
      quality: { type: "number", description: "JPEG quality between 25 and 85 (default 65)." },
    }, additionalProperties: false },
  },
  {
    name: "click_screen",
    description: "Click ABSOLUTE physical desktop coordinates, not pixels of the scaled image. Compute x=originX+pixelX*sourceWidth/width and y=originY+pixelY*sourceHeight/height from the view_screen metadata.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, x: { type: "number" }, y: { type: "number" },
      button: { type: "string", enum: ["left", "right"] },
    }, required: ["x", "y"], additionalProperties: false },
  },
  {
    name: "type_text",
    description: "Type text into the active window.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, text: { type: "string" },
    }, required: ["text"], additionalProperties: false },
  },
  {
    name: "scroll_screen",
    description: "Scroll at the current cursor position. Positive delta scrolls up, negative scrolls down.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, delta: { type: "number" },
    }, required: ["delta"], additionalProperties: false },
  },
  {
    name: "drag_screen",
    description: "Drag with the button held between absolute physical desktop coordinates. Confirms the input was sent, NOT the visual result.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, x: { type: "number" }, y: { type: "number" },
      to_x: { type: "number" }, to_y: { type: "number" },
      duration_ms: { type: "number", description: "50 to 3000 ms; default 350" },
      button: { type: "string", enum: ["left", "right"] },
    }, required: ["x", "y", "to_x", "to_y"], additionalProperties: false },
  },
  {
    name: "hotkey",
    description: "Keyboard shortcut in the active window, e.g. ctrl+s, ctrl+shift+s, ctrl+z. Modifiers are always released after the action.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, keys: { type: "string" },
    }, required: ["keys"], additionalProperties: false },
  },
  {
    name: "press_key",
    description: "Press a special or simple key in the active window (escape, enter, delete, arrows, tab, F1-F12). For modifiers use hotkey.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, key: { type: "string" }, count: { type: "number" },
    }, required: ["key"], additionalProperties: false },
  },
  {
    name: "hover_screen",
    description: "Move the cursor without clicking; useful to inspect submenus and tooltips.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, x: { type: "number" }, y: { type: "number" },
    }, required: ["x", "y"], additionalProperties: false },
  },
  {
    name: "double_click_screen",
    description: "Left double-click at physical desktop coordinates.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, x: { type: "number" }, y: { type: "number" },
    }, required: ["x", "y"], additionalProperties: false },
  },
  {
    name: "window_info",
    description: "Read the active window (no filters), or a visible window by partial title and/or PID; returns title, PID, coordinates and focus.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, title: { type: "string" }, pid: { type: "number" },
    }, additionalProperties: false },
  },
  {
    name: "activate_window",
    description: "Try to bring the visible window matching a partial title and/or PID to the foreground; fails if focus is not confirmed.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, title: { type: "string" }, pid: { type: "number" },
      timeout_ms: { type: "number", description: "100 to 5000 ms; default 1500" },
    }, additionalProperties: false },
  },
  {
    name: "desktop_observe",
    description: "Read desktop apps through the accessibility tree (agent-desktop) with no screenshot, focus or mouse. snapshot returns qualified refs (@<snapshot>:eN) to use in desktop_act. args = CLI tokens, one item per token (e.g. [\"--app\",\"notepad.exe\",\"-i\",\"--compact\"]). Response = JSON envelope {ok,data|error}. Full guide: command \"skills\" with args [\"get\",\"desktop\"] and [\"get\",\"platform\"]. The first use downloads the pinned agent-desktop release (SHA-256 checked).",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID,
      command: { type: "string", enum: ["snapshot", "find", "get", "is", "list-apps", "list-windows", "list-surfaces", "list-displays", "list-notifications", "clipboard-get", "wait", "status", "version", "skills"] },
      args: { type: "array", maxItems: 48, items: { type: "string" }, description: "CLI tokens, without the command name. Refs go as they are, with no extra quotes." },
      timeout_ms: { type: "number", description: "1000 to 120000; default 30000. Chromium/Electron apps: raise the snapshot --timeout-ms too." },
    }, required: ["command"], additionalProperties: false },
  },
  {
    name: "desktop_act",
    description: "Act on desktop apps through accessibility (agent-desktop): click, set-value, select, toggle, check, expand, scroll, press, launch, close-app, windows, clipboard, notifications and batch. Headless by default (no focus stealing, no mouse movement); headed=true only when the action needs physical input (type, double-click, right-click, hover, drag, focus). After acting, check with desktop_observe (get/is/snapshot). Retry a failed action only when error.disposition.retry is \"safe\". Sensitive text: use stdin with set-value/type/clipboard-set. close-app uses the list-apps name; UWP apps (e.g. Calculator) may not appear there.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID,
      command: { type: "string", enum: ["click", "double-click", "triple-click", "right-click", "type", "set-value", "clear", "focus", "select", "toggle", "check", "uncheck", "expand", "collapse", "scroll", "scroll-to", "press", "hover", "drag", "mouse-move", "mouse-click", "mouse-wheel", "launch", "close-app", "focus-window", "resize-window", "move-window", "minimize", "maximize", "restore", "open-system-surface", "list-notifications", "dismiss-notification", "dismiss-all-notifications", "notification-action", "clipboard-set", "clipboard-clear", "batch", "wait"] },
      args: { type: "array", maxItems: 48, items: { type: "string" }, description: "CLI tokens, e.g. [\"@s1:e3\"] or [\"@s1:e2\",\"text\"]. batch: [JSON of the {command,args} entries, \"--stop-on-error\"]." },
      headed: { type: "boolean", description: "Physical input (focus/cursor/keyboard). Default false." },
      stdin: { type: "string", description: "Text sent through stdin (type, set-value, clipboard-set); kept out of the process arguments." },
      timeout_ms: { type: "number", description: "1000 to 120000; default 30000" },
    }, required: ["command"], additionalProperties: false },
  },
  {
    name: "inspect_background_ui",
    description: "List the Windows UI Automation controls of a window (without bringing it forward, moving the cursor or typing). Returns automationId, name and controlType. Custom canvases may expose no controls.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, window_title: { type: "string" }, pid: { type: "number" },
      limit: { type: "number", description: "1 to 150, default 80" },
    }, additionalProperties: false },
  },
  {
    name: "execute_background_ui",
    description: "Run a local flow of 1 to 24 UIA steps WITHOUT STEALING FOCUS: assert_exists, wait_for, invoke, set_value. Uses no physical mouse/keyboard. invoke is dispatched, but its functional result must be checked with a later assert_exists/wait_for.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID, window_title: { type: "string" }, pid: { type: "number" },
      steps: { type: "array", minItems: 1, maxItems: 24, items: {
        type: "object", properties: {
          op: { type: "string", enum: ["assert_exists", "wait_for", "invoke", "set_value"] },
          selector: { type: "object", properties: {
            name: { type: "string" }, automationId: { type: "string" }, controlType: { type: "number" },
          }, additionalProperties: false },
          value: { type: "string" },
          timeoutMs: { type: "number", description: "100-5000 for wait_for" },
        }, required: ["op", "selector"], additionalProperties: false,
      } },
    }, required: ["steps"], additionalProperties: false },
  },
  {
    name: "gui_sequence",
    description: "Run up to 32 Windows UI-only actions in sequence, without a shell, stopping if focus leaves the target window or any action fails. Sent input is not a verified visual result: use view_screen.",
    inputSchema: { type: "object", properties: {
      ...AGENT_ID,
      window_title: { type: "string", description: "Substring of the window title that must stay active" },
      pid: { type: "number", description: "Target window PID (optional when window_title is given)" },
      steps: { type: "array", minItems: 1, maxItems: 32, items: {
        type: "object", properties: {
          op: { type: "string", enum: ["click", "drag", "hotkey", "key", "type", "scroll", "hover", "double_click", "wait"] },
          params: { type: "object", description: "Operation parameters; drag uses x,y,toX,toY,durationMs; hotkey uses keys." },
        }, required: ["op", "params"], additionalProperties: false,
      } },
    }, required: ["steps"], additionalProperties: false },
  },
];

// Read-only tools carry the same MCP hints as in the Portspace hub.
const READ_ONLY = new Set(["view_screen", "window_info", "inspect_background_ui", "desktop_observe"]);
for (const tool of TOOL_DEFS) {
  if (READ_ONLY.has(tool.name)) {
    tool.annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  }
}

const TOOL_NAMES = new Set(TOOL_DEFS.map((tool) => tool.name));

class ToolError extends Error {}

const str = (value) => (typeof value === "string" ? value : undefined);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const isInt = (value) => Number.isInteger(value);
const validPid = (pid) => isInt(pid) && pid >= 0 && pid <= 4294967295;

// ---- keys (lookupVirtualKey / chordKeys from the agent) ----

const NAMED_KEYS = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12,
  enter: 0x0d, return: 0x0d, esc: 0x1b, escape: 0x1b,
  tab: 0x09, space: 0x20, backspace: 0x08, delete: 0x2e,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  insert: 0x2d,
};
const MODIFIERS = new Set([0x10, 0x11, 0x12]);

function lookupVirtualKey(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_KEYS, key)) return NAMED_KEYS[key];
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    if (code >= 97 && code <= 122) return code - 32;
    if (code >= 48 && code <= 57) return code;
  }
  const fn = /^f(\d{1,2})$/.exec(key);
  if (fn) {
    const n = Number(fn[1]);
    if (n >= 1 && n <= 12) return 0x70 + n - 1;
  }
  return null;
}

function chordKeys(raw) {
  const parts = String(raw ?? "").split("+");
  if (parts.length < 2 || parts.length > 4) {
    throw new ToolError("hotkey needs modifier(s) and one key, e.g. ctrl+shift+s");
  }
  const result = [];
  parts.forEach((part, i) => {
    const vk = lookupVirtualKey(part);
    if (vk === null || result.includes(vk)) throw new ToolError("unknown or duplicate key");
    const modifier = MODIFIERS.has(vk);
    if ((i === parts.length - 1 && modifier) || (i < parts.length - 1 && !modifier)) {
      throw new ToolError("modifiers must come before the final key");
    }
    result.push(vk);
  });
  return result;
}

function singleKey(raw) {
  const vk = lookupVirtualKey(raw);
  if (vk === null || MODIFIERS.has(vk)) throw new ToolError("invalid key; use hotkey for modifiers");
  return vk;
}

// ---- gui_sequence step validation (validateGUIStep) ----

const GUI_OPS = new Set(["click", "drag", "hotkey", "key", "type", "scroll", "hover", "double_click", "wait"]);

function insideScreen(screen, x, y) {
  return x >= screen.left && x < screen.right && y >= screen.top && y < screen.bottom;
}

function validateGuiStep(step, screen) {
  if (!step || typeof step !== "object" || !GUI_OPS.has(step.op)) throw new ToolError("operation not allowed");
  const params = step.params;
  if (!params || typeof params !== "object" || Array.isArray(params) || JSON.stringify(params).length > 2048) {
    throw new ToolError("params must be a valid JSON object (max 2048 bytes)");
  }
  const integer = (key) => {
    if (!(key in params)) throw new ToolError(`${key} is required`);
    if (!isInt(params[key])) throw new ToolError(`${key} must be an integer`);
    return params[key];
  };
  const optionalInteger = (key, fallback) => (key in params ? integer(key) : fallback);
  const text = (key) => {
    if (!(key in params)) throw new ToolError(`${key} is required`);
    if (typeof params[key] !== "string") throw new ToolError(`${key} must be text`);
    return params[key];
  };
  const position = (xKey, yKey) => {
    const x = integer(xKey);
    const y = integer(yKey);
    if (!insideScreen(screen, x, y)) throw new ToolError("coordinates outside the screen");
  };
  const button = () => {
    if ("button" in params && params.button !== "left" && params.button !== "right") throw new ToolError("invalid button");
  };
  switch (step.op) {
    case "wait": {
      let ms;
      try { ms = integer("durationMs"); } catch { ms = NaN; }
      if (!(ms >= 10 && ms <= 2000)) throw new ToolError("wait.durationMs must be between 10 and 2000");
      break;
    }
    case "click":
    case "hover":
    case "double_click":
      position("x", "y");
      if (step.op === "click") button();
      break;
    case "drag": {
      position("x", "y");
      position("toX", "toY");
      let duration;
      try { duration = optionalInteger("durationMs", 350); } catch { duration = NaN; }
      if (!(duration >= 50 && duration <= 3000)) throw new ToolError("invalid durationMs");
      button();
      break;
    }
    case "hotkey":
      chordKeys(text("keys"));
      break;
    case "key": {
      try { singleKey(text("key")); } catch { throw new ToolError("invalid key"); }
      let count;
      try { count = optionalInteger("count", 1); } catch { count = NaN; }
      if (!(count >= 1 && count <= 10)) throw new ToolError("invalid count");
      break;
    }
    case "type": {
      let value;
      try { value = text("text"); } catch { value = ""; }
      if (value.length === 0 || Buffer.byteLength(value) > 2000) throw new ToolError("text must have 1 to 2000 bytes");
      break;
    }
    case "scroll": {
      let delta;
      try { delta = integer("delta"); } catch { delta = 0; }
      if (delta === 0 || delta < -1200 || delta > 1200) throw new ToolError("invalid delta");
      break;
    }
  }
}

// ---- native helper process ----

class DesktopHost {
  constructor() {
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.stderr = "";
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-MTA", "-ExecutionPolicy", "Bypass",
        "-File", HOST_SCRIPT, "-Source", NATIVE_SOURCE,
      ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      const timer = setTimeout(() => {
        this.stop(new Error("desktop helper did not start in time"));
      }, STARTUP_TIMEOUT_MS);
      let started = false;
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (!started) {
          started = true;
          clearTimeout(timer);
          if (message.ready) resolve();
          else {
            reject(new Error(`desktop helper failed to start: ${message.error || "unknown error"}`));
            this.stop();
          }
          return;
        }
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message.value);
        else entry.reject(new ToolError(message.error || "desktop operation failed"));
      });
      child.stderr.on("data", (chunk) => {
        this.stderr = (this.stderr + chunk).slice(-4000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!started) reject(error);
        this.stop(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        const detail = this.stderr.trim();
        const error = new Error(`desktop helper exited (${code})${detail ? `: ${detail.split("\n").pop()}` : ""}`);
        if (!started) reject(error);
        this.stop(error);
      });
      child.unref();
      child.stdin.unref?.();
      child.stdout.unref?.();
      child.stderr.unref?.();
    });
    return this.ready;
  }

  stop(error) {
    const child = this.child;
    this.child = null;
    this.ready = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error || new Error("desktop helper stopped"));
    }
    this.pending.clear();
    if (child && child.exitCode === null) {
      try { child.kill(); } catch { /* already gone */ }
    }
  }

  // Operations run one at a time, like the Agent's visual mutex.
  call(op, params = {}, timeoutMs = 15_000) {
    return this.serialize(() => this.send(op, params, timeoutMs));
  }

  serialize(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  async send(op, params, timeoutMs) {
    await this.start();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError(`${op} exceeded ${timeoutMs} ms`));
        // A stuck native call cannot be cancelled in place: restart the helper.
        this.stop(new Error("desktop helper restarted after a timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, op, params })}\n`);
    });
  }
}

let host = null;
function getHost() {
  if (!host) {
    host = new DesktopHost();
    process.once("exit", () => host && host.stop());
  }
  return host;
}

// ---- gui_sequence handlers (guiHandlers) ----

async function guiStep(desktop, op, p) {
  switch (op) {
    case "click":
      return desktop.call("click", { x: p.x, y: p.y, button: p.button || "left" });
    case "drag":
      return desktop.call("drag", { x: p.x, y: p.y, toX: p.toX, toY: p.toY, durationMs: p.durationMs ?? 350, button: p.button || "left" }, 12_000);
    case "hotkey":
      return desktop.call("chord", { keys: chordKeys(p.keys) }, 12_000);
    case "key": {
      const vk = singleKey(p.key);
      for (let i = 0; i < (p.count ?? 1); i++) await desktop.call("chord", { keys: [vk] }, 12_000);
      return { dispatched: true };
    }
    case "type":
      return desktop.call("type", { text: p.text });
    case "scroll":
      return desktop.call("scroll", { delta: p.delta });
    case "hover":
      return desktop.call("hover", { x: p.x, y: p.y }, 12_000);
    case "double_click":
      return desktop.call("double_click", { x: p.x, y: p.y }, 12_000);
    default:
      throw new ToolError("operation not allowed");
  }
}

async function guiSequence(desktop, windowTitle, pid, steps) {
  const screen = await desktop.call("screen");
  let totalWait = 0;
  steps.forEach((step, i) => {
    try {
      validateGuiStep(step, screen);
    } catch (error) {
      throw new ToolError(`step ${i + 1}: ${error.message}; no action was sent`);
    }
    if (step.op === "wait") totalWait += step.params.durationMs;
  });
  if (totalWait > 10_000) throw new ToolError("accumulated waits exceed 10 seconds");
  const wanted = windowTitle.trim().toLowerCase();
  const started = Date.now();
  for (let i = 0; i < steps.length; i++) {
    const active = await desktop.call("foreground");
    if (!active) throw new ToolError(`step ${i + 1}: no active window; ${i} earlier steps sent`);
    if ((pid && active.pid !== pid) || (wanted && !String(active.title).toLowerCase().includes(wanted))) {
      throw new ToolError(`step ${i + 1}: unexpected focus; ${i} earlier steps sent, do NOT retry blindly`);
    }
    const step = steps[i];
    if (step.op === "wait") {
      await new Promise((resolve) => setTimeout(resolve, step.params.durationMs));
      continue;
    }
    try {
      await guiStep(desktop, step.op, step.params);
    } catch (error) {
      throw new ToolError(`step ${i + 1} (${step.op}) failed: ${error.message}; ${i} earlier steps sent, do NOT retry blindly`);
    }
  }
  return { dispatched: steps.length, verified: false, elapsedMs: Date.now() - started };
}

// ---- tool dispatch ----

function screenshotContent(image) {
  return [
    { type: "text", text: `Capture ${image.width}x${image.height} (${image.screen}), source screen ${image.sourceWidth}x${image.sourceHeight}, absolute origin (${image.originX},${image.originY}). To click a point (pixelX,pixelY) of this image: x=originX+round(pixelX*sourceWidth/width); y=originY+round(pixelY*sourceHeight/height). Pass those absolute coordinates to click_screen. The image is returned for this request only.` },
    { type: "image", mimeType: "image/jpeg", data: image.data },
  ];
}

async function run(name, args, desktop) {
  switch (name) {
    case "view_screen": {
      const screen = str(args.screen) ?? "all";
      const maxWidth = num(args.max_width) ?? 1280;
      const quality = num(args.quality) ?? 65;
      if (screen !== "all" && screen !== "active") throw new ToolError("screen must be all or active");
      if (!isInt(maxWidth) || !isInt(quality) || maxWidth < 320 || maxWidth > 1920 || quality < 25 || quality > 85) {
        throw new ToolError("max_width must be 320-1920 and quality 25-85");
      }
      const value = await desktop.call("capture", { screen, maxWidth, quality }, 25_000);
      if (!value || typeof value.data !== "string" || !value.data || value.data.length > 5_000_000 || !value.width || !value.height) {
        throw new ToolError("invalid or unavailable image: try a new capture");
      }
      const { data, ...meta } = value;
      return { ok: true, ...meta, mcpContent: screenshotContent(value) };
    }
    case "click_screen": {
      const x = num(args.x), y = num(args.y);
      if (!isInt(x) || !isInt(y)) throw new ToolError("integer x and y are required");
      const button = str(args.button) ?? "left";
      if (button !== "left" && button !== "right") throw new ToolError("button must be left or right");
      await desktop.call("click", { x, y, button });
      return { ok: true, clicked: true, message: "Click sent to Windows; confirm the selection and visual result with view_screen." };
    }
    case "type_text": {
      const text = str(args.text);
      if (!text || text.length > 2000 || Buffer.byteLength(text) > 2000) throw new ToolError("text must have 1 to 2000 characters");
      await desktop.call("type", { text });
      return { ok: true, typed: true, message: "Typing events sent to Windows; confirm the content in the interface." };
    }
    case "scroll_screen": {
      const delta = num(args.delta);
      if (!delta || !isInt(delta)) throw new ToolError("a non-zero integer delta is required");
      if (delta < -1200 || delta > 1200) throw new ToolError("delta must be between -1200 and 1200 and not zero");
      await desktop.call("scroll", { delta });
      return { ok: true, scrolled: true, message: "Scroll sent to Windows; visual result not verified yet." };
    }
    case "drag_screen": {
      const values = [num(args.x), num(args.y), num(args.to_x), num(args.to_y)];
      if (values.some((value) => !isInt(value))) throw new ToolError("integer x, y, to_x and to_y are required");
      const durationMs = num(args.duration_ms) ?? 350;
      if (!isInt(durationMs) || durationMs < 50 || durationMs > 3000) throw new ToolError("duration_ms must be between 50 and 3000");
      const button = str(args.button) ?? "left";
      if (button !== "left" && button !== "right") throw new ToolError("button must be left or right");
      const [x, y, toX, toY] = values;
      const value = await desktop.call("drag", { x, y, toX, toY, durationMs, button }, 12_000);
      return { ok: true, ...value, message: "Drag sent to Windows; check the result with view_screen." };
    }
    case "hotkey": {
      const keys = str(args.keys);
      if (!keys || keys.length > 64) throw new ToolError("keys must have 1 to 64 characters");
      await desktop.call("chord", { keys: chordKeys(keys) }, 12_000);
      return { ok: true, dispatched: true, verified: false, message: "Shortcut sent to Windows; confirm the window state." };
    }
    case "press_key": {
      const key = str(args.key);
      const count = num(args.count) ?? 1;
      if (!key || key.length > 32 || !isInt(count) || count < 1 || count > 10) throw new ToolError("invalid key or count (1-10)");
      const vk = singleKey(key);
      for (let i = 0; i < count; i++) await desktop.call("chord", { keys: [vk] }, 12_000);
      return { ok: true, dispatched: true, verified: false, count, message: "Key sent to Windows; confirm the result." };
    }
    case "hover_screen":
    case "double_click_screen": {
      const x = num(args.x), y = num(args.y);
      if (!isInt(x) || !isInt(y)) throw new ToolError("integer x and y are required");
      const value = await desktop.call(name === "hover_screen" ? "hover" : "double_click", { x, y }, 12_000);
      return { ok: true, ...value, message: "Event sent to Windows; confirm it visually." };
    }
    case "window_info": {
      const title = str(args.title) ?? "";
      const pid = num(args.pid) ?? 0;
      if (!validPid(pid)) throw new ToolError("invalid pid");
      return { ok: true, ...(await desktop.call("window", { title, pid }, 12_000)) };
    }
    case "activate_window": {
      const title = str(args.title) ?? "";
      const pid = num(args.pid) ?? 0;
      const timeoutMs = num(args.timeout_ms) ?? 1500;
      if ((!title.trim() && !pid) || !validPid(pid) || !isInt(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
        throw new ToolError("invalid title/pid or timeout_ms");
      }
      return { ok: true, ...(await desktop.call("activate", { title, pid, timeoutMs }, 12_000)) };
    }
    case "desktop_observe":
    case "desktop_act": {
      const act = name === "desktop_act";
      const command = str(args.command) ?? "";
      const cliArgs = args.args === undefined ? [] : args.args;
      const timeoutMs = num(args.timeout_ms) ?? 30_000;
      if (!command || !Array.isArray(cliArgs) || cliArgs.length > 48 ||
          cliArgs.some((arg) => typeof arg !== "string" || arg.length > 16_384) ||
          !isInt(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
        throw new ToolError(`${name} needs command, args as a list of strings (up to 48) and timeout_ms between 1000 and 120000`);
      }
      const params = { command, args: cliArgs, timeoutMs };
      if (act) {
        if (args.headed === true) params.headed = true;
        const stdin = str(args.stdin);
        if (stdin) params.stdin = stdin;
      }
      const runDesktop = desktop.runAgentDesktop || agentDesktop.run;
      const envelope = await (desktop.serialize
        ? desktop.serialize(() => runDesktop(params, act))
        : runDesktop(params, act));
      // agent-desktop's own errors (ok:false) come back whole, with error.code/disposition.
      return envelope;
    }
    case "inspect_background_ui": {
      const windowTitle = str(args.window_title) ?? "";
      const pid = num(args.pid) ?? 0;
      const limit = num(args.limit) ?? 80;
      if ((!windowTitle.trim() && !pid) || !validPid(pid) || !isInt(limit) || limit < 1 || limit > 150) {
        throw new ToolError("invalid window_title/pid or limit");
      }
      if (windowTitle.length > 180) throw new ToolError("title too long");
      return { ok: true, ...(await desktop.call("uia_inspect", { windowTitle, pid, limit }, 30_000)) };
    }
    case "execute_background_ui": {
      const windowTitle = str(args.window_title) ?? "";
      const pid = num(args.pid) ?? 0;
      const steps = args.steps;
      const ops = new Set(["assert_exists", "wait_for", "invoke", "set_value"]);
      if ((!windowTitle.trim() && !pid) || !validPid(pid) ||
          !Array.isArray(steps) || steps.length < 1 || steps.length > 24 ||
          steps.some((step) => !step || typeof step !== "object" || !ops.has(str(step.op) ?? "") ||
            !step.selector || typeof step.selector !== "object" || Array.isArray(step.selector) ||
            (!str(step.selector.name) && !str(step.selector.automationId)) ||
            JSON.stringify(step).length > 1800)) {
        throw new ToolError("execute_background_ui needs a window and 1-24 valid UIA steps");
      }
      if (windowTitle.length > 180) throw new ToolError("title too long");
      steps.forEach((step, i) => {
        const name = str(step.selector.name) ?? "";
        const automationId = str(step.selector.automationId) ?? "";
        if (name.length > 128 || automationId.length > 128) throw new ToolError(`step ${i + 1}: UIA selector must be at most 128 characters`);
        const value = str(step.value) ?? "";
        if (value.length > 1000) throw new ToolError(`step ${i + 1}: value exceeds 1000`);
        if (step.op === "set_value" && !value) throw new ToolError(`step ${i + 1}: value is required`);
        if (step.op === "wait_for" && !(isInt(step.timeoutMs) && step.timeoutMs >= 100 && step.timeoutMs <= 5000)) {
          throw new ToolError(`step ${i + 1}: timeoutMs must be 100-5000`);
        }
      });
      const value = await desktop.call("uia_task", {
        windowTitle, pid,
        ops: steps.map((step) => step.op),
        names: steps.map((step) => str(step.selector.name) ?? ""),
        ids: steps.map((step) => str(step.selector.automationId) ?? ""),
        types: steps.map((step) => (isInt(step.selector.controlType) ? step.selector.controlType : 0)),
        values: steps.map((step) => str(step.value) ?? ""),
        timeouts: steps.map((step) => (isInt(step.timeoutMs) ? step.timeoutMs : 0)),
      }, 100_000);
      return { ok: true, ...value, note: "A dispatched invoke does not prove the result (e.g. a save); use assert_exists/wait_for. The application's provider may change focus even though fxmind does not ask for it." };
    }
    case "gui_sequence": {
      const windowTitle = str(args.window_title) ?? "";
      const pid = num(args.pid) ?? 0;
      const steps = args.steps;
      if ((!windowTitle.trim() && !pid) || !validPid(pid) ||
          !Array.isArray(steps) || steps.length < 1 || steps.length > 32 ||
          steps.some((step) => !step || typeof step !== "object" || !GUI_OPS.has(str(step.op) ?? "") ||
            !step.params || typeof step.params !== "object" || Array.isArray(step.params) ||
            JSON.stringify(step.params).length > 2048)) {
        throw new ToolError("gui_sequence needs a target window and 1-32 valid GUI actions");
      }
      const value = await guiSequence(desktop, windowTitle, pid, steps);
      return { ok: true, ...value, message: "Events sent, but the functional result was not verified. Use view_screen." };
    }
    default:
      throw new ToolError(`Unknown desktop tool: ${name}`);
  }
}

async function dispatch(name, args = {}, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") return { ok: false, error: UNSUPPORTED };
  try {
    return await run(name, args || {}, options.desktop || getHost());
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  TOOL_DEFS,
  TOOL_NAMES,
  dispatch,
  lookupVirtualKey,
  chordKeys,
  validateGuiStep,
  DesktopHost,
};
