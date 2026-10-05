const http = require('http');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const logger = require('./logger');

class ShareServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.shares = new Map();
    this.cleanupInterval = null;
  }

  getLocalIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
    return '127.0.0.1';
  }

  start(preferredPort = 8935) {
    if (this.server) return Promise.resolve({ started: true, port: this.port });

    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.listen(preferredPort, '0.0.0.0', () => {
        this.port = preferredPort;
        logger.info('share server started', { port: this.port });
        this.cleanupInterval = setInterval(() => this._cleanupExpired(), 60000);
        resolve({ started: true, port: this.port });
      });
      this.server.on('error', (err) => {
        logger.error('share server failed to start', { error: String(err) });
        resolve({ started: false, error: String(err) });
      });
    });
  }

  stop() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async share(filePath, expiryMinutes = 30) {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;
    this.shares.set(token, { filePath, expiresAt });

    const ip = this.getLocalIp();
    const url = `http://${ip}:${this.port}/photo/${token}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 1 });

    logger.info('photo shared', { token, expiryMinutes });
    return { url, qrDataUrl, token };
  }

  _cleanupExpired() {
    const now = Date.now();
    for (const [token, entry] of this.shares.entries()) {
      if (entry.expiresAt < now) this.shares.delete(token);
    }
  }

  _handleRequest(req, res) {
    const urlParts = req.url.split('/').filter(Boolean);

    if (urlParts[0] !== 'photo' || !urlParts[1]) {
      this._sendError(res, 404, 'Not Found', 'This link does not point to a photo.');
      return;
    }

    const token = urlParts[1];
    const entry = this.shares.get(token);

    if (!entry) {
      this._sendError(res, 404, 'Link Not Found', 'This photo link is invalid.');
      return;
    }
    if (entry.expiresAt < Date.now()) {
      this.shares.delete(token);
      this._sendError(res, 410, 'Link Expired', 'This photo link has expired. Please ask the booth operator to share it again.');
      return;
    }
    if (!fs.existsSync(entry.filePath)) {
      this._sendError(res, 500, 'Photo Unavailable', 'Something went wrong loading this photo.');
      return;
    }

    const ext = path.extname(entry.filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const data = fs.readFileSync(entry.filePath);

    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Your Photo</title>
      <style>
        body { margin:0; background:#111827; color:#f3f4f6; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; padding:24px; }
        img { max-width:100%; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.4); }
        a.download { margin-top:20px; background:#3b82f6; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; }
      </style></head><body>
      <img src="data:${mime};base64,${data.toString('base64')}" />
      <a class="download" href="data:${mime};base64,${data.toString('base64')}" download="photo${ext}">Download Photo</a>
      </body></html>`);
  }

  _sendError(res, code, title, message) {
    res.writeHead(code, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${title}</title>
      <style>body{margin:0;background:#111827;color:#f3f4f6;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px;}
      h1{font-size:1.4rem;}p{color:#9ca3af;}</style></head><body>
      <h1>${title}</h1><p>${message}</p></body></html>`);
  }
}

module.exports = new ShareServer();
