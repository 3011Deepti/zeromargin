# Deploy ZeroMargin and push it to GitHub

Order matters: **database → backend → frontend → connect them**. All services have free tiers.

## 1. Put the code on your GitHub (two repos)

Create two EMPTY repos on https://github.com/new named `zeromargin-backend` and `zeromargin-frontend` (no README, no .gitignore). Then:

```bash
cd backend
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/zeromargin-backend.git
git push -u origin main

cd ../frontend
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/zeromargin-frontend.git
git push -u origin main
```
(If you prefer one repo, run the same commands once from the top-level folder instead. Vercel and Render both support a "root directory" setting.)

## 2. Database - MongoDB Atlas
1. Sign up at https://www.mongodb.com/atlas → create a free **M0** cluster.
2. **Database Access** → add a user (username + password).
3. **Network Access** → add IP `0.0.0.0/0` (Render's IPs change).
4. **Connect → Drivers** → copy the connection string, replace `<password>`, and add a DB name:
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/zeromargin?retryWrites=true&w=majority`

## 3. Backend - Render
1. https://render.com → **New → Web Service** → connect `zeromargin-backend`.
2. Runtime **Node**, Build command `npm install`, Start command `npm start`, instance type **Free**.
3. Environment variables:
   - `MONGO_URI` = your Atlas string
   - `JWT_SECRET` = any long random string
   - `CLIENT_URL` = (leave a placeholder for now, e.g. `http://localhost:5173`; you'll update it in step 5)
   - optional `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
4. Deploy. Open `https://<your-service>.onrender.com/api/health`: it should return `{"status":"ok"}`.
   Note: the free tier sleeps after ~15 min idle; the first request then takes ~30 s.
5. (Optional) seed the demo data from your own machine: put the Atlas string in `backend/.env`, run `npm run seed`. Demo login: `ananya@zeromargin.demo` / `demo1234`.

## 4. Frontend - Vercel
1. https://vercel.com → **Add New → Project** → import `zeromargin-frontend`. Framework preset: **Vite**.
2. Environment variable: `VITE_API_URL` = `https://<your-service>.onrender.com` (no trailing slash).
3. Deploy. Your live link will be `https://<project>.vercel.app`.
   (Netlify works too: build `npm run build`, publish `dist`; the `_redirects` file is already included.)

## 5. Connect them
Back in Render → backend service → Environment → set `CLIENT_URL` to your Vercel URL (e.g. `https://zeromargin.vercel.app`, no trailing slash; comma-separate if you add a custom domain) → save (it redeploys).

## 6. Verify
Open the Vercel link → register two accounts (use a private window for the second) → list an item → order it → accept → chat → hand-off → confirm. The trust score should update.

## Troubleshooting
- **"Cannot reach the server"** → wrong `VITE_API_URL`, or Render is waking up. Redeploy Vercel after changing env vars.
- **CORS error in console** → `CLIENT_URL` doesn't exactly match the Vercel URL (check https and trailing slash).
- **Chat not live** → same `CLIENT_URL` issue; Socket.io uses the same origin check.
- **Backend crashes on start** → `MONGO_URI` wrong or Atlas IP allowlist missing `0.0.0.0/0`.
