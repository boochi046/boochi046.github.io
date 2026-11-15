const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function model(){const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('loss-analysis.js','utf8'),ctx);return rows=>{ctx.rows=rows;return vm.runInContext('LossAnalysis.analyse(rows)',ctx);};}
const row=(Ticker,price,avg,qty=10)=>({Ticker,Price:price,'Average Price':avg,'Remaining Qty':qty});
test('only open losing holdings; weight denominator includes winners',()=>{
 const result=model()([row('LOSS',5,10),row('WIN',15,10),row('FLAT',10,10),row('CLOSED',2,10,0)]);
 assert.equal(result.losses.length,1);const h=result.losses[0];
 assert.equal(h.loss,50);assert.equal(h.returnPct,-50);assert.equal(h.recovery,100);
 assert.equal(h.weight,50/300*100);assert.equal(h.lossShare,100);assert.equal(result.totalLoss,50);
});
test('missing cost or quote cannot become a zero cost or a fictitious loss',()=>{
 const result=model()([row('LOSS',5,10),row('NOCOST',20,''),row('NOQUOTE','',10),row('BADQTY',10,20,'bad')]);
 assert.equal(result.losses.length,1);assert.equal(result.issues.length,3);assert.equal(result.completeValue,false);assert.equal(result.losses[0].weight,null);
});
test('zero quotes are a full loss with undefined recovery; fractional units are preserved',()=>{
 const result=model()([row('ZERO',0,10,.5)]),h=result.losses[0];
 assert.equal(h.loss,5);assert.equal(h.returnPct,-100);assert.equal(h.recovery,null);assert.equal(h.units,.5);
});
test('CSV handles quoted currency, names, BOM and rejects wrong schemas',()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('loss-analysis.js','utf8'),ctx);
 ctx.csv='\uFEFFTicker,Stock Name,Price,Average Price,Remaining Qty\r\nTEST,"Example, Inc.","$1,200.50","$1,500.00",2';
 const result=vm.runInContext('LossAnalysis.analyse(LossAnalysis.parseCSV(csv))',ctx);
 assert.equal(result.losses[0].name,'Example, Inc.');assert.equal(result.totalLoss,599);
 assert.throws(()=>vm.runInContext("LossAnalysis.parseCSV('Ticker,Price\\nTEST,2')",ctx));
});
