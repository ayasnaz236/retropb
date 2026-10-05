const fs = require('fs');
const path = require('path');

let logDir = null;
let currentLogFile = null;
const MAX_LOG_SIZE = 2 * 1024 * 1024;
const MAX_LOG_FILES = 5;

function init(userDataPath) {
  logDir = path.join(userDataPath, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  currentLogFile = path.join(logDir, 'booth.log');
  rotateIfNeeded();
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(currentLogFile)) return;
    const { size } = fs.statSync(currentLogFile);
    if (size < MAX_LOG_SIZE) return;
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = `${currentLogFile}.${i}`;
      const to = `${currentLogFile}.${i + 1}`;
      if (fs.existsSync(from)) {
        if (i + 1 > MAX_LOG_FILES) fs.unlinkSync(from);
        else fs.renameSync(from, to);
      }
    }
    fs.renameSync(currentLogFile, `${currentLogFile}.1`);
  } catch (e) {}
}

const SENSITIVE_KEYS = ['apikey', 'api_key', 'password', 'token', 'secret', 'licensekey', 'license_key'];

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    clean[k] = SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s)) ? '[redacted]' : v;
  }
  return clean;
}

function write(level, message, meta) {
  if (!currentLogFile) return;
  try {
    rotateIfNeeded();
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...(meta ? { meta: redact(meta) } : {}) });
    fs.appendFileSync(currentLogFile, line + '\n', 'utf-8');
  } catch (e) {}
}

module.exports = {
  init,
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  getLogDir: () => logDir,
  getCurrentLogFile: () => currentLogFile
};
