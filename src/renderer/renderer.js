'use strict';

/* global window, document */

const api = window.todo;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HABIT_COLORS = ['#7ff0c4', '#8fd3ff', '#c3b2ff', '#ff9fc9', '#a8f0a0', '#7ed8ff'];
const ESTIMATE_PRESETS = [0, 15, 30, 60, 120];
const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 6.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m13.5 7 3 3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.4V12l3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key == null ? '' : key));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function keyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDaysKey(key, amount) {
  const date = parseKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + amount);
  return keyOf(date);
}

function dayDiff(fromKey, toKey) {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (!from || !to) return NaN;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function addMonths(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1, 12);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function formatCnDate(key, withYear = false) {
  const date = parseKey(key);
  if (!date) return String(key || '');
  return `${withYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatMonthCn(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return '--';
  const [year, monthNumber] = month.split('-').map(Number);
  return `${year}年${monthNumber}月`;
}

function formatClock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (!total) return '未设置';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} 分钟`;
  if (!rest) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分`;
}

function weekdayMondayIndex(key) {
  const date = parseKey(key);
  return date ? (date.getDay() + 6) % 7 : 0;
}

function habitColor(id) {
  let hash = 0;
  const text = String(id || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return HABIT_COLORS[hash % HABIT_COLORS.length];
}

function todayKey() {
  return keyOf(new Date());
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  snapshot: null,
  tab: 'today',
  month: null,
  doneOpen: false,
  checkinHabit: 'all',
  modalKind: null,
  modalContext: null,
  welcomeShown: false,
  refreshToken: 0,
};

let nodes = {};
let hintTimer = null;
let clockTimer = null;
let refreshTimer = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  nodes = {
    body: document.body,
    stage: document.getElementById('stage'),
    panel: document.getElementById('panel'),
    handle: document.getElementById('handle'),
    handleCount: document.getElementById('handleCount'),
    headerDate: document.getElementById('headerDate'),
    pinBtn: document.getElementById('pinBtn'),
    collapseBtn: document.getElementById('collapseBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    badgeToday: document.getElementById('badgeToday'),
    badgeHabits: document.getElementById('badgeHabits'),
    badgeAppointments: document.getElementById('badgeAppointments'),
    progressText: document.getElementById('progressText'),
    progressHint: document.getElementById('progressHint'),
    progressFill: document.getElementById('progressFill'),
    delayedTag: document.getElementById('delayedTag'),
    apptTag: document.getElementById('apptTag'),
    estimateTag: document.getElementById('estimateTag'),
    quadrantGrid: document.getElementById('quadrantGrid'),
    doneSection: document.querySelector('.done-section'),
    doneToggle: document.getElementById('doneToggle'),
    doneList: document.getElementById('doneList'),
    doneCount: document.getElementById('doneCount'),
    habitCards: document.getElementById('habitCards'),
    habitChips: document.getElementById('habitChips'),
    checkinBody: document.getElementById('checkinBody'),
    habitSummary: document.getElementById('habitSummary'),
    habitMonthLabel: document.getElementById('habitMonthLabel'),
    habitPrevMonth: document.getElementById('habitPrevMonth'),
    habitNextMonth: document.getElementById('habitNextMonth'),
    checkinCard: document.querySelector('.checkin-card'),
    appointmentList: document.getElementById('appointmentList'),
    reportBody: document.getElementById('reportBody'),
    reportMonthLabel: document.getElementById('reportMonthLabel'),
    reportPrevMonth: document.getElementById('reportPrevMonth'),
    reportNextMonth: document.getElementById('reportNextMonth'),
    exportBtn: document.getElementById('exportBtn'),
    footerLeft: document.getElementById('footerLeft'),
    footerRight: document.getElementById('footerRight'),
    modalRoot: document.getElementById('modalRoot'),
    modalCard: document.getElementById('modalCard'),
    modalScrim: document.querySelector('.modal-scrim'),
    toastRoot: document.getElementById('toastRoot'),
    backdrop: document.getElementById('backdrop'),
    firstHint: document.getElementById('firstHint'),
  };

  nodes.body.classList.toggle('test-mode', Boolean(api.testMode));
  api.setUiState({ modal: false });

  bindStaticEvents();
  bindRuntimeEvents();
  await refresh();

  if (api.panelState) {
    try {
      const panel = await api.panelState();
      if (panel && panel.open) {
        nodes.body.classList.add('open');
        nodes.panel.setAttribute('aria-hidden', 'false');
        hideFirstHint();
        if (state.snapshot && state.snapshot.firstRun && !state.welcomeShown && !state.modalKind) {
          state.welcomeShown = true;
          openWelcomeModal();
        }
      }
    } catch {
      /* the main process may be shutting down */
    }
  }

  clockTimer = setInterval(() => {
    if (state.snapshot && document.body.classList.contains('open')) {
      // Keep relative labels and the date honest across midnight.
      if (state.snapshot.today !== todayKey()) refresh({ silent: true });
    }
  }, 45000);

  refreshTimer = setInterval(() => {
    if (document.body.classList.contains('open') && !state.modalKind) refresh({ silent: true });
  }, 5 * 60 * 1000);

  showFirstHint();

  if (api.testMode) {
    window.__todoDemo = {
      showTab: (tab) => switchTab(tab),
      openTaskModal: () => openTaskModal(),
      openHabitModal: () => openHabitModal(),
      openAppointmentModal: () => openAppointmentModal(),
      openSettingsModal: () => openSettingsModal(),
      openWelcomeModal: () => openWelcomeModal(),
      closeModal: () => closeModal(),
      setMonth: (month) => { state.month = month; return refresh(); },
    };
  }
}

function bindRuntimeEvents() {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('change', onDocumentChange);
  document.addEventListener('keydown', onKeyDown);

  nodes.modalScrim.addEventListener('click', () => {
    if (['settings', 'welcome', 'confirm'].includes(state.modalKind)) closeModal();
  });

  if (api.onOpen) {
    api.onOpen((payload = {}) => {
      nodes.body.classList.add('open');
      nodes.panel.setAttribute('aria-hidden', 'false');
      hideFirstHint();
      if (payload.tab) switchTab(payload.tab);
      refresh({ silent: true }).then(() => {
        if (state.snapshot && state.snapshot.firstRun && !state.welcomeShown && !state.modalKind) {
          state.welcomeShown = true;
          openWelcomeModal();
        }
      });
    });
  }
  if (api.onClosed) {
    api.onClosed(() => {
      nodes.body.classList.remove('open');
      nodes.panel.setAttribute('aria-hidden', 'true');
      if (state.modalKind) closeModal();
    });
  }
  if (api.onTab) api.onTab((payload = {}) => { if (payload.tab) switchTab(payload.tab); });
  if (api.onChanged) {
    api.onChanged(debounce(() => refresh({ silent: true }), 120));
  }
  if (api.onBackdrop) {
    api.onBackdrop((payload = {}) => {
      if (!payload.dataUrl) return;
      nodes.backdrop.style.backgroundImage = `url("${payload.dataUrl}")`;
      nodes.backdrop.classList.add('has');
    });
  }
  if (api.onReminder) {
    api.onReminder((payload = {}) => {
      toast(payload.title || '提醒', payload.body || '', { tab: payload.tab, duration: 9000 });
      refresh({ silent: true });
    });
  }
  if (api.onCreate) {
    api.onCreate((payload = {}) => {
      if (payload.type === 'habit') openHabitModal();
      else if (payload.type === 'appointment') openAppointmentModal();
      else openTaskModal();
    });
  }
}

function bindStaticEvents() {
  document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('addHabitBtn').addEventListener('click', () => openHabitModal());
  document.getElementById('addAppointmentBtn').addEventListener('click', () => openAppointmentModal());
  nodes.pinBtn.addEventListener('click', togglePin);
  nodes.collapseBtn.addEventListener('click', () => api.closePanel());
  nodes.settingsBtn.addEventListener('click', () => { hideFirstHint(); openSettingsModal(); });
  nodes.doneToggle.addEventListener('click', () => {
    state.doneOpen = !state.doneOpen;
    nodes.doneToggle.setAttribute('aria-expanded', String(state.doneOpen));
    nodes.doneList.hidden = !state.doneOpen;
  });
  nodes.habitPrevMonth.addEventListener('click', () => changeMonth(-1));
  nodes.habitNextMonth.addEventListener('click', () => changeMonth(1));
  nodes.reportPrevMonth.addEventListener('click', () => changeMonth(-1));
  nodes.reportNextMonth.addEventListener('click', () => changeMonth(1));
  nodes.exportBtn.addEventListener('click', exportMonth);
}

// ---------------------------------------------------------------------------
// Data refresh
// ---------------------------------------------------------------------------
async function refresh(options = {}) {
  const token = ++state.refreshToken;
  try {
    const result = await api.snapshot(state.month);
    if (token !== state.refreshToken) return;
    if (!result || !result.ok) {
      if (!options.silent) toast('读取数据失败', (result && result.error) || '请稍后再试');
      return;
    }
    applySnapshot(result.snapshot);
  } catch (error) {
    if (!options.silent) toast('读取数据失败', error.message || '请稍后再试');
  }
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  const scrolls = captureScroll();
  state.snapshot = snapshot;
  state.month = snapshot.month;
  if (state.checkinHabit !== 'all' && !snapshot.habits.some((habit) => habit.id === state.checkinHabit)) {
    state.checkinHabit = 'all';
  }
  renderHeader();
  renderTabs();
  renderToday();
  renderHabits();
  renderAppointments();
  renderReport();
  updatePinUi();
  updateHandle();
  updateFooter();
  restoreScroll(scrolls);
  showView(state.tab);
}

function captureScroll() {
  const views = [...document.querySelectorAll('.view:not(.view-today)')].map((view) => ({
    view,
    top: view.scrollTop,
  }));
  const quadLists = [...document.querySelectorAll('.quad-list')].map((list) => ({
    list,
    top: list.scrollTop,
  }));
  return { views, quadLists };
}

function restoreScroll(saved) {
  for (const item of saved.views) item.view.scrollTop = item.top;
  const lists = [...document.querySelectorAll('.quad-list')];
  saved.quadLists.forEach((item, index) => {
    if (lists[index]) lists[index].scrollTop = item.top;
  });
}

// ---------------------------------------------------------------------------
// Header / tabs / chrome
// ---------------------------------------------------------------------------
function renderHeader() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  nodes.headerDate.textContent = `${formatCnDate(snapshot.today)} · ${snapshot.weekday}`;
}

function renderTabs() {
  const counts = state.snapshot.counts;
  setBadge(nodes.badgeToday, counts.tasksOpen);
  setBadge(nodes.badgeHabits, counts.habitsDue);
  setBadge(nodes.badgeAppointments, counts.appointmentsToday + counts.appointmentsUpcoming);
  for (const button of document.querySelectorAll('.tab')) {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
}

function setBadge(node, value) {
  if (!node) return;
  node.hidden = !value;
  node.textContent = value > 99 ? '99+' : String(value);
}

function updatePinUi() {
  const pinned = Boolean(state.snapshot && state.snapshot.settings.pinned);
  nodes.pinBtn.classList.toggle('active', pinned);
  nodes.pinBtn.setAttribute('aria-pressed', String(pinned));
  nodes.pinBtn.title = pinned ? '已钉住，点击取消' : '钉住面板（不自动收起）';
}

function updateHandle() {
  const counts = state.snapshot ? state.snapshot.counts : { tasksOpen: 0, tasksDelayed: 0 };
  const open = counts.tasksOpen || 0;
  nodes.handleCount.hidden = open === 0;
  nodes.handleCount.textContent = open > 99 ? '99+' : String(open);

  const urgent = state.snapshot
    ? state.snapshot.quadrants.find((quadrant) => quadrant.id === 1).open.length
    : 0;
  nodes.handle.classList.toggle('urgent', urgent > 0);
  nodes.handle.classList.toggle('late', urgent === 0 && (counts.tasksDelayed || 0) > 0);
}

function updateFooter() {
  const counts = state.snapshot ? state.snapshot.counts : null;
  const pinned = Boolean(state.snapshot && state.snapshot.settings.pinned);
  nodes.footerLeft.textContent = pinned
    ? '已钉住 · Esc 收起'
    : 'Esc 收起 · 桌面悬停左边缘呼出';
  if (!counts) {
    nodes.footerRight.textContent = '';
    return;
  }
  const parts = [`今天 ${counts.tasksOpen} 项待办`];
  if (counts.habitsDue) parts.push(`${counts.habitsDue} 项打卡`);
  nodes.footerRight.textContent = parts.join(' · ');
}

function showView(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll('.tab')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  for (const view of document.querySelectorAll('.view')) {
    view.classList.toggle('active', view.dataset.view === tab);
  }
}

function switchTab(tab) {
  if (!['today', 'habits', 'appointments', 'report'].includes(tab)) return;
  showView(tab);
}

function changeMonth(delta) {
  if (!state.snapshot) return;
  const next = addMonths(state.snapshot.month, delta);
  if (delta > 0 && next > state.snapshot.currentMonth) return;
  state.month = next;
  refresh();
}

async function togglePin() {
  if (!state.snapshot) return;
  const next = !state.snapshot.settings.pinned;
  const result = await api.pin(next);
  if (!accept(result)) return;
  toast(next ? '面板已钉住' : '已取消钉住', next ? '鼠标离开也不会收起，按 Esc 可收起' : '鼠标离开后会安静地收起', { duration: 2600 });
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------
function renderToday() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const stats = snapshot.todayStats;
  const rate = Math.round((stats.rate || 0) * 100);

  nodes.progressText.textContent = `${stats.done} / ${stats.total}`;
  nodes.progressHint.textContent = stats.total ? `${rate}% 已完成` : '今天还没有安排';
  nodes.progressFill.style.width = `${rate}%`;

  if (stats.delayed > 0) {
    nodes.delayedTag.hidden = false;
    nodes.delayedTag.textContent = `有 ${stats.delayed} 项顺延，已标记拖延`;
  } else {
    nodes.delayedTag.hidden = true;
  }
  const estimateMinutes = snapshot.quadrants.reduce((total, quadrant) => (
    total + quadrant.open.reduce((sum, task) => sum + (task.estimateMinutes || 0), 0)
  ), 0);
  if (estimateMinutes > 0) {
    nodes.estimateTag.hidden = false;
    nodes.estimateTag.textContent = `待办预计 ${formatDuration(estimateMinutes)}`;
  } else {
    nodes.estimateTag.hidden = true;
  }
  if (snapshot.counts.appointmentsToday > 0) {
    nodes.apptTag.hidden = false;
    nodes.apptTag.textContent = `今天有 ${snapshot.counts.appointmentsToday} 个预约`;
  } else {
    nodes.apptTag.hidden = true;
  }

  nodes.quadrantGrid.innerHTML = snapshot.quadrants.map(renderQuadrant).join('');

  const done = snapshot.doneToday || [];
  nodes.doneSection.hidden = done.length === 0;
  nodes.doneCount.textContent = String(done.length);
  nodes.doneToggle.setAttribute('aria-expanded', String(state.doneOpen));
  nodes.doneList.hidden = !state.doneOpen || done.length === 0;
  nodes.doneList.innerHTML = done.map(renderDoneRow).join('');
}

function renderQuadrant(quadrant) {
  const tasks = quadrant.open.map((task) => renderTaskRow(task)).join('');
  return `
    <article class="quad q${quadrant.id}" style="--q:${quadrant.color}">
      <div class="quad-head">
        <span class="quad-dot"></span>
        <div class="quad-titles">
          <b>${esc(quadrant.name)}</b>
          <small>${esc(quadrant.hint)}</small>
        </div>
        <span class="quad-count">${quadrant.open.length}</span>
        <button class="quad-add" type="button" data-act="add-task-quadrant" data-quadrant="${quadrant.id}" title="在「${esc(quadrant.name)}」里添加" aria-label="在${esc(quadrant.name)}里添加">＋</button>
      </div>
      <div class="quad-list">
        ${tasks || '<div class="quad-empty">暂无任务<br>点右上角 ＋ 添加</div>'}
      </div>
    </article>`;
}

function renderTaskRow(task) {
  const badges = [];
  if (task.deferredDays > 0) badges.push(`<span class="badge late">拖延 ${task.deferredDays} 天</span>`);
  if (task.estimateMinutes > 0) {
    badges.push(`<span class="badge estimate">${ICONS.clock}${esc(formatDuration(task.estimateMinutes))}</span>`);
  }
  return `
    <div class="task" data-act="edit-task" data-id="${esc(task.id)}" tabindex="0" role="button" aria-label="编辑待办 ${esc(task.title)}">
      <button class="task-check" type="button" data-act="toggle-task" data-id="${esc(task.id)}" title="标记完成" aria-label="标记完成">
        ${ICONS.check}
      </button>
      <div class="task-main">
        <div class="task-title">${esc(task.title)}</div>
        ${task.note ? `<div class="task-note">${esc(task.note)}</div>` : ''}
        ${badges.length ? `<div class="task-badges">${badges.join('')}</div>` : ''}
      </div>
    </div>`;
}

function renderDoneRow(task) {
  const quadrant = state.snapshot.quadrants.find((entry) => entry.id === task.quadrant);
  const color = quadrant ? quadrant.color : '#7ed8ff';
  return `
    <div class="done-row" data-act="undo-task" data-id="${esc(task.id)}" style="--q:${color}" title="点击撤销完成">
      <span class="dot"></span>
      <span class="done-title">${esc(task.title)}</span>
      ${task.completedLateDays > 0 ? `<span class="badge late">拖延 ${task.completedLateDays} 天后完成</span>` : ''}
      <time>${formatClock(task.doneAt)}</time>
    </div>`;
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------
function renderHabits() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const habits = snapshot.habits;

  nodes.habitMonthLabel.textContent = snapshot.monthLabel;
  nodes.habitNextMonth.disabled = snapshot.month >= snapshot.currentMonth;

  nodes.checkinCard.hidden = habits.length === 0;

  nodes.habitCards.innerHTML = habits.length
    ? habits.map(renderHabitCard).join('')
    : '<div class="report-empty">还没有打卡项。<br>新建一个，比如「背单词 30 个」。</div>';

  if (state.checkinHabit !== 'all' && !habits.some((habit) => habit.id === state.checkinHabit)) {
    state.checkinHabit = 'all';
  }

  nodes.habitChips.innerHTML = habits.length
    ? [
      `<button class="chip ${state.checkinHabit === 'all' ? 'on' : ''}" type="button" data-act="select-habit" data-habit="all"><span class="dot" style="--h:#7ed8ff"></span>总表</button>`,
      ...habits.map((habit) => `
        <button class="chip ${state.checkinHabit === habit.id ? 'on' : ''}" type="button" data-act="select-habit" data-habit="${esc(habit.id)}">
          <span class="dot" style="--h:${habitColor(habit.id)}"></span>${esc(habit.title)}
        </button>`),
    ].join('')
    : '';

  if (!habits.length) {
    nodes.checkinBody.innerHTML = '';
    nodes.habitSummary.innerHTML = '';
    return;
  }

  const selected = habits.find((habit) => habit.id === state.checkinHabit);
  if (selected) {
    nodes.checkinBody.innerHTML = renderHabitCalendar(selected);
    const longest = selected.monthLongest || 0;
    const rate = selected.monthExpected ? Math.round((selected.monthDone / selected.monthExpected) * 100) : 0;
    nodes.habitSummary.innerHTML = `
      <span><b>${esc(selected.title)}</b></span>
      <span>本月 <b>${selected.monthDone}/${selected.monthExpected}</b> 天</span>
      <span>完成率 <b>${rate}%</b></span>
      <span>最长连续 <b>${longest}</b> 天</span>
      <span>当前连续 <b>${selected.streak}</b> 天</span>`;
  } else {
    nodes.checkinBody.innerHTML = renderAllHabitCalendar(habits, snapshot);
    const totals = snapshot.report.totals;
    const rate = totals.expected ? Math.round((totals.done / totals.expected) * 100) : 0;
    nodes.habitSummary.innerHTML = `
      <span>本月共 <b>${totals.done}/${totals.expected}</b> 次打卡</span>
      <span>完成率 <b>${rate}%</b></span>
      <span>最长连续 <b>${totals.longest}</b> 天</span>
      <span>点彩色圆点可以打卡或取消</span>`;
  }
}

function renderHabitCard(habit) {
  const color = habitColor(habit.id);
  const rate = habit.monthExpected ? Math.round((habit.monthDone / habit.monthExpected) * 100) : 0;
  const todayText = habit.checkedToday
    ? `<span style="color:${color}">今天已完成</span>`
    : '<span>今天还没打卡</span>';
  return `
    <article class="habit-card" style="--h:${color}">
      <button class="habit-check ${habit.checkedToday ? 'on' : ''}" type="button" data-act="habit-toggle-today" data-id="${esc(habit.id)}" title="${habit.checkedToday ? '取消今天的打卡' : '完成今天的打卡'}" aria-label="${habit.checkedToday ? '取消今天的打卡' : '完成今天的打卡'}" aria-pressed="${habit.checkedToday}">
        ${ICONS.check}
      </button>
      <div class="habit-info">
        <div class="habit-title">${esc(habit.title)}</div>
        <div class="habit-meta">
          <span>每天 ${esc(habit.time)}</span>
          <span class="sep"></span>
          ${todayText}
          <span class="sep"></span>
          <span>连续 ${habit.streak} 天</span>
          <span class="sep"></span>
          <span>本月 ${habit.monthDone}/${habit.monthExpected}（${rate}%）</span>
        </div>
      </div>
      <div class="habit-actions">
        <button class="mini-btn" type="button" data-act="edit-habit" data-id="${esc(habit.id)}" title="编辑打卡项" aria-label="编辑打卡项">${ICONS.pencil}</button>
        <button class="mini-btn danger" type="button" data-act="delete-habit" data-id="${esc(habit.id)}" title="删除打卡项" aria-label="删除打卡项">${ICONS.trash}</button>
      </div>
    </article>`;
}

function renderHabitCalendar(habit) {
  const snapshot = state.snapshot;
  const month = snapshot.month;
  const today = snapshot.today;
  const total = daysInMonth(month);
  const offset = weekdayMondayIndex(`${month}-01`);
  const color = habitColor(habit.id);
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']
    .map((name) => `<div class="cal-weekday">${name}</div>`)
    .join('');

  const blanks = Array.from({ length: offset }, () => '<div class="cal-cell blank"></div>').join('');
  const cells = [];
  for (let day = 1; day <= total; day += 1) {
    const date = `${month}-${pad2(day)}`;
    const isToday = date === today;
    const isFuture = date > today;
    const active = date >= habit.createdAt;
    const checked = Boolean(habit.checkins[date]);
    const canToggle = !isFuture && active;
    const classes = ['cal-cell'];
    if (isToday) classes.push('today');
    if (isFuture) classes.push('future');
    if (!active) classes.push('disabled');
    else if (!checked && !isFuture) classes.push('missed');
    if (checked) classes.push('checked');
    if (canToggle) classes.push('enabled');
    const action = canToggle
      ? `data-act="toggle-checkin" data-habit="${esc(habit.id)}" data-date="${date}"`
      : '';
    cells.push(`
      <div class="${classes.join(' ')}" style="--h:${color}" ${action} title="${esc(habit.title)} · ${formatCnDate(date, true)}${checked ? ' · 已完成' : isFuture ? '' : ' · 未打卡'}">
        <span class="day">${day}</span>
        ${checked ? `<span class="cal-mark">${ICONS.check}</span>` : ''}
      </div>`);
  }
  return `<div class="calendar">${weekdays}${blanks}${cells.join('')}</div>`;
}

function renderAllHabitCalendar(habits, snapshot) {
  const month = snapshot.month;
  const today = snapshot.today;
  const total = daysInMonth(month);
  const offset = weekdayMondayIndex(`${month}-01`);
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']
    .map((name) => `<div class="cal-weekday">${name}</div>`)
    .join('');
  const blanks = Array.from({ length: offset }, () => '<div class="cal-cell blank"></div>').join('');
  const cells = [];
  for (let day = 1; day <= total; day += 1) {
    const date = `${month}-${pad2(day)}`;
    const isToday = date === today;
    const isFuture = date > today;
    const classes = ['cal-cell', 'all'];
    if (isToday) classes.push('today');
    if (isFuture) classes.push('future');
    const dots = habits.map((habit) => {
      const color = habitColor(habit.id);
      const checked = Boolean(habit.checkins[date]);
      const disabled = isFuture || date < habit.createdAt;
      const action = disabled
        ? ''
        : `data-act="toggle-checkin" data-habit="${esc(habit.id)}" data-date="${date}"`;
      const title = `${habit.title} · ${formatCnDate(date, true)} · ${checked ? '已完成' : '未打卡'}`;
      return `<span class="hdot ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}" style="--h:${color}" ${action} title="${esc(title)}"></span>`;
    }).join('');
    cells.push(`
      <div class="${classes.join(' ')}">
        <span class="day">${day}</span>
        <div class="hdots">${dots}</div>
      </div>`);
  }
  return `<div class="calendar">${weekdays}${blanks}${cells.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------
function renderAppointments() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const appointments = snapshot.appointments || [];
  if (!appointments.length) {
    nodes.appointmentList.innerHTML = `
      <div class="report-empty">
        还没有预约。<br>
        点右上角「新建预约」，提前 2 天和 1 天会提醒你。
      </div>`;
    return;
  }
  const groups = [
    ['today', '今天'],
    ['upcoming', '即将到来'],
    ['overdue', '已过期'],
    ['done', '已完成'],
  ];
  const html = [];
  for (const [status, label] of groups) {
    const items = appointments.filter((appointment) => appointment.status === status);
    if (!items.length) continue;
    html.push(`<div class="appt-section-title">${label} <span>${items.length}</span></div>`);
    html.push(items.map(renderAppointmentCard).join(''));
  }
  nodes.appointmentList.innerHTML = html.join('');
}

function renderAppointmentCard(appointment) {
  const date = parseKey(appointment.date);
  const day = date ? pad2(date.getDate()) : '--';
  const month = date ? `${date.getMonth() + 1}月` : '';
  let relative = '';
  if (appointment.status === 'done') relative = '已完成';
  else if (appointment.status === 'today') relative = '今天';
  else if (appointment.status === 'overdue') relative = `已过 ${Math.abs(appointment.daysUntil)} 天`;
  else if (appointment.daysUntil === 1) relative = '明天';
  else if (appointment.daysUntil === 2) relative = '后天';
  else relative = `${appointment.daysUntil} 天后`;

  const remind = renderAppointmentReminder(appointment);
  const quadrant = state.snapshot.quadrants.find((entry) => entry.id === appointment.quadrant)
    || state.snapshot.quadrants[1];
  const metaItems = [`<span class="appt-quad"><i></i>${esc(quadrant.name)}</span>`];
  if (appointment.location) metaItems.push(`<span>${esc(appointment.location)}</span>`);
  const meta = `<div class="appt-meta">${metaItems.join('')}</div>`;
  const note = appointment.note && appointment.status !== 'done'
    ? `<div class="appt-note">${esc(appointment.note)}</div>`
    : '';

  return `
    <article class="appt-card ${appointment.status}" style="--q:${quadrant.color}">
      <div class="appt-date">
        <b>${day}</b>
        <span>${month}</span>
        <i>${relative}</i>
      </div>
      <div class="appt-main">
        <div class="appt-title">${esc(appointment.title)} <span class="appt-time">${esc(appointment.time)}</span></div>
        ${meta}
        ${note}
        ${remind}
      </div>
      <div class="appt-actions">
        <button class="mini-btn" type="button" data-act="toggle-appointment" data-id="${esc(appointment.id)}" data-done="${appointment.done}" title="${appointment.done ? '撤销完成' : '标记完成'}" aria-label="${appointment.done ? '撤销完成' : '标记完成'}">${ICONS.check}</button>
        <button class="mini-btn" type="button" data-act="edit-appointment" data-id="${esc(appointment.id)}" title="编辑预约" aria-label="编辑预约">${ICONS.pencil}</button>
        <button class="mini-btn danger" type="button" data-act="delete-appointment" data-id="${esc(appointment.id)}" title="删除预约" aria-label="删除预约">${ICONS.trash}</button>
      </div>
    </article>`;
}

function renderAppointmentReminder(appointment) {
  const snapshot = state.snapshot;
  if (appointment.status === 'done') {
    const doneKey = appointment.doneAt ? keyOf(new Date(appointment.doneAt)) : '';
    return `<div class="appt-remind">已完成${doneKey ? ` · ${formatCnDate(doneKey, true)}` : ''}</div>`;
  }
  if (appointment.status === 'overdue') {
    return `<div class="appt-remind">已过期 ${Math.abs(appointment.daysUntil)} 天，可以补记完成或重新安排</div>`;
  }
  if (appointment.status === 'today') {
    return '<div class="appt-remind"><b>今天记得赴约</b></div>';
  }
  const at = snapshot.settings.appointmentTime;
  const entries = appointment.reminderDates || [];
  const firedToday = entries.filter((entry) => entry.today && snapshot.nowHM >= at);
  const upcoming = entries.filter((entry) => !entry.passed && !(entry.today && snapshot.nowHM >= at));
  if (!firedToday.length && !upcoming.length) {
    return '<div class="appt-remind">提醒时间已过，按计划赴约就好</div>';
  }
  const parts = [];
  if (firedToday.length) parts.push(`今天 ${at} 已提醒`);
  if (upcoming.length) {
    const dates = upcoming.map((entry) => formatCnDate(entry.date)).join('、');
    const labels = upcoming.map((entry) => `提前 ${entry.days} 天`).join('、');
    parts.push(`将于 ${dates} ${at} 提醒你（${labels}）`);
  }
  const notes = snapshot.settings.notifications ? '' : ' · 系统通知已关闭';
  return `<div class="appt-remind">${parts.join(' · ')}${notes}</div>`;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function renderReport() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const report = snapshot.report;
  nodes.reportMonthLabel.textContent = report.monthLabel;
  nodes.reportNextMonth.disabled = report.month >= snapshot.currentMonth;

  if (report.isFuture) {
    nodes.reportBody.innerHTML = `
      <div class="report-empty">
        这个月还没到。<br>
        先在「今日」安排好今天，月底再来看报告。
      </div>`;
    return;
  }

  const habitRate = Math.round((report.totals.rate || 0) * 100);
  const apptRate = Math.round((report.appointments.rate || 0) * 100);
  const lateText = report.tasks.late
    ? `，其中 ${report.tasks.late} 项拖延后完成，平均拖延 ${report.tasks.avgDelay} 天`
    : '，全部按时完成';

  const habitRows = report.habits.length
    ? report.habits.map((habit) => `
      <div class="report-row">
        <span class="title"><i class="row-dot" style="--h:${habitColor(habit.id)}"></i>${esc(habit.title)}</span>
        <span class="num">${habit.done}</span>
        <span class="num">${habit.expected}</span>
        <span class="num rate">${Math.round(habit.rate * 100)}%</span>
        <span class="num">${habit.longest}</span>
      </div>`).join('')
    : '<div class="report-empty">本月还没有打卡项。</div>';

  const heatCells = [];
  const byDay = new Map(report.days.map((day) => [day.day, day]));
  const totalDays = daysInMonth(report.month);
  for (let day = 1; day <= totalDays; day += 1) {
    const date = `${report.month}-${pad2(day)}`;
    const entry = byDay.get(day);
    if (!entry) {
      heatCells.push(`<div class="heat-cell future" data-level="0" title="${formatCnDate(date, true)} · 还没到">${day}</div>`);
    } else {
      const level = entry.habitTotal
        ? Math.min(4, Math.ceil((entry.habitDone / entry.habitTotal) * 4))
        : 0;
      heatCells.push(`<div class="heat-cell" data-level="${level}" title="${formatCnDate(date, true)} · 打卡 ${entry.habitDone}/${entry.habitTotal}">${day}</div>`);
    }
  }

  const heatBlock = report.days.length
    ? `<div class="heat" style="grid-template-columns:repeat(${totalDays}, 1fr)">${heatCells.join('')}</div>
       <div class="heat-legend"><span>少</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>多</span></div>`
    : '<div class="report-empty">这个月还没有打卡记录。</div>';

  nodes.reportBody.innerHTML = `
    <section class="report-hero">
      <div class="rate-ring" style="--pct:${habitRate}">
        <b>${habitRate}%</b>
        <span>打卡完成率</span>
      </div>
      <div class="rate-text">
        <h3>${esc(report.monthLabel)} · 月度回顾</h3>
        <p>本月打卡 ${report.totals.done}/${report.totals.expected} 次，待办完成 ${report.tasks.done} 项${lateText}。</p>
      </div>
    </section>

    <section class="stat-grid">
      <div class="stat-card"><b>${report.tasks.done}</b><span>待办完成 · 按时 ${report.tasks.onTime} 项</span></div>
      <div class="stat-card"><b>${report.tasks.avgDelay} 天</b><span>平均拖延 · 拖延 ${report.tasks.late} 项</span></div>
      <div class="stat-card"><b>${apptRate}%</b><span>预约达成 · 已到期 ${report.appointments.due} 个</span></div>
      <div class="stat-card"><b>${report.totals.longest} 天</b><span>最长连续打卡</span></div>
    </section>

    <section class="report-block">
      <h4>打卡统计 <span>应打卡只统计到 ${report.isCurrent ? '今天' : '月底'}</span></h4>
      <div class="report-table">
        <div class="report-row head"><span>打卡项</span><span class="num">打卡</span><span class="num">应打卡</span><span class="num">完成率</span><span class="num">最长连续</span></div>
        ${habitRows}
      </div>
    </section>

    <section class="report-block">
      <h4>每日打卡热力 <span>颜色越亮，当天完成得越多</span></h4>
      ${heatBlock}
    </section>

    <section class="report-block">
      <h4>待办与预约 <span>月底复盘</span></h4>
      <div class="habit-summary" style="margin-top:0">
        <span>本月新建待办 <b>${report.tasks.created}</b> 项</span>
        <span>完成 <b>${report.tasks.done}</b> 项</span>
        <span>按时 <b>${report.tasks.onTime}</b> 项</span>
        <span>拖延后完成 <b>${report.tasks.late}</b> 项</span>
        <span>当前未完成 <b>${report.tasks.openBacklog}</b> 项</span>
        <span>预约已到期 <b>${report.appointments.due}</b> 个</span>
        <span>预约待到来 <b>${report.appointments.upcoming}</b> 个</span>
      </div>
    </section>`;
}

async function exportMonth() {
  if (!state.snapshot) return;
  const button = nodes.exportBtn;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '正在导出…';
  api.setUiState({ modal: true });
  try {
    const result = await api.exportMonth({ month: state.snapshot.month });
    if (result && result.ok) toast('月度报表已导出', result.path, { duration: 8000 });
    else if (result && result.canceled) { /* user changed their mind */ }
    else toast('导出失败', (result && result.error) || '请稍后再试');
  } catch (error) {
    toast('导出失败', error.message || '请稍后再试');
  } finally {
    api.setUiState({ modal: false });
    button.disabled = false;
    button.textContent = original;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function accept(result, options = {}) {
  if (!result || !result.ok) {
    toast(options.errorTitle || '没有完成', (result && result.error) || '请稍后再试');
    return false;
  }
  if (result.snapshot) applySnapshot(result.snapshot);
  return true;
}

async function toggleTaskDone(id, done) {
  const result = await api.toggleTask({ id, done, month: state.month });
  if (!accept(result)) return;
  if (!done) toast('已恢复到待办', '', { duration: 1800 });
}

async function toggleHabitToday(id) {
  if (!state.snapshot) return;
  const result = await api.toggleHabit({ id, date: state.snapshot.today, month: state.month });
  accept(result);
}

async function toggleCheckin(id, date) {
  const result = await api.toggleHabit({ id, date, month: state.month });
  accept(result);
}

async function toggleAppointmentDone(id, done) {
  const result = await api.toggleAppointment({ id, done, month: state.month });
  accept(result);
}

function findTask(id) {
  if (!state.snapshot) return null;
  for (const quadrant of state.snapshot.quadrants) {
    const found = quadrant.open.find((task) => task.id === id) || quadrant.done.find((task) => task.id === id);
    if (found) return found;
  }
  return (state.snapshot.doneToday || []).find((task) => task.id === id) || null;
}

function findHabit(id) {
  return state.snapshot ? state.snapshot.habits.find((habit) => habit.id === id) || null : null;
}

function findAppointment(id) {
  return state.snapshot ? state.snapshot.appointments.find((appointment) => appointment.id === id) || null : null;
}

// ---------------------------------------------------------------------------
// Click routing
// ---------------------------------------------------------------------------
async function onDocumentClick(event) {
  const tab = event.target.closest('.tab[data-tab]');
  if (tab) {
    switchTab(tab.dataset.tab);
    return;
  }

  const quadrantOption = event.target.closest('.quad-option[data-q]');
  if (quadrantOption) {
    selectQuadrantOption(Number(quadrantOption.dataset.q));
    return;
  }

  const estimateChip = event.target.closest('.estimate-chip[data-estimate]');
  if (estimateChip) {
    selectEstimateChip(estimateChip.dataset.estimate);
    return;
  }

  const dateChip = event.target.closest('.date-chip[data-date]');
  if (dateChip) {
    selectDateChip(dateChip.dataset.date);
    return;
  }

  const actionNode = event.target.closest('[data-act]');
  if (!actionNode) return;
  const action = actionNode.dataset.act;

  switch (action) {
    case 'add-task-quadrant':
      openTaskModal(null, { quadrant: Number(actionNode.dataset.quadrant) });
      break;
    case 'toggle-task':
      await toggleTaskDone(actionNode.dataset.id, true);
      break;
    case 'edit-task': {
      const task = findTask(actionNode.dataset.id);
      if (task) openTaskModal(task);
      break;
    }
    case 'undo-task':
      await toggleTaskDone(actionNode.dataset.id, false);
      break;
    case 'habit-toggle-today':
      await toggleHabitToday(actionNode.dataset.id);
      break;
    case 'edit-habit': {
      const habit = findHabit(actionNode.dataset.id);
      if (habit) openHabitModal(habit);
      break;
    }
    case 'delete-habit': {
      const habit = findHabit(actionNode.dataset.id);
      if (habit) requestDelete('habit', habit);
      break;
    }
    case 'select-habit':
      state.checkinHabit = actionNode.dataset.habit || 'all';
      renderHabits();
      break;
    case 'toggle-checkin':
      await toggleCheckin(actionNode.dataset.habit, actionNode.dataset.date);
      break;
    case 'edit-appointment': {
      const appointment = findAppointment(actionNode.dataset.id);
      if (appointment) openAppointmentModal(appointment);
      break;
    }
    case 'delete-appointment': {
      const appointment = findAppointment(actionNode.dataset.id);
      if (appointment) requestDelete('appointment', appointment);
      break;
    }
    case 'toggle-appointment':
      await toggleAppointmentDone(actionNode.dataset.id, actionNode.dataset.done !== 'true');
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'delete-task':
      if (state.modalContext && state.modalContext.task) requestDelete('task', state.modalContext.task);
      break;
    case 'cancel-confirm':
      closeModal();
      break;
    case 'confirm-delete':
      await runConfirm(actionNode);
      break;
    case 'welcome-start':
    case 'welcome-close':
      await dismissWelcome();
      break;
    case 'toggle-setting':
      await toggleSetting(actionNode);
      break;
    case 'test-notification': {
      const result = await api.testNotification();
      if (!result || !result.ok) toast('测试失败', (result && result.error) || '当前系统不支持通知');
      break;
    }
    case 'open-data-dir': {
      const result = await api.openDataDir();
      if (!result || !result.ok) toast('打不开数据文件夹', (result && result.error) || '请手动打开');
      break;
    }
    default:
      break;
  }
}

function onDocumentChange(event) {
  const target = event.target;
  if (!target || !target.id) return;
  if (target.id === 'taskDate') syncDateChips(target.value);
  else if (target.id === 'estimateCustomInput') {
    const value = Number(target.value);
    if (state.modalContext) {
      state.modalContext.estimateMinutes = Number.isFinite(value) && value > 0
        ? Math.min(1440, Math.max(5, Math.round(value)))
        : 0;
    }
  }
  else if (target.id === 'appointmentDate') updateAppointmentPreview(target.value);
  else if (target.id === 'settingsApptTime') updateAppointmentTime(target.value);
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    if (state.modalKind) {
      closeModal();
      event.preventDefault();
      return;
    }
    api.closePanel();
    return;
  }
  if (state.modalKind) return;
  const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea';
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openTaskModal();
  } else if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openTaskModal();
  }
}

// ---------------------------------------------------------------------------
// Modal plumbing
// ---------------------------------------------------------------------------
function openModal(html, options = {}) {
  state.modalKind = options.kind || 'custom';
  state.modalContext = options.context || null;
  nodes.modalCard.innerHTML = html;
  nodes.modalCard.onclick = null;
  nodes.modalRoot.hidden = false;
  document.body.classList.add('modal-open');
  api.setUiState({ modal: true });
  const focusTarget = nodes.modalCard.querySelector('[data-autofocus]')
    || nodes.modalCard.querySelector('input, textarea');
  if (focusTarget) setTimeout(() => { try { focusTarget.focus(); } catch { /* ignore */ } }, 40);
}

function closeModal() {
  if (!state.modalKind) return;
  state.modalKind = null;
  state.modalContext = null;
  nodes.modalRoot.hidden = true;
  nodes.modalCard.innerHTML = '';
  document.body.classList.remove('modal-open');
  api.setUiState({ modal: false });
}

function modalError(message) {
  const node = nodes.modalCard.querySelector('#formError');
  if (node) node.textContent = message;
  else toast('没有完成', message);
}

function setBusy(button, busy, busyLabel = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.original || button.textContent;
    button.disabled = false;
  }
}

