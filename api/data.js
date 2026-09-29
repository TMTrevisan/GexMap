// Vercel reuses warm serverless instances, so cached chains dedup requests from
// concurrent tabs/users within this window. Each cold instance starts empty.
const serverChainCache = new Map();
const serverInflight = new Map();

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Get symbol from query params (default SPY)
  let symbol = (req.query.symbol || 'SPY').toUpperCase();
  // Display symbols I:SPX / I:NDX ARE the ConvexValue provider symbols for
  // index underlyings (probed 2026-09-29: I:SPX -> 56 expirations / 30110
  // contracts on /api/data/chains; bare SPX -> empty chain). Pass through.
  let providerSymbol = symbol;
  const demoRequested = req.query.demo === '1';
  const apiKey = process.env.CV_API_KEY;
  const fetchedAt = new Date().toISOString();

  // Explicit demo mode: clearly-labeled synthetic data, never mistaken for live.
  if (demoRequested) {
    const records = generateDemoData(symbol);
    const spot = records.length ? records[0].underlying_price : 0;
    res.status(200).json({ records, demo: true, symbol, spot, fetchedAt });
    return;
  }

  if (!apiKey) {
    res.status(503).json({ error: 'Options data unavailable: missing CV_API_KEY environment variable in Vercel configuration.' });
    return;
  }

  const entry = serverChainCache.get(symbol);
  if (entry && Date.now() - entry.ts < 90 * 1000) {
    return res.status(200).json({...entry.body, cached: true});
  }

  if (serverInflight.has(symbol)) {
    const result = await serverInflight.get(symbol);
    return res.status(result.status).json(result.body);
  }
  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const apiUrl = 'https://tap.convexvalue.com/api/data/chains';
    const payload = {
      params: [
        'expiration_date', 'strike_price', 'contract_type', 'implied_volatility',
        'delta', 'gamma', 'theta', 'vega', 'bid', 'ask', 'fair_market_value', 'open_interest',
        'day_volume', 'underlying_price'
      ],
      symbol: providerSymbol
    };

    try {
      // ConvexValue omits underlying_price on index chains (probed 2026-09-29:
      // every SPX contract had underlying_price=null), so fetch a Yahoo spot in
      // parallel as the fallback for dollar-GEX/DEX math.
      const [apiResponse, yahooSpot] = await Promise.all([
        fetch(apiUrl, {
          signal: controller.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': 'cv-mcp/0.1.0'
          },
          body: JSON.stringify(payload)
        }),
        fetchYahooSpot(symbol)
      ]);

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text().catch(() => '');
        throw new Error(`ConvexValue API responded ${apiResponse.status}: ${errorText.slice(0, 200)}`);
      }

      const chainData = await apiResponse.json();
      const shapeInfo = chainData && typeof chainData === 'object'
        ? `keys=[${Object.keys(chainData).slice(0, 12).join(',')}] chain=${Array.isArray(chainData.chain) ? `array(${chainData.chain.length})` : typeof chainData.chain}`
        : typeof chainData;
      const records = processChainData(chainData, yahooSpot);

      if (!records.length) {
        throw new Error(`ConvexValue API returned no usable chain records (upstream shape: ${shapeInfo}).`);
      }

      const spot = records[0].underlying_price;
      const body = { records, demo: false, symbol, spot, fetchedAt };
      serverChainCache.set(symbol, { ts: Date.now(), body });
      return {status: 200, body};
    } catch (error) {
      console.warn(`Options chain fetch failed for ${symbol}: ${error.message}`);
      if (/429|hourly request limit/i.test(error.message)) {
        return {status: 429, body: {
          error: 'Upstream hourly API budget exhausted — chain requests are paused until the window resets.',
          detail: error.message
        }};
      }
      return {status: 503, body: {
        error: 'Options data temporarily unavailable. Upstream chain provider did not return usable data.',
        detail: error.message
      }};
    } finally { clearTimeout(timeout); }
  })();
  serverInflight.set(symbol, pending);
  try {
    const result = await pending;
    return res.status(result.status).json(result.body);
  } finally { serverInflight.delete(symbol); }
}

