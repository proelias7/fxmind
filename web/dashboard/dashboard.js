import { mountMemoryGraph } from './memory-graph.js';
// FXMIND Dashboard. A management-only UI; conversations remain in CLI hosts.
const apiBase = '/api';
const $ = (sel, root = document) => root.querySelector(sel);
const state = {
  page: 'overview', health: null, workspace: null, projects: [],
  orchestration: null, orchestrationDraft: null, active: null, history: [],
  agent: null, agentDraft: null, subagents: null, subagentDraft: null,
  providers: [], clis: [], models: {}, saving: false,
  scope: 'project', error: null, version: '—',
  memoryTab: 'canvas', graphMode: 'memories', graph: null,
  graphError: null, graphLoading: false, graphProjectId: null,
  graphLoadedMode: null, graphSearch: '',
};
let memoryCanvas = null;
let graphRequestId = 0;
const activeProjectId = () => state.health?.workspaceId || state.workspace?.workspaceId || '';
const pages = {
  overview: ['Visão geral', 'Panorama do ambiente e das automações'],
  orchestration: ['Orquestração', 'Controle de tarefas e roteamento de agentes'],
  agents: ['Agentes e modelos', 'CLI, modelos e revisão independente'],
  subagents: ['Subagentes', 'Perfis e responsabilidades dos auxiliares'],
  providers: ['Provedores', 'Integrações e chaves de API'],
  projects: ['Projetos e memória', 'Projetos registrados e contexto ativo'],
};
const roles = ['Explorar', 'Revisar', 'Implementar', 'Testar', 'Consultar'];
const cliNames = { claude:'Claude', codex:'Codex', opencode:'OpenCode', 'cursor-agent':'Cursor Agent', hermes:'Hermes' };
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr = esc;
const fmt = n => Number(n || 0).toLocaleString('pt-BR');
const label = (value, fallback='Padrão') => value ? (cliNames[value] || value) : fallback;
const modelName = m => m && typeof m === 'object' ? String(m.id || m.name || m.label || '') : String(m || '');
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
  if (!res.ok || data.ok === false) throw Error(data.error || data.message || 'Falha na solicitação (' + res.status + ')');
  return data;
}
const textField = (title, value, id, options={}) => '<label class="field"><span>'+esc(title)+'</span><input '+(options.type ? 'type="'+attr(options.type)+'"' : 'type="text"')+' data-field="'+attr(id)+'" value="'+attr(value ?? '')+'" '+(options.placeholder ? 'placeholder="'+attr(options.placeholder)+'"' : '')+' '+(options.autocomplete || '')+'/>'+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
const selectField = (title, value, id, options, note='') =>
  '<label class="field"><span>'+esc(title)+'</span><select data-field="'+attr(id)+'">'+options.map(o=>{
    const obj = typeof o === 'string' ? {value:o,label:o} : o;
    return '<option value="'+attr(obj.value ?? '')+'" '+(String(obj.value??'')===String(value??'')?'selected':'')+'>'+esc(obj.label)+'</option>';
  }).join('')+'</select>'+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const switchField = (title, value, id) => '<label class="switch"><input type="checkbox" data-field="'+attr(id)+'" '+(value?'checked':'')+'/><span>'+esc(title)+'</span></label>';
const section = (title, desc, content, actions='') =>
  '<section class="section"><div class="section-head"><div><h2>'+esc(title)+'</h2><p>'+esc(desc)+'</p></div>'+actions+'</div>'+content+'</section>';
