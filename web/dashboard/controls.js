// Accessible, portal-based select. Keeps the original <select> as the form's
// source of truth; the search box only appears on long lists.
const SEARCH_FROM = 8;
let open = null;
const esc = x => String(x ?? '');
function hide() {
  if (!open) return;
  open.button.setAttribute('aria-expanded', 'false');
  open.pop.remove();
  open = null;
}
function projectLabel(select) {
  return select.getAttribute('aria-label') ||
    select.closest('.field')?.querySelector('span')?.textContent ||
    'Selecionar opção';
}
function place(pop, button) {
  const r=button.getBoundingClientRect();
  const width=Math.max(r.width,Math.min(360,innerWidth-20));
  const x=Math.max(10,Math.min(r.left,innerWidth-width-10));
  const roomBelow=innerHeight-r.bottom;
  pop.style.width=width+'px';
  pop.style.left=x+'px';
  pop.style.top=(roomBelow>240?r.bottom+6:Math.max(10,r.top-Math.min(370,r.top-10)-6))+'px';
  pop.style.maxHeight=Math.min(365, Math.max(180,roomBelow>240?roomBelow-16:r.top-20))+'px';
}
function show(select,button) {
  if(open?.button===button){hide();return;}
  hide();
  const id='fx-options-'+Math.random().toString(36).slice(2);
  const pop=document.createElement('div');
  pop.id=id;pop.className='fx-select-pop';pop.setAttribute('role','listbox');
  pop.setAttribute('aria-label',projectLabel(select));
  const all=[...select.options].map(opt=>({value:opt.value,text:opt.text,disabled:opt.disabled}));
  const search=document.createElement('input');
  search.type='search';search.autocomplete='off';search.className='fx-select-search';
  search.placeholder=select.id==='project-select'?'Buscar projeto…':'Filtrar opções…';
  search.setAttribute('aria-label','Pesquisar opções');
  const items=document.createElement('div');items.className='fx-select-list';
  const searchable=all.length>=SEARCH_FROM;
  if(searchable)pop.append(search);
  pop.append(items);pop.tabIndex=-1;
  document.body.append(pop);
  const state={select,button,pop,search,items,index:0,filtered:all};
  open=state;
  button.setAttribute('aria-expanded','true');
  button.setAttribute('aria-controls',id);
  function paint() {
    const q=search.value.trim().toLocaleLowerCase('pt-BR');
    state.filtered=all.filter(x=>x.text.toLocaleLowerCase('pt-BR').includes(q));
    state.index=Math.max(0,Math.min(state.index,state.filtered.length-1));
    items.replaceChildren();
    if(!state.filtered.length){const msg=document.createElement('p');msg.className='fx-select-empty';msg.textContent='Nenhuma opção encontrada';items.append(msg);return;}
    for(let i=0;i<state.filtered.length;i++){
      const x=state.filtered[i];
      const opt=document.createElement('button');
      opt.type='button';opt.className='fx-option';
      if(x.value===select.value)opt.classList.add('selected');
      if(i===state.index)opt.classList.add('focused');
      opt.setAttribute('role','option');opt.setAttribute('aria-selected',String(x.value===select.value));
      opt.disabled=x.disabled;
      opt.textContent=x.text;
      opt.addEventListener('mouseenter',()=>{state.index=i;paintFocus()});
      opt.addEventListener('click',()=>choose(i));
      items.append(opt);
    }
  }
  function paintFocus(){
    for(const [i,node] of [...items.children].entries())node.classList.toggle('focused',i===state.index);
  }
  function choose(i){
    const opt=state.filtered[i];
    if(!opt||opt.disabled)return;
    hide();
    select.value=opt.value;
    button.querySelector('.fx-selected-label').textContent=opt.text;
    // Focus first: a change handler may re-render and restore focus by field.
    button.focus();
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  search.addEventListener('input',()=>{state.index=0;paint()});
  pop.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();hide();button.focus();}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();if(!state.filtered.length)return;
      state.index=(state.index+(e.key==='ArrowDown'?1:-1)+state.filtered.length)%state.filtered.length;
      paintFocus();items.children[state.index]?.scrollIntoView({block:'nearest'});
    }
    if(e.key==='Enter'){e.preventDefault();choose(state.index);}
  });
  state.index=Math.max(0,all.findIndex(x=>x.value===select.value));
  place(pop,button);paint();(searchable?search:pop).focus();
  items.children[state.index]?.scrollIntoView({block:'nearest'});
}
export function enhanceSelects(root=document){
  for(const select of root.querySelectorAll('select:not([data-enhanced])')){
    select.dataset.enhanced='true';
    select.classList.add('fx-native-select');
    select.tabIndex=-1;
    select.setAttribute('aria-hidden','true');
    const trigger=document.createElement('button');
    trigger.type='button';
    trigger.className='fx-select-trigger';
    trigger.setAttribute('role','combobox');
    trigger.setAttribute('aria-label',projectLabel(select));
    trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-haspopup','listbox');
    const label=document.createElement('span');label.className='fx-selected-label';
    label.textContent=select.selectedOptions[0]?.textContent||'Selecionar';
    const chevron=document.createElement('span');chevron.className='fx-chevron';chevron.setAttribute('aria-hidden','true');
    chevron.textContent='';
    trigger.append(label,chevron);
    select.insertAdjacentElement('afterend',trigger);
    trigger.addEventListener('click',()=>show(select,trigger));
    trigger.addEventListener('keydown',e=>{
      if(['ArrowDown','ArrowUp',' ','Enter'].includes(e.key)){e.preventDefault();show(select,trigger);}
      if(e.key==='Escape')hide();
    });
  }
  if(open&&!open.button.isConnected)hide();
}
document.addEventListener('pointerdown',e=>{
  if(open&&!open.pop.contains(e.target)&&!open.button.contains(e.target))hide();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.preventDefault();hide();}});
window.addEventListener('resize',()=>{if(open)place(open.pop,open.button)});
document.addEventListener('scroll',()=>{if(open)place(open.pop,open.button)},true);
