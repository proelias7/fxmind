// Map of the configured agent routing. Edges are routing rules, not the
// dependencies of a real run. Every node opens in the inspector.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=s=>String(s).length>24?String(s).slice(0,23)+'…':String(s);
const ROLES=['Explorar','Revisar','Implementar','Testar','Consultar'];
const MODES={auto:'automático',confirm:'confirma antes',off:'desligado'};
export function roleName(rule,i){
  const first=String(rule?.match||'').split('|')[0]||'Agente';
  return ROLES[i]||first.charAt(0).toUpperCase()+first.slice(1);
}
// compact drops the static "Demanda" node so the map stays legible on a phone.
export function flowCanvas(config,active,selected=0,compact=false){
  const rules=config?.routing?.rules||[];
  const rx=compact?4:196,rw=compact?104:120,ax=compact?150:440,aw=compact?246:304,width=compact?400:760,bend=(ax-rx-rw)/2;
  const pitch=68,nodeH=52,stack=Math.max(nodeH,rules.length*pitch-(pitch-nodeH));
  const h=Math.max(260,stack+48),center=h/2,top=(h-stack)/2;
  const running=new Set((active?.subtasks||[]).filter(s=>s.status==='running').map(s=>String(s.type||'').toLowerCase()));
  const fallback=config.routing.defaultProvider||'automático';
  let edges='',nodes='';
  rules.forEach((rule,i)=>{
    const y=top+i*pitch,mid=y+nodeH/2,on=i===selected;
    const role=String(rule.match||'').split('|')[0].toLowerCase();
    edges+='<path d="M '+(rx+rw)+' '+center+' C '+(rx+rw+bend)+' '+center+', '+(ax-bend)+' '+mid+', '+ax+' '+mid+'" class="flow-edge'+(on?' is-selected':'')+'"/>';
    nodes+='<g tabindex="0" role="button" aria-pressed="'+on+'" aria-label="Editar '+esc(roleName(rule,i))+'" data-flow-agent="'+i+'" class="flow-node'+(on?' is-selected':'')+(running.has(role)?' is-running':'')+'">'
      +'<rect x="'+ax+'" y="'+y+'" width="'+aw+'" height="'+nodeH+'" rx="14"/>'
      +'<circle cx="'+(ax+22)+'" cy="'+mid+'" r="4"/>'
      +'<text x="'+(ax+38)+'" y="'+(y+22)+'" class="flow-name">'+esc(roleName(rule,i))+'</text>'
      +'<text x="'+(ax+38)+'" y="'+(y+39)+'" class="flow-meta">'+esc(short([rule.provider||fallback,rule.model].filter(Boolean).join(' · ')))+'</text>'
      +'</g>';
  });
  const routerOn=selected===-1;
  return '<div class="flow-map">'
    +'<svg class="flow-svg" viewBox="0 0 '+width+' '+h+'" role="group" aria-label="Roteamento configurado dos agentes">'
    +(compact?'':'<path d="M 126 '+center+' L 196 '+center+'" class="flow-edge"/>')+edges
    +(compact?'':'<g class="flow-node is-static"><rect x="16" y="'+(center-26)+'" width="110" height="52" rx="14"/>'
    +'<text x="71" y="'+(center+5)+'" text-anchor="middle" class="flow-name">Demanda</text></g>')
    +'<g tabindex="0" role="button" aria-pressed="'+routerOn+'" aria-label="Editar padrões do roteador" data-flow-router class="flow-node'+(routerOn?' is-selected':'')+'">'
    +'<rect x="'+rx+'" y="'+(center-32)+'" width="'+rw+'" height="64" rx="14"/>'
    +'<text x="'+(rx+rw/2)+'" y="'+(center-3)+'" text-anchor="middle" class="flow-name">Roteador</text>'
    +'<text x="'+(rx+rw/2)+'" y="'+(center+15)+'" text-anchor="middle" class="flow-meta">'+esc(config.enabled===false?'desligado':MODES[config.mode]||config.mode||'')+'</text></g>'
    +nodes
    +'</svg></div>';
}
