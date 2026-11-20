/**
 * Cloudflare Pages Function — GET /api/pumpfun
 * Multi-source discovery: pump + Dex + Raydium
 */
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);

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

  var limit = 30;
  var qLimit = url.searchParams.get("limit");
  if (qLimit) {
    limit = Math.max(1, Math.min(50, parseInt(qLimit, 10) || 30));
  }

  var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  var sourcesUsed = [];
  var WSOL = "So11111111111111111111111111111111111111112";
  var STABLES = {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1,
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 1,
    So11111111111111111111111111111111111111112: 1,
  };

  function toMs(v) {
    v = Number(v);
    if (!isFinite(v) || v <= 0) return null;
    if (v < 1e12) v *= 1000;
    if (v > Date.now() + 3600000) return null;
    if (v < 1577836800000) return null;
    return v;
  }
  function isMint(m) {
    return m && String(m).length >= 32 && String(m).length <= 48;
  }
  function pickCreated(c) {
    return toMs(
      c.created_timestamp || c.createdTimestamp || c.createdAt || c.created_at ||
      c.open_timestamp || c.openTime || c.pairCreatedAt || c.timestamp || null
    );
  }

  var rows = [];
  var seen = {};

  function addRow(row) {
    if (!row || !isMint(row.mint)) return;
    var k = String(row.mint).toLowerCase();
    if (seen[k]) {
      var ex = seen[k];
      if (row.volume5m && (!ex.volume5m || row.volume5m > ex.volume5m)) ex.volume5m = row.volume5m;
      if (row.volume24h && (!ex.volume24h || row.volume24h > ex.volume24h)) ex.volume24h = row.volume24h;
      if (row.liquidityUsd && (!ex.liquidityUsd || row.liquidityUsd > ex.liquidityUsd)) ex.liquidityUsd = row.liquidityUsd;
      if (row.source && String(ex.source).indexOf("pump") < 0 && String(row.source).indexOf("pump") >= 0)
        ex.source = row.source;
      return;
    }
    seen[k] = row;
    rows.push(row);
  }

  // 1) pump.fun official
  var pumpUrls = [
    "https://frontend-api.pump.fun/coins?offset=0&limit=" + limit + "&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=" + limit + "&sort=created_timestamp&order=DESC&includeNsfw=false",
  ];
  for (var i = 0; i < pumpUrls.length; i++) {
    try {
      var res = await fetch(pumpUrls[i], {
        headers: {
          Accept: "application/json",
          "User-Agent": ua,
          Origin: "https://pump.fun",
          Referer: "https://pump.fun/",
        },
      });
      if (!res.ok) continue;
      var data = await res.json();
      var coins = Array.isArray(data) ? data : (data && (data.coins || data.data)) || [];
      if (!Array.isArray(coins)) coins = [];
      var n = 0;
      coins.forEach(function (c) {
        var mint = c.mint || c.address || c.token_address;
        if (!isMint(mint)) return;
        var created = pickCreated(c);
        addRow({
          mint: String(mint),
          address: String(mint),
          name: c.name || c.symbol || String(mint).slice(0, 8),
          symbol: c.symbol || null,
          usd_market_cap: c.usd_market_cap || c.market_cap || null,
          created_timestamp: created,
          pairCreatedAt: created,
          ageMinutes: created != null ? (Date.now() - created) / 60000 : null,
          source: "pump.fun",
        });
        n++;
      });
      if (n) {
        sourcesUsed.push("pump.fun");
        break;
      }
    } catch (e) {}
  }

  // DexScreener pump.fun pairs
  try {
    var pfSearch = await fetch("https://api.dexscreener.com/latest/dex/search?q=pumpfun", {
      headers: { Accept: "application/json", "User-Agent": ua },
    });
    if (pfSearch.ok) {
      var pfData = await pfSearch.json();
      var pfPairs = (pfData && pfData.pairs) || [];
      var pfn = 0;
      pfPairs.forEach(function (p) {
        if (!p || (p.chainId || "").toLowerCase() !== "solana") return;
        var dex = String(p.dexId || "").toLowerCase();
        if (dex.indexOf("pump") < 0) return;
        var mint = p.baseToken && p.baseToken.address;
        if (!isMint(mint) || STABLES[mint] || mint === WSOL) return;
        var created = toMs(p.pairCreatedAt);
        var ageMin = created != null ? (Date.now() - created) / 60000 : null;
        addRow({
          mint: mint,
          address: mint,
          name: ((p.baseToken && (p.baseToken.symbol || p.baseToken.name)) || mint).slice(0, 32),
          symbol: (p.baseToken && p.baseToken.symbol) || null,
          created_timestamp: created,
          pairCreatedAt: created,
          ageMinutes: ageMin,
          liquidityUsd: p.liquidity && p.liquidity.usd != null ? Number(p.liquidity.usd) || 0 : 0,
          volume24h: p.volume ? Number(p.volume.h24 || p.volume.h6 || p.volume.h1 || 0) || 0 : 0,
          volume5m: p.volume ? Number(p.volume.m5 || 0) || 0 : 0,
          priceChange5m: p.priceChange ? Number(p.priceChange.m5 != null ? p.priceChange.m5 : 0) || 0 : 0,
          usd_market_cap: p.marketCap || p.fdv || null,
          source: "pump.fun",
        });
        pfn++;
      });
      if (pfn) sourcesUsed.push("pump.fun-dex");
    }
  } catch (ePumpDex) {}

  // Dex profiles
  try {
    var dx = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
      headers: { Accept: "application/json", "User-Agent": ua },
    });
    if (dx.ok) {
      var dxData = await dx.json();
      var n = 0;
      (Array.isArray(dxData) ? dxData : []).forEach(function (row) {
        if ((row.chainId || "").toLowerCase() !== "solana") return;
        if (!isMint(row.tokenAddress)) return;
        addRow({
          mint: row.tokenAddress,
          address: row.tokenAddress,
          name: (row.description || row.tokenAddress || "").slice(0, 32),
          symbol: null,
          source: "dexscreener-realtime",
        });
        n++;
      });
      if (n) sourcesUsed.push("dex-profiles");
    }
  } catch (e1) {}

  // Dex search SOL
  try {
    var sq = await fetch("https://api.dexscreener.com/latest/dex/search?q=SOL", {
      headers: { Accept: "application/json", "User-Agent": ua },
    });
    if (sq.ok) {
      var sd = await sq.json();
      var pairs = (sd && sd.pairs) || [];
      var sn = 0;
      pairs.forEach(function (p) {
        if (!p || (p.chainId || "").toLowerCase() !== "solana") return;
        var mint = p.baseToken && p.baseToken.address;
        if (!isMint(mint) || STABLES[mint] || mint === WSOL) return;
        var created = toMs(p.pairCreatedAt);
        var ageMin = created != null ? (Date.now() - created) / 60000 : null;
        if (ageMin != null && ageMin > 120) return;
        addRow({
          mint: mint,
          address: mint,
          name: ((p.baseToken && (p.baseToken.symbol || p.baseToken.name)) || mint).slice(0, 32),
          symbol: (p.baseToken && p.baseToken.symbol) || null,
          created_timestamp: created,
          pairCreatedAt: created,
          ageMinutes: ageMin,
          liquidityUsd: p.liquidity && p.liquidity.usd != null ? Number(p.liquidity.usd) || 0 : 0,
          volume24h: p.volume ? Number(p.volume.h24 || p.volume.h6 || p.volume.h1 || 0) || 0 : 0,
          volume5m: p.volume ? Number(p.volume.m5 || 0) || 0 : 0,
          priceChange5m: p.priceChange ? Number(p.priceChange.m5 != null ? p.priceChange.m5 : 0) || 0 : 0,
          source: "dexscreener-search",
        });
        sn++;
      });
      if (sn) sourcesUsed.push("dex-search");
    }
  } catch (e3) {}

  // Sort by volume
  rows.sort(function (a, b) {
    var va = Number(a.volume5m || a.volume24h || 0);
    var vb = Number(b.volume5m || b.volume24h || 0);
    return vb - va;
  });

  headers["X-Feed-Source"] = sourcesUsed.join("+") || "multi";
  return new Response(JSON.stringify(rows.slice(0, limit)), { status: 200, headers: headers });
}
