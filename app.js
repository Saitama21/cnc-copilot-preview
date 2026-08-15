
const state = {
  step: 1,
  machine: "ck52",
  material: "aisi304",
  tool: "wnmg080408",
  op: "rough",
  mode: "work",
  result: null,
  adjusted: null
};

const materials = {
  aisi304:{name:"AISI 304 (08Х18Н10)", group:"M", desc:"Нержавеющая сталь", color:"#f6c347", vc:145, feed:.18, ap:1.5},
  aisi316:{name:"AISI 316 / 316L", group:"M", desc:"Нержавеющая сталь", color:"#e8b842", vc:130, feed:.17, ap:1.35},
  steel45:{name:"Сталь 45 (C45)", group:"P", desc:"Конструкционная сталь", color:"#5e9cff", vc:190, feed:.22, ap:2.0},
  brass:{name:"Латунь", group:"N", desc:"Цветной металл", color:"#50d5b1", vc:260, feed:.20, ap:2.0},
  alu:{name:"Алюминий 6061", group:"N", desc:"Алюминиевый сплав", color:"#7ad9cf", vc:400, feed:.24, ap:2.2},
  poly:{name:"Полиамид", group:"N", desc:"Полимер", color:"#c58cff", vc:180, feed:.18, ap:2.0},
};
const tools = {
  wnmg080408:{name:"WNMG 080408", sub:"универсальная наружная · R0.8", class:"M/P", factor:1.00},
  cnmg120404:{name:"CNMG 120404", sub:"наружная/торец · R0.4", class:"M/P", factor:.92},
  dcmt070204:{name:"DCMT 070204", sub:"чистовая геометрия · R0.4", class:"M/N", factor:.88},
};
const machines = {
  ck52:{name:"Tengyue CK52PT‑Y", control:"SINUMERIK 828D / ShopTurn", maxRpm:4000, kw:11},
  custom:{name:"Мой станок", control:"Пользовательский профиль", maxRpm:3000, kw:7.5}
};
const ops = {
  rough:{name:"наружное черновое", vc:1.0, feed:1.0, ap:1.0},
  finish:{name:"чистовое точение", vc:1.08, feed:.55, ap:.35},
  face:{name:"торцевание", vc:.95, feed:.78, ap:.70},
  bore:{name:"расточка", vc:.86, feed:.72, ap:.55},
  groove:{name:"канавка", vc:.72, feed:.50, ap:.45},
  part:{name:"отрезка", vc:.63, feed:.42, ap:.35}
};
const modes = {
  safe:{label:"Безопасный", vc:.78, feed:.78, ap:.65},
  work:{label:"Рабочий", vc:1.0, feed:1.0, ap:1.0},
  fast:{label:"Производительный", vc:1.13, feed:1.12, ap:1.18}
};

function q(s){return document.querySelector(s)}
function qa(s){return [...document.querySelectorAll(s)]}
function round(n,d=0){const p=10**d;return Math.round(n*p)/p}

function renderMaterials(){
  q("#materialList").innerHTML = Object.entries(materials).map(([id,m])=>`
    <button class="material ${state.material===id?"selected":""}" data-material="${id}">
      <span class="iso" style="background:${m.color}"></span>
      <span><b>${m.name}</b><small>ISO ${m.group} · ${m.desc}</small></span>
      <span class="tick">${state.material===id?"✓":""}</span>
    </button>`).join("");
  qa("[data-material]").forEach(b=>b.onclick=()=>{state.material=b.dataset.material;renderMaterials()})
}
function renderTools(){
  q("#toolList").innerHTML = Object.entries(tools).map(([id,t])=>`
    <button class="tool ${state.tool===id?"selected":""}" data-tool="${id}">
      <span class="insert-shape"></span>
      <span><b>${t.name}</b><small>${t.sub}<br>Группа: ${t.class}</small></span>
      <span class="tick">${state.tool===id?"✓":""}</span>
    </button>`).join("");
  qa("[data-tool]").forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;renderTools()})
}
function centerActiveStep(n,behavior="smooth"){
  const stepper=q("#stepper");
  const active=q(`.step[data-go="${n}"]`);
  if(!stepper||!active)return;
  requestAnimationFrame(()=>{
    const target=active.offsetLeft-(stepper.clientWidth-active.offsetWidth)/2;
    stepper.scrollTo({left:Math.max(0,target),behavior});
  });
}
function gotoStep(n){
  state.step=n;
  qa(".screen").forEach(s=>s.classList.toggle("active",+s.dataset.screen===n));
  qa(".step").forEach(s=>s.classList.toggle("active",+s.dataset.go===n));
  centerActiveStep(n);
  window.scrollTo({top:110,behavior:"smooth"});
  if(n===5) calculate();
  if(n===6) renderTrial();
}
qa("[data-next]").forEach(b=>b.onclick=()=>gotoStep(+b.dataset.next));
qa(".step").forEach(b=>b.onclick=()=>gotoStep(+b.dataset.go));

