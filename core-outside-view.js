let outsideData={dates:[],rows:[]},outsideLimit=100;
const OUTSIDE_VERSION='Core + Outside V1';
async function loadOutsideSnapshot(){
  try{let data;try{data=JSON.parse(localStorage.getItem('top-score-outside-v1'));}catch(e){}
    if(!data?.rows?.length||data.dates?.some(date=>[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))){const res=await fetch('top-score-outside.json');if(!res.ok)return null;data=await res.json();}
    const age=(Date.now()-Date.parse(data.dates?.[0]+'T00:00:00Z'))/86400000;
    return data.version===OUTSIDE_VERSION&&Array.isArray(data.rows)&&age>=0&&age<8?data:null;
  }catch(e){return null;}
}
function setOutsideData(sheets,saved){
  const dates=sheets?.close?[...sheets.close.dates.keys()].filter(date=>![0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())).sort().slice(-4).reverse():(saved?.dates||[]);
  const previous=new Map((saved?.rows||[]).map(r=>[r.ticker,r]));
  const tickers=sheets?.close?.tickers||saved?.rows.map(r=>r.ticker)||[];
  const latestAge=Math.floor((Date.now()-Date.parse(dates[0]+'T00:00:00Z'))/86400000);
  outsideData={version:OUTSIDE_VERSION,dates,rows:tickers.filter(t=>/^[A-Z0-9.^=-]{1,20}$/.test(t)).map(ticker=>{
    const signals=sheets?.close?CoreOutsideModel.scan(assemble(sheets,ticker),dates):dates.map(date=>({date,available:false,grade:null,reason:'Fresh OHLCV unavailable.'}));
    return {ticker,signals:signals.map(signal=>{if(!Number.isFinite(latestAge)||latestAge<0||latestAge>7)return {date:signal.date,available:false,grade:null,reason:'Source history is stale or future-dated.'};const old=previous.get(ticker)?.signals.find(s=>s.date===signal.date&&s.available);return signal.available?{...signal,saved:false}:old?{...old,saved:true}:signal;})};
  })};
  try{if(outsideData.rows.length)localStorage.setItem('top-score-outside-v1',JSON.stringify(outsideData));}catch(e){}
  const select=document.getElementById('outsideDay'),value=select.value;
  select.innerHTML='<option value="all">All four sessions</option>'+dates.map((d,i)=>'<option value="'+d+'">'+(i===0?'Latest · ':i+' session'+(i>1?'s':'')+' ago · ')+d+'</option>').join('');
  select.value=dates.includes(value)?value:'all';renderOutside();
}
function renderOutside(){
  const target=document.getElementById('outsideRows');if(!target)return;
  const owned=new Set(stocks.filter(s=>s.owned).map(s=>s.ticker)),query=document.getElementById('search').value.toLowerCase().trim(),day=document.getElementById('outsideDay').value,grade=document.getElementById('outsideGrade').value;
  const signals=outsideData.rows.filter(r=>document.getElementById('universe').value!=='portfolio'||owned.has(r.ticker)).flatMap(r=>r.signals.map(s=>({...s,ticker:r.ticker})));
  const counts=['A+','A','B'].map(g=>signals.filter(s=>s.grade===g).length);
  document.getElementById('outsideCount').textContent=outsideData.dates.length?'Latest four source sessions: '+outsideData.dates.join(' · ')+'. A+: '+counts[0]+' · A: '+counts[1]+' · B: '+counts[2]+'. Usable: '+signals.filter(s=>s.available).length+'/'+signals.length+' observations; '+signals.filter(s=>s.available&&s.saved).length+' use saved history. Counts are stock/session observations.':'Waiting for OHLCV history; old V1 scores do not contain candle or DeMark evidence.';
  const names=new Map(stocks.map(s=>[s.ticker,s.name]));
  const matches=signals.filter(s=>(!query||(s.ticker+' '+(names.get(s.ticker)||'')).toLowerCase().includes(query))&&(day==='all'||s.date===day)&&(grade==='all'||grade==='qualified'?grade==='all'||['A+','A'].includes(s.grade):s.grade===grade));
  matches.sort((a,b)=>b.date.localeCompare(a.date)||(['A+','A','B','—',null].indexOf(a.grade)-['A+','A','B','—',null].indexOf(b.grade))||a.ticker.localeCompare(b.ticker));
  const label={price:'Close < $50',liquidity:'ADV20 ≥ $100k',ema:'Close > EMA20',roc:'0 < ROC7 < 20%',vpci:'0 < normalized VPCI < 1.5',vmi:'5-session max VMI ≥ 1',demark:'5-session max TD Buy count ≥ 6',confirmation:'ADX14 ≥20 and +DI > −DI, or MACD histogram >0'};
  document.getElementById('outsideMore').hidden=matches.length<=outsideLimit;
  target.innerHTML=matches.slice(0,outsideLimit).map(s=>'<tr><td>'+escapeHTML(s.date)+'</td><td>'+escapeHTML(s.ticker)+'</td><td class="score">'+escapeHTML(s.grade||'DATA PENDING')+'</td><td class="number">'+money(s.price)+'</td><td>'+escapeHTML(s.candle?.date||'—')+'</td><td class="number">'+(s.tdMax??'—')+'</td><td class="number">'+fixed(s.adx,2)+'</td><td class="number">'+fixed(s.hist,4)+'</td><td><details style="margin:0;padding:8px"><summary>Conditions'+(s.saved?' · saved':'')+'</summary>'+(!s.available?'<p>'+escapeHTML(s.reason)+'</p>':Object.entries(s.checks).map(([k,v])=>'<p>'+ (v?'✓ ':'✗ ')+escapeHTML(label[k])+'</p>').join('')+(s.candle?'<p>Candle close location: '+fixed(s.candle.location*100,1)+'%; volume / prior 20-session mean: '+fixed(s.candle.relative,2)+'×.</p>':'<p>No bullish outside candle in signal day or the two preceding sessions.</p>'))+'</details></td></tr>').join('')||'<tr><td colspan="9">'+(outsideData.dates.length?'No setups match these filters. Choose All data states to inspect Core failures.':'Loading four-session analysis…')+'</td></tr>';
}
for(const id of ['outsideDay','outsideGrade'])document.getElementById(id).addEventListener('change',()=>{outsideLimit=100;renderOutside();});

document.getElementById('outsideMore').onclick=()=>{outsideLimit+=100;renderOutside();};
