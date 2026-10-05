let config = null;
let papers = null;
let camStream = null;
let templateImg = null;

const $ = (id) => document.getElementById(id);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

function flashSaved() {
  const el = $('save-indicator');
  el.textContent = 'Saved';
  setTimeout(() => { el.textContent = ''; }, 1200);
}

async function persist(partial) {
  config = await window.api.setConfig(partial);
  flashSaved();
}

async function init() {
  config = await window.api.getConfig();
  papers = await window.api.getPaperPresets();

  initCameraTab();
  initCountdownTab();
  initPrintTab();
  initTemplateTab();
  initPrinterTab();
  initSharingTab();
  initPresetsTab();
  initEventsTab();
  initDiagnosticsTab();
  initLicenseTab();
}

// ---------- Camera ----------
async function initCameraTab() {
  $('cam-source').value = config.camera.source || 'webcam';
  $('dslr-folder').value = config.dslr.watchFolder || '';
  $('dslr-remote-cmd').value = config.dslr.remoteCmdPath || '';
  toggleCameraSourceFields();

  const bundledStatus = await window.api.getDslrBundledStatus();
  $('dslr-bundled-status').textContent = bundledStatus.hasBundled
    ? 'A bundled copy of digiCamControl was found and will be used automatically — the field above is optional, only needed to override it.'
    : 'No bundled copy found in this build. Configure the path manually below.';

  $('cam-source').addEventListener('change', async (e) => {
    await persist({ camera: { ...config.camera, source: e.target.value } });
    $('dslr-folder').value = config.dslr.watchFolder || '';
    toggleCameraSourceFields();
    // Only touch the webcam when actually in webcam mode — starting it
    // pointlessly in DSLR mode was wasting time and could hang the
    // Settings window if no usable webcam exists on the machine.
    if (e.target.value === 'webcam') await startCamPreview();
    else stopCamPreview();
  });

  $('btn-choose-dslr-folder').addEventListener('click', async () => {
    const folder = await window.api.chooseDslrFolder();
    if (!folder) return;
    $('dslr-folder').value = folder;
    await persist({ dslr: { ...config.dslr, watchFolder: folder } });
  });

  $('btn-choose-dslr-remote-cmd').addEventListener('click', async () => {
    const exePath = await window.api.chooseDslrRemoteCmd();
    if (!exePath) return;
    $('dslr-remote-cmd').value = exePath;
    await persist({ dslr: { ...config.dslr, remoteCmdPath: exePath } });
  });

  // Only enumerate/start the webcam if we're actually in webcam mode —
  // this is the fix for the Settings window being slow/hanging in DSLR mode.
  if (config.camera.source !== 'webcam') return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  const sel = $('cam-device');
  sel.innerHTML = '';
  videoDevices.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${sel.length + 1}`;
    sel.appendChild(opt);
  });
  if (config.camera.deviceId) sel.value = config.camera.deviceId;

  const [w, h] = [config.camera.width, config.camera.height];
  $('cam-resolution').value = `${w}x${h}`;

  $('cam-brightness').value = config.camera.brightness;
  $('v-brightness').textContent = config.camera.brightness;
  $('cam-contrast').value = config.camera.contrast;
  $('v-contrast').textContent = config.camera.contrast;
  $('cam-saturation').value = config.camera.saturation;
  $('v-saturation').textContent = config.camera.saturation;
  $('cam-exposure').value = config.camera.exposureCompensation || 0;
  $('cam-wb').value = config.camera.whiteBalanceMode || '';
  $('cam-focus').value = config.camera.focusMode || '';

  await startCamPreview();
  applyCamFilter();

  sel.addEventListener('change', async () => {
    await persist({ camera: { ...config.camera, deviceId: sel.value } });
    await startCamPreview();
  });

  $('cam-resolution').addEventListener('change', async (e) => {
    const [rw, rh] = e.target.value.split('x').map(Number);
    await persist({ camera: { ...config.camera, width: rw, height: rh } });
    await startCamPreview();
  });

  ['brightness', 'contrast', 'saturation'].forEach(field => {
    $(`cam-${field}`).addEventListener('input', (e) => {
      $(`v-${field}`).textContent = e.target.value;
      applyCamFilterLive();
    });
    $(`cam-${field}`).addEventListener('change', async (e) => {
      await persist({ camera: { ...config.camera, [field]: Number(e.target.value) } });
    });
  });

  $('cam-exposure').addEventListener('change', async (e) => {
    await persist({ camera: { ...config.camera, exposureCompensation: Number(e.target.value) } });
    await applyHardwareControls();
  });
  $('cam-wb').addEventListener('change', async (e) => {
    await persist({ camera: { ...config.camera, whiteBalanceMode: e.target.value || null } });
    await applyHardwareControls();
  });
  $('cam-focus').addEventListener('change', async (e) => {
    await persist({ camera: { ...config.camera, focusMode: e.target.value || null } });
    await applyHardwareControls();
  });
}

function toggleCameraSourceFields() {
  const isDslr = $('cam-source').value === 'dslr';
  $('dslr-fields').classList.toggle('hidden', !isDslr);
  $('webcam-fields').classList.toggle('hidden', isDslr);
}

function applyCamFilterLive() {
  const b = $('cam-brightness').value, c = $('cam-contrast').value, s = $('cam-saturation').value;
  $('cam-preview').style.filter = `brightness(${100 + Number(b)}%) contrast(${100 + Number(c)}%) saturate(${100 + Number(s)}%)`;
}
function applyCamFilter() {
  const c = config.camera;
  $('cam-preview').style.filter = `brightness(${100 + c.brightness}%) contrast(${100 + c.contrast}%) saturate(${100 + c.saturation}%)`;
}

function stopCamPreview() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}

async function startCamPreview() {
  stopCamPreview();
  const constraints = {
    audio: false,
    video: { width: { ideal: config.camera.width }, height: { ideal: config.camera.height } }
  };
  if (config.camera.deviceId) constraints.video.deviceId = { exact: config.camera.deviceId };
  try {
    camStream = await navigator.mediaDevices.getUserMedia(constraints);
    $('cam-preview').srcObject = camStream;
    await applyHardwareControls();
  } catch (e) {
    console.warn('Camera preview failed', e);
  }
}

async function applyHardwareControls() {
  if (!camStream) return;
  const track = camStream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  const advanced = {};
  if (caps.exposureCompensation && config.camera.exposureCompensation != null) advanced.exposureCompensation = config.camera.exposureCompensation;
  if (caps.whiteBalanceMode && config.camera.whiteBalanceMode) advanced.whiteBalanceMode = config.camera.whiteBalanceMode;
  if (caps.focusMode && config.camera.focusMode) advanced.focusMode = config.camera.focusMode;
  if (Object.keys(advanced).length) {
    try { await track.applyConstraints({ advanced: [advanced] }); } catch (e) {}
  }
}

// ---------- Countdown ----------
function initCountdownTab() {
  const radios = document.querySelectorAll('input[name="countdown"]');
  radios.forEach(r => {
    r.checked = Number(r.value) === config.countdownSeconds;
    r.addEventListener('change', async () => { await persist({ countdownSeconds: Number(r.value) }); });
  });
}

// ---------- Print & Layout ----------
function initPrintTab() {
  $('paper-type').value = config.paper.type;
  toggleCustomPaperFields();
  $('paper-width-mm').value = config.paper.widthMM;
  $('paper-height-mm').value = config.paper.heightMM;
  $('paper-orientation').value = config.paper.orientation;

  $('layout-w').value = config.layout.photoWidthMM;
  $('layout-h').value = config.layout.photoHeightMM;
  $('layout-x').value = config.layout.xMM;
  $('layout-y').value = config.layout.yMM;
  $('layout-margin').value = config.layout.marginMM;

  drawLayoutPreview();
  if (!initLayoutEditor._wired) {
    initLayoutEditor();
    initLayoutEditor._wired = true;
  }

  $('paper-type').addEventListener('change', async (e) => {
    toggleCustomPaperFields();
    let widthMM = config.paper.widthMM, heightMM = config.paper.heightMM;
    if (e.target.value !== 'custom' && papers[e.target.value]) {
      widthMM = papers[e.target.value].widthMM;
      heightMM = papers[e.target.value].heightMM;
      $('paper-width-mm').value = widthMM;
      $('paper-height-mm').value = heightMM;
    }
    await persist({ paper: { ...config.paper, type: e.target.value, widthMM, heightMM } });
    drawLayoutPreview();
  });

  ['paper-width-mm', 'paper-height-mm'].forEach(id => {
    $(id).addEventListener('change', async () => {
      await persist({ paper: { ...config.paper, widthMM: Number($('paper-width-mm').value), heightMM: Number($('paper-height-mm').value) } });
      drawLayoutPreview();
    });
  });

  $('paper-orientation').addEventListener('change', async (e) => {
    await persist({ paper: { ...config.paper, orientation: e.target.value } });
    drawLayoutPreview();
  });

  ['layout-w', 'layout-h', 'layout-x', 'layout-y', 'layout-margin'].forEach(id => {
    $(id).addEventListener('change', async () => {
      await persist({
        layout: {
          photoWidthMM: Number($('layout-w').value),
          photoHeightMM: Number($('layout-h').value),
          xMM: Number($('layout-x').value),
          yMM: Number($('layout-y').value),
          marginMM: Number($('layout-margin').value),
          align: config.layout.align
        }
      });
      drawLayoutPreview();
    });
  });
}

function toggleCustomPaperFields() {
  $('custom-paper-fields').classList.toggle('hidden', $('paper-type').value !== 'custom');
}

const HANDLE_SIZE_CSS = 14;
let dragState = null;

function drawLayoutPreview() {
  const canvas = $('layout-preview');
  renderComposition(canvas, null, templateImg, config);
  drawPhotoBoxOverlay(canvas, config.layout);
}

function drawPhotoBoxOverlay(canvas, layout) {
  const ctx = canvas.getContext('2d');
  const px = mmToPx(layout.xMM), py = mmToPx(layout.yMM);
  const pw = mmToPx(layout.photoWidthMM), ph = mmToPx(layout.photoHeightMM);
  ctx.save();
  ctx.strokeStyle = '#3b82f6';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 4;
  ctx.strokeRect(px, py, pw, ph);
  ctx.setLineDash([]);
  ctx.fillStyle = '#3b82f6';
  const handlePx = (HANDLE_SIZE_CSS / canvas.clientWidth) * canvas.width;
  ctx.fillRect(px + pw - handlePx / 2, py + ph - handlePx / 2, handlePx, handlePx);
  ctx.restore();
}

function canvasEventToMM(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const xPx = (evt.clientX - rect.left) * scale;
  const yPx = (evt.clientY - rect.top) * scale;
  return { xMM: pxToMM(xPx), yMM: pxToMM(yPx) };
}

function initLayoutEditor() {
  const canvas = $('layout-preview');

  canvas.addEventListener('mousedown', (e) => {
    const { xMM, yMM } = canvasEventToMM(canvas, e);
    const box = config.layout;
    const rect = canvas.getBoundingClientRect();
    const handleMM = pxToMM((HANDLE_SIZE_CSS / rect.width) * canvas.width);

    const nearHandle = Math.abs(xMM - (box.xMM + box.photoWidthMM)) < handleMM && Math.abs(yMM - (box.yMM + box.photoHeightMM)) < handleMM;
    const insideBox = xMM >= box.xMM && xMM <= box.xMM + box.photoWidthMM && yMM >= box.yMM && yMM <= box.yMM + box.photoHeightMM;

    if (nearHandle) dragState = { mode: 'resize', startMouseX: xMM, startMouseY: yMM, startBox: { ...box } };
    else if (insideBox) dragState = { mode: 'move', startMouseX: xMM, startMouseY: yMM, startBox: { ...box } };
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const { xMM, yMM } = canvasEventToMM(canvas, e);
    const dx = xMM - dragState.startMouseX;
    const dy = yMM - dragState.startMouseY;
    const b = dragState.startBox;
    let next = { ...config.layout };

    if (dragState.mode === 'move') {
      next.xMM = Math.max(0, Math.min(config.paper.widthMM - b.photoWidthMM, b.xMM + dx));
      next.yMM = Math.max(0, Math.min(config.paper.heightMM - b.photoHeightMM, b.yMM + dy));
    } else if (dragState.mode === 'resize') {
      next.photoWidthMM = Math.max(10, Math.min(config.paper.widthMM - b.xMM, b.photoWidthMM + dx));
      next.photoHeightMM = Math.max(10, Math.min(config.paper.heightMM - b.yMM, b.photoHeightMM + dy));
    }

    config.layout = next;
    drawLayoutPreview();
    $('layout-w').value = Math.round(next.photoWidthMM);
    $('layout-h').value = Math.round(next.photoHeightMM);
    $('layout-x').value = Math.round(next.xMM);
    $('layout-y').value = Math.round(next.yMM);
  });

  window.addEventListener('mouseup', async () => {
    if (!dragState) return;
    dragState = null;
    await persist({ layout: config.layout });
  });

  canvas.addEventListener('mousemove', (e) => {
    if (dragState) return;
    const { xMM, yMM } = canvasEventToMM(canvas, e);
    const box = config.layout;
    const rect = canvas.getBoundingClientRect();
    const handleMM = pxToMM((HANDLE_SIZE_CSS / rect.width) * canvas.width);
    const nearHandle = Math.abs(xMM - (box.xMM + box.photoWidthMM)) < handleMM && Math.abs(yMM - (box.yMM + box.photoHeightMM)) < handleMM;
    const insideBox = xMM >= box.xMM && xMM <= box.xMM + box.photoWidthMM && yMM >= box.yMM && yMM <= box.yMM + box.photoHeightMM;
    canvas.style.cursor = nearHandle ? 'nwse-resize' : (insideBox ? 'move' : 'default');
  });
}

// ---------- Template ----------
function initTemplateTab() {
  $('template-path').textContent = config.template.path || 'No template uploaded.';
  $('template-opacity').value = config.template.opacity;
  $('v-opacity').textContent = config.template.opacity;
  $('template-fit').value = config.template.fit;
  $('template-layer').value = config.template.layer || 'front';

  loadTemplatePreview();

  $('btn-choose-template').addEventListener('click', async () => {
    const chosen = await window.api.chooseTemplate();
    if (!chosen) return;
    await persist({ template: { ...config.template, path: chosen } });
    $('template-path').textContent = chosen;
    await loadTemplatePreview();
    drawLayoutPreview();
  });

  $('template-opacity').addEventListener('input', (e) => { $('v-opacity').textContent = e.target.value; });
  $('template-opacity').addEventListener('change', async (e) => {
    await persist({ template: { ...config.template, opacity: Number(e.target.value) } });
    drawTemplatePreview();
    drawLayoutPreview();
  });

  $('template-fit').addEventListener('change', async (e) => {
    await persist({ template: { ...config.template, fit: e.target.value } });
    drawTemplatePreview();
    drawLayoutPreview();
  });

  $('template-layer').addEventListener('change', async (e) => {
    await persist({ template: { ...config.template, layer: e.target.value } });
    drawTemplatePreview();
    drawLayoutPreview();
  });
}

async function loadTemplatePreview() {
  templateImg = null;
  if (!config.template.path) { drawTemplatePreview(); return; }
  const dataUrl = await window.api.readTemplate(config.template.path);
  if (!dataUrl) { drawTemplatePreview(); return; }
  templateImg = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
  drawTemplatePreview();
}

function drawTemplatePreview() {
  renderComposition($('template-preview'), null, templateImg, config);
}

// ---------- Printer ----------
async function initPrinterTab() {
  const printers = await window.api.listPrinters();
  const sel = $('printer-select');
  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.displayName || p.name;
    sel.appendChild(opt);
  });
  sel.value = config.printer.name || '';
  $('printer-default-copies').value = config.printer.copiesDefault;
  $('printer-max-copies').value = config.printer.maxCopies;
  $('printer-borderless').checked = !!config.printer.borderless;

  sel.addEventListener('change', async (e) => { await persist({ printer: { ...config.printer, name: e.target.value } }); });
  $('printer-default-copies').addEventListener('change', async (e) => { await persist({ printer: { ...config.printer, copiesDefault: Number(e.target.value) } }); });
  $('printer-max-copies').addEventListener('change', async (e) => { await persist({ printer: { ...config.printer, maxCopies: Number(e.target.value) } }); });
  $('printer-borderless').addEventListener('change', async (e) => { await persist({ printer: { ...config.printer, borderless: e.target.checked } }); });
}

// ---------- Sharing ----------
async function initSharingTab() {
  $('sharing-enabled').checked = config.sharing.enabled;
  $('sharing-port').value = config.sharing.port;
  $('sharing-expiry').value = config.sharing.expiryMinutes;
  await refreshSharingStatus();

  $('sharing-enabled').addEventListener('change', async (e) => {
    await persist({ sharing: { ...config.sharing, enabled: e.target.checked } });
    await refreshSharingStatus();
  });
  $('sharing-port').addEventListener('change', async (e) => { await persist({ sharing: { ...config.sharing, port: Number(e.target.value) } }); });
  $('sharing-expiry').addEventListener('change', async (e) => { await persist({ sharing: { ...config.sharing, expiryMinutes: Number(e.target.value) } }); });
}

async function refreshSharingStatus() {
  const status = await window.api.getShareStatus();
  $('sharing-status').textContent = status.running ? `Running at http://${status.ip}:${status.port}` : 'Not running';
}

