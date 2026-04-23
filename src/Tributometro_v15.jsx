import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { jsPDF } from "jspdf";
import rumoLogo from "./assets/rumo-logo.png";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`;

const C = {
  bg:"#F5F5F7", bg1:"#FFFFFF", bg2:"#F0F0F3", bg3:"#E4E4EA", border:"#E0E0E8",
  brand:"#FF8200", brandLt:"#FFF3E6",
  text:"#1A1A2A", text2:"#6B6B80", text3:"#A0A0B0",
  green:"#16A34A", greenLt:"rgba(22,163,74,0.08)",
  red:"#DC2626",   redLt:"rgba(220,38,38,0.08)",
  blue:"#1D5BD7",  blueLt:"rgba(29,91,215,0.08)",
  amber:"#B45309", amberLt:"rgba(180,83,9,0.08)",
  purple:"#7C3AED", teal:"#0D9488",
};
const F = { sans:"'Noto Sans',sans-serif", mono:"'JetBrains Mono',monospace" };

// ── Alíquotas CBS+IBS (LC 214/2025) — SEM ICMS ──
const MILES = [
  {ano:2027,label:"CBS Ativa",     cbs:9.3,  ibs:0,    total:9.3,  cor:C.blue,
   desc:"CBS inicia cobrança com 9,3%. PIS e COFINS extintos. IBS ainda não vigora."},
  {ano:2028,label:"CBS Plena",     cbs:9.3,  ibs:0,    total:9.3,  cor:C.purple,
   desc:"CBS plena em 9,3%. IBS em fase de teste."},
  {ano:2029,label:"IBS Entra",     cbs:9.3,  ibs:11.22,total:20.52,cor:C.amber,
   desc:"IBS entra com 11,22% (60% da alíquota plena). Carga nominal 20,52%."},
  {ano:2030,label:"Transição 70%", cbs:9.3,  ibs:13.09,total:22.39,cor:C.amber,
   desc:"IBS sobe para 13,09% (70% da alíquota plena). Carga nominal 22,39%."},
  {ano:2031,label:"Transição 80%", cbs:9.3,  ibs:14.96,total:24.26,cor:C.brand,
   desc:"IBS chega a 14,96% (80% da alíquota plena). Carga nominal 24,26%."},
  {ano:2032,label:"Transição 90%", cbs:9.3,  ibs:16.83,total:26.13,cor:C.brand,
   desc:"IBS 16,83% (90% da alíquota plena). Carga nominal 26,13%."},
  {ano:2033,label:"IVA Pleno",     cbs:9.3,  ibs:18.70,total:28.0, cor:C.red,
   desc:"IVA Dual 100%: CBS 9,3% + IBS 18,7% = 28% nominal. Com crédito pleno, carga efetiva cai para ~10-14%."},
];

// ── Crédito CBS por regime do fornecedor ──
const CBS_CRED = { autonomo:1.86, simplesNacional:2.3, lucro:9.3 };

function calcCBSCredito(pA, pS, pL, lucroRate=CBS_CRED.lucro) {
  const tot = pA+pS+pL;
  if(!tot) return 0;
  return (pA/tot)*CBS_CRED.autonomo + (pS/tot)*CBS_CRED.simplesNacional + (pL/tot)*lucroRate;
}

// ── Insumos que geram crédito (checkboxes) ──
const INSUMOS_FROTA = [
  {id:"diesel",    nome:"Diesel",                descricao:"Combustível principal da frota",      pctCustoDefault:35},
  {id:"gasolina",  nome:"Gasolina",              descricao:"Para veículos leves/apoio",           pctCustoDefault:3},
  {id:"gnv",       nome:"GNV",                   descricao:"Gás natural veicular",                pctCustoDefault:0},
  {id:"pecas",     nome:"Peças de reposição",    descricao:"Filtros, correias, rolamentos, etc.", pctCustoDefault:5},
  {id:"pneus",     nome:"Pneus e recapagens",    descricao:"Pneus novos + recapagens",            pctCustoDefault:4},
  {id:"manutencao",nome:"Manutenção prev./corr.",descricao:"Oficinas, revisões, reparos",         pctCustoDefault:8},
  {id:"pedagios",  nome:"Pedágios",              descricao:"Valores pagos em praças de pedágio",  pctCustoDefault:3},
  {id:"outras",    nome:"Outras Despesas Gerais",descricao:"Despesas que não se enquadram nos itens anteriores", pctCustoDefault:0},
];

// ── Despesas SEM direito a crédito CBS/IBS ──
const DESPESAS_SEM_CREDITO = [
  {id:"salarios",    nome:"Salários e Encargos Trabalhistas", descricao:"Folha de pagamento, FGTS, INSS patronal — não geram crédito CBS/IBS"},
  {id:"seguros",     nome:"Seguros de carga / veículos",      descricao:"Seguros contratados com seguradoras — verificar nota fiscal emitida"},
  {id:"financeiras", nome:"Despesas Financeiras",             descricao:"Juros, tarifas bancárias, leasing sem NF-e de serviços"},
  {id:"outras_sc",   nome:"Outras Despesas Gerais",           descricao:"Demais despesas diversas sem direito a crédito CBS/IBS"},
];

// ══ Cálculo Reforma Tributária (CBS+IBS) — SEM ICMS ══
function calcReforma({
  frete, regime, pctExportacao,
  cbsAliq, ibsAliq,
  usaFrota, pctFrota, insumosAtivos, insumosCusto,
  usaTerceiros, pctTerceiros, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros=9.3,
  insumosAtivosTerceiros, insumosCustoTerceiros,
  usaAgregados, pctAgregados, regimeAgregado, margemAgregados,
  insumosAtivosAgregados, insumosCustoAgregados,
  valorCompraImob=0, valorVendaImob=0,
}) {
  const fexp = pctExportacao / 100;
  const aliqCBS = cbsAliq / 100;
  const aliqIBS = ibsAliq / 100;

  // Débitos
  const cbsDebito = frete * aliqCBS * (1 - fexp);
  const ibsDebito = frete * aliqIBS * (1 - fexp);

  // ═══ CRÉDITOS ═══
  let creditoCBS_frota = 0;
  let creditoIBS_frota = 0;
  let creditoCBS_terceiros = 0;
  let creditoIBS_terceiros = 0;
  let creditoCBS_agregados = 0;
  let creditoIBS_agregados = 0;

  // Detalhamento dos insumos
  const detalheFrota = [];
  const detalheTerceiros = [];
  const detalheAgregados = [];

  // ── FROTA PRÓPRIA ──
  if (usaFrota && pctFrota > 0) {
    const baseFrota = frete * (pctFrota / 100);
    INSUMOS_FROTA.forEach(insumo => {
      if (insumosAtivos[insumo.id]) {
        const custoInsumo = baseFrota * (insumosCusto[insumo.id] || 0) / 100;
        const credCBS = custoInsumo * aliqCBS;
        const credIBS = custoInsumo * aliqIBS;
        creditoCBS_frota += credCBS;
        creditoIBS_frota += credIBS;
        detalheFrota.push({
          nome: insumo.nome,
          custo: custoInsumo,
          creditoCBS: credCBS,
          creditoIBS: credIBS,
        });
      }
    });
  }

  // ── TERCEIROS ──
  if (usaTerceiros && pctTerceiros > 0) {
    const pct = pctTerceiros / 100;
    const mg  = 1 - (margemTerceiros || 0) / 100;
    // PF (autônomo): crédito presumido — usa base cheia (sem deduzir exportação)
    // PJSN/PJN: crédito real — usa base tributável (após exportação, pois terceiro tb não cobra CBS sobre export)
    const baseFull     = frete * pct * mg;
    const baseTaxable  = frete * (1 - fexp) * pct * mg;
    const tot = mixAutonomo + mixSN + mixLucro || 1;
    const bPF_ter  = baseFull    * (mixAutonomo / tot);
    const bSN_ter  = baseTaxable * (mixSN / tot);
    const bPJN_ter = baseTaxable * (mixLucro / tot);
    creditoCBS_terceiros = bPF_ter * CBS_CRED.autonomo/100
                         + bSN_ter * CBS_CRED.simplesNacional/100
                         + bPJN_ter * (lucroRateTerceiros/100);
    creditoIBS_terceiros = bPF_ter * aliqIBS * (CBS_CRED.autonomo/9.3)
                         + bSN_ter * aliqIBS * (CBS_CRED.simplesNacional/9.3)
                         + bPJN_ter * aliqIBS * (lucroRateTerceiros/9.3);
    // Insumos adicionais com crédito no segmento terceiros
    if (insumosAtivosTerceiros) {
      const baseTerInsumos = frete * (pctTerceiros / 100);
      INSUMOS_FROTA.forEach(insumo => {
        if (insumosAtivosTerceiros[insumo.id]) {
          const custoInsumo = baseTerInsumos * (insumosCustoTerceiros[insumo.id] || 0) / 100;
          const credCBS = custoInsumo * aliqCBS;
          const credIBS = custoInsumo * aliqIBS;
          creditoCBS_terceiros += credCBS;
          creditoIBS_terceiros += credIBS;
          detalheTerceiros.push({nome: insumo.nome, custo: custoInsumo, creditoCBS: credCBS, creditoIBS: credIBS});
        }
      });
    }
  }

  // ── AGREGADOS ──
  if (usaAgregados && pctAgregados > 0) {
    const baseAgregados = frete * (pctAgregados / 100) * (1 - (margemAgregados || 0) / 100);
    let cbsCredAgregado = 0;
    if (regimeAgregado === "Autônomo") cbsCredAgregado = CBS_CRED.autonomo / 100;
    else if (regimeAgregado === "Simples Nacional") cbsCredAgregado = CBS_CRED.simplesNacional / 100;
    else cbsCredAgregado = aliqCBS;
    creditoCBS_agregados = baseAgregados * cbsCredAgregado;
    creditoIBS_agregados = baseAgregados * aliqIBS;
    // Insumos adicionais com crédito no segmento agregados
    if (insumosAtivosAgregados) {
      const baseAgInsumos = frete * (pctAgregados / 100);
      INSUMOS_FROTA.forEach(insumo => {
        if (insumosAtivosAgregados[insumo.id]) {
          const custoInsumo = baseAgInsumos * (insumosCustoAgregados[insumo.id] || 0) / 100;
          const credCBS = custoInsumo * aliqCBS;
          const credIBS = custoInsumo * aliqIBS;
          creditoCBS_agregados += credCBS;
          creditoIBS_agregados += credIBS;
          detalheAgregados.push({nome: insumo.nome, custo: custoInsumo, creditoCBS: credCBS, creditoIBS: credIBS});
        }
      });
    }
  }

  // ── IMOBILIZADOS (compra/venda de caminhões) ──
  // Compra gera crédito; venda gera débito adicional
  let cbsDebitoImob = valorVendaImob * aliqCBS;
  let ibsDebitoImob = valorVendaImob * aliqIBS;
  let creditoCBS_imob = valorCompraImob * aliqCBS;
  let creditoIBS_imob = valorCompraImob * aliqIBS;

  // Simples Nacional não apropria crédito
  if (regime === "Simples Nacional") {
    creditoCBS_frota = 0; creditoIBS_frota = 0;
    creditoCBS_terceiros = 0; creditoIBS_terceiros = 0;
    creditoCBS_agregados = 0; creditoIBS_agregados = 0;
  }

  const totalCreditoCBS = creditoCBS_frota + creditoCBS_terceiros + creditoCBS_agregados + (regime!=="Simples Nacional"?creditoCBS_imob:0);
  const totalCreditoIBS = creditoIBS_frota + creditoIBS_terceiros + creditoIBS_agregados + (regime!=="Simples Nacional"?creditoIBS_imob:0);
  const cbsDebitoTotal = cbsDebito + cbsDebitoImob;
  const ibsDebitoTotal = ibsDebito + ibsDebitoImob;

  const cbsSaldoCredor = Math.max(0, totalCreditoCBS - cbsDebitoTotal);
  const ibsSaldoCredor = Math.max(0, totalCreditoIBS - ibsDebitoTotal);
  const cbsRecolher = Math.max(0, cbsDebitoTotal - totalCreditoCBS);
  const ibsRecolher = Math.max(0, ibsDebitoTotal - totalCreditoIBS);

  return {
    cbsDebito: cbsDebitoTotal, ibsDebito: ibsDebitoTotal,
    creditoCBS_frota, creditoIBS_frota,
    creditoCBS_terceiros, creditoIBS_terceiros,
    creditoCBS_agregados, creditoIBS_agregados,
    totalCreditoCBS, totalCreditoIBS,
    creditoCBS_imob, creditoIBS_imob,
    cbsDebitoImob, ibsDebitoImob,
    cbsSaldoCredor, ibsSaldoCredor,
    totalSaldoCredor: cbsSaldoCredor + ibsSaldoCredor,
    cbsRecolher, ibsRecolher,
    totalRecolher: cbsRecolher + ibsRecolher,
    detalheFrota,
    custoFrota: detalheFrota.reduce((s,d) => s + d.custo, 0),
    custoTerceiros: usaTerceiros ? frete * (pctTerceiros / 100) : 0,
    custoAgregados: usaAgregados ? frete * (pctAgregados / 100) : 0,
    detalheTerceiros,
    detalheAgregados,
  };
}

const ALERTS = [
  {tag:"URGENTE",msg:"CT-e: campos IBS+CBS obrigatórios desde jan/2026 — sistemas devem estar atualizados",cor:C.red},
  {tag:"INFO",   msg:"Crédito CBS: ponderado pelo regime do fornecedor — de 1,86% (autônomo) a 9,3% (LP/LR)",cor:C.green},
  {tag:"URGENTE",msg:"23% das transportadoras se preparam para a reforma — ABCAM 2025",cor:C.red},
  {tag:"INFO",   msg:"LC 214/2025: CBS 9,3% a partir de 2027 | IBS escalonado 11,22%→18,7% de 2029 a 2033",cor:C.blue},
  {tag:"ALERTA", msg:"PIS e COFINS extintos em 2027 — adaptar DRE, sistemas e contratos agora",cor:C.amber},
];

// ── Context ──
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

// ── Hooks ──
function useClock() {
  const [t,setT]=useState(new Date());
  useEffect(()=>{const iv=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(iv);},[]);
  return t;
}
function useCountdown(target) {
  const [d,setD]=useState({d:0,h:0,m:0,s:0});
  useEffect(()=>{
    const tick=()=>{
      const ms=new Date(target).getTime()-Date.now();
      if(ms<=0){setD({d:0,h:0,m:0,s:0});return;}
      const s=Math.floor(ms/1000);
      setD({d:Math.floor(s/86400),h:Math.floor((s%86400)/3600),m:Math.floor((s%3600)/60),s:s%60});
    };
    tick(); const iv=setInterval(tick,1000); return()=>clearInterval(iv);
  },[target]);
  return d;
}
function useAlerts() {
  const [i,setI]=useState(0); const [v,setV]=useState(true);
  useEffect(()=>{
    const iv=setInterval(()=>{
      setV(false);
      setTimeout(()=>{setI(x=>(x+1)%ALERTS.length);setV(true);},280);
    },5000);
    return()=>clearInterval(iv);
  },[]);
  return {a:ALERTS[i],v};
}
function useIsMob() {
  const [m,setM]=useState(window.innerWidth<720);
  useEffect(()=>{
    const fn=()=>setM(window.innerWidth<720);
    window.addEventListener("resize",fn);
    return()=>window.removeEventListener("resize",fn);
  },[]);
  return m;
}

// ── UI Atoms ──
function SL({children,right}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <span style={{fontFamily:F.sans,fontSize:10,fontWeight:400,color:C.text2,letterSpacing:0.8,textTransform:"uppercase"}}>{children}</span>
      {right}
    </div>
  );
}
function Bdg({children,color}){
  const col=color||C.brand;
  return(
    <span style={{display:"inline-flex",alignItems:"center",background:col+"18",color:col,border:"1px solid "+col+"33",borderRadius:2,padding:"1px 6px",fontFamily:F.mono,fontSize:9,letterSpacing:0.5,flexShrink:0}}>
      {children}
    </span>
  );
}
function Sel({label,active,color,onClick}){
  const col=color||C.brand;
  return(
    <button onClick={onClick} style={{border:"1px solid "+(active?col:C.border),background:active?col+"18":C.bg1,color:active?col:C.text2,borderRadius:2,padding:"5px 11px",cursor:"pointer",fontFamily:F.sans,fontSize:11,transition:"all 0.12s",flexShrink:0}}>
      {label}
    </button>
  );
}
function Stat({label,value,color,sub}){
  return(
    <div>
      <div style={{fontFamily:F.sans,fontSize:10,color:C.text2,marginBottom:3}}>{label}</div>
      <div style={{fontFamily:F.mono,fontSize:18,fontWeight:500,color:color||C.text,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:F.sans,fontSize:10,color:C.text3,marginTop:2}}>{sub}</div>}
    </div>
  );
}
function D({my}){return <div style={{height:1,background:C.border,margin:(my||10)+"px 0"}}/>;}
function NInput({label,raw,setRaw,onBlur,prefix,suffix,hint}){
  return(
    <div>
      {label&&(
        <div style={{fontFamily:F.sans,fontSize:10,color:C.text2,marginBottom:5}}>
          {label}{hint&&<span style={{color:C.text3,marginLeft:4,fontSize:9}}>{hint}</span>}
        </div>
      )}
      <div style={{display:"flex",alignItems:"stretch",background:C.bg1,border:"1px solid "+C.border,borderRadius:2}}>
        {prefix&&<span style={{fontFamily:F.mono,fontSize:11,color:C.text2,padding:"0 8px",borderRight:"1px solid "+C.border,display:"flex",alignItems:"center"}}>{prefix}</span>}
        <input type="text" inputMode="numeric" value={raw}
          onChange={e=>setRaw(e.target.value)} onBlur={onBlur}
          onFocus={e=>e.target.select()} onKeyDown={e=>e.key==="Enter"&&onBlur()}
          style={{flex:1,padding:"8px 10px",background:"transparent",border:"none",outline:"none",fontFamily:F.mono,fontSize:13,color:C.text}}/>
        {suffix&&<span style={{fontFamily:F.mono,fontSize:11,color:C.text2,padding:"0 9px",borderLeft:"1px solid "+C.border,display:"flex",alignItems:"center"}}>{suffix}</span>}
      </div>
    </div>
  );
}

// ── Checkbox de despesa sem crédito ──
function DespesaSCCheck({desp, ativo, pct, frete, onToggle, onPctChange}) {
  const [rawPct, setRawPct] = useState(String(pct));
  useEffect(() => setRawPct(String(pct)), [pct]);
  const blur = () => {
    const n = parseFloat(rawPct);
    if (!isNaN(n) && n >= 0 && n <= 100) onPctChange(n);
    else setRawPct(String(pct));
  };
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:ativo?"rgba(220,38,38,0.06)":C.bg2,border:"1px solid "+(ativo?C.red+"44":C.border),borderRadius:2,transition:"all 0.15s"}}>
      <input type="checkbox" checked={ativo} onChange={onToggle}
        style={{width:14,height:14,accentColor:C.red,cursor:"pointer",flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:F.sans,fontSize:10,color:ativo?C.text:C.text2,fontWeight:ativo?500:400}}>{desp.nome}</div>
        <div style={{fontFamily:F.sans,fontSize:8,color:C.text3}}>{desp.descricao}</div>
      </div>
      {ativo && (
        <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
          <input type="text" inputMode="numeric" value={rawPct}
            onChange={e=>setRawPct(e.target.value)} onBlur={blur}
            onFocus={e=>e.target.select()} onKeyDown={e=>e.key==="Enter"&&blur()}
            style={{width:40,padding:"3px 5px",background:C.bg1,border:"1px solid "+C.border,borderRadius:2,fontFamily:F.mono,fontSize:10,color:C.text,textAlign:"right",outline:"none"}}/>
          <span style={{fontFamily:F.mono,fontSize:9,color:C.text3}}>%</span>
          <span style={{fontFamily:F.mono,fontSize:9,color:C.red,flexShrink:0}}>
            ≈ R$ {(frete*pct/100).toLocaleString("pt-BR",{maximumFractionDigits:0})}/mês
          </span>
        </div>
      )}
    </div>
  );
}

// ── Checkbox de insumo ──
function InsumoCheck({insumo, ativo, custo, onToggle, onCustoChange}) {
  const [rawCusto, setRawCusto] = useState(String(custo));
  useEffect(() => setRawCusto(String(custo)), [custo]);
  const blur = () => {
    const n = parseFloat(rawCusto);
    if (!isNaN(n) && n >= 0 && n <= 100) onCustoChange(n);
    else setRawCusto(String(custo));
  };
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:ativo?C.brandLt:C.bg2,border:"1px solid "+(ativo?C.brand+"44":C.border),borderRadius:2,transition:"all 0.15s"}}>
      <input type="checkbox" checked={ativo} onChange={onToggle}
        style={{width:14,height:14,accentColor:C.brand,cursor:"pointer",flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:F.sans,fontSize:10,color:ativo?C.text:C.text2,fontWeight:ativo?500:400}}>{insumo.nome}</div>
        <div style={{fontFamily:F.sans,fontSize:8,color:C.text3}}>{insumo.descricao}</div>
      </div>
      {ativo && (
        <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
          <input type="text" inputMode="numeric" value={rawCusto}
            onChange={e=>setRawCusto(e.target.value)} onBlur={blur}
            onFocus={e=>e.target.select()} onKeyDown={e=>e.key==="Enter"&&blur()}
            style={{width:40,padding:"3px 5px",background:C.bg1,border:"1px solid "+C.border,borderRadius:2,fontFamily:F.mono,fontSize:10,color:C.text,textAlign:"right",outline:"none"}}/>
          <span style={{fontFamily:F.mono,fontSize:9,color:C.text3}}>%</span>
        </div>
      )}
    </div>
  );
}

// ── Charts ──
function TransicaoChart(){
  const w=320,h=110,pad=28;
  const maxY=30;
  const xS=(i)=>pad+(i/(MILES.length-1))*(w-pad*2);
  const yS=(v)=>h-pad-(v/maxY)*(h-pad*1.5);
  const cbs=MILES.map(m=>m.cbs);
  const iva=MILES.map(m=>m.total);
  const mkLine=(data)=>data.map((v,i)=>xS(i).toFixed(1)+","+yS(v).toFixed(1)).join(" ");
  const mkArea=(data,_base)=>[
    "M"+xS(0).toFixed(1)+","+yS(_base).toFixed(1),
    ...data.map((v,i)=>"L"+xS(i).toFixed(1)+","+yS(v).toFixed(1)),
    "L"+xS(data.length-1).toFixed(1)+","+yS(_base).toFixed(1),"Z"
  ].join(" ");
  return(
    <svg width="100%" viewBox={"0 0 "+w+" "+h} preserveAspectRatio="xMidYMid meet">
      {[0,10,20,30].map(v=>(
        <g key={v}>
          <line x1={pad} y1={yS(v)} x2={w-pad} y2={yS(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3"/>
          <text x={pad-3} y={yS(v)} textAnchor="end" dominantBaseline="middle" style={{fontFamily:F.sans,fontSize:7,fill:C.text3}}>{v}%</text>
        </g>
      ))}
      <path d={mkArea(cbs,0)} fill={C.blue+"18"}/>
      <polyline points={mkLine(cbs)} fill="none" stroke={C.blue} strokeWidth={1.5} strokeLinejoin="round"/>
      <path d={mkArea(iva,0)} fill={C.brand+"18"}/>
      <polyline points={mkLine(iva)} fill="none" stroke={C.brand} strokeWidth={1.5} strokeLinejoin="round"/>
      {MILES.map((m,i)=>(
        <text key={i} x={xS(i)} y={h-3} textAnchor="middle" style={{fontFamily:F.sans,fontSize:7,fill:C.text3}}>{m.ano}</text>
      ))}
    </svg>
  );
}

function CargaChart(){
  const rows=[
    {label:"Simples Nacional", depois:22.0, obs:"SN não apropria crédito CBS"},
    {label:"Lucro Presumido",  depois:14.2, obs:"65% aproveitamento de crédito"},
    {label:"Lucro Real",       depois:11.2, obs:"Aproveitamento pleno de crédito"},
  ];
  const max=24;
  return(
    <div>
      <div style={{display:"flex",gap:16,marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:3,background:C.brand,borderRadius:1}}/><span style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>IVA Dual 2033 (carga efetiva)</span></div>
      </div>
      {rows.map((r,i)=>(
        <div key={i} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>{r.label}</span>
            <span style={{fontFamily:F.mono,fontSize:11,color:C.brand,fontWeight:500}}>{r.depois}%</span>
          </div>
          <div style={{position:"relative",height:7,borderRadius:2,overflow:"hidden",background:C.bg3}}>
            <div style={{position:"absolute",top:0,left:0,height:"100%",width:(r.depois/max*100)+"%",background:C.brand,transition:"width 0.6s"}}/>
          </div>
          <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,marginTop:3}}>{r.obs}</div>
        </div>
      ))}
    </div>
  );
}

function AcoesPanel(){
  const rows=[
    {area:"CT-e e NF-e",   status:"URGENTE",prazo:"Ago 2026",cor:C.red,
     acao:"Atualizar layout do CT-e com campos IBS e CBS obrigatórios",
     imp:"Multa por emissão incorreta de documento fiscal"},
    {area:"TMS e ERP",     status:"URGENTE",prazo:"Dez 2026",cor:C.red,
     acao:"Certificar que sistemas de gestão emitem documentos no novo padrão",
     imp:"Risco de glosamento de créditos e inconsistência fiscal"},
    {area:"Créditos CBS",  status:"OPORT.", prazo:"Jan 2027",cor:C.green,
     acao:"Mapear mix de fornecedores (autônomo/SN/LP-LR) para calcular crédito real de CBS",
     imp:"Mix padrão TRC = 3,73% crédito médio. Aproveitamento incorreto = perda direta."},
    {area:"Contratos",     status:"ATENÇÃO",prazo:"Jun 2027",cor:C.amber,
     acao:"Inserir cláusula de reajuste tributário em contratos de longo prazo",
     imp:"Garante repasse do IVA Dual sem compressão de margem"},
    {area:"Capacitação",   status:"ATENÇÃO",prazo:"2026",    cor:C.amber,
     acao:"Treinar equipe fiscal nas regras do IBS, CBS e período de transição",
     imp:"Apenas 23% das transportadoras iniciaram (ABCAM 2025)"},
  ];
  return(
    <div>
      {rows.map((r,i)=>(
        <div key={i} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:i<rows.length-1?"1px solid "+C.border:"none",alignItems:"flex-start"}}>
          <div style={{width:3,flexShrink:0,alignSelf:"stretch",background:r.cor,borderRadius:1}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,gap:6}}>
              <span style={{fontFamily:F.sans,fontSize:11,fontWeight:500,color:C.text}}>{r.area}</span>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                <span style={{fontFamily:F.mono,fontSize:8,color:r.cor}}>{r.prazo}</span>
                <span style={{background:r.cor+"15",color:r.cor,border:"1px solid "+r.cor+"30",borderRadius:2,padding:"0 5px",fontFamily:F.mono,fontSize:8}}>{r.status}</span>
              </div>
            </div>
            <div style={{fontFamily:F.sans,fontSize:10,color:C.text2,lineHeight:1.5,marginBottom:2}}>{r.acao}</div>
            <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,lineHeight:1.4}}>Impacto: {r.imp}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// PAINEL
// ══════════════════════════════════════════════════════════
function Painel(){
  const {ano,setAno,isMob}=useApp();
  const clock=useClock();
  const cd=useCountdown("2027-01-01T00:00:00");
  const {a,v}=useAlerts();
  const m=MILES.find((x)=>x.ano===ano)||MILES[0];

  return(
    <div>
      {/* Top strip */}
      <div style={{background:C.bg1,borderBottom:"1px solid "+C.border,padding:"12px 16px"}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:28,alignItems:"flex-start"}}>
          <div>
            <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,letterSpacing:0.8,marginBottom:6,textTransform:"uppercase"}}>CBS ativa (9,3%) em</div>
            <div style={{display:"flex",gap:2,alignItems:"baseline"}}>
              {[{v:cd.d,l:"d"},{v:cd.h,l:"h"},{v:cd.m,l:"m"},{v:cd.s,l:"s"}].map((u,i)=>(
                <div key={i} style={{display:"flex",alignItems:"baseline",gap:1}}>
                  <span style={{fontFamily:F.mono,fontSize:22,fontWeight:500,color:C.brand}}>{String(u.v).padStart(2,"0")}</span>
                  <span style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginRight:3}}>{u.l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
            <Stat label="CBS a partir de 2027"  value="9,3%"  color={C.blue}   sub="LC 214/2025"/>
            <Stat label="IVA nominal 2033"       value="28,0%" color={C.red}    sub="CBS 9,3% + IBS 18,7%"/>
            <Stat label="Crédito CBS mix TRC"    value="3,73%" color={C.green}  sub="20% autôn / 60% SN / 20% LP"/>
            <Stat label="Período de transição"  value="7 anos" sub="2027 a 2033"/>
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontFamily:F.mono,fontSize:16,fontWeight:500,color:C.brand}}>{clock.toLocaleTimeString("pt-BR")}</div>
            <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginTop:2}}>
              {clock.toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end",marginTop:4}}>
              <span style={{width:5,height:5,borderRadius:"50%",background:C.green,display:"inline-block",animation:"liveDot 2s infinite"}}/>
              <span style={{fontFamily:F.sans,fontSize:9,color:C.green}}>AO VIVO</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert ticker */}
      <div style={{background:C.bg1,borderBottom:"1px solid "+C.border,padding:"6px 16px",display:"flex",gap:10,alignItems:"center",minHeight:34,opacity:v?1:0,transition:"opacity 0.25s"}}>
        <Bdg color={a.cor}>{a.tag}</Bdg>
        <span style={{fontFamily:F.sans,fontSize:11,color:C.text2,lineHeight:1.4}}>{a.msg}</span>
      </div>

      {/* 3-col grid */}
      <div style={{display:"grid",gridTemplateColumns:isMob?"1fr":"repeat(3,minmax(0,1fr))",gap:1}}>
        {/* Col 1 — Timeline + Substituições */}
        <div style={{display:"flex",flexDirection:"column",gap:1}}>
          <div style={{background:C.bg1,padding:"14px 16px"}}>
            <SL right={<span style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>Clique para detalhar</span>}>Linha do tempo 2027–2033</SL>
            <div style={{display:"flex",gap:1,marginBottom:10}}>
              {MILES.map(mi=>(
                <button key={mi.ano} onClick={()=>setAno(mi.ano)}
                  style={{flex:1,border:"1px solid "+(mi.ano===ano?mi.cor:C.border),background:mi.ano===ano?mi.cor+"18":C.bg2,borderRadius:2,cursor:"pointer",padding:"7px 2px",textAlign:"center",transition:"all 0.12s"}}>
                  <div style={{fontFamily:F.mono,fontSize:10,fontWeight:500,color:mi.ano===ano?mi.cor:C.text3}}>{mi.ano}</div>
                </button>
              ))}
            </div>
            <div style={{background:C.bg2,border:"1px solid "+C.border,borderLeft:"2px solid "+m.cor,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
                <span style={{fontFamily:F.sans,fontSize:12,fontWeight:500,color:m.cor}}>{m.ano} — {m.label}</span>
                <Bdg color={m.cor}>{m.ano>=2033?"VIGENTE":"TRANSIÇÃO"}</Bdg>
              </div>
              <div style={{fontFamily:F.sans,fontSize:11,color:C.text2,lineHeight:1.6,marginBottom:10}}>{m.desc}</div>
              <div style={{display:"grid",gridTemplateColumns:isMob?"repeat(3,1fr)":"repeat(3,1fr)",gap:6}}>
                {[
                  {l:"CBS",      v:m.cbs+"%",   c:C.blue},
                  {l:"IBS",      v:m.ibs+"%",   c:C.purple},
                  {l:"IVA Total",v:m.total+"%", c:m.cor},
                ].map((r,i)=>(
                  <div key={i} style={{background:C.bg1,border:"1px solid "+C.border,padding:"6px 8px"}}>
                    <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:3}}>{r.l}</div>
                    <div style={{fontFamily:F.mono,fontSize:14,fontWeight:500,color:r.c}}>{r.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{background:C.bg1,padding:"14px 16px",flex:1}}>
            <SL>Substituições tributárias</SL>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:"1px solid "+C.border}}>
                  {["Tributo Extinto","Substituto","Quando"].map(h=>(
                    <th key={h} style={{fontFamily:F.sans,fontSize:9,color:C.text2,padding:"4px 0",textAlign:"left",fontWeight:400}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {de:"PIS (Federal)",   por:"IBS (Est./Mun.)",  fim:"Jan 2027",cD:C.amber,cP:C.purple,
                   obs:"PIS 0,65% → será absorvido pelo IBS estadual/municipal"},
                  {de:"COFINS (Federal)",por:"CBS (Federal)",     fim:"Jan 2027",cD:C.amber,cP:C.blue,
                   obs:"COFINS 3% → substituída pela CBS a 9,3%"},
                  {de:"ICMS (Estadual)", por:"IBS (Est./Mun.)",  fim:"Dez 2033",cD:C.teal, cP:C.purple,
                   obs:"ICMS ~12% → extinto gradualmente, absorvido pelo IBS"},
                  {de:"ISS (Municipal)", por:"IBS (Est./Mun.)",  fim:"Dez 2033",cD:C.teal, cP:C.purple,
                   obs:"ISS 2-5% → absorvido pelo IBS"},
                  {de:"IPI (Federal)",   por:"IS Seletivo",      fim:"Jan 2027",cD:C.text2,cP:C.brand,
                   obs:"IPI → Imposto Seletivo sobre bens nocivos"},
                ].map((r,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid "+C.border}}>
                    <td style={{padding:"8px 0",verticalAlign:"top"}}>
                      <div style={{fontFamily:F.mono,fontSize:10,color:r.cD}}>{r.de}</div>
                      <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginTop:2}}>{r.obs}</div>
                    </td>
                    <td style={{fontFamily:F.mono,fontSize:10,color:r.cP,verticalAlign:"top",padding:"8px 0"}}>{r.por}</td>
                    <td style={{fontFamily:F.mono,fontSize:10,color:C.amber,verticalAlign:"top",padding:"8px 0"}}>{r.fim}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Col 2 — Gráficos */}
        <div style={{display:"flex",flexDirection:"column",gap:1}}>
          <div style={{background:C.bg1,padding:"14px 16px"}}>
            <SL right={<span style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>Carga efetiva 2033 por regime</span>}>Impacto por regime tributário</SL>
            <CargaChart/>
          </div>
          <div style={{background:C.bg1,padding:"14px 16px",flex:1}}>
            <SL right={
              <div style={{display:"flex",gap:12}}>
                <span style={{display:"flex",alignItems:"center",gap:4,fontFamily:F.sans,fontSize:9,color:C.text3}}>
                  <div style={{width:8,height:2,background:C.blue,borderRadius:1}}/> CBS
                </span>
                <span style={{display:"flex",alignItems:"center",gap:4,fontFamily:F.sans,fontSize:9,color:C.text3}}>
                  <div style={{width:8,height:2,background:C.brand,borderRadius:1}}/> IVA Dual
                </span>
              </div>
            }>Transição CBS × IVA Dual</SL>
            <TransicaoChart/>
            <div style={{marginTop:8,fontFamily:F.sans,fontSize:10,color:C.text2,lineHeight:1.6}}>
              CBS entra em 2027 com 9,3%. IBS entra em 2029 de forma escalonada. Em 2033, IVA Dual chega a 28% nominal — com créditos plenos, carga efetiva cai para ~10-14%.
            </div>
          </div>
        </div>

        {/* Col 3 — Status + Ações */}
        <div style={{display:"flex",flexDirection:"column",gap:1}}>
          <div style={{background:C.bg1,padding:"14px 16px"}}>
            <SL>Status legislativo</SL>
            {[
              {l:"EC 132/2023",        v:"VIGENTE",      c:C.green},
              {l:"LC 214/2025",        v:"VIGENTE",      c:C.green},
              {l:"CBS 9,3% (2027)",    v:"JAN 2027",     c:C.blue},
              {l:"IBS Entra (2029)",   v:"JAN 2029",     c:C.purple},
              {l:"PIS/COFINS extinção",v:"JAN 2027",     c:C.amber},
              {l:"ICMS extinção",      v:"DEZ 2033",     c:C.red},
            ].map((s,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:i<5?"1px solid "+C.border:"none"}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>{s.l}</span>
                <span style={{fontFamily:F.mono,fontSize:11,color:s.c}}>{s.v}</span>
              </div>
            ))}
          </div>
          <div style={{background:C.bg1,padding:"14px 16px",flex:1}}>
            <SL right={
              <div style={{display:"flex",gap:8}}>
                <Bdg color={C.red}>URGENTE</Bdg>
                <Bdg color={C.amber}>ATENÇÃO</Bdg>
                <Bdg color={C.green}>OPORT.</Bdg>
              </div>
            }>Ações prioritárias</SL>
            <AcoesPanel/>
          </div>
        </div>
      </div>

      {/* ── Impacto por tipo de operação ── */}
      <div style={{background:C.bg1,borderTop:"1px solid "+C.border,padding:"14px 16px"}}>
        <SL right={<Bdg color={C.brand}>CBS + IBS · LC 214/2025</Bdg>}>Impacto da Reforma Tributária por tipo de operação</SL>
        <div style={{marginBottom:10,padding:"8px 12px",background:C.brandLt,border:"1px solid "+C.brand+"33",fontFamily:F.sans,fontSize:10,color:C.text2}}>
          Alíquotas exibidas conforme o ano selecionado acima — clique nos botões de ano para atualizar os cards.
        </div>
        <div style={{display:"grid",gridTemplateColumns:isMob?"1fr":"repeat(2,minmax(0,1fr))",gap:12}}>

          {/* ── FROTA PRÓPRIA ── */}
          <div style={{border:"1px solid "+C.blue+"44",borderTop:"3px solid "+C.blue,padding:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{fontSize:18}}>🚛</span>
              <div>
                <div style={{fontFamily:F.sans,fontSize:13,fontWeight:400,color:C.blue}}>Frota Própria</div>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>Veículos próprios — crédito pleno sobre insumos</div>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,fontWeight:400,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Alíquotas em {ano}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                {[
                  {l:"CBS",  v:m.cbs+"%",             c:C.blue,   bg:C.blueLt},
                  {l:"IBS",  v:m.ibs>0?m.ibs+"%":"—", c:C.purple, bg:"rgba(124,58,237,0.06)"},
                  {l:"Total",v:m.total+"%",            c:m.cor,    bg:m.cor+"18"},
                ].map((r,i)=>(
                  <div key={i} style={{background:r.bg,border:"1px solid "+r.c+"33",padding:"8px",textAlign:"center",borderRadius:2}}>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text2,marginBottom:4}}>{r.l}</div>
                    <div style={{fontFamily:F.mono,fontSize:16,fontWeight:500,color:r.c,lineHeight:1}}>{r.v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:8,height:6,borderRadius:2,background:C.bg3,overflow:"hidden"}}>
                <div style={{height:"100%",width:(m.total/28*100)+"%",background:m.cor,transition:"width 0.5s"}}/>
              </div>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,marginTop:3}}>
                {m.total<28?`${(28-m.total).toFixed(2)}pp abaixo do IVA Dual pleno (28%)`:"IVA Dual pleno atingido"}
              </div>
            </div>
            <div style={{padding:"8px 10px",background:C.blueLt,border:"1px solid "+C.blue+"33",borderLeft:"2px solid "+C.blue,marginBottom:8}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.blue,fontWeight:400,marginBottom:4}}>✓ CRÉDITO PLENO sobre insumos</div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {["Diesel / GNV / Gasolina","Peças e pneus","Manutenção preventiva e corretiva","Pedágios"].map((item,i)=>(
                  <div key={i} style={{fontFamily:F.sans,fontSize:9,color:C.text2}}>• {item}</div>
                ))}
              </div>
            </div>
            <div style={{padding:"6px 10px",background:C.greenLt,border:"1px solid "+C.green+"33",borderRadius:2}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.green,fontWeight:400}}>Carga efetiva (2033) estimada</div>
              <div style={{fontFamily:F.mono,fontSize:13,color:C.green,fontWeight:500}}>~11–14%</div>
              <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginTop:2}}>com aproveitamento pleno de créditos sobre insumos (~55% do faturamento)</div>
            </div>
          </div>

          {/* ── TERCEIROS ── */}
          <div style={{border:"1px solid "+C.amber+"44",borderTop:"3px solid "+C.amber,padding:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{fontSize:18}}>👥</span>
              <div>
                <div style={{fontFamily:F.sans,fontSize:13,fontWeight:400,color:C.amber}}>Terceiros / Subcontratados</div>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>Transportadores contratados via CT-e — crédito pelo regime do prestador</div>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,fontWeight:400,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Alíquotas em {ano}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                {[
                  {l:"CBS",  v:m.cbs+"%",             c:C.blue,   bg:C.blueLt},
                  {l:"IBS",  v:m.ibs>0?m.ibs+"%":"—", c:C.purple, bg:"rgba(124,58,237,0.06)"},
                  {l:"Total",v:m.total+"%",            c:m.cor,    bg:m.cor+"18"},
                ].map((r,i)=>(
                  <div key={i} style={{background:r.bg,border:"1px solid "+r.c+"33",padding:"8px",textAlign:"center",borderRadius:2}}>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text2,marginBottom:4}}>{r.l}</div>
                    <div style={{fontFamily:F.mono,fontSize:16,fontWeight:500,color:r.c,lineHeight:1}}>{r.v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:8,height:6,borderRadius:2,background:C.bg3,overflow:"hidden"}}>
                <div style={{height:"100%",width:(m.total/28*100)+"%",background:m.cor,transition:"width 0.5s"}}/>
              </div>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,marginTop:3}}>
                {m.total<28?`${(28-m.total).toFixed(2)}pp abaixo do IVA Dual pleno (28%)`:"IVA Dual pleno atingido"}
              </div>
            </div>
            <div style={{padding:"8px 10px",background:C.amberLt,border:"1px solid "+C.amber+"33",borderLeft:"2px solid "+C.amber,marginBottom:8}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.amber,fontWeight:400,marginBottom:6}}>Crédito CBS pelo regime do terceiro</div>
              {[
                {regime:"Autônomo (TAC/TRC)",  cred:"1,86%", cor:C.red,   obs:"sobre o valor pago (líquido de margem)"},
                {regime:"Simples Nacional",     cred:"2,50%", cor:C.amber, obs:"sobre o valor pago (líquido de margem)"},
                {regime:"Lucro Presumido/Real", cred:"9,3%",  cor:C.green, obs:"sobre o valor pago (líquido de margem)"},
              ].map((r,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:i<2?"1px solid "+C.border+"88":"none"}}>
                  <div>
                    <div style={{fontFamily:F.sans,fontSize:9,color:C.text2}}>{r.regime}</div>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text3}}>{r.obs}</div>
                  </div>
                  <span style={{fontFamily:F.mono,fontSize:11,color:r.cor,fontWeight:500}}>{r.cred}</span>
                </div>
              ))}
            </div>
            <div style={{padding:"6px 10px",background:C.redLt,border:"1px solid "+C.red+"33",borderRadius:2}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.red,fontWeight:400}}>Mix padrão TRC: crédito CBS médio ~3,73%</div>
              <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginTop:2}}>20% autôn + 60% SN + 20% LP. Quanto maior a participação de LP/LR, maior o crédito recuperado.</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ORACLE — SIMULADOR (3 TELAS: FROTA / TERCEIROS / AGREGADOS)
// ══════════════════════════════════════════════════════════
function Oracle(){
  const {frete,setFrete,frota,setFrota,regime,setRegime,ano,setAno,
         pctExportacao,setPctExportacao,
         usaFrota,setUsaFrota,pctFrota,setPctFrota,
         insumosAtivos,setInsumosAtivos,insumosCusto,setInsumosCusto,
         usaTerceiros,setUsaTerceiros,pctTerceiros,setPctTerceiros,
         mixAutonomo,setMixAutonomo,mixSN,setMixSN,mixLucro,setMixLucro,margemTerceiros,setMargemTerceiros,regimeLucroTerceiros,setRegimeLucroTerceiros,
         insumosAtivosTerceiros,setInsumosAtivosTerceiros,insumosCustoTerceiros,setInsumosCustoTerceiros,
         usaAgregados,setUsaAgregados,pctAgregados,setPctAgregados,
         regimeAgregado,setRegimeAgregado,margemAgregados,setMargemAgregados,
         valorCompraImob,setValorCompraImob,valorVendaImob,setValorVendaImob,
         insumosAtivosAgregados,setInsumosAtivosAgregados,insumosCustoAgregados,setInsumosCustoAgregados,
         despesasSCAtivas,setDespesasSCAtivas,despesasSCCusto,setDespesasSCCusto,
         precoDiesel,setPrecoDiesel,isMob}=useApp();

  const [rf,setRf]=useState(frete.toLocaleString("pt-BR"));
  const [rv,setRv]=useState(String(frota));
  const [rExp,setRExp]=useState(String(pctExportacao));
  const [rPF,setRPF]=useState(String(pctFrota));
  const [rPT,setRPT]=useState(String(pctTerceiros));
  const [rPA,setRPA]=useState(String(pctAgregados));
  const [rA,setRA]=useState(String(mixAutonomo));
  const [rS,setRS]=useState(String(mixSN));
  const [rL,setRL]=useState(String(mixLucro));
  const [rMT,setRMT]=useState(String(margemTerceiros));
  const [rMA,setRMA]=useState(String(margemAgregados));
  const [rCI,setRCI]=useState(String(valorCompraImob));
  const [rVI,setRVI]=useState(String(valorVendaImob));
  const [rDiesel,setRDiesel]=useState(String(precoDiesel));
  const [subTab,setSubTab]=useState("terceiros");
  const [collapsed,setCollapsed]=useState({});
  const togCol=(k)=>setCollapsed(p=>({...p,[k]:!p[k]}));

  useEffect(()=>setRf(frete.toLocaleString("pt-BR")),[frete]);
  useEffect(()=>setRv(String(frota)),[frota]);
  useEffect(()=>setRExp(String(pctExportacao)),[pctExportacao]);
  useEffect(()=>setRPF(String(pctFrota)),[pctFrota]);
  useEffect(()=>setRPT(String(pctTerceiros)),[pctTerceiros]);
  useEffect(()=>setRPA(String(pctAgregados)),[pctAgregados]);
  useEffect(()=>setRA(String(mixAutonomo)),[mixAutonomo]);
  useEffect(()=>setRS(String(mixSN)),[mixSN]);
  useEffect(()=>setRL(String(mixLucro)),[mixLucro]);
  useEffect(()=>setRMT(String(margemTerceiros)),[margemTerceiros]);
  useEffect(()=>setRMA(String(margemAgregados)),[margemAgregados]);
  useEffect(()=>setRCI(String(valorCompraImob)),[valorCompraImob]);
  useEffect(()=>setRVI(String(valorVendaImob)),[valorVendaImob]);
  useEffect(()=>setRDiesel(String(precoDiesel)),[precoDiesel]);

  const cf=()=>{const n=parseInt(rf.replace(/\D/g,""),10);if(n>0){setFrete(n);setRf(n.toLocaleString("pt-BR"));}else setRf(frete.toLocaleString("pt-BR"));};
  const cv=()=>{const n=parseInt(rv,10);if(!isNaN(n)&&n>0&&n<=9999)setFrota(n);else setRv(String(frota));};
  const cExp=()=>{const n=parseInt(rExp,10);if(!isNaN(n)&&n>=0&&n<=100)setPctExportacao(n);else setRExp(String(pctExportacao));};
  const cPF=()=>{const n=parseInt(rPF,10);if(!isNaN(n)&&n>=0&&n<=100)setPctFrota(n);else setRPF(String(pctFrota));};
  const cPT=()=>{const n=parseInt(rPT,10);if(!isNaN(n)&&n>=0&&n<=100)setPctTerceiros(n);else setRPT(String(pctTerceiros));};
  const cPA=()=>{const n=parseInt(rPA,10);if(!isNaN(n)&&n>=0&&n<=100)setPctAgregados(n);else setRPA(String(pctAgregados));};
  const cA=()=>{const n=parseInt(rA,10);if(!isNaN(n)&&n>=0&&n<=100)setMixAutonomo(n);else setRA(String(mixAutonomo));};
  const cS=()=>{const n=parseInt(rS,10);if(!isNaN(n)&&n>=0&&n<=100)setMixSN(n);else setRS(String(mixSN));};
  const cL=()=>{const n=parseInt(rL,10);if(!isNaN(n)&&n>=0&&n<=100)setMixLucro(n);else setRL(String(mixLucro));};
  const cMT=()=>{const n=parseInt(rMT,10);if(!isNaN(n)&&n>=0&&n<100)setMargemTerceiros(n);else setRMT(String(margemTerceiros));};
  const cMA=()=>{const n=parseInt(rMA,10);if(!isNaN(n)&&n>=0&&n<100)setMargemAgregados(n);else setRMA(String(margemAgregados));};
  const cCI=()=>{const n=parseInt(rCI.replace(/\D/g,""),10);if(!isNaN(n)&&n>=0)setValorCompraImob(n);else setRCI(String(valorCompraImob));};
  const cVI=()=>{const n=parseInt(rVI.replace(/\D/g,""),10);if(!isNaN(n)&&n>=0)setValorVendaImob(n);else setRVI(String(valorVendaImob));};
  const cDiesel=()=>{const n=parseFloat(rDiesel.replace(",","."));if(!isNaN(n)&&n>0&&n<=20)setPrecoDiesel(n);else setRDiesel(String(precoDiesel));};

  const m=MILES.find((x)=>x.ano===ano)||MILES[0];

  const toggleInsumo = (id) => {
    setInsumosAtivos((prev) => ({...prev, [id]: !prev[id]}));
  };
  const setInsumoCusto = (id, v) => {
    setInsumosCusto((prev) => ({...prev, [id]: v}));
  };
  const toggleInsumoTerceiros = (id) => setInsumosAtivosTerceiros(prev => ({...prev, [id]: !prev[id]}));
  const setInsumoCustoTerceiros = (id, v) => setInsumosCustoTerceiros(prev => ({...prev, [id]: v}));
  const toggleInsumoAgregados = (id) => setInsumosAtivosAgregados(prev => ({...prev, [id]: !prev[id]}));
  const setInsumoCustoAgregados = (id, v) => setInsumosCustoAgregados(prev => ({...prev, [id]: v}));
  const toggleDespesaSC = (id) => setDespesasSCAtivas(prev => ({...prev, [id]: !prev[id]}));
  const setDespesaSCCusto = (id, v) => setDespesasSCCusto(prev => ({...prev, [id]: v}));

  // ═══ CÁLCULO ═══
  const lucroRateTerceiros = regimeLucroTerceiros==="Lucro Real" ? 9.3 : 9.25;
  // Oracle é calculadora standalone de terceirização — força 100% terceiros, sem frota/agregados
  const reforma = calcReforma({
    frete, regime, pctExportacao,
    cbsAliq: m.cbs, ibsAliq: m.ibs,
    usaFrota: false, pctFrota: 0, insumosAtivos, insumosCusto,
    usaTerceiros: true, pctTerceiros: 100, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros,
    insumosAtivosTerceiros, insumosCustoTerceiros,
    usaAgregados: false, pctAgregados: 0, regimeAgregado, margemAgregados,
    insumosAtivosAgregados, insumosCustoAgregados,
    valorCompraImob, valorVendaImob,
  });

  const calcTot=(mi)=>{
    return calcReforma({
      frete, regime, pctExportacao,
      cbsAliq: mi.cbs, ibsAliq: mi.ibs,
      usaFrota: false, pctFrota: 0, insumosAtivos, insumosCusto,
      usaTerceiros: true, pctTerceiros: 100, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros,
      insumosAtivosTerceiros, insumosCustoTerceiros,
      usaAgregados: false, pctAgregados: 0, regimeAgregado, margemAgregados,
      insumosAtivosAgregados, insumosCustoAgregados,
      valorCompraImob, valorVendaImob,
    }).totalRecolher;
  };

  const pctCarga = reforma.totalRecolher / frete * 100;
  const debito   = reforma.cbsDebito + reforma.ibsDebito;
  const credTot  = reforma.totalCreditoCBS + reforma.totalCreditoIBS;
  const eficCred = debito>0?(credTot/debito*100):0;
  const cbsMedTerceiros = calcCBSCredito(mixAutonomo,mixSN,mixLucro,lucroRateTerceiros);
  const baseExec = frete*(1-pctExportacao/100);
  // Créditos PIS/COFINS para LR (não-cumulativo 9,25%) — mesmos insumos da frota
  let creditoHojeLR = 0;
  if(regime==="Lucro Real"){
    if(usaFrota && pctFrota>0){
      const baseFrota=frete*(pctFrota/100);
      Object.entries(insumosAtivos).forEach(([id,ativo])=>{if(ativo)creditoHojeLR+=baseFrota*(insumosCusto[id]||0)/100*0.0925;});
    }
    if(usaTerceiros && pctTerceiros>0){
      const baseTer=frete*(pctTerceiros/100)*(1-(margemTerceiros||0)/100);
      // Pesos: autônomo 0%, SN ~2.5%, LP/LR 9.25%
      const tot=mixAutonomo+mixSN+mixLucro||1;
      const taxaMed=((mixSN/tot)*2.5+(mixLucro/tot)*9.25)/100;
      creditoHojeLR+=baseTer*taxaMed;
    }
  }
  const debitoHojeBruto = baseExec*(regime==="Lucro Real"?0.0925:0.0365);
  const hoje     = regime==="Lucro Real" ? Math.max(0,debitoHojeBruto-creditoHojeLR) : debitoHojeBruto;
  const pctHojeEfetivo = frete>0?(hoje/frete*100):0;
  const descHoje = regime==="Lucro Real"
    ? `PIS+COFINS 9,25% líquido (${pctHojeEfetivo.toFixed(2)}% efetivo)`
    : "PIS+COFINS 3,65%";
  const liqAno   = reforma.totalRecolher;
  const liq2033  = calcReforma({frete,regime,pctExportacao,cbsAliq:9.3,ibsAliq:18.7,
    usaFrota,pctFrota,insumosAtivos,insumosCusto,
    usaTerceiros,pctTerceiros,mixAutonomo,mixSN,mixLucro,margemTerceiros,lucroRateTerceiros,
    insumosAtivosTerceiros,insumosCustoTerceiros,
    usaAgregados,pctAgregados,regimeAgregado,margemAgregados,
    insumosAtivosAgregados,insumosCustoAgregados,
    valorCompraImob,valorVendaImob}).totalRecolher;
  const vAno    = (liqAno-hoje)/Math.max(hoje,1)*100;
  const v33     = (liq2033-hoje)/Math.max(hoje,1)*100;
  const colAno  = vAno>0?C.red:C.green;
  const col33   = v33>0?C.red:C.green;
  const por1k   = liqAno/frete*1000;
  const hoje1k  = hoje/frete*1000;
  const max3    = Math.max(hoje,liqAno,liq2033,1);
  const bar     = (val,cor)=>(
    <div style={{height:6,borderRadius:2,background:C.bg3,overflow:"hidden",marginTop:6}}>
      <div style={{height:"100%",width:(val/max3*100)+"%",background:cor,transition:"width 0.5s"}}/>
    </div>
  );
  const ops=[];
  if(credTot>0)ops.push({cor:C.green,titulo:"Créditos aproveitados",
    txt:`R$ ${credTot.toLocaleString("pt-BR",{maximumFractionDigits:0})}/mês — ${eficCred.toFixed(0)}% do débito total recuperado. Ampliar insumos com nota fiscal aumenta esse percentual.`});
  if(usaTerceiros&&mixLucro<40)ops.push({cor:C.amber,titulo:"Oportunidade em terceiros",
    txt:`Hoje ${mixLucro}% dos seus terceiros são LP/LR. Migrar para LP/LR eleva o crédito CBS de ${cbsMedTerceiros.toFixed(2)}% para até 9,3% — impacto direto no resultado.`});
  if(pctExportacao>0)ops.push({cor:C.blue,titulo:`Exportação — ${pctExportacao}% isento`,
    txt:"Receitas de exportação não geram débito de CBS/IBS, mas os créditos de insumos são mantidos e podem ser compensados ou restituídos."});
  if(vAno>20)ops.push({cor:C.red,titulo:"Reajuste contratual necessário",
    txt:`Com aumento de ${vAno.toFixed(0)}% no tributo em ${ano}, revise cláusulas de reajuste nos contratos de longo prazo para não comprimir a margem.`});
  if(ops.length===0)ops.push({cor:C.brand,titulo:"Configure os insumos",
    txt:"Ative frota própria e marque os insumos com nota fiscal para ver as oportunidades de crédito."});
  const mixTot = mixAutonomo + mixSN + mixLucro;
  const mixColor = mixTot===100?C.green:mixTot>100?C.red:C.amber;
  const compTotal = (usaFrota?pctFrota:0)+(usaTerceiros?pctTerceiros:0)+(usaAgregados?pctAgregados:0);
  const compColor = compTotal===100?C.green:compTotal>100?C.red:C.amber;

  const SCENARIOS=[
    {p:"Pequena TRC",frete:15000, frota:5,  regime:"Lucro Presumido",fp:100,ft:0,fa:0,mA:0,mS:100,mL:0,exp:0,cor:C.amber},
    {p:"Média TRC",  frete:80000, frota:25, regime:"Lucro Presumido",fp:70,ft:30,fa:0,mA:20,mS:55,mL:25,exp:5,cor:C.teal},
    {p:"Grande TRC", frete:400000,frota:120,regime:"Lucro Real",    fp:65,ft:35,fa:0,mA:10,mS:50,mL:40,exp:10,cor:C.green},
  ];

  const gerarPDF = async () => {
    const W=210,H=297,mg=14,cw=W-mg*2;
    const OR=[255,130,0],DK=[30,30,45],GR=[110,110,128];
    const LG=[165,165,182],BG=[247,247,250],BD=[222,222,232];
    const RD=[220,38,38],GN=[22,163,74];
    const h2r=h=>{const v=parseInt(h.replace("#",""),16);return[(v>>16)&255,(v>>8)&255,v&255];};
    const mCor=h2r(m.cor);

    const BRL=v=>"R$ "+Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:0});

    let logoData=null;
    try{
      const resp=await fetch(rumoLogo);
      const blob=await resp.blob();
      logoData=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob);});
    }catch(_){}

    const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});

    const frame=()=>{
      doc.setFillColor(...OR); doc.rect(0,0,W,3.5,"F");
      doc.setFillColor(...OR); doc.rect(0,H-3,W,3,"F");
    };
    frame();

    // ── HEADER ──
    if(logoData) doc.addImage(logoData,"PNG",mg,5,20,20);
    const tx=mg+24;
    doc.setFont("helvetica","bold"); doc.setFontSize(14); doc.setTextColor(...DK);
    doc.text("Impacto da Reforma Tributária — Terceirização",tx,12);
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...OR);
    doc.text("CBS + IBS  ·  Lei Complementar 214/2025",tx,18);
    doc.setFontSize(7); doc.setTextColor(...LG);
    doc.text("Ano simulado: "+m.ano+" — "+m.label+"   ·   Gerado em "+
      new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"}),tx,23);
    doc.setDrawColor(...BD); doc.setLineWidth(0.4); doc.line(mg,27,W-mg,27);
    // ── PARÂMETROS ──
    let y=30;
    doc.setFillColor(...BG); doc.rect(mg,y,cw,22,"F");
    const ps=cw/4;
    [{l:"Faturamento / mês",v:BRL(frete)},{l:"Exportação",v:pctExportacao+"%"},
     {l:"Margem terceiros",v:margemTerceiros+"%"},{l:"Regime da empresa",v:regime}]
    .forEach((p,i)=>{
      const px=mg+i*ps+3;
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...LG);
      doc.text(p.l,px,y+5);
      doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(...DK);
      doc.text(p.v,px,y+12);
    });
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...GR);
    doc.text("Mix:  PF "+mixAutonomo+"%  ·  PJSN "+mixSN+"%  ·  PJN "+mixLucro+"%" +
      (mixLucro>0?"  (Regime PJN: "+regimeLucroTerceiros+")":""),mg+3,y+19);
    y+=25;

    // ── DUAS COLUNAS ──
    const gap=5,colW=(cw-gap)/2;
    const xL=mg,xR=mg+colW+gap;
    let yL=y,yR=y;

    const debRow=(x,label,val,opts,yRef)=>{
      const vcol=opts.green?GN:opts.red?RD:opts.bold?DK:GR;
      doc.setFont("helvetica",opts.bold?"bold":"normal");
      doc.setFontSize(7.5); doc.setTextColor(...(opts.green?GN:opts.dim?LG:DK));
      doc.text(label,x+3,yRef[0]+4.5);
      doc.setFont("helvetica","bold"); doc.setTextColor(...vcol);
      doc.text(val,x+colW-2,yRef[0]+4.5,{align:"right"});
      doc.setDrawColor(...BD); doc.setLineWidth(0.2);
      doc.line(x+2,yRef[0]+6,x+colW-2,yRef[0]+6);
      yRef[0]+=7;
    };

    const credCard=(x,label,pct,val,formula,acc,yRef)=>{
      doc.setFillColor(...BG); doc.rect(x,yRef[0],colW,13,"F");
      doc.setFillColor(...acc); doc.rect(x,yRef[0],2.5,13,"F");
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...DK);
      doc.text(label+" "+pct+"%",x+5,yRef[0]+5.5);
      doc.setFontSize(10); doc.setTextColor(...GN);
      doc.text(BRL(val),x+colW-2,yRef[0]+6,{align:"right"});
      doc.setFont("helvetica","normal"); doc.setFontSize(5.8); doc.setTextColor(...LG);
      doc.text(formula,x+5,yRef[0]+10.5);
      yRef[0]+=14;
    };

    // ─── ESQUERDA: PIS/COFINS ───
    doc.setDrawColor(...DK); doc.setLineWidth(0.3); doc.line(xL,yL,xL+colW,yL);
    doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(...DK);
    doc.text("PIS / COFINS",xL+2,yL+8);
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...GR);
    doc.text("Alíquota "+aliqPIS+"%  ·  "+regime,xL+2,yL+13);
    doc.setDrawColor(...BD); doc.setLineWidth(0.2); doc.line(xL,yL+15,xL+colW,yL+15);
    yL+=18;

    doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(...LG);
    doc.text("DÉBITO",xL+2,yL+4); yL+=7;

    const yLa=[yL];
    debRow(xL,"Faturamento bruto",BRL(frete),{dim:true},yLa);
    if(pctExportacao>0) debRow(xL,"(-) Exportação "+pctExportacao+"%","("+BRL(frete*pctExportacao/100)+")",{green:true},yLa);
    debRow(xL,"Base tributável",BRL(baseExec),{bold:true},yLa);
    debRow(xL,"× Alíquota "+aliqPIS+"%","↓",{dim:true},yLa);
    yL=yLa[0];

    doc.setFillColor(255,241,241); doc.rect(xL,yL,colW,11,"F");
    doc.setFillColor(...RD); doc.rect(xL,yL,3,11,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...RD);
    doc.text("DÉBITO PIS/COFINS",xL+6,yL+5.5);
    doc.setFontSize(11); doc.text(BRL(pisDeb_),xL+colW-2,yL+8,{align:"right"});
    yL+=14;

    doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(...LG);
    doc.text("CRÉDITOS",xL+2,yL+4);
    doc.setFont("helvetica","normal"); doc.setFontSize(6);
    doc.text("base: "+BRL(baseTerN),xL+colW-2,yL+4,{align:"right"});
    yL+=8;

    const yLb=[yL];
    credCard(xL,"PF · Autônomo",mixAutonomo,pisCrPF_,
      BRL(bPF_)+" × 75% = "+BRL(bPF_*0.75)+" → × "+aliqPIS+"%",[180,83,9],yLb);
    credCard(xL,"PJSN · Simples Nacional",mixSN,pisCrSN_,
      BRL(bSN_)+" × 75% = "+BRL(bSN_*0.75)+" → × "+aliqPIS+"%",[29,91,215],yLb);
    credCard(xL,"PJN · LP/LR",mixLucro,pisCrPJN_,
      BRL(bPJN_)+" × 100% → × "+aliqPIS+"%",[22,163,74],yLb);
    yL=yLb[0];

    doc.setFillColor(240,253,244); doc.rect(xL,yL,colW,11,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...GN);
    doc.text("Total créditos",xL+3,yL+6.5);
    doc.setFontSize(11); doc.text(BRL(pisCrTot_),xL+colW-2,yL+7.5,{align:"right"});
    yL+=14;

    const pCr=pisCusto_<=0?GN:RD;
    doc.setFillColor(...(pisCusto_<=0?[240,253,244]:[255,241,241]));
    doc.setDrawColor(...pCr); doc.setLineWidth(0.5); doc.rect(xL,yL,colW,19,"FD");
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GR);
    doc.text("Crédito:  +"+BRL(pisCrTot_),xL+4,yL+6);
    doc.text("Débito:   -"+BRL(pisDeb_),xL+4,yL+11);
    doc.setDrawColor(...pCr); doc.setLineWidth(0.3); doc.line(xL+3,yL+12.5,xL+colW-3,yL+12.5);
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...pCr);
    doc.text("→ "+(pisCusto_<=0?"CREDOR":"DEVEDOR"),xL+4,yL+17);
    doc.setFontSize(13); doc.text(BRL(Math.abs(pisCusto_)),xL+colW-2,yL+17,{align:"right"});
    yL+=23;

    // ─── DIREITA: CBS + IBS ───
    doc.setDrawColor(...mCor); doc.setLineWidth(0.3); doc.line(xR,yR,xR+colW,yR);
    doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(...mCor);
    doc.text("CBS "+m.cbs+"%"+(m.ibs>0?" + IBS "+m.ibs+"%":""),xR+2,yR+8);
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...GR);
    doc.text("Total: "+m.total+"%  ·  "+m.ano+" — "+m.label,xR+2,yR+13);
    doc.setDrawColor(...BD); doc.setLineWidth(0.2); doc.line(xR,yR+15,xR+colW,yR+15);
    yR+=18;

    doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(...LG);
    doc.text("DÉBITO",xR+2,yR+4); yR+=7;

    const yRa=[yR];
    debRow(xR,"Faturamento bruto",BRL(frete),{dim:true},yRa);
    if(pctExportacao>0) debRow(xR,"(-) Exportação "+pctExportacao+"%","("+BRL(frete*pctExportacao/100)+")",{green:true},yRa);
    debRow(xR,"Base tributável",BRL(baseExec),{bold:true},yRa);
    debRow(xR,"× CBS "+m.cbs+"%",BRL(cbsDeb_),{red:true},yRa);
    if(m.ibs>0) debRow(xR,"× IBS "+m.ibs+"%",BRL(ibsDeb_),{red:true},yRa);
    yR=yRa[0];

    doc.setFillColor(255,241,241); doc.rect(xR,yR,colW,11,"F");
    doc.setFillColor(...RD); doc.rect(xR,yR,3,11,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...RD);
    doc.text("DÉBITO "+(m.ibs>0?"CBS + IBS":"CBS"),xR+6,yR+5.5);
    doc.setFontSize(11); doc.text(BRL(cbsDeb_+ibsDeb_),xR+colW-2,yR+8,{align:"right"});
    yR+=14;

    doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(...LG);
    doc.text("CRÉDITOS CBS"+(m.ibs>0?" + IBS":""),xR+2,yR+4);
    doc.setFont("helvetica","normal"); doc.setFontSize(5.5); doc.setTextColor(...LG);
    doc.text("PF: "+BRL(baseTerN)+"  ·  SN/PJN: "+BRL(baseTerTax),xR+colW-2,yR+4,{align:"right"});
    yR+=8;

    const yRb=[yR];
    credCard(xR,"PF · Autônomo",mixAutonomo,cbsCrPF_,
      BRL(bPF_)+" × 20% = "+BRL(bPF_*0.2)+" → × "+m.cbs+"%",[180,83,9],yRb);
    credCard(xR,"PJSN · Simples Nacional",mixSN,cbsCrSN_,
      BRL(bSN_cbs)+" × "+CBS_CRED.simplesNacional+"%",[29,91,215],yRb);
    credCard(xR,"PJN · "+(regimeLucroTerceiros==="Lucro Real"?"LR":"LP"),mixLucro,cbsCrPJN_,
      BRL(bPJN_cbs)+" × "+lucroRateTerceiros+"%",[22,163,74],yRb);
    if(m.ibs>0){
      doc.setFillColor(...BG); doc.rect(xR,yRb[0],colW,10,"F");
      doc.setFillColor(147,51,234); doc.rect(xR,yRb[0],2.5,10,"F");
      doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...DK);
      doc.text("Créditos IBS "+m.ibs+"%",xR+5,yRb[0]+5.5);
      doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(147,51,234);
      doc.text(BRL(ibsCrTot_),xR+colW-2,yRb[0]+6,{align:"right"});
      yRb[0]+=12;
    }
    yR=yRb[0];

    doc.setFillColor(240,253,244); doc.rect(xR,yR,colW,11,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...GN);
    doc.text("Total créditos",xR+3,yR+6.5);
    doc.setFontSize(11); doc.text(BRL(cbsCrTot_+ibsCrTot_),xR+colW-2,yR+7.5,{align:"right"});
    yR+=14;

    const cCr=cbsCusto_<=0?GN:RD;
    doc.setFillColor(...(cbsCusto_<=0?[240,253,244]:[255,241,241]));
    doc.setDrawColor(...cCr); doc.setLineWidth(0.5); doc.rect(xR,yR,colW,19,"FD");
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GR);
    doc.text("Créditos: +"+BRL(cbsCrTot_+ibsCrTot_),xR+4,yR+6);
    doc.text("Débito:   -"+BRL(cbsDeb_+ibsDeb_),xR+4,yR+11);
    doc.setDrawColor(...cCr); doc.setLineWidth(0.3); doc.line(xR+3,yR+12.5,xR+colW-3,yR+12.5);
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...cCr);
    doc.text("→ "+(cbsCusto_<=0?"CREDOR":"CBS A PAGAR"),xR+4,yR+17);
    doc.setFontSize(13); doc.text(BRL(Math.abs(cbsCusto_)),xR+colW-2,yR+17,{align:"right"});
    yR+=23;

    // ── COMPARATIVO ──
    y=Math.max(yL,yR)+6;
    if(y+42>278){doc.addPage();frame();y=20;}
    const diff=cbsCusto_-pisCusto_;
    const dCor=diff>0?RD:GN;
    doc.setFillColor(...BG); doc.setDrawColor(...BD); doc.setLineWidth(0.25);
    doc.rect(mg,y,cw,40,"FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...GR);
    doc.text("COMPARATIVO — HOJE vs REFORMA",mg+4,y+6);
    doc.setDrawColor(...BD); doc.setLineWidth(0.2); doc.line(mg+3,y+8,mg+cw-3,y+8);

    const hw=cw/2-4;
    [{l:"Hoje — PIS/COFINS "+aliqPIS+"%",v:Math.abs(pisCusto_),s:(pisCusto_<=0?"CREDOR":"DEVEDOR"),c:pisCusto_<=0?GN:RD},
     {l:"Reforma "+m.ano+"  —  CBS"+(m.ibs>0?" + IBS":"")+" "+m.total+"%",v:Math.abs(cbsCusto_),s:(cbsCusto_<=0?"CREDOR":"CBS A PAGAR"),c:cbsCusto_<=0?GN:RD}]
    .forEach((item,i)=>{
      const cx=mg+3+i*(hw+8);
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...LG);
      doc.text(item.l,cx,y+14);
      doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...item.c);
      doc.text(BRL(item.v),cx,y+22);
      doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...item.c);
      doc.text(item.s,cx,y+27);
    });
    doc.setDrawColor(...BD); doc.setLineWidth(0.4);
    doc.line(mg+cw/2,y+10,mg+cw/2,y+30);

    doc.setFillColor(...(diff>0?[255,241,241]:[240,253,244]));
    doc.rect(mg+3,y+31,cw-6,6,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...dCor);
    doc.text((diff>0?"▲ Custo adicional":"▼ Economia")+" vs hoje:  "+(diff>0?"+":"")+BRL(diff),mg+cw/2,y+35.5,{align:"center"});
    y+=46;

    // ── DISCLAIMER ──
    if(y>268){doc.addPage();frame();y=20;}
    y+=3;
    doc.setDrawColor(...BD); doc.setLineWidth(0.25); doc.line(mg,y,W-mg,y); y+=5;
    doc.setFont("helvetica","italic"); doc.setFontSize(6.5); doc.setTextColor(...LG);
    doc.splitTextToSize("Este documento é de caráter informativo e não substitui uma consulta tributária especializada. Os valores são estimativas baseadas nos parâmetros informados e nas alíquotas previstas na LC 214/2025.",cw)
      .forEach(l=>{doc.text(l,mg,y);y+=3.8;});

    doc.save("RumoBrasil_Terceirizacao_"+m.ano+"_"+new Date().toISOString().slice(0,10)+".pdf");
  };


  // ── Cálculos para layout do rascunho ──
  const aliqPIS    = regime==="Lucro Real"?9.25:3.65;
  const mixN       = mixAutonomo+mixSN+mixLucro||1;
  // Base cheia (sem deduçãoo de exportação) — usada para PIS créditos e CBS crédito PF
  const baseTerN   = frete*(1-(margemTerceiros||0)/100);
  // Base tributável (após exportação) — usada para CBS créditos PJSN e PJN
  const baseTerTax = baseExec*(1-(margemTerceiros||0)/100);
  const bPF_       = baseTerN  *(mixAutonomo/mixN);
  const bSN_       = baseTerN  *(mixSN/mixN);
  const bPJN_      = baseTerN  *(mixLucro/mixN);
  const bSN_cbs    = baseTerTax*(mixSN/mixN);
  const bPJN_cbs   = baseTerTax*(mixLucro/mixN);
  // PIS / COFINS
  const pisDeb_    = baseExec*aliqPIS/100;
  const pisCrPF_   = bPF_ *0.75*aliqPIS/100;
  const pisCrSN_   = bSN_ *0.75*aliqPIS/100;
  const pisCrPJN_  = bPJN_*1.00*aliqPIS/100;
  const pisCrTot_  = pisCrPF_+pisCrSN_+pisCrPJN_;
  const pisCusto_  = pisDeb_-pisCrTot_;
  // CBS + IBS
  const cbsDeb_    = reforma.cbsDebito;
  const ibsDeb_    = reforma.ibsDebito;
  const cbsCrPF_   = bPF_    *CBS_CRED.autonomo/100;
  const cbsCrSN_   = bSN_cbs *CBS_CRED.simplesNacional/100;
  const cbsCrPJN_  = bPJN_cbs*lucroRateTerceiros/100;
  const cbsCrTot_  = cbsCrPF_+cbsCrSN_+cbsCrPJN_;
  const ibsCrTot_  = reforma.creditoIBS_terceiros;
  const cbsCusto_  = reforma.totalRecolher;
  const BRL_      = (v)=>"R$ "+(v||0).toLocaleString("pt-BR",{maximumFractionDigits:0});


  const showCfg = !!collapsed["cfg"];

  return(
    <div style={{display:"flex",flexDirection:"column",height:isMob?"auto":"100dvh",minHeight:isMob?"100svh":"auto"}}>

      {/* ── Sub-header ── */}
      <div style={{background:C.bg1,borderBottom:"1px solid "+C.border,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:C.green,flexShrink:0,display:"inline-block",animation:"liveDot 2s infinite"}}/>
          <span style={{fontFamily:F.sans,fontSize:13,fontWeight:700,color:C.text,whiteSpace:"nowrap"}}>Terceirização</span>
          <Bdg color={C.brand}>REFORMA</Bdg>
          <span style={{fontFamily:F.sans,fontSize:9,color:C.text3,display:isMob?"none":"inline"}}>CBS + IBS · LC 214/2025</span>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <button onClick={()=>gerarPDF()} style={{border:"none",background:C.brand,color:"#fff",borderRadius:2,padding:"6px 12px",cursor:"pointer",fontFamily:F.sans,fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>
            ↓ PDF
          </button>
        </div>
      </div>

      {/* ── INPUTS ── */}
      <div style={{background:C.bg1,borderBottom:"2px solid "+C.border,flexShrink:0}}>

        {/* Linha principal: Faturamento + botão configurar */}
        <div style={{padding:"12px 16px 8px",display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{flex:"1 1 180px",maxWidth:280}}>
            <NInput label="Faturamento / mês" raw={rf} setRaw={setRf} onBlur={cf} prefix="R$"/>
          </div>
          <div style={{flex:"1 1 100px",maxWidth:160}}>
            <NInput label="% Exportação" raw={rExp} setRaw={setRExp} onBlur={cExp} suffix="%"/>
          </div>
          <div style={{flex:"1 1 80px",maxWidth:120}}>
            <NInput label="Margem" raw={rMT} setRaw={setRMT} onBlur={cMT} suffix="%"/>
          </div>
          <button onClick={()=>togCol("cfg")} style={{border:"1px solid "+(showCfg?C.brand:C.border),background:showCfg?C.brand+"18":C.bg2,color:showCfg?C.brand:C.text2,borderRadius:2,padding:"8px 12px",cursor:"pointer",fontFamily:F.sans,fontSize:10,fontWeight:500,whiteSpace:"nowrap",minHeight:44,WebkitTapHighlightColor:"transparent"}}>
            ⚙ Mix {mixTot===100?"✓":mixTot+"%"}
          </button>
        </div>

        {/* Linha: Ano simulado — sempre visível */}
        <div style={{padding:"0 16px 10px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontFamily:F.sans,fontSize:9,color:C.text3,textTransform:"uppercase",letterSpacing:0.5,marginRight:2}}>Ano</span>
          {MILES.map(mi=>(
            <button key={mi.ano} onClick={()=>setAno(mi.ano)} style={{border:"1px solid "+(ano===mi.ano?mi.cor:C.border),background:ano===mi.ano?mi.cor+"18":C.bg2,color:ano===mi.ano?mi.cor:C.text2,borderRadius:2,padding:"3px 7px",cursor:"pointer",fontFamily:F.mono,fontSize:9,fontWeight:ano===mi.ano?700:400,WebkitTapHighlightColor:"transparent"}}>
              {mi.ano}
            </button>
          ))}
        </div>

        {/* Painel configurações — colapsável */}
        {showCfg && (
          <div style={{padding:"0 16px 14px",display:"flex",gap:16,flexWrap:"wrap",borderTop:"1px solid "+C.border+"88"}}>

            {/* Mix PF / PJSN / PJN */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",paddingTop:12}}>
              <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,width:"100%",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Mix de regime dos terceiros</div>
              <div style={{width:90}}><NInput label="% PF (autônomo)" raw={rA} setRaw={setRA} onBlur={cA} suffix="%"/></div>
              <div style={{width:90}}><NInput label="% PJSN" raw={rS} setRaw={setRS} onBlur={cS} suffix="%"/></div>
              <div style={{width:90}}><NInput label="% PJN" raw={rL} setRaw={setRL} onBlur={cL} suffix="%"/></div>
              <div style={{paddingBottom:6}}>
                <div style={{fontFamily:F.mono,fontSize:12,fontWeight:700,color:mixColor}}>{mixTot}%{mixTot===100?" ✓":""}</div>
                <div style={{fontFamily:F.sans,fontSize:8,color:C.text3}}>total</div>
              </div>
            </div>

            {/* Regime empresa */}
            <div style={{paddingTop:12}}>
              <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Regime da empresa</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {[{r:"Lucro Real",l:"LR — 9,25%"},{r:"Lucro Presumido",l:"LP — 3,65%"},{r:"Simples Nacional",l:"SN — 3,65%"}].map(({r,l})=>(
                  <button key={r} onClick={()=>setRegime(r)} style={{border:"1px solid "+(regime===r?C.brand:C.border),background:regime===r?C.brand+"18":C.bg2,color:regime===r?C.brand:C.text2,borderRadius:2,padding:"3px 8px",cursor:"pointer",fontFamily:F.sans,fontSize:9,WebkitTapHighlightColor:"transparent"}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Regime PJN terceiros */}
            <div style={{paddingTop:12}}>
              <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Regime PJN (terceiros)</div>
              <div style={{display:"flex",gap:4}}>
                {[{r:"Lucro Real",l:"LR — CBS 9,3%"},{r:"Lucro Presumido",l:"LP — CBS 9,25%"}].map(({r,l})=>(
                  <button key={r} onClick={()=>setRegimeLucroTerceiros(r)} style={{border:"1px solid "+(regimeLucroTerceiros===r?C.brand:C.border),background:regimeLucroTerceiros===r?C.brand+"18":C.bg2,color:regimeLucroTerceiros===r?C.brand:C.text2,borderRadius:2,padding:"3px 8px",cursor:"pointer",fontFamily:F.sans,fontSize:9,WebkitTapHighlightColor:"transparent"}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>


          </div>
        )}
      </div>

      {/* ── TABS mobile ── */}
      {isMob && (
        <div style={{display:"flex",background:C.bg1,borderBottom:"2px solid "+C.border,flexShrink:0}}>
          {[{k:"pis",label:"PIS / COFINS",cor:C.text},{k:"cbs",label:"CBS"+(m.ibs>0?" + IBS":"")+" "+m.ano,cor:m.cor}].map(tab=>(
            <button key={tab.k} onClick={()=>setSubTab(tab.k)} style={{flex:1,padding:"12px 8px",border:"none",borderBottom:"3px solid "+(subTab===tab.k?tab.cor:"transparent"),background:"transparent",color:subTab===tab.k?tab.cor:C.text3,fontFamily:F.sans,fontSize:11,fontWeight:subTab===tab.k?700:400,cursor:"pointer",WebkitTapHighlightColor:"transparent",transition:"all 0.15s"}}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── CONTEÚDO ── */}
      <div style={{display:"grid",gridTemplateColumns:isMob?"1fr":"1fr 1fr",flex:isMob?undefined:1,overflow:isMob?"visible":"hidden",minHeight:isMob?"auto":"0"}}>

        {/* ════ PIS/COFINS ════ */}
        {(!isMob||subTab!=="cbs") && (
        <div style={{borderRight:isMob?"none":"2px solid "+C.border,padding:isMob?"20px 16px":"28px",overflowY:isMob?"visible":"auto",background:C.bg1}}>

          <div style={{marginBottom:20,paddingBottom:12,borderBottom:"2px solid "+C.border}}>
            <div style={{fontFamily:F.sans,fontSize:isMob?20:18,fontWeight:800,color:C.text,letterSpacing:-0.5}}>PIS / COFINS</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
              <span style={{fontFamily:F.mono,fontSize:12,color:C.text2,fontWeight:600}}>Alíquota: {aliqPIS}%</span>
              <Bdg color={C.text3}>{regime}</Bdg>
            </div>
          </div>

          {/* Débito */}
          <div style={{marginBottom:4,fontFamily:F.sans,fontSize:9,fontWeight:600,color:C.text3,textTransform:"uppercase",letterSpacing:0.6}}>Débito</div>
          {[
            {label:"Faturamento bruto", val:BRL_(frete), dim:true},
            ...(pctExportacao>0?[{label:"(-) Exportação "+pctExportacao+"%", val:"("+BRL_(frete*pctExportacao/100)+")", color:C.green}]:[]),
            {label:"Base tributável", val:BRL_(baseExec), bold:true},
            {label:"× Alíquota "+aliqPIS+"%", val:"↓", dim:true},
          ].map((row,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+C.border+"55"}}>
              <span style={{fontFamily:F.sans,fontSize:11,color:row.color||(row.dim?C.text3:C.text),fontWeight:row.bold?600:400}}>{row.label}</span>
              <span style={{fontFamily:F.mono,fontSize:11,color:row.color||(row.bold?C.text:C.text2)}}>{row.val}</span>
            </div>
          ))}
          <div style={{marginTop:10,marginBottom:24,padding:"12px 14px",background:C.redLt,border:"1px solid "+C.red+"44",borderLeft:"4px solid "+C.red,borderRadius:3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:F.sans,fontSize:12,color:C.red,fontWeight:600}}>DÉBITO PIS/COFINS</span>
            <span style={{fontFamily:F.mono,fontSize:isMob?22:20,color:C.red,fontWeight:800}}>{BRL_(pisDeb_)}</span>
          </div>

          {/* Créditos */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
            <span style={{fontFamily:F.sans,fontSize:9,fontWeight:600,color:C.text3,textTransform:"uppercase",letterSpacing:0.6}}>Créditos</span>
            <span style={{fontFamily:F.mono,fontSize:9,color:C.text3}}>base: {BRL_(baseTerN)}</span>
          </div>

          {[
            {label:"PF · Autônomo", pct:mixAutonomo, val:pisCrPF_, formula:BRL_(bPF_)+" × 75% = "+BRL_(bPF_*0.75)+" → × "+aliqPIS+"%", cor:C.amber},
            {label:"PJSN · Simples Nacional", pct:mixSN, val:pisCrSN_, formula:BRL_(bSN_)+" × 75% = "+BRL_(bSN_*0.75)+" → × "+aliqPIS+"%", cor:C.blue},
            {label:"PJN · LP / LR", pct:mixLucro, val:pisCrPJN_, formula:BRL_(bPJN_)+" × 100% → × "+aliqPIS+"%", cor:C.green},
          ].map((row,i)=>(
            <div key={i} style={{marginBottom:6,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.border,borderLeft:"3px solid "+row.cor,borderRadius:3}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text,fontWeight:600}}>{row.label} <span style={{color:row.cor,fontWeight:700}}>{row.pct}%</span></span>
                <span style={{fontFamily:F.mono,fontSize:isMob?16:15,color:C.green,fontWeight:700}}>{BRL_(row.val)}</span>
              </div>
              <div style={{fontFamily:F.mono,fontSize:9,color:C.text3}}>{row.formula}</div>
            </div>
          ))}

          <div style={{marginBottom:24,padding:"12px 14px",background:C.greenLt,border:"1px solid "+C.green+"44",borderRadius:3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:F.sans,fontSize:12,color:C.green,fontWeight:600}}>Total créditos</span>
            <span style={{fontFamily:F.mono,fontSize:isMob?20:18,color:C.green,fontWeight:700}}>{BRL_(pisCrTot_)}</span>
          </div>

          {/* Resultado */}
          <div style={{padding:"16px",background:pisCusto_<=0?C.greenLt:C.redLt,border:"2px solid "+(pisCusto_<=0?C.green:C.red),borderRadius:4}}>
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>Crédito</span>
                <span style={{fontFamily:F.mono,fontSize:12,color:C.green,fontWeight:500}}>{"+ "+BRL_(pisCrTot_)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>Débito</span>
                <span style={{fontFamily:F.mono,fontSize:12,color:C.red,fontWeight:500}}>{"- "+BRL_(pisDeb_)}</span>
              </div>
            </div>
            <div style={{borderTop:"1px solid "+(pisCusto_<=0?C.green+"44":C.red+"44"),paddingTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontFamily:F.sans,fontSize:13,color:pisCusto_<=0?C.green:C.red,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>
                {"→ "+(pisCusto_<=0?"CREDOR":"DEVEDOR")}
              </span>
              <span style={{fontFamily:F.mono,fontSize:isMob?28:24,color:pisCusto_<=0?C.green:C.red,fontWeight:800}}>
                {BRL_(Math.abs(pisCusto_))}
              </span>
            </div>
          </div>

        </div>
        )}

        {/* ════ CBS + IBS ════ */}
        {(!isMob||subTab==="cbs") && (
        <div style={{padding:isMob?"20px 16px":"28px",overflowY:isMob?"visible":"auto",background:C.bg1}}>

          <div style={{marginBottom:20,paddingBottom:12,borderBottom:"2px solid "+m.cor}}>
            <div style={{fontFamily:F.sans,fontSize:isMob?20:18,fontWeight:800,color:m.cor,letterSpacing:-0.5}}>
              {"CBS "+m.cbs+"%"+(m.ibs>0?" + IBS "+m.ibs+"%":"")}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
              <span style={{fontFamily:F.mono,fontSize:12,color:C.text2,fontWeight:600}}>Total: {m.total}%</span>
              <Bdg color={m.cor}>{m.ano+" — "+m.label}</Bdg>
            </div>
          </div>

          {/* Débito CBS */}
          <div style={{marginBottom:4,fontFamily:F.sans,fontSize:9,fontWeight:600,color:C.text3,textTransform:"uppercase",letterSpacing:0.6}}>Débito</div>
          {[
            {label:"Faturamento bruto", val:BRL_(frete), dim:true},
            ...(pctExportacao>0?[{label:"(-) Exportação "+pctExportacao+"%", val:"("+BRL_(frete*pctExportacao/100)+")", color:C.green}]:[]),
            {label:"Base tributável", val:BRL_(baseExec), bold:true},
            {label:"× CBS "+m.cbs+"%", val:BRL_(cbsDeb_), red:true},
            ...(m.ibs>0?[{label:"× IBS "+m.ibs+"%", val:BRL_(ibsDeb_), red:true}]:[]),
          ].map((row,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+C.border+"55"}}>
              <span style={{fontFamily:F.sans,fontSize:11,color:row.color||(row.dim?C.text3:C.text),fontWeight:row.bold?600:400}}>{row.label}</span>
              <span style={{fontFamily:F.mono,fontSize:11,color:row.color||(row.red?C.red:row.bold?C.text:C.text2)}}>{row.val}</span>
            </div>
          ))}
          <div style={{marginTop:10,marginBottom:24,padding:"12px 14px",background:C.redLt,border:"1px solid "+C.red+"44",borderLeft:"4px solid "+C.red,borderRadius:3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:F.sans,fontSize:12,color:C.red,fontWeight:600}}>{"DÉBITO "+(m.ibs>0?"CBS + IBS":"CBS")}</span>
            <span style={{fontFamily:F.mono,fontSize:isMob?22:20,color:C.red,fontWeight:800}}>{BRL_(cbsDeb_+ibsDeb_)}</span>
          </div>

          {/* Créditos CBS */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
            <span style={{fontFamily:F.sans,fontSize:9,fontWeight:600,color:C.text3,textTransform:"uppercase",letterSpacing:0.6}}>{"Créditos CBS"+(m.ibs>0?" + IBS":"")}</span>
            <span style={{fontFamily:F.mono,fontSize:9,color:C.text3}}>base PF: {BRL_(baseTerN)} · base SN/PJN: {BRL_(baseTerTax)}</span>
          </div>

          {[
            {label:"PF · Autônomo", pct:mixAutonomo, val:cbsCrPF_, formula:BRL_(bPF_)+" × 20% = "+BRL_(bPF_*0.2)+" → × "+m.cbs+"%", cor:C.amber},
            {label:"PJSN · Simples Nacional", pct:mixSN, val:cbsCrSN_, formula:BRL_(bSN_cbs)+" × "+CBS_CRED.simplesNacional+"%", cor:C.blue},
            {label:"PJN · "+(regimeLucroTerceiros==="Lucro Real"?"Lucro Real":"Lucro Presumido"), pct:mixLucro, val:cbsCrPJN_, formula:BRL_(bPJN_cbs)+" × "+lucroRateTerceiros+"%", cor:C.green},
          ].map((row,i)=>(
            <div key={i} style={{marginBottom:6,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.border,borderLeft:"3px solid "+row.cor,borderRadius:3}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text,fontWeight:600}}>{row.label} <span style={{color:row.cor,fontWeight:700}}>{row.pct}%</span></span>
                <span style={{fontFamily:F.mono,fontSize:isMob?16:15,color:C.green,fontWeight:700}}>{BRL_(row.val)}</span>
              </div>
              <div style={{fontFamily:F.mono,fontSize:9,color:C.text3}}>{row.formula}</div>
            </div>
          ))}

          {m.ibs>0 && (
            <div style={{marginBottom:6,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.border,borderLeft:"3px solid "+C.purple,borderRadius:3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>Créditos IBS {m.ibs}%</span>
              <span style={{fontFamily:F.mono,fontSize:isMob?16:14,color:C.purple,fontWeight:600}}>{BRL_(ibsCrTot_)}</span>
            </div>
          )}

          <div style={{marginBottom:24,padding:"12px 14px",background:C.greenLt,border:"1px solid "+C.green+"44",borderRadius:3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:F.sans,fontSize:12,color:C.green,fontWeight:600}}>Total créditos</span>
            <span style={{fontFamily:F.mono,fontSize:isMob?20:18,color:C.green,fontWeight:700}}>{BRL_(cbsCrTot_+ibsCrTot_)}</span>
          </div>

          {/* Resultado CBS */}
          <div style={{padding:"16px",background:cbsCusto_<=0?C.greenLt:C.redLt,border:"2px solid "+(cbsCusto_<=0?C.green:C.red),borderRadius:4,marginBottom:16}}>
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>Créditos</span>
                <span style={{fontFamily:F.mono,fontSize:12,color:C.green,fontWeight:500}}>{"+ "+BRL_(cbsCrTot_+ibsCrTot_)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:F.sans,fontSize:11,color:C.text2}}>Débito</span>
                <span style={{fontFamily:F.mono,fontSize:12,color:C.red,fontWeight:500}}>{"- "+BRL_(cbsDeb_+ibsDeb_)}</span>
              </div>
            </div>
            <div style={{borderTop:"1px solid "+(cbsCusto_<=0?C.green+"44":C.red+"44"),paddingTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontFamily:F.sans,fontSize:13,color:cbsCusto_<=0?C.green:C.red,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>
                {"→ "+(cbsCusto_<=0?"CREDOR":"CBS A PAGAR")}
              </span>
              <span style={{fontFamily:F.mono,fontSize:isMob?28:24,color:cbsCusto_<=0?C.green:C.red,fontWeight:800}}>
                {BRL_(Math.abs(cbsCusto_))}
              </span>
            </div>
          </div>

          {/* Comparativo */}
          {(()=>{
            const diff=cbsCusto_-pisCusto_;
            const corD=diff>0?C.red:C.green;
            return(
              <div style={{padding:"14px 16px",background:C.bg2,border:"1px solid "+C.border,borderRadius:3}}>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,textTransform:"uppercase",letterSpacing:0.6,marginBottom:10}}>Comparativo — Hoje vs Reforma</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div style={{padding:"8px 10px",background:C.bg1,border:"1px solid "+C.border,borderRadius:2}}>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginBottom:3}}>Hoje — PIS/COFINS</div>
                    <div style={{fontFamily:F.mono,fontSize:isMob?16:14,color:pisCusto_<=0?C.green:C.red,fontWeight:700}}>{BRL_(Math.abs(pisCusto_))}</div>
                    <div style={{fontFamily:F.sans,fontSize:9,color:pisCusto_<=0?C.green:C.red,marginTop:2,fontWeight:600}}>{pisCusto_<=0?"credor":"devedor"}</div>
                  </div>
                  <div style={{padding:"8px 10px",background:C.bg1,border:"1px solid "+m.cor+"44",borderRadius:2}}>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginBottom:3}}>{"Reforma "+m.ano}</div>
                    <div style={{fontFamily:F.mono,fontSize:isMob?16:14,color:cbsCusto_<=0?C.green:C.red,fontWeight:700}}>{BRL_(Math.abs(cbsCusto_))}</div>
                    <div style={{fontFamily:F.sans,fontSize:9,color:cbsCusto_<=0?C.green:C.red,marginTop:2,fontWeight:600}}>{cbsCusto_<=0?"credor":"a pagar"}</div>
                  </div>
                </div>
                <div style={{padding:"12px 14px",background:corD+"18",border:"1px solid "+corD+"44",borderRadius:3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:F.sans,fontSize:11,color:corD,fontWeight:600}}>{diff>0?"▲ Custo adicional":"▼ Economia"} vs hoje</span>
                  <span style={{fontFamily:F.mono,fontSize:isMob?18:16,color:corD,fontWeight:800}}>{(diff>0?"+":"")+BRL_(diff)}</span>
                </div>
              </div>
            );
          })()}

        </div>
        )}

      </div>
    </div>
  );

}


// ── TABS ──
const TABS=[{id:"painel",label:"Painel"},{id:"oracle",label:"Simulador"}];

// ── APP ──
export default function App(){
  const [tab,setTab]=useState("oracle");

  const [frete,setFrete]=useState(0);
  const [frota,setFrota]=useState(0);
  const [regime,setRegime]=useState("Lucro Presumido");
  const [ano,setAno]=useState(2027);
  const [pctExportacao,setPctExportacao]=useState(0);

  // Frota própria
  const [usaFrota,setUsaFrota]=useState(false);
  const [pctFrota,setPctFrota]=useState(0);
  const [insumosAtivos,setInsumosAtivos]=useState({
    diesel:true, gasolina:false, gnv:false, pecas:true, pneus:true, manutencao:true, pedagios:true, outras:false,
  });
  const [insumosCusto,setInsumosCusto]=useState({
    diesel:35, gasolina:3, gnv:0, pecas:5, pneus:4, manutencao:8, pedagios:3, outras:0,
  });

  // Insumos terceiros (créditos adicionais por segmento)
  const [insumosAtivosTerceiros,setInsumosAtivosTerceiros]=useState({
    diesel:false, gasolina:false, gnv:false, pecas:false, pneus:false, manutencao:false, pedagios:false, outras:false,
  });
  const [insumosCustoTerceiros,setInsumosCustoTerceiros]=useState({
    diesel:0, gasolina:0, gnv:0, pecas:0, pneus:0, manutencao:0, pedagios:0, outras:0,
  });

  // Insumos agregados (créditos adicionais por segmento)
  const [insumosAtivosAgregados,setInsumosAtivosAgregados]=useState({
    diesel:false, gasolina:false, gnv:false, pecas:false, pneus:false, manutencao:false, pedagios:false, outras:false,
  });
  const [insumosCustoAgregados,setInsumosCustoAgregados]=useState({
    diesel:0, gasolina:0, gnv:0, pecas:0, pneus:0, manutencao:0, pedagios:0, outras:0,
  });

  // Despesas sem direito a crédito CBS/IBS
  const [despesasSCAtivas,setDespesasSCAtivas]=useState({salarios:false, seguros:false, financeiras:false, outras_sc:false});
  const [despesasSCCusto,setDespesasSCCusto]=useState({salarios:0, seguros:0, financeiras:0, outras_sc:0});

  // Terceiros
  const [usaTerceiros,setUsaTerceiros]=useState(true);
  const [pctTerceiros,setPctTerceiros]=useState(100);
  const [mixAutonomo,setMixAutonomo]=useState(0);
  const [mixSN,setMixSN]=useState(0);
  const [mixLucro,setMixLucro]=useState(0);
  const [margemTerceiros,setMargemTerceiros]=useState(0);
  const [regimeLucroTerceiros,setRegimeLucroTerceiros]=useState("Lucro Real");

  // Agregados
  const [usaAgregados,setUsaAgregados]=useState(false);
  const [pctAgregados,setPctAgregados]=useState(10);
  const [regimeAgregado,setRegimeAgregado]=useState("Autônomo");
  const [margemAgregados,setMargemAgregados]=useState(20);
  const [valorCompraImob,setValorCompraImob]=useState(0);
  const [valorVendaImob,setValorVendaImob]=useState(0);

  // Diesel ao vivo
  const [precoDiesel,setPrecoDiesel]=useState(6.15);

  const clock=useClock();
  const isMob=useIsMob();

  const ctx={
    frete,setFrete,frota,setFrota,regime,setRegime,
    ano,setAno,tab,setTab,
    pctExportacao,setPctExportacao,
    usaFrota,setUsaFrota,pctFrota,setPctFrota,
    insumosAtivos,setInsumosAtivos,insumosCusto,setInsumosCusto,
    usaTerceiros,setUsaTerceiros,pctTerceiros,setPctTerceiros,
    mixAutonomo,setMixAutonomo,mixSN,setMixSN,mixLucro,setMixLucro,margemTerceiros,setMargemTerceiros,regimeLucroTerceiros,setRegimeLucroTerceiros,
    insumosAtivosTerceiros,setInsumosAtivosTerceiros,insumosCustoTerceiros,setInsumosCustoTerceiros,
    usaAgregados,setUsaAgregados,pctAgregados,setPctAgregados,
    regimeAgregado,setRegimeAgregado,margemAgregados,setMargemAgregados,
    valorCompraImob,setValorCompraImob,valorVendaImob,setValorVendaImob,
    insumosAtivosAgregados,setInsumosAtivosAgregados,insumosCustoAgregados,setInsumosCustoAgregados,
    despesasSCAtivas,setDespesasSCAtivas,despesasSCCusto,setDespesasSCCusto,
    precoDiesel,setPrecoDiesel,
    isMob,
  };

  return(
    <Ctx.Provider value={ctx}>
      <div style={{background:C.bg,minHeight:"100vh",fontFamily:F.sans,color:C.text}}>
        <style>{FONTS}</style>
        <style>{`
          *{box-sizing:border-box;margin:0;padding:0;}
          html,body{background:${C.bg}!important;color:${C.text};}
          input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;}
          input:focus{border-color:${C.brand}!important;outline:none;box-shadow:0 0 0 2px rgba(255,130,0,0.12);}
          ::-webkit-scrollbar{width:4px;height:4px;}
          ::-webkit-scrollbar-track{background:${C.bg};}
          ::-webkit-scrollbar-thumb{background:${C.bg3};border-radius:2px;}
          button:active{opacity:0.75!important;}
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
          @keyframes liveDot{0%,100%{opacity:1}50%{opacity:0.3}}
        `}</style>

        {/* Topbar */}
        <div style={{background:C.bg1,borderBottom:"1px solid "+C.border,position:"sticky",top:0,zIndex:100}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",height:48}}>
            <div style={{display:"flex",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,paddingRight:20,borderRight:"1px solid "+C.border}}>
                <img src={rumoLogo} alt="Rumo Brasil" style={{height:32,width:"auto",objectFit:"contain"}}/>
                <span style={{fontFamily:F.sans,fontSize:12,color:C.text2}}>Simulador TRC</span>
              </div>
              {!isMob&&TABS.map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{border:"none",background:"transparent",cursor:"pointer",padding:"0 16px",height:48,borderBottom:"2px solid "+(tab===t.id?C.brand:"transparent"),color:tab===t.id?C.text:C.text2,fontFamily:F.sans,fontSize:12,transition:"all 0.12s"}}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:5,height:5,borderRadius:"50%",background:C.green,display:"inline-block",animation:"liveDot 2s infinite"}}/>
              <span style={{fontFamily:F.mono,fontSize:11,color:C.brand}}>{clock.toLocaleTimeString("pt-BR")}</span>
              <Bdg color={C.brand}>LC 214/2025</Bdg>
            </div>
          </div>
          {isMob&&(
            <div style={{display:"flex",borderTop:"1px solid "+C.border}}>
              {TABS.map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{flex:1,border:"none",background:"transparent",cursor:"pointer",padding:"8px 4px",borderTop:"2px solid "+(tab===t.id?C.brand:"transparent"),color:tab===t.id?C.text:C.text2,fontFamily:F.sans,fontSize:10}}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div key={tab}>{tab==="painel"?<Painel/>:<Oracle/>}</div>

        {/* Footer */}
        <div style={{background:C.bg1,borderTop:"1px solid "+C.border,padding:"6px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
            {[
              {l:"EC 132/2023",v:"VIGENTE",  c:C.green},
              {l:"LC 214/2025",v:"VIGENTE",  c:C.green},
              {l:"CBS 9,3%",   v:"JAN 2027", c:C.blue},
              {l:"IBS 11,22%", v:"JAN 2029", c:C.purple},
              {l:"PIS→IBS",    v:"EXT. 2027",c:C.amber},
              {l:"COFINS→CBS", v:"EXT. 2027",c:C.amber},
            ].map((s,i)=>(
              <span key={i} style={{fontFamily:F.mono,fontSize:9,color:C.text2}}>
                {s.l} <span style={{color:s.c}}>{s.v}</span>
              </span>
            ))}
          </div>
          <span style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>Rumo Brasil · {clock.toLocaleDateString("pt-BR")} · Nota Técnica SERTMF</span>
        </div>
      </div>
    </Ctx.Provider>
  );
}
