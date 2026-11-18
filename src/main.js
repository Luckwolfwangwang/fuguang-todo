'use strict';

/**
 * 浮光待办 main process.
 *
 * The window is a transparent, always-on-top strip pinned to the left edge of
 * the primary display. It ignores the mouse while collapsed, and a light-weight
 * cursor poll opens it when the pointer reaches the left edge. The same window
 * hosts the four tabs: 今日 / 打卡 / 预约 / 月报.
 */

const {
  app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage,
  Notification, desktopCapturer, dialog,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const D = require('./dates');
const { TodoStore, TodoError, APP_NAME, QUADRANTS } = require('./store');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..');
const APP_TITLE = '浮光待办';
const ICON_PATH = path.join(ROOT, 'assets', 'icon.ico');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const RENDERER_PATH = path.join(__dirname, 'renderer', 'index.html');
const TEST_MODE = process.env.FUGUANG_TODO_TEST === '1';
const CAPTURE_MODE = process.env.FUGUANG_TODO_CAPTURE === '1' || process.argv.includes('--capture');
const DATA_DIR = process.env.FUGUANG_TODO_DATA_DIR || path.join(app.getPath('appData'), 'FuguangTodo');

// Electron creates its single-instance lock before the first window, and that
// lock lives in userData. Make sure the folder exists even on a first run.
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* the sandbox may deny AppData in constrained environments */
}

app.setName('FuguangTodo');
app.setPath('userData', DATA_DIR);
app.setAppUserModelId('com.fuguang.todo');
if (CAPTURE_MODE) app.disableHardwareAcceleration();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let win = null;
let tray = null;
let store = null;
let dataFile = '';
let logFile = '';
let quitting = false;
let allowQuit = false;
let panelOpen = false;
let modalOpen = false;
let pinned = false;
let hoverTimer = null;
let reminderTimer = null;
let closeTimer = null;
let outsideSince = 0;
let lastBackdropAt = 0;
let backdropBusy = false;
let healTimers = [];
let rendererRecoveries = 0;
let lastDayKey = '';
let desktopWatch = null;
let desktopWatchReady = false;
let desktopWatchFallback = false;
let desktopForeground = false;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ')}`;
  try {
    console.log(line);
  } catch {
    /* no console in a packaged build */
  }
  if (!logFile) return;
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1.5 * 1024 * 1024) {
      fs.renameSync(logFile, `${logFile}.old`);
    }
    fs.appendFileSync(logFile, `${line}\r\n`, 'utf8');
  } catch {
    /* logging must never break the app */
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  if (error instanceof TodoError) return error.message;
  if (error && error.message) return `操作没有完成：${error.message}`;
  return '操作没有完成';
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
function setupStore() {
  logFile = path.join(app.getPath('userData'), 'app.log');
  dataFile = path.join(app.getPath('userData'), 'data.json');
  store = new TodoStore({ file: dataFile, logger: log });
  store.open();
  store.ensureDailyBackup();
  pinned = store.state.settings.pinned;
  lastDayKey = D.todayKey();
  log('store ready', {
    file: dataFile,
    tasks: store.state.tasks.length,
    habits: store.state.habits.length,
    appointments: store.state.appointments.length,
  });
  if (CAPTURE_MODE) {
    try {
      const { seedDemo } = require(path.join(ROOT, 'scripts', 'demo.js'));
      seedDemo(store);
      pinned = true;
      log('demo data seeded for capture');
    } catch (error) {
      log('demo seed failed', error.message);
    }
  }
}

function snapshotFor(payload = {}) {
  const snapshot = store.buildSnapshot({ month: payload && payload.month });
  const displayDataFile = CAPTURE_MODE
    ? path.join(app.getPath('appData'), 'FuguangTodo', 'data.json')
    : dataFile;
  return {
    ...snapshot,
    version: app.getVersion(),
    dataFile: displayDataFile,
    testMode: TEST_MODE,
    captureMode: CAPTURE_MODE,
  };
}

function pushChange(reason) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('todo:changed', { reason, at: Date.now() });
  } catch (error) {
    log('push change failed', error.message);
  }
}

