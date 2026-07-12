// 所有頁面模板（純字串樣板，不需模板引擎）
const P = require('./pricing');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const h2 = h => String(h).padStart(2, '0');
const slotLabel = h => `${h2(h)}:00–${h2(h + 1)}:00`;
const money = n => 'NT$' + Number(n).toLocaleString('en-US');

const SERVICE = () => esc(process.env.SERVICE_EMAIL || 'downstairspickleballclub@gmail.com');

function layout({ title = '', user = null, nav = '', flash = '' }, body) {
  const links = !user ? '' : user.role === 'admin' ? `
      <a href="/admin" class="${nav === 'dash' ? 'on' : ''}">總覽</a>
      <a href="/admin/members" class="${nav === 'members' ? 'on' : ''}">會員</a>
      <a href="/admin/orders" class="${nav === 'orders' ? 'on' : ''}">訂單</a>
      <a href="/admin/bookings" class="${nav === 'bookings' ? 'on' : ''}">預約</a>
      <a href="/admin/packages" class="${nav === 'packages' ? 'on' : ''}">方案</a>
      <a href="/admin/holidays" class="${nav === 'holidays' ? 'on' : ''}">假日</a>` : `
      <a href="/app" class="${nav === 'dash' ? 'on' : ''}">我的主頁</a>
      <a href="/app/booking" class="${nav === 'booking' ? 'on' : ''}">預約場地</a>
      <a href="/app/buy" class="${nav === 'buy' ? 'on' : ''}">購買票券</a>
      <a href="/app/bookings" class="${nav === 'mybookings' ? 'on' : ''}">我的預約</a>`;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title ? esc(title) + '｜' : ''}樓下匹克球俱樂部</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${user ? `<nav class="nav">
  <div class="logo"><img src="/logo.jpg" alt="logo" onerror="this.parentElement.style.display='none'"></div>
  <div class="brand">樓下匹克球俱樂部<small>Downstairs Pickleball Club</small></div>
  <div class="links">${links}
    <form class="inline" method="post" action="/logout"><button type="submit">登出</button></form>
  </div>
</nav>` : ''}
<div class="container">
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${body}
</div>
<footer class="site">
  <a href="mailto:${SERVICE()}">${SERVICE()}</a><br>
  © 2026 樓下匹克球俱樂部 Downstairs Pickleball Club
</footer>
</body>
</html>`;
}

// ---------- public ----------
function landing({ error = '', openLogin = false, flash = '' }) {
  return layout({ title: '私人會員制', flash }, `
<div class="hero">
  <div class="logo-lg"><img src="/logo.jpg" alt="樓下私人俱樂部" onerror="this.parentElement.style.display='none'"></div>
  <h1>樓下私人俱樂部</h1>
  <div class="en">Downstairs Private Club</div>
  <div class="chip">私人會員制 · Members Only</div>
  <label for="loginToggle" class="btn cta">進入俱樂部 Enter Private Club</label>
</div>

<input type="checkbox" id="loginToggle" class="mtoggle" ${(error || openLogin) ? 'checked' : ''}>
<div class="overlay">
  <div class="modal" role="dialog" aria-modal="true">
    <label for="loginToggle" class="close" aria-label="關閉">✕</label>
    <h2>會員登入</h2>
    <div class="sub">Member Login</div>
    ${error ? `<div class="error-box">${esc(error)}</div>` : ''}
    <form method="post" action="/login">
      <div class="field"><label for="email">電子郵件 Email</label>
        <input type="email" id="email" name="email" autocomplete="email" required></div>
      <div class="field"><label for="password">密碼 Password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" required></div>
      <button class="btn block" type="submit">登入 LOG IN</button>
    </form>
    <div class="links">
      <a href="/forgot">忘記密碼</a>
      <label for="loginToggle">← 回首頁</label>
    </div>
    <div class="note">本俱樂部採邀請制，恕不開放註冊<br>
      客服信箱：<a href="mailto:${SERVICE()}">${SERVICE()}</a></div>
  </div>
</div>`);
}

function setpass({ mode, name, error = '' }) {
  return layout({ title: mode === 'invite' ? '開通帳號' : '重設密碼' }, `
