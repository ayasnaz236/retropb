const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const logger = require('./logger');

const LICENSE_FILE = () => path.join(app.getPath('userData'), 'license.dat');
const OFFLINE_GRACE_DAYS = 7;

function getDeviceId() {
  const idFile = path.join(app.getPath('userData'), 'device-id');
  try {
    return fs.readFileSync(idFile, 'utf-8').trim();
  } catch (e) {
    const id = crypto.randomUUID();
    fs.writeFileSync(idFile, id, 'utf-8');
    return id;
  }
}

// MOCK — replace with a real HTTPS call to your license server.
async function validateWithServer({ licenseKey, email, deviceId }) {
  logger.info('license validation attempted (MOCK — no real backend configured)', { deviceId });
  const looksValid = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(licenseKey || '');
  if (!looksValid) return { valid: false, status: 'invalid', reachable: true };
  return { valid: true, status: 'active', expiresAt: null, maxDevices: 1, activatedDevices: 1, reachable: true };
}

function saveLicenseData(data) {
  const json = JSON.stringify(data);
  const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf-8');
  fs.writeFileSync(LICENSE_FILE(), payload);
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('license stored without OS-level encryption — safeStorage unavailable on this system');
  }
}

function loadLicenseData() {
  try {
    const payload = fs.readFileSync(LICENSE_FILE());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(payload) : payload.toString('utf-8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

async function activate({ licenseKey, email }) {
  const deviceId = getDeviceId();
  const result = await validateWithServer({ licenseKey, email, deviceId });

  if (!result.valid) {
    logger.warn('license activation rejected', { status: result.status });
    return { success: false, reason: result.status === 'invalid' ? 'Invalid license key.' : 'License could not be validated.' };
  }

  saveLicenseData({
    licenseKey, email, deviceId,
    status: result.status, expiresAt: result.expiresAt,
    activatedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString()
  });

  logger.info('license activated', { deviceId, status: result.status });
  return { success: true };
}

async function getStatus() {
  const data = loadLicenseData();
  if (!data) return { activated: false };

  const daysSinceVerified = (Date.now() - new Date(data.lastVerifiedAt).getTime()) / (1000 * 60 * 60 * 24);

  try {
    const result = await validateWithServer({ licenseKey: data.licenseKey, email: data.email, deviceId: data.deviceId });
    if (result.reachable) {
      data.lastVerifiedAt = new Date().toISOString();
      data.status = result.status;
      saveLicenseData(data);
      if (!result.valid) return { activated: true, valid: false, reason: 'License revoked or expired.' };
      return { activated: true, valid: true, offline: false };
    }
  } catch (e) {
    logger.warn('license server unreachable, using offline grace period', { daysSinceVerified });
  }

  if (daysSinceVerified <= OFFLINE_GRACE_DAYS) {
    return { activated: true, valid: true, offline: true, graceDaysLeft: Math.round(OFFLINE_GRACE_DAYS - daysSinceVerified) };
  }
  return { activated: true, valid: false, reason: 'Offline grace period expired. Please connect to the internet to re-verify your license.' };
}

function deactivateLocal() {
  try { fs.unlinkSync(LICENSE_FILE()); } catch (e) {}
}

module.exports = { activate, getStatus, getDeviceId, deactivateLocal };