function modalHead(kicker, title, subtitle) {
  return `
    <header class="modal-head">
      <div>
        <div class="eyebrow">${esc(kicker)}</div>
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      </div>
      <button class="icon-btn" type="button" data-act="close-modal" aria-label="关闭">${ICONS.close}</button>
    </header>`;
}

// ---------------------------------------------------------------------------
// Task editor
// ---------------------------------------------------------------------------
function renderEstimatePicker(estimate) {
  const custom = estimate > 0 && !ESTIMATE_PRESETS.includes(estimate);
  const chips = ESTIMATE_PRESETS.map((value) => `
    <button type="button" class="estimate-chip ${value === estimate ? 'on' : ''}" data-estimate="${value}">
      ${value === 0 ? '不设置' : formatDuration(value)}
    </button>`).join('');
  return `
    <div class="field">
      <span class="field-label">预计要用多久？</span>
      <div class="estimate-picker">
        ${chips}
        <button type="button" class="estimate-chip ${custom ? 'on' : ''}" data-estimate="custom">自定义</button>
      </div>
      <div class="estimate-custom" id="estimateCustom" ${custom ? '' : 'hidden'}>
        <input id="estimateCustomInput" type="number" min="5" max="1440" step="5" placeholder="90" value="${custom ? estimate : ''}">
        <span>分钟</span>
      </div>
    </div>`;
}

