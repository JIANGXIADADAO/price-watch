// Price Watch - Content Script
// Element picker mode + price reading

let pickerActive = false;
let overlay = null;
let tooltip = null;
let hoveredEl = null;

// --- Element Picker ---

function startPicker() {
  if (pickerActive) return;
  pickerActive = true;

  overlay = document.createElement('div');
  overlay.className = 'pw-overlay';
  overlay.addEventListener('mousemove', onHover);
  overlay.addEventListener('click', onSelect, true);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopPicker(); });

  tooltip = document.createElement('div');
  tooltip.className = 'pw-tooltip';

  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);
}

function stopPicker() {
  pickerActive = false;
  if (overlay) { overlay.remove(); overlay = null; }
  if (tooltip) { tooltip.remove(); tooltip = null; }
  if (hoveredEl) { hoveredEl.classList.remove('pw-hover'); hoveredEl = null; }
}

function onHover(e) {
  if (!pickerActive) return;
  e.stopPropagation();
  e.preventDefault();

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === overlay || el === tooltip) return;

  if (hoveredEl && hoveredEl !== el) {
    hoveredEl.classList.remove('pw-hover');
  }
  hoveredEl = el;
  el.classList.add('pw-hover');

  const rect = el.getBoundingClientRect();
  const text = el.textContent.trim().slice(0, 60);
  tooltip.textContent = `${el.tagName.toLowerCase()}.${el.className.split(' ')[0] || '?'} — "${text}"`;
  tooltip.style.left = (rect.left + 4) + 'px';
  tooltip.style.top = (rect.bottom + 6) + 'px';
}

function onSelect(e) {
  if (!pickerActive) return;
  e.stopPropagation();
  e.preventDefault();

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return;

  // Build a CSS selector path for the element
  const selector = buildSelector(el);
  const priceText = el.textContent.trim();
  const priceNum = parseFloat(priceText.replace(/[^0-9.,]/g, '').replace(',', '.'));

  stopPicker();

  // Send result back to popup
  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTED',
    data: {
      selector: selector,
      priceText: priceText,
      priceValue: priceNum || 0,
      url: window.location.href,
      title: document.title
    }
  });
}

function buildSelector(el) {
  // Try ID first
  if (el.id) return '#' + CSS.escape(el.id);

  // Try unique data attributes
  for (const attr of ['data-testid', 'data-price', 'data-product-id', 'itemprop']) {
    if (el.getAttribute(attr)) return `[${attr}="${el.getAttribute(attr)}"]`;
  }

  // Build path
  const parts = [];
  let current = el;
  while (current && current !== document.body && parts.length < 5) {
    let seg = current.tagName.toLowerCase();
    if (current.className && typeof current.className === 'string') {
      const cls = current.className.split(' ').filter(c => c && !c.startsWith('pw-')).slice(0, 2).join('.');
      if (cls) seg += '.' + cls;
    }
    parts.unshift(seg);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

// --- Price Reader ---

function readPrice(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return { found: false, error: 'element not found' };
    const text = el.textContent.trim();
    const num = parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));
    return { found: true, priceText: text, priceValue: num || 0 };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

// --- Message Handlers ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_PICKER':
      startPicker();
      sendResponse({ ok: true });
      break;
    case 'STOP_PICKER':
      stopPicker();
      sendResponse({ ok: true });
      break;
    case 'READ_PRICE':
      sendResponse(readPrice(msg.selector));
      break;
  }
});
