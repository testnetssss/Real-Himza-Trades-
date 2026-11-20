# HiM Cooks — Cloudflare Pages (himza-trades)

## GitHub repo layout (must be at ROOT)
```
index.html
package.json
wrangler.toml
functions/
  api/
    pumpfun.js
    callouts.js
    telegram.js
    live-exec.js
```

## Cloudflare build settings (Production)
| Field | Value |
|-------|--------|
| Framework preset | None |
| Root directory | *(blank)* |
| Build command | *(blank)* |
| Build output directory | `/` |
| Deploy command | *(blank — never use `wrangler deploy`)* |

## Deploy
1. Push this folder to GitHub (files at repo root)
2. Workers & Pages → Create → Pages → Connect Git
3. Use settings above → Save → Deploy
4. Env vars (optional): TELEGRAM_BOT_TOKEN, LIVE_EXEC_SECRET, SOLANA_PRIVATE_KEY

## Test after deploy
- Site: https://himza-trades.pages.dev
- API: https://himza-trades.pages.dev/api/pumpfun?limit=3
