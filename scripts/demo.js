'use strict';

/**
 * Demo data used only by `npm run capture`. It keeps the screenshots honest:
 * delayed tasks, a partly finished month of check-ins and appointments in all
 * states. Real users start from an empty file.
 */

const D = require('../src/dates');

function seedDemo(store, now = new Date()) {
  const today = D.todayKey(now);
  const isoAt = (offsetDays, hours, minutes = 0) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, hours, minutes, 0, 0);
    return date.toISOString();
  };
  const day = (offset) => D.addDays(today, offset);
  const checkins = (offsets) => {
    const map = {};
    for (const offset of offsets) map[day(offset)] = isoAt(offset, 21, 10);
    return map;
  };

  const tasks = [
    {
      id: 'demo-task-email',
      title: '回复客户的确认邮件',
      note: '确认周五的交付时间和验收方式',
      quadrant: 1,
      date: today,
      originDate: today,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(-1, 9, 20),
      updatedAt: isoAt(-1, 9, 20),
    },
    {
      id: 'demo-task-utilities',
      title: '交本月水电费',
      note: '在支付宝里缴，记得开电子发票',
      quadrant: 1,
      date: today,
      originDate: day(-3),
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(-4, 8, 10),
      updatedAt: isoAt(-3, 8, 10),
    },
    {
      id: 'demo-task-notes',
      title: '整理这周的读书笔记',
      note: '重点整理第 4 章的产品方法论',
      quadrant: 2,
      date: today,
      originDate: today,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(-2, 21, 30),
      updatedAt: isoAt(-2, 21, 30),
    },
    {
      id: 'demo-task-trip',
      title: '规划下个月的旅行路线',
      note: '先把交通和住宿的预算列出来',
      quadrant: 2,
      date: today,
      originDate: today,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(-2, 21, 40),
      updatedAt: isoAt(-2, 21, 40),
    },
    {
      id: 'demo-task-mom',
      title: '给妈妈打个电话',
      note: '问问家里的暖气修好没有',
      quadrant: 2,
      date: today,
      originDate: today,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(-1, 19, 0),
      updatedAt: isoAt(-1, 19, 0),
    },
    {
      id: 'demo-task-parcel',
      title: '取快递',
      note: '菜鸟驿站，取件码 6-2-1034',
      quadrant: 3,
      date: today,
      originDate: today,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(0, 9, 5),
      updatedAt: isoAt(0, 9, 5),
    },
    {
      id: 'demo-task-album',
      title: '整理手机相册',
      note: '把上个月的照片按旅行地点归档',
      quadrant: 4,
      date: today,
      originDate: today,
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(0, 9, 12),
      updatedAt: isoAt(0, 9, 12),
    },
    {
      id: 'demo-task-water',
      title: '给绿植浇水',
      note: '',
      quadrant: 4,
      date: today,
      originDate: today,
      done: true,
      doneAt: isoAt(0, 10, 15),
      completedLateDays: 0,
      createdAt: isoAt(0, 8, 40),
      updatedAt: isoAt(0, 10, 15),
    },
    {
      id: 'demo-task-report',
      title: '提交周报',
      note: '把这周的进展和风险整理成三行',
      quadrant: 2,
      date: today,
      originDate: day(-1),
      done: true,
      doneAt: isoAt(0, 11, 32),
      completedLateDays: 1,
      createdAt: isoAt(-3, 18, 0),
      updatedAt: isoAt(0, 11, 32),
    },
    {
      id: 'demo-task-meeting',
      title: '准备周会材料',
      note: '两张图讲清楚本季度的重点',
      quadrant: 1,
      date: day(1),
      originDate: day(1),
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(0, 9, 30),
      updatedAt: isoAt(0, 9, 30),
    },
    {
      id: 'demo-task-checkup-report',
      title: '取体检报告',
      note: '',
      quadrant: 2,
      date: day(4),
      originDate: day(4),
      done: false,
      doneAt: null,
      completedLateDays: 0,
      createdAt: isoAt(0, 9, 40),
      updatedAt: isoAt(0, 9, 40),
    },
  ];

  const habits = [
    {
      id: 'demo-habit-words',
      title: '背单词 30 个',
      time: '21:00',
      note: '每天 30 个，周末 20 个',
      createdAt: day(-14),
      checkins: checkins([-14, -13, -12, -11, -10, -9, -8, -6, -5, -4, -2, -1]),
      notifiedDate: null,
    },
    {
      id: 'demo-habit-meditate',
      title: '冥想 10 分钟',
      time: '07:30',
      note: '起床后，喝完水再做',
      createdAt: day(-14),
      checkins: checkins([-14, -13, -12, -10, -9, -8, -7, -6, -4, -3, -2, -1, 0]),
      notifiedDate: today,
    },
    {
      id: 'demo-habit-read',
      title: '阅读 20 页',
      time: '22:30',
      note: '',
      createdAt: day(-10),
      checkins: checkins([-9, -7, -6, -5, -3, -2]),
      notifiedDate: null,
    },
  ];

  const appointments = [
    {
      id: 'demo-appt-dentist',
      title: '牙医复诊',
      date: today,
      time: '15:30',
      location: '市口腔医院 · 3 楼',
      note: '带医保卡和上次的片子',
      done: false,
      doneAt: null,
      notified: {},
      createdAt: isoAt(-10, 10, 0),
    },
    {
      id: 'demo-appt-dinner',
      title: '和朋友吃饭',
      date: day(1),
      time: '18:30',
      location: '老街火锅',
      note: '',
      done: false,
      doneAt: null,
      notified: {},
      createdAt: isoAt(-2, 12, 0),
    },
    {
      id: 'demo-appt-review',
      title: '项目评审会',
      date: day(2),
      time: '10:00',
      location: '线上会议室 · 腾讯会议',
      note: '提前十分钟进会议室测试投屏',
      done: false,
      doneAt: null,
      notified: {},
      createdAt: isoAt(-5, 15, 0),
    },
    {
      id: 'demo-appt-checkup',
      title: '年度体检',
      date: day(6),
      time: '08:00',
      location: '市中心医院体检中心',
      note: '前一天晚上十点后不要进食',
      done: false,
      doneAt: null,
      notified: {},
      createdAt: isoAt(-1, 16, 0),
    },
    {
      id: 'demo-appt-laundry',
      title: '取干洗的西装',
      date: day(-2),
      time: '17:00',
      location: '楼下干洗店',
      note: '',
      done: false,
      doneAt: null,
      notified: {},
      createdAt: isoAt(-6, 9, 0),
    },
    {
      id: 'demo-appt-phone',
      title: '缴电话费',
      date: day(-4),
      time: '12:00',
      location: '',
      note: '',
      done: true,
      doneAt: isoAt(-4, 12, 30),
      notified: {},
      createdAt: isoAt(-7, 9, 0),
    },
  ];

  // v1.1 fields, assigned in one place so the demo reads cleanly above.
  const taskEstimates = {
    'demo-task-email': 30,
    'demo-task-utilities': 15,
    'demo-task-notes': 60,
    'demo-task-trip': 90,
    'demo-task-mom': 15,
    'demo-task-parcel': 15,
    'demo-task-album': 45,
    'demo-task-water': 10,
    'demo-task-report': 40,
    'demo-task-meeting': 90,
    'demo-task-checkup-report': 30,
  };
  for (const task of tasks) task.estimateMinutes = taskEstimates[task.id] || 0;

  const appointmentQuadrants = {
    'demo-appt-dentist': 1,
    'demo-appt-dinner': 4,
    'demo-appt-review': 1,
    'demo-appt-checkup': 2,
    'demo-appt-laundry': 3,
    'demo-appt-phone': 4,
  };
  for (const appointment of appointments) {
    appointment.quadrant = appointmentQuadrants[appointment.id] || 2;
  }

  store.state.tasks = tasks;
  store.state.habits = habits;
  store.state.appointments = appointments;
  store.state.settings = {
    ...store.state.settings,
    hoverEnabled: true,
    notifications: true,
    pinned: true,
    startAtLogin: false,
    appointmentTime: '09:00',
    firstRunDone: true,
  };
  store.state.meta.lastRolloverDate = today;
  store.save();
  return store.state;
}

module.exports = { seedDemo };
