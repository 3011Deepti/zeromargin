# ZeroMargin - Backend (Node.js + Express + MongoDB)

REST API + Socket.io server for ZeroMargin, a peer-to-peer resale marketplace with 0% commission.

## Features
- JWT auth (register / login), bcrypt-hashed passwords
- Listings with auto category tagging, search, filters, pagination
- Fair-pricing engine (`src/utils/pricing.js`)
- Orders: placed → accepted → handed off → verified/disputed
- Trust score = verified hand-offs ÷ completed orders
- "Wanted Item" alerts that notify matching sellers (and buyers when a match is listed)
- Real-time chat via Socket.io (no phone numbers stored)
- Optional Cloudinary image uploads

## Run locally
```bash
cp .env.example .env     # fill in MONGO_URI and JWT_SECRET
npm install
npm run seed             # optional demo data
npm run dev              # http://localhost:5000
```
Needs Node 18+ and a MongoDB (local, or free MongoDB Atlas).

## Environment variables
| Name | Required | Notes |
|---|---|---|
| `MONGO_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | long random string |
| `CLIENT_URL` | yes | frontend origin(s), comma-separated, no trailing slash |
| `PORT` | no | Render sets this automatically |
| `CLOUDINARY_*` | no | enables photo upload |

## API overview
`/api/auth` · `/api/listings` · `/api/orders` · `/api/chat` · `/api/wanted` · `/api/notifications` · `/api/users/:id` · `/api/upload` · `/api/health`