function updateTrayTooltip() {
  if (!tray || !store) return;
  const today = D.todayKey();
  const open = store.state.tasks.filter((task) => task.date === today && !task.done).length;
  const due = store.state.habits.filter((habit) => habit.createdAt <= today && !habit.checkins[today]).length;
  const parts = [`今天 ${open} 项待办`];
  if (due) parts.push(`${due} 项打卡`);
  try {
    tray.setToolTip(`${APP_TITLE} · ${parts.join(' · ')}`);
  } catch {
    /* tray may be gone during shutdown */
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function getLayout() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.max(520, Math.min(680, Math.round(area.width / 3.2)));
  return {
    x: area.x,
    y: area.y,
    width,
    height: area.height,
    area,
  };
}

function nudgeWindow() {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    win.setBounds({ ...bounds, width: bounds.width + 1 }, false);
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        try {
          win.setBounds(bounds, false);
        } catch {
          /* ignore */
        }
      }
    }, 90);
  } catch (error) {
    log('window nudge failed', error.message);
  }
}

function ensureWindowVisible(reason) {
  if (!win || win.isDestroyed() || quitting) return;
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    win.webContents.invalidate();
    nudgeWindow();
    log('window health:', reason);
  } catch (error) {
    log('window health failed:', reason, error.message);
  }
}

function scheduleWindowHealth() {
  for (const wait of [320, 1400, 3800]) {
    const timer = setTimeout(() => ensureWindowVisible(`startup+${wait}ms`), wait);
    healTimers.push(timer);
  }
}

function applyLayout() {
  if (!win || win.isDestroyed()) return;
  const layout = getLayout();
  win.setBounds({ x: layout.x, y: layout.y, width: layout.width, height: layout.height }, false);
}

function createWindow() {
  const layout = getLayout();
  const options = {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: APP_TITLE,
    icon: ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  };
  if (IS_WIN) options.backgroundMaterial = 'none';

  win = new BrowserWindow(options);
  win.setMenu(null);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setSkipTaskbar(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(RENDERER_PATH);

  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    win.showInactive();
    win.setIgnoreMouseEvents(true, { forward: true });
    scheduleWindowHealth();
    if (CAPTURE_MODE) {
      setTimeout(() => openPanel({ focus: true }), 500);
      return;
    }
    if (process.argv.includes('--open-panel')) {
      setTimeout(() => {
        if (win && !win.isDestroyed() && !quitting) openPanel({ focus: true });
      }, 700);
    }
    // A transparent window restored very early at logon can stay blank until a
    // resize. The drawer had the same Windows quirk; one reload fixes it.
    setTimeout(() => {
      if (!win || win.isDestroyed() || quitting || panelOpen) return;
      try {
        win.webContents.reload();
      } catch (error) {
        log('startup reload failed', error.message);
      }
    }, 1800);
  });

  win.webContents.on('did-finish-load', () => {
    log('renderer loaded');
    rendererRecoveries = 0;
    if (CAPTURE_MODE) setTimeout(() => runCapture().catch((error) => {
      log('capture failed', error.message);
      process.exitCode = 1;
      quitApp();
    }), 300);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log('renderer gone:', details.reason, 'recoveries=', rendererRecoveries);
    if (quitting) return;
    rendererRecoveries += 1;
    if (rendererRecoveries > 3) {
      log('renderer repeatedly failed, quitting');
      quitApp();
      return;
    }
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try {
        win.reload();
      } catch {
        /* ignore */
      }
    }, 600);
  });

  win.on('unresponsive', () => {
    if (quitting) return;
    log('window unresponsive, reloading');
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try {
        win.webContents.reload();
      } catch {
        /* ignore */
      }
    }, 800);
  });

  win.webContents.on('did-fail-load', (_event, code, description) => {
    log('renderer load failed:', code, description);
    if (quitting) return;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try {
        win.reload();
      } catch {
        /* ignore */
      }
    }, 900);
  });

  win.on('blur', () => {
    if (!panelOpen || pinned || modalOpen || quitting) return;
    scheduleClose(280);
  });

  win.on('close', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    closePanel();
  });

  win.on('closed', () => {
    for (const timer of healTimers) clearTimeout(timer);
    healTimers = [];
    win = null;
  });
}

