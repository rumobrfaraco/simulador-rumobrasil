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
const CBS_CRED = { autonomo:1.86, simplesNacional:2.497, lucro:9.3 };

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
    const baseTerceiros = frete * (pctTerceiros / 100) * (1 - (margemTerceiros || 0) / 100);
    const cbsCredPct = calcCBSCredito(mixAutonomo, mixSN, mixLucro, lucroRateTerceiros);
    creditoCBS_terceiros = baseTerceiros * (cbsCredPct / 100);
    creditoIBS_terceiros = baseTerceiros * aliqIBS;
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
  const reforma = calcReforma({
    frete, regime, pctExportacao,
    cbsAliq: m.cbs, ibsAliq: m.ibs,
    usaFrota, pctFrota, insumosAtivos, insumosCusto,
    usaTerceiros, pctTerceiros, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros,
    insumosAtivosTerceiros, insumosCustoTerceiros,
    usaAgregados, pctAgregados, regimeAgregado, margemAgregados,
    insumosAtivosAgregados, insumosCustoAgregados,
    valorCompraImob, valorVendaImob,
  });

  const calcTot=(mi)=>{
    return calcReforma({
      frete, regime, pctExportacao,
      cbsAliq: mi.cbs, ibsAliq: mi.ibs,
      usaFrota, pctFrota, insumosAtivos, insumosCusto,
      usaTerceiros, pctTerceiros, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros,
      insumosAtivosTerceiros, insumosCustoTerceiros,
      usaAgregados, pctAgregados, regimeAgregado, margemAgregados,
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
    const W = 210, H = 297, mg = 16, cw = W - mg * 2;
    const OR = [255, 130, 0];
    const DK = [30, 30, 45];
    const GR = [110, 110, 128];
    const LG = [165, 165, 182];
    const BG = [247, 247, 250];
    const BD = [222, 222, 232];

    const BRL = v => "R$ " + Number(v).toLocaleString("pt-BR", {maximumFractionDigits:0});
    const Pct = v => Number(v).toFixed(1) + "%";

    // Carrega logo como base64
    let logoDataUrl = null;
    try {
      const resp = await fetch(rumoLogo);
      const blob = await resp.blob();
      logoDataUrl = await new Promise(res => {
        const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob);
      });
    } catch(_) {}

    const doc = new jsPDF({orientation:"portrait", unit:"mm", format:"a4"});

    // ── Moldura de página (chamada a cada nova página) ──
    const drawFrame = () => {
      doc.setFillColor(...OR);
      doc.rect(0, 0, W, 3.5, "F");       // barra laranja topo
      doc.setFillColor(...OR);
      doc.rect(0, H - 3, W, 3, "F");     // barra laranja rodapé
    };

    drawFrame();

    // ── Cabeçalho ──
    const logoSz = 24;
    if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", mg, 7, logoSz, logoSz);

    const tx = mg + logoSz + 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...DK);
    doc.text("Análise de Impacto Tributário", tx, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...OR);
    doc.text("Reforma Tributária · CBS + IBS", tx, 22);
    doc.setFontSize(8); doc.setTextColor(...GR);
    doc.text("Lei Complementar 214/2025  ·  Simulação: " + m.ano + " — " + m.label, tx, 27.5);
    doc.text("Gerado em " + new Date().toLocaleDateString("pt-BR", {day:"2-digit", month:"long", year:"numeric"}), tx, 32.5);

    // Linha divisória do cabeçalho
    doc.setDrawColor(...BD); doc.setLineWidth(0.4);
    doc.line(mg, 37, W - mg, 37);

    let y = 46;

    // ── Helpers ──
    const section = (title) => {
      doc.setFillColor(...OR);
      doc.rect(mg, y, 2.5, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GR);
      doc.text(title.toUpperCase(), mg + 5, y + 5);
      y += 10;
      doc.setDrawColor(...BD); doc.setLineWidth(0.25);
      doc.line(mg + 5, y - 1, W - mg, y - 1);
      y += 4;
    };

    const dataRow = (label, value, valueColor = DK) => {
      doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...GR);
      doc.text(label, mg + 5, y);
      doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...valueColor);
      doc.text(value, W - mg, y, {align:"right"});
      y += 5.5;
    };

    const subtotalBar = (label, value) => {
      doc.setFillColor(...BG);
      doc.rect(mg + 5, y, cw - 5, 7, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...DK);
      doc.text(label, mg + 8, y + 5);
      doc.setTextColor(...OR);
      doc.text(value, W - mg - 2, y + 5, {align:"right"});
      y += 10;
    };

    // ── Seção 1: Perfil Tributário ──
    section("Perfil Tributário");
    const col2 = W / 2 + 4;
    // linha 1
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...LG);
    doc.text("Receita Bruta de Frete (mensal)", mg + 5, y);
    doc.text("Frota de Veículos", col2, y);
    y += 4;
    doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...DK);
    doc.text(BRL(frete), mg + 5, y);
    doc.text(frota + " veículos", col2, y);
    y += 7;
    // linha 2
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...LG);
    doc.text("Enquadramento Tributário", mg + 5, y);
    doc.text("Exportações (isento CBS/IBS)", col2, y);
    y += 4;
    doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...DK);
    doc.text(regime, mg + 5, y);
    doc.text(pctExportacao + "% da receita", col2, y);
    y += 10;

    // ── Seção 2: Estrutura Operacional ──
    section("Estrutura Operacional");
    if (usaFrota)     dataRow("Frota Própria", pctFrota + "% da receita");
    if (usaTerceiros) dataRow("Terceiros / Subcontratados · " + mixAutonomo + "% aut. · " + mixSN + "% SN · " + mixLucro + "% LP/LR", pctTerceiros + "% da receita");
    if (usaAgregados) dataRow("Agregados (" + regimeAgregado + ")", pctAgregados + "% da receita");
    y += 4;

    // ── Seção 3: Apuração Tributária ──
    section("Apuração Tributária — " + m.ano);

    // CBS
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...OR);
    doc.text("Contribuição sobre Bens e Serviços (CBS) — " + m.cbs + "%", mg + 5, y); y += 6;
    dataRow("Incidência CBS sobre a receita tributável", BRL(reforma.cbsDebito));
    if (usaFrota)     dataRow("  (-) Créditos — frota própria", BRL(reforma.creditoCBS_frota));
    if (usaTerceiros) dataRow("  (-) Créditos — subcontratados", BRL(reforma.creditoCBS_terceiros));
    if (usaAgregados) dataRow("  (-) Créditos — agregados", BRL(reforma.creditoCBS_agregados));
    subtotalBar("CBS a Recolher", BRL(reforma.cbsRecolher));

    // IBS
    if (m.ibs > 0) {
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...OR);
      doc.text("Imposto sobre Bens e Serviços (IBS) — " + m.ibs + "%", mg + 5, y); y += 6;
      dataRow("Incidência IBS sobre a receita tributável", BRL(reforma.ibsDebito));
      if (usaFrota)     dataRow("  (-) Créditos — frota própria", BRL(reforma.creditoIBS_frota));
      if (usaTerceiros) dataRow("  (-) Créditos — subcontratados", BRL(reforma.creditoIBS_terceiros));
      if (usaAgregados) dataRow("  (-) Créditos — agregados", BRL(reforma.creditoIBS_agregados));
      subtotalBar("IBS a Recolher", BRL(reforma.ibsRecolher));
    }

    // ── Box Total ──
    y += 2;
    doc.setFillColor(255, 244, 229);
    doc.setDrawColor(...OR); doc.setLineWidth(0.5);
    doc.roundedRect(mg, y, cw, 17, 2, 2, "FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...DK);
    doc.text("Tributo Estimado a Recolher / mês", mg + 5, y + 7);
    doc.setFontSize(15); doc.setTextColor(...OR);
    doc.text(BRL(reforma.totalRecolher), W - mg - 4, y + 7, {align:"right"});
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GR);
    doc.text(Pct(pctCarga) + " da receita bruta", W - mg - 4, y + 13, {align:"right"});
    y += 23;

    // ── KPIs 3 boxes ──
    const bxW = (cw - 6) / 3;
    [
      {l:"Incidência total (CBS + IBS)", v:BRL(reforma.cbsDebito + reforma.ibsDebito), s:"débito bruto"},
      {l:"Créditos recuperados", v:BRL(reforma.totalCreditoCBS + reforma.totalCreditoIBS), s:"não-cumulatividade"},
      {l:"Impacto anual estimado", v:BRL(reforma.totalRecolher * 12), s:"12 meses projetados"},
    ].forEach((k, i) => {
      const bx = mg + i * (bxW + 3);
      doc.setFillColor(...BG); doc.setDrawColor(...BD); doc.setLineWidth(0.25);
      doc.rect(bx, y, bxW, 17, "FD");
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...LG);
      doc.text(k.l, bx + 3, y + 5);
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...DK);
      doc.text(k.v, bx + 3, y + 12);
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...LG);
      doc.text(k.s, bx + 3, y + 16);
    });
    y += 23;

    // ── Seção 4: Comparativo CBS+IBS ──
    if (y + 95 > 278) { doc.addPage(); drawFrame(); y = 46; }
    section("Comparativo CBS+IBS — 2027 a 2033");

    const liq2027pdf = calcReforma({
      frete, regime, pctExportacao,
      cbsAliq:9.3, ibsAliq:0,
      usaFrota, pctFrota, insumosAtivos, insumosCusto,
      usaTerceiros, pctTerceiros, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros,
      insumosAtivosTerceiros, insumosCustoTerceiros,
      usaAgregados, pctAgregados, regimeAgregado, margemAgregados,
      insumosAtivosAgregados, insumosCustoAgregados,
    }).totalRecolher;
    const liq2033pdf = calcReforma({
      frete, regime, pctExportacao,
      cbsAliq:9.3, ibsAliq:18.7,
      usaFrota, pctFrota, insumosAtivos, insumosCusto,
      usaTerceiros, pctTerceiros, mixAutonomo, mixSN, mixLucro, margemTerceiros, lucroRateTerceiros,
      insumosAtivosTerceiros, insumosCustoTerceiros,
      usaAgregados, pctAgregados, regimeAgregado, margemAgregados,
      insumosAtivosAgregados, insumosCustoAgregados,
    }).totalRecolher;
    const vAnoPDF = (reforma.totalRecolher - liq2027pdf) / Math.max(liq2027pdf, 1) * 100;
    const v33PDF  = (liq2033pdf - liq2027pdf) / Math.max(liq2027pdf, 1) * 100;

    // 3 colunas comparativas — altura fixa 34mm
    const CMP_H = 34;
    const bxCmp = (cw - 6) / 3;
    [
      {titulo:"2027 — CBS Ativa",          sub:"CBS 9,3% · IBS ainda não vigora",  valor:liq2027pdf,            varP:null,    cor:[29,91,215]},
      {titulo:String(m.ano)+" — "+m.label, sub:"CBS "+m.cbs+"% + IBS "+m.ibs+"%", valor:reforma.totalRecolher, varP:vAnoPDF, cor:OR},
      {titulo:"2033 — IVA Dual Pleno",     sub:"CBS 9,3% + IBS 18,7%",            valor:liq2033pdf,            varP:v33PDF,  cor:[220,38,38]},
    ].forEach((bx, i) => {
      const bxLeft = mg + i * (bxCmp + 3);
      doc.setFillColor(...BG); doc.setDrawColor(...BD); doc.setLineWidth(0.25);
      doc.rect(bxLeft, y, bxCmp, CMP_H, "FD");
      doc.setFillColor(...bx.cor);
      doc.rect(bxLeft, y, bxCmp, 2.5, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...bx.cor);
      doc.text(bx.titulo, bxLeft + 3, y + 8);
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...LG);
      doc.splitTextToSize(bx.sub, bxCmp - 6).forEach((l, li) => {
        doc.text(l, bxLeft + 3, y + 13 + li * 3.5);
      });
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...DK);
      doc.text(BRL(bx.valor), bxLeft + 3, y + 24);
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
      if (bx.varP !== null) {
        const up = bx.varP > 0;
        doc.setTextColor(up ? 220 : 22, up ? 38 : 163, up ? 38 : 74);
        doc.text((up ? "▲ +" : "▼ ") + Math.abs(bx.varP).toFixed(0) + "% vs. 2027", bxLeft + 3, y + 30);
      } else {
        doc.setTextColor(...LG);
        doc.text(BRL(liq2027pdf*12) + "/ano", bxLeft + 3, y + 30);
      }
    });
    y += CMP_H + 6;

    // Narrativa comercial — altura dinâmica
    const credTotPDF = reforma.totalCreditoCBS + reforma.totalCreditoIBS;
    const debTotPDF  = reforma.cbsDebito + reforma.ibsDebito;
    const eficPDF    = debTotPDF > 0 ? credTotPDF / debTotPDF * 100 : 0;
    const narrativaTxt = vAnoPDF > 0
      ? `Em ${m.ano}, o tributo CBS+IBS sobe de ${BRL(liq2027pdf)} (2027) para ${BRL(reforma.totalRecolher)}/mês (+${vAnoPDF.toFixed(0)}%), com IBS entrando de forma escalonada. Em 2033 chegará a ${BRL(liq2033pdf)}/mês (+${v33PDF.toFixed(0)}% vs. 2027).`
      : `Em ${m.ano}, com créditos sobre insumos, o tributo CBS+IBS é ${BRL(reforma.totalRecolher)}/mês. Os ${BRL(credTotPDF)}/mês em créditos compensam ${eficPDF.toFixed(0)}% do débito total — quem mapear os insumos sai na frente.`;
    const nLines = doc.splitTextToSize(narrativaTxt, cw - 12);
    const nBoxH = 12 + nLines.length * 4.5;
    if (y + nBoxH > 278) { doc.addPage(); drawFrame(); y = 46; }
    doc.setFillColor(255, 244, 229);
    doc.rect(mg, y, cw, nBoxH, "F");
    doc.setFillColor(...OR); doc.rect(mg, y, 3, nBoxH, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...OR);
    doc.text("O que muda para o seu negócio", mg + 6, y + 7);
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...DK);
    let ny = y + 12;
    nLines.forEach(l => { doc.text(l, mg + 6, ny); ny += 4.5; });
    y += nBoxH + 5;

    // KPIs rápidos — 3 colunas, altura fixa 20mm
    const KPI_H = 20;
    const kpiBxPDF = (cw - 6) / 3;
    if (y + KPI_H > 278) { doc.addPage(); drawFrame(); y = 46; }
    [
      {l:"Por R$ 1.000 faturados",  v1:"2027: R$ "+(liq2027pdf/frete*1000).toFixed(2),  v2:"Em "+m.ano+": R$ "+(reforma.totalRecolher/frete*1000).toFixed(2)},
      {l:"Créditos recuperados",    v1:BRL(credTotPDF)+"/mês",                           v2:eficPDF.toFixed(0)+"% do débito total"},
      {l:"Carga efetiva s/ fat.",   v1:"2027: "+(liq2027pdf/frete*100).toFixed(2)+"%",   v2:"Em "+m.ano+": "+(reforma.totalRecolher/frete*100).toFixed(2)+"%"},
    ].forEach((k, i) => {
      const kx = mg + i * (kpiBxPDF + 3);
      doc.setFillColor(...BG); doc.setDrawColor(...BD); doc.setLineWidth(0.25);
      doc.rect(kx, y, kpiBxPDF, KPI_H, "FD");
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...LG);
      doc.text(k.l, kx + 3, y + 6);
      doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...DK);
      doc.text(k.v1, kx + 3, y + 12);
      doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...OR);
      doc.text(k.v2, kx + 3, y + 17.5);
    });
    y += KPI_H + 8;

    // ── Seção 5: Projeção ──
    if (y + 55 > 278) { doc.addPage(); drawFrame(); y = 46; }
    section("Projeção do Tributo Líquido — 2027 a 2033");
    y += 2;

    const vals = MILES.map(mi => calcTot(mi));
    const maxV = Math.max(...vals, 1);
    const barH = 26, bW2 = cw / MILES.length;

    MILES.forEach((mi, i) => {
      const h = Math.max(1.5, (vals[i] / maxV) * barH);
      const bx = mg + i * bW2;
      const active = mi.ano === ano;
      doc.setFillColor(active ? OR[0] : 210, active ? OR[1] : 210, active ? OR[2] : 220);
      doc.rect(bx + 1.5, y + barH - h, bW2 - 3, h, "F");
      doc.setFont("helvetica", active ? "bold" : "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(active ? OR[0] : GR[0], active ? OR[1] : GR[1], active ? OR[2] : GR[2]);
      const lbl = vals[i] < 1000 ? "R$"+Math.round(vals[i]) : "R$"+(vals[i]/1000).toFixed(1)+"k";
      doc.text(lbl, bx + bW2/2, y + barH - h - 1.5, {align:"center"});
      doc.text(String(mi.ano), bx + bW2/2, y + barH + 5, {align:"center"});
    });
    y += barH + 14;

    // ── Seção 6: Análise e Recomendações ──
    if (y + 30 > 278) { doc.addPage(); drawFrame(); y = 46; }
    section("Análise e Recomendações");
    y += 2;

    const recs = [];
    if (usaFrota && reforma.creditoCBS_frota + reforma.creditoIBS_frota > 0)
      recs.push({t:"Frota própria: créditos plenos sobre insumos operacionais",
        d:`A frota própria gera ${BRL(reforma.creditoCBS_frota + reforma.creditoIBS_frota)}/mês em créditos de CBS e IBS sobre ${Object.values(insumosAtivos).filter(Boolean).length} insumos ativos (diesel, pneus, peças, manutenção, pedágios).`});
    if (usaTerceiros) {
      const cbsM = calcCBSCredito(mixAutonomo, mixSN, mixLucro, lucroRateTerceiros);
      recs.push({t:`Subcontratados: crédito CBS médio de ${cbsM.toFixed(2)}%`,
        d:`Composição atual: ${mixAutonomo}% autônomos · ${mixSN}% Simples Nacional · ${mixLucro}% Lucro Real. ${mixLucro < 30 ? "Ampliar participação de prestadores no Lucro Real eleva significativamente os créditos." : "Composição equilibrada para aproveitamento de créditos."}`});
    }
    if (pctExportacao > 0)
      recs.push({t:`Exportações: ${pctExportacao}% isento de CBS e IBS`,
        d:"Receitas de exportação não geram débito. Créditos sobre insumos são mantidos e podem ser ressarcidos, gerando caixa adicional."});
    recs.push({t:"Próximos passos: adequação à Reforma Tributária",
      d:"Atualização dos layouts de CT-e e NF-e para os campos CBS/IBS (obrigatório em 2027), certificação do TMS/ERP e revisão de contratos com cláusula de reajuste tributário."});

    recs.forEach(r => {
      const tLines = doc.splitTextToSize(r.t, cw - 10);
      const dLines = doc.splitTextToSize(r.d, cw - 10);
      const recH = tLines.length * 5 + dLines.length * 4.5 + 8;
      if (y + recH > 278) { doc.addPage(); drawFrame(); y = 46; }
      doc.setFillColor(...OR);
      doc.circle(mg + 3, y + 2, 1.2, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...DK);
      let ry = y;
      tLines.forEach(l => { doc.text(l, mg + 7, ry); ry += 4.8; });
      doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...GR);
      dLines.forEach(l => { doc.text(l, mg + 7, ry); ry += 4.5; });
      y = ry + 5;
    });

    // ── Plano de Ação ──
    if (y + 20 > 278) { doc.addPage(); drawFrame(); y = 46; }
    doc.setFillColor(...OR); doc.rect(mg, y, 2.5, 7, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...GR);
    doc.text("PLANO DE AÇÃO — COMO SE PREPARAR", mg + 5, y + 5);
    y += 13;
    doc.setDrawColor(...BD); doc.setLineWidth(0.25);
    doc.line(mg, y - 1, W - mg, y - 1);
    y += 4;

    [
      {prazo:"Ago 2026", status:"URGENTE", cor:[220,38,38],
       acao:"Atualizar layout CT-e e NF-e com campos CBS/IBS obrigatórios",
       imp:"Multa por emissão incorreta a partir de jan/2027 — sistemas devem estar prontos"},
      {prazo:"Dez 2026", status:"URGENTE", cor:[220,38,38],
       acao:"Certificar TMS/ERP para emissão no novo padrão fiscal CBS/IBS",
       imp:"Risco de glosa de créditos e inconsistência fiscal em todo o período de transição"},
      {prazo:"Jan 2027", status:"OPORT.",  cor:[22,163,74],
       acao:"Mapear mix de fornecedores (autônomo/SN/LP-LR) para maximizar crédito CBS",
       imp:"Mix médio TRC = 3,73%. Cada 10pp a mais em LP/LR aumenta o crédito em ~0,75%"},
      {prazo:"Jun 2027", status:"ATENÇÃO", cor:[180,83,9],
       acao:"Inserir cláusula de reajuste tributário em contratos de longo prazo",
       imp:"Garante repasse do IVA Dual ao tomador sem comprimir a margem da transportadora"},
      {prazo:"2026",     status:"ATENÇÃO", cor:[180,83,9],
       acao:"Capacitar equipe fiscal e comercial nas regras CBS, IBS e créditos",
       imp:"Apenas 23% das transportadoras iniciaram a adaptação (ABCAM 2025)"},
    ].forEach(a => {
      const aLines = doc.splitTextToSize(a.acao, cw - 22);
      const iLines = doc.splitTextToSize("Impacto: " + a.imp, cw - 22);
      const boxH = 9 + aLines.length * 4 + iLines.length * 3.8 + 4;
      if (y + boxH > 278) { doc.addPage(); drawFrame(); y = 46; }
      doc.setFillColor(...BG); doc.setDrawColor(...BD); doc.setLineWidth(0.2);
      doc.rect(mg, y, cw, boxH, "FD");
      doc.setFillColor(...a.cor); doc.rect(mg, y, 2.5, boxH, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...a.cor);
      doc.text(a.status, mg + 5, y + 6);
      doc.setFontSize(6.5); doc.setTextColor(...LG);
      doc.text(a.prazo, W - mg - 3, y + 6, {align:"right"});
      let ay = y + 11;
      doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...DK);
      aLines.forEach(l => { doc.text(l, mg + 5, ay); ay += 4; });
      ay += 1.5;
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...LG);
      iLines.forEach(l => { doc.text(l, mg + 5, ay); ay += 3.8; });
      y += boxH + 3;
    });
    y += 3;

    // ── Disclaimer ──
    if (y > 268) { doc.addPage(); drawFrame(); y = 46; }
    y += 3;
    doc.setDrawColor(...BD); doc.setLineWidth(0.25); doc.line(mg, y, W - mg, y); y += 5;
    doc.setFont("helvetica","italic"); doc.setFontSize(7); doc.setTextColor(...LG);
    doc.splitTextToSize("Este documento é de caráter informativo e não substitui uma consulta tributária especializada. Os valores são estimativas baseadas nos parâmetros informados e nas alíquotas previstas na LC 214/2025.", cw)
      .forEach(l => { doc.text(l, mg, y); y += 3.8; });

    doc.save("RumoBrasil_Analise-Tributaria_" + m.ano + "_" + new Date().toISOString().slice(0,10) + ".pdf");
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:isMob?"auto":"calc(100vh - 48px)",minHeight:isMob?"100svh":"auto"}}>
      {/* Sub-header */}
      <div style={{background:C.bg1,borderBottom:"1px solid "+C.border,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:C.green,display:"inline-block",animation:"liveDot 2s infinite"}}/>
          <span style={{fontFamily:F.sans,fontSize:13,fontWeight:600,color:C.text}}>Simulador TRC</span>
          <Bdg color={C.brand}>REFORMA</Bdg>
          <span style={{fontFamily:F.sans,fontSize:10,color:C.text3}}>CBS + IBS — LC 214/2025</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:F.sans,fontSize:10,color:C.text2}}>Somente Reforma Tributária (a partir de 2027)</span>
          <button onClick={()=>gerarPDF()}
            style={{display:"flex",alignItems:"center",gap:5,border:"none",background:C.brand,color:"#fff",borderRadius:2,padding:"5px 12px",cursor:"pointer",fontFamily:F.sans,fontSize:10,fontWeight:600,letterSpacing:0.3}}>
            ↓ Exportar PDF
          </button>
        </div>
      </div>

      {/* Grid principal */}
      <div style={{display:"grid",gridTemplateColumns:isMob?"1fr":"300px 1fr",gap:1,flex:isMob?undefined:1,overflow:isMob?"visible":"hidden"}}>

        {/* Coluna esquerda — Perfil */}
        <div style={{background:C.bg1,padding:"14px 16px",overflowY:isMob?"visible":"auto",height:isMob?"auto":"100%"}}>
          <SL>Perfil do cliente</SL>

          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
            <NInput label="Faturamento / mês" raw={rf} setRaw={setRf} onBlur={cf} prefix="R$"/>
          </div>

          <D my={6}/>

          {/* Regime tributário */}
          <SL>Regime tributário</SL>
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:6}}>
            {[
              {r:"Simples Nacional",  cor:C.red,   hint:"Sem direito a créditos CBS/IBS"},
              {r:"Lucro Presumido",   cor:C.brand, hint:"Crédito CBS sobre insumos (~65%)"},
              {r:"Lucro Real",        cor:C.green, hint:"Crédito CBS pleno sobre insumos"},
            ].map(({r,cor,hint})=>(
              <button key={r} onClick={()=>setRegime(r)}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",border:"1px solid "+(regime===r?cor:C.border),background:regime===r?cor+"18":C.bg2,borderRadius:3,padding:"8px 12px",cursor:"pointer",minHeight:44,WebkitTapHighlightColor:"transparent",touchAction:"manipulation",transition:"all 0.12s"}}>
                <span style={{fontFamily:F.sans,fontSize:10,color:regime===r?cor:C.text2,fontWeight:regime===r?600:400}}>{r}</span>
                {regime===r && <span style={{fontFamily:F.sans,fontSize:8,color:cor,maxWidth:120,textAlign:"right",lineHeight:1.3}}>{hint}</span>}
              </button>
            ))}
          </div>
          {regime==="Simples Nacional" && (
            <div style={{marginBottom:6,padding:"5px 8px",background:C.redLt,border:"1px solid "+C.red+"33",borderRadius:2,fontFamily:F.sans,fontSize:9,color:C.red}}>
              ⚠️ SN: todos os créditos CBS/IBS zerados — débito integral
            </div>
          )}
          {regime==="Simples Nacional" && frete*12>4800000 && (
            <div style={{marginBottom:6,padding:"7px 10px",background:"#FEF2F2",border:"2px solid "+C.red,borderRadius:3,fontFamily:F.sans,fontSize:9,color:C.red,lineHeight:1.5}}>
              <div style={{fontWeight:700,marginBottom:2}}>⛔ LIMITE SN ULTRAPASSADO</div>
              Faturamento anual projetado: <strong>R$ {(frete*12).toLocaleString("pt-BR",{maximumFractionDigits:0})}</strong><br/>
              Limite Simples Nacional (LC 123/2006): R$ 4.800.000/ano<br/>
              Empresa não pode optar pelo Simples Nacional neste faturamento.
            </div>
          )}

          <D my={6}/>

          {/* Exportação */}
          <NInput label="% Exportação" hint="imune CBS/IBS — créditos mantidos e acumuláveis" raw={rExp} setRaw={setRExp} onBlur={cExp} suffix="%"/>
          {pctExportacao > 0 && (
            <div style={{marginTop:4,padding:"5px 8px",background:C.greenLt,border:"1px solid "+C.green+"33",borderRadius:2,fontFamily:F.sans,fontSize:9,color:C.green}}>
              Exportação: {pctExportacao}% imune (LC 214/2025, art. 7º) — créditos mantidos e acumuláveis
            </div>
          )}

          <D my={8}/>

          {/* Terceiros — inputs direto no sidebar */}
          <SL>Terceiros</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
            <NInput label="Margem transportadora" hint="base crédito = frete × (1−margem)" raw={rMT} setRaw={setRMT} onBlur={cMT} suffix="%"/>
          </div>

          <SL>Mix de regime dos terceiros</SL>
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:4}}>
            <NInput label="Autônomo (TAC/TRC)" hint="CBS 1,86%" raw={rA} setRaw={setRA} onBlur={cA} suffix="%"/>
            <NInput label="Simples Nacional" hint="CBS 2,50%" raw={rS} setRaw={setRS} onBlur={cS} suffix="%"/>
            <div>
              <div style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
                {["Lucro Real","Lucro Presumido"].map(opt=>(
                  <button key={opt} onClick={()=>setRegimeLucroTerceiros(opt)}
                    style={{border:"1px solid "+(regimeLucroTerceiros===opt?C.brand:C.border),background:regimeLucroTerceiros===opt?C.brand+"18":C.bg2,color:regimeLucroTerceiros===opt?C.brand:C.text2,borderRadius:2,padding:"3px 8px",cursor:"pointer",fontFamily:F.sans,fontSize:9,transition:"all 0.12s",WebkitTapHighlightColor:"transparent"}}>
                    {opt==="Lucro Real"?"LR 9,3%":"LP 9,25%"}
                  </button>
                ))}
              </div>
              <NInput label={"Lucro Presumido / Real"} hint={"CBS "+(regimeLucroTerceiros==="Lucro Real"?"9,3%":"9,25%")} raw={rL} setRaw={setRL} onBlur={cL} suffix="%"/>
            </div>
          </div>
          <div style={{marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 8px",background:mixTot===100?C.greenLt:C.redLt,border:"1px solid "+(mixTot===100?C.green+"33":C.red+"33"),borderRadius:2}}>
            <span style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>Total mix:</span>
            <span style={{fontFamily:F.mono,fontSize:10,color:mixColor,fontWeight:600}}>{mixTot}% {mixTot===100?"✓":"(revisar)"}</span>
          </div>

          <D my={8}/>

          {/* Ano simulado */}
          <SL>Ano simulado</SL>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:4}}>
            {MILES.map(mi=>(
              <button key={mi.ano} onClick={()=>setAno(mi.ano)}
                style={{border:"1px solid "+(ano===mi.ano?mi.cor:C.border),background:ano===mi.ano?mi.cor+"18":C.bg2,color:ano===mi.ano?mi.cor:C.text2,borderRadius:2,padding:"4px 8px",cursor:"pointer",fontFamily:F.mono,fontSize:10,transition:"all 0.12s"}}>
                {mi.ano}
              </button>
            ))}
          </div>
          <div style={{fontFamily:F.sans,fontSize:9,color:m.cor,marginBottom:8}}>{m.label} — {m.total}% nominal</div>


        </div>

        {/* Coluna direita — Tabela de cálculo */}
        <div style={{overflowY:isMob?"visible":"auto",height:isMob?"auto":"100%",padding:"16px 20px"}}>

          {/* ═══ TABELA DE CÁLCULO ═══ */}
          {(()=>{
            const baseTrib    = frete*(1-pctExportacao/100);
            const baseExp     = frete*pctExportacao/100;
            const baseTer     = frete*(1-(margemTerceiros||0)/100);
            const tot         = mixAutonomo+mixSN+mixLucro||1;
            const baseAuto    = baseTer*(mixAutonomo/tot);
            const baseSN_mix  = baseTer*(mixSN/tot);
            const baseLPLR    = baseTer*(mixLucro/tot);
            const aliqHoje    = regime==="Lucro Real"?0.0925:0.0365;
            const lblHoje     = regime==="Lucro Real"?"9,25%":"3,65%";
            // Créditos HOJE (PIS/COFINS): só LR gera crédito de LR sobre terceiros LR
            const credHojeAuto  = 0;
            const credHojeSN    = 0;
            const credHojeLPLR  = regime==="Lucro Real"?(baseLPLR*(lucroRateTerceiros/100)):0;
            const totalCredHoje = credHojeAuto+credHojeSN+credHojeLPLR;
            const debitoHojeCalc= baseTrib*aliqHoje;
            const custoHojeCalc = Math.max(0,debitoHojeCalc-totalCredHoje);
            // Créditos REFORMA (CBS) por regime
            const credCBSAuto   = baseAuto*CBS_CRED.autonomo/100;
            const credCBSSN     = baseSN_mix*CBS_CRED.simplesNacional/100;
            const credCBSLPLR   = baseLPLR*(lucroRateTerceiros/100);
            const totalCredCBS  = credCBSAuto+credCBSSN+credCBSLPLR;
            const credIBSTot    = reforma.creditoIBS_terceiros;
            const totalCredReforma = totalCredCBS+credIBSTot;
            const debitoReforma = reforma.cbsDebito+reforma.ibsDebito;
            const custoReforma  = reforma.totalRecolher;
            const diferenca     = custoReforma-custoHojeCalc;
            const corDif        = diferenca>0?C.red:C.green;
            const dif33         = liq2033-custoHojeCalc;
            const corDif33      = dif33>0?C.red:C.green;

            const R=(v)=>"R$ "+(v||0).toLocaleString("pt-BR",{maximumFractionDigits:0});
            const pct=(v)=>(v||0).toFixed(2)+"%";

            // Row style helpers
            const rowBase = {display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderBottom:"1px solid "+C.border,alignItems:"center"};
            const cell = (content,opts={})=>(
              <div style={{padding:"7px 10px",fontFamily:opts.mono?F.mono:F.sans,fontSize:opts.big?13:opts.sm?9:11,color:opts.color||C.text,fontWeight:opts.bold?700:opts.med?500:400,textAlign:opts.right?"right":"left",background:opts.bg||"transparent",...(opts.style||{})}}>
                {content}
              </div>
            );
            const section=(label)=>(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",background:C.bg2,borderBottom:"1px solid "+C.border,borderTop:"2px solid "+C.border}}>
                {cell(label,{bold:true,sm:false,color:C.text2})}
                {cell("")}{cell("")}
              </div>
            );

            return(
              <div style={{border:"1px solid "+C.border,borderRadius:4,overflow:"hidden",fontFamily:F.sans}}>

                {/* Cabeçalho */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",background:C.brand,borderBottom:"2px solid "+C.brand}}>
                  {cell("",{color:"#fff",bold:true})}
                  {cell("Hoje — PIS/COFINS "+lblHoje,{color:"#fff",bold:true,sm:true})}
                  {cell("Reforma "+ano+" — CBS+IBS "+m.total+"%",{color:"#fff",bold:true,sm:true})}
                </div>

                {/* Faturamento */}
                <div style={rowBase}>
                  {cell("Faturamento bruto",{color:C.text2})}
                  {cell(R(frete),{mono:true,right:true,color:C.text})}
                  {cell(R(frete),{mono:true,right:true,color:C.text})}
                </div>

                {/* Exportação */}
                {pctExportacao>0 && (
                  <div style={rowBase}>
                    {cell("(-) Exportação imune "+pctExportacao+"%",{color:C.text2})}
                    {cell("("+R(baseExp)+")",{mono:true,right:true,color:C.green})}
                    {cell("("+R(baseExp)+")",{mono:true,right:true,color:C.green})}
                  </div>
                )}

                {/* Base tributável */}
                <div style={{...rowBase,background:C.bg2}}>
                  {cell("Base tributável",{bold:true,color:C.text})}
                  {cell(R(baseTrib),{mono:true,right:true,bold:true,color:C.text})}
                  {cell(R(baseTrib),{mono:true,right:true,bold:true,color:C.text})}
                </div>

                {/* Alíquota débito */}
                <div style={rowBase}>
                  {cell("Alíquota débito",{color:C.text2})}
                  {cell(lblHoje,{mono:true,right:true,color:C.text3})}
                  {cell(m.total+"%",{mono:true,right:true,color:C.text3})}
                </div>

                {/* Débito */}
                <div style={{...rowBase,background:C.redLt}}>
                  {cell("Débito",{med:true,color:C.red})}
                  {cell(R(debitoHojeCalc),{mono:true,right:true,color:C.red,bold:true})}
                  {cell(R(debitoReforma),{mono:true,right:true,color:C.red,bold:true})}
                </div>

                {/* Seção créditos */}
                {section("Créditos por regime dos terceiros")}

                {/* Autônomo */}
                <div style={rowBase}>
                  {cell("Autônomo — "+mixAutonomo+"% do mix (CBS 1,86%)",{sm:true,color:C.text3})}
                  {cell("—",{mono:true,right:true,color:C.text3})}
                  {cell(R(credCBSAuto),{mono:true,right:true,color:C.green})}
                </div>

                {/* SN */}
                <div style={rowBase}>
                  {cell("Simples Nacional — "+mixSN+"% do mix (CBS 2,50%)",{sm:true,color:C.text3})}
                  {cell("—",{mono:true,right:true,color:C.text3})}
                  {cell(R(credCBSSN),{mono:true,right:true,color:C.green})}
                </div>

                {/* LP/LR */}
                <div style={rowBase}>
                  {cell((regimeLucroTerceiros==="Lucro Real"?"Lucro Real":"Lucro Presumido")+" — "+mixLucro+"% do mix (CBS "+(regimeLucroTerceiros==="Lucro Real"?"9,3%":"9,25%")+")",{sm:true,color:C.text3})}
                  {cell(credHojeLPLR>0?R(credHojeLPLR):"—",{mono:true,right:true,color:credHojeLPLR>0?C.green:C.text3})}
                  {cell(R(credCBSLPLR),{mono:true,right:true,color:C.green})}
                </div>

                {/* IBS crédito */}
                {m.ibs>0 && (
                  <div style={rowBase}>
                    {cell("Crédito IBS ("+m.ibs+"%) — base terceiros",{sm:true,color:C.text3})}
                    {cell("—",{mono:true,right:true,color:C.text3})}
                    {cell(R(credIBSTot),{mono:true,right:true,color:C.purple})}
                  </div>
                )}

                {/* Total créditos */}
                <div style={{...rowBase,background:C.greenLt}}>
                  {cell("Total créditos",{med:true,color:C.green})}
                  {cell(totalCredHoje>0?R(totalCredHoje):"—",{mono:true,right:true,color:C.green,bold:true})}
                  {cell(R(totalCredReforma),{mono:true,right:true,color:C.green,bold:true})}
                </div>

                {/* Custo líquido */}
                <div style={{...rowBase,background:C.bg2,borderTop:"2px solid "+C.border}}>
                  {cell("Custo líquido (débito − créditos)",{bold:true,color:C.text})}
                  {cell(R(custoHojeCalc),{mono:true,right:true,bold:true,big:true,color:C.text})}
                  {cell(R(custoReforma),{mono:true,right:true,bold:true,big:true,color:colAno})}
                </div>

                {/* Diferença — destaque */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",background:corDif+"18",borderTop:"2px solid "+corDif}}>
                  {cell(diferenca>0?"▲ Custo adicional reforma":"▼ Economia com a reforma",{bold:true,color:corDif})}
                  {cell("referência",{mono:true,right:true,color:C.text3,sm:true})}
                  <div style={{padding:"10px",textAlign:"right"}}>
                    <div style={{fontFamily:F.mono,fontSize:18,color:corDif,fontWeight:800}}>{diferenca>0?"+":""}{R(diferenca)}</div>
                    <div style={{fontFamily:F.mono,fontSize:11,color:corDif,fontWeight:600}}>{(diferenca/Math.max(custoHojeCalc,1)*100).toFixed(1)}% sobre hoje</div>
                  </div>
                </div>

                {/* 2033 */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderTop:"1px solid "+C.border,background:C.bg2}}>
                  {cell("2033 — IVA Dual pleno (28%)",{color:C.text2})}
                  {cell("referência",{mono:true,right:true,color:C.text3,sm:true})}
                  <div style={{padding:"7px 10px",textAlign:"right"}}>
                    <div style={{fontFamily:F.mono,fontSize:13,color:corDif33,fontWeight:700}}>{R(liq2033)}</div>
                    <div style={{fontFamily:F.mono,fontSize:10,color:corDif33}}>{dif33>0?"+":""}{R(dif33)} ({(dif33/Math.max(custoHojeCalc,1)*100).toFixed(1)}%)</div>
                  </div>
                </div>

              </div>
            );
          })()}

          {/* ═══ DESPESAS SEM DIREITO A CRÉDITO CBS/IBS ═══ */}
          <div style={{background:C.bg1,padding:"14px 16px",borderTop:"1px solid "+C.border}}>
            <div onClick={()=>togCol("despSC")} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",padding:"10px 12px",marginBottom:4,userSelect:"none",background:C.bg2,border:"1px solid "+C.border,borderRadius:3,minHeight:44,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
              <span style={{fontFamily:F.sans,fontSize:10,color:C.text2,fontWeight:600,textTransform:"uppercase",letterSpacing:0.6}}>Despesas sem crédito CBS/IBS</span>
              <span style={{fontFamily:F.mono,fontSize:11,color:C.text,background:C.bg3,borderRadius:3,padding:"3px 10px",minWidth:32,textAlign:"center",border:"1px solid "+C.border}}>{collapsed["despSC"]?"▶ abrir":"▼ recolher"}</span>
            </div>
            <div style={{display:collapsed["despSC"]?"none":undefined}}>
            <div style={{marginBottom:8,fontFamily:F.sans,fontSize:9,color:C.text2}}>
              Custos que não geram crédito de CBS ou IBS, independente do regime — registre abaixo como % do faturamento mensal (R$ {frete.toLocaleString("pt-BR",{maximumFractionDigits:0})}/mês).
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {DESPESAS_SEM_CREDITO.map(desp=>(
                <DespesaSCCheck
                  key={desp.id}
                  desp={desp}
                  ativo={despesasSCAtivas[desp.id]||false}
                  pct={despesasSCCusto[desp.id]||0}
                  frete={frete}
                  onToggle={()=>toggleDespesaSC(desp.id)}
                  onPctChange={(v)=>setDespesaSCCusto(desp.id,v)}
                />
              ))}
            </div>
            {(()=>{
              const ativas = DESPESAS_SEM_CREDITO.filter(d=>despesasSCAtivas[d.id]);
              if (!ativas.length) return null;
              const totalSC = ativas.reduce((s,d)=>s+(frete*(despesasSCCusto[d.id]||0)/100),0);
              const totalPct = ativas.reduce((s,d)=>s+(despesasSCCusto[d.id]||0),0);
              return (
                <div style={{marginTop:12}}>
                  <SL right={<Bdg color={C.red}>SEM CRÉDITO</Bdg>}>Despesas sem crédito apuradas</SL>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{borderBottom:"1px solid "+C.border}}>
                        {["Despesa","% fat.","Custo/mês"].map(h=>(
                          <th key={h} style={{fontFamily:F.sans,fontSize:9,color:C.text2,padding:"4px 0",textAlign:"left",fontWeight:400}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ativas.map((d,i)=>(
                        <tr key={i} style={{borderBottom:"1px solid "+C.border}}>
                          <td style={{fontFamily:F.sans,fontSize:10,color:C.text2,padding:"5px 0"}}>{d.nome}</td>
                          <td style={{fontFamily:F.mono,fontSize:10,color:C.text3}}>{(despesasSCCusto[d.id]||0).toFixed(1)}%</td>
                          <td style={{fontFamily:F.mono,fontSize:10,color:C.red}}>R$ {(frete*(despesasSCCusto[d.id]||0)/100).toLocaleString("pt-BR",{maximumFractionDigits:0})}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{marginTop:6,padding:"6px 10px",background:C.redLt,border:"1px solid "+C.red+"33",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontFamily:F.sans,fontSize:10,color:C.red,fontWeight:500}}>Total despesas sem crédito</span>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:F.mono,fontSize:11,color:C.red,fontWeight:600}}>R$ {totalSC.toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                      <div style={{fontFamily:F.mono,fontSize:8,color:C.text3}}>{totalPct.toFixed(1)}% do faturamento</div>
                    </div>
                  </div>
                </div>
              );
            })()}
            </div>
          </div>

          {/* ═══ RESULTADO & IMPACTO ═══ */}
          <div style={{background:C.bg1,borderTop:"1px solid "+C.border}}>

            <div style={{padding:"14px 16px",borderBottom:"1px solid "+C.border}}>
              <SL right={<Bdg color={C.brand}>CBS + IBS · {ano}</Bdg>}>Resultado da simulação</SL>

            {/* Apuração CBS + IBS */}
            <div style={{border:"1px solid "+C.border,borderTop:"3px solid "+C.brand,padding:"12px",marginBottom:10}}>
              <div onClick={()=>togCol("apuracao")} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",padding:"8px 10px",marginBottom:8,userSelect:"none",background:C.bg2,border:"1px solid "+C.border,borderRadius:3,minHeight:44,WebkitTapHighlightColor:"transparent",touchAction:"manipulation",margin:"-12px -12px 10px -12px",borderTop:"none",borderLeft:"none",borderRight:"none"}}>
                <span style={{fontFamily:F.sans,fontSize:10,color:C.brand,fontWeight:600,textTransform:"uppercase",letterSpacing:0.6}}>Apuração CBS + IBS — {ano}</span>
                <span style={{fontFamily:F.mono,fontSize:11,color:C.text,background:C.bg3,borderRadius:3,padding:"3px 10px",minWidth:32,textAlign:"center",border:"1px solid "+C.border}}>{collapsed["apuracao"]?"▶ abrir":"▼ recolher"}</span>
              </div>
              <div style={{display:collapsed["apuracao"]?"none":undefined}}>

              {/* CBS */}
              <div style={{marginBottom:8}}>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4,fontWeight:500}}>CBS (Federal) — {m.cbs}%</div>
                {[
                  {l:"Débito CBS",v:reforma.cbsDebito,c:C.red},
                  ...(usaFrota?[{l:"(-) Crédito CBS frota",v:reforma.creditoCBS_frota,c:C.green}]:[]),
                  ...(usaTerceiros?[{l:"(-) Crédito CBS terceiros",v:reforma.creditoCBS_terceiros,c:C.green}]:[]),
                  ...(usaAgregados?[{l:"(-) Crédito CBS agregados",v:reforma.creditoCBS_agregados,c:C.green}]:[]),
                ].map((r,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                    <span style={{fontFamily:F.sans,fontSize:10,color:C.text2}}>{r.l}</span>
                    <span style={{fontFamily:F.mono,fontSize:10,color:r.c}}>R$ {r.v.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                  </div>
                ))}
                <div style={{height:1,background:C.border,margin:"4px 0"}}/>
                <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                  <span style={{fontFamily:F.sans,fontSize:10,color:C.text,fontWeight:500}}>= CBS a recolher</span>
                  <span style={{fontFamily:F.mono,fontSize:11,color:C.blue,fontWeight:600}}>R$ {reforma.cbsRecolher.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                </div>
              </div>

              {/* IBS */}
              {m.ibs > 0 && (
                <div style={{marginBottom:8}}>
                  <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4,fontWeight:500}}>IBS (Est./Mun.) — {m.ibs}%</div>
                  {[
                    {l:"Débito IBS",v:reforma.ibsDebito,c:C.red},
                    ...(usaFrota?[{l:"(-) Crédito IBS frota",v:reforma.creditoIBS_frota,c:C.green}]:[]),
                    ...(usaTerceiros?[{l:"(-) Crédito IBS terceiros",v:reforma.creditoIBS_terceiros,c:C.green}]:[]),
                    ...(usaAgregados?[{l:"(-) Crédito IBS agregados",v:reforma.creditoIBS_agregados,c:C.green}]:[]),
                  ].map((r,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                      <span style={{fontFamily:F.sans,fontSize:10,color:C.text2}}>{r.l}</span>
                      <span style={{fontFamily:F.mono,fontSize:10,color:r.c}}>R$ {r.v.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                    </div>
                  ))}
                  <div style={{height:1,background:C.border,margin:"4px 0"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                    <span style={{fontFamily:F.sans,fontSize:10,color:C.text,fontWeight:500}}>= IBS a recolher</span>
                    <span style={{fontFamily:F.mono,fontSize:11,color:C.purple,fontWeight:600}}>R$ {reforma.ibsRecolher.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                  </div>
                </div>
              )}

              {regime === "Simples Nacional" && (
                <div style={{padding:"4px 8px",background:C.redLt,border:"1px solid "+C.red+"33",borderRadius:2,fontFamily:F.sans,fontSize:9,color:C.red,marginBottom:6}}>
                  SN: sem direito a créditos CBS/IBS — débito integral
                </div>
              )}
              </div>

              <div style={{height:1,background:C.brand+"44",margin:"6px 0"}}/>
              {reforma.totalSaldoCredor>0 ? (
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",background:C.greenLt,border:"1px solid "+C.green+"44",borderRadius:2,marginBottom:4}}>
                  <span style={{fontFamily:F.sans,fontSize:11,color:C.green,fontWeight:700}}>✓ SALDO CREDOR</span>
                  <span style={{fontFamily:F.mono,fontSize:16,color:C.green,fontWeight:700}}>R$ {reforma.totalSaldoCredor.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                </div>
              ) : (
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",background:C.redLt,border:"1px solid "+C.red+"44",borderRadius:2,marginBottom:4}}>
                  <span style={{fontFamily:F.sans,fontSize:11,color:C.red,fontWeight:700}}>⚠ TOTAL A RECOLHER</span>
                  <span style={{fontFamily:F.mono,fontSize:16,color:C.red,fontWeight:700}}>R$ {reforma.totalRecolher.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                </div>
              )}
              <div style={{fontFamily:F.mono,fontSize:9,color:C.text3,textAlign:"right"}}>{pctCarga.toFixed(2)}% do faturamento</div>

              {/* Tabela PIS/COFINS Hoje — só para Lucro Real */}
              {regime==="Lucro Real" && (
                <div style={{marginTop:10,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.border,borderLeft:"3px solid "+C.teal,borderRadius:2}}>
                  <div style={{fontFamily:F.sans,fontSize:9,color:C.teal,fontWeight:600,textTransform:"uppercase",letterSpacing:0.6,marginBottom:6}}>PIS/COFINS Hoje — Lucro Real (não-cumulativo)</div>
                  {[
                    {l:"Débito PIS/COFINS (9,25%)",  v:debitoHojeBruto, c:C.red},
                    ...(creditoHojeLR>0?[{l:"(-) Crédito PIS/COFINS frota+terceiros",v:creditoHojeLR,c:C.green}]:[]),
                  ].map((r,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                      <span style={{fontFamily:F.sans,fontSize:10,color:C.text2}}>{r.l}</span>
                      <span style={{fontFamily:F.mono,fontSize:10,color:r.c}}>R$ {r.v.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                    </div>
                  ))}
                  <div style={{height:1,background:C.border,margin:"4px 0"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                    <span style={{fontFamily:F.sans,fontSize:10,color:C.text,fontWeight:500}}>= PIS/COFINS a recolher hoje</span>
                    <span style={{fontFamily:F.mono,fontSize:11,color:C.teal,fontWeight:600}}>R$ {hoje.toLocaleString("pt-BR",{maximumFractionDigits:0})}</span>
                  </div>
                  <div style={{fontFamily:F.mono,fontSize:8,color:C.text3,textAlign:"right",marginTop:2}}>{pctHojeEfetivo.toFixed(2)}% efetivo sobre o faturamento</div>
                </div>
              )}

                {/* ── Impacto da Reforma Tributária ── */}
                <div style={{height:1,background:C.border,margin:"10px 0 8px"}}/>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,letterSpacing:0.6,textTransform:"uppercase",marginBottom:6}}>Impacto da Reforma Tributária</div>
                {[
                  {rotulo:"Hoje",      desc:descHoje, val:hoje,    variacao:null, cor:C.text3, ativo:false},
                  {rotulo:String(ano), desc:m.label,            val:liqAno,  variacao:vAno, cor:colAno,  ativo:true },
                  {rotulo:"2033",      desc:"IVA Dual pleno",   val:liq2033, variacao:v33,  cor:col33,   ativo:false},
                ].map((row,i)=>(
                  <div key={i} style={{
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"6px 8px",marginBottom:3,borderRadius:2,
                    background:row.ativo?row.cor+"11":C.bg2,
                    border:"1px solid "+(row.ativo?row.cor+"44":C.border),
                    borderLeft:"3px solid "+(row.ativo?row.cor:C.text3+"44"),
                  }}>
                    <div>
                      <span style={{fontFamily:F.mono,fontSize:10,color:row.ativo?row.cor:C.text2,marginRight:8}}>{row.rotulo}</span>
                      <span style={{fontFamily:F.sans,fontSize:9,color:C.text3}}>{row.desc}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontFamily:F.mono,fontSize:11,color:row.ativo?row.cor:C.text}}>
                        R$ {row.val.toLocaleString("pt-BR",{maximumFractionDigits:0})}
                      </span>
                      <span style={{fontFamily:F.mono,fontSize:10,color:row.cor,minWidth:54,textAlign:"right"}}>
                        {row.variacao===null?"referência":(row.variacao>0?"▲ +":"▼ ")+Math.abs(row.variacao).toFixed(0)+"%"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

            {/* KPIs */}
            <div style={{display:"grid",gridTemplateColumns:isMob?"1fr":"repeat(3,1fr)",gap:8,marginBottom:12}}>
              <div style={{background:C.bg2,border:"1px solid "+C.border,padding:"10px 12px"}}>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4}}>Débito total {ano}</div>
                <div style={{fontFamily:F.mono,fontSize:14,fontWeight:500,color:C.red,lineHeight:1}}>R$ {(reforma.cbsDebito+reforma.ibsDebito).toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,marginTop:3}}>CBS + IBS</div>
              </div>
              <div style={{background:C.bg2,border:"1px solid "+C.border,padding:"10px 12px"}}>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4}}>Crédito total {ano}</div>
                <div style={{fontFamily:F.mono,fontSize:14,fontWeight:500,color:C.green,lineHeight:1}}>R$ {(reforma.totalCreditoCBS+reforma.totalCreditoIBS).toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,marginTop:3}}>não-cumulatividade plena</div>
              </div>
              <div style={{background:C.bg2,border:"1px solid "+C.border,padding:"10px 12px"}}>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4}}>Impacto anual</div>
                <div style={{fontFamily:F.mono,fontSize:14,fontWeight:500,color:C.brand,lineHeight:1}}>R$ {(reforma.totalRecolher*12).toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                <div style={{fontFamily:F.sans,fontSize:9,color:C.text3,marginTop:3}}>tributo estimado/ano</div>
              </div>
            </div>

            {/* Custo por cenário */}
            <div style={{marginBottom:12}}>
              <SL>Custo mensal por cenário</SL>
              <div style={{display:"grid",gridTemplateColumns:isMob?"1fr":"repeat(3,1fr)",gap:8}}>
                {usaFrota && (
                  <div style={{padding:"10px 12px",background:C.blueLt,border:"1px solid "+C.blue+"33"}}>
                    <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4}}>🚛 Frota Própria</div>
                    <div style={{fontFamily:F.mono,fontSize:13,fontWeight:500,color:C.blue}}>R$ {reforma.custoFrota.toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginTop:2}}>insumos selecionados</div>
                  </div>
                )}
                {usaTerceiros && (
                  <div style={{padding:"10px 12px",background:C.amberLt,border:"1px solid "+C.amber+"33"}}>
                    <div style={{fontFamily:F.sans,fontSize:9,color:C.text2,marginBottom:4}}>👥 Terceiros</div>
                    <div style={{fontFamily:F.mono,fontSize:13,fontWeight:500,color:C.amber}}>R$ {reforma.custoTerceiros.toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text3,marginTop:2}}>valor subcontratado</div>
                  </div>
                )}
                {usaAgregados&&(
                  <div style={{padding:"8px 10px",background:C.greenLt,border:"1px solid "+C.green+"33"}}>
                    <div style={{fontFamily:F.sans,fontSize:8,color:C.text2,marginBottom:3}}>🤝 Agregados</div>
                    <div style={{fontFamily:F.mono,fontSize:12,color:C.green}}>R$ {reforma.custoAgregados.toLocaleString("pt-BR",{maximumFractionDigits:0})}</div>
                  </div>
                )}
              </div>
            </div>
            </div>


            {/* Argumento comercial */}
            <div style={{padding:"12px 16px",background:C.brandLt,borderBottom:"1px solid "+C.brand+"33"}}>
              <div style={{fontFamily:F.sans,fontSize:9,color:C.brand,letterSpacing:0.8,marginBottom:5,textTransform:"uppercase"}}>Argumento comercial — {ano}</div>
              <div style={{fontFamily:F.sans,fontSize:12,color:C.text,lineHeight:1.7}}>
                {vAno<=0
                  ?`Em ${ano}, com os créditos de CBS sobre insumos, o tributo cai de R$ ${hoje.toLocaleString("pt-BR",{maximumFractionDigits:0})} para R$ ${liqAno.toLocaleString("pt-BR",{maximumFractionDigits:0})}/mês — uma redução de ${Math.abs(vAno).toFixed(0)}%. Quem mapear bem os créditos agora sai na frente.`
                  :`Em ${ano} a carga tributária sobe de R$ ${hoje.toLocaleString("pt-BR",{maximumFractionDigits:0})} para R$ ${liqAno.toLocaleString("pt-BR",{maximumFractionDigits:0})}/mês — um aumento de ${vAno.toFixed(0)}%, equivalente a R$ ${((liqAno-hoje)*12).toLocaleString("pt-BR",{maximumFractionDigits:0})} por ano. Preparar-se antes de ${ano} é a diferença entre absorver o impacto ou repassá-lo.`
                }
              </div>
            </div>

            {/* Pontos de atenção */}
            <div style={{padding:"12px 16px 14px"}}>
              <SL>Pontos de atenção</SL>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {ops.map((o,i)=>(
                  <div key={i} style={{padding:"8px 10px",background:C.bg2,border:"1px solid "+C.border,borderLeft:"3px solid "+o.cor}}>
                    <div style={{fontFamily:F.sans,fontSize:9,color:o.cor,marginBottom:2,textTransform:"uppercase",letterSpacing:0.5}}>{o.titulo}</div>
                    <div style={{fontFamily:F.sans,fontSize:11,color:C.text2,lineHeight:1.5}}>{o.txt}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>{/* /merged section */}
        </div>
      </div>
    </div>
  );
}


// ── TABS ──
const TABS=[{id:"painel",label:"Painel"},{id:"oracle",label:"Simulador"}];

// ── APP ──
export default function App(){
  const [tab,setTab]=useState("oracle");

  const [frete,setFrete]=useState(50000);
  const [frota,setFrota]=useState(20);
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
  const [mixAutonomo,setMixAutonomo]=useState(20);
  const [mixSN,setMixSN]=useState(60);
  const [mixLucro,setMixLucro]=useState(20);
  const [margemTerceiros,setMargemTerceiros]=useState(25);
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
