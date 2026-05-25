# 1k2rich.com

The public landing page for **1K2RICH / "A Thousand to Riches" / @1k2rich** — a public trading journal of a $1,000 bankroll traded by a QQQ low-DTE options bot on Alpaca.

Live at: https://1k2rich.com (when domain is wired up)
Deployed via: Vercel (auto-deploy on push to `main`)

## Stack

- Static HTML + CSS. No build step.
- Hosted on Vercel.
- Brand assets in `brand/` (drop the dark `1K` wordmark and `?` PNGs there from the source folder).

## Design language

Black background. White type. Surgical contrast. No gradients, no glass.
Space Grotesk for display, JetBrains Mono for utility text.

## Develop locally

```bash
python3 -m http.server 4173
# open http://localhost:4173
```

## Deploying

Push to `main`. Vercel picks it up and redeploys.

## Not investment advice

This is a public journal. Read the full disclaimer in the page footer.