<div class="hero" style="padding-top:40px">
  <div class="logo-lg"><img src="/logo.jpg" alt="" onerror="this.parentElement.style.display='none'"></div>
  <div class="modal" style="box-shadow:none;border:1px solid var(--line)">
    <h2>${mode === 'invite' ? '歡迎加入，' + esc(name) : '重設密碼'}</h2>
    <div class="sub">${mode === 'invite' ? 'Set Your Password' : 'Reset Password'}</div>
    ${error ? `<div class="error-box">${esc(error)}</div>` : ''}
    <form method="post">
      <div class="field"><label>設定密碼（至少 8 碼）</label>
        <input type="password" name="password" minlength="8" autocomplete="new-password" required></div>
      <div class="field"><label>再次輸入密碼</label>
        <input type="password" name="password2" minlength="8" autocomplete="new-password" required></div>
      <button class="btn block" type="submit">${mode === 'invite' ? '開通帳號' : '更新密碼'}</button>
    </form>
    <div class="note">客服信箱：<a href="mailto:${SERVICE()}">${SERVICE()}</a></div>
  </div>
</div>`);
}

function forgot({ mailerOn = false, sent = false } = {}) {
  const inner = sent ? `
    <p style="font-size:14px;line-height:2">若此 Email 為有效會員帳號，重設密碼連結已寄出，<br>請至信箱查收（2 小時內有效，也請檢查垃圾郵件匣）。</p>
    <a class="btn ghost" href="/" style="margin-top:16px">← 回首頁</a>`
    : mailerOn ? `
    <form method="post" action="/forgot">
      <div class="field"><label>會員 Email</label>
        <input type="email" name="email" autocomplete="email" required></div>
      <button class="btn block" type="submit">寄送重設密碼連結</button>
    </form>
    <div class="links" style="justify-content:center"><a href="/">← 回首頁</a></div>`
    : `
    <p style="font-size:14px;line-height:2">請聯絡客服為您重設密碼，我們將寄送新的開通連結給您：<br>
      <a href="mailto:${SERVICE()}">${SERVICE()}</a></p>
    <a class="btn ghost" href="/" style="margin-top:16px">← 回首頁</a>`;
  return layout({ title: '忘記密碼' }, `
<div class="hero" style="padding-top:40px">
  <div class="modal" style="box-shadow:none;border:1px solid var(--line)">
    <h2>忘記密碼</h2>
    <div class="sub">Forgot Password</div>
    ${inner}
  </div>
</div>`);
}

function errorPage(code, message) {
  return layout({ title: '錯誤' }, `
<div class="hero" style="padding-top:60px">
  <h1 style="font-size:48px;color:var(--green)">${esc(code)}</h1>
  <p style="margin-top:14px;color:var(--text-dim)">${esc(message)}</p>
  <a class="btn" href="/" style="margin-top:26px">回首頁</a>
</div>`);
}

// ---------- member ----------
function balancesRow(bal) {
  return `<div class="balances">${Object.entries(P.PASS_TYPES).map(([k, t]) => `
    <div class="b"><div class="n">${bal[k]}</div><div class="t">${t.name}<br><small>${t.desc}</small></div></div>`).join('')}
  </div>`;
}

function dashboard({ user, flash, bal, upcoming }) {
  return layout({ title: '我的主頁', user, nav: 'dash', flash }, `
<h1 class="page">${esc(user.name)}，歡迎回來</h1>
<div class="card">
  <h2>我的票券</h2>
  ${balancesRow(bal)}
  <div style="margin-top:14px"><a class="btn sm ghost" href="/app/buy">購買票券 →</a></div>
</div>
<div class="card">
  <h2>即將到來的預約</h2>
  ${!upcoming.length ? '<p style="font-size:14px;color:var(--text-dim)">目前沒有預約。</p>' : `
  <table class="list">
    <tr><th>日期</th><th>時段</th><th>場地</th></tr>
    ${upcoming.map(b => `<tr><td>${b.date}</td><td>${slotLabel(b.hour)}</td><td><span class="tag">第 ${b.court} 場</span></td></tr>`).join('')}
  </table>`}
  <div style="margin-top:14px"><a class="btn sm" href="/app/booking">預約場地 →</a></div>
