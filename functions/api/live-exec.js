/**
 * Cloudflare Pages Function — POST /api/live-exec
 * Silent hot-wallet swaps via Jupiter.
 * Env: SOLANA_PRIVATE_KEY, LIVE_EXEC_SECRET, SOLANA_RPC_URL (optional)
 *
 * Requires: npm install && wrangler pages deploy (bundles @solana/web3.js)
 */
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const SOL_MINT = "So11111111111111111111111111111111111111112";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Exec-Secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function loadKeypair(env) {
  const raw = (env.SOLANA_PRIVATE_KEY || "").trim();
  if (!raw) throw new Error("SOLANA_PRIVATE_KEY not set in Cloudflare env");
  if (raw.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function jupiterSwap(keypair, inputMint, outputMint, amount, slippageBps, env) {
  const quoteUrl =
    "https://quote-api.jup.ag/v6/quote?inputMint=" +
    encodeURIComponent(inputMint) +
    "&outputMint=" +
    encodeURIComponent(outputMint) +
    "&amount=" +
    amount +
    "&slippageBps=" +
    (slippageBps || 250);

  const quoteRes = await fetch(quoteUrl, { cache: "no-store" });
  if (!quoteRes.ok) throw new Error("Jupiter quote HTTP " + quoteRes.status);
  const quote = await quoteRes.json();
  if (!quote || quote.error || !quote.outAmount) {
    throw new Error((quote && (quote.error || quote.message)) || "No Jupiter route");
  }

  const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  if (!swapRes.ok) throw new Error("Jupiter swap build failed");
  const swapJson = await swapRes.json();
  if (!swapJson.swapTransaction) throw new Error("No swapTransaction");

  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapJson.swapTransaction, "base64")
  );
  tx.sign([keypair]);

  const rpc = env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  try {
    await conn.confirmTransaction(sig, "confirmed");
  } catch (_) {}
  return { signature: sig, outAmount: quote.outAmount };
}

async function getBalance(keypair, env) {
  const rpc = env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const lamports = await conn.getBalance(keypair.publicKey, "confirmed");
  return lamports / 1e9;
}

async function sellAllToken(keypair, mint, env) {
  const rpc = env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const accounts = await conn.getParsedTokenAccountsByOwner(keypair.publicKey, {
    mint: new PublicKey(mint),
  });
  if (!accounts.value.length) throw new Error("No token account");
  let raw = 0;
  accounts.value.forEach(function (a) {
    const amt = parseInt(a.account.data.parsed.info.tokenAmount.amount, 10) || 0;
    if (amt > raw) raw = amt;
  });
  if (!raw) throw new Error("Zero token balance");
  return jupiterSwap(keypair, mint, SOL_MINT, raw, 250, env);
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return json(405, { error: "POST only" });
  }

  try {
    const secret = (env.LIVE_EXEC_SECRET || "").trim();
    if (!secret) {
      return json(503, {
        error: "LIVE_EXEC_SECRET not configured",
        hint: "Set LIVE_EXEC_SECRET + SOLANA_PRIVATE_KEY in Cloudflare Pages env",
      });
    }
    const provided = (request.headers.get("x-exec-secret") || "") + "";
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      return json(400, { error: "Invalid JSON" });
    }
    const bodySecret = (body.secret || "") + "";
    if (provided !== secret && bodySecret !== secret) {
      return json(401, { error: "Unauthorized" });
    }

    const action = (body.action || "").toLowerCase();
    const keypair = loadKeypair(env);
    const pubkey = keypair.publicKey.toBase58();

    if (action === "status" || action === "balance") {
      const bal = await getBalance(keypair, env);
      return json(200, { ok: true, publicKey: pubkey, balanceSol: bal, silent: true });
    }

    if (action === "buy") {
      const mint = body.mint;
      const sol = Number(body.amountSol || 0);
      if (!mint || sol <= 0) return json(400, { error: "mint and amountSol required" });
      const lamports = Math.floor(sol * 1e9);
      const bal = await getBalance(keypair, env);
      if (bal < sol + 0.004) {
        return json(400, { error: "Insufficient hot-wallet SOL", balanceSol: bal });
      }
      const result = await jupiterSwap(keypair, SOL_MINT, mint, lamports, body.slippageBps || 250, env);
      const balAfter = await getBalance(keypair, env);
      return json(200, {
        ok: true,
        action: "buy",
        mint,
        signature: result.signature,
        publicKey: pubkey,
        balanceSol: balAfter,
      });
    }

    if (action === "sell") {
      const mint = body.mint;
      if (!mint) return json(400, { error: "mint required" });
      const result = await sellAllToken(keypair, mint, env);
      const balAfter = await getBalance(keypair, env);
      return json(200, {
        ok: true,
        action: "sell",
        mint,
        signature: result.signature,
        publicKey: pubkey,
        balanceSol: balAfter,
      });
    }

    return json(400, { error: "Unknown action. Use status|buy|sell" });
  } catch (err) {
    return json(500, { error: (err && err.message) || "live-exec failed" });
  }
}
