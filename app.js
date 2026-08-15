(() => {
'use strict';
const D = window.CNC_DATA;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => a+(b-a)*clamp(t,0,1);
const round = (v,d=0) => { const p=10**d; return Math.round(v*p)/p; };
const uid = () => (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const deep = x => JSON.parse(JSON.stringify(x));
const store = {
  get(k,fallback){ try{ const v=localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }catch{return fallback;} },
  set(k,v){ localStorage.setItem(k,JSON.stringify(v)); }
};
const KEYS={machine:'cncFullMachineV1',tools:'cncFullToolsV1',projects:'cncFullProjectsV1',draft:'cncFullDraftV1'};

const state={
  view:'work',step:1,
  machine:store.get(KEYS.machine,deep(D.machineDefault)),
  materialId:'aisi304',
  stock:{diameter:50,length:100,unit:'mm',hardness:180},
  route:[],strategy:'work',coolant:'emulsion',rigidity:'medium',results:[],projectId:null
};
const savedDraft=store.get(KEYS.draft,null);
if(savedDraft){ try{Object.assign(state,savedDraft); state.machine=store.get(KEYS.machine,state.machine||deep(D.machineDefault)); state.results=[];}catch{} }

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1900)}
function transition(fn){if(document.startViewTransition){document.startViewTransition(fn)}else fn()}
function saveDraft(){const copy=deep(state);copy.results=[];store.set(KEYS.draft,copy)}
function allTools(){return [...D.tools,...store.get(KEYS.tools,[])]}
function projects(){return store.get(KEYS.projects,[])}
function saveProjects(v){store.set(KEYS.projects,v);renderProjects()}
function material(){return D.materials.find(x=>x.id===state.materialId)||D.materials[0]}
function operation(id){return D.operations.find(x=>x.id===id)}
function stockMm(){const mul=state.stock.unit==='cm'?10:1;return{diameter:Math.max(.1,state.stock.diameter*mul),length:Math.max(.1,state.stock.length*mul)}}
function effectiveMaxRpm(){const m=state.machine;return m.setupMaxRpm?Math.min(m.maxRpm,m.setupMaxRpm):m.maxRpm}
function modeT(){return state.strategy==='safe'?.20:state.strategy==='productive'?.80:.50}
function rangeValue(arr,t=modeT()){if(!arr)return 0; if(t<=.5)return lerp(arr[0],arr[1],t*2); return lerp(arr[1],arr[2],(t-.5)*2)}
function passKey(opId,pass){if(opId==='thread_ext'||opId==='thread_int')return'thread';if(pass==='finish')return'finish';if(opId==='od')return'rough';return opId}

function navView(name){
  transition(()=>{
    state.view=name;
    $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
    $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  });
  if(name==='tools')renderTools(); if(name==='projects')renderProjects(); if(name==='reference')renderReference();
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>navView(b.dataset.view)));

function goStep(n){
  n=clamp(+n,1,5);state.step=n;
  transition(()=>{
    $$('[data-step-panel]').forEach(p=>p.classList.toggle('active',+p.dataset.stepPanel===n));
    $$('#stepper [data-step]').forEach(b=>{const s=+b.dataset.step;b.classList.toggle('active',s===n);b.classList.toggle('done',s<n)});
    $('#stepCaption').textContent=`Шаг ${n} из 5`;
  });
  const active=$(`#stepper [data-step="${n}"]`);active?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
  saveDraft();
  setTimeout(()=>window.scrollTo({top:Math.max(0,$('.wizard-wrap').offsetTop-82),behavior:'smooth'}),50);
}
$$('[data-next-step]').forEach(b=>b.addEventListener('click',()=>goStep(b.dataset.nextStep)));
$$('#stepper [data-step]').forEach(b=>b.addEventListener('click',()=>goStep(b.dataset.step)));

function syncMachineUI(){
  const m=state.machine;
  $('#machineNameTitle').textContent=m.name;$('#machineMaxRpm').value=m.maxRpm;$('#machineKw').value=m.spindleKw;$('#machineEff').value=m.efficiency;
  $('#setupMaxRpm').value=m.setupMaxRpm||'';$('#tailstockMExtend').value=m.tailstockMExtend||'';$('#tailstockMRetract').value=m.tailstockMRetract||'';
  $('#topMachine').textContent=`${m.name.replace('Tengyue ','')} · 828D`;
}
$('#saveMachineProfile').addEventListener('click',()=>{
  state.machine.maxRpm=Math.max(100,+$('#machineMaxRpm').value||4000);state.machine.spindleKw=Math.max(1,+$('#machineKw').value||11);state.machine.efficiency=clamp(+$('#machineEff').value||.85,.5,1);
  state.machine.setupMaxRpm=$('#setupMaxRpm').value?Math.max(100,+$('#setupMaxRpm').value):null;state.machine.tailstockMExtend=$('#tailstockMExtend').value.trim();state.machine.tailstockMRetract=$('#tailstockMRetract').value.trim();
  store.set(KEYS.machine,state.machine);syncMachineUI();saveDraft();toast('Профиль станка сохранён локально');
});
$('#projectName').addEventListener('input',saveDraft);