</div>`);
}

function booking({ user, flash, date, dates, now, taken, holidayName, isPeakDay, bal }) {
  const dateBar = dates.map(d => {
    const wd = '日一二三四五六'[P.weekday(d)];
    return `<a href="/app/booking?date=${d}" class="${d === date ? 'on' : ''}"><span class="dow">週${wd}</span>${d.slice(5).replace('-', '/')}</a>`;
  }).join('');

  const rows = P.HOURS.map(h => {
    const cells = P.COURTS.map(c => {
      const b = taken[`${c}-${h}`];
      const pt = P.slotPassType(c, date, h);
      const isPast = (date < now.date) || (date === now.date && h <= now.hour);
      if (b && b.user_id === user.id) return `<td><span class="slot mine">已預約<span class="p">您的場次</span></span></td>`;
      if (b) return `<td><span class="slot taken">已被預約</span></td>`;
      if (isPast) return `<td><span class="slot past">—</span></td>`;
      return `<td><form method="post" action="/app/booking"
        onsubmit="return confirm('確認預約 ${date} ${slotLabel(h)} 第${c}場？\\n將使用 1 張「${P.PASS_TYPES[pt].name}」')">
        <input type="hidden" name="date" value="${date}">
        <input type="hidden" name="court" value="${c}">
        <input type="hidden" name="hour" value="${h}">
        <button class="slot free-${pt}" type="submit">可預約<span class="p">${money(P.PASS_TYPES[pt].price)}</span></button>
      </form></td>`;
    }).join('');
    return `<tr><th>${h2(h)}:00</th>${cells}</tr>`;
  }).join('');

  return layout({ title: '預約場地', user, nav: 'booking', flash }, `
<h1 class="page">預約場地</h1>
<div class="datebar">${dateBar}</div>
<div class="card">
  <h2>${date}
    ${holidayName ? `<span class="tag warn">${esc(holidayName)}</span>` : isPeakDay ? '<span class="tag warn">週末假日時段</span>' : ''}
  </h2>
  <div class="bwrap">
    <table class="book">
      <tr><th style="width:70px">時間</th>${P.COURTS.map(c => `<th>第 ${c} 場</th>`).join('')}</tr>
      ${rows}
    </table>
  </div>
  <div class="legend">
    <span><span class="sw" style="background:var(--green-soft)"></span>離峰 NT$700</span>
    <span><span class="sw" style="background:#e3efe0"></span>尖峰 2・3號場 NT$1,000</span>
    <span><span class="sw" style="background:#163a2a"></span>尖峰 1・4號場 NT$1,200</span>
    <span><span class="sw" style="background:#f1f1ee"></span>已被預約</span>
  </div>
  <p style="font-size:13px;color:var(--text-dim);margin-top:8px">
    我的票券：離峰 <b>${bal.OFFPEAK}</b>｜尖峰2・3 <b>${bal.PEAK23}</b>｜尖峰1・4 <b>${bal.PEAK14}</b>
    　<a href="/app/buy">購買票券 →</a></p>
</div>
<div class="card">
  <h2>注意事項</h2>
  <ul class="notice">
    <li>每時段為 1 小時，場地開放時間 09:00–22:00。</li>
    <li>必須穿著不留痕的室內球場適用運動鞋，嚴禁赤腳或穿著黑膠/色底鞋、皮鞋、高跟鞋、涼鞋、拖鞋等不合宜的鞋子進入球場區域。</li>
    <li>預約開始前 24 小時以上可自行取消，票券將退回帳戶；24 小時內恕不接受取消。</li>
    <li>本服務僅供會員私人使用，請勿以任何形式加價轉租、轉借或轉售。如發現任何違規行為，本場地保留取消預訂、終止使用、要求立即離場及拒絕未來預約之權利，已支付之費用恕不退還。</li>
    <li>如有任何問題請聯絡客服：<a href="mailto:${SERVICE()}">${SERVICE()}</a></li>
  </ul>
</div>`);
}

function myBookings({ user, flash, rows }) {
  const body = !rows.length ? '<p style="font-size:14px;color:var(--text-dim)">尚無預約紀錄。</p>' : `
  <table class="list">
    <tr><th>日期</th><th>時段</th><th>場地</th><th>票券</th><th>狀態</th><th></th></tr>
    ${rows.map(b => {
      const hrs = P.hoursUntilSlot(b.date, b.hour);
      const canCancel = b.status === 'booked' && hrs >= 24;
      return `<tr>
        <td>${b.date}</td><td>${slotLabel(b.hour)}</td><td>第 ${b.court} 場</td>
        <td><span class="tag">${P.PASS_TYPES[b.pass_type].name}</span></td>
        <td>${b.status === 'booked' ? '<span class="tag">已預約</span>' : '<span class="tag dim">已取消</span>'}</td>
        <td>${canCancel ? `<form class="inline" method="post" action="/app/bookings/${b.id}/cancel"
              onsubmit="return confirm('確定取消此預約？票券將退回您的帳戶。')">
              <button class="btn sm danger" type="submit">取消</button></form>`
          : (b.status === 'booked' && hrs > 0 ? '<span style="font-size:12px;color:var(--text-dim)">24小時內不可取消</span>' : '')}</td>
      </tr>`;
    }).join('')}
  </table>`;
  return layout({ title: '我的預約', user, nav: 'mybookings', flash }, `