// ---------- Presets ----------
function initPresetsTab() {
  renderPresetList();
  $('btn-save-preset').addEventListener('click', async () => {
    const name = $('preset-name').value.trim();
    if (!name) return;
    config = await window.api.savePreset(name);
    $('preset-name').value = '';
    renderPresetList();
    flashSaved();
  });
}

function renderPresetList() {
  const list = $('preset-list');
  list.innerHTML = '';
  Object.keys(config.presets || {}).forEach(name => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name + (config.activePreset === name ? '  (active)' : '');
    const btnLoad = document.createElement('button');
    btnLoad.textContent = 'Load';
    btnLoad.addEventListener('click', async () => {
      config = await window.api.loadPreset(name);
      initCameraTab(); initCountdownTab(); initPrintTab(); initTemplateTab(); initPrinterTab();
      renderPresetList();
      flashSaved();
    });
    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Delete';
    btnDelete.className = 'danger';
    btnDelete.addEventListener('click', async () => {
      config = await window.api.deletePreset(name);
      renderPresetList();
    });
    li.appendChild(label);
    const btnGroup = document.createElement('span');
    btnGroup.appendChild(btnLoad);
    btnGroup.appendChild(btnDelete);
    li.appendChild(btnGroup);
    list.appendChild(li);
  });
}

