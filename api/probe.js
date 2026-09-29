// TEMPORARY diagnostic probe: which endpoint+symbol form returns an SPX chain.
// Shape metadata only — no credentials or full payloads are returned.
export default async function handler(req, res) {
  const apiKey = process.env.CV_API_KEY;
  if (!apiKey) { res.status(503).json({ error: 'no key' }); return; }
  const params = ['expiration_date', 'strike_price', 'contract_type', 'implied_volatility',
    'delta', 'gamma', 'theta', 'vega', 'bid', 'ask', 'midpoint', 'open_interest',
    'day_volume', 'underlying_price'];
  const combos = [
    ['/api/data/chains', { params, symbol: 'SPX' }],
    ['/api/data/chains', { params, symbol: 'I:SPX' }],
    ['/api/get/chain', { symbols: ['SPX'], params }],
    ['/api/get/chain', { symbols: ['I:SPX'], params }]
  ];
  const out = [];
  for (const [path, body] of combos) {
    try {
      const r = await fetch('https://tap.convexvalue.com' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      const keys = j && typeof j === 'object' ? Object.keys(j).slice(0, 12) : typeof j;
      let chainInfo = null;
      if (Array.isArray(j.chain)) chainInfo = `chain array len=${j.chain.length}`;
      else if (j.data !== undefined) chainInfo = `data type=${Array.isArray(j.data) ? 'array len=' + j.data.length : typeof j.data}`;
      out.push({
        path,
        symbolSent: body.symbol || (body.symbols || []).join(','),
        http: r.status,
        keys,
        chainInfo,
        contract_count: j.contract_count ?? null,
        head: JSON.stringify(j).slice(0, 250)
      });
    } catch (e) {
      out.push({ path, symbolSent: body.symbol || (body.symbols || []).join(','), error: e.message });
    }
  }
  res.status(200).json({ out });
}
