# ZeroMargin: zero-install edition

The complete website (frontend + backend + database) in one folder. **No `npm install`, no MongoDB, no Docker.**

| Layer | What it is |
|---|---|
| Frontend | the same React app as `../frontend`, prebuilt in `public/` |
| Backend | `server.js`: Node's built-in HTTP server, REST API, login tokens, live chat and alerts |
| Database | SQLite file `data/zeromargin.db` (created on first run, filled with the demo marketplace) |

## Run
You only need **Node 22.13 or newer** ([nodejs.org](https://nodejs.org); check with `node -v`).

```bash
cd standalone
node server.js
```

Open **http://localhost:3000** and log in as `ananya@zeromargin.demo` / `demo1234`
(other demo members: `riya`, `kabir`, `meera`, `dev` @zeromargin.demo, same password).

| Command | What it does |
|---|---|
| `node server.js` | start the site |
| `PORT=8080 node server.js` | use another port (on Windows PowerShell: `$env:PORT=8080; node server.js`) |
| `node server.js --reset` | wipe the database and reload the demo marketplace |

Everything you create (accounts, listings, photos, chats, orders) is stored in `standalone/data/`. Delete that folder to start fresh.

## What works
Everything in the demo video, against a real database:
- accounts: register, log in (passwords hashed with scrypt, signed 14-day login tokens)
- Browse with search, category, condition, price and sort filters
- Sell: auto-tagged category, fair-price suggestion, **photo upload** (saved on the server) or pasted image links
- Wanted items with smart matching alerts for buyers and sellers
- Orders: place → seller accepts → seller hands over → buyer confirms, with the **trust score updating** on every verified hand-off
- Real-time chat and alert badges between users (Server-Sent Events). Open a second browser or private window, log in as another member, and watch messages arrive live
- Responsive layout for phones and desktops

## How it was tested
`server.js` was run for real and driven through a browser (Playwright) with several accounts at once: registration, duplicate and wrong-password errors,
auto-tagging, fair price, photo upload, wanted alerts, two-person live chat, the full order lifecycle, trust scores, deleting a listing, permission checks
(a stranger cannot confirm someone else's order or delete someone else's listing) and mobile layouts. All checks passed.

## Put it online
It is a normal Node web service: any host that runs Node 22.13+ works (Render, Railway, Fly.io, a VPS).
Start command `node server.js`; the host's `PORT` is picked up automatically.
Note that free hosting plans usually have a temporary disk, so the database resets on every redeploy.
Attach a persistent disk and set `DATA_DIR` to its path, or use the MongoDB edition in `../backend` (see `../DEPLOY.md`).
Set `JWT_SECRET` to a long random value in production.

## Rebuilding the frontend (only if you edit `../frontend/src`)
`frontend-build/build.sh` bundles the React source into `public/` (needs [Bun](https://bun.sh) and npm).
It swaps in two tiny files from `frontend-build/`: a router and a live-updates client based on Server-Sent Events instead of Socket.io.

## Differences from the Express + MongoDB edition
Same REST API and screens. Here, live updates use Server-Sent Events instead of Socket.io, photo uploads are stored on disk instead of Cloudinary,
and the database is SQLite instead of MongoDB.
