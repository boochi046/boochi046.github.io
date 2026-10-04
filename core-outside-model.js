/* Core + Outside V1. Daily signals; no orders or future bars. */
const CoreOutsideModel = (() => {
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  function ema(a,n){const k=2/(n+1),r=[a[0]];for(let i=1;i<a.length;i++)r.push(k*a[i]+(1-k)*r[i-1]);return r;}
  function confirmations(bars){
    const c=bars.map(b=>b.close),fast=ema(c,12),slow=ema(c,26),macd=c.map((_,i)=>fast[i]-slow[i]),signal=ema(macd,9);
    const out=bars.map((b,i)=>({hist:macd[i]-signal[i],td:0,adx:null,plusDI:null,minusDI:null}));
    let count=0,trSum=0,upSum=0,downSum=0,adx=null,dx=[];
    for(let i=1;i<bars.length;i++){
      count=i>=4&&c[i]<c[i-4]?Math.min(count+1,9):0;out[i].td=count;
      const b=bars[i],p=bars[i-1],up=b.high-p.high,down=p.low-b.low;
      const tr=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
      const pos=up>down&&up>0?up:0,neg=down>up&&down>0?down:0;
      if(i<=14){trSum+=tr;upSum+=pos;downSum+=neg;}else{trSum=trSum-trSum/14+tr;upSum=upSum-upSum/14+pos;downSum=downSum-downSum/14+neg;}
      if(i>=14){const plusDI=trSum?100*upSum/trSum:0,minusDI=trSum?100*downSum/trSum:0;
        const d=plusDI+minusDI?100*Math.abs(plusDI-minusDI)/(plusDI+minusDI):0;
        if(i<=27){dx.push(d);if(i===27)adx=mean(dx);}else adx=(adx*13+d)/14;
        Object.assign(out[i],{plusDI,minusDI,adx});
      }
    }
    return out;
  }
  function candle(bars,i){
    if(i<20)return null;const b=bars[i],p=bars[i-1],range=b.high-b.low;
    if(![b.open,b.high,b.low,b.close,b.volume,p.high,p.low,p.close].every(Number.isFinite)||range<=0)return null;
    const bullish=b.high>p.high&&b.low<p.low&&b.close>b.open&&b.close>p.close;
    const location=(b.close-b.low)/range,average=mean(bars.slice(i-20,i).map(x=>x.volume));
    const relative=average>0?b.volume/average:null;
    return {date:b.date,bullish,power:bullish&&location>=.75&&relative!==null&&relative>=.8,location,relative};
  }
  function classify(score,confirmation,tdMax,candles){
    const checks={price:score.price<50,liquidity:score.adv>=100000,ema:score.price>score.ema20,roc:score.roc>0&&score.roc<20,vpci:score.vpci>0&&score.vpci<1.5,vmi:score.vmiMax>=1,demark:tdMax>=6,confirmation:(confirmation.adx>=20&&confirmation.plusDI>confirmation.minusDI)||confirmation.hist>0};
    const core=Object.values(checks).every(Boolean),outside=candles.find(x=>x?.bullish),power=candles.find(x=>x?.power);
    return {grade:core?(power?'A+':outside?'A':'B'):'—',core,checks,candle:power||outside||null};
  }
  function scan(bars,dates){
    // The same four source dates apply to every ticker, including missing rows.
    const conf=confirmations(bars);
    return dates.map(date=>{
      const i=bars.findIndex(b=>b.date===date),prefix=bars.slice(0,i+1);
      if(i<0)return {date,available:false,grade:null,reason:'No bar for this source date.'};
      const score=OpportunityModel.score(prefix,new Date(date+'T12:00:00Z'));
      if(!score.available)return {date,available:false,grade:null,reason:score.reason};
      const confirmation=conf[i],tdMax=Math.max(...conf.slice(i-4,i+1).map(x=>x.td));
      const candles=[i,i-1,i-2].map(j=>candle(bars,j));
      return {date,available:true,price:score.price,roc:score.roc,vpci:score.vpci,vmiMax:score.vmiMax,ema20:score.ema20,adv:score.adv,tdMax,...confirmation,...classify(score,confirmation,tdMax,candles)};
    });
  }
  return {scan,confirmations,candle,classify};
})();
