// 綠界 ECPay 全方位金流 AioCheckOut V5 整合
const crypto = require('crypto');

function cfg() {
  return {
    merchantId: process.env.ECPAY_MERCHANT_ID || '',
    hashKey: process.env.ECPAY_HASH_KEY || '',
    hashIv: process.env.ECPAY_HASH_IV || '',
    stage: process.env.ECPAY_STAGE !== '0'
  };
}

function enabled() {
  const c = cfg();
  return !!(c.merchantId && c.hashKey && c.hashIv);
}

function actionUrl() {
  return cfg().stage
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
}

// ECPay 專用 URL encode（.NET 風格，小寫，特定字元還原）
function ecpayEncode(str) {
  return encodeURIComponent(str)
    .toLowerCase()
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2a/g, '*')
    .replace(/%2d/g, '-')
    .replace(/%2e/g, '.')
    .replace(/%5f/g, '_');
}

function checkMacValue(params) {
  const c = cfg();
  const sorted = Object.keys(params)
    .filter(k => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(k => `${k}=${params[k]}`)
    .join('&');
  const raw = `HashKey=${c.hashKey}&${sorted}&HashIV=${c.hashIv}`;
  return crypto.createHash('sha256').update(ecpayEncode(raw)).digest('hex').toUpperCase();
}

// 產生自動送出的付款表單 HTML
function buildCheckoutForm(order, baseUrl) {
  const c = cfg();
  const params = {
    MerchantID: c.merchantId,
    MerchantTradeNo: order.merchant_trade_no,
    MerchantTradeDate: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '/'),
    PaymentType: 'aio',
    TotalAmount: String(order.amount),
    TradeDesc: 'DownstairsPickleballClub',
    ItemName: order.item_name.replace(/#/g, ''),
    ReturnURL: `${baseUrl}/pay/ecpay/notify`,
    OrderResultURL: `${baseUrl}/pay/ecpay/result`,
    ChoosePayment: 'Credit',
    EncryptType: '1'
  };
  params.CheckMacValue = checkMacValue(params);
  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`)
    .join('\n');
  return `<form id="ecpay" method="post" action="${actionUrl()}">${inputs}</form>
<script>document.getElementById('ecpay').submit();</script>`;
}

// 驗證綠界回傳
function verifyNotify(body) {
  const mac = body.CheckMacValue;
  if (!mac) return false;
  return checkMacValue(body) === mac;
}

module.exports = { enabled, buildCheckoutForm, verifyNotify };
