# ZeroMargin

A peer-to-peer resale marketplace with **0% commission**. Sellers keep 100% of every sale, and trust is
earned through verified hand-offs instead of being bought.

| Layer | Tech | Folder |
|---|---|---|
| Frontend | React 18 + Vite, React Router | `frontend/` |
| Backend | Node.js, Express, Socket.io (real-time chat), JWT auth | `backend/` |
| Database | MongoDB (Mongoose), or SQLite in the zero-install edition | runs in Docker, or use MongoDB Atlas |

## Features
- **Zero-fee marketplace:** browse, search and filter by category, price, condition and sort order
- **Auto-tagging:** the category is detected from the item title while you type
- **Fair-pricing engine:** suggests a price from the item's condition and similar listings
- **Wanted items + smart matching:** post what you need and get alerted when a match exists or is listed
- **Real-time chat:** Socket.io chat between buyer and seller, phone numbers stay private
- **Order flow:** place → seller accepts → seller hands over → buyer confirms
- **Trust score:** `verified hand-offs ÷ completed orders`, updated automatically on every confirmed hand-off
- Responsive on phones and desktops

## Two ways to run it
| | **Zero-install edition** (`standalone/`) | **Express + MongoDB edition** (`backend/` + `frontend/`) |
|---|---|---|
| Needs | Node 22.13+ only | Docker, or Node + MongoDB |
| Backend | built-in Node server | Express + Socket.io |
| Database | SQLite file | MongoDB |
| Status | **run and tested end to end in a browser** | code reviewed and syntax-checked; not run in the environment it was written in |

Both have the same screens, the same API and the same demo data. **Start with the zero-install edition.**

### Option A: zero-install edition (recommended)
```bash
cd standalone
node server.js
```
Open **http://localhost:3000** and log in as `ananya@zeromargin.demo` / `demo1234`. Details in [`standalone/README.md`](standalone/README.md).

### Option B: Express + MongoDB with Docker (one command)
Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Open **http://localhost:5173**. On the first start the backend fills the database with the demo marketplace
(the same data as in the demo video). Data is kept in a Docker volume; reset it with `docker compose down -v`.

### Option C: Express + MongoDB without Docker
Needs Node 18+ and MongoDB (local, or a free [Atlas](https://www.mongodb.com/atlas) cluster).

```bash
# terminal 1 - API
cd backend
cp .env.example .env        # set MONGO_URI and JWT_SECRET
npm install
npm run seed                # loads the demo marketplace
npm run dev                 # http://localhost:5000

# terminal 2 - website
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:5173
```

## Demo accounts
Everyone uses the password **`demo1234`**.

| Account | Role in the demo |
|---|---|
| `ananya@zeromargin.demo` | the buyer/seller used in the video (has one order waiting for confirmation and a chat) |
| `riya@zeromargin.demo` | seller, 94% trust |
| `kabir@zeromargin.demo` | seller, 88% trust |
| `dev@zeromargin.demo` | seller, 100% trust |
| `meera@zeromargin.demo` | new member |

`npm run seed` resets only these demo accounts and their data; it is safe to run again.

## Try the demo-video flow
1. **Home:** drag the slider in *The middleman tax* to compare 10–20% fees with 0%.
2. **Browse:** filter to *Electronics*, sort *Price: low to high*, open the Casio calculator, and check the seller's trust badge.
3. **Sell** (log in as Ananya): type *Prestige mixer grinder 750W*; the category is auto-tagged *Home & Kitchen*.
   Enter an original price of `2400` to get the fair-price suggestion, click **Use this**, and paste the image URL
   `http://localhost:5173/demo/mixer.svg`, then **Publish listing**.
4. **Wanted:** post *Scientific calculator*, max `800`, then open **Alerts** to see the match.
5. **Chat:** open the existing chat with Riya and send a message. To see the live reply, log in as Riya in a private window.
6. **Orders:** click **Yes, I received it**. Riya's trust score rises from 94% to 95%.

## Project structure
```
standalone/          zero-install edition: server.js (Node + SQLite) + prebuilt frontend in public/
backend/
  src/
    server.js        HTTP server + Socket.io
    app.js           Express app, CORS, rate limits, routes
    models/          User, Listing, Order, Conversation, Message, Notification, Wanted
    routes/          auth, listings, orders, chat, wanted, notifications, users, upload
    services/        chat, matching (smart alerts), notify
    utils/           categorize (auto-tagging), pricing (fair-price engine)
    seed.js          demo data
frontend/
  src/pages/         Home, Browse, ListingDetail, Sell, Wanted, Orders, Chat, Notifications, Profile, Login/Register
  public/demo/       product illustrations used by the demo data
docker-compose.yml   frontend + backend + MongoDB
```

## Deploy online
See [`DEPLOY.md`](DEPLOY.md): MongoDB Atlas (database) → Render (backend) → Vercel (frontend), all on free tiers.
Run `npm run seed` once against your Atlas database if you want the demo data online too.

*Built by Team Binary Brains, IGDTUW.*
