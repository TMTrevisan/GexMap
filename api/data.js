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
  if (symbol === 'SPX') {
    symbol = 'I:SPX';
  }
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

  const apiUrl = 'https://tap.convexvalue.com/api/data/chains';
  const payload = {
    params: [
      'expiration_date', 'strike_price', 'contract_type', 'implied_volatility',
      'delta', 'gamma', 'theta', 'vega', 'bid', 'ask', 'midpoint', 'open_interest',
      'day_volume', 'underlying_price'
    ],
    symbol: symbol
  };

  try {
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'cv-mcp/0.1.0'
      },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text().catch(() => '');
      throw new Error(`ConvexValue API responded ${apiResponse.status}: ${errorText.slice(0, 200)}`);
    }

    const chainData = await apiResponse.json();
    const records = processChainData(chainData);

    if (!records.length) {
      throw new Error('ConvexValue API returned no usable chain records (unexpected response shape).');
    }

    const spot = records[0].underlying_price;
    res.status(200).json({ records, demo: false, symbol, spot, fetchedAt });
  } catch (error) {
    console.warn(`Options chain fetch failed for ${symbol}: ${error.message}`);
    res.status(503).json({
      error: 'Options data temporarily unavailable. Upstream chain provider did not return usable data.',
      detail: error.message
    });
  }
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

  // Add a small live fluctuation to spot price on every refresh
  spot = spot + (Math.random() - 0.5) * (interval * 3.5);

  // Generate 8 expirations starting from today
  const expDates = [];
  const startDay = new Date();
  startDay.setDate(startDay.getDate() + 1);
  for (let i = 0; i < 8; i++) {
    const d = new Date(startDay.getTime() + i * 24 * 60 * 60 * 1000);
    // skip weekends
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);

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
    const dte = Math.max(0, Math.round((new Date(exp + 'T00:00:00') - today) / 86400000));

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

      records.push({
        expiration: exp,
        dte,
        strike: strike,
        gex: Math.round(gex * 100) / 100,
        dex: Math.round(gex * 0.5 * 100) / 100,
        dollar_gex: Math.round(gex * spot * 100) / 100,
        dollar_dex: Math.round(gex * 0.5 * spot * 100) / 100,
        call_oi: callOi,
        put_oi: putOi,
        open_interest: oi,
        volume: volume,
        iv: Math.round(iv * 10000) / 10000,
        underlying_price: spot
      });
    });
  });

  return records;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function processChainData(chainData) {
  if (!chainData || !Array.isArray(chainData.chain) || chainData.chain.length === 0) {
    return [];
  }

  const processedRecords = [];
  const today = new Date();

  for (const item of chainData.chain) {
    const expDate = item.expiration;
    const strikes = item.strikes || [];
    if (!expDate || !Array.isArray(strikes)) continue;
    const dte = Math.max(0, Math.round((new Date(expDate + 'T00:00:00') - today) / 86400000));

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

      // Contract array layout follows the requested params order:
      // [expiration_date, strike_price, contract_type, implied_volatility,
      //  delta, gamma, theta, vega, bid, ask, midpoint,
      //  open_interest, day_volume, underlying_price]
      const readContract = (contract, sign) => {
        if (!Array.isArray(contract) || contract.length <= 13) return;
        const oi = parseInt(contract[11] || 0, 10) || 0;
        const vol = parseInt(contract[12] || 0, 10) || 0;
        const delta = num(contract[4]);
        const gamma = num(contract[5]);
        const iv = num(contract[3]);
        const uPrice = num(contract[13]);
        if (uPrice > 0) underlyingPrice = uPrice;
        if (iv > 0 && iv < 5 && oi > 0) { ivNum += iv * oi; ivDen += oi; }
        if (sign > 0) callOi += oi; else putOi += oi;
        strikeVol += vol;
        strikeGex += sign * gamma * oi * 100;
        strikeDex += delta * oi * 100; // put delta is already negative
      };

      // Dealer positioning convention: long call gamma / short put gamma
      readContract(callContract, +1);
      readContract(putContract, -1);

      if (underlyingPrice > 0) {
        // GEX/DEX in Dollars = Gamma/Delta * OI * 100 * Spot
        const dollarGex = strikeGex * underlyingPrice;
        const dollarDex = strikeDex * underlyingPrice;

        processedRecords.push({
          expiration: expDate,
          dte,
          strike: strike,
          gex: Math.round(strikeGex * 100) / 100,
          dex: Math.round(strikeDex * 100) / 100,
          dollar_gex: Math.round(dollarGex * 100) / 100,
          dollar_dex: Math.round(dollarDex * 100) / 100,
          call_oi: callOi,
          put_oi: putOi,
          open_interest: callOi + putOi,
          volume: strikeVol,
          iv: ivDen > 0 ? Math.round((ivNum / ivDen) * 10000) / 10000 : 0,
          underlying_price: underlyingPrice
        });
      }
    }
  }

  return processedRecords;
}
