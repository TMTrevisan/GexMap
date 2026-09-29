// Real-time-ish market context via Yahoo Finance (keyless).
// Returns the symbol's latest daily close + previous close, plus the VIX
// level and its previous close. Used for the VIX readout and cross-checks.
// Fails with 503 if Yahoo is unreachable; the frontend hides market widgets then.

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Map app symbols to Yahoo symbols
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

async function fetchCloses(yahooSymbol) {
  const url = `${YAHOO}/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gexmap/1.0)' },
    signal: AbortSignal.timeout(8000)
  });
  if (!resp.ok) throw new Error(`Yahoo ${resp.status} for ${yahooSymbol}`);
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close?.filter(c => c != null) || [];
  if (closes.length < 1) throw new Error(`No closes for ${yahooSymbol}`);
  return closes;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const symbol = (req.query.symbol || 'SPY').toUpperCase();
  const yahooSymbol = YAHOO_SYMBOLS[symbol] || 'SPY';

  try {
    const [symCloses, vixCloses] = await Promise.all([
      fetchCloses(yahooSymbol),
      fetchCloses('^VIX')
    ]);

    const spot = symCloses[symCloses.length - 1];
    const prevClose = symCloses.length > 1 ? symCloses[symCloses.length - 2] : spot;
    const vix = vixCloses[vixCloses.length - 1];
    const vixPrev = vixCloses.length > 1 ? vixCloses[vixCloses.length - 2] : vix;

    res.status(200).json({
      symbol,
      spot: Math.round(spot * 100) / 100,
      prevClose: Math.round(prevClose * 100) / 100,
      changePct: Math.round(((spot - prevClose) / prevClose) * 10000) / 100,
      vix: Math.round(vix * 100) / 100,
      vixPrev: Math.round(vixPrev * 100) / 100,
      vixChange: Math.round((vix - vixPrev) * 100) / 100,
      ts: new Date().toISOString()
    });
  } catch (error) {
    console.warn(`market fetch failed for ${symbol}: ${error.message}`);
    res.status(503).json({ error: 'Market quote unavailable.', detail: error.message });
  }
}
