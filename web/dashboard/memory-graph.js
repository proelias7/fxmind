/**
 * Interactive local knowledge graph canvas. Browser receives only the
 * memory-focused projection (never the full 30k+ symbol index).
 */
const palette = {
  memory: '#7ee0b4', fact: '#f2b45a', resource: '#8797e7',
  edge: 'rgba(151,165,177,.26)', text: '#eef1ef', muted: '#98a2a6',
};
const clamp = (n,lo,hi) => Math.min(hi, Math.max(lo,n));
function hash(str) {
  let h = 2166136261;
  for (let i=0;i<str.length;i++) h = Math.imul(h^str.charCodeAt(i),16777619);
  return h>>>0;
}
const safe = x => String(x||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color = n => n.group==='learned'?palette.memory:n.group==='memory-atom'?palette.fact:palette.resource;
function layout(rawNodes,edges) {
  const nodes = rawNodes.map((node,i)=>{
    const angle = (i * 2.3999632297) + (hash(String(node.id))%20)/120;
    const r = 85 + 16*Math.sqrt(i);
    return {...node,x:Math.cos(angle)*r,y:Math.sin(angle)*r,vx:0,vy:0,weight:0};
  });
  const byId = new Map(nodes.map((n,i)=>[n.id,i]));
  const links = edges.map(e=>({a:byId.get(String(e.source)),b:byId.get(String(e.target)),type:e.type}))
    .filter(e=>e.a!==undefined && e.b!==undefined && e.a!==e.b);
  for(const e of links){nodes[e.a].weight++;nodes[e.b].weight++;}
  // Bounded deterministic spring layout; run once and draw on demand.
  const length = nodes.length, cycles=length>250?62:115;
  for(let step=0;step<cycles;step++){
    const cool=(1-step/cycles);
    for(let i=0;i<length;i++){
      const a=nodes[i];
      a.vx+=-a.x*.00055; a.vy+=-a.y*.00055;
      for(let j=i+1;j<length;j++){
        const b=nodes[j], dx=a.x-b.x,dy=a.y-b.y;
        const d2=Math.max(160,dx*dx+dy*dy);
        const f=2100/d2,dist=Math.sqrt(d2);
        a.vx+=dx/dist*f; a.vy+=dy/dist*f;
        b.vx-=dx/dist*f; b.vy-=dy/dist*f;
      }
    }
    for(const e of links){
      const a=nodes[e.a],b=nodes[e.b],dx=b.x-a.x,dy=b.y-a.y;
      const d=Math.max(2,Math.hypot(dx,dy)), ideal=e.type==='fragment-of'?66:140;
      const f=(d-ideal)*.009;
      a.vx+=(dx/d)*f; a.vy+=(dy/d)*f;
      b.vx-=(dx/d)*f; b.vy-=(dy/d)*f;
    }
    for(const n of nodes){
      n.x+=clamp(n.vx,-12,12)*cool;
      n.y+=clamp(n.vy,-12,12)*cool;
      n.vx*=.54;n.vy*=.54;
    }
  }
  return {nodes,links};
}
export function mountMemoryGraph(host, data) {
  const canvas=host.querySelector('canvas');
  if(!canvas)return {destroy(){},zoom(){},fit(){},setQuery(){}};
  const ctx=canvas.getContext('2d');
  if(!ctx)return {destroy(){},zoom(){},fit(){},setQuery(){}};
  const details=host.querySelector('[data-graph-details]');
  const tooltip=host.querySelector('[data-graph-tooltip]');
  const {nodes,links}=layout(data.nodes||[],data.links||[]);
  let selected=null,hovered=null,query='',dragged=null,dragPan=false,moved=false;
  let view={x:0,y:0,scale:1},size={w:0,h:0},alive=true,raf=0;
  const pointers=new Map();
  let lastPinch=null;
  const radius=n=>n.group==='learned'?10: n.group==='memory-atom'?5.5:6;
  function updateSize(){
    const b=canvas.getBoundingClientRect();
    if(!b.width||!b.height)return;
    const dpr=Math.min(devicePixelRatio||1,2);
    size={w:b.width,h:b.height};
    canvas.width=Math.round(b.width*dpr);canvas.height=Math.round(b.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
  }
  function drawRequest() {
    if(raf||!alive)return;
    raf=requestAnimationFrame(()=>{raf=0;draw();});
  }
  function neighbours(node) {
    if(!node)return new Set();
    const ids=new Set([node.id]);
    for(const l of links) {
      if(nodes[l.a].id===node.id)ids.add(nodes[l.b].id);
      if(nodes[l.b].id===node.id)ids.add(nodes[l.a].id);
    }
    return ids;
  }
  function draw(){
    if(!alive||!size.w||!size.h)return;
    ctx.clearRect(0,0,size.w,size.h);
    const grad=ctx.createRadialGradient(size.w*.5,size.h*.4,8,size.w*.5,size.h*.5,Math.max(size.w,size.h));
    grad.addColorStop(0,'#141d24');grad.addColorStop(1,'#0d1118');
    ctx.fillStyle=grad;ctx.fillRect(0,0,size.w,size.h);
    ctx.save();ctx.translate(size.w/2+view.x,size.h/2+view.y);ctx.scale(view.scale,view.scale);
    const focus=selected||hovered;
    const near=neighbours(focus);
    for(const e of links){
      const a=nodes[e.a],b=nodes[e.b],active=focus&&(a.id===focus.id||b.id===focus.id);
      const faded=focus&&!active;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      ctx.strokeStyle=active?'rgba(126,224,180,.83)':faded?'rgba(132,144,159,.055)':'rgba(133,156,163,.22)';
      ctx.lineWidth=(active?1.8:.8)/Math.sqrt(Math.max(.5,view.scale));
      ctx.stroke();
    }
    const minLabel=view.scale>=.73;
    ctx.textAlign='center';ctx.textBaseline='top';
    for(const n of nodes){
      const matched=!query||([n.name,n.topic,n.content].join(' ').toLowerCase().includes(query));
      const dim=(query&&!matched)||(focus&&!near.has(n.id));
      const main=n.group==='learned';
      const r=radius(n)+(selected===n?3:hovered===n?2:0);
      ctx.globalAlpha=dim?.18:1;
      if(main || selected===n || hovered===n){
        ctx.beginPath();ctx.arc(n.x,n.y,r+5,0,Math.PI*2);
        ctx.fillStyle=main?'rgba(126,224,180,.095)':'rgba(255,255,255,.065)';ctx.fill();
      }
      ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle=color(n);ctx.fill();
      if(selected===n){ctx.strokeStyle='#fff';ctx.lineWidth=1.8;ctx.stroke();}
      if(main||selected===n||hovered===n||(minLabel&&n.weight>=2)){
        ctx.font=(main?'700 ':'500 ')+(main?'12':'10')+'px Nunito, sans-serif';
        ctx.fillStyle=main?'#eef1ef':'#b7bfc9';
        const label=String(n.name).replace(/\s+/g,' ').slice(0,main?24:26);
        ctx.fillText(label,n.x,n.y+r+7);
      }
      ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  function world(px,py){return {x:(px-size.w/2-view.x)/view.scale,y:(py-size.h/2-view.y)/view.scale};}
  function pointer(e){
    const rect=canvas.getBoundingClientRect();
    return {x:e.clientX-rect.left,y:e.clientY-rect.top};
  }
  function pick(pos){
    const p=world(pos.x,pos.y);
    let found=null,best=Infinity;
    for(const n of nodes){
      const dist=Math.hypot(p.x-n.x,p.y-n.y);
      const hit=radius(n)+Math.max(5,8/view.scale);
      if(dist<hit&&dist<best){found=n;best=dist;}
    }
    return found;
  }
  function fit(){
    if(!nodes.length){view={x:0,y:0,scale:1};drawRequest();return;}
    const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const contentW=Math.max(120,maxX-minX+110),contentH=Math.max(100,maxY-minY+110);
    view.scale=clamp(Math.min((size.w-42)/contentW,(size.h-50)/contentH),.26,2.3);
    view.x=-(minX+maxX)/2*view.scale;
    view.y=-(minY+maxY)/2*view.scale;drawRequest();
  }
  function zoom(mult,position={x:size.w/2,y:size.h/2}){
    const before=world(position.x,position.y);
    view.scale=clamp(view.scale*mult,.14,4);
    view.x=position.x-size.w/2-before.x*view.scale;
    view.y=position.y-size.h/2-before.y*view.scale;drawRequest();
  }
  function selectNode(node){
    selected=node;
    if(details){
      if(!node)details.innerHTML='<div class="graph-detail-empty">Selecione uma memória para ver seus vínculos e a origem.</div>';
      else{
        const related=new Set();
        for(const e of links){
          if(nodes[e.a].id===node.id)related.add(nodes[e.b].name);
          if(nodes[e.b].id===node.id)related.add(nodes[e.a].name);
        }
        details.innerHTML='<div class="graph-detail-kicker">'+(node.group==='learned'?'MEMÓRIA':node.group==='memory-atom'?'FRAGMENTO':'RECURSO')+'</div>'
        +'<h3>'+safe(node.name)+'</h3>'
        +(node.topic&&node.topic!==node.name?'<p class="graph-detail-topic">'+safe(node.topic)+'</p>':'')
        +(node.content?'<p class="graph-detail-content">'+safe(node.content)+'</p>':'')
        +(node.file?'<div class="graph-detail-source"><span>ORIGEM</span><code>'+safe(node.file)+(node.line?':'+node.line:'')+'</code></div>':'')
        +'<div class="graph-detail-source"><span>LIGAÇÕES CONFIRMADAS ('+related.size+')</span><div>'+[...related].slice(0,14).map(x=>'<span class="graph-link-chip">'+safe(x.slice(0,32))+'</span>').join('')+(related.size>14?'<small>+'+(related.size-14)+' outras</small>':'')+'</div></div>';
      }
    }
    drawRequest();
  }
  function down(e) {
    canvas.setPointerCapture(e.pointerId);
    const pos=pointer(e);
    pointers.set(e.pointerId,pos);
    if(pointers.size===1){
      dragged=pick(pos);dragPan=!dragged;moved=false;lastPinch=null;
    }else{dragged=null;lastPinch=null;}
  }
  function move(e){
    const pos=pointer(e);
    if(pointers.has(e.pointerId)){
      const old=pointers.get(e.pointerId);
      pointers.set(e.pointerId,pos);
      if(pointers.size===2){
        const pp=[...pointers.values()];
        const dist=Math.hypot(pp[0].x-pp[1].x,pp[0].y-pp[1].y);
        const center={x:(pp[0].x+pp[1].x)/2,y:(pp[0].y+pp[1].y)/2};
        if(lastPinch&&dist>5)zoom(dist/lastPinch.dist,center);
        lastPinch={dist,center};moved=true;
      }else if(pointers.size===1&&e.buttons!==0){
        const dx=pos.x-old.x,dy=pos.y-old.y;
        if(Math.abs(dx)+Math.abs(dy)>2)moved=true;
        if(dragged){dragged.x+=dx/view.scale;dragged.y+=dy/view.scale;drawRequest();}
        else if(dragPan){view.x+=dx;view.y+=dy;drawRequest();}
      }
    }else if(e.pointerType==='mouse'){
      const hit=pick(pos);
      if(hit!==hovered){hovered=hit;canvas.style.cursor=hit?'pointer':'grab';drawRequest();}
    }
  }
  function up(e){
    const was=dragged;
    const pos=pointer(e);
    if(pointers.size===1&&!moved)selectNode(was||pick(pos));
    pointers.delete(e.pointerId);
    dragged=null;dragPan=false;lastPinch=null;
  }
  function wheel(e){
    e.preventDefault();
    zoom(e.deltaY>0?.87:1.14,pointer(e));
  }
  function setQuery(value){query=String(value||'').toLowerCase().trim();drawRequest();}
  function onResize(){updateSize();fit();}
  canvas.addEventListener('pointerdown',down);
  canvas.addEventListener('pointermove',move);
  canvas.addEventListener('pointerup',up);
  canvas.addEventListener('pointercancel',up);
  canvas.addEventListener('wheel',wheel,{passive:false});
  const observer=new ResizeObserver(onResize);
  observer.observe(canvas);
  updateSize();fit();
  return {
    fit,zoom,setQuery,
    destroy(){
      alive=false;observer.disconnect();
      if(raf)cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown',down);
      canvas.removeEventListener('pointermove',move);
      canvas.removeEventListener('pointerup',up);
      canvas.removeEventListener('pointercancel',up);
      canvas.removeEventListener('wheel',wheel);
    },
  };
}