qa("[data-machine]").forEach(b=>b.onclick=()=>{
  state.machine=b.dataset.machine;
  qa("[data-machine]").forEach(x=>x.classList.toggle("selected",x===b));
  q("#customMachine").classList.toggle("hidden",state.machine!=="custom");
});
q("#customMaxRpm").oninput=()=>machines.custom.maxRpm=+q("#customMaxRpm").value||3000;
q("#customKw").oninput=()=>machines.custom.kw=+q("#customKw").value||7.5;
q("#customMachineName").oninput=()=>machines.custom.name=q("#customMachineName").value||"Мой станок";

q("#diameter").oninput=()=>q("#dimD").textContent=q("#diameter").value||0;
q("#length").oninput=()=>q("#dimL").textContent=q("#length").value||0;
qa("[data-op]").forEach(b=>b.onclick=()=>{
  state.op=b.dataset.op;
  qa("[data-op]").forEach(x=>x.classList.toggle("selected",x===b));
});
q("#calculateBtn").onclick=()=>gotoStep(5);

qa("[data-mode]").forEach(b=>b.onclick=()=>{
  state.mode=b.dataset.mode;
  qa("[data-mode]").forEach(x=>x.classList.toggle("active",x===b));
  calculate();
});

function calculate(){
  const d = Math.max(1,+q("#diameter").value||120);
  const mat = materials[state.material];
  const tool = tools[state.tool];
  const op = ops[state.op];
  const mode = modes[state.mode];
  const machine = machines[state.machine];

  let coolantFactor = q("#coolant").value==="dry" ? .84 : q("#coolant").value==="oil" ? .95 : 1;
  let rigidFactor = q("#rigidity").value==="low" ? .82 : q("#rigidity").value==="high" ? 1.07 : 1;

  let vc = mat.vc * tool.factor * op.vc * mode.vc * coolantFactor * rigidFactor;
  let rpm = (1000*vc)/(Math.PI*d);
  rpm = Math.min(rpm,machine.maxRpm);
  vc = (Math.PI*d*rpm)/1000;

  let feed = mat.feed * op.feed * mode.feed * (q("#rigidity").value==="low"?.88:1);
  let ap = mat.ap * op.ap * mode.ap * (q("#rigidity").value==="low"?.75:1);

  // Practical lower/upper clamps for a preview calculator
  feed = Math.max(.04,Math.min(feed,.45));
  ap = Math.max(.15,Math.min(ap,4));

  state.result = {rpm:round(rpm), feed:round(feed,2), vc:round(vc), ap:round(ap,2)};
  state.adjusted = null;
  renderResult();
}
function renderResult(){
  const r=state.adjusted||state.result;if(!r)return;
  const mat=materials[state.material], tool=tools[state.tool], machine=machines[state.machine], op=ops[state.op];
  q("#rpmOut").textContent=r.rpm;
  q("#feedOut").textContent=r.feed.toFixed(2);
  q("#vcOut").textContent=r.vc;
  q("#apOut").textContent=r.ap.toFixed(2).replace(/0$/,"");
  q("#sinS").textContent=`S${r.rpm}`;
  q("#sinF").textContent=`F${r.feed.toFixed(2)}`;
  q("#resultContext").textContent=`${mat.name.split(" ")[0]} ${mat.name.split(" ")[1]||""} · Ø${q("#diameter").value}`;
  q("#whyText").textContent=`База материала: ${mat.vc} м/мин. Затем применены коэффициенты инструмента (${tool.name}), операции «${op.name}», выбранного режима «${modes[state.mode].label}», СОЖ и жёсткости. Обороты ограничиваются максимумом станка ${machine.maxRpm} rpm.`;
}
function renderTrial(){
  const r=state.adjusted||state.result||{rpm:0,feed:0,ap:0};
  const d=+q("#diameter").value||120;
  const trialRpm=round(r.rpm*.90);
  const trialFeed=round(r.feed*.82,2);
  const trialAp=round(Math.max(.2,r.ap*.45),2);
  const trialVc=round(Math.PI*d*trialRpm/1000);
  q("#trialS").textContent=trialRpm;
  q("#trialF").textContent=trialFeed.toFixed(2);
  q("#trialVc").textContent=trialVc;
  q("#trialAp").textContent=trialAp.toFixed(2).replace(/0$/,"");
  q("#adjustCard").classList.add("hidden");
}

