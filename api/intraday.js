// Real intraday OHLCV bars via Yahoo Finance (keyless).
// Query: ?symbol=SPY&interval=5m|15m&range=1d|5d|10d
// Used by the HIRO intraday price panel. Fails with 503 if Yahoo is
// unreachable; the frontend shows an unavailable notice instead of fake bars.

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

const YAHOO_SYMBOLS = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  'I:SPX': '^GSPC',
  'I:NDX': '^NDX',
  NVDA: 'NVDA',
  TSLA: 'TSLA',
  AAPL: 'AAPL',
  META: 'META',
  AMD: 'AMD',
  AMZN: 'AMZN'
};

const ALLOWED_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m']);
const ALLOWED_RANGES = new Set(['1d', '2d', '5d', '10d']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const symbol = (req.query.symbol || 'SPY').toUpperCase();
  const yahooSymbol = YAHOO_SYMBOLS[symbol] || 'SPY';
  const interval = ALLOWED_INTERVALS.has(req.query.interval) ? req.query.interval : '5m';
  const range = ALLOWED_RANGES.has(req.query.range) ? req.query.range : '1d';

  try {
    const url = `${YAHOO}/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gexmap/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) throw new Error(`Yahoo ${resp.status} for ${yahooSymbol}`);
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const q = result?.indicators?.quote?.[0];
    if (!result || !q) throw new Error('Unexpected Yahoo response shape');

    const t = [];
    const o = [];
    const h = [];
    const l = [];
    const c = [];
    const v = [];
    const n = (result.timestamp || []).length;
    for (let i = 0; i < n; i++) {
      const close = q.close?.[i];
      if (close == null) continue; // skip nulls (pre-market gaps)
      t.push(result.timestamp[i] * 1000);
      o.push(q.open?.[i] ?? close);
      h.push(q.high?.[i] ?? close);
      l.push(q.low?.[i] ?? close);
      c.push(close);
      v.push(q.volume?.[i] ?? 0);
    }

    if (!t.length) throw new Error('No intraday bars returned');

    res.status(200).json({
      symbol,
      interval,
      range,
      t, o, h, l, c, v,
      ts: new Date().toISOString()
    });
  } catch (error) {
    console.warn(`intraday fetch failed for ${symbol}: ${error.message}`);
    res.status(503).json({ error: 'Intraday data unavailable.', detail: error.message });
  }
}