// ---------- Events ----------
function initEventsTab() {
  const presetSel = $('event-preset');
  presetSel.innerHTML = '';
  Object.keys(config.presets || {}).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    presetSel.appendChild(opt);
  });

  renderEventList();
  renderActiveEventBanner();

  $('btn-save-event').addEventListener('click', async () => {
    const name = $('event-name').value.trim();
    if (!name) return;
    config = await window.api.saveEvent({ name, date: $('event-date').value, client: $('event-client').value.trim(), presetName: presetSel.value || '' });
    $('event-name').value = '';
    $('event-client').value = '';
    renderEventList();
    flashSaved();
  });
}

function renderEventList() {
  const list = $('event-list');
  list.innerHTML = '';
  Object.entries(config.events || {}).forEach(([name, evt]) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${name}${evt.client ? ' — ' + evt.client : ''}${evt.date ? ' (' + evt.date + ')' : ''}` + (config.activeEvent === name ? '  [ACTIVE]' : '');
    const btnGroup = document.createElement('span');

    const btnStart = document.createElement('button');
    btnStart.textContent = 'Start';
    btnStart.addEventListener('click', async () => { config = await window.api.startEvent(name); });

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Delete';
    btnDelete.className = 'danger';
    btnDelete.addEventListener('click', async () => {
      config = await window.api.deleteEvent(name);
      renderEventList();
      renderActiveEventBanner();
    });

    btnGroup.appendChild(btnStart);
    btnGroup.appendChild(btnDelete);
    li.appendChild(label);
    li.appendChild(btnGroup);
    list.appendChild(li);
  });
}

function renderActiveEventBanner() {
  const el = $('active-event-banner');
  if (config.activeEvent) {
    el.innerHTML = `Currently running: <strong>${config.activeEvent}</strong> (Operator Mode is ON — the booth screen hides Settings). `;
    const btnEnd = document.createElement('button');
    btnEnd.textContent = 'End Event';
    btnEnd.className = 'btn secondary';
    btnEnd.style.marginLeft = '8px';
    btnEnd.addEventListener('click', async () => {
      config = await window.api.endEvent();
      renderActiveEventBanner();
      renderEventList();
    });
    el.appendChild(btnEnd);
  } else {
    el.textContent = 'No event currently running.';
  }
}

// ---------- Diagnostics ----------
async function initDiagnosticsTab() {
  const info = await window.api.getSystemInfo();
  $('system-info').innerHTML = `Platform: ${info.platform} (${info.arch})<br/>Electron: ${info.electronVersion} &middot; Node: ${info.nodeVersion}<br/>App version: ${info.appVersion}`;
  const startupMs = await window.api.getStartupTime();
  $('startup-time').textContent = startupMs != null ? `Last startup (app ready \u2192 window shown): ${startupMs} ms` : 'Startup time not available yet.';
  $('btn-open-logs').addEventListener('click', () => window.api.openLogFolder());
}

// ---------- License ----------
async function initLicenseTab() {
  const status = await window.api.getLicenseStatus();
  const deviceId = await window.api.getDeviceId();
  let html = `Device ID: ${deviceId}<br/>`;
  if (status.activated && status.valid) {
    html += `Status: <strong style="color:#34d399;">Active</strong>`;
    if (status.offline) html += ` (offline mode, ${status.graceDaysLeft} day(s) grace remaining)`;
  } else if (status.activated && !status.valid) {
    html += `Status: <strong style="color:#f87171;">${status.reason || 'Invalid'}</strong>`;
  } else {
    html += `Status: Not activated`;
  }
  $('license-info').innerHTML = html;
}

// ---------- Reset ----------
$('btn-reset').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  config = await window.api.resetConfig();
  location.reload();
});

init();