// ---------------------------------------------------------------------------
// Panel open / close
// ---------------------------------------------------------------------------
function openPanel(options = {}) {
  if (!win || win.isDestroyed() || quitting) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.showInactive();
  try {
    win.setIgnoreMouseEvents(false);
    win.moveTop();
  } catch (error) {
    log('open panel failed', error.message);
    return;
  }
  panelOpen = true;
  outsideSince = 0;
  cancelScheduledClose();
  if (options.tab) {
    try {
      win.webContents.send('panel:tab', { tab: options.tab });
    } catch {
      /* the renderer may still be loading; it will refresh itself */
    }
  }
  try {
    win.webContents.send('panel:open', {
      tab: options.tab || null,
      firstRun: !store.state.settings.firstRunDone,
    });
  } catch (error) {
    log('open event failed', error.message);
  }
  if (options.focus) {
    try {
      win.show();
      win.focus();
    } catch (error) {
      log('panel focus failed', error.message);
    }
  }
  log('panel open', { tab: options.tab || null, focus: Boolean(options.focus) });
}

function cancelScheduledClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function scheduleClose(wait = 700) {
  if (!panelOpen || pinned || modalOpen || quitting) return;
  cancelScheduledClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    closePanel();
  }, wait);
}

function closePanel() {
  cancelScheduledClose();
  if (!panelOpen || !win || win.isDestroyed()) return;
  panelOpen = false;
  modalOpen = false;
  try {
    win.webContents.send('panel:closed');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    if (!panelOpen && win && !win.isDestroyed()) {
      try {
        win.setIgnoreMouseEvents(true, { forward: true });
      } catch {
        /* ignore */
      }
    }
  }, 520);
  setTimeout(() => {
    if (!panelOpen && !TEST_MODE && !CAPTURE_MODE) refreshBackdrop().catch(() => {});
  }, 1600);
  log('panel close');
}

// ---------------------------------------------------------------------------
// Foreground desktop watcher
// ---------------------------------------------------------------------------
/**
 * The panel should only open from a hover while the Windows desktop is the
 * foreground window. A tiny helper prints 1/0 for "desktop"/"other app"; it is
 * far cheaper than polling Win32 from the main process.
 */
function startDesktopWatcher() {
  if (!IS_WIN || TEST_MODE || CAPTURE_MODE) {
    desktopWatchFallback = true;
    return;
  }
  stopDesktopWatcher();
  const helperPath = path.join(__dirname, 'desktop-watch.exe');
  if (!fs.existsSync(helperPath)) {
    desktopWatchFallback = true;
    log('desktop watcher missing, hover falls back to any foreground app');
    return;
  }
  try {
    desktopWatch = spawn(helperPath, [String(process.pid)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buffer = '';
    desktopWatch.stdout.setEncoding('utf8');
    desktopWatch.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== '0' && line !== '1') continue;
        const next = line === '1';
        if (!desktopWatchReady) {
          desktopWatchReady = true;
          log('desktop watcher ready:', next ? 'desktop' : 'app');
        } else if (next !== desktopForeground) {
          log('desktop foreground:', next ? 'desktop' : 'app');
        }
        desktopForeground = next;
      }
    });
    desktopWatch.on('error', (error) => {
      log('desktop watcher error:', error.message);
      desktopWatchFallback = true;
      desktopWatch = null;
      desktopWatchReady = false;
    });
    desktopWatch.on('exit', (code) => {
      if (quitting) return;
      log('desktop watcher exited:', code);
      desktopWatch = null;
      desktopWatchReady = false;
      // Fail open: if the helper cannot run, keep the classic hover behavior
      // instead of making the panel impossible to open.
      desktopWatchFallback = true;
    });
    log('desktop watcher started');
  } catch (error) {
    desktopWatchFallback = true;
    log('desktop watcher spawn failed:', error.message);
  }
}

function stopDesktopWatcher() {
  if (!desktopWatch) return;
  try {
    desktopWatch.kill();
  } catch {
    /* ignore */
  }
  desktopWatch = null;
  desktopWatchReady = false;
}