function selectEstimateChip(value) {
  if (!state.modalContext) return;
  const customPanel = nodes.modalCard.querySelector('#estimateCustom');
  const customInput = nodes.modalCard.querySelector('#estimateCustomInput');
  if (value === 'custom') {
    state.modalContext.estimateMode = 'custom';
    if (customPanel) customPanel.hidden = false;
    if (customInput) {
      if (!customInput.value && state.modalContext.estimateMinutes) {
        customInput.value = String(state.modalContext.estimateMinutes);
      }
      customInput.focus();
      customInput.select();
    }
  } else {
    state.modalContext.estimateMode = 'preset';
    state.modalContext.estimateMinutes = Number(value) || 0;
    if (customPanel) customPanel.hidden = true;
  }
  for (const chip of nodes.modalCard.querySelectorAll('.estimate-chip')) {
    chip.classList.toggle('on', chip.dataset.estimate === String(value));
  }
}

function readEstimateFromModal() {
  const context = state.modalContext;
  if (!context) return 0;
  if (context.estimateMode !== 'custom') return context.estimateMinutes || 0;
  const input = nodes.modalCard.querySelector('#estimateCustomInput');
  const value = Number(input && input.value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1440, Math.max(5, Math.round(value)));
}

function openTaskModal(task = null, preset = {}) {
  if (!state.snapshot) return;
  const snapshot = state.snapshot;
  const quadrant = task ? task.quadrant : (preset.quadrant || 2);
  const date = task ? task.date : (preset.date || snapshot.today);
  const today = snapshot.today;
  const estimate = task ? (task.estimateMinutes || 0) : 30;
  const estimateMode = estimate > 0 && !ESTIMATE_PRESETS.includes(estimate) ? 'custom' : 'preset';
  const chips = [
    ['今天', today],
    ['明天', addDaysKey(today, 1)],
    ['后天', addDaysKey(today, 2)],
  ];

  const picker = snapshot.quadrants.map((entry) => `
    <button type="button" class="quad-option ${entry.id === quadrant ? 'on' : ''}" data-q="${entry.id}" style="--q:${entry.color}">
      <span class="qo-dot"></span>
      <span class="qo-name">${esc(entry.name)}</span>
      <span class="qo-hint">${esc(entry.hint)}</span>
    </button>`).join('');

  const html = `
    ${modalHead(task ? 'EDIT TASK' : 'NEW TASK', task ? '编辑待办' : '新建待办', '选好象限和预计用时，写清楚要做什么。')}
    <form id="modalForm" novalidate>
      <label class="field">
        <span>要做的事</span>
        <input class="big" id="modalTitleInput" type="text" maxlength="120" placeholder="比如：整理这周的读书笔记" value="${esc(task ? task.title : '')}" data-autofocus>
      </label>
      <div class="field">
        <span class="field-label">放在哪个象限？</span>
        <div class="quad-picker">${picker}</div>
      </div>
      ${renderEstimatePicker(estimate)}
      <div class="field">
        <span class="field-label">哪天做？</span>
        <div class="date-chips">
          ${chips.map(([label, value]) => `<button type="button" class="date-chip ${value === date ? 'on' : ''}" data-date="${value}">${label}</button>`).join('')}
        </div>
        <input id="taskDate" type="date" min="${today}" value="${date}">
      </div>
      <label class="field">
        <span>备注（可选）</span>
        <textarea id="modalNote" maxlength="500" placeholder="补充一点细节…">${esc(task ? task.note : '')}</textarea>
      </label>
      <div class="form-error" id="formError"></div>
      <div class="modal-actions">
        ${task ? '<button class="danger-btn" type="button" data-act="delete-task">删除</button>' : ''}
        <span class="spacer"></span>
        <button class="ghost-btn" type="button" data-act="close-modal">取消</button>
        <button class="primary-btn" type="submit">${task ? '保存修改' : '创建待办'}</button>
      </div>
    </form>`;

  openModal(html, {
    kind: 'task',
    context: { task, quadrant, date, estimateMinutes: estimate, estimateMode },
  });

  const form = nodes.modalCard.querySelector('#modalForm');
  const dateInput = nodes.modalCard.querySelector('#taskDate');
  const titleInput = nodes.modalCard.querySelector('#modalTitleInput');
  const noteInput = nodes.modalCard.querySelector('#modalNote');
  const errorNode = nodes.modalCard.querySelector('#formError');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    const title = titleInput.value.trim();
    if (!title) {
      errorNode.textContent = '请先写清楚要做什么。';
      titleInput.focus();
      return;
    }
    const dueDate = dateInput.value && dateInput.value >= snapshot.today ? dateInput.value : snapshot.today;
    const estimateMinutes = readEstimateFromModal();
    if (state.modalContext && state.modalContext.estimateMode === 'custom' && !estimateMinutes) {
      errorNode.textContent = '请填写预计用时，或选择「不设置」。';
      return;
    }
    const payload = {
      title,
      note: noteInput.value.trim(),
      quadrant: state.modalContext ? state.modalContext.quadrant : quadrant,
      estimateMinutes,
      date: dueDate,
      month: state.month,
    };
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    const result = task
      ? await api.updateTask({ id: task.id, patch: payload, month: state.month })
      : await api.addTask(payload);
    setBusy(submit, false);
    if (!result || !result.ok) {
      errorNode.textContent = (result && result.error) || '保存失败，请稍后再试。';
      return;
    }
    applySnapshot(result.snapshot);
    closeModal();
    toast(task ? '修改已保存' : '待办已创建', task ? task.title : title, { duration: 2200 });
  });

  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
}

