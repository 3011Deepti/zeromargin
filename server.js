#!/usr/bin/env node
/**
 * ZeroMargin - zero-install full-stack edition
 * ---------------------------------------------------------------
 *  frontend : the same React app (prebuilt in ./public)
 *  backend  : this file - Node's built-in http server, no npm packages
 *  database : SQLite file at ./data/zeromargin.db (Node's built-in node:sqlite)
 *
 *  Run:   node server.js          (needs Node 22.13 or newer)
 *  Open:  http://localhost:3000
 *
 *  Options:  PORT=8080 node server.js      change the port
 *            node server.js --reset        wipe the database and reload the demo marketplace
 *
 * It exposes the same REST API as the Express/MongoDB backend in ../backend, so both editions
 * behave the same way. Live chat and alerts use Server-Sent Events instead of Socket.io.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
// node:sqlite works without any flag from Node 22.13 (and 23.4 / 24+)
if (!(major >= 24 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13))) {
  console.error(`ZeroMargin needs Node 22.13 or newer (you have ${process.versions.node}). Get it at https://nodejs.org`);
  process.exit(1);
}
// node:sqlite is still flagged "experimental" and prints a warning on import; keep the console clean
process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

// ---------------------------------------------------------------- helpers
const CATEGORIES = ['Electronics', 'Clothing', 'Furniture', 'Books', 'Home & Kitchen', 'Sports & Fitness', 'Other'];
const CONDITIONS = ['new', 'like_new', 'good', 'fair'];
const newId = () => crypto.randomBytes(12).toString('hex');
const iso = (t = Date.now()) => new Date(t).toISOString();
const ago = (hours) => iso(Date.now() - hours * 3600 * 1000);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------------------------------------------------------------- auth (HS256 JWT + scrypt passwords)
const secretFile = path.join(DATA, '.jwt-secret');
const JWT_SECRET = process.env.JWT_SECRET || (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8') : (() => {
  const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretFile, s, { mode: 0o600 }); return s;
})());
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
const signToken = (id) => {
  const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 14 * 86400 }))}`;
  return `${body}.${sign(body)}`;
};
const verifyToken = (token) => {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return null;
  const good = Buffer.from(sign(`${h}.${p}`)); const given = Buffer.from(s);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp * 1000 > Date.now() ? d.id : null; } catch { return null; }
};
const hashPassword = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const checkPassword = (pw, stored) => {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// ---------------------------------------------------------------- database
const db = new DatabaseSync(path.join(DATA, 'zeromargin.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    college TEXT DEFAULT '', city TEXT DEFAULT '', verified INTEGER DEFAULT 0, disputed INTEGER DEFAULT 0, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY, seller TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT DEFAULT '',
    price REAL NOT NULL, original_price REAL, suggested_price REAL, category TEXT DEFAULT 'Other', tags TEXT DEFAULT '[]',
    condition TEXT DEFAULT 'good', images TEXT DEFAULT '[]', city TEXT DEFAULT '', status TEXT DEFAULT 'available',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, listing TEXT NOT NULL REFERENCES listings(id), buyer TEXT NOT NULL REFERENCES users(id),
    seller TEXT NOT NULL REFERENCES users(id), price REAL NOT NULL, commission REAL DEFAULT 0, status TEXT DEFAULT 'placed',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, listing TEXT NOT NULL REFERENCES listings(id), buyer TEXT NOT NULL REFERENCES users(id),
    seller TEXT NOT NULL REFERENCES users(id), last_message TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (listing, buyer));
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id), sender TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, link TEXT DEFAULT '',
    read INTEGER DEFAULT 0, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wanted (
    id TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, category TEXT DEFAULT 'Other',
    keywords TEXT DEFAULT '[]', max_price REAL NOT NULL, active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_msgs ON messages(conversation, created_at);
  CREATE INDEX IF NOT EXISTS idx_notif ON notifications(user, created_at);
`);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a) || null;
const run = (sql, ...a) => db.prepare(sql).run(...a);
const insert = (table, row) => run(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row));

// ---------------------------------------------------------------- row -> JSON (same shapes the React app already expects)
const trustScore = (u) => { const t = u.verified + u.disputed; return t ? Math.round((u.verified / t) * 100) : null; };
const userJSON = (r, { email = false } = {}) => r && ({
  _id: r.id, name: r.name, ...(email ? { email: r.email } : {}), college: r.college, city: r.city,
  verifiedTrades: r.verified, disputedTrades: r.disputed, totalTrades: r.verified + r.disputed, trustScore: trustScore(r), createdAt: r.created_at,
});
const getUser = (id) => get('SELECT * FROM users WHERE id = ?', id);
const listingJSON = (r, populateSeller = true) => r && ({
  _id: r.id, seller: populateSeller ? userJSON(getUser(r.seller)) : r.seller, title: r.title, description: r.description, price: r.price,
  originalPrice: r.original_price ?? undefined, suggestedPrice: r.suggested_price ?? undefined, category: r.category,
  tags: JSON.parse(r.tags), condition: r.condition, images: JSON.parse(r.images), city: r.city, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const mini = (r, fields) => r && Object.fromEntries([['_id', r.id], ...fields.map((f) => [f, r[f]])]);
const messageJSON = (r) => ({ _id: r.id, conversation: r.conversation, sender: r.sender, text: r.text, createdAt: r.created_at });
const notifJSON = (r) => ({ _id: r.id, user: r.user, text: r.text, link: r.link, read: !!r.read, createdAt: r.created_at });
const orderJSON = (r) => {
  const l = get('SELECT * FROM listings WHERE id = ?', r.listing);
  const person = (id) => { const u = getUser(id); return { _id: u.id, name: u.name, verifiedTrades: u.verified, disputedTrades: u.disputed }; };
  return { _id: r.id, listing: l && { _id: l.id, title: l.title, images: JSON.parse(l.images), price: l.price, status: l.status },
    buyer: person(r.buyer), seller: person(r.seller), price: r.price, commission: r.commission, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
};
const convoJSON = (r, extra = {}) => {
  const l = get('SELECT * FROM listings WHERE id = ?', r.listing);
  const nm = (id) => ({ _id: id, name: getUser(id).name });
  return { _id: r.id, listing: { _id: l.id, title: l.title, images: JSON.parse(l.images), ...extra }, buyer: nm(r.buyer), seller: nm(r.seller),
    lastMessage: r.last_message, createdAt: r.created_at, updatedAt: r.updated_at };
};

// ---------------------------------------------------------------- live push (Server-Sent Events)
const streams = new Map(); // userId -> Set(res)
const push = (userId, event, data) => {
  for (const res of streams.get(userId) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
const notify = (userId, text, link = '') => {
  const row = { id: newId(), user: userId, text, link, read: 0, created_at: iso() };
  insert('notifications', row);
  push(userId, 'notification', notifJSON(row));
};

// ---------------------------------------------------------------- smart features: auto-tagging + fair pricing
const RULES = {
  Electronics: ['phone', 'iphone', 'laptop', 'macbook', 'tablet', 'ipad', 'headphone', 'headphones', 'earbud', 'earbuds', 'airpods', 'camera', 'charger', 'monitor', 'keyboard', 'mouse', 'speaker', 'console', 'playstation', 'xbox', 'calculator', 'router', 'smartwatch', 'watch', 'tv', 'kindle'],
  Clothing: ['shirt', 'tshirt', 't-shirt', 'jeans', 'jacket', 'hoodie', 'dress', 'kurta', 'saree', 'shoes', 'sneakers', 'boots', 'coat', 'sweater', 'bag', 'backpack', 'lehenga', 'skirt', 'top'],
  Furniture: ['table', 'chair', 'desk', 'sofa', 'couch', 'bed', 'mattress', 'shelf', 'bookshelf', 'wardrobe', 'cupboard', 'stool', 'drawer'],
  Books: ['book', 'textbook', 'novel', 'notes', 'guide', 'edition', 'manual', 'comic', 'magazine'],
  'Home & Kitchen': ['kettle', 'mixer', 'grinder', 'cooker', 'microwave', 'fridge', 'refrigerator', 'toaster', 'lamp', 'fan', 'heater', 'utensil', 'pan', 'bucket', 'curtain', 'iron'],
  'Sports & Fitness': ['bat', 'ball', 'racket', 'racquet', 'cycle', 'bicycle', 'dumbbell', 'yoga', 'gym', 'skates', 'football', 'cricket', 'badminton', 'treadmill'],
};
const tokenize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
const keywordsOf = (s) => tokenize(s).filter((w) => w.length > 2);
function categorize(title = '', description = '') {
  const words = tokenize(`${title} ${title} ${description}`); // title counts double
  let best = 'Other', bestScore = 0; const tags = new Set();
  for (const [cat, keys] of Object.entries(RULES)) {
    let score = 0;
    for (const w of words) if (keys.includes(w)) { score++; tags.add(w); }
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  return { category: best, tags: [...tags].slice(0, 6) };
}
const FACTOR = { new: 0.85, like_new: 0.7, good: 0.55, fair: 0.4 };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function suggestPrice({ title, category, condition = 'good', originalPrice }) {
  const kws = keywordsOf(title).map((k) => k.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const comps = all("SELECT title, price, category FROM listings WHERE status != 'sold'")
    .filter((l) => (!category || l.category === category) && kws.some((k) => new RegExp(`\\b${k}`, 'i').test(l.title)))
    .map((l) => l.price).filter((p) => p > 0);
  const signals = [];
  if (originalPrice > 0) signals.push(originalPrice * (FACTOR[condition] ?? 0.55));
  if (comps.length >= 3) signals.push(median(comps));
  if (!signals.length) return { suggested: null, low: null, high: null, basedOn: 0 };
  const mid = signals.reduce((a, b) => a + b, 0) / signals.length;
  const round = (n) => Math.max(1, Math.round(n / 10) * 10 || Math.round(n));
  return { suggested: round(mid), low: round(mid * 0.85), high: round(mid * 1.15), basedOn: comps.length };
}

// ---------------------------------------------------------------- smart matching (Wanted items <-> listings)
const hit = (kws, text) => !kws.length || kws.some((k) => text.includes(k));
function matchListingToWanted(l) {
  const wants = all('SELECT * FROM wanted WHERE active = 1 AND category = ? AND max_price >= ? AND user != ?', l.category, l.price, l.seller);
  const text = `${l.title} ${l.description}`.toLowerCase();
  for (const w of wants) {
    const kws = JSON.parse(w.keywords); const k = kws.length ? kws : keywordsOf(w.title);
    if (hit(k, text)) notify(w.user, `Match for your wanted item "${w.title}": ${l.title} at ₹${l.price}`, `/listing/${l.id}`);
  }
}
function matchWantedToListings(w) {
  const kws = JSON.parse(w.keywords).length ? JSON.parse(w.keywords) : keywordsOf(w.title);
  const listings = all("SELECT * FROM listings WHERE status = 'available' AND category = ? AND price <= ? AND seller != ? LIMIT 100", w.category, w.max_price, w.user);
  const sellers = new Set(), matches = [];
  for (const l of listings) {
    if (!hit(kws, `${l.title} ${l.description}`.toLowerCase())) continue;
    matches.push(l);
    if (sellers.has(l.seller)) continue;
    sellers.add(l.seller);
    notify(l.seller, `A buyer is looking for "${w.title}" (up to ₹${w.max_price}) - your listing "${l.title}" matches`, '/wanted');
  }
  for (const l of matches.slice(0, 3)) notify(w.user, `Match found: “${l.title}” was listed at ₹${l.price}, within your ₹${w.max_price} budget.`, `/listing/${l.id}`);
}

// ---------------------------------------------------------------- demo data (the marketplace shown in the demo video)
function seedDemo() {
  const pw = hashPassword('demo1234');
  const people = {};
  for (const [key, name, college, city, v, d, days] of [
    ['ananya', 'Ananya Sharma', 'IGDTUW', 'Delhi', 0, 0, 40], ['riya', 'Riya Verma', 'DTU', 'Delhi', 17, 1, 200],
    ['kabir', 'Kabir Singh', 'NSUT', 'Delhi', 14, 2, 150], ['meera', 'Meera Nair', 'IGDTUW', 'Delhi', 0, 0, 6], ['dev', 'Dev Malhotra', 'JMI', 'Noida', 8, 0, 90],
  ]) {
    people[key] = newId();
    insert('users', { id: people[key], name, email: `${key}@zeromargin.demo`, password: pw, college, city, verified: v, disputed: d, created_at: ago(days * 24) });
  }
  const mk = (title, price, category, condition, pic, seller, city, description, hours, status = 'available') => {
    const id = newId(), t = ago(hours);
    insert('listings', { id, seller: people[seller], title, description, price, category, tags: JSON.stringify(categorize(title, description).tags), condition, images: JSON.stringify([`/demo/${pic}.svg`]), city, status, created_at: t, updated_at: t });
    return id;
  };
  const kettle = mk('Philips electric kettle 1.5L', 650, 'Home & Kitchen', 'good', 'kettle', 'riya', 'Delhi', 'Works perfectly, auto shut-off. Bought last year, moving out of the hostel.', 3);
  mk('Engineering Mathematics, Kreyszig 10th ed.', 320, 'Books', 'good', 'book', 'kabir', 'Delhi', 'Light highlighting in the first three chapters. No torn pages.', 8);
  mk('Study desk with drawer', 2800, 'Furniture', 'good', 'desk', 'dev', 'Noida', 'Solid wood, 120 cm wide. Pickup only.', 20);
  mk('Casio fx-991EX scientific calculator', 700, 'Electronics', 'like_new', 'calc', 'riya', 'Delhi', 'Used for one semester. Cover included.', 26);
  mk('Denim jacket, size M', 900, 'Clothing', 'good', 'jacket', 'meera', 'Delhi', 'Classic fit, no fading.', 30);
  mk('Yonex badminton racquet', 850, 'Sports & Fitness', 'good', 'racquet', 'kabir', 'Delhi', 'Restrung last month. Comes with a cover.', 40);
  mk('Wireless over-ear headphones', 1200, 'Electronics', 'like_new', 'headphones', 'dev', 'Noida', '20 hours battery, original box and cable.', 52);
  mk('Hostel mini fridge 90L', 4500, 'Home & Kitchen', 'good', 'fridge', 'riya', 'Delhi', 'Cools well, quiet compressor.', 70);
  // the calculator Ananya already bought (reserved, so it is hidden from Browse)
  const bought = mk('Casio fx-991EX scientific calculator', 700, 'Electronics', 'like_new', 'calc', 'riya', 'Delhi', 'Used for one semester. Cover included.', 60, 'reserved');
  insert('orders', { id: newId(), listing: bought, buyer: people.ananya, seller: people.riya, price: 700, commission: 0, status: 'handed_off', created_at: ago(24), updated_at: ago(24) });
  const convo = newId();
  insert('conversations', { id: convo, listing: kettle, buyer: people.ananya, seller: people.riya, last_message: 'Yes it is! You can pick it up near the DTU main gate.', created_at: ago(1), updated_at: ago(50 / 60) });
  insert('messages', { id: newId(), conversation: convo, sender: people.ananya, text: 'Hi! Is the kettle still available?', created_at: ago(1) });
  insert('messages', { id: newId(), conversation: convo, sender: people.riya, text: 'Yes it is! You can pick it up near the DTU main gate.', created_at: ago(50 / 60) });
  for (const [key, title, category, max, hours] of [['kabir', 'Second-hand drafting kit', 'Other', 400, 5], ['meera', 'Compact study lamp', 'Home & Kitchen', 300, 2]])
    insert('wanted', { id: newId(), user: people[key], title, category, keywords: JSON.stringify(keywordsOf(title).slice(0, 6)), max_price: max, active: 1, created_at: ago(hours) });
  console.log('Loaded the demo marketplace. Log in as ananya@zeromargin.demo / demo1234');
}
if (process.argv.includes('--reset')) {
  for (const t of ['messages', 'conversations', 'notifications', 'orders', 'wanted', 'listings', 'users']) run(`DELETE FROM ${t}`);
}
if (get('SELECT COUNT(*) AS n FROM users').n === 0) seedDemo();

// ---------------------------------------------------------------- HTTP plumbing
const MAX_JSON = 100 * 1024, MAX_UPLOAD = 6 * 1024 * 1024;
const readBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const readJSON = async (req) => { const b = await readBody(req, MAX_JSON); try { return b.length ? JSON.parse(b) : {}; } catch { return fail(400, 'Invalid JSON'); } };
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const authUser = (req) => {
  const h = req.headers.authorization || '';
  const id = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  if (!h.startsWith('Bearer ')) fail(401, 'Please log in');
  if (!id) fail(401, 'Session expired, please log in again');
  return getUser(id) || fail(401, 'Account not found');
};

// light brute-force protection on login/register: 100 requests / 15 min / IP
const hits = new Map();
const rateLimited = (ip) => {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now); hits.set(ip, list);
  return list.length > 100;
};

// minimal multipart/form-data parser (one image file)
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.subarray(start + 2, next - 2); // strip CRLF around the part
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd !== -1) {
      const head = part.subarray(0, headEnd).toString('utf8');
      const name = /name="([^"]*)"/.exec(head)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      if (name === 'image') return { type, data: part.subarray(headEnd + 4) };
    }
    pos = next;
  }
  return null;
}
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const okImageUrl = (u) => typeof u === 'string' && /^(https?:\/\/|\/demo\/|\/uploads\/)/.test(u);

// ---------------------------------------------------------------- API routes
async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/', method = req.method, q = Object.fromEntries(url.searchParams);
  let m;

  if (p === '/health') return send(res, 200, { status: 'ok' });

  // ----- live stream (browser -> EventSource, token in the query string because EventSource cannot set headers)
  if (p === '/stream' && method === 'GET') {
    const uid = verifyToken(q.token);
    if (!uid || !getUser(uid)) return send(res, 401, { message: 'unauthorized' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    if (!streams.has(uid)) streams.set(uid, new Set());
    streams.get(uid).add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(beat); streams.get(uid)?.delete(res); });
    return;
  }

  // ----- auth
  if (p === '/auth/register' && method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) fail(429, 'Too many attempts, please try again later');
    const { name, email, password, college = '', city = '' } = await readJSON(req);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || (password || '').length < 6) fail(400, 'Name, a valid email and a password of 6+ characters are required');
    if (get('SELECT 1 FROM users WHERE email = ?', email.toLowerCase().trim())) fail(409, 'Email already registered');
    const id = newId();
    insert('users', { id, name: String(name).trim().slice(0, 60), email: email.toLowerCase().trim(), password: hashPassword(password), college: String(college).slice(0, 80), city: String(city).slice(0, 60), verified: 0, disputed: 0, created_at: iso() });
    return send(res, 201, { token: signToken(id), user: userJSON(getUser(id), { email: true }) });
  }
  if (p === '/auth/login' && method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) fail(429, 'Too many attempts, please try again later');
    const { email, password } = await readJSON(req);
    const u = get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase().trim());
    if (!u || !checkPassword(String(password || ''), u.password)) fail(401, 'Invalid email or password');
    return send(res, 200, { token: signToken(u.id), user: userJSON(u, { email: true }) });
  }
  if (p === '/auth/me' && method === 'GET') return send(res, 200, { user: userJSON(authUser(req), { email: true }) });

  // ----- users
  if ((m = p.match(/^\/users\/(\w+)$/)) && method === 'GET') {
    const u = getUser(m[1]); if (!u) fail(404, 'Not found');
    const rows = all("SELECT * FROM listings WHERE seller = ? AND status != 'sold' ORDER BY created_at DESC LIMIT 24", u.id);
    return send(res, 200, { user: userJSON(u), listings: rows.map((r) => listingJSON(r, false)) });
  }

  // ----- listings
  if (p === '/listings' && method === 'GET') {
    let rows = all("SELECT * FROM listings WHERE status = 'available'");
    if (q.q) { const re = new RegExp(esc(q.q), 'i'); rows = rows.filter((r) => re.test(r.title) || re.test(r.description) || re.test(r.tags)); }
    if (CATEGORIES.includes(q.category)) rows = rows.filter((r) => r.category === q.category);
    if (CONDITIONS.includes(q.condition)) rows = rows.filter((r) => r.condition === q.condition);
    if (q.city) rows = rows.filter((r) => r.city.toLowerCase() === q.city.toLowerCase());
    if (q.minPrice) rows = rows.filter((r) => r.price >= Number(q.minPrice));
    if (q.maxPrice) rows = rows.filter((r) => r.price <= Number(q.maxPrice));
    const by = { low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price }[q.sort] || ((a, b) => (a.created_at < b.created_at ? 1 : -1));
    rows.sort(by);
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(48, Math.max(1, Number(q.limit) || 12));
    return send(res, 200, { items: rows.slice((page - 1) * limit, page * limit).map((r) => listingJSON(r)), total: rows.length, page, pages: Math.ceil(rows.length / limit) });
  }
  if (p === '/listings/mine' && method === 'GET') {
    const u = authUser(req);
    return send(res, 200, all('SELECT * FROM listings WHERE seller = ? ORDER BY created_at DESC', u.id).map((r) => listingJSON(r, false)));
  }
  if (p === '/listings/categorize' && method === 'POST') { const b = await readJSON(req); return send(res, 200, categorize(b.title, b.description)); }
  if (p === '/listings/suggest-price' && method === 'POST') {
    const b = await readJSON(req);
    return send(res, 200, suggestPrice({ title: b.title, category: b.category, condition: b.condition, originalPrice: Number(b.originalPrice) || 0 }));
  }
  if (p === '/listings' && method === 'POST') {
    const u = authUser(req);
    const b = await readJSON(req);
    const { title, description = '', price, originalPrice, condition = 'good', images = [], city } = b;
    if (!title || price === '' || price == null || !(Number(price) >= 0)) fail(400, 'Title and price are required');
    const auto = categorize(title, description);
    const category = CATEGORIES.includes(b.category) ? b.category : auto.category;
    const cond = CONDITIONS.includes(condition) ? condition : 'good';
    const sp = suggestPrice({ title, category, condition: cond, originalPrice: Number(originalPrice) || 0 });
    const id = newId(), t = iso();
    insert('listings', {
      id, seller: u.id, title: String(title).trim().slice(0, 120), description: String(description).slice(0, 2000), price: Number(price),
      original_price: Number(originalPrice) || null, suggested_price: sp.suggested || null, category, tags: JSON.stringify(auto.tags), condition: cond,
      images: JSON.stringify((Array.isArray(images) ? images : []).filter(okImageUrl).slice(0, 5)), city: city || u.city, status: 'available', created_at: t, updated_at: t,
    });
    const row = get('SELECT * FROM listings WHERE id = ?', id);
    matchListingToWanted(row);
    return send(res, 201, listingJSON(row, false));
  }
  if ((m = p.match(/^\/listings\/(\w+)$/))) {
    if (method === 'GET') { const r = get('SELECT * FROM listings WHERE id = ?', m[1]); if (!r) fail(404, 'Listing not found'); return send(res, 200, listingJSON(r)); }
    const u = authUser(req);
    const r = get('SELECT * FROM listings WHERE id = ? AND seller = ?', m[1], u.id);
    if (!r) fail(404, 'Listing not found');
    if (method === 'DELETE') {
      if (get("SELECT 1 FROM orders WHERE listing = ? AND status IN ('placed','accepted','handed_off')", r.id)) fail(400, 'This listing has an open order, finish or cancel it first');
      run('DELETE FROM messages WHERE conversation IN (SELECT id FROM conversations WHERE listing = ?)', r.id);
      run('DELETE FROM conversations WHERE listing = ?', r.id);
      run('DELETE FROM orders WHERE listing = ?', r.id);
      run('DELETE FROM listings WHERE id = ?', r.id);
      return send(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const b = await readJSON(req);
      const next = { ...r, updated_at: iso() };
      for (const [k, col] of [['title', 'title'], ['description', 'description'], ['price', 'price'], ['condition', 'condition'], ['city', 'city']]) if (b[k] !== undefined) next[col] = b[k];
      if (CATEGORIES.includes(b.category)) next.category = b.category;
      run('UPDATE listings SET title=?, description=?, price=?, condition=?, city=?, category=?, updated_at=? WHERE id=?', next.title, next.description, Number(next.price), next.condition, next.city, next.category, next.updated_at, r.id);
      return send(res, 200, listingJSON(get('SELECT * FROM listings WHERE id = ?', r.id), false));
    }
  }

  // ----- orders: placed -> accepted -> handed_off -> completed | disputed
  if (p === '/orders' && method === 'POST') {
    const u = authUser(req);
    const { listingId } = await readJSON(req);
    const l = get('SELECT * FROM listings WHERE id = ?', listingId);
    if (!l || l.status !== 'available') fail(400, 'This item is no longer available');
    if (l.seller === u.id) fail(400, "You can't order your own listing");
    if (get("SELECT 1 FROM orders WHERE listing = ? AND buyer = ? AND status IN ('placed','accepted','handed_off')", l.id, u.id)) fail(409, 'You already have an open order for this item');
    const id = newId(), t = iso();
    insert('orders', { id, listing: l.id, buyer: u.id, seller: l.seller, price: l.price, commission: 0, status: 'placed', created_at: t, updated_at: t });
    notify(l.seller, `${u.name} placed an order for "${l.title}"`, '/orders');
    return send(res, 201, orderJSON(get('SELECT * FROM orders WHERE id = ?', id)));
  }
  if (p === '/orders/mine' && method === 'GET') {
    const u = authUser(req);
    return send(res, 200, all('SELECT * FROM orders WHERE buyer = ? OR seller = ? ORDER BY created_at DESC', u.id, u.id).map(orderJSON));
  }
  if ((m = p.match(/^\/orders\/(\w+)\/(accept|cancel|handoff|verify)$/)) && method === 'PATCH') {
    const u = authUser(req);
    const o = get('SELECT * FROM orders WHERE id = ?', m[1]);
    const setStatus = (s) => { run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', s, iso(), o.id); };
    const need = (role, from) => {
      if (!o || o[role] !== u.id) fail(404, 'Order not found');
      if (!from.includes(o.status)) fail(400, `Order is already ${o.status.replace('_', ' ')}`);
    };
    const l = o && get('SELECT * FROM listings WHERE id = ?', o.listing);
    if (m[2] === 'accept') {
      need('seller', ['placed']);
      if (!l || l.status !== 'available') fail(400, 'Item is no longer available');
      run("UPDATE listings SET status = 'reserved', updated_at = ? WHERE id = ?", iso(), l.id);
      setStatus('accepted');
      for (const other of all("SELECT * FROM orders WHERE listing = ? AND id != ? AND status = 'placed'", o.listing, o.id)) {
        run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", iso(), other.id);
        notify(other.buyer, `"${l.title}" was reserved for another buyer`, '/orders');
      }
      notify(o.buyer, `${u.name} accepted your order for "${l.title}". Use chat to arrange the hand-off.`, '/orders');
    } else if (m[2] === 'cancel') {
      if (!o || (o.buyer !== u.id && o.seller !== u.id)) fail(404, 'Order not found');
      if (!['placed', 'accepted'].includes(o.status)) fail(400, `Order is already ${o.status.replace('_', ' ')}`);
      if (o.status === 'accepted') run("UPDATE listings SET status = 'available', updated_at = ? WHERE id = ?", iso(), o.listing);
      setStatus('cancelled');
      notify(u.id === o.buyer ? o.seller : o.buyer, `${u.name} cancelled an order`, '/orders');
    } else if (m[2] === 'handoff') {
      need('seller', ['accepted']);
      setStatus('handed_off');
      notify(o.buyer, `${u.name} marked the hand-off done. Please confirm you received the item.`, '/orders');
    } else { // verify
      need('buyer', ['handed_off']);
      const verified = (await readJSON(req)).verified === true;
      setStatus(verified ? 'completed' : 'disputed');
      run(`UPDATE users SET ${verified ? 'verified = verified + 1' : 'disputed = disputed + 1'} WHERE id = ?`, o.seller);
      if (verified) run('UPDATE users SET verified = verified + 1 WHERE id = ?', o.buyer);
      run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', verified ? 'sold' : 'available', iso(), o.listing);
      notify(o.seller, verified ? 'Hand-off verified! Your trust score just went up.' : 'A buyer reported a problem with a hand-off.', '/orders');
    }
    return send(res, 200, orderJSON(get('SELECT * FROM orders WHERE id = ?', o.id)));
  }

  // ----- chat
  if (p === '/chat/conversations' && method === 'POST') {
    const u = authUser(req);
    const l = get('SELECT * FROM listings WHERE id = ?', (await readJSON(req)).listingId);
    if (!l) fail(404, 'Listing not found');
    if (l.seller === u.id) fail(400, "That's your own listing");
    let c = get('SELECT * FROM conversations WHERE listing = ? AND buyer = ?', l.id, u.id);
    if (!c) { const t = iso(); insert('conversations', { id: newId(), listing: l.id, buyer: u.id, seller: l.seller, last_message: '', created_at: t, updated_at: t }); c = get('SELECT * FROM conversations WHERE listing = ? AND buyer = ?', l.id, u.id); }
    return send(res, 200, convoJSON(c));
  }
  if (p === '/chat/conversations' && method === 'GET') {
    const u = authUser(req);
    return send(res, 200, all('SELECT * FROM conversations WHERE buyer = ? OR seller = ? ORDER BY updated_at DESC', u.id, u.id).map((c) => convoJSON(c)));
  }
  if ((m = p.match(/^\/chat\/conversations\/(\w+)\/messages$/))) {
    const u = authUser(req);
    const c = get('SELECT * FROM conversations WHERE id = ?', m[1]);
    if (!c || (c.buyer !== u.id && c.seller !== u.id)) fail(404, 'Conversation not found');
    if (method === 'GET') {
      const l = get('SELECT price FROM listings WHERE id = ?', c.listing);
      const msgs = all('SELECT * FROM messages WHERE conversation = ? ORDER BY created_at ASC LIMIT 300', c.id).map(messageJSON);
      return send(res, 200, { conversation: convoJSON(c, { price: l.price }), messages: msgs });
    }
    if (method === 'POST') {
      const text = String((await readJSON(req)).text || '').trim().slice(0, 1000);
      if (!text) fail(400, 'Empty message');
      const msg = { id: newId(), conversation: c.id, sender: u.id, text, created_at: iso() };
      insert('messages', msg);
      run('UPDATE conversations SET last_message = ?, updated_at = ? WHERE id = ?', text, msg.created_at, c.id);
      const out = messageJSON(msg);
      push(c.buyer, 'chat:message', out); push(c.seller, 'chat:message', out); // both sides see it live
      push(u.id === c.buyer ? c.seller : c.buyer, 'chat:ping', { conversation: c.id });
      return send(res, 201, out);
    }
  }

  // ----- wanted items
  if (p === '/wanted' && method === 'GET') {
    return send(res, 200, all('SELECT * FROM wanted WHERE active = 1 ORDER BY created_at DESC LIMIT 100').map((w) => ({
      _id: w.id, user: { _id: w.user, name: getUser(w.user).name }, title: w.title, category: w.category, keywords: JSON.parse(w.keywords), maxPrice: w.max_price, active: true, createdAt: w.created_at })));
  }
  if (p === '/wanted' && method === 'POST') {
    const u = authUser(req);
    const { title, maxPrice, category } = await readJSON(req);
    if (!title || !(Number(maxPrice) > 0)) fail(400, 'Title and max price are required');
    const id = newId();
    insert('wanted', { id, user: u.id, title: String(title).trim().slice(0, 120), category: CATEGORIES.includes(category) ? category : categorize(title).category, keywords: JSON.stringify(keywordsOf(title).slice(0, 6)), max_price: Number(maxPrice), active: 1, created_at: iso() });
    const w = get('SELECT * FROM wanted WHERE id = ?', id);
    matchWantedToListings(w);
    return send(res, 201, { _id: w.id, user: w.user, title: w.title, category: w.category, maxPrice: w.max_price });
  }
  if ((m = p.match(/^\/wanted\/(\w+)$/)) && method === 'DELETE') {
    const u = authUser(req);
    if (!get('SELECT 1 FROM wanted WHERE id = ? AND user = ?', m[1], u.id)) fail(404, 'Not found');
    run('DELETE FROM wanted WHERE id = ?', m[1]);
    return send(res, 200, { ok: true });
  }

  // ----- notifications
  if (p === '/notifications' && method === 'GET') {
    const u = authUser(req);
    const items = all('SELECT * FROM notifications WHERE user = ? ORDER BY created_at DESC LIMIT 50', u.id).map(notifJSON);
    return send(res, 200, { items, unread: items.filter((n) => !n.read).length });
  }
  if (p === '/notifications/read-all' && method === 'POST') {
    run('UPDATE notifications SET read = 1 WHERE user = ? AND read = 0', authUser(req).id);
    return send(res, 200, { ok: true });
  }

  // ----- image upload (stored on disk in ./data/uploads, no Cloudinary needed)
  if (p === '/upload/status' && method === 'GET') return send(res, 200, { enabled: true });
  if (p === '/upload' && method === 'POST') {
    authUser(req);
    const body = await readBody(req, MAX_UPLOAD);
    const file = parseMultipart(body, req.headers['content-type']);
    if (!file || !IMG_EXT[file.type]) fail(400, 'Please upload an image file (JPG, PNG, WebP or GIF)');
    if (file.data.length > 5 * 1024 * 1024) fail(413, 'Image is larger than 5 MB');
    const name = `${newId()}.${IMG_EXT[file.type]}`;
    fs.writeFileSync(path.join(UPLOADS, name), file.data);
    return send(res, 200, { url: `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/uploads/${name}` });
  }

  fail(404, 'Not found');
}

// ---------------------------------------------------------------- static files + server
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain' };
function serveFile(res, file, cache) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}
function serveStatic(req, res, url) {
  const isUpload = url.pathname.startsWith('/uploads/');
  const base = isUpload ? UPLOADS : PUBLIC;
  const rel = decodeURIComponent(isUpload ? url.pathname.slice('/uploads/'.length) : url.pathname);
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) { res.writeHead(403); return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, isUpload ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (isUpload || path.extname(rel)) { res.writeHead(404); return res.end('Not found'); }
  serveFile(res, path.join(PUBLIC, 'index.html'), 'no-cache'); // single-page app: /browse, /listing/123 ... open index.html
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { message: e.message });
      console.error(e); send(res, 500, { message: 'Something went wrong' });
    }
    return;
  }
  try { serveStatic(req, res, url); } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
});
server.listen(PORT, HOST, () => {
  console.log(`\n  ZeroMargin is running  ->  http://localhost:${PORT}\n  Database: ${path.join(DATA, 'zeromargin.db')}\n  Demo login: ananya@zeromargin.demo / demo1234\n`);
});
