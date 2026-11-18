'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TodoStore, TodoError, normalizeState } = require('../src/store');

function createHarness(initial = new Date(2026, 10, 16, 9, 0)) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-'));
  let current = initial;
  const store = new TodoStore({
    file: path.join(dir, 'data.json'),
    now: () => current,
  });
  store.open();
  return {
    store,
    dir,
    setNow(date) {
      current = date;
    },
    advance(days, hour = 9, minute = 0) {
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + days, hour, minute);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('task lifecycle: create, complete, no duplicate snapshot entries', (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const task = h.store.addTask({ title: '写周报', note: '把本周进展整理一下', quadrant: 1 });
  assert.equal(task.date, '2026-11-16');
  assert.equal(task.originDate, '2026-11-16');

  let snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.today, '2026-11-16');
  assert.equal(snapshot.quadrants[0].open.length, 1);
  assert.equal(snapshot.quadrants[0].open[0].title, '写周报');
  assert.equal(snapshot.todayStats.total, 1);
  assert.equal(snapshot.todayStats.rate, 0);

  h.store.toggleTask(task.id, true);
  snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.quadrants[0].open.length, 0);
  assert.equal(snapshot.quadrants[0].done.length, 1);
  assert.equal(snapshot.doneToday.length, 1);
  assert.equal(snapshot.todayStats.done, 1);
  assert.equal(snapshot.todayStats.rate, 1);

  h.store.toggleTask(task.id, false);
  snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.quadrants[0].open.length, 1);
  assert.equal(snapshot.doneToday.length, 0);
});

test('unfinished tasks roll over to today and report delay days', (t) => {
  const h = createHarness(new Date(2026, 10, 10, 9, 0));
  t.after(() => h.cleanup());

  const task = h.store.addTask({ title: '整理桌面', quadrant: 3 });
  h.advance(2, 8, 30); // Nov 12

  let snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.today, '2026-11-12');
  assert.equal(snapshot.quadrants[2].open.length, 1);
  assert.equal(snapshot.quadrants[2].open[0].deferredDays, 2);
  assert.equal(snapshot.quadrants[2].open[0].isDeferred, true);
  assert.equal(h.store.state.meta.lastRolloverDate, '2026-11-12');

  h.store.toggleTask(task.id, true);
  const stored = h.store.findTask(task.id);
  assert.equal(stored.done, true);
  assert.equal(stored.completedLateDays, 2);

  const report = h.store.buildMonthReport('2026-11');
  assert.equal(report.tasks.done, 1);
  assert.equal(report.tasks.late, 1);
  assert.equal(report.tasks.onTime, 0);
  assert.equal(report.tasks.avgDelay, 2);
});

test('rescheduling a delayed task resets its delay counter', (t) => {
  const h = createHarness(new Date(2026, 10, 10, 9, 0));
  t.after(() => h.cleanup());

  const task = h.store.addTask({ title: '打电话', quadrant: 1 });
  h.advance(1, 10);
  h.store.rolloverIfNeeded();
  h.store.updateTask(task.id, { date: '2026-11-13' });
  const stored = h.store.findTask(task.id);
  assert.equal(stored.date, '2026-11-13');
  assert.equal(stored.originDate, '2026-11-13');
});

test('habit check-ins, streak and month statistics', (t) => {
  const h = createHarness(new Date(2026, 10, 10, 9, 0));
  t.after(() => h.cleanup());

  const habit = h.store.addHabit({ title: '背单词 30 个', time: '21:00' });
  for (const day of [10, 11, 12, 14]) {
    h.setNow(new Date(2026, 10, day, 21, 30));
    h.store.toggleHabitCheckin(habit.id, `2026-11-${String(day).padStart(2, '0')}`);
  }
  h.setNow(new Date(2026, 10, 16, 10, 0));

  const stats = h.store.habitMonthStats(h.store.findHabit(habit.id), '2026-11', '2026-11-16');
  assert.equal(stats.expected, 7);
  assert.equal(stats.done, 4);
  assert.equal(stats.missed, 3);
  assert.equal(stats.longest, 3);
  assert.equal(Math.round(stats.rate * 100), 57);

  let snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.habits.length, 1);
  assert.equal(snapshot.habits[0].checkedToday, false);
  assert.equal(snapshot.habits[0].monthDone, 4);
  assert.equal(snapshot.counts.habitsDue, 1);

  h.store.toggleHabitCheckin(habit.id, '2026-11-16');
  snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.habits[0].checkedToday, true);
  assert.equal(snapshot.habits[0].streak, 1); // 15 missed, so only today
  assert.equal(snapshot.counts.habitsDue, 0);

  const report = h.store.buildMonthReport('2026-11');
  assert.equal(report.totals.done, 5);
  assert.equal(report.totals.expected, 7);
  assert.equal(report.days.length, 16);
  assert.equal(report.days[9].habitDone, 1); // Nov 10
});