function selectQuadrantOption(quadrant) {
  if (!state.modalContext) return;
  state.modalContext.quadrant = quadrant;
  for (const option of nodes.modalCard.querySelectorAll('.quad-option')) {
    option.classList.toggle('on', Number(option.dataset.q) === quadrant);
  }
}

function selectDateChip(date) {
  const input = nodes.modalCard.querySelector('#taskDate');
  if (!input) return;
  input.value = date;
  syncDateChips(date);
}

function syncDateChips(date) {
  for (const chip of nodes.modalCard.querySelectorAll('.date-chip')) {
    chip.classList.toggle('on', chip.dataset.date === date);
  }
}

// ---------------------------------------------------------------------------
// Habit editor
// ---------------------------------------------------------------------------
function openHabitModal(habit = null) {
  if (!state.snapshot) return;
  const html = `
    ${modalHead(habit ? 'EDIT HABIT' : 'NEW HABIT', habit ? '编辑打卡项' : '新建打卡项', '每天同一个时间提醒你，完成后在打卡表上打钩。')}
    <form id="modalForm" novalidate>
      <label class="field">
        <span>打卡内容</span>
        <input class="big" id="modalTitleInput" type="text" maxlength="120" placeholder="比如：背单词 30 个" value="${esc(habit ? habit.title : '')}" data-autofocus>
      </label>
      <div class="field-row">
        <label class="field" style="max-width:230px;margin-bottom:12px">
          <span>每天提醒时间</span>
          <input id="habitTime" type="time" value="${esc(habit ? habit.time : '20:00')}">
        </label>
      </div>
      <label class="field">
        <span>说明（可选）</span>
        <textarea id="modalNote" maxlength="300" placeholder="比如：每天 30 个，周末 20 个">${esc(habit ? habit.note : '')}</textarea>
      </label>
      <p class="settings-note">到点会提醒你打卡；漏掉的日子在打卡表上留空，也可以点过去的日子补卡。</p>
      <div class="form-error" id="formError"></div>
      <div class="modal-actions">
        ${habit ? '<button class="danger-btn" type="button" data-act="delete-habit-modal">删除</button>' : ''}
        <span class="spacer"></span>
        <button class="ghost-btn" type="button" data-act="close-modal">取消</button>
        <button class="primary-btn" type="submit">${habit ? '保存修改' : '创建打卡'}</button>
      </div>
    </form>`;
  openModal(html, { kind: 'habit', context: { habit } });

  const form = nodes.modalCard.querySelector('#modalForm');
  const titleInput = nodes.modalCard.querySelector('#modalTitleInput');
  const timeInput = nodes.modalCard.querySelector('#habitTime');
  const noteInput = nodes.modalCard.querySelector('#modalNote');
  const errorNode = nodes.modalCard.querySelector('#formError');

  const deleteButton = nodes.modalCard.querySelector('[data-act="delete-habit-modal"]');
  if (deleteButton && habit) {
    deleteButton.addEventListener('click', () => {
      closeModal();
      requestDelete('habit', habit);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    const title = titleInput.value.trim();
    if (!title) {
      errorNode.textContent = '请先写清楚要打卡的事。';
      titleInput.focus();
      return;
    }
    if (!timeInput.value) {
      errorNode.textContent = '请选择每天的提醒时间。';
      return;
    }
    const payload = {
      title,
      time: timeInput.value,
      note: noteInput.value.trim(),
      month: state.month,
    };
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    const result = habit
      ? await api.updateHabit({ id: habit.id, patch: payload, month: state.month })
      : await api.addHabit(payload);
    setBusy(submit, false);
    if (!result || !result.ok) {
      errorNode.textContent = (result && result.error) || '保存失败，请稍后再试。';
      return;
    }
    applySnapshot(result.snapshot);
    closeModal();
    toast(habit ? '打卡项已更新' : '打卡项已创建', `每天 ${timeInput.value} 提醒你`, { duration: 2600 });
  });
}

// ---------------------------------------------------------------------------
// Appointment editor
// ---------------------------------------------------------------------------
function openAppointmentModal(appointment = null) {
  if (!state.snapshot) return;
  const snapshot = state.snapshot;
  const defaultDate = appointment ? appointment.date : addDaysKey(snapshot.today, 1);
  const minDate = appointment && appointment.date < snapshot.today ? appointment.date : snapshot.today;
  const quadrant = appointment ? appointment.quadrant : 2;
  const picker = snapshot.quadrants.map((entry) => `
    <button type="button" class="quad-option ${entry.id === quadrant ? 'on' : ''}" data-q="${entry.id}" style="--q:${entry.color}">
      <span class="qo-dot"></span>
      <span class="qo-name">${esc(entry.name)}</span>
      <span class="qo-hint">${esc(entry.hint)}</span>
    </button>`).join('');
  const html = `
    ${modalHead(appointment ? 'EDIT APPOINTMENT' : 'NEW APPOINTMENT', appointment ? '编辑预约' : '新建预约', '提前 2 天和 1 天提醒你，时间在设置里调整。')}
    <form id="modalForm" novalidate>
      <label class="field">
        <span>预约内容</span>
        <input class="big" id="modalTitleInput" type="text" maxlength="120" placeholder="比如：牙医复诊" value="${esc(appointment ? appointment.title : '')}" data-autofocus>
      </label>
      <div class="field">
        <span class="field-label">重要紧急程度</span>
        <div class="quad-picker">${picker}</div>
      </div>
      <div class="field-row">
        <label class="field">
          <span>日期</span>
          <input id="appointmentDate" type="date" min="${minDate}" value="${defaultDate}">
        </label>
        <label class="field">
          <span>时间</span>
          <input id="appointmentTime" type="time" value="${esc(appointment ? appointment.time : '09:00')}">
        </label>
      </div>
      <label class="field">
        <span>地点（可选）</span>
        <input id="appointmentLocation" type="text" maxlength="160" placeholder="比如：市口腔医院" value="${esc(appointment ? appointment.location : '')}">
      </label>
      <label class="field">
        <span>备注（可选）</span>
        <textarea id="modalNote" maxlength="500" placeholder="要带的东西、联系人…">${esc(appointment ? appointment.note : '')}</textarea>
      </label>
      <div class="reminder-preview" id="reminderPreview">${reminderPreviewHtml(defaultDate)}</div>
      <div class="form-error" id="formError"></div>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button class="ghost-btn" type="button" data-act="close-modal">取消</button>
        <button class="primary-btn" type="submit">${appointment ? '保存修改' : '创建预约'}</button>
      </div>
    </form>`;
  openModal(html, { kind: 'appointment', context: { appointment, quadrant } });

  const form = nodes.modalCard.querySelector('#modalForm');
  const titleInput = nodes.modalCard.querySelector('#modalTitleInput');
  const dateInput = nodes.modalCard.querySelector('#appointmentDate');
  const timeInput = nodes.modalCard.querySelector('#appointmentTime');
  const locationInput = nodes.modalCard.querySelector('#appointmentLocation');
  const noteInput = nodes.modalCard.querySelector('#modalNote');
  const errorNode = nodes.modalCard.querySelector('#formError');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    const title = titleInput.value.trim();
    if (!title) {
      errorNode.textContent = '请先写清楚预约内容。';
      titleInput.focus();
      return;
    }
    if (!dateInput.value) {
      errorNode.textContent = '请选择预约日期。';
      return;
    }
    if (!timeInput.value) {
      errorNode.textContent = '请选择预约时间。';
      return;
    }
    const payload = {
      title,
      date: dateInput.value,
      time: timeInput.value,
      quadrant: state.modalContext ? state.modalContext.quadrant : 2,
      location: locationInput.value.trim(),
      note: noteInput.value.trim(),
      month: state.month,
    };
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    const result = appointment
      ? await api.updateAppointment({ id: appointment.id, patch: payload, month: state.month })
      : await api.addAppointment(payload);
    setBusy(submit, false);
    if (!result || !result.ok) {
      errorNode.textContent = (result && result.error) || '保存失败，请稍后再试。';
      return;
    }
    applySnapshot(result.snapshot);
    closeModal();
    toast(appointment ? '预约已更新' : '预约已创建', `${formatCnDate(dateInput.value)} ${timeInput.value} · ${title}`, { duration: 3000 });
  });
}

