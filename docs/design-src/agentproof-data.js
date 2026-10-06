(function(){
const HX=(seed,len)=>{let s='',i=0;while(s.length<len){let h=2166136261;const str=seed+':'+i;for(let j=0;j<str.length;j++){h^=str.charCodeAt(j);h=Math.imul(h,16777619);}h^=h>>>15;h=Math.imul(h,2246822507);h^=h>>>13;s+=(h>>>0).toString(16).padStart(8,'0');i++;}return s.slice(0,len);};
const H=(seed,pre,suf)=>{pre=pre||'';suf=suf||'';return '0x'+pre+HX(seed,64-pre.length-suf.length)+suf;};
const SH=h=>h?h.slice(0,6)+'…'+h.slice(-4):'—';
const addT=(t,sec)=>{const [h,m,x]=t.split(':').map(Number);const v=h*3600+m*60+x+sec;const p=n=>String(n).padStart(2,'0');return p(Math.floor(v/3600)%24)+':'+p(Math.floor(v/60)%60)+':'+p(v%60);};
const dur=sec=>sec?Math.floor(sec/60)+'m '+String(sec%60).padStart(2,'0')+'s':'—';

const G={fg:'#4ADE80',bg:'rgba(74,222,128,0.07)',bd:'rgba(74,222,128,0.24)'};
const A={fg:'#CDB274',bg:'rgba(184,154,90,0.09)',bd:'rgba(184,154,90,0.30)'};
const N={fg:'#9BA39E',bg:'rgba(155,163,158,0.05)',bd:'#303832'};
const R={fg:'#D08A8A',bg:'rgba(166,93,93,0.11)',bd:'rgba(166,93,93,0.38)'};
const BADGE={
 verified:{label:'VERIFIED',icon:'✓',...G}, validating:{label:'VALIDATING',icon:'◐',...A},
 pending:{label:'PENDING',icon:'◷',...N}, failed:{label:'FAILED',icon:'✕',...R},
 processing:{label:'PROCESSING',icon:'◌',...A}, settled:{label:'SETTLED',icon:'✓',...G},
 anchored:{label:'ANCHORED',icon:'✓',...G}, escrow:{label:'IN ESCROW',icon:'◷',...A},
 unsettled:{label:'UNSETTLED',icon:'–',...N}, active:{label:'ACTIVE',icon:'●',...G},
 paused:{label:'PAUSED',icon:'‖',...A}, live:{label:'LIVE',icon:'●',...G}, pass:{label:'PASS',icon:'✓',...G},
 fail:{label:'FAIL',icon:'✕',...R}, draft:{label:'DRAFT',icon:'○',...N}, running:{label:'RUNNING',icon:'◌',...A},
 error:{label:'ERROR',icon:'✕',...R}, unvalidated:{label:'UNVALIDATED',icon:'!',...A}
};

const AGENTS=[
 {id:'381',name:'ResearchBot',slug:'research-bot',version:'2.4.1',caps:['web.search','http.fetch','entity.enrich','classify'],execs:612,validated:548,settled:'1,096.00',latest:'2m ago',owner:'0x3f1c…a92e',policy:'Research Agent Policy',validator:'ResearchValidator',vid:'721',registered:'Mar 12, 2026',desc:'Company and market research with source-linked outputs.'},
 {id:'402',name:'LedgerScout',slug:'ledger-scout',version:'1.8.0',caps:['db.query','reconcile','pdf.parse'],execs:288,validated:270,settled:'1,012.50',latest:'6m ago',owner:'0x8b20…11fd',policy:'Finance Reconciliation Policy',validator:'ReconcileValidator',vid:'745',registered:'Apr 02, 2026',desc:'Reconciles invoices and payments against ledger records.'},
 {id:'217',name:'ContractReader',slug:'contract-reader',version:'3.1.2',caps:['http.fetch','parse.solidity','summarize'],execs:143,validated:118,settled:'671.50',latest:'14m ago',owner:'0xc41a…7b03',policy:'Research Agent Policy',validator:'SchemaValidator',vid:'734',registered:'Feb 20, 2026',desc:'Reads smart contracts and audit reports into structured findings.'},
 {id:'455',name:'SupportTriage',slug:'support-triage',version:'0.9.4',caps:['ticket.read','classify','route'],execs:196,validated:176,settled:'52.80',latest:'33m ago',owner:'0x19e7…c2d8',policy:'Support Triage Policy',validator:'SchemaValidator',vid:'734',registered:'Jun 18, 2026',desc:'Classifies and routes inbound support tickets.'},
 {id:'129',name:'PriceWatcher',slug:'price-watcher',version:'1.2.0',caps:['http.fetch','compare','alert'],execs:31,validated:22,settled:'5.50',latest:'48m ago',owner:'0x5d03…e861',policy:'Research Agent Policy',validator:'SchemaValidator',vid:'734',registered:'Jul 30, 2026',desc:'Tracks retail prices across a fixed SKU list.'},
 {id:'508',name:'DataCleaner',slug:'data-cleaner',version:'1.0.3',caps:['csv.parse','dedupe','db.write'],execs:14,validated:9,settled:'2.70',latest:'52m ago',owner:'0xa7b9…04c1',policy:'Finance Reconciliation Policy',validator:'ReconcileValidator',vid:'745',registered:'Sep 01, 2026',desc:'Deduplicates and normalizes CRM exports.'}
];
const AG={};AGENTS.forEach(a=>AG[a.id]=a);

const VALIDATORS=[
 {id:'721',name:'ResearchValidator',method:'Independent re-execution',desc:'Re-runs recorded tool calls against committed inputs and compares output commitments.',supported:'Research tasks',status:'active',count:124,avg:'38s',last:'8s ago',checks:['Inputs match','Output structure valid','Required entities found','Evidence available']},
 {id:'734',name:'SchemaValidator',method:'Structural verification',desc:'Checks outputs against the task schema and required-entity rules.',supported:'Extraction, triage, summaries',status:'active',count:596,avg:'4s',last:'2m ago',checks:['Schema match','Required fields present','Evidence available']},
 {id:'745',name:'ReconcileValidator',method:'Deterministic replay',desc:'Replays reconciliation logic over committed ledger snapshots.',supported:'Financial reconciliation',status:'active',count:381,avg:'12s',last:'6m ago',checks:['Snapshot hash match','Replay output match','Totals balance']},
 {id:'760',name:'ReviewCommittee',method:'Human attestation',desc:'Two registered signers attest to outputs that cannot be re-executed.',supported:'Legal and audit review',status:'paused',count:42,avg:'4h 12m',last:'3d ago',checks:['Two signatures','Signer registry match']}
];
const VM={};VALIDATORS.forEach(v=>VM[v.id]=v);

const POLICIES=[
 {name:'Research Agent Policy',slug:'research-v3',version:3,tools:['Search','HTTP','Database'],maxPay:'5 USDC',maxTime:'10 minutes',domains:['crunchbase.com','github.com','sec.gov','arxiv.org'],agents:['ResearchBot','ContractReader','PriceWatcher'],hash:H('pol-research','c21e','0f4d'),updated:'Sep 18, 2026'},
 {name:'Finance Reconciliation Policy',slug:'finance-v2',version:2,tools:['Database','PDF parser'],maxPay:'10 USDC',maxTime:'20 minutes',domains:['erp.internal','bank-api.internal'],agents:['LedgerScout','DataCleaner'],hash:H('pol-finance'),updated:'Aug 29, 2026'},
 {name:'Support Triage Policy',slug:'support-v1',version:1,tools:['Ticket API','Classifier'],maxPay:'1 USDC',maxTime:'5 minutes',domains:['support.internal'],agents:['SupportTriage'],hash:H('pol-support'),updated:'Jun 18, 2026'}
];
const PM={};POLICIES.forEach(p=>PM[p.name]=p);

const RAW=[
 ['8F92','381','20-company research','Find 20 AI infrastructure startups founded after 2024.','verified',20,20,'1.00','2m ago','14:30:02',126],
 ['8F8D','402','Q3 invoice reconciliation','Reconcile 412 Q3 vendor invoices against ledger entries.','verified',412,412,'2.50','6m ago','14:24:41',221],
 ['8F87','381','Fintech funding scan','Collect 2026 seed rounds for 15 fintech companies.','validating',11,15,'0.75','9m ago','14:23:12',112],
 ['8F81','217','Audit summary: vault v2','Summarize findings from the vault v2 audit report.','verified',1,1,'3.00','14m ago','14:15:40',250],
 ['8F7C','381','Competitor pricing research','Collect current pricing for 20 competitor products.','failed',17,20,'1.00','21m ago','14:10:27',168],
 ['8F76','455','Route 140 support tickets','Classify and route 140 inbound support tickets.','verified',140,140,'0.40','33m ago','13:59:44',69],
 ['8F70','129','Track 50 SKU prices','Check prices for 50 SKUs across four retailers.','verified',50,50,'0.25','48m ago','13:44:18',58],
 ['8F6A','508','Deduplicate CRM export','Deduplicate 18,400 contacts from the CRM export.','pending',0,1,'0.60','52m ago','13:40:03',0],
 ['8F63','402','Vendor payment match','Match 88 outgoing payments to purchase orders.','verified',88,88,'1.20','1h ago','13:21:36',133],
 ['8F5E','217','Token contract review','Review token contract for admin-controlled mint paths.','failed',0,1,'3.00','1h ago','13:08:51',302],
 ['8F58','381','EU AI Act obligations','Summarize 12 provider obligations under the EU AI Act.','verified',12,12,'0.80','1h ago','12:57:20',104],
 ['8F51','455','Classify refund requests','Classify 64 refund requests by reason code.','verified',64,64,'0.30','2h ago','12:31:09',47]
];
const EXECS=RAW.map((r,i)=>{
 const [id,agent,task,prompt,status,ok,total,settle,ago,start,sec]=r;
 const a=AG[agent], s92=id==='8F92', n=parseInt(HX(id,4),16);
 const e={id,agent,a,task,prompt,status,ok,total,settle,ago,start,sec,duration:dur(sec)};
 e.calls=s92?43:6+n%48; e.artifacts=s92?17:3+n%19; e.decisions=s92?12:2+n%14;
 e.evRoot=s92?H(id+'ev','7a83','92ab'):H(id+'ev'); e.resCommit=s92?H(id+'rc','18af','921c'):H(id+'rc');
 e.inCommit=H(id+'in'); e.settleTx=s92?H(id+'st','91ab','73fc'):H(id+'st'); e.arcTx=s92?H(id+'ax','7a91','83ac'):H(id+'ax');
 e.commit=s92?H(id+'cm','91c4','ee22'):H(id+'cm'); e.policy=PM[a.policy]; e.validator=VM[a.vid];
 e.block=s92?'8,291,442':(8291442-(i*41+n%29)).toLocaleString('en-US');
 e.date='Sep 25, 2026'; e.evTs=addT(start,sec); e.arcTs=addT(start,sec+3);
 e.validation=status==='pending'?'—':ok+'/'+total;
 e.settleLabel=status==='verified'?settle+' USDC':status==='failed'?'Unsettled':'In escrow';
 e.arcLabel=status==='verified'?'Anchored':status==='failed'?'Not anchored':'Awaiting';
 e.badge=BADGE[status]; e.settleBadge=status==='verified'?BADGE.settled:status==='failed'?BADGE.unsettled:BADGE.escrow;
 e.fail=id==='8F7C'?{reason:'Missing evidence',detail:'The validator could not confirm the execution result.',expected:'20 results',received:'17 results',check:2}:id==='8F5E'?{reason:'Output structure invalid',detail:'The result did not match the task schema.',expected:'findings[] (≥ 1 item)',received:'null',check:1}:null;
 const c=a.caps; const c1=Math.ceil(e.calls*0.42), c2=Math.ceil(e.calls*0.38); e.tools=[[c[0],c1],[c[1],c2],[c[2],e.calls-c1-c2]];
 return e;
});
const EXM={};EXECS.forEach(e=>EXM[e.id]=e);

const FEED_POOL=[
 {who:'ResearchBot',what:'Execution started',ref:'EX-8F93',kind:'start'},
 {who:'ResearchValidator #721',what:'Validation passed',ref:'EX-8F87',kind:'pass'},
 {who:'Agent #381',what:'1.00 USDC settled',ref:'0x91ab…73fc',kind:'settle'},
 {who:'Arc Mainnet',what:'Execution anchored',ref:'#8,291,448',kind:'anchor'},
 {who:'LedgerScout',what:'Evidence committed',ref:'0x4c12…9e0a',kind:'evidence'},
 {who:'SchemaValidator #734',what:'Validation failed',ref:'EX-8F5E',kind:'fail'},
 {who:'SupportTriage',what:'Execution started',ref:'EX-8F94',kind:'start'},
 {who:'ReconcileValidator #745',what:'Validation passed',ref:'EX-8F8D',kind:'pass'}
];

const SDK=[
 {id:'core',label:'Core',title:'Core',desc:'Wrap an agent run so every tool call, output and model decision is committed as evidence.',blocks:[
  {lang:'bash',title:'Install',hl:[],code:'npm install @verid/core @verid/arc'},
  {lang:'ts',title:'Run an execution',hl:[5,6,7,8,9],code:'import { Verid } from "@verid/core";\n\nconst verid = new Verid({ apiKey: process.env.VERID_KEY });\n\nconst execution = await verid.run({\n  agent,\n  task,\n  policy,\n});\n\nawait execution.verify();\nconsole.log(execution.id); // "EX-8F92"'},
  {lang:'ts',title:'Inspect evidence',hl:[2],code:'const evidence = await execution.evidence();\nevidence.root;       // "0x7a83…92ab"\nevidence.artifacts;  // 17\nevidence.toolCalls;  // 43'}]},
 {id:'arc',label:'Arc',title:'Arc',desc:'Anchor execution commitments on Arc and settle USDC through execution escrow.',blocks:[
  {lang:'ts',title:'Anchor and settle',hl:[3,7],code:'import { arc } from "@verid/arc";\n\nconst anchor = await arc.anchor(execution, { network: "mainnet" });\nanchor.block; // 8291442\nanchor.tx;    // "0x7a91…83ac"\n\nawait arc.settle(execution, { amount: "1.00", token: "USDC" });'}]},
 {id:'erc8004',label:'ERC-8004',title:'ERC-8004 identity',desc:'Register agents with an ERC-8004 identity and resolve them from any execution.',blocks:[
  {lang:'ts',title:'Register an agent',hl:[1],code:'const identity = await verid.identity.register({\n  name: "ResearchBot",\n  version: "2.4.1",\n  capabilities: ["web.search", "http.fetch", "entity.enrich"],\n});\n\nidentity.agentId; // 381'}]},
 {id:'validators',label:'Validators',title:'Validators',desc:'Request independent validation. Validators return factual checks, never a score.',blocks:[
  {lang:'ts',title:'Validate an execution',hl:[6,7],code:'const result = await verid.validate(execution, {\n  validator: "research-validator",\n  method: "re-execution",\n});\n\nresult.status; // "PASS"\nresult.checks; // [{ name: "inputs_match", ok: true }, …]'}]},
 {id:'react',label:'React',title:'React',desc:'Drop the execution graph and receipt into your own product.',blocks:[
  {lang:'tsx',title:'Components',hl:[6,7],code:'import { ExecutionGraph, Receipt } from "@verid/react";\n\nexport function Proof({ id }) {\n  return (\n    <>\n      <ExecutionGraph execution={id} live />\n      <Receipt execution={id} />\n    </>\n  );\n}'}]},
 {id:'cli',label:'CLI',title:'CLI',desc:'Run, inspect and verify executions from the terminal.',blocks:[
  {lang:'bash',title:'Terminal',hl:[3],code:'$ verid login\n$ verid run ./agent.ts --policy research-v3\n$ verid verify EX-8F92\n✓ commitments  ✓ validation  ✓ arc anchor'}]},
 {id:'examples',label:'Examples',title:'Examples',desc:'A complete research agent with policy, validation, settlement and an Arc anchor.',blocks:[
  {lang:'ts',title:'examples/research-agent.ts',hl:[2,3,4,5,6,7],code:'const execution = await verid.run({\n  agent: researchBot,\n  task: "Find 20 AI infrastructure startups founded after 2024.",\n  policy: "research-v3",\n  validator: "research-validator",\n  settle: { amount: "1.00", token: "USDC" },\n});\n\nconst receipt = await execution.receipt();\nreceipt.status;    // "VERIFIED"\nreceipt.arc.block; // 8291442\nreceipt.arc.tx;    // "0x7a91…83ac"'}]}
];

const DEV_LINES=[
 {t:'$ npm install @verid/core @verid/arc',c:'#E8ECE9'},
 {t:'added 2 packages in 1.8s',c:'#7C847F',i:1},
 {t:'',i:1},
 {t:'const execution = await verid.run({',c:'#C8D0CB'},
 {t:'  agent,',c:'#C8D0CB'},{t:'  task,',c:'#C8D0CB'},{t:'  policy',c:'#C8D0CB'},{t:'});',c:'#C8D0CB'},
 {t:'',i:1},
 {t:'await execution.verify();',c:'#C8D0CB'},
 {t:'',i:1},
 {t:'execution.arcTx;',c:'#C8D0CB'},
 {t:"// → '0x7a91…83ac'",c:'#7C847F',i:1},
 {t:'',i:1},
 {t:'✓ VERIFIED   EX-8F92 · block #8,291,442',c:'#4ADE80',i:1}
];

window.AP={HX,H,SH,addT,dur,BADGE,AGENTS,AG,VALIDATORS,VM,POLICIES,PM,EXECS,EXM,FEED_POOL,SDK,DEV_LINES};
})();
