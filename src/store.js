'use strict';

/**
 * 浮光待办 data store.
 *
 * A single JSON document (with a rolling .bak and daily snapshots) holds the
 * four-quadrant tasks, the daily check-in habits and the appointments. The
 * store is deliberately free of Electron imports so the scheduling rules,
 * roll-over logic and monthly report can be exercised by plain Node tests.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const D = require('./dates');

const APP_NAME = '浮光待办';
const SCHEMA_VERSION = 2;

const QUADRANTS = [
  { id: 1, name: '重要 · 紧急', hint: '马上做', color: '#ff7e7e' },
  { id: 2, name: '重要 · 不紧急', hint: '计划做', color: '#63d7ff' },
  { id: 3, name: '紧急 · 不重要', hint: '尽快做', color: '#ffc46b' },
  { id: 4, name: '不紧急 · 不重要', hint: '有空做', color: '#b8a7ff' },
];

const DEFAULT_SETTINGS = Object.freeze({
  hoverEnabled: true,
  desktopOnlyHover: true,
  notifications: true,
  pinned: false,
  startAtLogin: false,
  appointmentTime: '09:00',
  firstRunDone: false,
});

class TodoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TodoError';
  }
}

function assert(condition, message) {
  if (!condition) throw new TodoError(message);
}

function uid(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function validIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeQuadrant(value) {
  const number = Number(value);
  return QUADRANTS.some((quadrant) => quadrant.id === number) ? number : 2;
}

/** 0 means "not estimated"; otherwise a whole number of minutes, max 24h. */
function normalizeEstimate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(5, Math.min(1440, Math.round(number)));
}

function cleanText(value, options = {}) {
  const { max = 120, field = '内容', optional = false } = options;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (optional) return '';
    throw new TodoError(`请填写${field}`);
  }
  return text.slice(0, max);
}

function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    hoverEnabled: input.hoverEnabled !== false,
    desktopOnlyHover: input.desktopOnlyHover !== false,
    notifications: input.notifications !== false,
    pinned: input.pinned === true,
    startAtLogin: input.startAtLogin === true,
    appointmentTime: D.normalizeTime(input.appointmentTime, DEFAULT_SETTINGS.appointmentTime),
    firstRunDone: input.firstRunDone === true,
  };
}

function defaultState(now = new Date()) {
  return {
    schema: SCHEMA_VERSION,
    createdAt: now.toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    habits: [],
    appointments: [],
    meta: {
      lastRolloverDate: D.todayKey(now),
    },
  };
}

function normalizeTask(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
  if (!title) return null;
  const fallbackDate = D.isValidDateKey(raw.originDate) ? raw.originDate : D.todayKey(now);
  const date = D.isValidDateKey(raw.date) ? raw.date : fallbackDate;
  const originDate = D.isValidDateKey(raw.originDate) ? raw.originDate : date;
  const done = raw.done === true;
  const doneAt = done ? validIso(raw.doneAt) : null;
  let completedLateDays = 0;
  if (done) {
    const stored = Number(raw.completedLateDays);
    if (Number.isFinite(stored) && stored > 0) completedLateDays = Math.round(stored);
    else if (doneAt) {
      const diff = D.dayDiff(originDate, D.isoToDateKey(doneAt));
      completedLateDays = Number.isFinite(diff) && diff > 0 ? diff : 0;
    }
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('task'),
    title,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    quadrant: normalizeQuadrant(raw.quadrant),
    estimateMinutes: normalizeEstimate(raw.estimateMinutes),
    date,
    originDate,
    done,
    doneAt,
    completedLateDays,
    createdAt: validIso(raw.createdAt) || now.toISOString(),
    updatedAt: validIso(raw.updatedAt) || validIso(raw.createdAt) || now.toISOString(),
  };
}