function reminderPreviewHtml(dateKeyValue) {
  if (!state.snapshot || !parseKey(dateKeyValue)) return '选好日期后，这里会显示提醒时间。';
  const today = state.snapshot.today;
  const at = state.snapshot.settings.appointmentTime;
  const now = state.snapshot.nowHM;
  const entries = [2, 1].map((days) => {
    const date = addDaysKey(dateKeyValue, -days);
    const isToday = date === today;
    const isTomorrow = date === addDaysKey(today, 1);
    const passed = date < today || (isToday && now >= at);
    const label = isToday ? '今天' : isTomorrow ? '明天' : formatCnDate(date);
    return {
      days,
      passed,
      html: `<span class="${passed ? 'dim' : ''}">提前 ${days} 天 · ${label} ${at} ${passed ? '已过' : '提醒'}</span>`,
    };
  });
  const warning = entries.every((entry) => entry.passed)
    ? '<span class="warn-line">两次提醒时间都已经过去，保存后不会再提前提醒。</span>'
    : '';
  return `<b>提醒计划</b>${entries.map((entry) => entry.html).join('')}${warning}`;
}

function updateAppointmentPreview(date) {
  const preview = nodes.modalCard.querySelector('#reminderPreview');
  if (preview) preview.innerHTML = reminderPreviewHtml(date);
}

