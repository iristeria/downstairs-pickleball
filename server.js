// 樓下匹克球俱樂部 — 私人會員預約系統
// 零外部套件：Node 22+（內建 node:sqlite）
process.env.TZ = 'Asia/Taipei';

// 讀取 .env（簡易版，不需 dotenv）
const fs = require('node:fs');
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const http = require('node:http');
const path = require('node:path');
const { db, tx, addPasses, balances } = require('./src/db');
const { hashPassword, verifyPassword, token } = require('./src/auth-util');
const P = require('./src/pricing');
const ecpay = require('./src/ecpay');
const V = require('./src/html');
const mailer = require('./src/mailer');

const PORT = +(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = BASE_URL.startsWith('https');
const BANK_INFO = process.env.BANK_INFO || '請聯絡客服取得轉帳資訊';
const WINDOW_DAYS = +(process.env.BOOKING_WINDOW_DAYS || 30);

// ---------- sessions ----------
const SESSION_DAYS = 14;
function createSession(res, userId) {
  const t = token(24);
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)')
    .run(t, userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie',
    `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${SECURE ? '; Secure' : ''}`);
}
function destroySession(req, res) {
  const sid = getCookie(req, 'sid');
  if (sid) db.prepare('DELETE FROM sessions WHERE token=?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
}
function getCookie(req, name) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function currentSession(req) {
  const sid = getCookie(req, 'sid');
  if (!sid) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(sid);
  if (!s || Number(s.expires) < Date.now()) return null;
  return s;
}
function setFlash(session, msg) {
  if (session) db.prepare('UPDATE sessions SET flash=? WHERE token=?').run(msg, session.token);
}
function takeFlash(session) {
  if (!session || !session.flash) return '';
  db.prepare('UPDATE sessions SET flash=NULL WHERE token=?').run(session.token);
  return session.flash;
}

// ---------- helpers ----------
function parseBody(req, cb) {
  let data = '';
  req.on('data', d => { data += d; if (data.length > 1e6) req.destroy(); });
  req.on('end', () => {
    const body = {};
    for (const [k, v] of new URLSearchParams(data)) body[k] = v;
    cb(body);
  });
}
function html(res, code, str) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
  res.end(str);
}
function redirect(res, loc) {
  res.writeHead(302, { Location: loc });
  res.end();
}
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

// login rate limit（每 IP 15 分鐘 10 次失敗）
const fails = new Map();
function tooMany(ip) {
  const a = fails.get(ip);
  if (!a) return false;
  if (Date.now() - a.ts > 15 * 60e3) { fails.delete(ip); return false; }
  return a.n >= 10;
}

// ---------- static ----------
const PUB = path.join(__dirname, 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUB, pathname));
  if (!file.startsWith(PUB)) return false;
  let data;
  try { data = fs.readFileSync(file); } catch { return false; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
  res.end(data);
  return true;
}

// ---------- route table ----------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[a-z]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
}

// ============ public ============
route('GET', '/', (ctx) => {
  if (ctx.user) return redirect(ctx.res, ctx.user.role === 'admin' ? '/admin' : '/app');
  html(ctx.res, 200, V.landing({ flash: ctx.flash }));
});

route('POST', '/login', (ctx) => {
  const ip = ctx.req.socket.remoteAddress || '?';
  if (tooMany(ip)) return html(ctx.res, 429, V.landing({ error: '嘗試次數過多，請 15 分鐘後再試', openLogin: true }));
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || user.status === 'disabled' || !user.password_hash || !verifyPassword(ctx.body.password, user.password_hash)) {
    const a = fails.get(ip) || { n: 0, ts: Date.now() };
    a.n++; a.ts = Date.now(); fails.set(ip, a);
    return html(ctx.res, 401, V.landing({ error: '帳號或密碼錯誤', openLogin: true }));
  }
  if (user.status === 'invited') return html(ctx.res, 401, V.landing({ error: '帳號尚未完成開通，請使用邀請連結設定密碼', openLogin: true }));
  createSession(ctx.res, user.id);
  redirect(ctx.res, user.role === 'admin' ? '/admin' : '/app');
});