function canHoverOpen() {
  if (!store) return true;
  if (store.state.settings.desktopOnlyHover === false) return true;
  if (desktopWatchFallback) return true;
  if (!desktopWatchReady) return false;
  return desktopForeground;
}

function startHoverWatcher() {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = setInterval(() => {
    if (!win || win.isDestroyed() || quitting || !store) return;
    if (!store.state.settings.hoverEnabled) return;
    if (modalOpen) return;
    if (!panelOpen && !canHoverOpen()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    if (!panelOpen) {
      if (CAPTURE_MODE) return;
      const onEdge = point.x <= bounds.x + 26 && point.x >= bounds.x - 2;
      const middle = bounds.y + bounds.height / 2;
      if (onEdge && Math.abs(point.y - middle) <= 200) openPanel();
      return;
    }
    if (pinned) return;
    const inside = point.x >= bounds.x - 4 && point.x <= bounds.x + bounds.width + 4
      && point.y >= bounds.y - 6 && point.y <= bounds.y + bounds.height + 6;
    if (inside) {
      outsideSince = 0;
      cancelScheduledClose();
    } else {
      if (!outsideSince) outsideSince = Date.now();
      else if (Date.now() - outsideSince > 1100) closePanel();
    }
  }, 90);
}

// ---------------------------------------------------------------------------
// Frosted backdrop (captured while the panel is collapsed)
// ---------------------------------------------------------------------------
async function refreshBackdrop(force = false) {
  if (!IS_WIN || !win || win.isDestroyed() || backdropBusy || TEST_MODE) return;
  if (!force && Date.now() - lastBackdropAt < 15000) return;
  if (panelOpen) return;
  backdropBusy = true;
  try {
    const display = screen.getPrimaryDisplay();
    const bounds = win.getBounds();
    const thumbWidth = Math.max(900, Math.round(display.size.width * 0.9));
    const thumbHeight = Math.round((thumbWidth * display.size.height) / display.size.width);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight },
      fetchWindowIcons: false,
    });
    if (!sources || !sources.length) return;
    const source = sources.find((entry) => String(entry.display_id) === String(display.id)) || sources[0];
    let image = source.thumbnail;
    if (!image || image.isEmpty()) return;
    const size = image.getSize();
    if (!size.width || !size.height) return;
    const scaleX = size.width / display.bounds.width;
    const scaleY = size.height / display.bounds.height;
    const cropX = Math.max(0, Math.round((bounds.x - display.bounds.x) * scaleX));
    const cropY = Math.max(0, Math.round((bounds.y - display.bounds.y) * scaleY));
    const cropWidth = Math.max(1, Math.min(size.width - cropX, Math.round(bounds.width * scaleX)));
    const cropHeight = Math.max(1, Math.min(size.height - cropY, Math.round(bounds.height * scaleY)));
    image = image.crop({ x: cropX, y: cropY, width: cropWidth, height: cropHeight });
    if (cropWidth > 520) image = image.resize({ width: 520, quality: 'good' });
    const dataUrl = image.toDataURL();
    if (!dataUrl) return;
    lastBackdropAt = Date.now();
    if (win && !win.isDestroyed()) win.webContents.send('panel:backdrop', { dataUrl });
  } catch (error) {
    log('backdrop capture failed', error.message);
  } finally {
    backdropBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Notifications and scheduling
// ---------------------------------------------------------------------------
function notify(title, body, tab, options = {}) {
  if (CAPTURE_MODE) return;
  const payload = { title, body, tab, at: Date.now() };
  if (panelOpen && win && !win.isDestroyed()) {
    try {
      win.webContents.send('todo:reminder', payload);
    } catch {
      /* ignore */
    }
  }
  if (!Notification.isSupported()) {
    log('system notifications are not supported');
    return;
  }
  const focused = win && !win.isDestroyed() && win.isFocused();
  if (focused && !options.force) return; // the in-app toast is enough
  try {
    const notification = new Notification({ title, body, icon: ICON_PATH, silent: false });
    notification.on('click', () => openPanel({ focus: true, tab }));
    notification.show();
    log('notification shown', title);
  } catch (error) {
    log('notification failed', error.message);
  }
}

function tickReminders() {
  if (quitting || !store) return;
  try {
    const today = D.todayKey();
    if (today !== lastDayKey) {
      lastDayKey = today;
      pushChange('day-change');
    }
    if (store.rolloverIfNeeded()) pushChange('rollover');
    updateTrayTooltip();

    if (TEST_MODE || CAPTURE_MODE) return;
    if (!store.state.settings.notifications) return;

    const dueHabits = store.collectDueHabitReminders();
    if (dueHabits.length) {
      store.markHabitRemindersNotified(dueHabits);
      const title = dueHabits.length > 1 ? `${dueHabits.length} 项打卡到点了` : '该打卡了';
      const body = dueHabits.map((habit) => `${habit.title} · ${habit.time}`).join('\n');
      notify(title, body, 'habits');
      pushChange('habit-reminder');
    }

    const dueAppointments = store.collectDueAppointmentReminders();
    if (dueAppointments.length) {
      store.markAppointmentRemindersNotified(dueAppointments);
      for (const item of dueAppointments) {
        const appointment = item.appointment;
        const quadrant = QUADRANTS.find((entry) => entry.id === appointment.quadrant) || QUADRANTS[1];
        const title = item.daysBefore === 2 ? '预约提醒 · 还有 2 天' : '预约提醒 · 明天';
        const body = `【${quadrant.name}】${D.formatDateCN(appointment.date, { year: true })} ${appointment.time} · ${appointment.title}`
          + (appointment.location ? `\n${appointment.location}` : '');
        notify(title, body, 'appointments');
      }
      pushChange('appointment-reminder');
    }
  } catch (error) {
    log('reminder tick failed', error.message);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function applyLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: app.isPackaged ? [] : [ROOT],
    });
    return { ok: true };
  } catch (error) {
    log('login item failed', error.message);
    return { ok: false, error: error.message };
  }
}

function applySettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return store.state.settings;
  if (Object.prototype.hasOwnProperty.call(patch, 'startAtLogin')) applyLoginItem(patch.startAtLogin);
  const settings = store.updateSettings(patch);
  pinned = settings.pinned;
  rebuildTrayMenu();
  updateTrayTooltip();
  return settings;
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开浮光待办', click: () => openPanel({ focus: true }) },
    {
      label: '新建待办…',
      click: () => {
        openPanel({ focus: true, tab: 'today' });
        if (win && !win.isDestroyed()) win.webContents.send('todo:open-create', { type: 'task' });
      },
    },
    { label: '打卡表', click: () => openPanel({ focus: true, tab: 'habits' }) },
    { label: '预约', click: () => openPanel({ focus: true, tab: 'appointments' }) },
    { label: '月报', click: () => openPanel({ focus: true, tab: 'report' }) },
    { type: 'separator' },
    {
      label: '鼠标悬停唤出',
      type: 'checkbox',
      checked: store.state.settings.hoverEnabled,
      click: (item) => {
        applySettingsPatch({ hoverEnabled: item.checked });
        pushChange('settings');
      },
    },
    {
      label: '只在桌面悬停呼出',
      type: 'checkbox',
      checked: store.state.settings.desktopOnlyHover,
      click: (item) => {
        applySettingsPatch({ desktopOnlyHover: item.checked });
        pushChange('settings');
      },
    },
    {
      label: '系统提醒',
      type: 'checkbox',
      checked: store.state.settings.notifications,
      click: (item) => {
        applySettingsPatch({ notifications: item.checked });
        pushChange('settings');
      },
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: store.state.settings.startAtLogin,
      click: (item) => {
        applySettingsPatch({ startAtLogin: item.checked });
        pushChange('settings');
      },
    },
    { type: 'separator' },
    { label: '打开数据文件夹', click: () => shell.openPath(path.dirname(dataFile)) },
    { label: '退出浮光待办', click: () => quitApp() },
  ]);
}

function rebuildTrayMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(buildTrayMenu());
  } catch (error) {
    log('tray menu update failed', error.message);
  }
}

function setupTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON_PATH));
    tray.setToolTip(APP_TITLE);
    rebuildTrayMenu();
    tray.on('click', () => openPanel({ focus: true }));
    tray.on('double-click', () => openPanel({ focus: true }));
  } catch (error) {
    log('tray setup failed', error.message);
  }
}

