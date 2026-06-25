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
  const symbol = (req.query.symbol || 'SPY').toUpperCase();
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
      res.status(apiResponse.status).json({ error: `Convex Value API error: ${errorText}` });
      return;
    }

    const chainData = await apiResponse.json();
    const processedData = processChainData(chainData);
    res.status(200).json(processedData);
  } catch (error) {
    res.status(500).json({ error: `Server failed to process request: ${error.message}` });
  }
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
        // GEX/DEX in Dollars = Gamma/Delta * OI * Spot (Matches FlowbyBobby's scale exactly)
        // Note: strikeGex/strikeDex is scaled by 100, so we multiply by 0.01 to get the exact unit.
        const dollarGex = strikeGex * underlyingPrice * 0.01;
        const dollarDex = strikeDex * underlyingPrice * 0.01;

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