<h1 class="page">我的預約</h1>
<div class="card">${body}
  <p style="font-size:12.5px;color:var(--text-dim);margin-top:12px">
    取消政策：開始前 24 小時以上取消，票券退回帳戶；24 小時內恕不接受取消，且不退現金。</p>
</div>`);
}

function buy({ user, flash, packages, bal, ecpayOn, bankInfo }) {
  const cards = packages.map(p => `
  <div class="card" style="margin-bottom:0">
    <span class="tag">${P.PASS_TYPES[p.pass_type].name}</span>
    <h2 style="margin:10px 0 4px">${esc(p.name)}</h2>
    <p style="font-size:13px;color:var(--text-dim)">${P.PASS_TYPES[p.pass_type].desc}・共 ${p.passes_qty} 次</p>
    <p style="font-size:24px;font-weight:800;color:var(--green);margin:10px 0 14px">${money(p.price)}</p>
    <form method="post" action="/pay/checkout">
      <input type="hidden" name="package_id" value="${p.id}">
      ${ecpayOn
        ? `<button class="btn block" name="method" value="ecpay" type="submit">信用卡付款</button>
           <button class="btn block ghost" name="method" value="transfer" type="submit" style="margin-top:8px">銀行轉帳</button>`
        : `<button class="btn block" name="method" value="transfer" type="submit">下單（銀行轉帳）</button>`}
    </form>
  </div>`).join('');

  return layout({ title: '購買票券', user, nav: 'buy', flash }, `
<h1 class="page">購買票券</h1>
<div class="card"><h2>我的票券</h2>${balancesRow(bal)}
  <div style="margin-top:12px"><a href="/app/orders" style="font-size:13px">查看我的訂單 →</a></div></div>
<div class="grid c3">${cards}</div>
<div class="card" style="margin-top:18px">
  <h2>付款方式說明</h2>
  <ul class="notice">
    ${ecpayOn ? '<li><b>信用卡付款：</b>透過綠界科技（ECPay）安全加密頁面刷卡，付款成功後票券立即入帳。</li>' : ''}
    <li><b>銀行轉帳：</b>下單後依以下資訊轉帳，並聯絡客服告知帳號後五碼；確認入帳後票券將發放至您的帳戶。</li>
    <li><b>轉帳資訊：</b>${esc(bankInfo)}</li>
    <li>票券無使用期限、不可轉讓；除法定情形外恕不退現金。</li>
  </ul>
</div>`);
}

function myOrders({ user, flash, rows, bankInfo }) {
  const hasPendingTransfer = rows.some(o => o.status === 'pending' && o.method === 'transfer');
  return layout({ title: '我的訂單', user, nav: 'buy', flash }, `
<h1 class="page">我的訂單</h1>
<div class="card">
  ${!rows.length ? '<p style="font-size:14px;color:var(--text-dim)">尚無訂單。</p>' : `
  <table class="list">
    <tr><th>#</th><th>方案</th><th>金額</th><th>方式</th><th>狀態</th><th>時間</th></tr>
    ${rows.map(o => `<tr>
      <td>${o.id}</td><td>${esc(o.package_name)}</td><td>${money(o.amount)}</td>
      <td>${o.method === 'ecpay' ? '信用卡' : '銀行轉帳'}</td>
      <td>${o.status === 'paid' ? '<span class="tag">已完成</span>' : o.status === 'pending' ? '<span class="tag warn">待付款/確認</span>' : '<span class="tag dim">已取消</span>'}</td>
      <td style="white-space:nowrap">${o.created_at}</td></tr>`).join('')}
  </table>`}
  ${hasPendingTransfer && bankInfo ? `<p style="font-size:13px;color:var(--text-dim);margin-top:12px"><b>轉帳資訊：</b>${esc(bankInfo)}<br>轉帳後請聯絡客服告知帳號後五碼，確認入帳後即發放票券。</p>` : ''}
