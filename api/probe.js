// TEMPORARY diagnostic: dump first expiration group's structure for I:SPX.
// Market data values only — no credentials.
export default async function handler(req, res) {
  const apiKey = process.env.CV_API_KEY;
  if (!apiKey) { res.status(503).json({ error: 'no key' }); return; }
  const params = ['expiration_date', 'strike_price', 'contract_type', 'implied_volatility',
    'delta', 'gamma', 'theta', 'vega', 'bid', 'ask', 'midpoint', 'open_interest',
    'day_volume', 'underlying_price'];
  const r = await fetch('https://tap.convexvalue.com/api/data/chains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ params, symbol: 'I:SPX' }),
    signal: AbortSignal.timeout(20000)
  });
  const j = await r.json();
  const g0 = j.chain[0];
  const s0 = g0.strikes[0];
  const s1 = g0.strikes[1];
  res.status(200).json({
    groupKeys: Object.keys(g0),
    expiration: g0.expiration,
    numStrikes: g0.strikes.length,
    strikeGroupIsArray: Array.isArray(s0),
    strikeGroup0len: s0.length,
    strikeGroup0head: JSON.stringify(s0).slice(0, 600),
    strikeGroup1head: JSON.stringify(s1).slice(0, 600),
    // same for SPY first group for comparison
  });
}
