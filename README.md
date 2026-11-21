# ZeroMargin - Frontend (React + Vite)

Single-page app for ZeroMargin. Talks to the ZeroMargin backend API.

## Run locally
```bash
cp .env.example .env     # VITE_API_URL=http://localhost:5000
npm install
npm run dev              # http://localhost:5173
```

## Build
```bash
npm run build            # outputs dist/
```

`VITE_API_URL` is baked in at build time, so set it in your host's environment settings before deploying.