function renderMaterials(){
  const box=$('#materialGrid');
  box.innerHTML=D.materials.map(m=>`<button class="material-card ${m.id===state.materialId?'selected':''}" data-material="${m.id}"><i>ISO ${m.iso}</i><b>${m.short}</b><span>${m.name}</span></button>`).join('');
  box.querySelectorAll('[data-material]').forEach(b=>b.addEventListener('click',()=>{
    state.materialId=b.dataset.material;state.stock.hardness=material().hb;$('#stockHardness').value=state.stock.hardness;renderMaterials();updateMaterialInfo();saveDraft();
  }));
  $('#selectedIso').textContent=`ISO ${material().iso}`;
}
function updateMaterialInfo(){
  const m=material();$('#materialNote').innerHTML=`<b>${m.name}</b> · ${m.note}`;$('#selectedIso').textContent=`ISO ${m.iso}`;
  updateSlenderness();
}
function readStock(){state.stock.diameter=Math.max(.1,+$('#stockDiameter').value||.1);state.stock.length=Math.max(.1,+$('#stockLength').value||.1);state.stock.unit=$('#stockUnit').value;state.stock.hardness=Math.max(1,+$('#stockHardness').value||material().hb);updateSlenderness();saveDraft()}
['stockDiameter','stockLength','stockUnit','stockHardness'].forEach(id=>$('#'+id).addEventListener('input',readStock));
function syncStockUI(){ $('#stockDiameter').value=state.stock.diameter;$('#stockLength').value=state.stock.length;$('#stockUnit').value=state.stock.unit;$('#stockHardness').value=state.stock.hardness;updateMaterialInfo(); }
function updateSlenderness(){
  const s=stockMm(),ratio=s.length/s.diameter;let title='Жёсткая заготовка',desc='По отношению L/D дополнительная опора обычно не требуется.',cls='';
  if(ratio>=4){title='Задняя бабка настоятельно рекомендуется';desc='L/D высокий. Для наружного точения добавь центровку и опору, если геометрия детали позволяет.';cls='warn'}
  else if(ratio>=3){title='Проверь необходимость задней бабки';desc='L/D уже чувствителен к вылету. Copilot отметит операции, где опора полезна.';cls='warn'}
  $('#slendernessCard').innerHTML=`<div class="ratio">L/D ${ratio.toFixed(2)}</div><div><b>${title}</b><span>${desc}</span></div>`;$('#slendernessCard').classList.toggle('warn',!!cls);
}

function makeRoute(opId){
  const s=stockMm(),op=operation(opId);const base={uid:uid(),opId,pass:op.defaultPass,toolId:'auto',diameter:s.diameter,targetDiameter:round(s.diameter*.86,2),depth:round(s.length*.5,1),pitch:2,width:3,threadSize:'M16'};
  if(opId==='bore'){base.diameter=round(s.diameter*.45,2);base.targetDiameter=round(s.diameter*.55,2)}
  if(opId==='drill'){base.diameter=12;base.depth=Math.min(s.length,30)}
  if(opId==='center'){base.diameter=4;base.depth=2}
  if(opId==='groove'){base.depth=2;base.width=3}
  if(opId==='part'){base.width=3;base.depth=round(s.diameter/2,1)}
  if(opId==='thread_ext'){base.diameter=Math.min(16,s.diameter);base.pitch=2;base.threadSize='M16'}
  if(opId==='thread_int'){base.diameter=Math.min(16,s.diameter*.5);base.pitch=2;base.threadSize='M16'}
  return base;
}
function renderOperationCatalog(){
  $('#operationCatalog').innerHTML=D.operations.map(o=>`<button class="op-add" data-add-op="${o.id}"><strong>${o.icon}</strong><b>${o.name}</b><span>${o.description}</span></button>`).join('');
  $$('[data-add-op]').forEach(b=>b.addEventListener('click',()=>{state.route.push(makeRoute(b.dataset.addOp));renderRoute();saveDraft();toast(`${operation(b.dataset.addOp).name} добавлена`)}));
}
function toolOptions(route){
  const op=operation(route.opId),m=material(),tools=allTools();
  const filtered=tools.filter(t=>t.iso.includes(m.iso)&&t.ops.some(x=>op.toolOps.includes(x)));
  return `<option value="auto">Автоподбор Copilot</option>`+filtered.map(t=>`<option value="${t.id}" ${route.toolId===t.id?'selected':''}>${t.holder} · ${t.insert}</option>`).join('');
}
function opFields(r){
  const dia=`<label class="field">Ø расчёта, мм<input data-rid="${r.uid}" data-rfield="diameter" type="number" step="0.1" min="0.1" value="${r.diameter}"></label>`;
  if(r.opId==='od')return dia+`<label class="field">Ø после, мм<input data-rid="${r.uid}" data-rfield="targetDiameter" type="number" step="0.1" value="${r.targetDiameter}"></label>`;
  if(r.opId==='bore')return dia+`<label class="field">Ø расточить до, мм<input data-rid="${r.uid}" data-rfield="targetDiameter" type="number" step="0.1" value="${r.targetDiameter}"></label>`;
  if(r.opId==='groove')return dia+`<label class="field">Ширина, мм<input data-rid="${r.uid}" data-rfield="width" type="number" step="0.1" value="${r.width}"></label>`;
  if(r.opId==='part')return dia+`<label class="field">Пластина, мм<input data-rid="${r.uid}" data-rfield="width" type="number" step="0.1" value="${r.width}"></label>`;
  if(r.opId==='drill'||r.opId==='center')return dia+`<label class="field">Глубина, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" value="${r.depth}"></label>`;
  if(r.opId.startsWith('thread'))return dia+`<label class="field">Шаг P, мм<input data-rid="${r.uid}" data-rfield="pitch" type="number" step="0.05" value="${r.pitch}"></label>`;
  return dia+`<label class="field">Глубина/длина, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" value="${r.depth}"></label>`;
}
function renderRoute(){
  $('#routeCount').textContent=`${state.route.length} ${state.route.length===1?'операция':'операций'}`;$('#routeEmpty').classList.toggle('hidden',state.route.length>0);
  const box=$('#routeList');
  box.innerHTML=state.route.map((r,i)=>{const op=operation(r.opId);return `<article class="route-item glass" data-route="${r.uid}"><div class="route-order">${i+1}</div><div class="route-main"><h4>${op.icon} ${op.name}</h4><p>${op.description}</p>${op.supportsPass?`<div class="pass-switch"><button data-pass="rough" data-rid="${r.uid}" class="${r.pass==='rough'?'active':''}">Черновая</button><button data-pass="finish" data-rid="${r.uid}" class="${r.pass==='finish'?'active':''}">Чистовая</button><button data-pass="both" data-rid="${r.uid}" class="${r.pass==='both'?'active':''}">Черновая + чистовая</button></div>`:''}<div class="route-controls">${opFields(r)}<label class="field tool-field">Инструмент<select data-rid="${r.uid}" data-rfield="toolId">${toolOptions(r)}</select></label></div></div><div class="route-actions"><button data-up="${r.uid}" title="Выше">↑</button><button data-down="${r.uid}" title="Ниже">↓</button><button data-remove="${r.uid}" title="Удалить">×</button></div></article>`}).join('');
  box.querySelectorAll('[data-pass]').forEach(b=>b.addEventListener('click',()=>{const r=state.route.find(x=>x.uid===b.dataset.rid);r.pass=b.dataset.pass;renderRoute();saveDraft()}));
  box.querySelectorAll('[data-rfield]').forEach(el=>el.addEventListener('input',()=>{const r=state.route.find(x=>x.uid===el.dataset.rid);r[el.dataset.rfield]=el.dataset.rfield==='toolId'?el.value:(+el.value||0);saveDraft()}));
  box.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{state.route=state.route.filter(x=>x.uid!==b.dataset.remove);renderRoute();saveDraft()}));
  box.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>moveRoute(b.dataset.up,-1)));box.querySelectorAll('[data-down]').forEach(b=>b.addEventListener('click',()=>moveRoute(b.dataset.down,1)));
}
function moveRoute(id,dir){const i=state.route.findIndex(x=>x.uid===id),j=i+dir;if(i<0||j<0||j>=state.route.length)return;[state.route[i],state.route[j]]=[state.route[j],state.route[i]];renderRoute();saveDraft()}
$('#toStrategyBtn').addEventListener('click',()=>{if(!state.route.length){toast('Сначала добавь хотя бы одну операцию');return}goStep(4);renderPreflight()});