function generateDemoData(symbol) {
  // Synthetic data for demo mode ONLY. The frontend badges this as SIMULATED.
  let spot = 746.24;
  let interval = 1.0;

  if (symbol === 'SPY') { spot = 746.24; interval = 1.0; }
  else if (symbol === 'QQQ') { spot = 502.40; interval = 1.0; }
  else if (symbol === 'I:SPX') { spot = 5625.0; interval = 5.0; }
  else if (symbol === 'I:NDX') { spot = 19850.0; interval = 25.0; }
  else if (symbol === 'NVDA') { spot = 127.50; interval = 0.5; }
  else if (symbol === 'TSLA') { spot = 175.20; interval = 1.0; }
  else if (symbol === 'AAPL') { spot = 212.50; interval = 1.0; }
  else if (symbol === 'META') { spot = 505.10; interval = 2.5; }
  else if (symbol === 'AMD') { spot = 162.30; interval = 1.0; }
  else if (symbol === 'AMZN') { spot = 185.40; interval = 1.0; }

  // Add a small synthetic fluctuation to spot price on every refresh
  spot = spot + (Math.random() - 0.5) * (interval * 3.5);

  // Generate 8 distinct weekday expirations starting tomorrow
  const expDates = [];
  const startDay = new Date();
  startDay.setDate(startDay.getDate() + 1);
  for (let i = 0; expDates.length < 8; i++) {
    const d = new Date(startDay.getTime() + i * 24 * 60 * 60 * 1000);
    // skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    expDates.push(`${yyyy}-${mm}-${dd}`);
  }

  const strikes = [];
  const minStrike = Math.round((spot * 0.97) / interval) * interval;
  const maxStrike = Math.round((spot * 1.03) / interval) * interval;

  for (let s = minStrike; s <= maxStrike; s += interval) {
    strikes.push(parseFloat(s.toFixed(2)));
  }

  const records = [];
  const today = new Date();

  expDates.forEach((exp, expIdx) => {
    const expiryFactor = Math.exp(-expIdx * 0.3);
    const dte = Math.max(0, (expirationTimestamp(exp) - today) / 86400000);

    strikes.forEach(strike => {
      // Use dynamic noise based on current timestamp
      const randVal = Math.sin(strike * 13 + Math.random() * 5);

      // Calculate realistic GEX
      let gex = 0;
      if (strike > spot) {
        // Calls: positive GEX peaking near 1.5% out of the money
        const x = (strike - spot * 1.015) / (spot * 0.01);
        gex = 800000 * Math.exp(-x * x / 2) * expiryFactor;
      } else {
        // Puts: negative GEX peaking near 1.5% down
        const x = (strike - spot * 0.985) / (spot * 0.01);
        gex = -950000 * Math.exp(-x * x / 2) * expiryFactor;
      }

      // Add call wall peak
      const callWallStrike = Math.round((spot * 1.025) / interval) * interval;
      if (strike === callWallStrike) {
        gex += 1500000 * expiryFactor;
      }

      // Add put wall peak
      const putWallStrike = Math.round((spot * 0.975) / interval) * interval;
      if (strike === putWallStrike) {
        gex -= 1800000 * expiryFactor;
      }

      // Add dynamic noise fluctuation
      gex += randVal * 250000 * expiryFactor;

      const callOi = Math.round(Math.abs(Math.max(gex, 0)) / 10 + 60);
      const putOi = Math.round(Math.abs(Math.min(gex, 0)) / 10 + 60);
      const oi = callOi + putOi;
      const volume = Math.round(oi * 0.15 * (Math.sin(strike) + 1.2));
      // Synthetic IV smile: higher away from the money
      const iv = 0.18 + 0.35 * Math.pow(Math.abs(strike - spot) / (spot * 0.03), 1.5);
      // Synthetic option midpoints (for expected-move math in demo mode)
      const dist = Math.abs(strike - spot);
      const tv = Math.max(0.05, spot * 0.006 * Math.sqrt(dte + 1) - dist * 0.3);
      const cmid = Math.round((strike >= spot ? tv : tv + (spot - strike)) * 100) / 100;
      const pmid = Math.round((strike <= spot ? tv : tv + (strike - spot)) * 100) / 100;

      records.push({
        expiration: exp,
        dte,
        strike: strike,
        call_oi: callOi,
        put_oi: putOi,
        call_mid: cmid,
        put_mid: pmid,
        open_interest: oi,
        volume: volume,
        iv: Math.round(iv * 10000) / 10000,
        underlying_price: spot
      });
    });
  });

  return processChainData({chain: expDates.map(exp => ({expiration: exp, strikes: records.filter(r => r.expiration === exp).map(r => [r.strike,
    [exp, r.strike, 'call', r.iv, 0.5, 0.02, null, null, null, null, r.call_mid, r.call_oi, r.volume / 2, spot],
    [exp, r.strike, 'put', r.iv, -0.5, 0.02, null, null, null, null, r.put_mid, r.put_oi, r.volume / 2, spot]
  ])}))}, spot);
}

// Map app symbols to Yahoo symbols for the spot-price fallback. ConvexValue
// index chains carry underlying_price=null on every contract, so dollar
// GEX/DEX math needs an independent spot.
const YAHOO_SYMBOLS = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  'I:SPX': '^GSPC',
  'I:NDX': '^NDX'
};

async function fetchYahooSpot(displaySymbol) {
  const ys = YAHOO_SYMBOLS[displaySymbol] || displaySymbol;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?interval=1d&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gexmap/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return 0;
    const d = await r.json();
    const px = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return Number.isFinite(px) && px > 0 ? px : 0;
  } catch {
    return 0;
  }
}

