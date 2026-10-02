/* Opportunity Rank V1: experimental, deterministic screening model. */
const OpportunityModel = (() => {
  const clamp = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const ramp = (x, low, high) => clamp((x - low) / (high - low));
  const plateau = (x, low, idealLow, idealHigh, high) => x <= idealLow ? ramp(x, low, idealLow) : x <= idealHigh ? 1 : 1 - ramp(x, idealHigh, high);
  const sum = a => a.reduce((s, x) => s + x.points, 0);
  const part = (name, max, quality, rule) => ({ name, max, points: max * clamp(quality), rule });
  function ema(values, period) {
    const k = 2 / (period + 1), result = [values[0]];
    for (let i = 1; i < values.length; i++) result.push(values[i] * k + result[i - 1] * (1 - k));
    return result;
  }
  function rsi(values, period = 14) {
    const out = Array(values.length).fill(null); let up = 0, down = 0;
    for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; up += Math.max(d, 0); down += Math.max(-d, 0); }
    up /= period; down /= period;
    const value = () => up + down === 0 ? 50 : down === 0 ? 100 : 100 - 100 / (1 + up / down);
    out[period] = value();
    for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; up = (up * (period - 1) + Math.max(d, 0)) / period; down = (down * (period - 1) + Math.max(-d, 0)) / period; out[i] = value(); }
    return out;
  }
  function indicators(bars) {
    const c = bars.map(b => b.close), v = bars.map(b => b.volume), e = ema(c, 20), rs = rsi(c), result = [];
    const tp = bars.map(b => (b.high + b.low + b.close) / 3);
    const tr = bars.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - c[i - 1]), Math.abs(b.low - c[i - 1])) : b.high - b.low);
    const atr = Array(c.length).fill(null); atr[14] = mean(tr.slice(1, 15));
    for (let i = 15; i < c.length; i++) atr[i] = (atr[i - 1] * 13 + tr[i]) / 14;
    for (let i = 50; i < bars.length; i++) {
      const slice = (values, n) => values.slice(i - n + 1, i + 1), sma = n => mean(slice(c, n));
      const vwma = n => { const prices = slice(c, n), volumes = slice(v, n); return prices.reduce((s, p, j) => s + p * volumes[j], 0) / volumes.reduce((s, x) => s + x, 0); };
      const vol50 = mean(slice(v, 50)), vol10 = mean(slice(v, 10));
      // Same normalized variant as the repository's existing screener.
      const vpci = (vwma(10) - sma(10)) * (vwma(50) / sma(50)) * (vol10 / vol50) / sma(50);
      let positive = 0, negative = 0;
      for (let j = i - 13; j <= i; j++) { const flow = tp[j] * v[j]; if (tp[j] > tp[j - 1]) positive += flow; else if (tp[j] < tp[j - 1]) negative += flow; }
      const mfi = positive + negative === 0 ? 50 : negative === 0 ? 100 : 100 - 100 / (1 + positive / negative);
      const totalVolume = slice(v, 20).reduce((s, x) => s + x, 0); let moneyFlow = 0, signedVolume = 0;
      for (let j = i - 19; j <= i; j++) { const b = bars[j]; moneyFlow += (b.high === b.low ? 0 : (2 * b.close - b.high - b.low) / (b.high - b.low)) * b.volume; signedVolume += Math.sign(c[j] - c[j - 1]) * v[j]; }
      const priorVolume = mean(v.slice(i - 20, i));
      result[i] = { roc: (c[i] / c[i - 7] - 1) * 100, vmi: 1 + (mfi - rs[i]) / 100, vpci, ema20: e[i], sma20: sma(20), sma50: sma(50), sma100: i >= 99 ? sma(100) : null, rvol: v[i] / priorVolume, cmf: moneyFlow / totalVolume, imbalance: signedVolume / totalVolume, atrPct: atr[i] / c[i] * 100, adv: mean(bars.slice(i - 19, i + 1).map(b => b.close * b.volume)), high20: Math.max(...slice(c, 20)), high63: i >= 62 ? Math.max(...slice(c, 63)) : null, ret21: i >= 21 ? (c[i] / c[i - 21] - 1) * 100 : null, ret63: i >= 63 ? (c[i] / c[i - 63] - 1) * 100 : null, ret126: i >= 126 ? (c[i] / c[i - 126] - 1) * 100 : null };
    }
    return result;
  }
  function score(bars, asOf = new Date()) {
    const none = reason => ({ available: false, eligible: false, final: null, reason, date: bars.at(-1)?.date || null });
    if (bars.length < 130) return none('Need 130 daily OHLCV observations.');
    const today = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()), last = bars.at(-1), age = (today - Date.parse(last.date + 'T00:00:00Z')) / 86400000;
    if (!Number.isFinite(age) || age < 0 || age > 7) return none(age < 0 ? 'Future observation date.' : 'History is missing or more than 7 days old.');
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], date = Date.parse(b.date + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== b.date || !['open', 'high', 'low', 'close'].every(k => Number.isFinite(b[k]) && b[k] > 0) || !Number.isFinite(b.volume) || b.volume < 0 || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.high < b.low) return none('Missing or inconsistent OHLCV observation.');
      if (i && (date <= Date.parse(bars[i - 1].date) || date - Date.parse(bars[i - 1].date) > 7 * 86400000)) return none('Duplicate dates, wrong date order, or a history gap over 7 days.');
    }
    const series = indicators(bars), i = bars.length - 1, x = series[i], prev = series[i - 1], back = series[i - 5], c = last.close, d20 = c / x.ema20 - 1, d50 = c / x.sma50 - 1;
    if (series.slice(-10).some(s => Object.values(s).some(v => !Number.isFinite(v)))) return none('Insufficient usable volume or indicator history.');
    const vmiMax = Math.max(...series.slice(i - 4, i + 1).map(s => s.vmi));
    const crossingAge = fn => { for (let a = 0; a <= 4; a++) if (fn(i - a)) return a; return null; };
    const rocAge = crossingAge(j => series[j].roc > 0 && series[j - 1].roc <= 0), reclaimAge = crossingAge(j => bars[j].close > series[j].ema20 && bars[j - 1].close <= series[j - 1].ema20);
    const freshness = age => age === null ? 0 : [1, .8, .6, .3, .3][age];
    const rocQuality = plateau(x.roc, 0, 1, 10, 20);
    const core = [part('ROC7 quality', 10, rocQuality, '0 at ROC ≤0 or ≥20%; full points at +1 to +10%; linear between.'), part('Normalized VPCI', 10, plateau(x.vpci, 0, .05, .75, 1.5), '0 outside 0–1.5; full at 0.05–0.75; linear shoulders.'), part('VMI persistence', 8, ramp(vmiMax, .98, 1.08), 'Last five sessions’ maximum VMI, scaled from 0.98 to 1.08.'), part('Price vs EMA20', 8, ramp(d20, 0, .02), '0 at/below EMA20; full at 2% above.'), part('SMA50 proximity', 4, clamp(1 - Math.abs(d50) / .15), 'Full at SMA50; decreases to 0 at ±15%.'), part('CMF accumulation', 5, ramp(x.cmf, -.05, .15), 'CMF20 scaled from −0.05 to +0.15.'), part('Relative volume', 5, ramp(x.rvol, .5, 1.5), 'Current volume / prior 20-day mean, scaled from 0.5 to 1.5.')];
    const cont = [part('VPCI rising', 10, ramp(x.vpci - back.vpci, 0, .1), 'Five-session normalized VPCI increase, 0 to 0.10.'), part('RVOL expanding', 7, ramp(x.rvol, .5, 1.5) * (x.rvol >= prev.rvol ? 1 : .5), 'RVOL strength; half points when declining versus yesterday.'), part('Near 20-day closing high', 6, ramp(c / x.high20, .9, 1), '0 at 90% of 20-day high close; full at the high.'), part('EMA20 slope', 5, ramp(x.ema20 / back.ema20 - 1, 0, .05), 'Five-session EMA increase, 0 to 5%.'), part('Higher lows', 4, Math.min(...bars.slice(-5).map(b => b.low)) > Math.min(...bars.slice(-10, -5).map(b => b.low)) ? 1 : 0, 'Latest five-session low exceeds previous five-session low.'), part('ROC discipline', 3, rocQuality, 'Same ROC7 quality scale as core.')];
    const launch = [part('Fresh positive ROC cross', 10, freshness(rocAge), 'Cross today / 1 / 2 / 3–4 sessions ago = 100 / 80 / 60 / 30%; otherwise 0.'), part('Fresh EMA20 reclaim', 8, freshness(reclaimAge), 'Same freshness scale as the ROC cross.'), part('ATR launch zone', 6, plateau(x.atrPct, 2, 4, 8, 12), 'Full at ATR14/close of 4–8%; linear shoulders to 2% and 12%.'), part('SMA50 proximity', 5, clamp(1 - Math.abs(d50) / .15), 'Full at SMA50; decreases to 0 at ±15%.'), part('Accumulation improving', 4, (Number(x.vpci > back.vpci) + Number(x.cmf > back.cmf)) / 2, 'Half each for VPCI and CMF above five sessions ago.'), part('VMI strengthening', 2, ramp(x.vmi - back.vmi, 0, .1), 'Five-session VMI increase, 0 to 0.10.')];
    const trade = [part('Dollar-volume capacity', 5, ramp(Math.log10(x.adv), 5, Math.log10(5000000)), 'Log-scaled 20-day dollar volume from $100k to $5m.'), part('Entry extension', 4, clamp(1 - Math.max(d20, 0) / .15), 'Full at/below EMA20; 0 at 15% above.'), part('Opening gap', 3, clamp(1 - Math.abs(last.open / bars[i - 1].close - 1) / .1), 'Full at no opening gap; 0 at ±10%.'), part('Volatility execution proxy', 3, clamp(1 - x.atrPct / 15), 'ATR% scaled inversely from 0 to 15%; this is not a measured bid/ask spread.')];
    const penalty = d20 <= .05 ? 0 : d20 <= .1 ? 2 : d20 <= .15 ? 5 : 10;
    const continuation = sum(cont), reversal = sum(launch), ebr = clamp(sum(core) + Math.max(continuation, reversal) + sum(trade) - penalty, 0, 100);
    const strength = [part('1-month momentum', 10, ramp(x.ret21, -10, 20), '21-session return scaled from −10 to +20%.'), part('3-month momentum', 10, ramp(x.ret63, -15, 40), '63-session return scaled from −15 to +40%.'), part('6-month momentum', 10, ramp(x.ret126, -20, 60), '126-session return scaled from −20 to +60%.'), ...[20, 50, 100].map(n => part('Price vs SMA' + n, 10, ramp(c / x['sma' + n] - 1, -.05, .1), 'Distance from SMA scaled from −5 to +10%.')), part('63-day high proximity', 10, ramp(c / x.high63, .7, 1), 'Closing price / 63-session high close, scaled from 0.7 to 1.'), part('CMF20', 10, ramp(x.cmf, -.2, .2), 'CMF20 scaled from −0.20 to +0.20.'), part('RVOL20', 10, ramp(x.rvol, .5, 2), 'RVOL scaled from 0.5 to 2.'), part('Volume imbalance', 10, ramp(x.imbalance, -.4, .4), 'Signed up/down-session volume / total volume, scaled from −0.4 to +0.4.')];
    const buying = sum(strength), eligible = c < 50 && x.adv >= 100000;
    const basePass = x.roc > 0 && x.roc < 20 && x.vpci > 0 && x.vpci < 1.5 && vmiMax >= 1 && c > x.ema20;
    const recentNegative = series.slice(i - 3, i).some(s => s.roc < 0), launchPass = recentNegative && x.atrPct >= 4, continuationPass = x.vpci > back.vpci && x.rvol >= .8;
    const ready = basePass && (launchPass || continuationPass), baseCount = [x.roc > 0 && x.roc < 20, x.vpci > 0 && x.vpci < 1.5, vmiMax >= 1, c > x.ema20].filter(Boolean).length;
    return { available: true, eligible, reason: eligible ? '' : c >= 50 ? 'Price is $50 or higher.' : '20-day dollar volume is below $100,000.', date: last.date, price: c, ...x, vmiMax, ebr, buying, final: eligible ? .6 * ebr + .4 * buying : null, branch: reversal > continuation ? 'LAUNCH' : 'CONTINUATION', readiness: ready ? 'READY' : baseCount >= 3 ? 'EARLY' : 'NOT READY', bucket: ebr >= 75 && buying >= 70 ? 'Strong + timely' : ebr >= 80 && buying < 70 ? 'Early launch watch' : buying >= 70 ? 'Strength; wait for timing' : 'Developing / weak', core, cont, launch, trade, strength, penalty, continuation, reversal };
  }
  function rank(entries) {
    const ordered = [...entries].sort((a, b) => (a.final === null) - (b.final === null) || (b.final ?? 0) - (a.final ?? 0) || a.ticker.localeCompare(b.ticker));
    let n = 0; return ordered.map(s => ({ ...s, rank: s.final === null ? null : ++n }));
  }
  return { score, rank, indicators };
})();
