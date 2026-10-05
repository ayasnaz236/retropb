const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff']);

class DslrWatcher {
  constructor() {
    this.watcher = null;
    this.folder = null;
    this.onPhoto = null;
    this.seenFiles = new Set();
    this.debounceTimers = new Map();
  }

  start(folder, onPhoto) {
    this.stop();
    if (!folder) return { started: false, error: 'No watch folder configured' };

    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e) {
      logger.error('dslr watcher: could not create folder', { folder, error: String(e) });
      return { started: false, error: 'Could not create/access folder: ' + String(e) };
    }

    this.folder = folder;
    this.onPhoto = onPhoto;
    try {
      this.seenFiles = new Set(fs.readdirSync(folder));
    } catch (e) {
      this.seenFiles = new Set();
    }

    try {
      this.watcher = fs.watch(folder, (eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) return;
        if (this.seenFiles.has(filename)) return;

        if (this.debounceTimers.has(filename)) clearTimeout(this.debounceTimers.get(filename));
        const timer = setTimeout(() => {
          this.debounceTimers.delete(filename);
          const fullPath = path.join(folder, filename);
          if (!fs.existsSync(fullPath)) return;
          this.seenFiles.add(filename);
          logger.info('dslr watcher: new photo detected', { filename });
          if (this.onPhoto) this.onPhoto(fullPath);
        }, 800);
        this.debounceTimers.set(filename, timer);
      });
      logger.info('dslr watcher started', { folder });
      return { started: true };
    } catch (e) {
      logger.error('dslr watcher: fs.watch failed', { folder, error: String(e) });
      return { started: false, error: String(e) };
    }
  }

  stop() {
    if (this.watcher) {
      try { this.watcher.close(); } catch (e) {}
      this.watcher = null;
    }
    this.debounceTimers.forEach(t => clearTimeout(t));
    this.debounceTimers.clear();
  }

  markSeen(filename) {
    this.seenFiles.add(filename);
  }
}

module.exports = new DslrWatcher();