route('POST', '/logout', (ctx) => { destroySession(ctx.req, ctx.res); redirect(ctx.res, '/'); });

route('GET', '/forgot', (ctx) => html(ctx.res, 200, V.forgot({ mailerOn: mailer.enabled() })));

route('POST', '/forgot', async (ctx) => {
  if (!mailer.enabled()) return html(ctx.res, 200, V.forgot({ mailerOn: false }));
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const u = db.prepare(`SELECT * FROM users WHERE email=? AND status='active'`).get(email);
  if (u) {
    const t = token(24);
    db.prepare('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?')
      .run(t, Date.now() + 2 * 3600e3, Number(u.id));
    const m = mailer.resetEmail(u.name, `${BASE_URL}/reset/${t}`, process.env.SERVICE_EMAIL || '');
    await mailer.send(email, m.subject, m.html);
  }
  // 不透露帳號是否存在
  html(ctx.res, 200, V.forgot({ mailerOn: true, sent: true }));
});

route('GET', '/reset/:token', (ctx) => {
  const u = db.prepare('SELECT * FROM users WHERE reset_token=?').get(ctx.params.token);
  if (!u || Number(u.reset_expires) < Date.now()) return html(ctx.res, 400, V.errorPage(400, '連結無效或已過期，請重新申請'));
  html(ctx.res, 200, V.setpass({ mode: 'reset', name: u.name }));
});

route('POST', '/reset/:token', (ctx) => {
  const u = db.prepare('SELECT * FROM users WHERE reset_token=?').get(ctx.params.token);
  if (!u || Number(u.reset_expires) < Date.now()) return html(ctx.res, 400, V.errorPage(400, '連結無效或已過期，請重新申請'));
  const pw = String(ctx.body.password || '');
  if (pw.length < 8 || pw !== ctx.body.password2) {
    return html(ctx.res, 400, V.setpass({ mode: 'reset', name: u.name, error: '密碼至少 8 碼，且兩次輸入需相同' }));
  }
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?')
    .run(hashPassword(pw), Number(u.id));
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(u.id)); // 登出所有裝置
  html(ctx.res, 200, V.landing({ openLogin: true, flash: '密碼已更新，請重新登入' }));
});

route('GET', '/invite/:token', (ctx) => {
  const u = db.prepare('SELECT * FROM users WHERE invite_token=?').get(ctx.params.token);
  if (!u || Number(u.invite_expires) < Date.now()) return html(ctx.res, 400, V.errorPage(400, '邀請連結無效或已過期，請聯絡俱樂部重新發送'));
  html(ctx.res, 200, V.setpass({ mode: 'invite', name: u.name }));
});

route('POST', '/invite/:token', (ctx) => {
  const u = db.prepare('SELECT * FROM users WHERE invite_token=?').get(ctx.params.token);
  if (!u || Number(u.invite_expires) < Date.now()) return html(ctx.res, 400, V.errorPage(400, '邀請連結無效或已過期'));
  const pw = String(ctx.body.password || '');
  if (pw.length < 8 || pw !== ctx.body.password2) {
    return html(ctx.res, 400, V.setpass({ mode: 'invite', name: u.name, error: '密碼至少 8 碼，且兩次輸入需相同' }));
  }
  db.prepare(`UPDATE users SET password_hash=?, status='active', invite_token=NULL, invite_expires=NULL WHERE id=?`)
    .run(hashPassword(pw), u.id);
  createSession(ctx.res, u.id);
  redirect(ctx.res, '/app');
});

// ============ member ============
function requireMember(ctx) {
  if (!ctx.user) { redirect(ctx.res, '/'); return false; }
  if (ctx.user.status === 'disabled') { destroySession(ctx.req, ctx.res); redirect(ctx.res, '/'); return false; }
  return true;
}