$$('#strategySwitch [data-strategy]').forEach(b=>b.addEventListener('click',()=>{state.strategy=b.dataset.strategy;$$('#strategySwitch [data-strategy]').forEach(x=>x.classList.toggle('active',x===b));renderPreflight();saveDraft()}));
$('#coolant').addEventListener('change',()=>{state.coolant=$('#coolant').value;saveDraft()});$('#rigidity').addEventListener('change',()=>{state.rigidity=$('#rigidity').value;renderPreflight();saveDraft()});
function renderPreflight(){
  const s=stockMm(),ratio=s.length/s.diameter,m=state.machine,max=effectiveMaxRpm();const rows=[];
  rows.push({ok:true,t:`Станок: ${m.name}, лимит расчёта ${max} rpm, ${m.spindleKw} kW`});
  rows.push({ok:true,t:`Материал: ${material().name} · ISO ${material().iso} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм`});
  rows.push({ok:state.route.length>0,t:`Маршрут: ${state.route.length} операций`});
  if(ratio>=3)rows.push({ok:false,t:`L/D ${ratio.toFixed(2)} — проверь заднюю бабку и центровку для длинных наружных проходов.`});
  if(!m.setupMaxRpm)rows.push({ok:false,t:'Лимит текущего патрона/кулачков не задан — используется максимум станка.'});
  $('#preflight').innerHTML=rows.map(r=>`<div class="preflight-row ${r.ok?'':'warn'}"><i>${r.ok?'✓':'!'}</i><span>${r.t}</span></div>`).join('');
}