// ---------------------------------------------------------------------------
// Capture mode (screenshots for the README)
// ---------------------------------------------------------------------------
async function runCapture() {
  if (!win || win.isDestroyed()) return;
  await delay(800);
  openPanel({ focus: true, tab: 'today' });
  await delay(1100);
  const docs = path.join(ROOT, 'docs');
  fs.mkdirSync(docs, { recursive: true });

  const shoot = async (name) => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(docs, `preview-${name}.png`), image.toPNG());
    log('captured', name);
  };

  const viewInfo = await win.webContents.executeJavaScript(
    "JSON.stringify({body: document.body.className, demo: getComputedStyle(document.getElementById('demoBackdrop')).display, dpr: devicePixelRatio, width: innerWidth, height: innerHeight})",
  ).catch(() => '');
  log('capture view', viewInfo);

  await shoot('today');
  for (const tab of ['habits', 'appointments', 'report']) {
    win.webContents.send('panel:tab', { tab });
    await delay(900);
    await shoot(tab);
    if (tab === 'habits') {
      const switched = await win.webContents.executeJavaScript(
        "(() => { const chips = document.querySelectorAll('.chip[data-habit]'); if (chips.length > 1) { chips[1].click(); return true; } return false; })()",
      ).catch(() => false);
      if (switched) {
        await delay(800);
        await shoot('checkin');
      }
    }
    if (tab === 'report') {
      await win.webContents.executeJavaScript(
        "document.getElementById('view-report').scrollTop = 99999;",
      ).catch(() => {});
      await delay(500);
      await shoot('report-bottom');
      await win.webContents.executeJavaScript(
        "document.getElementById('view-report').scrollTop = 0;",
      ).catch(() => {});
    }
  }
  win.webContents.send('panel:tab', { tab: 'today' });
  await delay(600);
  win.webContents.send('todo:open-create', { type: 'task' });
  await delay(900);
  await shoot('new-task');
  await win.webContents.executeJavaScript(
    "document.querySelector('[data-act=\"close-modal\"]')?.click();",
  ).catch(() => {});
  await delay(400);

  for (const [name, call] of [
    ['new-appointment', 'window.__todoDemo.openAppointmentModal()'],
    ['new-habit', 'window.__todoDemo.openHabitModal()'],
    ['settings', 'window.__todoDemo.openSettingsModal()'],
    ['welcome', 'window.__todoDemo.openWelcomeModal()'],
  ]) {
    await win.webContents.executeJavaScript(call).catch((error) => log('capture modal failed', name, error.message));
    await delay(800);
    await shoot(name);
    await win.webContents.executeJavaScript('window.__todoDemo.closeModal()').catch(() => {});
    await delay(300);
  }

  log('capture complete');
  quitApp();
}

