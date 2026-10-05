async function init() {
  const deviceId = await window.api.getDeviceId();
  document.getElementById('device-id').textContent = `Device ID: ${deviceId}`;
}

document.getElementById('btn-activate').addEventListener('click', async () => {
  const contact = document.getElementById('contact').value.trim();
  const licenseKey = document.getElementById('licenseKey').value.trim();
  const errorEl = document.getElementById('error');
  const btn = document.getElementById('btn-activate');

  errorEl.textContent = '';
  if (!contact || !licenseKey) {
    errorEl.textContent = 'Please fill in both fields.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Activating...';

  const result = await window.api.activateLicense({ licenseKey, email: contact });

  if (!result.success) {
    errorEl.textContent = result.reason || 'Activation failed. Please check your license key.';
    btn.disabled = false;
    btn.textContent = 'Activate';
  }
});

init();
