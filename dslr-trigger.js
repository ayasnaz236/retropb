const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function timestampedFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `dslr_${stamp}_${rand}.jpg`;
}

function waitForStableFile(filePath, { timeoutMs = 10000, pollMs = 300 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let lastSize = -1;
    let stableReadings = 0;

    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve({ success: false, error: 'Timed out waiting for the camera to save the photo.' });
        return;
      }
      fs.stat(filePath, (err, stats) => {
        if (err) {
          setTimeout(check, pollMs);
          return;
        }
        if (stats.size > 0 && stats.size === lastSize) {
          stableReadings += 1;
          if (stableReadings >= 2) {
            resolve({ success: true, filePath });
            return;
          }
        } else {
          stableReadings = 0;
        }
        lastSize = stats.size;
        setTimeout(check, pollMs);
      });
    };
    check();
  });
}

function triggerCapture({ remoteCmdPath, outputFolder }) {
  return new Promise((resolve) => {
    if (!remoteCmdPath) {
      resolve({ success: false, error: 'CameraControlRemoteCmd.exe path is not configured in Settings.' });
      return;
    }
    if (!outputFolder) {
      resolve({ success: false, error: 'DSLR output folder is not configured in Settings.' });
      return;
    }

    try {
      fs.mkdirSync(outputFolder, { recursive: true });
    } catch (e) {
      resolve({ success: false, error: 'Could not create output folder: ' + String(e) });
      return;
    }

    const fullPath = path.join(outputFolder, timestampedFilename());
    logger.info('dslr trigger: capturing', { fullPath });

    execFile(remoteCmdPath, ['/c', 'capture', fullPath], { timeout: 15000 }, (err) => {
      if (err) {
        logger.error('dslr trigger: remote cmd failed', { error: String(err) });
        resolve({ success: false, error: 'Could not reach digiCamControl. Is it running and is the camera connected? (' + String(err.message || err) + ')' });
        return;
      }
      waitForStableFile(fullPath).then((result) => {
        if (result.success) logger.info('dslr trigger: capture complete', { fullPath });
        else logger.warn('dslr trigger: capture did not complete', { error: result.error });
        resolve(result);
      });
    });
  });
}

module.exports = { triggerCapture };