const feedbackRules={
  good:{reason:"Режим выглядит стабильным — можно переходить к рабочему.",rpm:1,feed:1,ap:1},
  vibration:{reason:"Вибрация: снижаем скорость и глубину, немного уменьшаем подачу.",rpm:.86,feed:.90,ap:.78},
  squeal:{reason:"Свист/шум: снижаем обороты и слегка увеличиваем нагрузку на кромку.",rpm:.88,feed:1.05,ap:.90},
  chips:{reason:"Стружка не ломается: немного увеличиваем подачу, скорость оставляем близко к текущей.",rpm:.97,feed:1.14,ap:1},
  heat:{reason:"Перегрев: снижаем скорость резания и нагрузку.",rpm:.82,feed:.90,ap:.88},
  surface:{reason:"Плохая поверхность: уменьшаем подачу и глубину, чуть снижаем обороты.",rpm:.92,feed:.78,ap:.72}
};
qa("[data-feedback]").forEach(b=>b.onclick=()=>{
  const key=b.dataset.feedback;
  const rule=feedbackRules[key];
  const base=state.adjusted||state.result;
  if(!base)return;

  if(key==="good"){
    q("#adjustReason").textContent=rule.reason;
    q("#oldS").textContent=`${base.rpm} rpm`;q("#newS").textContent=`${base.rpm} rpm`;
    q("#oldF").textContent=`${base.feed.toFixed(2)}`;q("#newF").textContent=`${base.feed.toFixed(2)}`;
    q("#oldAp").textContent=`${base.ap}`;q("#newAp").textContent=`${base.ap}`;
    q("#adjustCard").classList.remove("hidden");
    q("#applyAdjustBtn").textContent="Вернуться к рабочему режиму";
    q("#applyAdjustBtn").onclick=()=>gotoStep(5);
    return;
  }

  const d=+q("#diameter").value||120;
  const next={
    rpm:round(base.rpm*rule.rpm),
    feed:round(Math.max(.04,base.feed*rule.feed),2),
    ap:round(Math.max(.15,base.ap*rule.ap),2)
  };
  next.vc=round(Math.PI*d*next.rpm/1000);
  q("#adjustReason").textContent=rule.reason;
  q("#oldS").textContent=`${base.rpm} rpm`;q("#newS").textContent=`${next.rpm} rpm`;
  q("#oldF").textContent=`${base.feed.toFixed(2)}`;q("#newF").textContent=`${next.feed.toFixed(2)}`;
  q("#oldAp").textContent=`${base.ap}`;q("#newAp").textContent=`${next.ap}`;
  q("#adjustCard").classList.remove("hidden");
  q("#applyAdjustBtn").textContent="Применить новый режим";
  q("#applyAdjustBtn").onclick=()=>{state.adjusted=next;renderResult();renderTrial();gotoStep(5)}
});

function history(){
  try{return JSON.parse(localStorage.getItem("cncCopilotHistory")||"[]")}catch{return[]}
}
function saveHistory(items){localStorage.setItem("cncCopilotHistory",JSON.stringify(items));renderHistory()}
function renderHistory(){
  const list=history();
  q("#historyList").innerHTML=list.length?list.map((x,i)=>`
    <div class="history-item"><b>${x.material} · Ø${x.diameter} · ${x.operation}</b>
      <small>${x.tool}<br>S${x.rpm} · F${x.feed} · Vc${x.vc} · ap${x.ap} · ${x.mode}</small>
    </div>`).join(""):`<div class="empty">Пока ничего не сохранено.</div>`;
}
q("#saveModeBtn").onclick=()=>{
  const r=state.adjusted||state.result;if(!r)return;
  const list=history();
  list.unshift({
    ts:new Date().toISOString(),
    material:materials[state.material].name,
    diameter:q("#diameter").value,
    operation:ops[state.op].name,
    tool:tools[state.tool].name,
    ...r,
    mode:modes[state.mode].label
  });
  saveHistory(list.slice(0,20));
  q("#saveModeBtn").textContent="✓ Сохранено в историю";
  setTimeout(()=>q("#saveModeBtn").textContent="☆ Сохранить удачный режим",1200);
};
q("#clearHistoryBtn").onclick=()=>saveHistory([]);
q("#newCalcBtn").onclick=()=>gotoStep(1);
q("#resetBtn").onclick=()=>{if(confirm("Сбросить текущий расчёт?")) location.reload()};

renderMaterials();
renderTools();
renderHistory();
calculate();
centerActiveStep(1,"auto");

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
