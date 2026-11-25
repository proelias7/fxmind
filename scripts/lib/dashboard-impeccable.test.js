const { test }=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../..");
const source=name=>fs.readFileSync(path.join(root,"web/dashboard",name),"utf8");

test("Dashboard: opens on the memory canvas, with one top bar and three destinations",()=>{
 const html=source("index.html"),js=source("dashboard.js");
 assert.match(html,/<header class="bar">/);
 assert.doesNotMatch(html,/class="sidebar"|class="topbar"|nav-caption/);
 assert.match(html,/<select id="project-select" aria-label="Buscar ou selecionar projeto"/);
 assert.equal((html.match(/id="project-select"/g)||[]).length,1);
 assert.deepEqual((html.match(/data-page="[a-z]+"/g)||[]),['data-page="memory"','data-page="orchestration"','data-page="settings"']);
 assert.match(js,/page: 'memory'/);
 assert.match(js,/class="memory" id="memory-graph"/);
 assert.doesNotMatch(js,/function overview|Visão geral/);
 // Links to the six pages of the previous layout still land somewhere useful.
 assert.match(js,/overview: 'memory', projects: 'memory', agents: 'settings', subagents: 'settings', providers: 'settings'/);
});

test("Dashboard: flat pages, no cards inside cards and a single save bar",()=>{
 const html=source("index.html"),js=source("dashboard.js"),css=source("dashboard.css")+source("design-system.css");
 assert.doesNotMatch(js,/provider-card|class="metric|class="section|class="list-row|context-strip/);
 assert.doesNotMatch(css,/\.provider-card|\.metric\b|\.section-head|\.list-row/);
 assert.doesNotMatch(js,/save-orchestration|save-agent|save-subagents|save-provider/);
 assert.match(html,/id="savebar" hidden/);
 assert.equal((html.match(/data-action="save"/g)||[]).length,1);
 assert.match(js,/function syncSavebar\(\)/);
 assert.match(js,/\$\('#savebar'\)\.hidden = !\(d\.orchestration \|\| d\.agent \|\| d\.subagents \|\| d\.providers\.length\)/);
});

test("Dashboard: selects have a keyboard-accessible overlay instead of native UI",()=>{
 const js=source("controls.js");
 for(const term of ["role','combobox","role','listbox","aria-expanded","fx-select-search","ArrowDown","ArrowUp","Escape","Enter","dispatchEvent(new Event('change'"]) {
   assert.ok(js.includes(term),term);
 }
 assert.match(source("dashboard.js"),/enhanceSelects\(\$\('\.bar'\)\)/);
 assert.match(source("dashboard.js"),/enhanceSelects\(\$\('#content'\)\)/);
 assert.match(source("design-system.css"),/\.fx-select-pop \{[^}]*z-index: 9999/);
});

test("Dashboard: the memory canvas owns the viewport; details open only on selection",()=>{
 const css=source("dashboard.css"),js=source("dashboard.js"),graph=source("memory-graph.js");
 assert.match(css,/#content\.is-canvas \{[^}]*height: calc\(100dvh - var\(--bar-h\)\)/);
 assert.match(css,/\.memory canvas \{[^}]*inset: 0/);
 assert.match(css,/@media \(max-width: 760px\)/);
 assert.match(js,/class="memory-detail" data-graph-details hidden/);
 assert.match(graph,/details\.hidden=!selected/);
 assert.match(graph,/data-graph-close/);
});

test("Dashboard: orchestration map edits configured rules and the router defaults",()=>{
 const svg=source("orchestration-canvas.js");
 const page=source("dashboard.js");
 assert.match(svg,/data-flow-agent/);
 assert.match(svg,/data-flow-router/);
 assert.match(svg,/Edges are routing rules, not the\r?\n\/\/ dependencies of a real run/);
 assert.match(page,/flowCanvas\(c,active,idx,narrow\.matches\)/);
 assert.match(page,/orch\.rule\.'\+idx\+'\.provider/);
 assert.match(page,/'orch\.defaultProvider'/);
 assert.match(page,/state\.orchSelected = agent \? Number\(agent\.dataset\.flowAgent\) \|\| 0 : -1/);
});

test("Dashboard: settings offer only values the backend accepts",()=>{
 const page=source("dashboard.js"),cli=fs.readFileSync(path.join(root,"scripts/lib/panel-cli.js"),"utf8");
 assert.match(cli,/const ACCESS_MODES = \["ask", "auto", "full"\]/);
 assert.match(cli,/\["manual", "always", "on_diff"\]\.includes\(value\)/);
 for(const value of ["ask","auto","full","on_diff","always","manual","quick"]) assert.ok(page.includes("{value:'"+value+"'"),value);
 assert.doesNotMatch(page,/read-only/);
});

test("Dashboard: build contains every source file",()=>{
 const files=fs.readdirSync(path.join(root,"web/dashboard")).sort();
 assert.deepEqual(fs.readdirSync(path.join(root,"web/dist")).sort(),files);
 for(const file of files){
  assert.deepEqual(fs.readFileSync(path.join(root,"web/dashboard",file)),fs.readFileSync(path.join(root,"web/dist",file)),file);
 }
});

test("Impeccable: Claude System card launches panel and all cards follow theme",()=>{
 const text=fs.readFileSync(path.join(root,"plugins/fxmind/hooks/effort.tsx"),"utf8");
 assert.match(text,/card === 'system'/);
 assert.match(text,/settings-system-panel/);
 assert.doesNotMatch(text,/settings-dashboard-link/);
 assert.match(text,/backgroundColor=\{term \? DASH_BG : DASH_HEAD\}/);
 assert.match(text,/hover=\{\{ backgroundColor: CARD_HOVER, borderColor: CARD_HOVER_EDGE \}\}/);
 assert.match(text,/label="Report"/);
});
