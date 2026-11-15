const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function context(extra={}) {
  return vm.createContext({console, URL, AbortController, setTimeout, clearTimeout, ...extra});
}
test('every inline executable script parses', () => {
  for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.html'))) {
    const html=fs.readFileSync(file,'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if(/src=|application\/json|application\/ld\+json/.test(match[1]))continue;
      new vm.Script(match[2],{filename:file});
    }
  }
});
test('130 valid observations produce a finite opportunity score', () => {
  const ctx=context();vm.runInContext(fs.readFileSync('opportunity-model.js','utf8'),ctx);
  const bars=Array.from({length:130},(_,i)=>({date:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),open:10+i*.02,close:10.05+i*.02,high:10.2+i*.02,low:9.8+i*.02,volume:100000+i*100}));
  ctx.bars=bars;
  const result=vm.runInContext("OpportunityModel.score(bars,new Date(bars.at(-1).date+'T12:00:00Z'))",ctx);
  assert.equal(result.available,true);assert.ok(Number.isFinite(result.final));
  bars.pop();assert.equal(vm.runInContext("OpportunityModel.score(bars,new Date(bars.at(-1).date+'T12:00:00Z')).available",ctx),false);
});
test('screener feed tickers are escaped before rendering',()=>{
  for(const file of ['screener-score.html','screener-analyst.html','screener-penny.html']){
    const source=fs.readFileSync(file,'utf8'),ctx=context();
    vm.runInContext(source.split('\n').find(line=>line.startsWith('const escapeTicker=')),ctx);
    ctx.ticker='<img src=x onerror="alert(1)">';
    assert.equal(vm.runInContext('escapeTicker(ticker)',ctx),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.ok(!source.includes('${s.ticker}'));
  }
});
test('an invalid fast response does not beat a valid fallback',async()=>{
  const ctx=context({fetch:async url=>({ok:true,text:async()=>url==='bad'?'<html>error</html>':'Ticker,Price\nTEST,20'})});
  vm.runInContext(fs.readFileSync('data-loader.js','utf8'),ctx);
  assert.equal(await vm.runInContext("DashboardData.download('',[()=> 'bad',()=> 'good'],t=>t.startsWith('Ticker,'),2000,5)",ctx),'Ticker,Price\nTEST,20');
});
test('fallback wins without waiting for stalled primary and cancels it',async()=>{
  let aborted=false;
  const ctx=context({fetch:(url,{signal})=>url==='direct'?new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));})):
    Promise.resolve({ok:true,text:async()=>'valid'})});
  vm.runInContext(fs.readFileSync('data-loader.js','utf8'),ctx);
  const started=Date.now();
  assert.equal(await vm.runInContext("DashboardData.download('',[()=> 'direct',()=> 'fallback'],t=>t==='valid',2000,5)",ctx),'valid');
  assert.ok(Date.now()-started<1000);assert.equal(aborted,true);
});
test('timeout covers response body, and unsafe URL schemes are blocked',async()=>{
  const ctx=context({fetch:async(url,{signal})=>({ok:true,text:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))})});
  vm.runInContext(fs.readFileSync('data-loader.js','utf8'),ctx);
  await assert.rejects(vm.runInContext("DashboardData.download('',[u=>u],()=>true,10)",ctx));
  for(const url of ['javascript:alert(1)','data:text/html,bad','file:///x'])assert.equal(vm.runInContext(`DashboardData.safeURL(${JSON.stringify(url)})`,ctx),null);
  assert.equal(vm.runInContext("DashboardData.safeURL('https://example.com/news')",ctx),'https://example.com/news');
});
test('missing costs suppress profit totals and footer stays aligned',async()=>{
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',className:'',style:{},value:id==='rankMode'?'dollars':'',classList:{add(){},remove(){}}});return elements.get(id);};
  const ctx=context({document:{documentElement:{getAttribute:()=> 'dark',setAttribute(){}},getElementById:el,querySelectorAll:()=>[]},window:{addEventListener(){}},localStorage:{getItem:()=>null},setInterval:()=>{}});
  let script=[...fs.readFileSync('index.html','utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  script=script.replace(/\nloadAll\(\);/,'');vm.runInContext(script,ctx);
  vm.runInContext(`fetchCSV=async(url)=>url===URL_PRICES?[{Ticker:'TEST',Price:'20','Remaining Qty':'10','Average Price':'','Previous Day':'19'}]:[{Ticker:'TEST',UNITS:'10',PRICES:'$1,200.50',DATE:'01/01/2025'}];renderSectorChart=()=>{};renderPerfChart=()=>{};loadNews=()=>{};`,ctx);
  await vm.runInContext('loadAll()',ctx);
  assert.equal(vm.runInContext('allHoldings[0].cost',ctx),null);
  assert.equal(el('k-cost').textContent,'Incomplete');assert.equal(el('k-unreal').textContent,'—');assert.equal(el('k-total').textContent,'—');
  assert.equal(el('k-value').textContent,'$200');
  assert.ok(el('holdingsTotals').innerHTML.includes('<td>100.00%</td><td>$200.00</td>'));
  assert.equal(vm.runInContext("numberValue('$1,200.50')",ctx),1200.5);
});