</div>`);
}

function payResult({ user, ok }) {
  return layout({ title: ok ? '付款成功' : '付款失敗', user }, `
<div class="hero" style="padding-top:60px">
  <h1 style="color:var(--green)">${ok ? '付款成功 🎉' : '付款未完成'}</h1>
  <p style="margin-top:14px;color:var(--text-dim)">${ok ? '票券已發放至您的帳戶，現在就去預約場地吧！' : '付款未成功，請重新嘗試或聯絡客服。'}</p>
  <a class="btn" href="${ok ? '/app/booking' : '/app/buy'}" style="margin-top:26px">${ok ? '前往預約' : '回購買頁'}</a>
</div>`);
}

// ---------- admin ----------
function adminDashboard({ user, flash, stats, today, now }) {
  return layout({ title: '管理總覽', user, nav: 'dash', flash }, `
<h1 class="page">管理總覽</h1>
<div class="balances" style="margin-bottom:18px">
  <div class="b"><div class="n">${stats.members}</div><div class="t">會員數</div></div>
  <div class="b"><div class="n">${stats.todayBookings}</div><div class="t">今日預約</div></div>
  <div class="b"><div class="n" style="color:${stats.pendingOrders ? 'var(--danger)' : 'var(--green)'}">${stats.pendingOrders}</div>
    <div class="t">待確認轉帳訂單 ${stats.pendingOrders ? '<a href="/admin/orders">處理 →</a>' : ''}</div></div>
</div>
<div class="card">
  <h2>今日預約（${now.date}）</h2>
  ${!today.length ? '<p style="font-size:14px;color:var(--text-dim)">今日尚無預約。</p>' : `
  <table class="list">
    <tr><th>時段</th><th>場地</th><th>會員</th></tr>
    ${today.map(b => `<tr><td>${slotLabel(b.hour)}</td><td>第 ${b.court} 場</td><td>${esc(b.member_name)}</td></tr>`).join('')}
  </table>`}
</div>`);
}

function adminMembers({ user, flash, members, baseUrl, mailerOn = false }) {
  return layout({ title: '會員管理', user, nav: 'members', flash }, `
<h1 class="page">會員管理</h1>
<div class="card">
  <h2>新增會員（邀請制）</h2>
  <form method="post" action="/admin/members">
    <div class="row">
      <div class="field"><label>姓名 *</label><input name="name" required></div>
      <div class="field"><label>Email *</label><input type="email" name="email" required></div>
      <div class="field"><label>電話</label><input name="phone"></div>
      <div class="field" style="flex:0"><button class="btn" type="submit">建立並產生邀請連結</button></div>
    </div>
  </form>
  <p style="font-size:12.5px;color:var(--text-dim)">${mailerOn
    ? '建立後系統會自動寄出邀請信，會員點信中連結設定密碼即可登入（連結 7 天內有效）。下方列表仍會顯示邀請連結，可作為備援用 LINE 傳送。'
    : '建立後請複製下方邀請連結，用 LINE 或 Email 傳給會員；會員點連結設定密碼即可登入（連結 7 天內有效）。'}</p>