test('habit check-in guards: no future days, no days before creation', (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const habit = h.store.addHabit({ title: '阅读 20 页', time: '22:00' });
  assert.throws(() => h.store.toggleHabitCheckin(habit.id, '2026-11-17'), TodoError);
  assert.throws(() => h.store.toggleHabitCheckin(habit.id, '2026-11-01'), TodoError);
  assert.throws(() => h.store.toggleHabitCheckin('missing', '2026-11-16'), TodoError);
});

test('appointments remind exactly two days and one day before', (t) => {
  const h = createHarness(new Date(2026, 10, 16, 8, 59));
  t.after(() => h.cleanup());

  const appointment = h.store.addAppointment({
    title: '牙医复诊',
    date: '2026-11-18',
    time: '15:00',
    location: '市口腔医院',
  });

  assert.equal(h.store.collectDueAppointmentReminders().length, 0);
  h.setNow(new Date(2026, 10, 16, 9, 0));
  let due = h.store.collectDueAppointmentReminders();
  assert.equal(due.length, 1);
  assert.equal(due[0].daysBefore, 2);
  h.store.markAppointmentRemindersNotified(due);
  assert.equal(h.store.collectDueAppointmentReminders().length, 0);

  h.setNow(new Date(2026, 10, 17, 9, 30));
  due = h.store.collectDueAppointmentReminders();
  assert.equal(due.length, 1);
  assert.equal(due[0].daysBefore, 1);
  h.store.markAppointmentRemindersNotified(due);

  h.setNow(new Date(2026, 10, 18, 9, 30));
  assert.equal(h.store.collectDueAppointmentReminders().length, 0);

  const plan = h.store.appointmentReminderPlan('2026-11-18', new Date(2026, 10, 16, 9, 0));
  assert.deepEqual(plan.map((entry) => entry.date), ['2026-11-16', '2026-11-17']);
  assert.equal(plan[0].today, true);
  assert.equal(appointment.done, false);
});

test('doing an appointment cancels its pending reminders', (t) => {
  const h = createHarness(new Date(2026, 10, 16, 9, 0));
  t.after(() => h.cleanup());

  const appointment = h.store.addAppointment({ title: '体检', date: '2026-11-18', time: '08:00' });
  h.store.toggleAppointmentDone(appointment.id, true);
  assert.equal(h.store.collectDueAppointmentReminders().length, 0);

  const snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.appointments[0].status, 'done');
  assert.equal(snapshot.counts.appointmentsUpcoming, 0);
});

test('habit reminders fire at the configured time once per day', (t) => {
  const h = createHarness(new Date(2026, 10, 16, 20, 59));
  t.after(() => h.cleanup());

  const habit = h.store.addHabit({ title: '背单词 30 个', time: '21:00' });
  assert.equal(h.store.collectDueHabitReminders().length, 0);

  h.setNow(new Date(2026, 10, 16, 21, 0));
  let due = h.store.collectDueHabitReminders();
  assert.equal(due.length, 1);
  h.store.markHabitRemindersNotified(due);
  assert.equal(h.store.collectDueHabitReminders().length, 0);

  // Checked in before the next reminder: silence.
  h.advance(1, 12, 0);
  h.store.toggleHabitCheckin(habit.id, '2026-11-17');
  h.setNow(new Date(2026, 10, 17, 21, 0));
  assert.equal(h.store.collectDueHabitReminders().length, 0);

  // Not checked the following day: reminder returns.
  h.setNow(new Date(2026, 10, 18, 21, 0));
  assert.equal(h.store.collectDueHabitReminders().length, 1);
});

test('settings and data survive a round trip; corrupted main file recovers from .bak', (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  h.store.addTask({ title: '备份测试', quadrant: 1 });
  assert.equal(h.store.state.settings.desktopOnlyHover, true);
  h.store.updateSettings({ notifications: false, appointmentTime: '08:15', pinned: true, desktopOnlyHover: false });

  const reopened = new TodoStore({ file: path.join(h.dir, 'data.json'), now: () => new Date(2026, 10, 16, 10, 0) });
  reopened.open();
  assert.equal(reopened.state.tasks.length, 1);
  assert.equal(reopened.state.tasks[0].title, '备份测试');
  assert.equal(reopened.state.settings.notifications, false);
  assert.equal(reopened.state.settings.appointmentTime, '08:15');
  assert.equal(reopened.state.settings.pinned, true);
  assert.equal(reopened.state.settings.desktopOnlyHover, false);

  fs.writeFileSync(path.join(h.dir, 'data.json'), '{ broken json', 'utf8');
  const recovered = new TodoStore({ file: path.join(h.dir, 'data.json'), now: () => new Date(2026, 10, 16, 10, 0) });
  recovered.open();
  assert.equal(recovered.state.tasks.length, 1);
  assert.equal(recovered.state.tasks[0].title, '备份测试');
});