function expirationTimestamp(exp) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return Date.parse(exp);
  const noon = new Date(exp + 'T12:00:00Z');
  const hour = Number(new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23'}).format(noon));
  return Date.parse(exp + 'T16:00:00Z') + (12 - hour) * 3600000;
}
function nullableNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function processChainData(chainData, fallbackSpot = 0) {
  if (!chainData || !Array.isArray(chainData.chain) || chainData.chain.length === 0) {
    return [];
  }

  const processedRecords = [];
  const today = new Date();

  for (const item of chainData.chain) {
    const expDate = item.expiration;
    const strikes = item.strikes || [];
    if (!expDate || !Array.isArray(strikes)) continue;
    const dte = Math.max(0, (expirationTimestamp(expDate) - today) / 86400000);

    for (const strikeInfo of strikes) {
      if (!Array.isArray(strikeInfo) || strikeInfo.length < 3) continue;

      const strike = parseFloat(strikeInfo[0]);
      if (!Number.isFinite(strike)) continue;
      const callContract = strikeInfo[1];
      const putContract = strikeInfo[2];

      let strikeGex = 0.0;
      let strikeDex = 0.0;
      let callOi = 0;
      let putOi = 0;
      let strikeVol = 0;
      let underlyingPrice = 0.0;
      let ivNum = 0;
      let ivDen = 0;
      let callMid = null;
      let putMid = null;
      let callGex = 0, putGex = 0;
      const contracts = [];

      // Contract array layout follows the requested params order:
      // [expiration_date, strike_price, contract_type, implied_volatility,
      //  delta, gamma, theta, vega, bid, ask, fair_market_value,
      //  open_interest, day_volume, underlying_price]
      // NOTE: ConvexValue does not provide bid/ask/midpoint on this endpoint
      // (all null); fair_market_value is the usable per-contract value and is
      // stored in the call_mid/put_mid fields for expected-move math.
      const readContract = (contract, sign) => {
        if (!Array.isArray(contract) || contract.length <= 13) return;
        const oi = parseInt(contract[11] || 0, 10) || 0;
        const vol = parseInt(contract[12] || 0, 10) || 0;
        const delta = nullableNum(contract[4]);
        const gamma = nullableNum(contract[5]);
        const iv = nullableNum(contract[3]);
        const uPrice = num(contract[13]);
        if (uPrice > 0) underlyingPrice = uPrice;
        if (iv > 0 && oi > 0) { ivNum += iv * oi; ivDen += oi; }
        if (sign > 0) { callOi += oi; callMid = nullableNum(contract[10]); }
        else { putOi += oi; putMid = nullableNum(contract[10]); }
        strikeVol += vol;
        contracts.push({strike, expiration: Number.isFinite(expirationTimestamp(contract[0] || expDate)) ? new Date(expirationTimestamp(contract[0] || expDate)).toISOString() : null, type: sign > 0 ? 'call' : 'put', iv, oi, gamma, delta});
        if (gamma !== null) {
          const exposure = sign * gamma * oi * 100;
          strikeGex += exposure;
          if (sign > 0) callGex += exposure; else putGex += exposure;
        }
        if (delta !== null) strikeDex += delta * oi * 100; // put delta is already negative
      };

      // Dealer positioning convention: long call gamma / short put gamma
      readContract(callContract, +1);
      readContract(putContract, -1);

      if (underlyingPrice > 0 || fallbackSpot > 0) {
        // Dollar GEX = signed gamma * OI * 100 * spot² * 1%; DEX = delta * OI * 100 * spot. Prefer the
        // contract's own underlying_price; fall back to Yahoo spot when the
        // provider omits it (all index chains).
        const px = underlyingPrice > 0 ? underlyingPrice : fallbackSpot;
        // Dollar GEX = signed gamma * OI * 100 * spot² * 1%; DEX = delta * OI * 100 * spot
        const dollarGex = strikeGex * px * px * 0.01;
        const dollarDex = strikeDex * px;

        processedRecords.push({
          expiration: expDate,
          contracts, iv_num: ivNum, iv_den: ivDen,
          call_gex: callGex * px * px * 0.01, put_gex: putGex * px * px * 0.01,
          dte,
          strike: strike,
          gex: Math.round(strikeGex * 100) / 100,
          dex: Math.round(strikeDex * 100) / 100,
          dollar_gex: Math.round(dollarGex * 100) / 100,
          dollar_dex: Math.round(dollarDex * 100) / 100,
          call_oi: callOi,
          put_oi: putOi,
          call_mid: callMid,
          put_mid: putMid,
          open_interest: callOi + putOi,
          volume: strikeVol,
          iv: ivDen > 0 ? Math.round((ivNum / ivDen) * 10000) / 10000 : 0,
          underlying_price: px
        });
      }
    }
  }

  return processedRecords;
}