route('GET', '/app', (ctx) => {
  if (!requireMember(ctx)) return;
  const now = P.taipeiNow();
  const upcoming = db.prepare(`SELECT * FROM bookings WHERE user_id=? AND status='booked' AND (date > ? OR (date = ? AND hour >= ?))
    ORDER BY date, hour LIMIT 5`).all(ctx.user.id, now.date, now.date, now.hour);
  html(ctx.res, 200, V.dashboard({ user: ctx.user, flash: ctx.flash, bal: balances(ctx.user.id), upcoming }));
});

route('GET', '/app/booking', (ctx) => {
  if (!requireMember(ctx)) return;
  const now = P.taipeiNow();
  const dates = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    dates.push(new Date(Date.parse(now.date + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
  }
  let date = String(ctx.query.get('date') || now.date);
  if (!isDate(date) || !dates.includes(date)) date = now.date;

  const taken = {};
  for (const b of db.prepare(`SELECT * FROM bookings WHERE date=? AND status='booked'`).all(date)) {
    taken[`${b.court}-${b.hour}`] = b;
  }
  html(ctx.res, 200, V.booking({
    user: ctx.user, flash: ctx.flash, date, dates, now, taken,
    holidayName: (db.prepare('SELECT name FROM holidays WHERE date=?').get(date) || {}).name,
    isPeakDay: P.isWeekend(date) || P.isHoliday(date),
    bal: balances(ctx.user.id)
  }));
});

route('POST', '/app/booking', (ctx) => {
  if (!requireMember(ctx)) return;
  const court = +ctx.body.court, hour = +ctx.body.hour, date = String(ctx.body.date || '');
  if (!P.COURTS.includes(court) || !P.HOURS.includes(hour) || !isDate(date)) {
    setFlash(ctx.session, '預約資料有誤'); return redirect(ctx.res, '/app/booking');
  }
  const until = P.hoursUntilSlot(date, hour);
  if (until <= 0) { setFlash(ctx.session, '此時段已開始或已過期'); return redirect(ctx.res, `/app/booking?date=${date}`); }
  if (until > (WINDOW_DAYS + 1) * 24) { setFlash(ctx.session, '超出可預約範圍'); return redirect(ctx.res, `/app/booking?date=${date}`); }

  const passType = P.slotPassType(court, date, hour);
  try {
    tx(() => {
      const bal = db.prepare('SELECT qty FROM balances WHERE user_id=? AND pass_type=?').get(ctx.user.id, passType);
      if (!bal || Number(bal.qty) < 1) throw new Error('NO_PASS');
      db.prepare('UPDATE balances SET qty = qty - 1 WHERE user_id=? AND pass_type=?').run(ctx.user.id, passType);
      const r = db.prepare('INSERT INTO bookings (user_id, court, date, hour, pass_type) VALUES (?,?,?,?,?)')
        .run(ctx.user.id, court, date, hour, passType);
      db.prepare('INSERT INTO pass_log (user_id, pass_type, delta, reason, ref) VALUES (?,?,-1,?,?)')
        .run(ctx.user.id, passType, 'booking', String(r.lastInsertRowid));
    });
  } catch (e) {
    if (e.message === 'NO_PASS') { setFlash(ctx.session, `您的「${P.PASS_TYPES[passType].name}」不足，請先購買票券`); return redirect(ctx.res, '/app/buy'); }
    if (String(e.message).includes('UNIQUE')) { setFlash(ctx.session, '此時段剛被預約，請選擇其他時段'); return redirect(ctx.res, `/app/booking?date=${date}`); }
    throw e;
  }
  setFlash(ctx.session, `預約成功：${date} ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00 第${court}場`);
  redirect(ctx.res, `/app/booking?date=${date}`);
});

route('GET', '/app/bookings', (ctx) => {
  if (!requireMember(ctx)) return;
  const rows = db.prepare('SELECT * FROM bookings WHERE user_id=? ORDER BY date DESC, hour DESC LIMIT 200').all(ctx.user.id);
  html(ctx.res, 200, V.myBookings({ user: ctx.user, flash: ctx.flash, rows }));
});

route('POST', '/app/bookings/:id/cancel', (ctx) => {
  if (!requireMember(ctx)) return;
  const b = db.prepare(`SELECT * FROM bookings WHERE id=? AND user_id=? AND status='booked'`).get(+ctx.params.id, ctx.user.id);
  if (!b) { setFlash(ctx.session, '找不到此預約'); return redirect(ctx.res, '/app/bookings'); }
  if (P.hoursUntilSlot(b.date, b.hour) < 24) {
    setFlash(ctx.session, '距開始時間不足 24 小時，無法取消（如有特殊狀況請聯絡客服）');
    return redirect(ctx.res, '/app/bookings');
  }
  tx(() => {
    db.prepare(`UPDATE bookings SET status='cancelled', cancelled_at=datetime('now','localtime') WHERE id=?`).run(b.id);
    addPasses(Number(b.user_id), b.pass_type, 1, 'cancel_refund', b.id);
  });
  setFlash(ctx.session, '已取消預約，票券已退回您的帳戶');
  redirect(ctx.res, '/app/bookings');
});

route('GET', '/app/buy', (ctx) => {
  if (!requireMember(ctx)) return;
  const packages = db.prepare('SELECT * FROM packages WHERE active=1 ORDER BY sort').all();
  html(ctx.res, 200, V.buy({ user: ctx.user, flash: ctx.flash, packages, bal: balances(ctx.user.id), ecpayOn: ecpay.enabled(), bankInfo: BANK_INFO }));
});

route('GET', '/app/orders', (ctx) => {
  if (!requireMember(ctx)) return;
  const rows = db.prepare(`SELECT o.*, p.name AS package_name FROM orders o JOIN packages p ON p.id=o.package_id
    WHERE o.user_id=? ORDER BY o.id DESC LIMIT 100`).all(ctx.user.id);
  html(ctx.res, 200, V.myOrders({ user: ctx.user, flash: ctx.flash, rows, bankInfo: BANK_INFO }));
});

// ============ payment ============
function markPaid(order) {
  tx(() => {
    db.prepare(`UPDATE orders SET status='paid', paid_at=datetime('now','localtime') WHERE id=? AND status='pending'`).run(Number(order.id));
    addPasses(Number(order.user_id), order.pass_type, Number(order.passes_qty), 'purchase', order.id);
  });
}

route('POST', '/pay/checkout', (ctx) => {
  if (!requireMember(ctx)) return;
  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(+ctx.body.package_id);
  if (!pkg) { setFlash(ctx.session, '找不到此方案'); return redirect(ctx.res, '/app/buy'); }
  const method = ecpay.enabled() && ctx.body.method === 'ecpay' ? 'ecpay' : 'transfer';
  const tradeNo = 'DP' + Date.now() + Math.floor(Math.random() * 900 + 100);
  db.prepare(`INSERT INTO orders (user_id, package_id, pass_type, passes_qty, amount, method, merchant_trade_no)
              VALUES (?,?,?,?,?,?,?)`)
    .run(ctx.user.id, Number(pkg.id), pkg.pass_type, Number(pkg.passes_qty), Number(pkg.price), method, tradeNo);

  if (method === 'ecpay') {
    const form = ecpay.buildCheckoutForm({ merchant_trade_no: tradeNo, amount: Number(pkg.price), item_name: pkg.name }, BASE_URL);
    return html(ctx.res, 200, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>前往付款…</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px">正在前往綠界安全付款頁面…${form}</body></html>`);
  }
  setFlash(ctx.session, '訂單已成立！請依轉帳資訊付款並聯絡客服，確認入帳後即發放票券。');
  redirect(ctx.res, '/app/orders');
});

route('POST', '/pay/ecpay/notify', (ctx) => {
  try {
    if (!ecpay.verifyNotify(ctx.body)) { ctx.res.end('0|CheckMacValue Error'); return; }
    if (ctx.body.RtnCode === '1') {
      const order = db.prepare('SELECT * FROM orders WHERE merchant_trade_no=?').get(ctx.body.MerchantTradeNo);
      if (order && order.status === 'pending') markPaid(order);
    }
    ctx.res.end('1|OK');
  } catch (e) { console.error(e); ctx.res.end('0|Error'); }
});

route('POST', '/pay/ecpay/result', (ctx) => {
  const ok = ecpay.verifyNotify(ctx.body) && ctx.body.RtnCode === '1';
  if (ok) {
    const order = db.prepare('SELECT * FROM orders WHERE merchant_trade_no=?').get(ctx.body.MerchantTradeNo);
    if (order && order.status === 'pending') markPaid(order);
  }
  html(ctx.res, 200, V.payResult({ user: ctx.user, ok }));
});

// ============ admin ============
function requireAdmin(ctx) {
  if (!ctx.user || ctx.user.role !== 'admin') { redirect(ctx.res, '/'); return false; }
  return true;
}

route('GET', '/admin', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const now = P.taipeiNow();
  const stats = {
    members: db.prepare(`SELECT COUNT(*) n FROM users WHERE role='member'`).get().n,
    pendingOrders: db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='pending' AND method='transfer'`).get().n,
    todayBookings: db.prepare(`SELECT COUNT(*) n FROM bookings WHERE date=? AND status='booked'`).get(now.date).n
  };
  const today = db.prepare(`SELECT b.*, u.name AS member_name FROM bookings b JOIN users u ON u.id=b.user_id
    WHERE b.date=? AND b.status='booked' ORDER BY b.hour, b.court`).all(now.date);
  html(ctx.res, 200, V.adminDashboard({ user: ctx.user, flash: ctx.flash, stats, today, now }));
});

route('GET', '/admin/members', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const members = db.prepare(`SELECT u.*,
      COALESCE((SELECT qty FROM balances WHERE user_id=u.id AND pass_type='OFFPEAK'),0) AS off,
      COALESCE((SELECT qty FROM balances WHERE user_id=u.id AND pass_type='PEAK23'),0) AS p23,
      COALESCE((SELECT qty FROM balances WHERE user_id=u.id AND pass_type='PEAK14'),0) AS p14
    FROM users u WHERE role='member' ORDER BY u.id DESC`).all();
  html(ctx.res, 200, V.adminMembers({ user: ctx.user, flash: ctx.flash, members, baseUrl: BASE_URL, mailerOn: mailer.enabled() }));
});

async function sendInvite(u, t) {
  if (!mailer.enabled()) return false;
  const m = mailer.inviteEmail(u.name, `${BASE_URL}/invite/${t}`, process.env.SERVICE_EMAIL || '');
  return mailer.send(u.email, m.subject, m.html);
}

route('POST', '/admin/members', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const name = String(ctx.body.name || '').trim();
  if (!email.includes('@') || !name) { setFlash(ctx.session, '請填寫姓名與正確 Email'); return redirect(ctx.res, '/admin/members'); }
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) { setFlash(ctx.session, '此 Email 已存在'); return redirect(ctx.res, '/admin/members'); }
  const t = token(24);
  db.prepare('INSERT INTO users (email, name, phone, invite_token, invite_expires) VALUES (?,?,?,?,?)')
    .run(email, name, String(ctx.body.phone || ''), t, Date.now() + 7 * 864e5);
  const sent = await sendInvite({ name, email }, t);
  setFlash(ctx.session, sent
    ? `已建立會員 ${name}，邀請信已寄至 ${email}（7 天內有效）`
    : `已建立會員 ${name}，${mailer.enabled() ? '但寄信失敗，' : ''}請複製邀請連結傳給對方（7 天內有效）`);
  redirect(ctx.res, '/admin/members');
});

route('POST', '/admin/members/:id/reinvite', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const u = db.prepare(`SELECT * FROM users WHERE id=? AND role='member'`).get(+ctx.params.id);
  if (u) {
    const t = token(24);
    db.prepare(`UPDATE users SET invite_token=?, invite_expires=?, status=CASE WHEN status='disabled' THEN 'disabled' ELSE 'invited' END WHERE id=?`)
      .run(t, Date.now() + 7 * 864e5, Number(u.id));
    const sent = await sendInvite(u, t);
    setFlash(ctx.session, sent ? `邀請信已重新寄至 ${u.email}` : `已產生新邀請連結：${BASE_URL}/invite/${t}`);
  }
  redirect(ctx.res, '/admin/members');
});

route('POST', '/admin/members/:id/toggle', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const u = db.prepare(`SELECT * FROM users WHERE id=? AND role='member'`).get(+ctx.params.id);
  if (u) db.prepare('UPDATE users SET status=? WHERE id=?').run(u.status === 'disabled' ? 'active' : 'disabled', Number(u.id));
  redirect(ctx.res, '/admin/members');
});

route('POST', '/admin/members/:id/passes', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const u = db.prepare(`SELECT * FROM users WHERE id=? AND role='member'`).get(+ctx.params.id);
  const type = String(ctx.body.pass_type);
  const delta = parseInt(ctx.body.delta, 10);
  if (u && P.PASS_TYPES[type] && Number.isInteger(delta) && delta !== 0) {
    addPasses(Number(u.id), type, delta, 'admin_adjust', ctx.body.note || '');
    setFlash(ctx.session, `已調整 ${u.name} 的票券（${P.PASS_TYPES[type].name} ${delta > 0 ? '+' : ''}${delta}）`);
  }
  redirect(ctx.res, '/admin/members');
});

route('GET', '/admin/orders', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const rows = db.prepare(`SELECT o.*, u.name AS member_name, u.email, p.name AS package_name
    FROM orders o JOIN users u ON u.id=o.user_id JOIN packages p ON p.id=o.package_id
    ORDER BY o.id DESC LIMIT 300`).all();
  html(ctx.res, 200, V.adminOrders({ user: ctx.user, flash: ctx.flash, rows }));
});

route('POST', '/admin/orders/:id/approve', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const o = db.prepare(`SELECT * FROM orders WHERE id=? AND status='pending'`).get(+ctx.params.id);
  if (o) { markPaid(o); setFlash(ctx.session, `訂單 #${o.id} 已確認入帳，票券已發放`); }
  redirect(ctx.res, '/admin/orders');
});

route('POST', '/admin/orders/:id/cancel', (ctx) => {
  if (!requireAdmin(ctx)) return;
  db.prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'`).run(+ctx.params.id);
  redirect(ctx.res, '/admin/orders');
});

route('GET', '/admin/bookings', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const now = P.taipeiNow();
  let date = String(ctx.query.get('date') || now.date);
  if (!isDate(date)) date = now.date;
  const rows = db.prepare(`SELECT b.*, u.name AS member_name, u.email FROM bookings b JOIN users u ON u.id=b.user_id
    WHERE b.date=? ORDER BY b.hour, b.court`).all(date);
  html(ctx.res, 200, V.adminBookings({ user: ctx.user, flash: ctx.flash, rows, date }));
});

route('POST', '/admin/bookings/:id/cancel', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const b = db.prepare(`SELECT * FROM bookings WHERE id=? AND status='booked'`).get(+ctx.params.id);
  if (b) {
    tx(() => {
      db.prepare(`UPDATE bookings SET status='cancelled', cancelled_at=datetime('now','localtime') WHERE id=?`).run(Number(b.id));
      addPasses(Number(b.user_id), b.pass_type, 1, 'cancel_refund', 'admin:' + b.id);
    });
    setFlash(ctx.session, '已取消並退回票券');
  }
  redirect(ctx.res, '/admin/bookings' + (b ? `?date=${b.date}` : ''));
});

route('GET', '/admin/holidays', (ctx) => {
  if (!requireAdmin(ctx)) return;
  html(ctx.res, 200, V.adminHolidays({ user: ctx.user, flash: ctx.flash, rows: db.prepare('SELECT * FROM holidays ORDER BY date').all() }));
});

route('POST', '/admin/holidays', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const date = String(ctx.body.date || '');
  if (isDate(date)) db.prepare('INSERT OR REPLACE INTO holidays (date, name) VALUES (?,?)').run(date, String(ctx.body.name || '國定假日'));
  redirect(ctx.res, '/admin/holidays');
});

