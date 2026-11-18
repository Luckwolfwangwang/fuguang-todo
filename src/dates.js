'use strict';

/**
 * Local-date helpers shared by the main process, the data store and the tests.
 *
 * All "date keys" are local calendar days formatted as `YYYY-MM-DD`. Internally
 * we build Date objects at 12:00 local time so day arithmetic is unaffected by
 * daylight-saving transitions.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key == null ? '' : key));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function isValidDateKey(key) {
  return parseDateKey(key) !== null;
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayKey(now = new Date()) {
  return dateKey(now);
}

function isoToDateKey(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return dateKey(date);
}

function addDays(key, amount) {
  const date = parseDateKey(key);
  if (!date) return null;
  date.setDate(date.getDate() + Number(amount));
  return dateKey(date);
}

function dayDiff(fromKey, toKeyValue) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKeyValue);
  if (!from || !to) return NaN;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function monthKey(key) {
  return isValidDateKey(key) ? key.slice(0, 7) : null;
}

function isValidMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month == null ? '' : month));
}

function monthOf(date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function daysInMonth(month) {
  if (!isValidMonth(month)) return 0;
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function monthRange(month) {
  if (!isValidMonth(month)) return null;
  return {
    start: `${month}-01`,
    end: `${month}-${pad2(daysInMonth(month))}`,
  };
}

function addMonths(month, amount) {
  if (!isValidMonth(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + Number(amount), 1, 12, 0, 0, 0);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function weekdayIndex(key) {
  const date = parseDateKey(key);
  return date ? date.getDay() : NaN;
}

function weekdayName(key) {
  const index = weekdayIndex(key);
  return Number.isNaN(index) ? '' : WEEKDAYS[index];
}

/** Monday-first index: Monday = 0 … Sunday = 6. */
function weekdayMondayIndex(key) {
  const index = weekdayIndex(key);
  return Number.isNaN(index) ? NaN : (index + 6) % 7;
}

function formatDateCN(key, options = {}) {
  const date = parseDateKey(key);
  if (!date) return String(key == null ? '' : key);
  const prefix = options.year ? `${date.getFullYear()}年` : '';
  return `${prefix}${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatMonthCN(month) {
  if (!isValidMonth(month)) return String(month == null ? '' : month);
  const [year, monthNumber] = month.split('-').map(Number);
  return `${year}年${monthNumber}月`;
}

function relativeDay(key, today) {
  const diff = dayDiff(today, key);
  if (!Number.isFinite(diff)) return formatDateCN(key);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  if (diff === -2) return '前天';
  return formatDateCN(key);
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value == null ? '' : value));
}

function hhmm(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function timeToMinutes(value) {
  if (!isValidTime(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** "9:05" -> "09:05"; anything invalid returns the fallback. */
function normalizeTime(value, fallback = '09:00') {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value == null ? '' : value));
  if (!match) return fallback;
  const hours = Number(match[1]);
  if (hours > 23) return fallback;
  return `${pad2(hours)}:${match[2]}`;
}

function minutesToTime(totalMinutes) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  return `${pad2(Math.floor(bounded / 60))}:${pad2(bounded % 60)}`;
}

/** 12:30 -> "12:30"; 12:00 -> "12:00". */
function formatTimeCN(value) {
  return isValidTime(value) ? value : '--:--';
}

module.exports = {
  DAY_MS,
  WEEKDAYS,
  pad2,
  parseDateKey,
  isValidDateKey,
  dateKey,
  todayKey,
  isoToDateKey,
  addDays,
  dayDiff,
  monthKey,
  isValidMonth,
  monthOf,
  daysInMonth,
  monthRange,
  addMonths,
  weekdayIndex,
  weekdayName,
  weekdayMondayIndex,
  formatDateCN,
  formatMonthCN,
  relativeDay,
  isValidTime,
  hhmm,
  timeToMinutes,
  normalizeTime,
  minutesToTime,
  formatTimeCN,
};