test('input validation produces friendly errors', (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  assert.throws(() => h.store.addTask({ title: '   ' }), /请填写待办内容/);
  assert.throws(() => h.store.addAppointment({ title: '体检', date: '2026-11-15' }), /预约日期不能早于今天/);
  assert.throws(() => h.store.addHabit({ title: '' }), /请填写打卡内容/);
  assert.throws(() => h.store.deleteTask('nope'), /找不到这条待办/);
  // Invalid quadrant falls back to "重要 · 不紧急" instead of throwing.
  const task = h.store.addTask({ title: '象限兜底', quadrant: 99 });
  assert.equal(task.quadrant, 2);
});

test('month report counts only the requested month and exports CSV', (t) => {
  const h = createHarness(new Date(2026, 10, 16, 9, 0));
  t.after(() => h.cleanup());

  const habit = h.store.addHabit({ title: '冥想 10 分钟', time: '07:00' });
  h.store.toggleHabitCheckin(habit.id, '2026-11-16');
  h.store.addTask({ title: '本月完成', quadrant: 2 });

  const report = h.store.buildMonthReport('2026-11');
  assert.equal(report.month, '2026-11');
  assert.equal(report.habits.length, 1);
  assert.equal(report.habits[0].done, 1);
  assert.equal(report.tasks.created, 1);
  assert.equal(report.appointments.total, 0);

  const october = h.store.buildMonthReport('2026-10');
  assert.equal(october.habits.length, 0);
  assert.equal(october.tasks.done, 0);

  const csv = h.store.buildMonthCsv('2026-11');
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /冥想 10 分钟/);
  assert.match(csv, /月度统计报表/);
});

test('appointment report rate only counts appointments whose day arrived', (t) => {
  const h = createHarness(new Date(2026, 10, 10, 9, 0));
  t.after(() => h.cleanup());

  const done = h.store.addAppointment({ title: '已完成预约', date: '2026-11-11', time: '10:00' });
  h.store.toggleAppointmentDone(done.id, true);
  h.store.addAppointment({ title: '错过的预约', date: '2026-11-12', time: '10:00' });
  h.store.addAppointment({ title: '还没到的预约', date: '2026-11-20', time: '10:00' });

  h.setNow(new Date(2026, 10, 16, 9, 0));
  const report = h.store.buildMonthReport('2026-11');
  assert.equal(report.appointments.total, 3);
  assert.equal(report.appointments.due, 2);
  assert.equal(report.appointments.done, 1);
  assert.equal(report.appointments.doneDue, 1);
  assert.equal(report.appointments.missed, 1);
  assert.equal(report.appointments.upcoming, 1);
  assert.equal(report.appointments.rate, 0.5);
});

test('task estimates and appointment quadrants persist and update', (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const task = h.store.addTask({ title: '写论文', quadrant: 2, estimateMinutes: 90 });
  assert.equal(task.estimateMinutes, 90);
  let snapshot = h.store.buildSnapshot();
  assert.equal(snapshot.quadrants[1].open[0].estimateMinutes, 90);

  h.store.updateTask(task.id, { estimateMinutes: 45 });
  assert.equal(h.store.findTask(task.id).estimateMinutes, 45);
  h.store.updateTask(task.id, { estimateMinutes: 0 });
  assert.equal(h.store.findTask(task.id).estimateMinutes, 0);
  h.store.updateTask(task.id, { estimateMinutes: 9999 });
  assert.equal(h.store.findTask(task.id).estimateMinutes, 1440);

  const appointment = h.store.addAppointment({
    title: '年度体检',
    date: '2026-11-18',
    time: '09:00',
    quadrant: 4,
  });
  assert.equal(appointment.quadrant, 4);
  snapshot = h.store.buildSnapshot();
  const view = snapshot.appointments.find((entry) => entry.id === appointment.id);
  assert.equal(view.quadrant, 4);
  h.store.updateAppointment(appointment.id, { quadrant: 1 });
  assert.equal(h.store.findAppointment(appointment.id).quadrant, 1);
});

test('old v1 data gets safe defaults for the new fields', () => {
  const state = normalizeState({
    schema: 1,
    tasks: [{
      id: 'legacy-task',
      title: '旧任务',
      quadrant: 1,
      date: '2026-11-17',
      originDate: '2026-11-17',
      done: false,
    }],
    appointments: [{
      id: 'legacy-appointment',
      title: '旧预约',
      date: '2026-12-01',
      time: '09:00',
      done: false,
    }],
  }, new Date(2026, 10, 17, 9, 0));
  assert.equal(state.schema, 2);
  assert.equal(state.tasks[0].estimateMinutes, 0);
  assert.equal(state.appointments[0].quadrant, 2);
});

test('snapshot for another month keeps today data intact', (t) => {
  const h = createHarness();
  t.after(() => h.cleanup());

  h.store.addHabit({ title: '喝水', time: '12:00' });
  h.store.toggleHabitCheckin(h.store.state.habits[0].id, '2026-11-16');
  const snapshot = h.store.buildSnapshot({ month: '2026-10' });
  assert.equal(snapshot.month, '2026-10');
  assert.equal(snapshot.habits[0].checkedToday, true);
  assert.equal(snapshot.report.month, '2026-10');
});