// ---------------------------------------------------------------------------
// Quit
// ---------------------------------------------------------------------------
function quitApp() {
  if (quitting) return;
  quitting = true;
  allowQuit = true;
  if (reminderTimer) clearInterval(reminderTimer);
  if (hoverTimer) clearInterval(hoverTimer);
  for (const timer of healTimers) clearTimeout(timer);
  healTimers = [];
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
  log('quitting');
  app.quit();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function mutate(payload, action) {
  try {
    action(payload || {});
    updateTrayTooltip();
    return { ok: true, snapshot: snapshotFor(payload || {}) };
  } catch (error) {
    log('mutation failed', error.message);
    return { ok: false, error: errorMessage(error) };
  }
}

function setupIpc() {
  ipcMain.handle('todo:snapshot', async (_event, payload = {}) => {
    try {
      return { ok: true, snapshot: snapshotFor(payload) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('todo:add-task', (_event, payload = {}) => mutate(payload, (input) => {
    store.addTask(input);
  }));
  ipcMain.handle('todo:update-task', (_event, payload = {}) => mutate(payload, (input) => {
    store.updateTask(input.id, input.patch || {});
  }));
  ipcMain.handle('todo:toggle-task', (_event, payload = {}) => mutate(payload, (input) => {
    store.toggleTask(input.id, input.done);
  }));
  ipcMain.handle('todo:delete-task', (_event, payload = {}) => mutate(payload, (input) => {
    store.deleteTask(input.id);
  }));

  ipcMain.handle('todo:add-habit', (_event, payload = {}) => mutate(payload, (input) => {
    store.addHabit(input);
  }));
  ipcMain.handle('todo:update-habit', (_event, payload = {}) => mutate(payload, (input) => {
    store.updateHabit(input.id, input.patch || {});
  }));
  ipcMain.handle('todo:delete-habit', (_event, payload = {}) => mutate(payload, (input) => {
    store.deleteHabit(input.id);
  }));
  ipcMain.handle('todo:toggle-habit', (_event, payload = {}) => mutate(payload, (input) => {
    store.toggleHabitCheckin(input.id, input.date);
  }));

  ipcMain.handle('todo:add-appointment', (_event, payload = {}) => mutate(payload, (input) => {
    store.addAppointment(input);
  }));
  ipcMain.handle('todo:update-appointment', (_event, payload = {}) => mutate(payload, (input) => {
    store.updateAppointment(input.id, input.patch || {});
  }));
  ipcMain.handle('todo:toggle-appointment', (_event, payload = {}) => mutate(payload, (input) => {
    store.toggleAppointmentDone(input.id, input.done);
  }));
  ipcMain.handle('todo:delete-appointment', (_event, payload = {}) => mutate(payload, (input) => {
    store.deleteAppointment(input.id);
  }));

  ipcMain.handle('todo:update-settings', async (_event, payload = {}) => {
    try {
      applySettingsPatch(payload);
      return { ok: true, snapshot: snapshotFor(payload) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('panel:pin', async (_event, payload = {}) => {
    try {
      applySettingsPatch({ pinned: payload.pinned === true });
      return { ok: true, pinned: payload.pinned === true, snapshot: snapshotFor(payload) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('panel:state', () => ({
    open: panelOpen,
    pinned,
    modalOpen,
  }));

  ipcMain.on('panel:ui', (_event, state = {}) => {
    modalOpen = Boolean(state && state.modal);
    if (!modalOpen) outsideSince = 0;
  });

  ipcMain.on('panel:close', () => closePanel());

  ipcMain.handle('todo:export-month', async (_event, payload = {}) => {
    try {
      const month = D.isValidMonth(payload.month) ? payload.month : D.monthKey(D.todayKey());
      const csv = store.buildMonthCsv(month);
      const defaultPath = path.join(app.getPath('documents'), `浮光待办-月报-${month}.csv`);
      const result = await dialog.showSaveDialog(win, {
        title: '导出月度报表',
        defaultPath,
        filters: [{ name: 'CSV 表格', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(result.filePath, csv, 'utf8');
      log('report exported', result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('app:open-data-dir', async () => {
    const result = await shell.openPath(path.dirname(dataFile));
    return result ? { ok: false, error: result } : { ok: true };
  });

  ipcMain.handle('app:test-notification', () => {
    notify('浮光待办 · 提醒测试', '通知已经就绪：打卡会按设定时间提醒，预约会提前 2 天和 1 天提醒。', 'today', { force: true });
    return { ok: true, supported: Notification.isSupported() };
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second instance');
    openPanel({ focus: true });
  });

  app.whenReady().then(() => {
    setupStore();
    createWindow();
    setupIpc();
    if (!CAPTURE_MODE) setupTray();
    startDesktopWatcher();
    startHoverWatcher();
    screen.on('display-metrics-changed', () => applyLayout());
    screen.on('display-added', () => applyLayout());
    screen.on('display-removed', () => applyLayout());

    if (store.state.settings.startAtLogin) applyLoginItem(true);
    reminderTimer = setInterval(tickReminders, 30000);
    setTimeout(tickReminders, 3000);
    if (!TEST_MODE && !CAPTURE_MODE) setTimeout(() => refreshBackdrop(true), 1500);
  });
}

app.on('window-all-closed', () => {
  // The tray keeps the app alive; quitting is explicit.
});

app.on('before-quit', () => {
  allowQuit = true;
});

app.on('will-quit', () => {
  stopDesktopWatcher();
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = null;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  for (const timer of healTimers) clearTimeout(timer);
  healTimers = [];
});