function recommendTool(route,pass){
  const op=operation(route.opId),iso=material().iso,tools=allTools();
  if(route.toolId!=='auto'){const manual=tools.find(t=>t.id===route.toolId);if(manual)return manual}
  let c=tools.filter(t=>t.iso.includes(iso)&&t.ops.some(x=>op.toolOps.includes(x)));
  if(pass==='rough')c=c.filter(t=>!t.passes||t.passes.includes('rough')||t.ops.includes('rough'));
  if(pass==='finish')c=c.filter(t=>!t.passes||t.passes.includes('finish')||t.ops.includes('finish'));
  c.sort((a,b)=>(+b.verified-+a.verified)+((b.passes?.includes(pass)?1:0)-(a.passes?.includes(pass)?1:0)));
  return c[0]||tools.find(t=>t.iso.includes(iso))||tools[0];
}
function calcPass(route,pass){
  const op=operation(route.opId),m=material(),machine=state.machine,key=passKey(route.opId,pass),r=m.ranges[key]||m.ranges.rough,t=modeT();
  let vc=rangeValue(r.vc,t),f=rangeValue(r.f,t),ap=rangeValue(r.ap,t);const dia=Math.max(.1,+route.diameter||stockMm().diameter);const tool=recommendTool(route,pass);
  const hardnessRatio=(state.stock.hardness||m.hb)/m.hb;if(hardnessRatio>1.05)vc/=Math.pow(hardnessRatio,.42);else if(hardnessRatio<.9)vc*=Math.min(1.08,Math.pow(1/hardnessRatio,.12));
  if(state.coolant==='dry'&&m.iso==='M')vc*=.82;else if(state.coolant==='oil'&&m.iso==='M')vc*=.96;
  if(state.rigidity==='low'){vc*=.88;f*=.90;ap*=.68}else if(state.rigidity==='high'){f*=1.04;ap*=1.08}
  if(pass==='finish'){ap=Math.min(ap,Math.max(.15,Math.abs((+route.diameter||dia)-(+route.targetDiameter||dia))*.3||ap))}
  let threadDepth=null,threadPasses=null;
  if(route.opId.startsWith('thread')){f=Math.max(.1,+route.pitch||1.5);threadDepth=.6134*f;ap=clamp(rangeValue(r.ap,t),.08,Math.max(.1,threadDepth*.45));threadPasses=Math.max(3,Math.ceil(threadDepth/ap)+2)}
  const rawRpm=1000*vc/(Math.PI*dia),limit=effectiveMaxRpm();let rpm=Math.min(rawRpm,limit),actualVc=Math.PI*dia*rpm/1000;
  let q=ap*f*actualVc;let pc=m.kc*q/60000; if(['groove','part'].includes(route.opId))pc*=Math.max(1,(+route.width||3)/2); if(['drill','center'].includes(route.opId))pc*=.65;
  let motor=pc/Math.max(.5,machine.efficiency||.85),powerLimited=false;
  if(motor>machine.spindleKw*.88 && ['od','face','bore'].includes(route.opId) && pass!=='finish'){
    const scale=clamp((machine.spindleKw*.78)/motor,.35,1);ap*=scale;q=ap*f*actualVc;pc=m.kc*q/60000;motor=pc/(machine.efficiency||.85);powerLimited=true;
  }
  let ra=null;if(tool.nose>0&&['od','face','bore'].includes(route.opId)){ra=(f*f/(32*tool.nose))*1000}
  const tailstock=shouldUseTailstock(route);
  const trial={rpm:round(rpm*(route.opId.startsWith('thread')?.86:.90)),f:round(route.opId.startsWith('thread')?f:f*.84,3),ap:round(ap*(route.opId.startsWith('thread')?.75:.55),3)};trial.vc=round(Math.PI*dia*trial.rpm/1000,1);
  return {id:`${route.uid}:${pass}`,routeUid:route.uid,opId:route.opId,pass,diameter:dia,toolId:tool.id,tool:deep(tool),vc:round(actualVc,1),targetVc:round(vc,1),rpm:round(rpm),rawRpm:round(rawRpm),f:round(f,3),ap:round(ap,3),power:round(motor,2),powerPct:round(motor/machine.spindleKw*100),ra:ra==null?null:round(ra,2),rpmLimited:rawRpm>limit,powerLimited,threadDepth:threadDepth==null?null:round(threadDepth,3),threadPasses,trial,verified:false,revision:0,lastFeedback:null,tailstock,range:deep(r)};
}
function shouldUseTailstock(route){const s=stockMm(),ratio=s.length/s.diameter;return state.machine.tailstock&&ratio>=3&&['od'].includes(route.opId)}
function calculateRoute(){
  state.results=state.route.map(route=>{const op=operation(route.opId),passes=op.supportsPass?(route.pass==='both'?['rough','finish']:[route.pass]):['single'];return{routeUid:route.uid,opId:route.opId,name:op.name,passes:passes.map(p=>calcPass(route,p))}});
}
function animateOverlay(){return new Promise(resolve=>{
  const ov=$('#calcOverlay'),a=$('#spinDigitA'),b=$('#spinDigitB');ov.classList.remove('hidden');let n=0;const start=performance.now();
  function frame(ts){const t=(ts-start)/1250;n++;a.textContent=String(Math.floor(400+Math.random()*3200)).padStart(4,'0');b.textContent=(Math.random()*.5).toFixed(3);$('#heroRpm').textContent=a.textContent;if(t<1)requestAnimationFrame(frame);else{setTimeout(()=>{ov.classList.add('hidden');resolve()},160)}}requestAnimationFrame(frame);
  });}
$('#calculateAllBtn').addEventListener('click',async()=>{if(!state.route.length){toast('Маршрут пуст');return}readStock();state.coolant=$('#coolant').value;state.rigidity=$('#rigidity').value;await animateOverlay();calculateRoute();renderResults(true);goStep(5);saveDraft()});

