// 零套件 SMTP 寄信（支援 465 TLS、587 STARTTLS、純文字測試模式）
// 設定 SMTP_HOST / SMTP_USER / SMTP_PASS 即啟用；未設定時 enabled() = false，
// 系統自動退回「管理員手動複製邀請連結」模式。
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

function enabled() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;

// 將 socket 包成「送指令、等回應」的介面（SMTP 回應以「數字+空格」結尾行為完結）
function makeExchange(socket) {
  let buf = '', lines = [];
  const queue = [];
  socket.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const resp = lines.join('\n'); lines = [];
        const w = queue.shift();
        if (w) w.resolve(resp);
      }
    }
  });
  socket.on('error', e => { const w = queue.shift(); if (w) w.reject(e); });
  return {
    read() { return new Promise((resolve, reject) => queue.push({ resolve, reject })); },
    async cmd(line, okCodes) {
      socket.write(line + '\r\n');
      const resp = await this.read();
      const code = +resp.slice(0, 3);
      if (!okCodes.includes(code)) throw new Error(`SMTP ${line.split(' ')[0]} 失敗：${resp}`);
      return resp;
    }
  };
}

function connect(opts) {
  return new Promise((resolve, reject) => {
    const s = opts.tls
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host }, () => resolve(s))
      : net.connect({ host: opts.host, port: opts.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20000, () => { s.destroy(); reject(new Error('SMTP 連線逾時')); });
  });
}

async function send(to, subject, htmlBody) {
  if (!enabled()) return false;
  const host = process.env.SMTP_HOST;
  const port = +(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE !== '0' : port === 465;
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const fromRaw = process.env.MAIL_FROM || user;
  const fromAddr = (fromRaw.match(/<([^>]+)>/) || [null, fromRaw.trim()])[1];
  const fromName = (fromRaw.match(/^(.*?)</) || [null, ''])[1].trim();

  let socket = await connect({ host, port, tls: secure });
  let ex = makeExchange(socket);
  try {
    let resp = await ex.read();                       // 220 greeting
    if (!resp.startsWith('220')) throw new Error('SMTP 問候失敗：' + resp);
    resp = await ex.cmd('EHLO club.local', [250]);

    // STARTTLS 升級（587 常見）
    if (!secure && /STARTTLS/i.test(resp)) {
      await ex.cmd('STARTTLS', [220]);
      socket.removeAllListeners('data');
      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host }, () => resolve(t));
        t.once('error', reject);
      });
      ex = makeExchange(socket);
      resp = await ex.cmd('EHLO club.local', [250]);
    }

    if (/AUTH/i.test(resp)) {
      await ex.cmd('AUTH LOGIN', [334]);
      await ex.cmd(b64(user), [334]);
      await ex.cmd(b64(pass), [235]);
    }

    await ex.cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await ex.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await ex.cmd('DATA', [354]);

    const msgId = `<${crypto.randomBytes(12).toString('hex')}@${fromAddr.split('@')[1] || 'club.local'}>`;
    const body = b64(htmlBody).replace(/(.{76})/g, '$1\r\n');
    const headers = [
      `From: ${fromName ? encWord(fromName) + ' ' : ''}<${fromAddr}>`,
      `To: <${to}>`,
      `Subject: ${encWord(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${msgId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64'
    ].join('\r\n');
    socket.write(headers + '\r\n\r\n' + body + '\r\n');
    await ex.cmd('.', [250]);
    ex.cmd('QUIT', [221]).catch(() => {});
    socket.end();
    return true;
  } catch (e) {
    try { socket.destroy(); } catch {}
    console.error('[mailer]', e.message);
    return false;
  }
}

// ---------- 信件範本 ----------
function wrap(title, inner, serviceEmail) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f4;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif">
<div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe7e0">
  <div style="background:#1f4d38;color:#efe9dc;padding:22px 28px">
    <div style="font-size:18px;font-weight:700;letter-spacing:.1em">樓下匹克球俱樂部</div>
    <div style="font-size:10px;letter-spacing:.28em;opacity:.8;text-transform:uppercase">Downstairs Pickleball Club</div>
  </div>
  <div style="padding:28px;color:#22352c;font-size:15px;line-height:1.9">
    <div style="font-size:17px;font-weight:700;color:#1f4d38;margin-bottom:12px">${title}</div>
    ${inner}
  </div>
  <div style="padding:16px 28px;border-top:1px solid #dbe7e0;font-size:12px;color:#5f7a6d;line-height:1.8">
    此信由系統自動寄出，請勿直接回覆。<br>
    如有問題請聯絡客服：<a href="mailto:${serviceEmail}" style="color:#1f4d38">${serviceEmail}</a>
  </div>
</div></body></html>`;
}

function btn(url, label) {
  return `<div style="text-align:center;margin:24px 0">
    <a href="${url}" style="display:inline-block;background:#1f4d38;color:#ffffff;text-decoration:none;
       font-weight:700;letter-spacing:.1em;padding:14px 36px;border-radius:999px">${label}</a></div>
  <div style="font-size:12px;color:#5f7a6d;word-break:break-all">按鈕無法點擊時，請複製此連結至瀏覽器開啟：<br>${url}</div>`;
}

function inviteEmail(name, url, serviceEmail) {
  return {
    subject: '樓下匹克球俱樂部 — 會員邀請，請設定您的密碼',
    html: wrap('歡迎加入！', `
      <p>${name} 您好，</p>
      <p>您已受邀成為 <b>樓下匹克球俱樂部</b> 私人會員。請點擊下方按鈕設定您的登入密碼（連結 7 天內有效）：</p>
      ${btn(url, '設定密碼並開通帳號')}
      <p style="margin-top:18px">開通後即可登入網站購買票券並預約場地，期待在球場見到您！</p>`, serviceEmail)
  };
}

function resetEmail(name, url, serviceEmail) {
  return {
    subject: '樓下匹克球俱樂部 — 重設密碼',
    html: wrap('重設密碼', `
      <p>${name} 您好，</p>
      <p>我們收到您重設密碼的請求。請點擊下方按鈕設定新密碼（連結 2 小時內有效）：</p>
      ${btn(url, '重設密碼')}
      <p style="margin-top:18px">若這不是您本人的操作，請忽略此信，您的密碼不會改變。</p>`, serviceEmail)
  };
}

module.exports = { enabled, send, inviteEmail, resetEmail };
