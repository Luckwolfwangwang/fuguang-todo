'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/dates');

test('date keys add across month and year boundaries', () => {
  assert.equal(D.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(D.addDays('2028-03-01', -1), '2028-02-29');
});

test('dayDiff is signed and timezone stable', () => {
  assert.equal(D.dayDiff('2026-11-10', '2026-11-16'), 6);
  assert.equal(D.dayDiff('2026-11-16', '2026-11-10'), -6);
  assert.equal(D.dayDiff('2026-11-16', '2026-11-16'), 0);
});

test('month helpers cover leap months and offsets', () => {
  assert.equal(D.daysInMonth('2028-02'), 29);
  assert.equal(D.daysInMonth('2026-11'), 30);
  assert.deepEqual(D.monthRange('2026-11'), { start: '2026-11-01', end: '2026-11-30' });
  assert.equal(D.addMonths('2026-11', 1), '2026-12');
  assert.equal(D.addMonths('2026-01', -1), '2025-12');
  assert.equal(D.formatMonthCN('2026-11'), '2026年11月');
});

test('Monday-first weekday index and Chinese labels', () => {
  assert.equal(D.weekdayMondayIndex('2026-11-16'), 0); // Monday
  assert.equal(D.weekdayName('2026-11-16'), '星期一');
  assert.equal(D.weekdayMondayIndex('2026-11-22'), 6); // Sunday
  assert.equal(D.relativeDay('2026-11-18', '2026-11-16'), '后天');
  assert.equal(D.relativeDay('2026-11-15', '2026-11-16'), '昨天');
});

test('date validation rejects impossible dates and times', () => {
  assert.equal(D.isValidDateKey('2026-02-30'), false);
  assert.equal(D.isValidDateKey('2026-2-3'), false);
  assert.equal(D.isValidDateKey('2026-11-16'), true);
  assert.equal(D.isValidTime('24:00'), false);
  assert.equal(D.isValidTime('09:05'), true);
  assert.equal(D.normalizeTime('9:05'), '09:05');
  assert.equal(D.normalizeTime('23:59'), '23:59');
  assert.equal(D.normalizeTime('25:00'), '09:00');
  assert.equal(D.hhmm(new Date(2026, 10, 16, 7, 3)), '07:03');
});
