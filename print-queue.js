const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const logger = require('./logger');

class PrintQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.processing = false;
    this.jobIdCounter = 1;
  }

  enqueue(job) {
    const id = this.jobIdCounter++;
    const entry = { id, status: 'queued', attempts: 0, ...job };
    this.queue.push(entry);
    logger.info('print job queued', { id, printerName: job.printerName, copies: job.copies, borderless: job.borderless });
    this.emit('update', this.snapshot());
    this._processNext();
    return id;
  }

  retry(id) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return false;
    job.status = 'queued';
    job.lastError = null;
    this.emit('update', this.snapshot());
    this._processNext();
    return true;
  }

  snapshot() {
    if (this.queue.length > 20) this.queue = this.queue.slice(-20);
    return this.queue.map(({ dataUrl, ...rest }) => rest);
  }

  async _processNext() {
    if (this.processing) return;
    const job = this.queue.find(j => j.status === 'queued');
    if (!job) return;

    this.processing = true;
    job.status = 'printing';
    job.attempts += 1;
    this.emit('update', this.snapshot());

    try {
      const result = await this._printJob(job);
      job.status = result.success ? 'printed' : 'failed';
      job.lastError = result.failureReason || null;
      logger.info('print job finished', { id: job.id, success: result.success, attempts: job.attempts });
    } catch (err) {
      job.status = 'failed';
      job.lastError = String(err);
      logger.error('print job threw', { id: job.id, error: String(err) });
    }

    this.processing = false;
    this.emit('update', this.snapshot());
    this._processNext();
  }

  _printJob(job) {
    return new Promise((resolve) => {
      const printWin = new BrowserWindow({ show: false });
      const html = `<!DOCTYPE html><html><head><style>
        * { margin:0; padding:0; }
        html, body { width:100%; height:100%; background:#fff; }
        img { width:100%; height:100%; object-fit:fill; display:block; }
      </style></head><body><img src="${job.dataUrl}" /></body></html>`;
      const tmpFile = path.join(app.getPath('temp'), `print-${job.id}-${Date.now()}.html`);

      try {
        fs.writeFileSync(tmpFile, html, 'utf-8');
      } catch (e) {
        printWin.close();
        resolve({ success: false, failureReason: 'Could not prepare print file: ' + String(e) });
        return;
      }

      const cleanup = () => {
        try { fs.unlinkSync(tmpFile); } catch (e) {}
        try { printWin.close(); } catch (e) {}
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve({ success: false, failureReason: 'Print timed out' });
      }, 60000);

      printWin.loadFile(tmpFile).then(() => {
        const printOptions = {
          silent: true,
          printBackground: true,
          copies: Math.max(1, job.copies || 1),
          pageSize: {
            width: Math.round(job.widthMM * 1000),
            height: Math.round(job.heightMM * 1000)
          }
        };
        // Borderless ("no margin") is opt-in, not forced — on some printer/paper
        // combinations (confirmed: Epson L8050 with certain custom sizes) forcing
        // marginType 'none' causes the driver to fill the uncovered physical area
        // with black instead of white/nothing. Default stays 'default' (safe).
        if (job.borderless) {
          printOptions.margins = { marginType: 'none' };
        }
        if (job.printerName) printOptions.deviceName = job.printerName;

        printWin.webContents.print(printOptions, (success, failureReason) => {
          clearTimeout(timeout);
          cleanup();
          resolve({ success, failureReason: failureReason || null });
        });
      }).catch((err) => {
        clearTimeout(timeout);
        cleanup();
        resolve({ success: false, failureReason: String(err) });
      });
    });
  }
}

module.exports = new PrintQueue();