</div>
<div class="card">
  <h2>會員列表</h2>
  <div class="bwrap">
    <table class="list">
      <tr><th>姓名</th><th>Email</th><th>狀態</th><th>離峰</th><th>尖2·3</th><th>尖1·4</th><th>操作</th></tr>
      ${members.map(m => `<tr>
        <td>${esc(m.name)}<br><small style="color:var(--text-dim)">${esc(m.phone)}</small></td>
        <td style="word-break:break-all">${esc(m.email)}</td>
        <td>${m.status === 'active' ? '<span class="tag">已開通</span>' : m.status === 'invited' ? '<span class="tag warn">待開通</span>' : '<span class="tag dim">已停用</span>'}</td>
        <td><b>${m.off}</b></td><td><b>${m.p23}</b></td><td><b>${m.p14}</b></td>
        <td style="white-space:nowrap">
          ${m.status === 'invited' && m.invite_token ? `<input readonly value="${esc(baseUrl)}/invite/${m.invite_token}" style="width:170px;font-size:11px;padding:6px" onclick="this.select()">` : ''}
          <form class="inline" method="post" action="/admin/members/${m.id}/reinvite"><button class="btn sm ghost">重發邀請</button></form>
          <form class="inline" method="post" action="/admin/members/${m.id}/toggle"
                onsubmit="return confirm('確定${m.status === 'disabled' ? '啟用' : '停用'}此會員？')">
            <button class="btn sm ${m.status === 'disabled' ? '' : 'danger'}">${m.status === 'disabled' ? '啟用' : '停用'}</button></form>
          <details style="display:inline-block">
            <summary class="btn sm ghost" style="list-style:none;cursor:pointer">調整票券</summary>
            <form method="post" action="/admin/members/${m.id}/passes" style="margin-top:8px;display:flex;gap:6px;align-items:center">
              <select name="pass_type" style="width:auto;padding:6px;font-size:12px">
                <option value="OFFPEAK">離峰</option><option value="PEAK23">尖峰2·3</option><option value="PEAK14">尖峰1·4</option>
              </select>
              <input name="delta" type="number" placeholder="+/-" style="width:64px;padding:6px;font-size:12px" required>
              <input name="note" placeholder="備註" style="width:90px;padding:6px;font-size:12px">
              <button class="btn sm">確定</button>
            </form>
          </details>
        </td>
      </tr>`).join('')}
    </table>
  </div>
</div>`);
}

function adminOrders({ user, flash, rows }) {
  return layout({ title: '訂單管理', user, nav: 'orders', flash }, `
<h1 class="page">訂單管理</h1>
<div class="card"><div class="bwrap">
  <table class="list">
    <tr><th>#</th><th>會員</th><th>方案</th><th>金額</th><th>方式</th><th>狀態</th><th>時間</th><th></th></tr>
    ${rows.map(o => `<tr>
      <td>${o.id}</td>
      <td>${esc(o.member_name)}<br><small style="color:var(--text-dim)">${esc(o.email)}</small></td>
      <td>${esc(o.package_name)}</td><td>${money(o.amount)}</td>
      <td>${o.method === 'ecpay' ? '信用卡' : '轉帳'}</td>
      <td>${o.status === 'paid' ? '<span class="tag">已完成</span>' : o.status === 'pending' ? '<span class="tag warn">待確認</span>' : '<span class="tag dim">已取消</span>'}</td>
      <td style="white-space:nowrap">${o.created_at}</td>
      <td style="white-space:nowrap">${o.status === 'pending' ? `
        <form class="inline" method="post" action="/admin/orders/${o.id}/approve"
              onsubmit="return confirm('確認已收到 ${money(o.amount)}？票券將立即發放給 ${esc(o.member_name)}。')">
          <button class="btn sm">確認入帳</button></form>
        <form class="inline" method="post" action="/admin/orders/${o.id}/cancel" onsubmit="return confirm('取消此訂單？')">
          <button class="btn sm danger">取消</button></form>` : ''}</td>
    </tr>`).join('')}
  </table>
</div></div>`);
}

function adminBookings({ user, flash, rows, date }) {
  return layout({ title: '預約管理', user, nav: 'bookings', flash }, `
<h1 class="page">預約管理</h1>
<div class="card">
  <form method="get" action="/admin/bookings" class="row" style="max-width:340px">
    <div class="field" style="margin:0"><label>日期</label><input type="date" name="date" value="${date}"></div>
    <div class="field" style="margin:0;flex:0"><button class="btn">查詢</button></div>
  </form>
</div>
<div class="card">
  <h2>${date} 預約</h2>
  ${!rows.length ? '<p style="font-size:14px;color:var(--text-dim)">此日無預約。</p>' : `
  <table class="list">
    <tr><th>時段</th><th>場地</th><th>會員</th><th>票券</th><th>狀態</th><th></th></tr>
    ${rows.map(b => `<tr>
      <td>${slotLabel(b.hour)}</td><td>第 ${b.court} 場</td>
      <td>${esc(b.member_name)}<br><small style="color:var(--text-dim)">${esc(b.email)}</small></td>
      <td><span class="tag">${P.PASS_TYPES[b.pass_type].name}</span></td>
      <td>${b.status === 'booked' ? '已預約' : '已取消'}</td>
      <td>${b.status === 'booked' ? `
        <form class="inline" method="post" action="/admin/bookings/${b.id}/cancel"
              onsubmit="return confirm('取消此預約並退回票券給會員？')">
          <button class="btn sm danger">取消並退券</button></form>` : ''}</td>
    </tr>`).join('')}
  </table>`}
