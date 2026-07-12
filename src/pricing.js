const { db } = require('./db');

// 每時段 1 小時，開放 09:00–22:00（開始時間 09..21）
const HOURS = Array.from({ length: 13 }, (_, i) => 9 + i);
const COURTS = [1, 2, 3, 4];

const PASS_TYPES = {
  OFFPEAK: { name: '離峰券', desc: '平日 17:00 前・全場地通用', price: 700 },
  PEAK23:  { name: '尖峰券（2・3號場）', desc: '平日 17:00 後、週末及國定假日', price: 1000 },
  PEAK14:  { name: '尖峰券（1・4號場）', desc: '平日 17:00 後、週末及國定假日', price: 1200 }
};

function isHoliday(dateStr) {
  return !!db.prepare('SELECT date FROM holidays WHERE date = ?').get(dateStr);
}

function weekday(dateStr) { // 0=Sun..6=Sat
  return new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10))).getUTCDay();
}

function isWeekend(dateStr) {
  const wd = weekday(dateStr);
  return wd === 0 || wd === 6;
}

function slotPassType(court, dateStr, hour) {
  const peakDay = isWeekend(dateStr) || isHoliday(dateStr);
  if (!peakDay && hour < 17) return 'OFFPEAK';
  return (court === 1 || court === 4) ? 'PEAK14' : 'PEAK23';
}

// 現在時間（台北）
function taipeiNow() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }); // "YYYY-MM-DD HH:mm:ss"
  return { date: s.slice(0, 10), hour: +s.slice(11, 13), minute: +s.slice(14, 16) };
}

function hoursUntilSlot(dateStr, hour) {
  const startMs = Date.parse(`${dateStr}T${String(hour).padStart(2, '0')}:00:00+08:00`);
  return (startMs - Date.now()) / 36e5;
}

module.exports = { HOURS, COURTS, PASS_TYPES, isHoliday, isWeekend, weekday, slotPassType, taipeiNow, hoursUntilSlot };
