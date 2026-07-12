const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./auth-util');

const DB_PATH = process.env.DB_PATH || './data/club.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member',        -- member | admin
  status TEXT NOT NULL DEFAULT 'invited',     -- invited | active | disabled
  invite_token TEXT,
  invite_expires INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL,
  flash TEXT
);

CREATE TABLE IF NOT EXISTS balances (
  user_id INTEGER NOT NULL REFERENCES users(id),
  pass_type TEXT NOT NULL,                    -- OFFPEAK | PEAK23 | PEAK14
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, pass_type)
);

CREATE TABLE IF NOT EXISTS pass_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pass_type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,                       -- purchase | booking | cancel_refund | admin_adjust
  ref TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pass_type TEXT NOT NULL,
  passes_qty INTEGER NOT NULL,
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  package_id INTEGER NOT NULL REFERENCES packages(id),
  pass_type TEXT NOT NULL,
  passes_qty INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,                       -- transfer | ecpay
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | cancelled
  merchant_trade_no TEXT UNIQUE,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  court INTEGER NOT NULL,                     -- 1..4
  date TEXT NOT NULL,                         -- YYYY-MM-DD
  hour INTEGER NOT NULL,                      -- 9..21
  pass_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',      -- booked | cancelled
  created_at TEXT DEFAULT (datetime('now','localtime')),
  cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slot ON bookings(court, date, hour) WHERE status = 'booked';

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
`);

// 舊資料庫升級：加入重設密碼欄位
try { db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN reset_expires INTEGER'); } catch {}

// helper: run several statements atomically
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function addPasses(userId, passType, delta, reason, ref) {
  db.prepare(`INSERT INTO balances (user_id, pass_type, qty) VALUES (?,?,?)
              ON CONFLICT(user_id, pass_type) DO UPDATE SET qty = qty + excluded.qty`)
    .run(userId, passType, delta);
  db.prepare('INSERT INTO pass_log (user_id, pass_type, delta, reason, ref) VALUES (?,?,?,?,?)')
    .run(userId, passType, delta, reason, String(ref || ''));
}

function balances(userId) {
  const b = { OFFPEAK: 0, PEAK23: 0, PEAK14: 0 };
  for (const r of db.prepare('SELECT pass_type, qty FROM balances WHERE user_id = ?').all(userId)) {
    b[r.pass_type] = Number(r.qty);
  }
  return b;
}

// ---------- seed ----------
(function seed() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  if (!db.prepare(`SELECT id FROM users WHERE role='admin'`).get()) {
    const pw = process.env.ADMIN_PASSWORD || 'change-me-now';
    db.prepare(`INSERT INTO users (email, name, password_hash, role, status)
                VALUES (?, '管理員', ?, 'admin', 'active')`)
      .run(adminEmail, hashPassword(pw));
    console.log(`[seed] 已建立管理員帳號 ${adminEmail}`);
  }

  if (!db.prepare('SELECT id FROM packages').get()) {
    const ins = db.prepare('INSERT INTO packages (name, pass_type, passes_qty, price, sort) VALUES (?,?,?,?,?)');
    ins.run('離峰單次券（平日17:00前・全場地）', 'OFFPEAK', 1, 700, 1);
    ins.run('離峰10次券（平日17:00前・全場地）', 'OFFPEAK', 10, 7000, 2);
    ins.run('尖峰單次券（2・3號場）', 'PEAK23', 1, 1000, 3);
    ins.run('尖峰10次券（2・3號場）', 'PEAK23', 10, 10000, 4);
    ins.run('尖峰單次券（1・4號場）', 'PEAK14', 1, 1200, 5);
    ins.run('尖峰10次券（1・4號場）', 'PEAK14', 10, 12000, 6);
    console.log('[seed] 已建立預設票券方案');
  }

  // 2026 平日國定假日（週末本來就算假日價）。來源：行政院人事行政總處 115 年辦公日曆表。
  if (!db.prepare('SELECT date FROM holidays').get()) {
    const H = {
      '2026-01-01': '元旦', '2026-01-02': '元旦彈性放假',
      '2026-02-16': '春節', '2026-02-17': '春節', '2026-02-18': '春節',
      '2026-02-19': '春節', '2026-02-20': '春節',
      '2026-02-27': '和平紀念日彈性放假',
      '2026-04-03': '兒童節', '2026-04-06': '清明節補假',
      '2026-05-01': '勞動節',
      '2026-06-19': '端午節',
      '2026-09-25': '中秋節', '2026-09-28': '教師節',
      '2026-10-09': '國慶日彈性放假',
      '2026-10-26': '光復節補假',
      '2026-12-25': '行憲紀念日'
    };
    const ins = db.prepare('INSERT INTO holidays (date, name) VALUES (?,?)');
    for (const [d, n] of Object.entries(H)) ins.run(d, n);
    console.log('[seed] 已載入 2026 國定假日');
  }
})();

module.exports = { db, tx, addPasses, balances };
