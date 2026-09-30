"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true"; // true dopiero za HTTPS
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/* ---------- Baza ---------- */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  insertUser: db.prepare("INSERT INTO users (email, name, password, created_at) VALUES (?, ?, ?, ?)"),
  insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
  sessionUser: db.prepare(`
    SELECT users.id, users.name, users.email FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
  purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
};
setInterval(() => q.purgeSessions.run(Date.now()), 60 * 60 * 1000).unref();

/* ---------- Hasła i sesje ---------- */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(":");
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
const DUMMY_HASH = hashPassword("nieistniejące-konto"); // wyrównuje czas odpowiedzi

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function getCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  q.insertSession.run(sha(token), userId, Date.now() + SESSION_MS);
  res.cookie("sid", token, { httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: SESSION_MS, path: "/" });
}
function currentUser(req) {
  const token = getCookie(req, "sid");
  return token ? q.sessionUser.get(sha(token), Date.now()) || null : null;
}

/* ---------- Aplikacja ---------- */
const app = express();
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "style-src": ["'self'", "https://fonts.googleapis.com"],
      "font-src": ["https://fonts.gstatic.com"],
      "upgrade-insecure-requests": null, // nie wymuszaj https na localhost
    },
  },
}));
app.use(express.json({ limit: "10kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Zbyt wiele prób. Spróbuj ponownie za kilkanaście minut." },
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const isEmail = (s) => typeof s === "string" && s.length <= 254 && /^\S+@\S+\.\S+$/.test(s);

app.get("/healthz", (req, res) => res.json({ status: "ok" })); // pod monitoring

app.get("/api/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ user: currentUser(req) });
});

app.post("/api/register", authLimiter, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!cleanName || cleanName.length > 40) return res.status(400).json({ error: "Podaj imię (maks. 40 znaków)." });
  if (!isEmail(cleanEmail)) return res.status(400).json({ error: "Podaj poprawny adres e-mail." });
  if (typeof password !== "string" || password.length < 8 || password.length > 128)
    return res.status(400).json({ error: "Hasło musi mieć od 8 do 128 znaków." });

  try {
    const info = q.insertUser.run(cleanEmail, cleanName, await hashPassword(password), Date.now());
    startSession(res, info.lastInsertRowid);
    res.status(201).json({ user: { id: info.lastInsertRowid, name: cleanName, email: cleanEmail } });
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE")
      return res.status(409).json({ error: "Konto z tym adresem już istnieje. Zaloguj się." });
    throw e;
  }
}));

app.post("/api/login", authLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const user = cleanEmail ? q.userByEmail.get(cleanEmail) : null;
  const ok = typeof password === "string" &&
    (await verifyPassword(password, user ? user.password : await DUMMY_HASH)) && !!user;

  if (!ok) return res.status(401).json({ error: "Nieprawidłowy e-mail lub hasło." });
  startSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
}));

app.post("/api/logout", (req, res) => {
  const token = getCookie(req, "sid");
  if (token) q.deleteSession.run(sha(token));
  res.clearCookie("sid", { path: "/" });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Nieprawidłowe dane." });
  console.error(err);
  res.status(500).json({ error: "Błąd serwera." });
});

app.listen(PORT, () => console.log(`Działa na http://localhost:${PORT}`));