// Impeccable · operational map of configured agent routing.
// Visual edges represent selection routes, NOT inferred task dependencies.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=s=>String(s||'Padrão').length>27?String(s).slice(0,25)+'…':String(s||'Padrão');
export function flowCanvas(config,active,selected=0){
  const rules=config?.routing?.rules||[];
  const h=Math.max(430,115+rules.length*76);
  const center=h/2;
  const coords=rules.map((rule,i)=>({x:485,y:63+i*76,rule,i}));
  const lines=coords.map(n=>{
    const y=n.y+24;
    return '<path d="M 320 '+center+' C 395 '+center+', 390 '+y+', 485 '+y+'" class="flow-edge" />'
  }).join('');
  const nodes=coords.map(n=>{
    const {rule,i}=n;
    const y=n.y;
    const activeSubtasks=active?.subtasks||[];
    const role=String(rule.match||'').split('|')[0]||'Agente';
    const roleName=['Explorar','Revisar','Implementar','Testar','Consultar'][i] || role.charAt(0).toUpperCase()+role.slice(1);
    const working=activeSubtasks.some(s=>String(s.type||'').toLowerCase()===role.toLowerCase()&&s.status==='running');
    const provider=rule.provider||config.routing.defaultProvider||'CLI padrão';
    return '<g tabindex="0" role="button" aria-label="Editar agente '+esc(role)+'" data-flow-agent="'+i+'" class="flow-agent'+(i===selected?' is-selected':'')+(working?' is-running':'')+'">'
      +'<rect x="485" y="'+y+'" width="290" height="52" rx="12" class="flow-node-bg" />'
      +'<rect x="485" y="'+y+'" width="3" height="52" rx="1" class="flow-node-accent" />'
      +'<circle cx="504" cy="'+(y+26)+'" r="4.5" class="flow-node-dot" />'
      +'<text x="519" y="'+(y+21)+'" class="flow-node-name">'+esc(roleName)+'</text>'
      +'<text x="519" y="'+(y+37)+'" class="flow-node-meta">'+esc(provider)+' · '+esc(short(rule.model))+'</text>'
      +'<path d="M 754 '+(y+22)+' l 6 5 l -6 5" fill="none" class="flow-node-chevron"/>'
      +'</g>'
  }).join('');
  return '<div class="flow-map" role="region" aria-label="Mapa de roteamento dos agentes">'
    +'<svg class="flow-svg" viewBox="0 0 870 '+h+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Entrada para roteador e agentes configurados">'
    +'<defs><pattern id="flow-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#77808d" opacity=".15"/></pattern></defs>'
    +'<rect width="870" height="'+h+'" fill="url(#flow-dots)"/>'
    +'<path d="M 138 '+center+' L 206 '+center+'" class="flow-edge flow-edge-main"/>'
    +lines
    +'<rect x="26" y="'+(center-33)+'" width="114" height="66" rx="12" class="flow-static-node"/>'
    +'<text x="83" y="'+(center-4)+'" text-anchor="middle" class="flow-static-title">Demanda</text>'
    +'<text x="83" y="'+(center+15)+'" text-anchor="middle" class="flow-node-meta">Entrada</text>'
    +'<rect x="206" y="'+(center-40)+'" width="114" height="80" rx="13" class="flow-router-node"/>'
    +'<text x="263" y="'+(center-8)+'" text-anchor="middle" class="flow-router-title">Roteador</text>'
    +'<text x="263" y="'+(center+12)+'" text-anchor="middle" class="flow-node-meta">'+esc(config.strategy||'smart')+'</text>'
    +'<text x="263" y="'+(center+28)+'" text-anchor="middle" class="flow-router-label">'+esc(config.mode||'confirm')+'</text>'
    +nodes
    +'<text x="27" y="'+(h-14)+'" class="flow-caption">CONFIGURAÇÃO DE ROTEAMENTO · NÃO EXIBE DEPENDÊNCIAS REAIS</text>'
    +'</svg>'
    +'</div>';
}