function normalizeHabit(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
  if (!title) return null;
  const checkins = {};
  if (raw.checkins && typeof raw.checkins === 'object') {
    for (const [key, value] of Object.entries(raw.checkins)) {
      if (!D.isValidDateKey(key) || !value) continue;
      checkins[key] = validIso(value) || now.toISOString();
    }
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('habit'),
    title,
    time: D.normalizeTime(raw.time, '20:00'),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
    createdAt: D.isValidDateKey(raw.createdAt) ? raw.createdAt : D.todayKey(now),
    checkins,
    notifiedDate: D.isValidDateKey(raw.notifiedDate) ? raw.notifiedDate : null,
  };
}

function normalizeAppointment(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
  if (!title || !D.isValidDateKey(raw.date)) return null;
  const notified = {};
  if (raw.notified && typeof raw.notified === 'object') {
    for (const [key, value] of Object.entries(raw.notified)) {
      if (D.isValidDateKey(key) && value) notified[key] = true;
    }
  }
  const done = raw.done === true;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('appointment'),
    title,
    date: raw.date,
    time: D.normalizeTime(raw.time, '09:00'),
    quadrant: normalizeQuadrant(raw.quadrant),
    location: typeof raw.location === 'string' ? raw.location.slice(0, 160) : '',
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    done,
    doneAt: done ? validIso(raw.doneAt) : null,
    notified,
    createdAt: validIso(raw.createdAt) || now.toISOString(),
  };
}

function normalizeState(raw, now) {
  const state = defaultState(now);
  if (!raw || typeof raw !== 'object') return state;

  state.createdAt = validIso(raw.createdAt) || state.createdAt;
  state.settings = normalizeSettings(raw.settings);

  const seenTasks = new Set();
  if (Array.isArray(raw.tasks)) {
    for (const item of raw.tasks) {
      const task = normalizeTask(item, now);
      if (!task || seenTasks.has(task.id)) continue;
      seenTasks.add(task.id);
      state.tasks.push(task);
    }
  }

  const seenHabits = new Set();
  if (Array.isArray(raw.habits)) {
    for (const item of raw.habits) {
      const habit = normalizeHabit(item, now);
      if (!habit || seenHabits.has(habit.id)) continue;
      seenHabits.add(habit.id);
      state.habits.push(habit);
    }
  }

  const seenAppointments = new Set();
  if (Array.isArray(raw.appointments)) {
    for (const item of raw.appointments) {
      const appointment = normalizeAppointment(item, now);
      if (!appointment || seenAppointments.has(appointment.id)) continue;
      seenAppointments.add(appointment.id);
      state.appointments.push(appointment);
    }
  }

  const lastRolloverDate = raw.meta && D.isValidDateKey(raw.meta.lastRolloverDate)
    ? raw.meta.lastRolloverDate
    : D.todayKey(now);
  state.meta = { lastRolloverDate };

  return state;
}

