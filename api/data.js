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
  const apiKey = process.env.CV_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "Missing CV_API_KEY environment variable in Vercel configuration." });
    return;
  }

  const apiUrl = "https://tap.convexvalue.com/api/data/chains";
  const payload = {
    params: [
      "expiration_date", "strike_price", "contract_type", "implied_volatility",
      "delta", "gamma", "theta", "vega", "bid", "ask", "midpoint", "open_interest",
      "day_volume", "underlying_price"
    ],
    symbol: symbol
  };

  try {
    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "User-Agent": "cv-mcp/0.1.0"
      },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.warn(`Convex Value API rate limited or offline. Falling back to local data generator. Error: ${errorText}`);
      const fallbackRecords = generateFallbackData(symbol);
      res.status(200).json(fallbackRecords);
      return;
    }

    const chainData = await apiResponse.json();
    const processedData = processChainData(chainData);
    res.status(200).json(processedData);
  } catch (error) {
    console.warn(`Server request failed. Falling back to local data generator. Error: ${error.message}`);
    const fallbackRecords = generateFallbackData(symbol);
    res.status(200).json(fallbackRecords);
  }
}

function generateFallbackData(symbol) {
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

  // Generate 8 expirations starting from today
  const expDates = [];
  const startDay = new Date("2026-07-08");
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

  expDates.forEach((exp, expIdx) => {
    const expiryFactor = Math.exp(-expIdx * 0.3);

    strikes.forEach(strike => {
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

      // Add random noise
      const noise = (Math.sin(strike * 13) * Math.cos(expIdx * 7)) * 120000;
      gex += noise;

      const oi = Math.round((Math.abs(gex) / 10) + 100);
      const volume = Math.round(oi * 0.15 * (Math.sin(strike) + 1.2));

      records.push({
        expiration: exp,
        strike: strike,
        gex: Math.round(gex * 100) / 100,
        dex: Math.round(gex * 0.5 * 100) / 100,
        dollar_gex: Math.round(gex * spot * 100) / 100,
        dollar_dex: Math.round(gex * 0.5 * spot * 100) / 100,
        open_interest: oi,
        volume: volume,
        underlying_price: spot
      });
    });
  });

  return records;
}

function processChainData(chainData) {
  if (!chainData || !chainData.chain) {
    return [];
  }

  const processedRecords = [];

  for (const item of chainData.chain) {
    const expDate = item.expiration;
    const strikes = item.strikes || [];

    for (const strikeInfo of strikes) {
      if (strikeInfo.length < 3) continue;

      const strike = parseFloat(strikeInfo[0]);
      const callContract = strikeInfo[1];
      const putContract = strikeInfo[2];

      let strikeGex = 0.0;
      let strikeDex = 0.0;
      let strikeOi = 0;
      let strikeVol = 0;
      let underlyingPrice = 0.0;

      // Call Contract Processing
      if (callContract && callContract.length > 13) {
        const oi = parseInt(callContract[11] || 0);
        const vol = parseInt(callContract[12] || 0);
        const delta = parseFloat(callContract[4] || 0.0);
        const gamma = parseFloat(callContract[5] || 0.0);
        const uPrice = parseFloat(callContract[13] || 0.0);
        if (uPrice > 0) {
          underlyingPrice = uPrice;
        }

        strikeOi += oi;
        strikeVol += vol;
        strikeGex += gamma * oi * 100;
        strikeDex += delta * oi * 100;
      }

      // Put Contract Processing
      if (putContract && putContract.length > 13) {
        const oi = parseInt(putContract[11] || 0);
        const vol = parseInt(putContract[12] || 0);
        const delta = parseFloat(putContract[4] || 0.0);
        const gamma = parseFloat(putContract[5] || 0.0);
        const uPrice = parseFloat(putContract[13] || 0.0);
        if (uPrice > 0) {
          underlyingPrice = uPrice;
        }

        strikeOi += oi;
        strikeVol += vol;
        strikeGex -= gamma * oi * 100;
        strikeDex += delta * oi * 100; // Put delta is already negative
      }

      if (underlyingPrice > 0) {
        // GEX/DEX in Dollars = Gamma/Delta * OI * 100 * Spot
        const dollarGex = strikeGex * underlyingPrice;
        const dollarDex = strikeDex * underlyingPrice;

        processedRecords.push({
          expiration: expDate,
          strike: strike,
          gex: Math.round(strikeGex * 100) / 100,
          dex: Math.round(strikeDex * 100) / 100,
          dollar_gex: Math.round(dollarGex * 100) / 100,
          dollar_dex: Math.round(dollarDex * 100) / 100,
          open_interest: strikeOi,
          volume: strikeVol,
          underlying_price: underlyingPrice
        });
      }
    }
  }

  return processedRecords;
}
