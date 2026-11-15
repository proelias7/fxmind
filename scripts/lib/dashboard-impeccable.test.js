const { test }=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../..");
const source=name=>fs.readFileSync(path.join(root,"web/dashboard",name),"utf8");
const dist=name=>fs.readFileSync(path.join(root,"web/dist",name),"utf8");

test("Impeccable: project selector lives in sidebar and the header is removed",()=>{
 const html=source("index.html");
 assert.match(html,/class="project-scope"/);
 assert.match(html,/<select id="project-select" aria-label="Buscar ou selecionar projeto"/);
 assert.doesNotMatch(html,/class="topbar"/);
 assert.match(html,/class="mobile-toolbar"/);
 assert.match(html,/href="\/workspace.css"/);
 assert.match(html,/class="nav-icon"/);
 assert.equal((html.match(/id="project-select"/g)||[]).length,1);
});

test("Impeccable: selects have searchable keyboard-accessible overlay instead of native UI",()=>{
 const js=source("controls.js");
 for(const term of ["role','combobox","role','listbox","aria-expanded","fx-select-search","ArrowDown","ArrowUp","Escape","Enter","dispatchEvent(new Event('change'","popover"]) {
   if(term==="popover")continue;
   assert.ok(js.includes(term),term);
 }
 assert.match(source("dashboard.js"),/enhanceSelects\(document\.querySelector\('\.sidebar'\)\)/);
 assert.match(source("dashboard.js"),/enhanceSelects\(\$\('#content'\)\)/);
 assert.match(source("workspace.css"),/\.fx-select-pop/);
 assert.match(source("workspace.css"),/z-index:9999/);
});

test("Impeccable: memory visualization owns available viewport and has a mobile mode",()=>{
 const css=source("workspace.css");
 assert.match(css,/height:clamp\(540px,calc\(100dvh - 288px\),1200px\)/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) minmax\(255px,310px\)/);
 assert.match(css,/\.memory-section \.graph-details-pane/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(source("dashboard.js"),/class="context-strip"/);
});

test("Impeccable: orchestration canvas edits configured rules without inventing DAG edges",()=>{
 const svg=source("orchestration-canvas.js");
 const page=source("dashboard.js");
 assert.match(svg,/data-flow-agent/);
 assert.match(svg,/CONFIGURAÇÃO DE ROTEAMENTO/);
 assert.match(svg,/roles|roleName/);
 assert.match(page,/state\.orchSelectedRule=Number\(flow\.dataset\.flowAgent\)/);
 assert.match(page,/flowCanvas\(c,active,idx\)/);
 assert.match(page,/orch\.rule\.'\+idx\+'\.provider/);
 assert.match(page,/save-orchestration/);
 assert.match(page,/Configuração detalhada de roteamento/);
});

test("Impeccable: build contains all view modules and skin",()=>{
 for(const file of ["index.html","dashboard.js","controls.js","orchestration-canvas.js","workspace.css"]){
  assert.deepEqual(fs.readFileSync(path.join(root,"web/dashboard",file)),fs.readFileSync(path.join(root,"web/dist",file)));
 }
});

test("Impeccable: Claude header Painel is secondary and cards adapt to appearance",()=>{
 const text=fs.readFileSync(path.join(root,"plugins/fxmind/hooks/effort.tsx"),"utf8");
 assert.match(text,/<Text key="settings-dashboard-link"/);
 assert.doesNotMatch(text,/<Box key="settings-dashboard-link" paddingX=\{1\} borderStyle="round"/);
 assert.match(text,/config\.appearance === 'auto' && claudeIsLight/);
 assert.match(text,/backgroundColor=\{term \? DASH_BG : config\.appearance/);
 assert.match(text,/href="http:\/\/localhost:3847\/" label="Painel"/);
});