const btn = (label, action, variant='', extra='') => '<button class="btn '+variant+'" data-action="'+attr(action)+'" '+extra+'>'+esc(label)+'</button>';
const heading = (kicker,title,desc) => '<div class="page-heading"><span class="eyebrow">'+esc(kicker)+'</span><h1>'+esc(title)+'</h1><p>'+esc(desc)+'</p></div>';
const metric = (title,value,meta) => '<div class="metric"><div class="metric-kicker">'+esc(title)+'</div><div class="metric-value">'+esc(value)+'</div><div class="metric-meta">'+esc(meta)+'</div></div>';
const empty = message => '<div class="empty">'+esc(message)+'</div>';
function cliChoices(includeDefault=true) {
  const choices = includeDefault ? [{value:'',label:'Automático'}] : [];
  const active = new Set((state.clis || []).map(x => x.id));
  for (const id of ['claude','codex','opencode','cursor-agent','hermes']) {
    choices.push({value:id,label:label(id)+(active.size && !active.has(id) ? ' · não instalado' : '')});
  }
  return choices;
}
function formActions(action='save-orchestration',name='Salvar configurações') {
  return '<div class="actions">'+btn(name,action,'primary')+'</div>';
}
function visibleModels(cliId) {
  const data = state.models[cliId] || [];
  return data.map(modelName).filter(Boolean);
}
function modelField(title, current, field, cliId) {
  const id = 'models-'+String(field).replace(/[^a-z0-9]/gi,'-');
  const opts = visibleModels(cliId);
  return '<label class="field"><span>'+esc(title)+'</span><input type="text" list="'+id+'" data-field="'+attr(field)+'" value="'+attr(current || '')+'" placeholder="Padrão do CLI" autocomplete="off"/><datalist id="'+id+'">'+opts.map(x=>'<option value="'+attr(x)+'"></option>').join('')+'</datalist><small>Selecione da lista ou informe um ID personalizado.</small></label>';
}
function overview() {
  const h = state.health || {}, a = state.active?.orchestration;
  const count = state.projects.filter(p=>p.hasFxmind).length;
  const history = state.history || [];
  const successful = history.filter(x=>x.status === 'completed').length;
  return heading('CENTRAL DE CONTROLE','Seu ambiente, em um só lugar','Configurações compartilhadas de agentes, projetos, memória e orquestração. As conversas acontecem no Claude, Codex e demais CLIs.')
    +'<div class="grid metrics">'+metric('Projetos',fmt(state.projects.length),fmt(count)+' com FXMIND')
    +metric('Memórias',fmt(h.memoryCount),'No projeto selecionado')
    +metric('CLIs instalados',fmt((h.cli?.installed||[]).length),label(h.cli?.activeId,'Nenhum')+' ativo')
    +metric('Execuções',fmt(history.length),fmt(successful)+' concluídas')+'</div>'
    +'<div class="grid cols"><div>'
    +section('Orquestração', 'Configuração e atividade dos agentes', '<div class="list"><div class="list-row"><div><strong>Motor de orquestração</strong><small>Estratégia '+esc(state.orchestration?.config?.strategy || '—')+'</small></div><span class="tag '+(state.orchestration?.config?.enabled?'good':'neutral')+'">'+(state.orchestration?.config?.enabled?'Ativo':'Desativado')+'</span></div><div class="list-row"><div><strong>Modo</strong><small>Política aplicada às execuções</small></div><strong>'+esc(state.orchestration?.config?.mode || '—')+'</strong></div><div class="list-row"><div><strong>Execução atual</strong><small>Monitoramento compartilhado com MCP</small></div><strong>'+esc(a?.status || 'Sem execução')+'</strong></div></div>'+formActions('go-orchestration','Gerenciar orquestração'))
    +section('Acesso rápido','Configurações globais e por projeto','<div class="list"><div class="list-row"><div><strong>Modelos e agentes</strong><small>CLIs, modelos e revisão</small></div>'+btn('Configurar','go-agents')+'</div><div class="list-row"><div><strong>Projetos e memória</strong><small>Seleção de contexto e estado</small></div>'+btn('Abrir','go-projects')+'</div></div>')+'</div><div>'
    +section('Projeto ativo','Ambiente associado ao painel', '<div class="list"><div class="list-row"><div><strong>'+esc(h.workspaceRoot?.split(/[\\/]/).pop()||'—')+'</strong><small>'+esc(h.workspaceRoot||'Nenhum projeto')+'</small></div><span class="tag good">Local</span></div><div class="list-row"><div><strong>Branch</strong><small>Versão do projeto</small></div><span class="tag">'+esc(h.gitBranch||'—')+'</span></div></div>')
    +section('Atividade recente','Últimas execuções de orquestração', history.length ? '<div class="list">'+history.slice(0,5).map(s=>'<div class="list-row"><div><strong>'+esc(s.task||s.name||s.id||'Execução')+'</strong><small>'+esc(s.id||'')+'</small></div><span class="tag">'+esc(s.status||'—')+'</span></div>').join('')+'</div>' : empty('Nenhuma execução registrada neste projeto.'))+'</div></div>'
    +'<p class="footer-note">FXMIND Dashboard · Gerenciamento local em 127.0.0.1 · Sem interface de chat.</p>';
}
function orchestration() {
  const c = state.orchestrationDraft;
  if (!c) return empty('Não foi possível carregar a configuração de orquestração.');
  const mode = [{value:'auto',label:'Automático'},{value:'confirm',label:'Confirmar antes'},{value:'off',label:'Desligado'}];
  const strategy = [{value:'smart',label:'Smart DAG'},{value:'parallel',label:'Paralelo'},{value:'sequential',label:'Sequencial'}];
  const efforts = [{value:'low',label:'Baixo'},{value:'medium',label:'Médio'},{value:'high',label:'Alto'},{value:'xhigh',label:'Máximo'}];
  const rules = (c.routing?.rules||[]).map((r,i) => '<div class="agent-row"><div class="agent-name">'+esc(roles[i]||r.match.split('|')[0]||'Regra '+(i+1))+'<small>'+esc(r.match||'')+'</small></div>'+selectField('CLI',r.provider||'','orch.rule.'+i+'.provider',cliChoices())+modelField('Modelo',r.model,'orch.rule.'+i+'.model',r.provider||c.routing.defaultProvider)+selectField('Esforço',r.effort||'medium','orch.rule.'+i+'.effort',efforts)+'</div>').join('');
  const active = state.active?.orchestration;
  const activeSection = active
    ? '<div class="session"><div><strong>'+esc(active.task||active.name||active.id)+'</strong><span class="id">'+esc(active.id)+'</span><small>'+esc(active.status)+' · '+fmt(active.subtasks?.length)+' subtarefas</small></div><div class="right">'+(active.status==='awaiting_approval'?btn('Aprovar','approve-run','primary','data-id="'+attr(active.id)+'"'):'')+(active.status==='running'||active.status==='awaiting_approval'?btn('Cancelar','cancel-run','danger','data-id="'+attr(active.id)+'"'):'')+'</div></div>'
    : empty('Nenhuma execução ativa.');
  return heading('GERENCIAMENTO','Orquestração de agentes','Defina regras de roteamento por função. Cada agente pode usar seu próprio CLI, modelo e nível de esforço.')
    +section('Operação','Escopo, política de aprovação e paralelismo',
      '<div class="form-grid cols4">'+selectField('Onde salvar',state.scope,'scope',[{value:'project',label:'Projeto atual'},{value:'global',label:'Global'}])
      +selectField('Modo',c.mode,'orch.mode',mode)
      +selectField('Estratégia',c.strategy,'orch.strategy',strategy)
      +selectField('Concorrência',String(c.maxConcurrent),'orch.maxConcurrent',['1','2','3','4','5','6','8','10'])+'</div><div class="divider"></div>'+switchField('Ativar orquestração',c.enabled,'orch.enabled')+'<div class="help" style="margin-top:10px">O modo de confirmação solicita aprovação antes de iniciar. Alterações globais afetam projetos sem regras próprias.</div>')
    +section('Roteamento por função','Modelo específico por CLI, com preenchimento personalizado',rules || empty('Nenhuma regra de roteamento.'))
    +section('Agente padrão','Utilizado quando nenhuma regra corresponde', '<div class="form-grid cols3">'+selectField('CLI padrão',c.routing?.defaultProvider||'','orch.defaultProvider',cliChoices())+modelField('Modelo padrão',c.routing?.defaultModel,'orch.defaultModel',c.routing?.defaultProvider)+selectField('Esforço padrão',c.routing?.defaultEffort||'medium','orch.defaultEffort',efforts)+'</div>'+formActions())
    +section('Execução ativa','Acompanhe e gerencie execuções',activeSection)
    +section('Histórico','Últimas 20 sessões',state.history?.length?'<div class="list">'+state.history.slice(0,20).map(s=>'<div class="list-row"><div><strong>'+esc(s.task||s.name||s.id||'Execução')+'</strong><small>'+esc(s.id||'')+' · '+fmt(s.subtasks?.length)+' tarefas</small></div><span class="tag">'+esc(s.status||'—')+'</span></div>').join('')+'</div>':empty('Sem execuções anteriores.'));
}
function agents() {
  const a=state.agentDraft;
  if(!a)return empty('Configuração de agentes indisponível.');
  const options=cliChoices();
  const model=modelField('Modelo padrão',a.model,'agent.model',a.cliId);
  return heading('CONFIGURAÇÕES','Agentes e modelos','Padrões de execução dos CLIs e revisão independente. Essas opções são compartilhadas pela dashboard.')
    +section('Agente principal','CLI e modelo padrão para o ambiente','<div class="form-grid cols3">'+selectField('CLI',a.cliId||'','agent.cliId',options)+model+selectField('Esforço',a.effort||'default','agent.effort',[{value:'default',label:'Padrão'},...['low','medium','high','xhigh'].map(x=>({value:x,label:x}))])+'</div><div class="divider"></div><div class="form-grid cols3">'+selectField('Modo',a.mode,'agent.mode',[{value:'cli',label:'CLI conectado'},{value:'byok',label:'API própria'}])+selectField('Acesso',a.accessMode,'agent.accessMode',['read-only','ask','auto','full'].map(x=>({value:x,label:x})))+selectField('Tarefas',a.taskMode,'agent.taskMode',['full','auto','off'].map(x=>({value:x,label:x})))+'</div>'+formActions('save-agent','Salvar agente'))
    +section('Revisão independente','Políticas do agente revisor (Judge)', '<div class="form-grid cols3">'+selectField('Revisor',a.judge?.cliId||'','agent.judge.cliId',options)+modelField('Modelo de revisão',a.judge?.model,'agent.judge.model',a.judge?.cliId)+selectField('Gatilho',a.judge?.trigger||'off','agent.judge.trigger',[{value:'off',label:'Desativado'},{value:'manual',label:'Manual'},{value:'auto',label:'Automático'}])+'</div><div style="margin-top:16px">'+switchField('Ativar revisor',a.judge?.enabled!==false,'agent.judge.enabled')+'</div>'+formActions('save-agent','Salvar revisão'))
    +section('CLI instalado','Disponibilidade do ambiente','<div class="list">'+(state.clis.length?state.clis.map(c=>'<div class="list-row"><div class="item-line"><span class="item-icon">'+esc((c.name||c.id||'?').slice(0,1).toUpperCase())+'</span><div><strong>'+esc(c.name||c.id)+'</strong><small>'+esc(c.id||'')+'</small></div></div><span class="tag '+(c.installed?'good':'neutral')+'">'+(c.installed?'Instalado':'Indisponível')+'</span></div>').join(''):empty('Não foi possível detectar os CLIs.'))+'</div>');
}
function subagents() {
  const data=state.subagents;
  if(!data)return empty('Subagentes indisponíveis.');
  const rows=data.subagents.map((s,i)=>'<div class="agent-row"><div class="agent-name">'+esc(s.label||s.id)+'<small>'+esc(s.description||'')+'</small></div>'+selectField('CLI',s.cliId||'','sub.'+i+'.cliId',cliChoices())+modelField('Modelo',s.model,'sub.'+i+'.model',s.cliId)+selectField('Variante',s.variant||'','sub.'+i+'.variant',[{value:'',label:'Padrão'},...['minimal','low','medium','high'].map(x=>({value:x,label:x}))])+'</div>').join('');
  return heading('CONFIGURAÇÕES','Subagentes','Defina CLI, modelo e variante dos auxiliares reutilizáveis entre tarefas.')
    +section('Perfis de execução', 'Configurações de subagentes no projeto atual',rows+'<div class="divider"></div>'+switchField('Instalar arquivos OpenCode dos subagentes',false,'sub.install')+formActions('save-subagents','Salvar subagentes'));
}
function providers() {
  return heading('INTEGRAÇÕES','Provedores','Gerencie chaves de API e endpoints. Chaves existentes não são exibidas e só são substituídas quando você informa uma nova.')
    +section('Integrações configuradas','As chaves são armazenadas localmente', '<div class="grid cols">'+state.providers.map(p=>'<div class="provider-card"><div class="section-head"><div><h2>'+esc(p.name||p.id)+'</h2><p>'+esc(p.envKey||p.id)+'</p></div><span class="tag '+(p.configured?'good':'neutral')+'">'+(p.configured?'Configurado':'Pendente')+'</span></div>'+textField('URL base',p.baseURL||'','provider.'+p.id+'.baseURL')+textField('Chave de API', '', 'provider.'+p.id+'.apiKey',{type:'password',placeholder:p.configured?'Configurada · inserir somente para substituir':'Inserir chave',autocomplete:'autocomplete="new-password"'})+'<div class="actions">'+btn('Salvar','save-provider','primary','data-id="'+attr(p.id)+'"')+'</div></div>').join('')+'</div>')
    +section('Credenciais fixas','Anthropic, OpenAI e Cursor podem ser configurados nas opções globais do agente','<div class="callout">Mantenha as chaves existentes se não quiser substituí-las. Evite compartilhá-las em capturas de tela.</div>');
}
function graphPanel() {
  const graph = state.graph;
  const same = graph && state.graphProjectId === activeProjectId() && state.graphLoadedMode === state.graphMode;
  const meta = same ? graph.meta || {} : {};
  const counts = same
    ? fmt(meta.visibleNodes) + ' nós · ' + fmt(meta.visibleLinks) + ' ligações' + (meta.truncated ? ' · amostra' : '')
    : '';
  let visual = '';
  if (state.graphLoading) {
    visual = '<div class="graph-canvas-status"><strong>Carregando conexões…</strong><span>Preparando a visualização de memórias</span></div>';
  } else if (state.graphError) {
    visual = '<div class="graph-canvas-status"><strong>Canvas indisponível</strong><span>' + esc(state.graphError) + '</span>'
      + btn('Gerar grafo','graph-rebuild','primary') + '</div>';
  } else if (same && graph.nodes?.length) {
    visual = '<div class="memory-network-wrap" id="memory-graph">'
      + '<div class="memory-canvas-pane"><canvas tabindex="0" aria-label="Canvas interativo das ligações entre memórias"></canvas>'
      + '<div class="graph-overlay-legend"><span><i class="graph-legend-dot" style="background:#7ee0b4"></i>Memórias</span>'
      + (state.graphMode === 'fragments' ? '<span><i class="graph-legend-dot" style="background:#f2b45a"></i>Fragmentos</span><span><i class="graph-legend-dot" style="background:#8797e7"></i>Recursos</span>' : '')
      + '</div></div><aside class="graph-details-pane" data-graph-details><div class="graph-detail-empty">Selecione uma memória para ver suas conexões e origem.</div></aside></div>';
  } else if (same) {
    visual = '<div class="graph-canvas-status"><strong>Sem memórias no grafo</strong><span>Gere o índice do projeto para visualizar as ligações.</span>'
      + btn('Gerar grafo','graph-rebuild','primary') + '</div>';
  } else {
    visual = '<div class="graph-canvas-status">Preparando Canvas…</div>';
  }
  return section('Canvas de memórias',
    'Conexões confirmadas entre os tópicos. Arraste para mover; use a roda do mouse ou os botões para aproximar.',
    '<div class="memory-tools">'
    + '<select id="memory-graph-mode" aria-label="Tipo de grafo">'
    + '<option value="memories" ' + (state.graphMode==='memories'?'selected':'') + '>Memórias e ligações</option>'
    + '<option value="fragments" ' + (state.graphMode==='fragments'?'selected':'') + '>Fragmentos detalhados</option></select>'
    + '<input id="memory-graph-search" type="search" placeholder="Buscar memória ou tópico" aria-label="Buscar nós no Canvas" value="' + attr(state.graphSearch) + '" />'
    + btn('−','graph-zoom-out','','aria-label="Diminuir zoom"')
    + btn('+','graph-zoom-in','','aria-label="Aumentar zoom"')
    + btn('Centralizar','graph-fit')
    + '<span class="graph-counts">' + esc(counts) + '</span></div>'
    + visual
    + '<div class="graph-canvas-hint">Apenas relações confirmadas pelo FXMIND. A visualização detalhada mostra até 300 nós por vez para manter a interface leve.</div>');
}
function projects() {
  const viewTabs = '<div class="memory-view-tabs">'
    + btn('Canvas','view-canvas',state.memoryTab==='canvas'?'primary':'')
    + btn('Projetos','view-list',state.memoryTab==='list'?'primary':'') + '</div>';
  const projectList = section('Projetos registrados','Alterne o escopo da dashboard',
    '<div class="list">'+state.projects.map(p=>'<div class="list-row"><div><strong>'+esc(p.name||p.root||'Projeto')+'</strong><small>'+esc(p.root||'')+'</small></div><div class="right">'+(activeProjectId()===p.id?'<span class="tag good">Ativo</span>':btn('Selecionar','select-project','','data-id="'+attr(p.id)+'"'))+'</div></div>').join('')+'</div>');
  return heading('CONTEXTO','Projetos e memória',
      'Explore memórias, fragmentos e suas conexões ou selecione outro projeto.')
    +section('Contexto atual','Memórias e projetos associados ao ambiente',
      '<div class="grid metrics" style="grid-template-columns:repeat(2,minmax(0,1fr))">'
      + metric('Memórias',fmt(state.health?.memoryCount||0),'No projeto ativo')
      + metric('Projetos registrados',fmt(state.projects.length),'Disponíveis no ambiente')+'</div>')
    +viewTabs
    +(state.memoryTab==='canvas'?graphPanel():projectList);
}
async function loadGraph() {
  const id=activeProjectId();
  if(!id || state.graphLoading)return;
  const req=++graphRequestId;
  state.graphLoading=true;state.graphError=null;state.graph=null;
  const mode=state.graphMode;
  state.graphProjectId=id;
  render();
  try{
    const graph=await api('/projects/'+encodeURIComponent(id)+'/graph/view?mode='+encodeURIComponent(mode));
    if(req!==graphRequestId)return;
    state.graph=graph;
    state.graphLoadedMode=mode;
  }catch(e){
    if(req!==graphRequestId)return;
    state.graphError=e.message || 'Não foi possível carregar o grafo';
  }finally{
    if(req===graphRequestId){
      state.graphLoading=false;
      render();
    }
  }
}