route('POST', '/admin/holidays/:date/delete', (ctx) => {
  if (!requireAdmin(ctx)) return;
  db.prepare('DELETE FROM holidays WHERE date=?').run(String(ctx.params.date));
  redirect(ctx.res, '/admin/holidays');
});

route('GET', '/admin/packages', (ctx) => {
  if (!requireAdmin(ctx)) return;
  html(ctx.res, 200, V.adminPackages({ user: ctx.user, flash: ctx.flash, rows: db.prepare('SELECT * FROM packages ORDER BY sort').all() }));
});

route('POST', '/admin/packages', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const { name, pass_type, passes_qty, price } = ctx.body;
  if (name && P.PASS_TYPES[pass_type] && +passes_qty > 0 && +price >= 0) {
    db.prepare('INSERT INTO packages (name, pass_type, passes_qty, price, sort) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM packages))')
      .run(String(name), pass_type, +passes_qty, +price);
  }
  redirect(ctx.res, '/admin/packages');
});

route('POST', '/admin/packages/:id/toggle', (ctx) => {
  if (!requireAdmin(ctx)) return;
  db.prepare('UPDATE packages SET active = 1 - active WHERE id=?').run(+ctx.params.id);
  redirect(ctx.res, '/admin/packages');
});

route('POST', '/admin/packages/:id/update', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const { name, price } = ctx.body;
  if (name && +price >= 0) db.prepare('UPDATE packages SET name=?, price=? WHERE id=?').run(String(name), +price, +ctx.params.id);
  redirect(ctx.res, '/admin/packages');
});

