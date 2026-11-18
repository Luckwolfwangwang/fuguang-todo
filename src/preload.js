'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * The renderer never touches Node or the data file. It can only ask the main
 * process for a snapshot or for one of the mutations below.
 */
contextBridge.exposeInMainWorld('todo', {
  snapshot: (month) => ipcRenderer.invoke('todo:snapshot', { month }),

  addTask: (payload) => ipcRenderer.invoke('todo:add-task', payload),
  updateTask: (payload) => ipcRenderer.invoke('todo:update-task', payload),
  toggleTask: (payload) => ipcRenderer.invoke('todo:toggle-task', payload),
  deleteTask: (payload) => ipcRenderer.invoke('todo:delete-task', payload),

  addHabit: (payload) => ipcRenderer.invoke('todo:add-habit', payload),
  updateHabit: (payload) => ipcRenderer.invoke('todo:update-habit', payload),
  deleteHabit: (payload) => ipcRenderer.invoke('todo:delete-habit', payload),
  toggleHabit: (payload) => ipcRenderer.invoke('todo:toggle-habit', payload),

  addAppointment: (payload) => ipcRenderer.invoke('todo:add-appointment', payload),
  updateAppointment: (payload) => ipcRenderer.invoke('todo:update-appointment', payload),
  toggleAppointment: (payload) => ipcRenderer.invoke('todo:toggle-appointment', payload),
  deleteAppointment: (payload) => ipcRenderer.invoke('todo:delete-appointment', payload),

  updateSettings: (payload) => ipcRenderer.invoke('todo:update-settings', payload),
  exportMonth: (payload) => ipcRenderer.invoke('todo:export-month', payload),
  testNotification: () => ipcRenderer.invoke('app:test-notification'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),

  setUiState: (state) => ipcRenderer.send('panel:ui', state),
  closePanel: () => ipcRenderer.send('panel:close'),
  pin: (pinned) => ipcRenderer.invoke('panel:pin', { pinned }),
  panelState: () => ipcRenderer.invoke('panel:state'),

  onChanged: (callback) => subscribe('todo:changed', callback),
  onReminder: (callback) => subscribe('todo:reminder', callback),
  onOpen: (callback) => subscribe('panel:open', callback),
  onClosed: (callback) => subscribe('panel:closed', callback),
  onTab: (callback) => subscribe('panel:tab', callback),
  onBackdrop: (callback) => subscribe('panel:backdrop', callback),
  onCreate: (callback) => subscribe('todo:open-create', callback),

  testMode: process.env.FUGUANG_TODO_TEST === '1',
  captureMode: process.env.FUGUANG_TODO_CAPTURE === '1',
});
