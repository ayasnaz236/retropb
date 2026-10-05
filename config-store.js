const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'booth-config.json');

const BUILTIN_PAPERS = {
  '4x6': { label: '4 x 6 in', widthMM: 101.6, heightMM: 152.4 },
  '2x9': { label: '2 x 9 in (strip)', widthMM: 50.8, heightMM: 228.6 },
  'a4': { label: 'A4', widthMM: 210, heightMM: 297 }
};

function defaultConfig() {
  return {
    camera: {
      source: 'webcam',
      deviceId: '',
      width: 1280,
      height: 720,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      exposureCompensation: null,
      whiteBalanceMode: null,
      focusMode: null
    },
    dslr: {
      watchFolder: '',
      remoteCmdPath: ''
    },
    sharing: {
      enabled: false,
      port: 8935,
      expiryMinutes: 30
    },
    countdownSeconds: 5,
    paper: {
      type: '4x6',
      widthMM: 101.6,
      heightMM: 152.4,
      unit: 'in',
      orientation: 'portrait'
    },
    layout: {
      photoWidthMM: 91.6,
      photoHeightMM: 142.4,
      xMM: 5,
      yMM: 5,
      marginMM: 5,
      align: 'center'
    },
    template: {
      path: '',
      opacity: 100,
      fit: 'contain',
      layer: 'front'
    },
    printer: {
      name: '',
      copiesDefault: 1,
      maxCopies: 10,
      borderless: false // opt-in: forcing no-margin printing can cause black-fill artifacts on some printer/paper combos
    },
    presets: {},
    activePreset: '',
    events: {},
    activeEvent: '',
    operatorMode: false
  };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE(), 'utf-8');
    const parsed = JSON.parse(raw);
    const def = defaultConfig();
    return {
      ...def,
      ...parsed,
      camera: { ...def.camera, ...(parsed.camera || {}) },
      dslr: { ...def.dslr, ...(parsed.dslr || {}) },
      sharing: { ...def.sharing, ...(parsed.sharing || {}) },
      paper: { ...def.paper, ...(parsed.paper || {}) },
      layout: { ...def.layout, ...(parsed.layout || {}) },
      template: { ...def.template, ...(parsed.template || {}) },
      printer: { ...def.printer, ...(parsed.printer || {}) },
      presets: parsed.presets || {},
      events: parsed.events || {}
    };
  } catch (e) {
    return defaultConfig();
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

module.exports = { loadConfig, saveConfig, defaultConfig, BUILTIN_PAPERS, CONFIG_FILE };