</div>`);
}

function adminHolidays({ user, flash, rows }) {
  return layout({ title: '假日管理', user, nav: 'holidays', flash }, `
<h1 class="page">國定假日管理</h1>
<div class="card">
  <p style="font-size:13px;color:var(--text-dim);margin-bottom:14px">
    列入此表的日期一律採「週末及國定假日」計價（1・4號場 NT$1,200／2・3號場 NT$1,000）。
    週六與週日不需列入，系統自動視為假日價。每年底請依人事行政總處公告新增次年假日。</p>
  <form method="post" action="/admin/holidays" class="row" style="max-width:520px">
    <div class="field" style="margin:0"><label>日期</label><input type="date" name="date" required></div>
    <div class="field" style="margin:0"><label>名稱</label><input name="name" placeholder="例：端午節" required></div>
    <div class="field" style="margin:0;flex:0"><button class="btn">新增</button></div>
  </form>
</div>
<div class="card">
  <table class="list">
    <tr><th>日期</th><th>名稱</th><th></th></tr>
    ${rows.map(h => `<tr><td>${h.date}</td><td>${esc(h.name)}</td>
      <td><form class="inline" method="post" action="/admin/holidays/${h.date}/delete"
            onsubmit="return confirm('刪除 ${h.date} ${esc(h.name)}？')">
        <button class="btn sm danger">刪除</button></form></td></tr>`).join('')}
  </table>
</div>`);
}

function adminPackages({ user, flash, rows }) {
  return layout({ title: '票券方案', user, nav: 'packages', flash }, `
<h1 class="page">票券方案管理</h1>
<div class="card">
  <h2>新增方案</h2>
  <form method="post" action="/admin/packages" class="row">
    <div class="field" style="margin:0;flex:2"><label>名稱</label><input name="name" required placeholder="例：離峰5次券"></div>
    <div class="field" style="margin:0"><label>票券類型</label>
      <select name="pass_type">
        <option value="OFFPEAK">離峰（全場地）</option>
        <option value="PEAK23">尖峰 2・3號場</option>
        <option value="PEAK14">尖峰 1・4號場</option>
      </select></div>
    <div class="field" style="margin:0"><label>次數</label><input type="number" name="passes_qty" min="1" value="1" required></div>
    <div class="field" style="margin:0"><label>售價 NT$</label><input type="number" name="price" min="0" required></div>
    <div class="field" style="margin:0;flex:0"><button class="btn">新增</button></div>
  </form>
</div>
<div class="card">
  <table class="list">
    <tr><th>名稱</th><th>類型</th><th>次數</th><th>售價</th><th>狀態</th><th></th></tr>
    ${rows.map(p => `<tr>
      <td><form class="inline" method="post" action="/admin/packages/${p.id}/update" id="pkg${p.id}">
        <input name="name" value="${esc(p.name)}" style="font-size:12.5px;padding:6px;min-width:200px" form="pkg${p.id}"></form></td>
      <td><span class="tag">${P.PASS_TYPES[p.pass_type].name}</span></td>
      <td>${p.passes_qty}</td>
      <td><input name="price" type="number" value="${p.price}" style="font-size:12.5px;padding:6px;width:90px" form="pkg${p.id}"></td>
      <td>${p.active ? '上架中' : '已下架'}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" form="pkg${p.id}">儲存</button>
        <form class="inline" method="post" action="/admin/packages/${p.id}/toggle">
          <button class="btn sm ${p.active ? 'danger' : 'ghost'}">${p.active ? '下架' : '上架'}</button></form>
      </td>
    </tr>`).join('')}
  </table>
  <p style="font-size:12.5px;color:var(--text-dim);margin-top:10px">
    票券類型與計價規則綁定：離峰＝平日 17:00 前全場地（NT$700/時段）；尖峰 2・3號場 NT$1,000；尖峰 1・4號場 NT$1,200（平日 17:00 後、週末及國定假日）。
    想做優惠（如 10 次送 1 次），把方案「次數」設 11、售價設 10 次的價格即可。</p>
</div>`);
}

module.exports = {
  esc, landing, setpass, forgot, errorPage,
  dashboard, booking, myBookings, buy, myOrders, payResult,
  adminDashboard, adminMembers, adminOrders, adminBookings, adminHolidays, adminPackages
};