function toolSvg(tool,idSeed='x'){
  const tone=tool.art?.tone||'steel',shape=tool.art?.shape||'wnmg';const colors={gold:['#f7d98b','#b98325','#5b3d0d'],bronze:['#e0a25d','#9a562d','#4a261b'],silver:['#dbe5eb','#778791','#303b42'],steel:['#aebac2','#5f707b','#26323a']}[tone]||['#dbe5eb','#778791','#303b42'];
  const gid='g'+String(idSeed).replace(/[^a-z0-9]/gi,'');let insert='';
  if(shape==='wnmg')insert=`<polygon points="58,12 91,36 75,66 36,66 20,36" fill="url(#${gid})" stroke="#f5e1a6" stroke-width="2"/><polygon points="58,22 79,37 68,56 43,56 31,37" fill="#3f2f18" opacity=".55"/><circle cx="56" cy="39" r="8" fill="#111820" stroke="#ddc27f"/>`;
  else if(shape==='ccmt')insert=`<polygon points="37,16 88,27 79,64 28,53" fill="url(#${gid})" stroke="#f4e0a1" stroke-width="2"/><circle cx="58" cy="40" r="8" fill="#111820" stroke="#d8bf79"/>`;
  else if(shape==='dcmt')insert=`<polygon points="20,40 57,14 94,40 57,62" fill="url(#${gid})" stroke="#e9eef1" stroke-width="2"/><circle cx="57" cy="39" r="7" fill="#111820"/>`;
  else if(shape==='mgmn')insert=`<rect x="39" y="20" width="38" height="38" rx="5" fill="url(#${gid})" stroke="#f2d083" stroke-width="2"/><rect x="49" y="29" width="18" height="20" rx="3" fill="#4b3515"/>`;
  else if(shape==='thread')insert=`<polygon points="27,55 57,16 87,55" fill="url(#${gid})" stroke="#f3d68e" stroke-width="2"/><circle cx="57" cy="42" r="6" fill="#171c20"/>`;
  else if(shape==='drill')return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" x2="1"><stop stop-color="${colors[0]}"/><stop offset=".45" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs><g transform="translate(12 8) rotate(-8 50 30)"><rect x="10" y="24" width="90" height="18" rx="9" fill="url(#${gid})"/><path d="M18 25 C34 49 45 18 60 42 S84 18 98 39" fill="none" stroke="#27323a" stroke-width="5" opacity=".65"/><polygon points="98,24 113,33 98,42" fill="${colors[0]}"/></g></svg>`;
  return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" x2="1"><stop stop-color="${colors[0]}"/><stop offset=".5" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs><g transform="translate(3 3)"><path d="M3 58 L47 48 L75 55 L116 47 L116 68 L74 73 L45 66 L3 70Z" fill="#596671"/><path d="M3 58 L47 48 L75 55 L116 47" fill="none" stroke="#96a3ac" stroke-width="3"/>${insert}</g></svg>`;
}
function animateNumber(el,to,dec=0){const from=0,start=performance.now(),dur=650+Math.random()*280;function tick(ts){const p=clamp((ts-start)/dur,0,1),e=1-Math.pow(1-p,4),v=from+(to-from)*e;el.textContent=dec?v.toFixed(dec):Math.round(v);if(p<1)requestAnimationFrame(tick)}requestAnimationFrame(tick)}
function passLabel(p){return p==='rough'?'Черновой проход':p==='finish'?'Чистовой проход':'Рабочий проход'}
function sinumerikNote(res){const route=state.route.find(x=>x.uid===res.routeUid),op=operation(res.opId),max=effectiveMaxRpm();let extra='';
  if(res.opId.startsWith('thread'))extra=`Резьба: P ${route.pitch} мм · ориентир ${res.threadPasses} проходов · радиальная глубина профиля ≈ ${res.threadDepth} мм.`;
  if(res.tailstock)extra+=` Задняя бабка: Разное → Установки → Задняя бабка = Да; задай XRR. ${state.machine.tailstockMExtend?`OEM подвод: ${state.machine.tailstockMExtend}.`:''}`;
  return `${op.shopturn} ${extra} Лимит шпинделя для расчёта: ${max} rpm.`;
}
function resultPassHtml(res,idx){
  const t=res.tool;const trial=res.trial;return `<div class="pass-block" data-pass-id="${res.id}"><div class="pass-head"><b>${passLabel(res.pass)}</b><span>${res.verified?'✓ подтверждён на станке':`версия режима ${res.revision+1}`}</span></div><div class="metric-grid"><div class="metric rpm"><small>S · ШПИНДЕЛЬ</small><b data-anim="${res.rpm}" data-dec="0">0</b><span>rpm</span></div><div class="metric feed"><small>f · ПОДАЧА</small><b data-anim="${res.f}" data-dec="3">0.000</b><span>mm/rev</span></div><div class="metric vc"><small>Vc · ФАКТ.</small><b data-anim="${res.vc}" data-dec="1">0.0</b><span>m/min</span></div><div class="metric ap"><small>ap · ГЛУБИНА</small><b data-anim="${res.ap}" data-dec="3">0.000</b><span>mm</span></div></div><div class="secondary-metrics"><div><small>Мощность мотора</small><b>${res.power} kW · ${res.powerPct}%</b></div><div><small>Ra теоретическая</small><b>${res.ra==null?'—':res.ra+' µm'}</b></div><div><small>Ограничения</small><b>${res.rpmLimited?'RPM limit ':''}${res.powerLimited?'Power limit':''}${!res.rpmLimited&&!res.powerLimited?'OK':''}</b></div></div><div class="tool-recommendation"><div class="tool-art">${toolSvg(t,res.id)}</div><div class="tool-copy"><small>РЕКОМЕНДОВАННЫЙ ИНСТРУМЕНТ</small><b>${t.holder}</b><span>${t.insert} · ${t.grade} · ${t.breaker} · R${t.nose}<br>${t.source}${t.verified?' · подтверждённый профиль':' · проверить по коробке/каталогу'}</span></div></div><div class="sinumerik-box"><div class="sin-head"><span>SIEMENS</span><b>SINUMERIK 828D / ShopTurn</b></div><div class="sin-screen"><div><small>S / LIMS</small><b>${res.rpm}</b></div><div><small>F · G95</small><b>${res.f}</b></div><div><small>Vc · G96</small><b>${res.targetVc}</b></div><div><small>ap</small><b>${res.ap}</b></div></div></div><div class="shopturn-note">${sinumerikNote(res)}</div><div class="trial-zone"><div><div><h4>Первый пробный проход</h4><p>Оценка относится только к этой операции и этому проходу.</p></div><span class="badge ${res.verified?'green':''}">${res.verified?'ПРОВЕРЕНО':'SAFE START'}</span></div><div class="trial-mini"><span>S ${trial.rpm} rpm</span><span>f ${trial.f} mm/rev</span><span>ap ${trial.ap} mm</span><span>Vc ${trial.vc} m/min</span></div><div class="feedback-buttons">${Object.entries(D.feedbackRules).map(([id,r])=>`<button class="${id==='good'?'good':''}" data-feedback="${id}" data-pass="${res.id}">${r.icon} ${r.label}</button>`).join('')}</div><div class="adjust-host" id="adjust-${cssSafe(res.id)}"></div></div></div>`;
}
function cssSafe(s){return s.replace(/[^a-zA-Z0-9_-]/g,'_')}
function renderResults(animate=false){
  const s=stockMm(),m=material();$('#resultSubtitle').textContent=`${m.name} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм · ${state.route.length} операций`;
  $('#resultSummary').innerHTML=`<div class="summary-cell"><small>СТАНОК</small><b>${state.machine.name}</b></div><div class="summary-cell"><small>МАТЕРИАЛ</small><b>${m.short} · ISO ${m.iso}</b></div><div class="summary-cell"><small>ЗАГОТОВКА</small><b>Ø${round(s.diameter,1)} × ${round(s.length,1)} мм</b></div><div class="summary-cell"><small>СТРАТЕГИЯ</small><b>${{safe:'Безопасная',work:'Рабочая',productive:'Производительная'}[state.strategy]}</b></div><div class="summary-cell"><small>ПРОВЕРЕНО</small><b>${verifiedCount()} / ${totalPassCount()} проходов</b></div>`;
  $('#resultsList').innerHTML=state.results.map((group,i)=>{const op=operation(group.opId),allOk=group.passes.every(p=>p.verified);return `<article class="result-card glass"><div class="result-card-header"><div class="op-number"><b>${String(i+1).padStart(2,'0')}</b></div><div><h3>${op.icon} ${op.name}</h3><p>${state.route.find(x=>x.uid===group.routeUid)?.pass==='both'?'Черновая + чистовая':passLabel(group.passes[0].pass)} · ${group.passes.length} расчёт(а)</p></div><span class="verified-pill ${allOk?'ok':''}">${allOk?'✓ ПРОВЕРЕНО':'НЕ ПРОВЕРЕНО'}</span></div><div class="result-card-body">${group.passes.map((p,j)=>resultPassHtml(p,j)).join('')}</div></article>`}).join('');
  $$('[data-anim]').forEach(el=>animateNumber(el,+el.dataset.anim,+el.dataset.dec));
  $$('[data-feedback]').forEach(b=>b.addEventListener('click',()=>feedbackAction(b.dataset.pass,b.dataset.feedback)));
  if(animate){const rpm=state.results[0]?.passes[0]?.rpm||0;animateNumber($('#heroRpm'),rpm,0)}
}
function totalPassCount(){return state.results.reduce((a,g)=>a+g.passes.length,0)}function verifiedCount(){return state.results.reduce((a,g)=>a+g.passes.filter(p=>p.verified).length,0)}
function getPassById(id){for(const g of state.results){const p=g.passes.find(x=>x.id===id);if(p)return p}return null}
function feedbackAction(passId,ruleId){const p=getPassById(passId),rule=D.feedbackRules[ruleId];if(!p)return;if(ruleId==='good'){p.verified=true;p.lastFeedback='good';p.verifiedAt=new Date().toISOString();renderResults();toast('Режим этой операции подтверждён');return}
  p.lastFeedback=ruleId;const proposed=deep(p);proposed.rpm=round(p.rpm*rule.mult.rpm);proposed.f=round(p.opId.startsWith('thread')?p.f:clamp(p.f*rule.mult.f,p.range.f[0],p.range.f[2]),3);proposed.ap=round(clamp(p.ap*rule.mult.ap,Math.min(.05,p.range.ap[0]),p.range.ap[2]),3);proposed.vc=round(Math.PI*p.diameter*proposed.rpm/1000,1);proposed.targetVc=proposed.vc;proposed.power=round(p.power*rule.mult.f*rule.mult.ap*rule.mult.rpm,2);proposed.powerPct=round(proposed.power/state.machine.spindleKw*100);proposed.trial={rpm:round(proposed.rpm*.92),f:round(proposed.opId.startsWith('thread')?proposed.f:proposed.f*.88,3),ap:round(proposed.ap*.62,3),vc:round(Math.PI*p.diameter*(proposed.rpm*.92)/1000,1)};
  const host=$(`#adjust-${cssSafe(passId)}`);host.innerHTML=`<div class="adjust-panel"><h5>${rule.icon} ${rule.label}</h5><p>${rule.reason}</p><div class="adjust-compare"><div><small>S rpm</small><del>${p.rpm}</del><b>${proposed.rpm}</b></div><div><small>f mm/rev</small><del>${p.f}</del><b>${proposed.f}</b></div><div><small>ap mm</small><del>${p.ap}</del><b>${proposed.ap}</b></div><div><small>Vc m/min</small><del>${p.vc}</del><b>${proposed.vc}</b></div></div><div class="adjust-actions"><button class="primary" data-apply-adjust="${passId}">Применить новый режим</button><button class="ghost" data-cancel-adjust="${passId}">Отмена</button></div></div>`;
  host.querySelector('[data-apply-adjust]').addEventListener('click',()=>{Object.assign(p,proposed,{verified:false,revision:p.revision+1});renderResults();toast('Пересчитано. Сделай новый пробный проход')});host.querySelector('[data-cancel-adjust]').addEventListener('click',()=>host.innerHTML='');
}

function projectPayload(){return{id:state.projectId||uid(),name:$('#projectName').value.trim()||'Без названия',savedAt:new Date().toISOString(),machine:deep(state.machine),materialId:state.materialId,stock:deep(state.stock),route:deep(state.route),strategy:state.strategy,coolant:state.coolant,rigidity:state.rigidity,results:deep(state.results),version:D.version}}
function saveCurrentProject(){if(!state.results.length){toast('Сначала рассчитай маршрут');return}const p=projectPayload(),list=projects(),idx=list.findIndex(x=>x.id===p.id);if(idx>=0)list[idx]=p;else list.unshift(p);state.projectId=p.id;saveProjects(list.slice(0,120));toast('Проект сохранён локально')}
['saveProjectBtn','saveProjectTop'].forEach(id=>$('#'+id).addEventListener('click',saveCurrentProject));
function openProject(id){const p=projects().find(x=>x.id===id);if(!p)return;state.projectId=p.id;state.machine=p.machine||state.machine;state.materialId=p.materialId;state.stock=p.stock;state.route=p.route||[];state.strategy=p.strategy||'work';state.coolant=p.coolant||'emulsion';state.rigidity=p.rigidity||'medium';state.results=p.results||[];$('#projectName').value=p.name;syncMachineUI();renderMaterials();syncStockUI();renderRoute();syncStrategy();renderResults();navView('work');goStep(state.results.length?5:3);toast('Проект открыт')}
function deleteProject(id){if(!confirm('Удалить проект с этого устройства?'))return;saveProjects(projects().filter(x=>x.id!==id))}
function renderProjects(){const list=projects(),box=$('#projectsList');if(!list.length){box.innerHTML='<div class="empty-state glass"><b>Проектов пока нет</b><span>Рассчитай техпроцесс и сохрани его — он появится здесь.</span></div>';return}box.innerHTML=list.map(p=>{const m=D.materials.find(x=>x.id===p.materialId),s=p.stock,verified=(p.results||[]).reduce((a,g)=>a+g.passes.filter(x=>x.verified).length,0),total=(p.results||[]).reduce((a,g)=>a+g.passes.length,0);return `<article class="project-card glass"><div><h3>${esc(p.name)}</h3><p>${new Date(p.savedAt).toLocaleString('ru-RU')} · ${m?.name||p.materialId}</p><div class="project-meta"><span>Ø${s.diameter}${s.unit}</span><span>${s.length}${s.unit}</span><span>${p.route?.length||0} операций</span><span>${verified}/${total} проверено</span></div></div><div class="project-actions"><button data-open-project="${p.id}">Открыть</button><button data-delete-project="${p.id}">Удалить</button></div></article>`}).join('');box.querySelectorAll('[data-open-project]').forEach(b=>b.addEventListener('click',()=>openProject(b.dataset.openProject)));box.querySelectorAll('[data-delete-project]').forEach(b=>b.addEventListener('click',()=>deleteProject(b.dataset.deleteProject)))}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function newProject(){if(state.route.length||state.results.length){if(!confirm('Начать новый проект? Несохранённые данные будут сброшены.'))return}state.projectId=null;state.materialId='aisi304';state.stock={diameter:50,length:100,unit:'mm',hardness:180};state.route=[];state.strategy='work';state.coolant='emulsion';state.rigidity='medium';state.results=[];$('#projectName').value='Новая деталь';store.set(KEYS.draft,null);renderMaterials();syncStockUI();renderRoute();syncStrategy();goStep(1);toast('Новый проект')}
$('#resetDraft').addEventListener('click',newProject);$('#newProjectBtn').addEventListener('click',newProject);

function printProject(){if(!state.results.length){toast('Нет рассчитанного проекта');return}window.print()}
['printProjectBtn','printProjectTop'].forEach(id=>$('#'+id).addEventListener('click',printProject));
function exportPng(){if(!state.results.length){toast('Нет рассчитанного проекта');return}const c=$('#exportCanvas'),ctx=c.getContext('2d'),w=c.width,h=c.height;const grad=ctx.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#071624');grad.addColorStop(1,'#04080d');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);ctx.fillStyle='#6bbaff';ctx.font='700 26px system-ui';ctx.fillText('CNC COPILOT · FULL 1.0',70,80);ctx.fillStyle='#f7fbff';ctx.font='800 56px system-ui';ctx.fillText($('#projectName').value||'Техпроцесс',70,155);const s=stockMm(),m=material();ctx.fillStyle='#9db0c0';ctx.font='26px system-ui';ctx.fillText(`${state.machine.name} · ${m.name} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм`,70,210);let y=285;state.results.slice(0,9).forEach((g,i)=>{ctx.fillStyle='rgba(255,255,255,.07)';roundRect(ctx,60,y-38,1080,125,25);ctx.fill();ctx.fillStyle='#f7fbff';ctx.font='700 28px system-ui';ctx.fillText(`${String(i+1).padStart(2,'0')}  ${operation(g.opId).name}`,85,y);let x=85;g.passes.forEach((p,j)=>{ctx.fillStyle=j?'#86e2b2':'#8fcaff';ctx.font='600 20px system-ui';ctx.fillText(`${passLabel(p.pass)}: S ${p.rpm}  f ${p.f}  Vc ${p.vc}  ap ${p.ap}${p.verified?'  ✓':''}`,x,y+42+j*31)});y+=145});ctx.fillStyle='#71879a';ctx.font='18px system-ui';ctx.fillText('Стартовая технологическая рекомендация. Проверяй зажим, траекторию, нули и лимиты станка.',70,h-70);c.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`CNC-${safeName($('#projectName').value)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)},'image/png')}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):(ctx.rect(x,y,w,h));}
function safeName(s){return String(s||'project').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g,'_').slice(0,60)}
$('#exportPngBtn').addEventListener('click',exportPng);

function renderTools(){const tools=allTools();$('#toolLibrary').innerHTML=tools.map(t=>`<article class="tool-card-ui glass"><div class="tool-art">${toolSvg(t,t.id)}</div><div><span class="badge ${t.verified?'green':''}">${t.verified?'каталог':'local'}</span><h3>${t.holder}</h3><p>${t.insert} · ${t.grade} · ${t.breaker} · R${t.nose}</p><div class="tool-tags"><span>ISO ${t.iso.join('/')}</span><span>${t.ops.join(' · ')}</span></div></div></article>`).join('')}
$('#addCustomTool').addEventListener('click',()=>{const holder=$('#customHolder').value.trim(),insert=$('#customInsert').value.trim();if(!holder||!insert){toast('Укажи державку и пластину');return}const tool={id:'custom-'+uid(),holder,insert,grade:$('#customGrade').value.trim()||'не задан',breaker:$('#customBreaker').value.trim()||'—',nose:+$('#customNose').value||.8,iso:[$('#customIso').value],ops:['face','od','rough','finish','bore'],passes:['rough','finish'],source:'Пользовательский локальный инструмент',verified:false,art:{shape:'wnmg',tone:'steel'}};const list=store.get(KEYS.tools,[]);list.push(tool);store.set(KEYS.tools,list);renderTools();renderRoute();toast('Инструмент добавлен в локальный шкаф')});

const sizeSteps=[[1,3],[3,6],[6,10],[10,18],[18,30],[30,50],[50,80],[80,120],[120,180],[180,250],[250,315],[315,400],[400,500]];const itMul={5:7,6:10,7:16,8:25,9:40,10:64,11:100,12:160,13:250,14:400};
function itTol(n,g){const st=sizeSteps.find(([a,b])=>n>a&&n<=b)||sizeSteps.find(([a,b])=>n>=a&&n<=b);if(!st)return null;const dm=Math.sqrt(st[0]*st[1]),i=.45*Math.cbrt(dm)+.001*dm;return itMul[g]*i/1000}
function limitsFor(n,letter,grade){const t=itTol(n,grade);if(t==null)return null;let lo=0,hi=0;if(letter==='H'){lo=0;hi=t}else if(letter==='h'){lo=-t;hi=0}else{lo=-t/2;hi=t/2}return{t,lo,hi}}
function shaftDeviation(n,letter,grade){const t=itTol(n,grade);if(t==null)return null;const D=n;let es=0,ei=0;if(letter==='h'){es=0;ei=-t}else if(letter==='g'){es=(-2.5*Math.pow(D,.34))/1000;ei=es-t}else if(letter==='f'){es=(-5.5*Math.pow(D,.41))/1000;ei=es-t}else if(letter==='k'){ei=(2.0*Math.pow(D,.20))/1000;es=ei+t}else if(letter==='p'){ei=(16*Math.pow(D,.44))/1000;es=ei+t}else{ei=-t/2;es=t/2}return{t,lo:ei,hi:es}}
function renderReference(){const fs=$('#fitPreset');fs.innerHTML=D.fitPresets.map((x,i)=>`<option value="${i}">${x.name}</option>`).join('');const th=$('#threadSelect');th.innerHTML=D.threads.map(([n,p])=>`<option value="${n}" data-p="${p}">${n} × ${p}</option>`).join('');th.value='M16';$('#threadPitchRef').value=2;calcTol();calcFit();calcThread()}
function calcTol(){const n=+$('#tolNom').value,g=+$('#tolGrade').value,l=$('#tolLetter').value,r=limitsFor(n,l,g);if(!r){$('#tolResult').textContent='Диапазон встроенного расчёта: 1–500 мм.';return}$('#tolResult').innerHTML=`<b>${n} ${l}${g}</b><br>IT${g}: <b>${(r.t*1000).toFixed(1)} µm</b><br>Отклонения: ${r.lo>=0?'+':''}${r.lo.toFixed(4)} / ${r.hi>=0?'+':''}${r.hi.toFixed(4)} мм<br>Предельный размер: <b>${(n+r.lo).toFixed(4)} … ${(n+r.hi).toFixed(4)} мм</b>`}
function calcFit(){const n=+$('#fitNom').value,p=D.fitPresets[+$('#fitPreset').value||0],hole=limitsFor(n,p.hole,p.holeGrade),shaft=shaftDeviation(n,p.shaft,p.shaftGrade);if(!hole||!shaft){$('#fitResult').textContent='Номинал вне диапазона 1–500 мм.';return}const minClear=(n+hole.lo)-(n+shaft.hi),maxClear=(n+hole.hi)-(n+shaft.lo);$('#fitResult').innerHTML=`<b>${p.hole}${p.holeGrade}/${p.shaft}${p.shaftGrade}</b><br>Отверстие: ${(n+hole.lo).toFixed(4)} … ${(n+hole.hi).toFixed(4)} мм<br>Вал: ${(n+shaft.lo).toFixed(4)} … ${(n+shaft.hi).toFixed(4)} мм<br>Зазор/натяг: <b>${(minClear*1000).toFixed(1)} … ${(maxClear*1000).toFixed(1)} µm</b><br><span class="muted">Для полей g/f/k/p фундаментальное отклонение здесь — встроенный справочный помощник. Ответственную посадку сверяй с актуальной таблицей ISO 286.</span>`}
function calcThread(){const n=$('#threadSelect').value,p=+$('#threadPitchRef').value,d=+n.slice(1),drill=d-p,depth=.6134*p;$('#threadResult').innerHTML=`<b>${n} × ${p}</b><br>Сверло под метчик, ориентир D−P: <b>Ø${drill.toFixed(2)} мм</b><br>Радиальная глубина профиля наружной метрической резьбы, ориентир: <b>${depth.toFixed(3)} мм</b>`}
$('#calcTolerance').addEventListener('click',calcTol);$('#calcFit').addEventListener('click',calcFit);$('#calcThread').addEventListener('click',calcThread);$('#threadSelect').addEventListener('change',()=>{$('#threadPitchRef').value=$('#threadSelect').selectedOptions[0].dataset.p;calcThread()});

function authorMail(type='general'){
  const subjects={general:'CNC Copilot — обратная связь',bug:'CNC Copilot — ошибка',idea:'CNC Copilot — предложение функции',cut:'CNC Copilot — режим резания',ui:'CNC Copilot — интерфейс'};
  const body=`Здравствуйте, Иван!%0D%0A%0D%0AВерсия: ${encodeURIComponent(D.version)}%0D%0AРаздел: ${encodeURIComponent(type)}%0D%0A%0D%0AСообщение:%0D%0A`;
  return `mailto:${D.author.email}?subject=${encodeURIComponent(subjects[type]||subjects.general)}&body=${body}`;
}
$('#authorMail').href=authorMail();$$('[data-mail-type]').forEach(b=>b.addEventListener('click',()=>{location.href=authorMail(b.dataset.mailType)}));

$('#exportBackup').addEventListener('click',()=>{const data={version:D.version,exportedAt:new Date().toISOString(),machine:state.machine,customTools:store.get(KEYS.tools,[]),projects:projects()};downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'CNC-Copilot-backup.json')});
$('#importBackup').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const data=JSON.parse(rd.result);if(data.machine){state.machine=data.machine;store.set(KEYS.machine,data.machine)}if(Array.isArray(data.customTools))store.set(KEYS.tools,data.customTools);if(Array.isArray(data.projects))store.set(KEYS.projects,data.projects);syncMachineUI();renderTools();renderProjects();toast('Резервная копия импортирована')}catch{toast('Не удалось прочитать JSON')}};rd.readAsText(f)});
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),600)}

function syncStrategy(){$$('#strategySwitch [data-strategy]').forEach(b=>b.classList.toggle('active',b.dataset.strategy===state.strategy));$('#coolant').value=state.coolant;$('#rigidity').value=state.rigidity}
function initOfflineStatus(){function upd(){const label=$('#offlineLabel');label.textContent=navigator.onLine?'OFFLINE CORE · ONLINE':'OFFLINE CORE · NO NETWORK';label.style.color=navigator.onLine?'':'#69dfa8'}window.addEventListener('online',upd);window.addEventListener('offline',upd);upd()}
function registerSW(){if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}

function init(){syncMachineUI();renderMaterials();syncStockUI();renderOperationCatalog();renderRoute();syncStrategy();renderPreflight();renderTools();renderProjects();renderReference();initOfflineStatus();goStep(state.step||1);registerSW();}
init();
})();
