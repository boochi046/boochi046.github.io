/* Price-only analysis of current holdings; missing data is never a zero loss. */
const LossAnalysis = (() => {
  const number = value => {
    const text=String(value??'').trim().replace(/[$,%\s]/g,'');
    return text!==''&&Number.isFinite(Number(text))?Number(text):null;
  };
  function parseCSV(text) {
    if(text.trim().startsWith('<'))throw Error('Expected CSV, received HTML.');
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(cell.trim());cell='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(quoted)throw Error('Incomplete CSV.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
    const headers=rows.shift();if(!headers)throw Error('Empty portfolio feed.');headers[0]=headers[0].replace(/^\uFEFF/,'');
    if(!headers.includes('Ticker')||!['Remaining Qty','Qty'].some(k=>headers.includes(k))||!['Price','Live Price'].some(k=>headers.includes(k))||!['Average Price','Avg Price'].some(k=>headers.includes(k)))throw Error('Portfolio feed is missing required columns.');
    return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
  }
  function analyse(rows) {
    const losses=[],issues=[];let value=0,completeValue=true,open=0;
    for(const row of rows){
      const ticker=String(row.Ticker??'').trim().toUpperCase(),units=number(row['Remaining Qty']??row.Qty);
      if(!ticker)continue;
      if(units===null||units<0){issues.push(ticker+': invalid quantity; position not classified.');completeValue=false;continue;}
      if(units===0)continue;open++;
      const price=number(row.Price??row['Live Price']),avg=number(row['Average Price']??row['Avg Price']);
      if(price===null||price<0){completeValue=false;issues.push(ticker+': missing or invalid quote; position not classified.');continue;}
      const market=price*units;value+=market;
      if(avg===null||avg<0){issues.push(ticker+': missing or invalid cost basis; position not classified.');continue;}
      const cost=avg*units,pnl=market-cost;
      if(pnl>=0)continue;
      const previous=number(row['Previous Day']);
      losses.push({ticker,name:String(row['Stock Name']||ticker),units,price,avg,cost,market,pnl,loss:-pnl,returnPct:pnl/cost*100,recovery:price>0?(avg/price-1)*100:null,daily:previous!==null&&previous>0?(price/previous-1)*100:null});
    }
    const totalLoss=losses.reduce((a,h)=>a+h.loss,0),cost=losses.reduce((a,h)=>a+h.cost,0),market=losses.reduce((a,h)=>a+h.market,0);
    losses.forEach(h=>{h.weight=completeValue&&value>0?h.market/value*100:null;h.lossShare=totalLoss>0?h.loss/totalLoss*100:null;});
    return {losses,issues,open,totalLoss,cost,market,value,completeValue,exposure:completeValue&&value>0?market/value*100:null};
  }
  return {number,parseCSV,analyse};
})();