function sortByCreated(a, b) {
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

function percent(part, total) {
  if (!total) return 0;
  return part / total;
}

class TodoStore {
  constructor(options = {}) {
    const { file, now, logger } = options;
    if (!file) throw new Error('TodoStore requires a data file path');
    this.file = file;
    this.now = typeof now === 'function' ? now : () => new Date();
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.backupDir = path.join(path.dirname(file), 'backups');
    this.recovered = false;
    this.state = defaultState(this.now());
  }

  // ---------------------------------------------------------------- lifecycle

  open() {
    const loaded = this.readFromDisk();
    this.state = loaded || defaultState(this.now());
    if (this.recovered) {
      try {
        this.save();
      } catch (error) {
        this.logger('could not rebuild data file from backup', error.message);
      }
    }
    this.rolloverIfNeeded();
    return this;
  }

  readFromDisk() {
    const candidates = [this.file, `${this.file}.bak`];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw);
        this.recovered = index > 0;
        return normalizeState(parsed, this.now());
      } catch (error) {
        if (error && error.code !== 'ENOENT') {
          this.logger('data file failed to load', candidate, error.message);
        }
      }
    }
    return null;
  }

  save() {
    const json = JSON.stringify(this.state, null, 2);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, json, 'utf8');
    try {
      fs.renameSync(temporary, this.file);
    } catch (error) {
      // Windows can refuse to replace a file that another process has open.
      if (error && (error.code === 'EPERM' || error.code === 'EEXIST')) {
        fs.rmSync(this.file, { force: true });
        fs.renameSync(temporary, this.file);
      } else {
        throw error;
      }
    }
    try {
      fs.copyFileSync(this.file, `${this.file}.bak`);
    } catch (error) {
      this.logger('backup copy failed', error.message);
    }
  }

  ensureDailyBackup(now = this.now()) {
    try {
      if (!fs.existsSync(this.file)) return null;
      fs.mkdirSync(this.backupDir, { recursive: true });
      const target = path.join(this.backupDir, `data-${D.todayKey(now)}.json`);
      if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(this.backupDir)
        .filter((name) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort();
      while (files.length > 60) {
        fs.rmSync(path.join(this.backupDir, files.shift()), { force: true });
      }
      return target;
    } catch (error) {
      this.logger('daily backup failed', error.message);
      return null;
    }
  }

  // ---------------------------------------------------------------- roll-over

  /**
   * Unfinished daily tasks move to today and keep their original date, which is
   * what powers the “拖延 N 天” badge. Safe to call repeatedly.
   */
  rolloverIfNeeded() {
    const now = this.now();
    const today = D.todayKey(now);
    let changed = false;
    for (const task of this.state.tasks) {
      if (!task.done && task.date < today) {
        task.date = today;
        task.updatedAt = now.toISOString();
        changed = true;
      }
    }
    if (this.state.meta.lastRolloverDate !== today) {
      this.state.meta.lastRolloverDate = today;
      changed = true;
    }
    if (changed) {
      try {
        this.save();
      } catch (error) {
        this.logger('rollover save failed', error.message);
      }
    }
    return changed;
  }

  // -------------------------------------------------------------------- tasks

  addTask(input = {}) {
    const now = this.now();
    const today = D.todayKey(now);
    const title = cleanText(input.title, { field: '待办内容', max: 120 });
    let date = D.isValidDateKey(input.date) ? input.date : today;
    if (date < today) date = today;
    const task = {
      id: uid('task'),
      title,
      note: cleanText(input.note, { field: '备注', max: 500, optional: true }),
      quadrant: normalizeQuadrant(input.quadrant),
      estimateMinutes: normalizeEstimate(input.estimateMinutes),
      date,
      originDate: date,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.state.tasks.push(task);
    this.save();
    return task;
  }

  findTask(id) {
    return this.state.tasks.find((task) => task.id === id) || null;
  }

  updateTask(id, patch = {}) {
    const task = this.findTask(id);
    assert(task, '找不到这条待办');
    const now = this.now();
    const today = D.todayKey(now);
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
      task.title = cleanText(patch.title, { field: '待办内容', max: 120 });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
      task.note = cleanText(patch.note, { field: '备注', max: 500, optional: true });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'quadrant')) {
      task.quadrant = normalizeQuadrant(patch.quadrant);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'estimateMinutes')) {
      task.estimateMinutes = normalizeEstimate(patch.estimateMinutes);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'date') && !task.done) {
      let date = D.isValidDateKey(patch.date) ? patch.date : task.date;
      if (date < today) date = today;
      if (date !== task.date) {
        // Deliberately rescheduling resets the delay counter.
        task.date = date;
        task.originDate = date;
      }
    }
    task.updatedAt = now.toISOString();
    this.save();
    return task;
  }

  toggleTask(id, done) {
    const task = this.findTask(id);
    assert(task, '找不到这条待办');
    const now = this.now();
    const today = D.todayKey(now);
    const nextDone = typeof done === 'boolean' ? done : !task.done;
    if (nextDone && !task.done) {
      task.done = true;
      task.doneAt = now.toISOString();
      const diff = D.dayDiff(task.originDate, D.isoToDateKey(task.doneAt));
      task.completedLateDays = Number.isFinite(diff) && diff > 0 ? diff : 0;
    } else if (!nextDone && task.done) {
      task.done = false;
      task.doneAt = null;
      task.completedLateDays = 0;
    }
    task.updatedAt = now.toISOString();
    this.save();
    if (!task.done) this.rolloverIfNeeded();
    return task;
  }

  deleteTask(id) {
    const index = this.state.tasks.findIndex((task) => task.id === id);
    assert(index >= 0, '找不到这条待办');
    const [removed] = this.state.tasks.splice(index, 1);
    this.save();
    return removed;
  }

  // ------------------------------------------------------------------- habits

  addHabit(input = {}) {
    const now = this.now();
    const habit = {
      id: uid('habit'),
      title: cleanText(input.title, { field: '打卡内容', max: 120 }),
      time: D.normalizeTime(input.time, '20:00'),
      note: cleanText(input.note, { field: '说明', max: 300, optional: true }),
      createdAt: D.todayKey(now),
      checkins: {},
      notifiedDate: null,
    };
    this.state.habits.push(habit);
    this.save();
    return habit;
  }

  findHabit(id) {
    return this.state.habits.find((habit) => habit.id === id) || null;
  }

  updateHabit(id, patch = {}) {
    const habit = this.findHabit(id);
    assert(habit, '找不到这个打卡项');
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
      habit.title = cleanText(patch.title, { field: '打卡内容', max: 120 });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
      habit.note = cleanText(patch.note, { field: '说明', max: 300, optional: true });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'time')) {
      const time = D.normalizeTime(patch.time, habit.time);
      if (time !== habit.time) {
        habit.time = time;
        // Let the new time fire today instead of staying silenced by the old one.
        habit.notifiedDate = null;
      }
    }
    this.save();
    return habit;
  }

  deleteHabit(id) {
    const index = this.state.habits.findIndex((habit) => habit.id === id);
    assert(index >= 0, '找不到这个打卡项');
    const [removed] = this.state.habits.splice(index, 1);
    this.save();
    return removed;
  }

  toggleHabitCheckin(id, dateKey) {
    const habit = this.findHabit(id);
    assert(habit, '找不到这个打卡项');
    assert(D.isValidDateKey(dateKey), '打卡日期不正确');
    const today = D.todayKey(this.now());
    assert(dateKey <= today, '不能给未来的日子打卡');
    assert(dateKey >= habit.createdAt, '这一天还没有这个打卡项');
    if (habit.checkins[dateKey]) {
      delete habit.checkins[dateKey];
    } else {
      habit.checkins[dateKey] = this.now().toISOString();
    }
    this.save();
    return habit;
  }

  habitStreak(habit, today) {
    let cursor = habit.checkins[today] ? today : D.addDays(today, -1);
    let count = 0;
    while (cursor && cursor >= habit.createdAt) {
      if (!habit.checkins[cursor]) break;
      count += 1;
      cursor = D.addDays(cursor, -1);
    }
    return count;
  }

  habitMonthStats(habit, month, today) {
    const currentMonth = D.monthKey(today);
    const range = D.monthRange(month);
    if (!range) return { expected: 0, done: 0, missed: 0, rate: 0, longest: 0, start: null, end: null };
    let end = null;
    if (month < currentMonth) end = range.end;
    else if (month === currentMonth) end = today < range.end ? today : range.end;
    const start = habit.createdAt > range.start ? habit.createdAt : range.start;
    if (!end || start > end) {
      return { expected: 0, done: 0, missed: 0, rate: 0, longest: 0, start: null, end: null };
    }
    let done = 0;
    let current = 0;
    let longest = 0;
    for (let key = start; key <= end; key = D.addDays(key, 1)) {
      if (habit.checkins[key]) {
        done += 1;
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    const expected = D.dayDiff(start, end) + 1;
    return {
      expected,
      done,
      missed: expected - done,
      rate: percent(done, expected),
      longest,
      start,
      end,
    };
  }

  // ------------------------------------------------------------- appointments

  addAppointment(input = {}) {
    const now = this.now();
    const today = D.todayKey(now);
    const title = cleanText(input.title, { field: '预约内容', max: 120 });
    assert(D.isValidDateKey(input.date), '请选择预约日期');
    assert(input.date >= today, '预约日期不能早于今天');
    const appointment = {
      id: uid('appointment'),
      title,
      date: input.date,
      time: D.normalizeTime(input.time, '09:00'),
      quadrant: normalizeQuadrant(input.quadrant),
      location: cleanText(input.location, { field: '地点', max: 160, optional: true }),
      note: cleanText(input.note, { field: '备注', max: 500, optional: true }),
      done: false,
      doneAt: null,
      notified: {},
      createdAt: now.toISOString(),
    };
    this.state.appointments.push(appointment);
    this.save();
    return appointment;
  }

  findAppointment(id) {
    return this.state.appointments.find((appointment) => appointment.id === id) || null;
  }

  updateAppointment(id, patch = {}) {
    const appointment = this.findAppointment(id);
    assert(appointment, '找不到这个预约');
    const now = this.now();
    const today = D.todayKey(now);
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
      appointment.title = cleanText(patch.title, { field: '预约内容', max: 120 });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'date')) {
      assert(D.isValidDateKey(patch.date), '请选择预约日期');
      if (patch.date !== appointment.date) {
        assert(patch.date >= today, '预约日期不能早于今天');
        appointment.date = patch.date;
        appointment.notified = {};
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'time')) {
      appointment.time = D.normalizeTime(patch.time, appointment.time);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'quadrant')) {
      appointment.quadrant = normalizeQuadrant(patch.quadrant);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'location')) {
      appointment.location = cleanText(patch.location, { field: '地点', max: 160, optional: true });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
      appointment.note = cleanText(patch.note, { field: '备注', max: 500, optional: true });
    }
    this.save();
    return appointment;
  }

  toggleAppointmentDone(id, done) {
    const appointment = this.findAppointment(id);
    assert(appointment, '找不到这个预约');
    const nextDone = typeof done === 'boolean' ? done : !appointment.done;
    appointment.done = nextDone;
    appointment.doneAt = nextDone ? this.now().toISOString() : null;
    this.save();
    return appointment;
  }

  deleteAppointment(id) {
    const index = this.state.appointments.findIndex((appointment) => appointment.id === id);
    assert(index >= 0, '找不到这个预约');
    const [removed] = this.state.appointments.splice(index, 1);
    this.save();
    return removed;
  }

  // ----------------------------------------------------------------- settings

  updateSettings(patch = {}) {
    const settings = this.state.settings;
    if (Object.prototype.hasOwnProperty.call(patch, 'hoverEnabled')) settings.hoverEnabled = patch.hoverEnabled !== false;
    if (Object.prototype.hasOwnProperty.call(patch, 'desktopOnlyHover')) settings.desktopOnlyHover = patch.desktopOnlyHover !== false;
    if (Object.prototype.hasOwnProperty.call(patch, 'notifications')) settings.notifications = patch.notifications !== false;
    if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) settings.pinned = patch.pinned === true;
    if (Object.prototype.hasOwnProperty.call(patch, 'startAtLogin')) settings.startAtLogin = patch.startAtLogin === true;
    if (Object.prototype.hasOwnProperty.call(patch, 'appointmentTime')) {
      settings.appointmentTime = D.normalizeTime(patch.appointmentTime, settings.appointmentTime);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'firstRunDone')) settings.firstRunDone = patch.firstRunDone === true;
    this.save();
    return settings;
  }

  // ---------------------------------------------------------------- reminders

  collectDueHabitReminders(now = this.now()) {
    const today = D.todayKey(now);
    const current = D.timeToMinutes(D.hhmm(now));
    return this.state.habits.filter((habit) => {
      if (habit.createdAt > today) return false;
      if (habit.checkins[today]) return false;
      if (habit.notifiedDate === today) return false;
      const at = D.timeToMinutes(habit.time);
      return Number.isFinite(at) && at <= current;
    });
  }

  markHabitRemindersNotified(habits, now = this.now()) {
    const today = D.todayKey(now);
    for (const entry of habits || []) {
      const habit = typeof entry === 'string' ? this.findHabit(entry) : entry;
      if (habit) habit.notifiedDate = today;
    }
    this.save();
  }

  collectDueAppointmentReminders(now = this.now()) {
    const today = D.todayKey(now);
    const current = D.timeToMinutes(D.hhmm(now));
    const notifyAt = D.timeToMinutes(this.state.settings.appointmentTime);
    if (!Number.isFinite(current) || !Number.isFinite(notifyAt) || current < notifyAt) return [];
    const due = [];
    for (const appointment of this.state.appointments) {
      if (appointment.done) continue;
      if (!D.isValidDateKey(appointment.date) || appointment.date < today) continue;
      if (appointment.notified && appointment.notified[today]) continue;
      const twoDaysBefore = D.addDays(appointment.date, -2);
      const oneDayBefore = D.addDays(appointment.date, -1);
      if (today === twoDaysBefore) due.push({ appointment, daysBefore: 2, fireDate: today });
      else if (today === oneDayBefore) due.push({ appointment, daysBefore: 1, fireDate: today });
    }
    return due;
  }

  markAppointmentRemindersNotified(items, now = this.now()) {
    const today = D.todayKey(now);
    for (const entry of items || []) {
      const appointment = entry && entry.appointment ? entry.appointment : entry;
      if (!appointment) continue;
      appointment.notified = appointment.notified || {};
      appointment.notified[today] = true;
    }
    this.save();
  }

  appointmentReminderPlan(dateKey, now = this.now()) {
    const today = D.todayKey(now);
    const plan = [];
    for (const days of [2, 1]) {
      const date = D.addDays(dateKey, -days);
      if (!date) continue;
      plan.push({
        days,
        date,
        passed: date < today,
        today: date === today,
        label: D.relativeDay(date, today),
      });
    }
    return plan;
  }

  // ------------------------------------------------------------------ reports

  buildMonthReport(month) {
    const now = this.now();
    const today = D.todayKey(now);
    const currentMonth = D.monthKey(today);
    const selected = D.isValidMonth(month) ? month : currentMonth;
    const range = D.monthRange(selected);
    const isCurrent = selected === currentMonth;
    const isFuture = selected > currentMonth;

    const habits = this.state.habits
      .filter((habit) => habit.createdAt <= range.end)
      .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt))
      .map((habit) => {
        const stats = this.habitMonthStats(habit, selected, today);
        return {
          id: habit.id,
          title: habit.title,
          time: habit.time,
          createdAt: habit.createdAt,
          ...stats,
        };
      });

    const totals = habits.reduce((accumulator, habit) => {
      accumulator.expected += habit.expected;
      accumulator.done += habit.done;
      accumulator.missed += habit.missed;
      accumulator.longest = Math.max(accumulator.longest, habit.longest);
      return accumulator;
    }, { expected: 0, done: 0, missed: 0, longest: 0 });
    totals.rate = percent(totals.done, totals.expected);

    const completed = this.state.tasks.filter((task) => {
      const key = task.doneAt ? D.isoToDateKey(task.doneAt) : null;
      return key && D.monthKey(key) === selected;
    });
    const lateTasks = completed.filter((task) => Number(task.completedLateDays) > 0);
    const totalDelay = lateTasks.reduce((sum, task) => sum + Number(task.completedLateDays || 0), 0);
    const tasks = {
      done: completed.length,
      onTime: completed.length - lateTasks.length,
      late: lateTasks.length,
      avgDelay: lateTasks.length ? Math.round((totalDelay / lateTasks.length) * 10) / 10 : 0,
      created: this.state.tasks.filter((task) => {
        const key = D.isoToDateKey(task.createdAt);
        return key && D.monthKey(key) === selected;
      }).length,
      openBacklog: isFuture ? 0 : this.state.tasks.filter((task) => !task.done && task.date <= today).length,
    };

    const appointmentsInMonth = this.state.appointments.filter((appointment) => D.monthKey(appointment.date) === selected);
    const appointmentDone = appointmentsInMonth.filter((appointment) => appointment.done).length;
    const dueAppointments = appointmentsInMonth.filter((appointment) => appointment.date <= today);
    const doneDue = dueAppointments.filter((appointment) => appointment.done).length;
    const appointments = {
      total: appointmentsInMonth.length,
      done: appointmentDone,
      due: dueAppointments.length,
      doneDue,
      missed: appointmentsInMonth.filter((appointment) => !appointment.done && appointment.date < today).length,
      upcoming: appointmentsInMonth.filter((appointment) => !appointment.done && appointment.date > today).length,
      // Only appointments whose day has arrived can be judged as kept or missed.
      rate: percent(doneDue, dueAppointments.length),
    };

    const days = [];
    if (!isFuture) {
      const end = isCurrent ? today : range.end;
      const activeHabits = this.state.habits.filter((habit) => habit.createdAt <= end);
      const tasksByOrigin = new Map();
      for (const task of this.state.tasks) {
        if (!task.originDate) continue;
        const list = tasksByOrigin.get(task.originDate) || [];
        list.push(task);
        tasksByOrigin.set(task.originDate, list);
      }
      for (let key = range.start; key <= end; key = D.addDays(key, 1)) {
        const habitTotal = activeHabits.filter((habit) => habit.createdAt <= key).length;
        const habitDone = activeHabits.filter((habit) => habit.createdAt <= key && habit.checkins[key]).length;
        const dueTasks = tasksByOrigin.get(key) || [];
        days.push({
          date: key,
          day: Number(key.slice(8)),
          habitDone,
          habitTotal,
          tasksDue: dueTasks.length,
          tasksDone: dueTasks.filter((task) => task.done).length,
        });
      }
    }

    return {
      month: selected,
      monthLabel: D.formatMonthCN(selected),
      isCurrent,
      isFuture,
      generatedAt: now.toISOString(),
      habits,
      totals,
      tasks,
      appointments,
      days,
    };
  }

  buildMonthCsv(month) {
    const report = this.buildMonthReport(month);
    const escape = (value) => {
      const text = value == null ? '' : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = [];
    const push = (...cells) => rows.push(cells);
    push(`${APP_NAME} 月度统计报表`, report.monthLabel);
    push('生成时间', new Date(report.generatedAt).toLocaleString('zh-CN'));
    push();
    push('概览', '数值');
    push('习惯完成率', `${Math.round(report.totals.rate * 100)}%`);
    push('习惯打卡天数', `${report.totals.done}/${report.totals.expected}`);
    push('待办完成', report.tasks.done);
    push('按时完成', report.tasks.onTime);
    push('拖延后完成', report.tasks.late);
    push('平均拖延天数', report.tasks.avgDelay);
    push('预约总数', report.appointments.total);
    push('预约已到期', report.appointments.due);
    push('预约完成', report.appointments.done);
    push();
    push('打卡项', '提醒时间', '应打卡天数', '已打卡天数', '完成率', '最长连续天数');
    for (const habit of report.habits) {
      push(habit.title, habit.time, habit.expected, habit.done, `${Math.round(habit.rate * 100)}%`, habit.longest);
    }
    if (!report.habits.length) push('（本月没有打卡项）');
    push();
    push('日期', '打卡完成', '打卡应完成', '待办应完成', '待办完成');
    for (const day of report.days) {
      push(day.date, day.habitDone, day.habitTotal, day.tasksDue, day.tasksDone);
    }
    return `\ufeff${rows.map((row) => row.map(escape).join(',')).join('\r\n')}\r\n`;
  }

  // ---------------------------------------------------------------- snapshots

  taskView(task, today) {
    const deferredDays = task.done ? 0 : Math.max(0, D.dayDiff(task.originDate, today) || 0);
    return {
      ...task,
      deferredDays,
      isDeferred: deferredDays > 0,
    };
  }

  habitView(habit, month, today) {
    const stats = this.habitMonthStats(habit, month, today);
    return {
      id: habit.id,
      title: habit.title,
      time: habit.time,
      note: habit.note,
      createdAt: habit.createdAt,
      checkins: habit.checkins,
      checkedToday: Boolean(habit.checkins[today]),
      todayAt: habit.checkins[today] || null,
      streak: this.habitStreak(habit, today),
      monthDone: stats.done,
      monthExpected: stats.expected,
      monthRate: stats.rate,
      monthLongest: stats.longest,
      activeToday: habit.createdAt <= today,
    };
  }

  appointmentView(appointment, today) {
    const daysUntil = D.dayDiff(today, appointment.date);
    let status = 'upcoming';
    if (appointment.done) status = 'done';
    else if (daysUntil < 0) status = 'overdue';
    else if (daysUntil === 0) status = 'today';
    const reminderDates = [2, 1]
      .map((days) => {
        const date = D.addDays(appointment.date, -days);
        return date && date < appointment.date
          ? { days, date, passed: date < today, today: date === today }
          : null;
      })
      .filter(Boolean);
    return {
      ...appointment,
      daysUntil,
      status,
      reminderDates,
      nextReminderDate: (reminderDates.find((entry) => !entry.passed) || {}).date || null,
    };
  }

  buildSnapshot(options = {}) {
    const now = this.now();
    this.rolloverIfNeeded();
    const today = D.todayKey(now);
    const currentMonth = D.monthKey(today);
    const selectedMonth = D.isValidMonth(options.month) ? options.month : currentMonth;

    const tasksToday = this.state.tasks.filter((task) => task.date === today);
    const openToday = tasksToday.filter((task) => !task.done).sort(sortByCreated);
    const doneScheduledToday = tasksToday.filter((task) => task.done);
    const completedToday = this.state.tasks
      .filter((task) => task.done && task.doneAt && D.isoToDateKey(task.doneAt) === today)
      .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));

    const quadrants = QUADRANTS.map((quadrant) => ({
      ...quadrant,
      open: openToday.filter((task) => task.quadrant === quadrant.id).map((task) => this.taskView(task, today)),
      done: doneScheduledToday.filter((task) => task.quadrant === quadrant.id).map((task) => this.taskView(task, today)),
    }));

    const delayed = openToday.filter((task) => task.originDate < today).length;
    const todayStats = {
      open: openToday.length,
      done: doneScheduledToday.length,
      total: openToday.length + doneScheduledToday.length,
      delayed,
      rate: percent(doneScheduledToday.length, openToday.length + doneScheduledToday.length),
    };

    const habits = this.state.habits
      .map((habit) => this.habitView(habit, selectedMonth, today))
      .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt));

    const appointments = this.state.appointments
      .map((appointment) => this.appointmentView(appointment, today))
      .sort((a, b) => {
        const order = { today: 0, upcoming: 1, overdue: 2, done: 3 };
        const rank = (order[a.status] ?? 4) - (order[b.status] ?? 4);
        if (rank !== 0) return rank;
        return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
      });

    const counts = {
      tasksOpen: openToday.length,
      tasksDoneToday: doneScheduledToday.length,
      tasksDelayed: delayed,
      habitsDue: habits.filter((habit) => habit.activeToday && !habit.checkedToday).length,
      habitsTotal: habits.filter((habit) => habit.activeToday).length,
      appointmentsUpcoming: appointments.filter((appointment) => appointment.status === 'upcoming').length,
      appointmentsToday: appointments.filter((appointment) => appointment.status === 'today').length,
      appointmentsOverdue: appointments.filter((appointment) => appointment.status === 'overdue').length,
    };

    return {
      today,
      todayLabel: D.formatDateCN(today, { year: true }),
      weekday: D.weekdayName(today),
      nowHM: D.hhmm(now),
      nowIso: now.toISOString(),
      month: selectedMonth,
      monthLabel: D.formatMonthCN(selectedMonth),
      currentMonth,
      settings: { ...this.state.settings },
      quadrants,
      doneToday: completedToday.map((task) => this.taskView(task, today)),
      todayStats,
      habits,
      appointments,
      counts,
      report: this.buildMonthReport(selectedMonth),
      firstRun: !this.state.settings.firstRunDone,
      appName: APP_NAME,
    };
  }
}

module.exports = {
  APP_NAME,
  SCHEMA_VERSION,
  QUADRANTS,
  DEFAULT_SETTINGS,
  TodoError,
  TodoStore,
  normalizeState,
};
