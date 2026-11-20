/**
 * Cloudflare Pages Function — POST /api/telegram
 */
export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  var token = env.TELEGRAM_BOT_TOKEN || "";
  var defaultChat = env.TELEGRAM_CHAT_ID || "";

  try {
    var body = await request.json().catch(function () { return {}; });
    var chatId = String(body.chatId || defaultChat || "").trim();
    var text = String(body.text || "").trim();
    var botToken = String(body.token || token || "").trim();

    if (!botToken || !chatId || !text) {
      return new Response(
        JSON.stringify({
          error: "Missing token, chatId, or text",
          hint: "Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in Cloudflare env",
        }),
        { status: 400, headers }
      );
    }

    if (text.length > 3500) text = text.slice(0, 3500) + "…";

    var tgUrl = "https://api.telegram.org/bot" + encodeURIComponent(botToken) + "/sendMessage";
    var res = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true,
      }),
    });
    var data = await res.json();
    if (!res.ok || !data.ok) {
      return new Response(JSON.stringify({ error: "Telegram API failed", detail: data }), { status: 502, headers });
    }
    return new Response(
      JSON.stringify({ ok: true, message_id: data.result && data.result.message_id }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err && err.message) || "telegram failed" }),
      { status: 500, headers }
    );
  }
}