function updateAppointmentTime(value) {
  if (!value) return;
  api.updateSettings({ appointmentTime: value, month: state.month }).then((result) => {
    if (!result || !result.ok) {
      toast('提醒时间没有保存', (result && result.error) || '请稍后再试');
      return;
    }
    applySnapshot(result.snapshot);
    toast('预约提醒时间已更新', `每天 ${value} 检查预约提醒`, { duration: 2600 });
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function openSettingsModal() {
  if (!state.snapshot) return;
  const settings = state.snapshot.settings;
  const row = (key, title, subtitle, checked) => `
    <div class="setting-row">
      <div class="setting-info"><b>${esc(title)}</b><span>${esc(subtitle)}</span></div>
      <button class="switch ${checked ? 'on' : ''}" type="button" role="switch" aria-checked="${checked}" data-act="toggle-setting" data-setting="${key}" aria-label="${esc(title)}"></button>
    </div>`;

  const html = `
    ${modalHead('SETTINGS', '设置', '让浮光待办更贴合你的节奏。')}
    <div class="settings-list">
      ${row('hoverEnabled', '鼠标悬停唤出', '鼠标移到屏幕左边缘时自动打开面板。', settings.hoverEnabled)}
      ${row('desktopOnlyHover', '只在桌面悬停呼出', '在其他软件里碰到左边缘不会打开；关掉后恢复任意位置悬停。', settings.desktopOnlyHover)}
      ${row('notifications', '系统提醒', '打卡到点、预约提前 2 天和 1 天提醒你。', settings.notifications)}
      ${row('startAtLogin', '开机自动启动', '登录 Windows 后在左边缘安静待命。', settings.startAtLogin)}
      <div class="setting-row">
        <div class="setting-info"><b>预约提醒时间</b><span>每天在这个时间检查“2 天后 / 明天”的预约。</span></div>
        <div class="settings-time">
          <input id="settingsApptTime" type="time" value="${esc(settings.appointmentTime)}" style="width:104px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.055);color:#fff;padding:7px 9px;font-size:12px;color-scheme:dark">
        </div>
      </div>
    </div>
    <div class="settings-note">
      <b>数据只保存在本机。</b>每日自动备份，最多保留 60 份。
      <div class="data-path">${esc(state.snapshot.dataFile || '')}</div>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" type="button" data-act="open-data-dir">打开数据文件夹</button>
      <button class="ghost-btn" type="button" data-act="test-notification">测试通知</button>
      <span class="spacer"></span>
      <button class="primary-btn" type="button" data-act="close-modal">完成</button>
    </div>
    <div class="settings-note" style="text-align:right">浮光待办 v${esc(state.snapshot.version || '1.2.0')}</div>`;

  openModal(html, { kind: 'settings' });
}

async function toggleSetting(button) {
  const key = button.dataset.setting;
  if (!key) return;
  const next = !button.classList.contains('on');
  button.classList.toggle('on', next);
  button.setAttribute('aria-checked', String(next));
  const result = await api.updateSettings({ [key]: next, month: state.month });
  if (!result || !result.ok) {
    button.classList.toggle('on', !next);
    button.setAttribute('aria-checked', String(!next));
    toast('设置没有保存', (result && result.error) || '请稍后再试');
    return;
  }
  applySnapshot(result.snapshot);
}

// ---------------------------------------------------------------------------
// Welcome + confirm
// ---------------------------------------------------------------------------
function openWelcomeModal() {
  const html = `
    ${modalHead('WELCOME', '欢迎使用浮光待办', '一个藏在桌面左边缘的玻璃待办清单。')}
    <div class="welcome-art"></div>
    <div class="welcome-steps">
      <div class="welcome-step"><i>1</i><div><b>回到桌面，鼠标移到屏幕左边缘</b><br>面板会轻轻滑出来；在其他软件里碰到边缘不会打扰你。移开片刻自动收起，也可以点右上角图钉钉住，或点托盘图标随时打开。</div></div>
      <div class="welcome-step"><i>2</i><div><b>四象限安排今天</b><br>重要紧急、重要不紧急、紧急不重要、不紧急不重要，颜色一眼分清。</div></div>
      <div class="welcome-step"><i>3</i><div><b>每天打卡，月底看月报</b><br>未完成的待办会顺延到第二天并标注拖延；预约会提前 2 天和 1 天提醒。</div></div>
    </div>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button class="ghost-btn" type="button" data-act="welcome-close">先看看</button>
      <button class="primary-btn" type="button" data-act="welcome-start" data-autofocus>开始使用</button>
    </div>`;
  openModal(html, { kind: 'welcome' });
}

async function dismissWelcome() {
  closeModal();
  if (!state.snapshot || !state.snapshot.firstRun) return;
  const result = await api.updateSettings({ firstRunDone: true, month: state.month });
  if (result && result.ok && result.snapshot) applySnapshot(result.snapshot);
  toast('随时呼出', '回到桌面后鼠标移到屏幕左边缘，浮光待办就会出现；也可以点托盘图标。', { duration: 4200 });
}

function requestDelete(kind, item) {
  const labels = { task: '待办', habit: '打卡项', appointment: '预约' };
  const label = labels[kind] || '内容';
  closeModal();
  const html = `
    ${modalHead('CONFIRM', `删除${label}`, '删除后无法恢复。')}
    <p class="confirm-message">确定删除「${esc(item.title)}」吗？</p>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button class="ghost-btn" type="button" data-act="cancel-confirm">取消</button>
      <button class="danger-btn" type="button" data-act="confirm-delete">删除</button>
    </div>`;
  openModal(html, {
    kind: 'confirm',
    context: {
      kind,
      item,
      successMessage: `${label}已删除`,
    },
  });
}

async function runConfirm(button) {
  const context = state.modalContext;
  if (!context) return;
  setBusy(button, true, '删除中…');
  let result;
  if (context.kind === 'task') result = await api.deleteTask({ id: context.item.id, month: state.month });
  else if (context.kind === 'habit') result = await api.deleteHabit({ id: context.item.id, month: state.month });
  else if (context.kind === 'appointment') result = await api.deleteAppointment({ id: context.item.id, month: state.month });
  else result = { ok: false, error: '未知操作' };
  if (!result || !result.ok) {
    setBusy(button, false);
    toast('没有删除', (result && result.error) || '请稍后再试');
    return;
  }
  if (result.snapshot) applySnapshot(result.snapshot);
  closeModal();
  toast(context.successMessage || '已删除', '', { duration: 2200 });
}

// ---------------------------------------------------------------------------
// Toast / hint
// ---------------------------------------------------------------------------
function toast(title, message = '', options = {}) {
  if (!nodes.toastRoot) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<b>${esc(title)}</b>${message ? `<p>${esc(message)}</p>` : ''}`;
  if (options.tab) {
    node.addEventListener('click', () => {
      switchTab(options.tab);
      node.remove();
    });
  }
  nodes.toastRoot.appendChild(node);
  while (nodes.toastRoot.children.length > 3) {
    nodes.toastRoot.firstElementChild.remove();
  }
  const duration = options.duration || 5200;
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  }, duration);
}

function showFirstHint() {
  if (!state.snapshot || !state.snapshot.firstRun) return;
  document.body.classList.add('hint');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    document.body.classList.remove('hint');
  }, 12000);
}

function hideFirstHint() {
  clearTimeout(hintTimer);
  document.body.classList.remove('hint');
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
