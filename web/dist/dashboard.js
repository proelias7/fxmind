import { mountMemoryGraph } from './memory-graph.js';
import { enhanceSelects } from './controls.js';
import { flowCanvas, roleName } from './orchestration-canvas.js';
// FXMIND Dashboard. Opens on the memory canvas; conversations remain in CLI hosts.
const apiBase = '/api';
const $ = (sel, root = document) => root.querySelector(sel);
const state = {
  page: 'memory', health: null, workspace: null, projects: [],
  orchestration: null, orchestrationDraft: null, active: null, history: [],
  agent: null, agentDraft: null, subagents: null, subagentDraft: null, subInstall: false,
  providers: [], providerDraft: {}, clis: [], models: {}, saving: false,
  scope: 'project', scopeSaved: 'project',
  graphMode: 'memories', graph: null, graphError: null, graphLoading: false,
  graphProjectId: null, graphLoadedMode: null, graphSearch: '', loaded: false,
  orchSelected: 0, // index of the routing rule in the inspector; -1 is the router defaults
};
const narrow = matchMedia('(max-width: 760px)');
let memoryCanvas = null;
let mountedGraph = null;
let graphRequestId = 0;
const pages = { memory: 'Memórias', orchestration: 'Orquestração', settings: 'Configurações' };
// Routes of the previous six-page layout still open the right place.
const aliases = { overview: 'memory', projects: 'memory', agents: 'settings', subagents: 'settings', providers: 'settings' };
const cliNames = { claude:'Claude', codex:'Codex', opencode:'OpenCode', 'cursor-agent':'Cursor Agent', hermes:'Hermes' };
const efforts = [['low','Baixo'],['medium','Médio'],['high','Alto'],['xhigh','Máximo']].map(([value,label])=>({value,label}));
const statusNames = { running:'Em execução', awaiting_approval:'Aguardando aprovação', completed:'Concluída', failed:'Falhou', cancelled:'Cancelada' };
const activeProjectId = () => state.health?.workspaceId || state.workspace?.workspaceId || '';
const clone = value => JSON.parse(JSON.stringify(value ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('pt-BR');
const modelName = m => m && typeof m === 'object' ? String(m.id || m.name || m.label || '') : String(m || '');
const icon = d => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+d+'"/></svg>';
function notify(message, error=false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => node.classList.remove('show'), 4300);
}
async function api(path, method='GET', body=null) {
  const res = await fetch(apiBase + path, {
    method, headers: {'Content-Type':'application/json','Accept':'application/json'},
    ...(body !== null ? {body:JSON.stringify(body)} : {}),
    cache:'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw Object.assign(Error(data.error || data.message || 'Falha na solicitação (' + res.status + ')'), {status: res.status});
  return data;
}

// Form controls. A field with no title is labelled for assistive tech only.
const labelled = (title, control) => title ? '<label class="field"><span>'+esc(title)+'</span>'+control+'</label>' : control;
const options = (list, value) => list.map(o => {
  const obj = typeof o === 'string' ? {value:o,label:o} : o;
  return '<option value="'+esc(obj.value ?? '')+'" '+(String(obj.value??'')===String(value??'')?'selected':'')+'>'+esc(obj.label)+'</option>';
}).join('');
const selectField = (title, value, id, list, aria='') =>
  labelled(title, '<select data-field="'+esc(id)+'" '+(aria?'aria-label="'+esc(aria)+'"':'')+'>'+options(list,value)+'</select>');
const textField = (title, value, id, o={}) =>
  labelled(title, '<input type="'+(o.type||'text')+'" data-field="'+esc(id)+'" value="'+esc(value ?? '')+'" placeholder="'+esc(o.placeholder||'')+'" '
    +(o.aria?'aria-label="'+esc(o.aria)+'" ':'')+(o.list?'list="'+esc(o.list)+'" ':'')+'autocomplete="'+(o.type==='password'?'new-password':'off')+'"/>');
const switchField = (title, value, id) => '<label class="switch"><input type="checkbox" data-field="'+esc(id)+'" '+(value?'checked':'')+'/><i aria-hidden="true"></i><span>'+esc(title)+'</span></label>';
function modelField(title, current, field, cliId, aria='') {
  const id = 'models-'+String(field).replace(/[^a-z0-9]/gi,'-');
  const list = (state.models[cliId] || []).map(modelName).filter(Boolean);
  return textField(title, current, field, {list:id, placeholder:'Modelo padrão', aria})
    +'<datalist id="'+id+'">'+list.map(x=>'<option value="'+esc(x)+'"></option>').join('')+'</datalist>';
}
function cliChoices(auto='Automático') {
  const installed = new Set((state.clis || []).filter(c => c.installed).map(c => c.id));
  return [{value:'',label:auto}, ...Object.keys(cliNames).map(id =>
    ({value:id, label:cliNames[id]+(state.clis.length && !installed.has(id) ? ' · não instalado' : '')}))];
}
const stateMessage = (title, detail='', action='') =>
  '<div class="state"><strong>'+esc(title)+'</strong>'+(detail?'<span>'+esc(detail)+'</span>':'')+action+'</div>';

// Memory canvas: the whole page. Controls float over it; details open only on selection.
function memory() {
  const graph = state.graph;
  const ready = graph && state.graphProjectId === activeProjectId() && state.graphLoadedMode === state.graphMode;
  const meta = ready ? graph.meta || {} : {};
  const fragments = state.graphMode === 'fragments';
  const rebuild = '<button class="btn primary" data-action="graph-rebuild">Gerar grafo</button>';
  let stage;
  if (state.loaded && !activeProjectId()) stage = stateMessage('Nenhum projeto selecionado');
  else if (state.graphLoading || (!ready && !state.graphError)) stage = stateMessage('Carregando memórias…');
  else if (state.graphError && state.graphError !== 'missing') stage = stateMessage('Não foi possível abrir as memórias', state.graphError, rebuild);
  else if (state.graphError || !graph.nodes?.length) stage = stateMessage('Nenhuma memória mapeada neste projeto', '', rebuild);
  else stage = '<canvas tabindex="0" aria-label="Canvas das ligações entre memórias"></canvas>';
  const seg = (id, label) => '<button type="button" data-action="graph-mode" data-id="'+id+'" aria-pressed="'+(state.graphMode===id)+'">'+label+'</button>';
  const legend = (color, label) => '<span><i style="background:'+color+'"></i>'+label+'</span>';
  return '<section class="memory" id="memory-graph">'+stage
    +'<div class="memory-top">'
    +'<label class="search">'+icon('M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4')
    +'<input id="memory-graph-search" type="search" placeholder="Buscar memória" aria-label="Buscar memória" value="'+esc(state.graphSearch)+'" /></label>'
    +'<div class="seg" role="group" aria-label="Detalhe do grafo">'+seg('memories','Memórias')+seg('fragments','Fragmentos')+'</div></div>'
    +(ready && graph.nodes?.length
      ? '<div class="memory-foot"><span>'+fmt(meta.visibleNodes)+(fragments?' nós':' memórias')+' · '+fmt(meta.visibleLinks)+' ligações'+(meta.truncated?' · amostra':'')+'</span>'
        +(fragments?legend('var(--mint)','Memórias')+legend('var(--amber)','Fragmentos')+legend('var(--pink)','Recursos'):'')+'</div>'
        +'<div class="zoom" role="group" aria-label="Zoom">'
        +'<button type="button" data-action="graph-zoom-out" aria-label="Diminuir zoom">'+icon('M5 12h14')+'</button>'
        +'<button type="button" data-action="graph-zoom-in" aria-label="Aumentar zoom">'+icon('M12 5v14M5 12h14')+'</button>'
        +'<button type="button" data-action="graph-fit" aria-label="Enquadrar tudo">'+icon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')+'</button></div>'
      : '')
    +'<aside class="memory-detail" data-graph-details hidden></aside></section>';
}

// Orchestration: the routing map is the editor. Selecting a node opens it in the inspector.
function orchestration() {
  const c = state.orchestrationDraft;
  if (!c?.routing) return '<div class="page">'+stateMessage('Orquestração indisponível')+'</div>';
  const rules = c.routing.rules || [];
  const idx = Math.max(-1, Math.min(state.orchSelected, rules.length-1));
  const rule = rules[idx];
  const active = state.active?.orchestration;
  const inspector = rule
    ? '<h2>'+esc(roleName(rule,idx))+'</h2>'
      +selectField('CLI',rule.provider||'','orch.rule.'+idx+'.provider',cliChoices())
      +modelField('Modelo',rule.model,'orch.rule.'+idx+'.model',rule.provider||c.routing.defaultProvider)
      +selectField('Esforço',rule.effort||'medium','orch.rule.'+idx+'.effort',efforts)
      +'<code class="rule-match">'+esc(rule.match)+'</code>'
    : '<h2>Roteador</h2>'
      +selectField('CLI padrão',c.routing.defaultProvider||'','orch.defaultProvider',cliChoices())
      +modelField('Modelo padrão',c.routing.defaultModel,'orch.defaultModel',c.routing.defaultProvider)
      +selectField('Esforço padrão',c.routing.defaultEffort||'medium','orch.defaultEffort',efforts);
  const live = active && (active.status==='running' || active.status==='awaiting_approval');
  const run = (s, current) => '<li><span class="run-name">'+esc(s.task||s.name||s.id||'Execução')+'</span>'
    +'<span class="tag'+(s.status==='completed'?' good':s.status==='failed'?' bad':'')+'">'+esc(statusNames[s.status]||s.status||'—')+'</span>'
    +(current && s.status==='awaiting_approval'?'<button class="btn primary" data-action="approve-run" data-id="'+esc(s.id)+'">Aprovar</button>':'')
    +(current && live?'<button class="btn" data-action="cancel-run" data-id="'+esc(s.id)+'">Cancelar</button>':'')+'</li>';
  const past = (state.history || []).filter(s => !active || s.id !== active.id).slice(0,7);
  const runs = (active ? run(active,true) : '') + past.map(s => run(s,false)).join('');
  return '<div class="page">'
    +'<header class="page-head"><h1>Orquestração</h1>'+switchField('Ativa',c.enabled,'orch.enabled')+'</header>'
    +'<div class="fields">'
    +selectField('Modo',c.mode,'orch.mode',[{value:'auto',label:'Automático'},{value:'confirm',label:'Confirmar antes'},{value:'off',label:'Desligado'}])
    +selectField('Estratégia',c.strategy,'orch.strategy',[{value:'smart',label:'Smart DAG'},{value:'parallel',label:'Paralelo'},{value:'sequential',label:'Sequencial'}])
    +selectField('Concorrência',String(c.maxConcurrent),'orch.maxConcurrent',['1','2','3','4','5','6','8','10'])
    +selectField('Salvar em',state.scope,'scope',[{value:'project',label:'Projeto atual'},{value:'global',label:'Global'}])
    +'</div>'
    +'<div class="flow">'+flowCanvas(c,active,idx,narrow.matches)+'<aside class="flow-inspector">'+inspector+'</aside></div>'
    +(runs?'<section class="runs"><h2>Execuções</h2><ul>'+runs+'</ul></section>':'')
    +'</div>';
}

// Settings: one flat page. Every change is saved from the single save bar.
function settings() {
  const a = state.agentDraft, subs = state.subagentDraft?.subagents || [];
  const group = (title, body) => '<section class="set"><h2>'+esc(title)+'</h2><div class="set-body">'+body+'</div></section>';
  const agent = a ? group('Agente','<div class="fields">'
      +selectField('CLI',a.cliId||'','agent.cliId',cliChoices())
      +modelField('Modelo',a.model,'agent.model',a.cliId)
      +selectField('Esforço',a.effort||'default','agent.effort',[{value:'default',label:'Padrão'},...efforts])
      +selectField('Modo',a.mode,'agent.mode',[{value:'cli',label:'CLI conectado'},{value:'byok',label:'API própria'}])
      +selectField('Acesso',a.accessMode,'agent.accessMode',[{value:'ask',label:'Perguntar'},{value:'auto',label:'Automático'},{value:'full',label:'Total'}])
      +selectField('Tarefas',a.taskMode,'agent.taskMode',[{value:'full',label:'Completas'},{value:'quick',label:'Rápidas'}])
      +'</div>')
    +group('Revisão','<div class="fields">'
      +selectField('Revisor',a.judge?.cliId||'','agent.judge.cliId',cliChoices())
      +modelField('Modelo',a.judge?.model,'agent.judge.model',a.judge?.cliId)
      +selectField('Gatilho',a.judge?.trigger||'on_diff','agent.judge.trigger',[{value:'on_diff',label:'Quando houver alterações'},{value:'always',label:'Sempre'},{value:'manual',label:'Manual'}])
      +'</div>'+switchField('Revisão ativa',a.judge?.enabled!==false,'agent.judge.enabled')) : '';
  const subagents = subs.length ? group('Subagentes', subs.map((s,i) => {
      const name = s.label||s.id;
      return '<div class="row"><div class="row-name">'+esc(name)+(s.description?'<small>'+esc(s.description)+'</small>':'')+'</div>'
        +selectField('',s.cliId||'','sub.'+i+'.cliId',cliChoices('CLI automático'),'CLI de '+name)
        +modelField('',s.model,'sub.'+i+'.model',s.cliId,'Modelo de '+name)
        +selectField('',s.variant||'','sub.'+i+'.variant',[{value:'',label:'Variante padrão'},...['minimal','low','medium','high'].map(x=>({value:x,label:x}))],'Variante de '+name)+'</div>';
    }).join('')+switchField('Instalar arquivos OpenCode ao salvar',state.subInstall,'sub.install')) : '';
  const providers = state.providers.length ? group('Provedores', state.providers.map(p => {
      const d = state.providerDraft[p.id] || {}, name = p.name||p.id;
      return '<div class="row"><div class="row-name"><span class="dot'+(p.configured?' on':'')+'" title="'+(p.configured?'Configurado':'Sem chave')+'"></span>'+esc(name)+'</div>'
        +textField('',d.baseURL ?? p.baseURL ?? '','provider.'+p.id+'.baseURL',{placeholder:'URL base',aria:'URL base de '+name})
        +textField('',d.apiKey ?? '','provider.'+p.id+'.apiKey',{type:'password',placeholder:p.configured?'Chave configurada':'Chave de API',aria:'Chave de API de '+name})+'</div>';
    }).join('')) : '';
  const body = agent + subagents + providers;
  return '<div class="page"><header class="page-head"><h1>Configurações</h1></header>'+(body || stateMessage('Configurações indisponíveis'))+'</div>';
}

async function loadGraph() {
  const id = activeProjectId();
  if (!id || state.graphLoading) return;
  const req = ++graphRequestId, mode = state.graphMode;
  state.graphLoading = true; state.graphError = null; state.graph = null; state.graphProjectId = id;
  render();
  try {
    const graph = await api('/projects/'+encodeURIComponent(id)+'/graph/view?mode='+encodeURIComponent(mode));
    if (req !== graphRequestId) return;
    state.graph = graph; state.graphLoadedMode = mode;
  } catch (e) {
    if (req !== graphRequestId) return;
    state.graphError = e.status === 404 ? 'missing' : e.message || 'Grafo indisponível'; // 404: no graph built yet
  } finally {
    if (req === graphRequestId) { state.graphLoading = false; render(); }
  }
}
function resetGraph() {
  graphRequestId++;
  state.graphLoading = false; state.graph = null; state.graphError = null; state.graphLoadedMode = null;
}

// What differs from the saved configuration; drives the save bar.
function dirty() {
  const providers = state.providers.filter(p => {
    const d = state.providerDraft[p.id];
    return d && ((d.baseURL ?? p.baseURL ?? '') !== (p.baseURL ?? '') || (d.apiKey || '').trim());
  });
  return {
    orchestration: Boolean(state.orchestrationDraft) && (!same(state.orchestrationDraft, state.orchestration?.config) || state.scope !== state.scopeSaved),
    agent: Boolean(state.agentDraft) && !same(state.agentDraft, state.agent),
    subagents: Boolean(state.subagentDraft) && (!same(state.subagentDraft, state.subagents) || state.subInstall),
    providers,
  };
}
function syncSavebar() {
  const d = dirty();
  $('#savebar').hidden = !(d.orchestration || d.agent || d.subagents || d.providers.length);
}

function render() {
  document.title = 'FXMIND · ' + pages[state.page];
  for (const el of document.querySelectorAll('[data-page]')) {
    if (el.dataset.page === state.page) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
  }
  const dot = $('#connection-dot');
  dot.classList.toggle('on', Boolean(state.health));
  dot.setAttribute('aria-label', state.health ? 'Conectado' : 'Sem conexão');
  dot.title = state.health ? 'Conectado' : 'Sem conexão';
  const cur = activeProjectId(), select = $('#project-select');
  select.innerHTML = state.projects.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===cur?'selected':'')+'>'+esc(p.name||p.root)+'</option>').join('')||'<option value="">Nenhum projeto</option>';
  enhanceSelects($('.bar'));
  const trigger = select.nextElementSibling;
  if (trigger?.classList.contains('fx-select-trigger')) trigger.querySelector('.fx-selected-label').textContent = select.selectedOptions[0]?.textContent || 'Nenhum projeto';
  syncSavebar();
  const graphReady = state.graph && state.graphProjectId === cur && state.graphLoadedMode === state.graphMode;
  // The mounted canvas keeps its zoom and selection across unrelated renders.
  if (state.page === 'memory' && memoryCanvas && mountedGraph === state.graph && graphReady) return;
  memoryCanvas?.destroy();
  memoryCanvas = null; mountedGraph = null;
  // A re-render keeps the keyboard on the field that caused it.
  const focused = document.activeElement;
  const field = $('#content').contains(focused) ? focused.dataset.field || focused.previousElementSibling?.dataset?.field : '';
  $('#content').innerHTML = ({memory, orchestration, settings}[state.page])();
  $('#content').classList.toggle('is-canvas', state.page === 'memory');
  enhanceSelects($('#content'));
  if (field) {
    const el = $('[data-field="'+CSS.escape(field)+'"]');
    (el?.dataset.enhanced ? el.nextElementSibling : el)?.focus();
  }
  if (state.page !== 'memory') return;
  if (graphReady && state.graph.nodes?.length) {
    memoryCanvas = mountMemoryGraph($('#memory-graph'), state.graph);
    memoryCanvas.setQuery(state.graphSearch);
    mountedGraph = state.graph;
  } else if (!graphReady && !state.graphLoading && !state.graphError && cur) {
    void loadGraph();
  }
}
function setData(key, data) {
  if (key === 'workspace') { state.workspace = data; state.projects = data.projects || []; }
  else if (key === 'orchestration') { state.orchestration = data; state.orchestrationDraft = clone(data.config || {}); }
  else if (key === 'history') state.history = data.orchestrations || [];
  else if (key === 'agent') { state.agent = data; state.agentDraft = clone(data); }
  else if (key === 'subagents') { state.subagents = data; state.subagentDraft = clone(data); state.subInstall = false; }
  else if (key === 'providers') { state.providers = data.providers || []; state.providerDraft = {}; }
  else if (key === 'scan') state.clis = data.clis || [];
  else state[key] = data;
}
async function load() {
  const endpoints = [
    ['health','/health'],['workspace','/workspace'],['orchestration','/orchestration/config'],
    ['active','/orchestration/active'],['history','/orchestration/history'],
    ['agent','/settings/agent'],['subagents','/settings/subagents'],['providers','/settings/providers'],['scan','/cli/scan'],
  ];
  const result = await Promise.allSettled(endpoints.map(([key,path]) => api(path).then(data => ({key,data}))));
  const failures = [];
  for (const it of result) {
    if (it.status !== 'fulfilled') { failures.push(it.reason?.message || 'Indisponível'); continue; }
    setData(it.value.key, it.value.data);
  }
  state.loaded = true;
  render();
  if (failures.length) notify(failures.length === endpoints.length ? 'Sem conexão com o FXMIND' : 'Alguns dados não carregaram: '+failures[0], true);
  await Promise.all(Object.keys(cliNames).map(loadModels));
  render();
}
async function loadModels(cliId) {
  if (!cliId || state.models[cliId]) return;
  try {
    const r = await api('/cli/models?cliId='+encodeURIComponent(cliId));
    state.models[cliId] = r.models || r.allModels || [];
  } catch { state.models[cliId] = []; }
}
function updateDraft(field, value) {
  const parts = field.split('.'), text = value === '' ? null : value;
  const refreshModels = cli => void loadModels(cli).then(render);
  if (parts[0] === 'orch' && state.orchestrationDraft) {
    const draft = state.orchestrationDraft;
    if (parts[1] === 'rule') {
      const r = draft.routing.rules[Number(parts[2])]; if (!r) return;
      r[parts[3]] = text;
      if (parts[3] === 'provider') { r.model = null; refreshModels(value); }
    } else if (parts[1] === 'enabled') draft.enabled = Boolean(value);
    else if (parts[1] === 'maxConcurrent') draft.maxConcurrent = Math.min(10, Math.max(1, Number(value) || 3));
    else if (parts[1] === 'defaultProvider') { draft.routing.defaultProvider = text; draft.routing.defaultModel = null; refreshModels(value); }
    else if (parts[1] === 'defaultModel') draft.routing.defaultModel = text;
    else if (parts[1] === 'defaultEffort') draft.routing.defaultEffort = value;
    else draft[parts[1]] = value;
    // Map labels mirror the draft; a model being typed keeps its focus instead.
    if (parts[1] !== 'defaultModel' && parts[3] !== 'model' && parts[3] !== 'provider' && parts[1] !== 'defaultProvider') render();
  } else if (parts[0] === 'agent' && state.agentDraft) {
    const draft = state.agentDraft;
    if (parts[1] === 'judge') {
      draft.judge ||= {};
      draft.judge[parts[2]] = parts[2] === 'enabled' ? Boolean(value) : text;
      if (parts[2] === 'cliId') { draft.judge.model = null; refreshModels(value); }
    } else {
      draft[parts[1]] = text;
      if (parts[1] === 'cliId') { draft.model = null; refreshModels(value); }
    }
  } else if (parts[0] === 'sub' && state.subagentDraft) {
    if (parts[1] === 'install') state.subInstall = Boolean(value);
    else {
      const sub = state.subagentDraft.subagents[Number(parts[1])]; if (!sub) return;
      sub[parts[2]] = text;
      if (parts[2] === 'cliId') { sub.model = null; refreshModels(value); }
    }
  } else if (parts[0] === 'provider') {
    (state.providerDraft[parts[1]] ||= {})[parts[2]] = value;
  } else if (parts[0] === 'scope') state.scope = value;
  syncSavebar();
}
async function save() {
  if (state.saving) return;
  state.saving = true;
  try {
    const d = dirty();
    if (d.orchestration) {
      await api('/orchestration/config','PUT',{scope:state.scope,config:state.orchestrationDraft});
      state.scopeSaved = state.scope;
      setData('orchestration', await api('/orchestration/config'));
    }
    if (d.agent) {
      const a = state.agentDraft;
      await api('/settings/agent','PUT',{ mode:a.mode, cliId:a.cliId, model:a.model, effort:a.effort, taskMode:a.taskMode, accessMode:a.accessMode, judge:a.judge });
      setData('agent', await api('/settings/agent'));
    }
    if (d.subagents) {
      const map = {};
      for (const s of state.subagentDraft.subagents) map[s.id] = {cliId:s.cliId||null, model:s.model||null, variant:s.variant||null};
      await api('/settings/subagents','PUT',{subagents:map, install:state.subInstall});
      setData('subagents', await api('/settings/subagents'));
    }
    for (const p of d.providers) {
      const draft = state.providerDraft[p.id], body = {baseURL: draft.baseURL ?? p.baseURL ?? ''};
      if ((draft.apiKey || '').trim()) body.apiKey = draft.apiKey.trim();
      await api('/settings/providers/'+encodeURIComponent(p.id),'PUT',body);
    }
    if (d.providers.length) setData('providers', await api('/settings/providers'));
    notify('Configurações salvas');
  } catch (e) { notify(e.message || 'Erro ao salvar', true); }
  finally { state.saving = false; render(); }
}
function discard() {
  state.orchestrationDraft = clone(state.orchestration?.config || {});
  state.agentDraft = clone(state.agent);
  state.subagentDraft = clone(state.subagents);
  state.subInstall = false; state.providerDraft = {}; state.scope = state.scopeSaved;
  render();
}
function go(page, push=true) {
  state.page = pages[page] ? page : 'memory';
  if (push) history.pushState(null, '', state.page === 'memory' ? '/' : '/'+state.page);
  render();
  window.scrollTo({top:0});
}
async function act(action, id) {
  if (action === 'save') return save();
  if (action === 'discard') return discard();
  if (action === 'graph-fit') return memoryCanvas?.fit();
  if (action === 'graph-zoom-in') return memoryCanvas?.zoom(1.25);
  if (action === 'graph-zoom-out') return memoryCanvas?.zoom(.8);
  if (action === 'graph-mode') {
    if (id === state.graphMode) return;
    resetGraph(); state.graphMode = id === 'fragments' ? 'fragments' : 'memories'; state.graphSearch = '';
    return render();
  }
  if (action === 'graph-rebuild') {
    const projectId = activeProjectId();
    if (!projectId) return;
    resetGraph(); state.graphLoading = true; render();
    try {
      await api('/projects/'+encodeURIComponent(projectId)+'/graph','POST',{});
      state.graphLoading = false;
      await loadGraph();
    } catch (e) { state.graphLoading = false; state.graphError = e.message || 'Falha ao gerar grafo'; render(); }
    return;
  }
  if (action === 'select-project') {
    try {
      await api('/projects/'+encodeURIComponent(id)+'/select','POST',{});
      resetGraph(); state.graphProjectId = null; state.graphSearch = '';
      await load();
    } catch (e) { notify(e.message, true); }
    return;
  }
  if (action === 'approve-run' || action === 'cancel-run') {
    if (action === 'cancel-run' && !confirm('Cancelar esta execução?')) return;
    try { await api('/orchestration/'+encodeURIComponent(id)+'/'+(action==='approve-run'?'approve':'cancel'),'POST',{}); await load(); }
    catch (e) { notify(e.message, true); }
  }
}
function selectFlow(target) {
  const agent = target.closest?.('[data-flow-agent]'), router = target.closest?.('[data-flow-router]');
  if (!agent && !router) return false;
  state.orchSelected = agent ? Number(agent.dataset.flowAgent) || 0 : -1;
  render();
  $(agent ? '[data-flow-agent="'+state.orchSelected+'"]' : '[data-flow-router]')?.focus();
  return true;
}
document.addEventListener('click', e => {
  if (selectFlow(e.target)) return;
  const tab = e.target.closest('[data-page]');
  if (tab) return go(tab.dataset.page);
  const button = e.target.closest('[data-action]');
  if (button) void act(button.dataset.action, button.dataset.id);
});
document.addEventListener('change', e => {
  if (e.target.id === 'project-select') return void act('select-project', e.target.value);
  const field = e.target.dataset.field;
  if (field) updateDraft(field, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
});
document.addEventListener('input', e => {
  if (e.target.id === 'memory-graph-search') {
    state.graphSearch = e.target.value;
    memoryCanvas?.setQuery(state.graphSearch);
    return;
  }
  const field = e.target.dataset.field;
  if (field && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') updateDraft(field, e.target.value);
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'memory-graph-search' && e.key === 'Enter') return void memoryCanvas?.selectMatch();
  if ((e.key === 'Enter' || e.key === ' ') && selectFlow(e.target)) e.preventDefault();
});
$('#refresh-button').addEventListener('click', () => { resetGraph(); void load(); });
narrow.addEventListener('change', () => { if (state.page === 'orchestration') render(); });
addEventListener('popstate', () => go(routePage(), false));
addEventListener('beforeunload', e => { if (!$('#savebar').hidden) e.preventDefault(); });
function routePage() {
  const route = location.pathname.split('/').filter(Boolean)[0] || 'memory';
  return aliases[route] || route;
}
state.page = pages[routePage()] ? routePage() : 'memory';
void load().catch(e => { $('#content').innerHTML = stateMessage('Sem conexão com o FXMIND', e.message); });
