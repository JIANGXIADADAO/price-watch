// Price Watch - Background Service Worker
// Periodic price checks + webhook notifications

const ALARM_NAME = 'price-check';
const CHECK_INTERVAL_MIN = 15; // default every 15 min

// --- Lifecycle ---

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MIN });
  console.log('[PriceWatch] installed, alarm set to', CHECK_INTERVAL_MIN, 'min');
});

chrome.runtime.onStartup.addListener(async () => {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MIN });
  }
});

// --- Alarm Handler: check all monitored prices ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const { targets = [], webhook = '' } = await chrome.storage.local.get(['targets', 'webhook']);
  if (!targets.length) return;

  console.log('[PriceWatch] checking', targets.length, 'targets...');
  const changes = [];

  for (const t of targets) {
    try {
      const [tab] = await chrome.tabs.query({ url: t.url + '*' });
      const targetTab = tab || await chrome.tabs.create({ url: t.url, active: false });

      // Wait for page load
      await new Promise(resolve => {
        const listener = (tabId, info) => {
          if (tabId === targetTab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout after 15s
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
      });

      // Read price via content script
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: (selector) => {
          try {
            const el = document.querySelector(selector);
            if (!el) return { found: false };
            const text = el.textContent.trim();
            const num = parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));
            return { found: true, priceText: text, priceValue: num || 0 };
          } catch (e) {
            return { found: false, error: e.message };
          }
        },
        args: [t.selector]
      });

      // Clean up tab if we created it
      if (!tab) await chrome.tabs.remove(targetTab.id);

      const result = results[0]?.result;
      if (!result?.found) continue;

      const oldPrice = t.lastPrice;
      const newPrice = result.priceValue;

      // Update stored price
      t.lastPrice = newPrice;
      t.lastPriceText = result.priceText;
      t.lastChecked = Date.now();

      // Detect change > 1%
      if (oldPrice && Math.abs(newPrice - oldPrice) / oldPrice > 0.01) {
        const pct = (((newPrice - oldPrice) / oldPrice) * 100).toFixed(1);
        changes.push({
          title: t.title,
          url: t.url,
          oldPrice: oldPrice,
          newPrice: newPrice,
          change: pct + '%',
          direction: newPrice > oldPrice ? 'up' : 'down'
        });
      }
    } catch (e) {
      console.error('[PriceWatch] check failed for', t.url, e);
    }
  }

  // Save updated targets
  await chrome.storage.local.set({ targets });

  // Notify changes
  if (changes.length) {
    await notifyChanges(changes, webhook);
  }
});

// --- Notifications ---

async function notifyChanges(changes, webhookUrl) {
  for (const c of changes) {
    const dir = c.direction === 'up' ? '📈' : '📉';
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${dir} Price ${c.direction}: ${c.title}`,
      message: `$${c.oldPrice} → $${c.newPrice} (${c.change})`,
      priority: 2
    });
  }

  // Webhook
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'price_change',
          timestamp: new Date().toISOString(),
          changes: changes
        })
      });
    } catch (e) {
      console.error('[PriceWatch] webhook failed:', e);
    }
  }
}

// --- Message Handlers ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'ELEMENT_SELECTED':
      // Forward to popup (popup will save)
      chrome.runtime.sendMessage(msg);
      sendResponse({ ok: true });
      break;

    case 'GET_TARGETS':
      chrome.storage.local.get(['targets', 'webhook']).then(data => {
        sendResponse(data);
      });
      return true; // async

    case 'SAVE_TARGET':
      chrome.storage.local.get(['targets']).then(async data => {
        const targets = data.targets || [];
        targets.push({ ...msg.target, id: Date.now(), lastPrice: null, lastChecked: null });
        await chrome.storage.local.set({ targets });
        sendResponse({ ok: true });
      });
      return true;

    case 'DELETE_TARGET':
      chrome.storage.local.get(['targets']).then(async data => {
        const targets = (data.targets || []).filter(t => t.id !== msg.id);
        await chrome.storage.local.set({ targets });
        sendResponse({ ok: true });
      });
      return true;

    case 'SAVE_WEBHOOK':
      chrome.storage.local.set({ webhook: msg.url }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
  }
});
