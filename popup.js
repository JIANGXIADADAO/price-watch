// Price Watch - Popup

const btnPick = document.getElementById('btn-pick');
const btnSaveWebhook = document.getElementById('btn-save-webhook');
const webhookInput = document.getElementById('webhook-input');
const targetsList = document.getElementById('targets-list');
const targetCount = document.getElementById('target-count');

let picking = false;

// --- Init ---

document.addEventListener('DOMContentLoaded', loadState);

btnPick.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (!picking) {
    await chrome.tabs.sendMessage(tab.id, { type: 'START_PICKER' });
    btnPick.textContent = '🟢 Picking... Click a price on the page';
    btnPick.classList.add('picking');
    picking = true;
  } else {
    await chrome.tabs.sendMessage(tab.id, { type: 'STOP_PICKER' });
    btnPick.textContent = '🔍 Pick Price Element';
    btnPick.classList.remove('picking');
    picking = false;
  }
});

btnSaveWebhook.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SAVE_WEBHOOK', url: webhookInput.value.trim() });
  btnSaveWebhook.textContent = '✓';
  setTimeout(() => btnSaveWebhook.textContent = 'Save', 1500);
});

// --- Listen for element selected ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ELEMENT_SELECTED') {
    btnPick.textContent = '🔍 Pick Price Element';
    btnPick.classList.remove('picking');
    picking = false;
    loadState();
  }
});

// --- Load & Render ---

async function loadState() {
  const { targets = [], webhook = '' } = await chrome.runtime.sendMessage({ type: 'GET_TARGETS' });
  webhookInput.value = webhook;
  targetCount.textContent = targets.length + ' target' + (targets.length !== 1 ? 's' : '');
  renderTargets(targets);
}

function renderTargets(targets) {
  if (!targets.length) {
    targetsList.innerHTML = '<div class="empty">No targets yet. Click "Pick Price Element" on any product page.</div>';
    return;
  }

  targetsList.innerHTML = targets.map(t => {
    const priceDisplay = t.lastPriceText
      ? `<div class="price">${t.lastPriceText}</div>`
      : '<div class="meta">waiting for first check...</div>';

    return `
      <div class="target-card">
        <div class="title">${esc(t.title || t.url)}</div>
        <div class="meta">${esc(t.url.substring(0, 60))}</div>
        ${priceDisplay}
        <div class="meta">${t.lastChecked ? 'checked ' + timeAgo(t.lastChecked) : 'not checked yet'}</div>
        <div style="margin-top:6px">
          <button class="btn btn-danger" data-id="${t.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  // Delete handlers
  targetsList.querySelectorAll('.btn-danger').forEach(btn => {
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'DELETE_TARGET', id: Number(btn.dataset.id) });
      loadState();
    });
  });
}

// --- Helpers ---

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  return Math.floor(sec / 3600) + 'h ago';
}
