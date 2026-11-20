/**
 * Cloudflare Pages Function — GET /api/callouts
 */
export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store, max-age=0",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const data = await getCallouts(env);
    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({
        source: "error",
        updatedAt: new Date().toISOString(),
        callouts: [],
        error: String(err.message || err),
      }),
      { status: 200, headers }
    );
  }
}

async function getCallouts(env) {
  var key = env.PUMPFOMO_API_KEY || null;

  if (key) {
    try {
      var live = await fetchFromPumpfomo(key, env);
      if (live && Array.isArray(live.callouts)) return live;
    } catch (e) {
      return {
        source: "pumpfomo-error",
        updatedAt: new Date().toISOString(),
        callouts: [],
        error: String(e.message || e),
      };
    }
  }

  return {
    source: "none",
    updatedAt: new Date().toISOString(),
    callouts: [],
    note: "No simulated callouts. Set PUMPFOMO_API_KEY on Cloudflare, or paste a Railway live feed URL in the panel.",
  };
}

async function fetchFromPumpfomo(apiKey, env) {
  var wallets = (env.CALLOUT_WALLETS || "")
    .split(",")
    .map(function (w) { return w.trim(); })
    .filter(Boolean);

  if (!wallets.length) {
    return {
      source: "pumpfomo-no-wallets",
      updatedAt: new Date().toISOString(),
      callouts: [],
      note: "PUMPFOMO_API_KEY set but CALLOUT_WALLETS is empty.",
    };
  }

  var all = [];
  for (var i = 0; i < wallets.length; i++) {
    var w = wallets[i];
    var url = "https://api.pumpfomo.com/v1/pump/users/" + encodeURIComponent(w) + "/callouts";
    var res = await fetch(url, {
      headers: {
        Authorization: "Bearer " + apiKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) continue;
    var json = await res.json();
    var items = (json && (json.data || json.callouts || json)) || [];
    if (!Array.isArray(items)) continue;

    items.forEach(function (c) {
      var mint = c.coinMint || c.mint || c.token || null;
      if (!mint || String(mint).length < 32) return;
      var calledAt = c.createdAt
        ? Number(c.createdAt) < 1e12
          ? Number(c.createdAt) * 1000
          : Number(c.createdAt)
        : Date.now();
      all.push({
        id: c.calloutId || c.id || String(mint) + "-" + calledAt,
        mint: String(mint),
        symbol: c.symbol || c.ticker || "???",
        name: c.name || c.symbol || "Unknown",
        thesis: c.thesis || c.text || "",
        marketCapAtCall: c.marketCap || c.calledOutAtMcap || null,
        calledAt: calledAt,
        callerName: c.userName || c.author || "Caller",
        callerWallet: c.userId || w,
        strength: Number(c.maxMultiplier || 0) >= 2 ? "high" : "medium",
        ageMinutes: Math.max(0, Math.round((Date.now() - calledAt) / 60000)),
      });
    });
  }

  all = all.filter(function (c) { return c.ageMinutes <= 180; });
  all.sort(function (a, b) {
    if (a.strength === "high" && b.strength !== "high") return -1;
    if (b.strength === "high" && a.strength !== "high") return 1;
    return (a.ageMinutes || 999) - (b.ageMinutes || 999);
  });

  return {
    source: "pumpfomo",
    updatedAt: new Date().toISOString(),
    callouts: all.slice(0, 30),
  };
}
