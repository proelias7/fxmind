const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const desktop = require("./desktop-agent");
const agentDesktop = require("./lib/agent-desktop");
const mcp = require("./mcp-server");

const SCREEN = { left: 0, top: 0, right: 1920, bottom: 1080 };

// Records native calls instead of touching the real desktop.
function fakeDesktop(foreground = { pid: 42, title: "Notepad - notes.txt" }) {
  const calls = [];
  return {
    calls,
    async call(op, params) {
      calls.push({ op, params });
      if (op === "screen") return SCREEN;
      if (op === "foreground") return foreground;
      if (op === "capture") return { data: "QUJD", mimeType: "image/jpeg", width: 640, height: 360, originX: 0, originY: 0, sourceWidth: 1920, sourceHeight: 1080, screen: params.screen };
      return { dispatched: true };
    },
  };
}

const run = (name, args, fake = fakeDesktop()) => desktop.dispatch(name, args, { platform: "win32", desktop: fake });

describe("desktop agent tools", () => {
  it("registers all 16 tools in the MCP core, always listed", () => {
    const expected = [
      "view_screen", "click_screen", "type_text", "scroll_screen", "drag_screen", "hotkey", "press_key",
      "hover_screen", "double_click_screen", "window_info", "activate_window",
      "desktop_observe", "desktop_act",
      "inspect_background_ui", "execute_background_ui", "gui_sequence",
    ];
    assert.deepEqual(desktop.TOOL_DEFS.map((tool) => tool.name), expected);
    const listed = mcp.listTools(process.cwd(), {}).map((tool) => tool.name);
    for (const name of expected) assert.ok(listed.includes(name), name);
    const all = mcp.TOOL_DEFS.map((tool) => tool.name);
    assert.equal(new Set(all).size, all.length, "tool names are unique");
  });

  it("is hidden in read-only mode", () => {
    const listed = mcp.listTools(process.cwd(), { FXMIND_MCP_READONLY: "1" }).map((tool) => tool.name);
    assert.ok(!listed.includes("view_screen"));
  });

  it("refuses to run off Windows", async () => {
    const result = await desktop.dispatch("view_screen", {}, { platform: "linux" });
    assert.equal(result.ok, false);
    assert.match(result.error, /only on Windows/);
  });

  it("maps keys like the agent", () => {
    assert.equal(desktop.lookupVirtualKey("ctrl"), 0x11);
    assert.equal(desktop.lookupVirtualKey("A"), 0x41);
    assert.equal(desktop.lookupVirtualKey("7"), 0x37);
    assert.equal(desktop.lookupVirtualKey("f12"), 0x7b);
    assert.equal(desktop.lookupVirtualKey("f13"), null);
    assert.deepEqual(desktop.chordKeys("ctrl+shift+s"), [0x11, 0x10, 0x53]);
    assert.throws(() => desktop.chordKeys("s"), /modifier/);
    assert.throws(() => desktop.chordKeys("s+ctrl"), /before the final key/);
    assert.throws(() => desktop.chordKeys("ctrl+ctrl+s"), /duplicate/);
  });

  it("returns the screenshot as an image block", async () => {
    const result = await run("view_screen", { max_width: 640 });
    assert.equal(result.ok, true);
    assert.equal(result.mcpContent[1].type, "image");
    assert.equal(result.mcpContent[1].data, "QUJD");
    assert.equal(result.data, undefined, "base64 stays out of the text result");
  });

  it("validates arguments before any input", async () => {
    const fake = fakeDesktop();
    assert.equal((await run("view_screen", { max_width: 100 }, fake)).ok, false);
    assert.equal((await run("click_screen", { x: 1.5, y: 2 }, fake)).ok, false);
    assert.equal((await run("click_screen", { x: 1, y: 2, button: "middle" }, fake)).ok, false);
    assert.equal((await run("scroll_screen", { delta: 0 }, fake)).ok, false);
    assert.equal((await run("scroll_screen", { delta: 5000 }, fake)).ok, false);
    assert.equal((await run("drag_screen", { x: 0, y: 0, to_x: 5, to_y: 5, duration_ms: 10 }, fake)).ok, false);
    assert.equal((await run("press_key", { key: "shift" }, fake)).ok, false);
    assert.equal((await run("press_key", { key: "enter", count: 11 }, fake)).ok, false);
    assert.equal((await run("type_text", { text: "" }, fake)).ok, false);
    assert.equal((await run("activate_window", {}, fake)).ok, false);
    assert.equal((await run("inspect_background_ui", { window_title: "x", limit: 151 }, fake)).ok, false);
    assert.equal((await run("execute_background_ui", { window_title: "x", steps: [{ op: "invoke", selector: {} }] }, fake)).ok, false);
    assert.equal((await run("execute_background_ui", { window_title: "x", steps: [{ op: "set_value", selector: { name: "a" } }] }, fake)).ok, false);
    assert.equal((await run("execute_background_ui", { window_title: "x", steps: [{ op: "wait_for", selector: { name: "a" } }] }, fake)).ok, false);
    assert.deepEqual(fake.calls, [], "nothing reached the desktop");
  });

  it("presses a key count times", async () => {
    const fake = fakeDesktop();
    const result = await run("press_key", { key: "tab", count: 3 }, fake);
    assert.equal(result.ok, true);
    assert.deepEqual(fake.calls.map((call) => call.params.keys), [[0x09], [0x09], [0x09]]);
  });

  it("checks focus before every gui_sequence step", async () => {
    const fake = fakeDesktop();
    const result = await run("gui_sequence", {
      window_title: "notepad",
      steps: [
        { op: "click", params: { x: 10, y: 10 } },
        { op: "wait", params: { durationMs: 10 } },
        { op: "hotkey", params: { keys: "ctrl+s" } },
      ],
    }, fake);
    assert.equal(result.ok, true);
    assert.equal(result.dispatched, 3);
    assert.deepEqual(fake.calls.map((call) => call.op), ["screen", "foreground", "click", "foreground", "foreground", "chord"]);
  });

  it("sends nothing when one gui_sequence step is invalid", async () => {
    const fake = fakeDesktop();
    const result = await run("gui_sequence", {
      pid: 42,
      steps: [{ op: "click", params: { x: 10, y: 10 } }, { op: "click", params: { x: 5000, y: 10 } }],
    }, fake);
    assert.equal(result.ok, false);
    assert.match(result.error, /step 2: coordinates outside the screen; no action was sent/);
    assert.deepEqual(fake.calls.map((call) => call.op), ["screen"]);
  });

  it("stops gui_sequence when focus moves away", async () => {
    const fake = fakeDesktop({ pid: 7, title: "Other app" });
    const result = await run("gui_sequence", { window_title: "notepad", steps: [{ op: "type", params: { text: "hi" } }] }, fake);
    assert.equal(result.ok, false);
    assert.match(result.error, /unexpected focus/);
    assert.ok(!fake.calls.some((call) => call.op === "type"));
  });

  it("rejects waits over 10 seconds in total", async () => {
    const steps = Array.from({ length: 6 }, () => ({ op: "wait", params: { durationMs: 2000 } }));
    const result = await run("gui_sequence", { pid: 42, steps });
    assert.equal(result.ok, false);
    assert.match(result.error, /10 seconds/);
  });

  it("builds agent-desktop argv like the agent", () => {
    const { desktopArgv } = agentDesktop;
    assert.deepEqual(desktopArgv({ command: "snapshot", args: ["--app", "notepad.exe", "-i"] }, false).argv,
      ["snapshot", "--app", "notepad.exe", "-i"]);
    assert.deepEqual(desktopArgv({ command: "set-value", args: ["@s1:e2"], stdin: "secret", headed: true }, true).argv,
      ["set-value", "@s1:e2", "--stdin", "--headed"]);
    assert.throws(() => desktopArgv({ command: "click", args: ["@s1:e3"] }, false), /use desktop_act/);
    assert.throws(() => desktopArgv({ command: "rm" }, true), /not allowed/);
    assert.throws(() => desktopArgv({ command: "snapshot", headed: true }, false), /headed only/);
    assert.throws(() => desktopArgv({ command: "snapshot", args: ["--screenshot=x.png"] }, false), /--screenshot is not allowed/);
    assert.throws(() => desktopArgv({ command: "click", args: ["--Force"] }, true), /--force is not allowed/);
    assert.throws(() => desktopArgv({ command: "type", args: ["--stdin"] }, true), /stdin parameter/);
    assert.throws(() => desktopArgv({ command: "click", stdin: "x" }, true), /stdin only applies/);
    assert.throws(() => desktopArgv({ command: "version", timeoutMs: 500 }, false), /timeoutMs/);
  });

  it("checks every batch entry", () => {
    const batch = (entries) => agentDesktop.desktopArgv({ command: "batch", args: [JSON.stringify(entries), "--stop-on-error"] }, true);
    assert.equal(batch([{ command: "click", args: { ref: "@s1:e3" } }]).argv[0], "batch");
    assert.throws(() => batch([]), /1 to 32/);
    assert.throws(() => batch([{ command: "batch" }]), /not allowed in a batch/);
    assert.throws(() => batch([{ command: "skills" }]), /not allowed in a batch/);
    assert.throws(() => batch([{ command: "click", extra: 1 }]), /field "extra"/);
    assert.throws(() => batch([{ command: "click", args: { Screenshot: "a.png" } }]), /"Screenshot" is not allowed/);
  });

  it("reads the agent-desktop envelope", () => {
    assert.deepEqual(agentDesktop.parseEnvelope('{"ok":true,"data":1}'), { ok: true, data: 1 });
    assert.deepEqual(agentDesktop.parseEnvelope('progress\n{"ok":false,"error":{"code":"STALE_REF"}}'), { ok: false, error: { code: "STALE_REF" } });
    assert.throws(() => agentDesktop.parseEnvelope(""), /did not answer/);
    assert.throws(() => agentDesktop.parseEnvelope('{"data":1}'), /no ok field/);
  });

  it("finds the exe inside a tar.gz", () => {
    const header = (name, size) => {
      const block = Buffer.alloc(512);
      block.write(name, 0);
      block.write(size.toString(8).padStart(11, "0"), 124);
      block.write("0", 156);
      return block;
    };
    const body = Buffer.from("MZ-fake");
    const padded = Buffer.concat([body, Buffer.alloc(512 - body.length)]);
    const tar = Buffer.concat([header("dist/readme.txt", 0), header("dist/agent-desktop.exe", body.length), padded, Buffer.alloc(1024)]);
    assert.equal(agentDesktop.extractExe(require("zlib").gzipSync(tar)).toString(), "MZ-fake");
  });

  it("runs desktop_observe through the visual queue and returns the envelope", async () => {
    const seen = [];
    const fake = {
      serialize: (task) => { seen.push("queued"); return task(); },
      runAgentDesktop: async (params, act) => { seen.push({ params, act }); return { ok: false, error: { code: "STALE_REF" } }; },
    };
    const result = await run("desktop_observe", { command: "snapshot", args: ["-i"] }, fake);
    assert.deepEqual(result, { ok: false, error: { code: "STALE_REF" } });
    assert.deepEqual(seen, ["queued", { params: { command: "snapshot", args: ["-i"], timeoutMs: 30000 }, act: false }]);
    const act = await run("desktop_act", { command: "type", args: ["@s1:e2"], stdin: "hi", headed: true }, fake);
    assert.equal(act.ok, false);
    assert.deepEqual(seen[3].params, { command: "type", args: ["@s1:e2"], timeoutMs: 30000, headed: true, stdin: "hi" });
    assert.equal((await run("desktop_act", { command: "click", timeout_ms: 999 }, fake)).ok, false);
  });

  it("flattens UIA steps for the native helper", async () => {
    const fake = fakeDesktop();
    const result = await run("execute_background_ui", {
      window_title: "Notepad",
      steps: [
        { op: "wait_for", selector: { automationId: "Edit" }, timeoutMs: 500 },
        { op: "set_value", selector: { name: "Text", controlType: 50004 }, value: "hello" },
      ],
    }, fake);
    assert.equal(result.ok, true);
    assert.deepEqual(fake.calls[0], { op: "uia_task", params: {
      windowTitle: "Notepad", pid: 0,
      ops: ["wait_for", "set_value"], names: ["", "Text"], ids: ["Edit", ""],
      types: [0, 50004], values: ["", "hello"], timeouts: [500, 0],
    } });
  });
});
