const OUTSIDE_VERSION='Core + Outside V1';
function createOutsideView(prefix,cacheKey,snapshot){
let outsideData={dates:[],rows:[]},outsideLimit=100;

async function loadOutsideSnapshot(){
  const valid=data=>{const age=(Date.now()-Date.parse(data?.dates?.[0]+'T00:00:00Z'))/86400000;return data?.version===OUTSIDE_VERSION&&data.rows?.some(r=>r.signals?.some(s=>s.available))&&age>=0&&age<8&&!data.dates.some(d=>[0,6].includes(new Date(d+'T00:00:00Z').getUTCDay()));};
  let cached;try{cached=JSON.parse(localStorage.getItem(cacheKey));}catch(e){}
  if(!valid(cached))cached=null;
  if(snapshot)try{const res=await fetch(snapshot);if(res.ok){let data=await res.json();if(data.encoding==='gzip-base64'){const bytes=Uint8Array.from(atob(data.payload),c=>c.charCodeAt(0));data=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();}if(valid(data)&&(!cached||data.dates[0]>=cached.dates[0]))return data;}}catch(e){}
  return cached;
}
function setOutsideData(sheets,saved){
  const incomplete=['open','high','low','close','volume'].some(key=>!sheets?.[key]);
  if(incomplete&&saved?.rows?.some(r=>r.signals.some(s=>s.available)))sheets=null;
  const dates=sheets?.close?[...sheets.close.dates.keys()].filter(date=>![0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())).sort().slice(-4).reverse():(saved?.dates||[]);
  const previous=new Map((saved?.rows||[]).map(r=>[r.ticker,r]));
  const tickers=sheets?.close?.tickers||saved?.rows.map(r=>r.ticker)||[];
  const latestAge=Math.floor((Date.now()-Date.parse(dates[0]+'T00:00:00Z'))/86400000);
  outsideData={checked:true,version:OUTSIDE_VERSION,dates,rows:tickers.filter(t=>/^[A-Z0-9.^=-]{1,20}$/.test(t)).map(ticker=>{
    const missing=['open','high','low','close','volume'].filter(key=>!sheets?.[key]);
    const signals=sheets?.close?(missing.length?dates.map(date=>({date,available:false,grade:null,reason:'Required sheet tabs unavailable: '+missing.join(', ')+'. Refresh data to retry.'})):CoreOutsideModel.scan(assemble(sheets,ticker),dates)):dates.map(date=>({date,available:false,grade:null,reason:'Fresh OHLCV unavailable.'}));
    return {ticker,signals:signals.map(signal=>{if(!Number.isFinite(latestAge)||latestAge<0||latestAge>7)return {date:signal.date,available:false,grade:null,reason:'Source history is stale or future-dated.'};const old=previous.get(ticker)?.signals.find(s=>s.date===signal.date&&s.available);return signal.available?{...signal,saved:!!sheets?.saved}:old?{...old,saved:true}:signal;})};
  })};
  try{if(outsideData.rows.some(r=>r.signals.some(s=>s.available)))localStorage.setItem(cacheKey,JSON.stringify(outsideData));}catch(e){}
  const select=document.getElementById(prefix+'Day'),value=select.value;
  select.innerHTML='<option value="all">All four sessions</option>'+dates.map((d,i)=>'<option value="'+d+'">'+(i===0?'Latest · ':i+' session'+(i>1?'s':'')+' ago · ')+d+'</option>').join('');
  select.value=dates.includes(value)?value:'all';renderOutside();
}
function renderOutside(){
  const target=document.getElementById(prefix+'Rows');if(!target)return;
  const owned=new Set(stocks.filter(s=>s.owned).map(s=>s.ticker)),query='',day=document.getElementById(prefix+'Day').value,grade=document.getElementById(prefix+'Grade').value;
  const signals=outsideData.rows.filter(r=>true).flatMap(r=>r.signals.map(s=>({...s,ticker:r.ticker})));
  const counts=['A+','A','B'].map(g=>signals.filter(s=>s.grade===g).length);
  document.getElementById(prefix+'Count').textContent=outsideData.dates.length?'Latest four source sessions: '+outsideData.dates.join(' · ')+'. A+: '+counts[0]+' · A: '+counts[1]+' · B: '+counts[2]+'. Usable: '+signals.filter(s=>s.available).length+'/'+signals.length+' observations; '+signals.filter(s=>s.available&&s.saved).length+' use saved history. Counts are stock/session observations.':(outsideData.checked?'History unavailable. Refresh data to retry this section.':'Waiting for OHLCV history.');
  const names=new Map(stocks.map(s=>[s.ticker,s.name]));
  const matches=signals.filter(s=>(!query||(s.ticker+' '+(names.get(s.ticker)||'')).toLowerCase().includes(query))&&(day==='all'||s.date===day)&&(grade==='all'||grade==='qualified'?grade==='all'||['A+','A'].includes(s.grade):s.grade===grade));
  matches.sort((a,b)=>b.date.localeCompare(a.date)||(['A+','A','B','—',null].indexOf(a.grade)-['A+','A','B','—',null].indexOf(b.grade))||Object.values(b.checks||{}).filter(Boolean).length-Object.values(a.checks||{}).filter(Boolean).length||a.ticker.localeCompare(b.ticker));
  const label={price:'Close < $50',liquidity:'ADV20 ≥ $100k',ema:'Close > EMA20',roc:'0 < ROC7 < 20%',vpci:'0 < normalized VPCI < 1.5',vmi:'5-session max VMI ≥ 1',demark:'5-session max TD Buy count ≥ 6',confirmation:'ADX14 ≥20 and +DI > −DI, or MACD histogram >0'};
  document.getElementById(prefix+'More').hidden=matches.length<=outsideLimit;
  target.innerHTML=matches.slice(0,outsideLimit).map(s=>'<tr><td>'+escapeHTML(s.date)+'</td><td>'+escapeHTML(s.ticker)+'</td><td class="score">'+escapeHTML(s.grade||'DATA PENDING')+'</td><td class="number">'+money(s.price)+'</td><td>'+escapeHTML(s.candle?.date||'—')+'</td><td class="number">'+(s.tdMax??'—')+'</td><td class="number">'+fixed(s.adx,2)+'</td><td class="number">'+fixed(s.hist,4)+'</td><td><details style="margin:0;padding:8px"><summary>Conditions'+(s.saved?' · saved':'')+'</summary>'+(!s.available?'<p>'+escapeHTML(s.reason)+'</p>':Object.entries(s.checks).map(([k,v])=>'<p>'+ (v?'✓ ':'✗ ')+escapeHTML(label[k])+'</p>').join('')+(s.candle?'<p>Candle close location: '+fixed(s.candle.location*100,1)+'%; volume / prior 20-session mean: '+fixed(s.candle.relative,2)+'×.</p>':'<p>No bullish outside candle in signal day or the two preceding sessions.</p>'))+'</details></td></tr>').join('')||'<tr><td colspan="9">'+(outsideData.dates.length?(signals.some(s=>s.available)?'No setups match these filters. Choose All data states to inspect Core failures.':'Analysis unavailable: no complete usable OHLCV history. Choose All data states for missing-data reasons, or Refresh data to retry.'):outsideData.checked?'History unavailable. Refresh data to retry.':'Loading four-session analysis…')+'</td></tr>';
}
for(const id of [prefix+'Day',prefix+'Grade'])document.getElementById(id).addEventListener('change',()=>{outsideLimit=100;renderOutside();});

document.getElementById(prefix+'More').onclick=()=>{outsideLimit+=100;renderOutside();};

return {load:loadOutsideSnapshot,set:setOutsideData,render:renderOutside};
}
const outsideViews={Score:createOutsideView('outside','top-score-outside-v1','top-score-outside.json'),Analyst:createOutsideView('analystOutside','top-analyst-outside-v1','top-analyst-outside.json'),Penny:createOutsideView('pennyOutside','penny-stock-outside-v1','penny-stock-outside.json')};
async function loadOutsideSnapshot(){return Object.fromEntries(await Promise.all(Object.entries(outsideViews).map(async([name,view])=>[name,await view.load()])));}
function renderOutside(){Object.values(outsideViews).forEach(view=>view.render());}