// ---------- server ----------
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, BASE_URL);
    const pathname = decodeURIComponent(u.pathname);

    if (req.method === 'GET' && pathname !== '/' && serveStatic(req, res, pathname)) return;

    const match = routes.find(r => r.method === req.method && r.rx.test(pathname));
    if (!match) return html(res, 404, V.errorPage(404, '找不到頁面'));

    const m = pathname.match(match.rx);
    const params = {};
    match.keys.forEach((k, i) => params[k] = m[i + 1]);

    const session = currentSession(req);
    const user = session ? db.prepare('SELECT id, email, name, role, status FROM users WHERE id=?').get(Number(session.user_id)) : null;
    const ctx = { req, res, params, query: u.searchParams, session, user, flash: takeFlash(session), body: {} };

    if (req.method === 'POST') {
      // CSRF 基本防護：檢查同源（有帶 Origin/Referer 時）
      const origin = req.headers.origin || req.headers.referer || '';
      if (origin && !origin.startsWith(BASE_URL) && !pathname.startsWith('/pay/ecpay/')) {
        return html(res, 403, V.errorPage(403, '請求來源不符'));
      }
      parseBody(req, body => {
        ctx.body = body;
        Promise.resolve().then(() => match.handler(ctx))
          .catch(e => { console.error(e); try { html(res, 500, V.errorPage(500, '系統發生錯誤，請稍後再試')); } catch {} });
      });
    } else {
      Promise.resolve().then(() => match.handler(ctx))
        .catch(e => { console.error(e); try { html(res, 500, V.errorPage(500, '系統發生錯誤，請稍後再試')); } catch {} });
    }
  } catch (e) {
    console.error(e);
    try { html(res, 500, V.errorPage(500, '系統發生錯誤，請稍後再試')); } catch {}
  }
});

// 清理過期 session（每小時）
setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); } catch {}
}, 3600e3).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`樓下匹克球俱樂部 運行中 → http://localhost:${PORT}`));