function render() {
  const [title] = pages[state.page];
  $('#breadcrumb-current').textContent=title;
  for(const el of document.querySelectorAll('[data-page]'))el.classList.toggle('active',el.dataset.page===state.page);
  $('#connection-dot').classList.toggle('offline',!state.health);
  $('#connection-text').textContent=state.health?'Serviço conectado':'Sem conexão';
  $('#sidebar-version').textContent='FXMIND · Dashboard';
  const cur=state.health?.workspaceId || state.workspace?.workspaceId || '';
  $('#project-select').innerHTML=state.projects.map(p=>'<option value="'+attr(p.id)+'" '+(p.id===cur?'selected':'')+'>'+esc(p.name||p.root)+'</option>').join('')||'<option value="">Nenhum projeto</option>';
  memoryCanvas?.destroy();
  memoryCanvas = null;
  $('#content').innerHTML=({overview,orchestration,agents,subagents,providers,projects}[state.page]||overview)();
  if(state.page==='projects' && state.memoryTab==='canvas'){
    if(state.graph && state.graphProjectId===activeProjectId() && state.graphLoadedMode===state.graphMode){
      memoryCanvas=mountMemoryGraph($('#memory-graph'),state.graph);
      memoryCanvas.setQuery(state.graphSearch);
    }else if(!state.graphLoading && !state.graphError){
      void loadGraph();
    }
  }
}
async function load() {
  const endpoints=[
    ['health','/health'],['workspace','/workspace'],['orchestration','/orchestration/config'],
    ['active','/orchestration/active'],['history','/orchestration/history'],
    ['agent','/settings/agent'],['subagents','/settings/subagents'],['providers','/settings/providers'],['scan','/cli/scan'],
  ];
  const result=await Promise.allSettled(endpoints.map(([key,path])=>api(path).then(data=>({key,data}))));
  const failures=[];
  for(const it of result){
    if(it.status!=='fulfilled'){failures.push(it.reason?.message||'Indisponível');continue;}
    const {key,data}=it.value;
    if(key==='workspace'){state.workspace=data;state.projects=data.projects||[];}
    else if(key==='orchestration'){state.orchestration=data;state.orchestrationDraft=clone(data.config||{});}
    else if(key==='history')state.history=data.orchestrations||[];
    else if(key==='agent'){state.agent=data;state.agentDraft=clone(data);}
    else if(key==='subagents'){state.subagents=data;state.subagentDraft=clone(data);}
    else if(key==='providers')state.providers=data.providers||[];
    else if(key==='scan')state.clis=data.clis||[];
    else state[key]=data;
  }
  state.projects=state.projects||[];
  render();
  if(failures.length)notify('Alguns dados não carregaram: '+failures[0],true);
  const cliIds=new Set(['claude','codex','opencode','cursor-agent','hermes']);
  await Promise.all([...cliIds].map(loadModels));
  render();
}
async function loadModels(cliId) {
  if(!cliId||state.models[cliId])return;
  try{
    const r=await api('/cli/models?cliId='+encodeURIComponent(cliId));
    state.models[cliId]=r.models||r.allModels||[];
  }catch{state.models[cliId]=[];}
}
function updateModelDraft(field,value) {
  const parts=field.split('.');
  if(parts[0]==='orch'&&state.orchestrationDraft){
    const draft=state.orchestrationDraft;
    if(parts[1]==='rule'){
      const idx=Number(parts[2]),prop=parts[3],r=draft.routing.rules[idx];if(!r)return;
      r[prop]=value||null;
      if(prop==='provider'){r.model=null;void loadModels(value).then(render);}
    }else if(parts[1]==='enabled')draft.enabled=Boolean(value);
    else if(parts[1]==='maxConcurrent')draft.maxConcurrent=Math.min(10,Math.max(1,Number(value)||3));
    else if(parts[1]==='defaultProvider'){draft.routing.defaultProvider=value||null;draft.routing.defaultModel=null;void loadModels(value).then(render);}
    else if(parts[1]==='defaultModel')draft.routing.defaultModel=value||null;
    else if(parts[1]==='defaultEffort')draft.routing.defaultEffort=value;
    else draft[parts[1]]=value;
  }else if(parts[0]==='agent'&&state.agentDraft){
    const draft=state.agentDraft;
    if(parts[1]==='judge') {
      draft.judge ||= {};draft.judge[parts[2]]=value;
      if(parts[2]==='cliId'){draft.judge.model=null;void loadModels(value).then(render);}
    }else{draft[parts[1]]=value;
      if(parts[1]==='cliId'){draft.model=null;void loadModels(value).then(render);}
    }
  }else if(parts[0]==='sub'&&state.subagentDraft){
    const sub=state.subagentDraft.subagents[Number(parts[1])];
    if(sub){
      sub[parts[2]]=value;
      if(parts[2]==='cliId'){sub.model=null;void loadModels(value).then(render);}
    }
  }else if(parts[0]==='scope')state.scope=value;
}
async function save(action, id) {
  if(state.saving)return;
  state.saving=true;
  try {
    if(action==='save-orchestration') {
      if(!state.orchestrationDraft)throw Error('Configuração indisponível');
      await api('/orchestration/config','PUT',{scope:state.scope,config:state.orchestrationDraft});
      const data=await api('/orchestration/config');state.orchestration=data;state.orchestrationDraft=clone(data.config);
    } else if(action==='save-agent'){
      const a=state.agentDraft;
      await api('/settings/agent','PUT',{ mode:a.mode, cliId:a.cliId, model:a.model, effort:a.effort, taskMode:a.taskMode, accessMode:a.accessMode, judge:a.judge });
      const data=await api('/settings/agent');state.agent=data;state.agentDraft=clone(data);
    } else if(action==='save-subagents'){
      const map={};
      for(const s of state.subagentDraft.subagents) map[s.id]={cliId:s.cliId||null,model:s.model||null,variant:s.variant||null};
      const install=$('[data-field="sub.install"]')?.checked||false;
      await api('/settings/subagents','PUT',{subagents:map,install});
      const data=await api('/settings/subagents');state.subagents=data;state.subagentDraft=clone(data);
    } else if(action==='save-provider'){
      const body={
        baseURL:$('[data-field="provider.'+CSS.escape(id)+'.baseURL"]')?.value||'',
      };
      const key=$('[data-field="provider.'+CSS.escape(id)+'.apiKey"]')?.value||'';
      if(key.trim())body.apiKey=key.trim();
      await api('/settings/providers/'+encodeURIComponent(id),'PUT',body);
      state.providers=(await api('/settings/providers')).providers||[];
    }else return;
    notify('Configurações salvas');
    render();
  }catch(e){notify(e.message||'Erro ao salvar',true)}
  finally{state.saving=false;}
}
async function act(action,id) {
  if(action==='view-canvas' || action==='view-list'){
    state.memoryTab=action==='view-canvas'?'canvas':'list';
    render();
    return;
  }
  if(action==='graph-fit'){memoryCanvas?.fit();return;}
  if(action==='graph-zoom-in'){memoryCanvas?.zoom(1.25);return;}
  if(action==='graph-zoom-out'){memoryCanvas?.zoom(.8);return;}
  if(action==='graph-rebuild'){
    const projectId=activeProjectId();
    if(!projectId)return;
    state.graphLoading=true;state.graphError=null;render();
    try{
      await api('/projects/'+encodeURIComponent(projectId)+'/graph','POST',{});
      state.graphLoading=false;state.graph=null;state.graphError=null;state.graphLoadedMode=null;
      await loadGraph();
      notify('Grafo atualizado');
    }catch(e){state.graphLoading=false;state.graphError=e.message||'Falha ao gerar grafo';render();notify(state.graphError,true);}
    return;
  }
  if(action.startsWith('go-')){state.page=action.slice(3);render();window.scrollTo({top:0});return;}
  if(action.startsWith('save-')){await save(action,id);return;}
  if(action==='select-project'){
    try{
      await api('/projects/'+encodeURIComponent(id)+'/select','POST',{});
      graphRequestId++;state.graphLoading=false;state.graph=null;state.graphError=null;state.graphProjectId=null;
      state.graphLoadedMode=null;state.graphSearch='';
      await load();notify('Projeto selecionado');
    }catch(e){notify(e.message,true)}
    return;
  }
  if(action==='approve-run'||action==='cancel-run'){
    if(action==='cancel-run'&&!confirm('Cancelar esta execução?'))return;
    try{await api('/orchestration/'+encodeURIComponent(id)+'/'+(action==='approve-run'?'approve':'cancel'),'POST',{});await load();notify('Execução atualizada')}catch(e){notify(e.message,true)}
  }
}
document.addEventListener('click',e=>{
  const tab=e.target.closest('[data-page]');
  if(tab){state.page=tab.dataset.page;$('#sidebar').classList.remove('open');render();window.scrollTo({top:0});return;}
  const button=e.target.closest('[data-action]');
  if(button)void act(button.dataset.action,button.dataset.id);
});
document.addEventListener('change',e=>{
  if(e.target.id==='memory-graph-mode'){
    graphRequestId++;state.graphMode=e.target.value==='fragments'?'fragments':'memories';
    state.graphLoading=false;state.graph=null;state.graphError=null;state.graphLoadedMode=null;
    state.graphSearch='';render();return;
  }
  if(e.target.id==='project-select'){void act('select-project',e.target.value);return;}
  const field=e.target.dataset.field;if(!field)return;
  updateModelDraft(field,e.target.type==='checkbox'?e.target.checked:e.target.value);
});
document.addEventListener('input',e=>{
  if(e.target.id==='memory-graph-search'){
    state.graphSearch=e.target.value;
    memoryCanvas?.setQuery(state.graphSearch);
    return;
  }
  const field=e.target.dataset.field;
  if(!field)return;
  if(e.target.tagName==='INPUT'&&e.target.type!=='checkbox')updateModelDraft(field,e.target.value);
});
$('#menu-toggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#refresh-button').addEventListener('click',()=>void load().then(()=>notify('Atualizado')));
const route=location.pathname.split('/').filter(Boolean)[0];
if(route&&pages[route])state.page=route;
void load().catch(e=>{$('#content').innerHTML=empty('Falha ao conectar à API local.');notify(e.message||'Sem conexão',true)});
