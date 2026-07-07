/* ─────────────────────────────────────────────────────────────────────────
 * Popup — a thin remote for the in-page exporter (content.js).
 * All fetch / parse / format / download logic lives in content.js so there is
 * a single source of truth. The popup only renders state and forwards export
 * requests over chrome.tabs.sendMessage.
 *
 * PDF is intentionally not offered here: it relies on window.open(), which is
 * popup-blocked when triggered from a message (no user activation in the tab).
 * The in-page Export button still offers PDF.
 * ─────────────────────────────────────────────────────────────────────── */

const app = document.getElementById('app');
let toastTimer = null;

/* ─── UI helpers ─────────────────────────────────────────────────────────── */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fileIcon() {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/>' +
    '<line x1="16" y1="13" x2="8" y2="13"/>' +
    '<line x1="16" y1="17" x2="8" y2="17"/>' +
    '</svg>';
}

function codeIcon() {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="16 18 22 12 16 6"/>' +
    '<polyline points="8 6 2 12 8 18"/>' +
    '</svg>';
}

function showToast(toast, msg, type) {
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3500);
}

function emptyState(msg) {
  app.innerHTML =
    '<div class="empty">' +
      '<div class="icon-wrap">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"' +
             ' stroke="#6e6e6e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"/>' +
          '<line x1="12" y1="8" x2="12" y2="12"/>' +
          '<circle cx="12" cy="16" r="1" fill="#6e6e6e"/>' +
        '</svg>' +
      '</div>' +
      '<p>' + msg + '</p>' +
    '</div>';
}

/* ─── Render ─────────────────────────────────────────────────────────────── */

function renderExport(tabId, status) {
  const count   = status.count;
  const plural  = count !== 1 ? 's' : '';

  app.innerHTML =
    '<div class="content">' +
      '<div class="meta">' +
        '<div class="meta-label">Conversation</div>' +
        '<div class="meta-value" title="' + esc(status.title) + '">' + esc(status.title) + '</div>' +
      '</div>' +
      '<div class="meta">' +
        '<div class="meta-label">' + count + ' message' + plural + '</div>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<button class="btn" id="dl-md">'   + fileIcon() + ' Markdown   <span class="ext">.md</span></button>' +
      '<button class="btn" id="dl-txt">'  + fileIcon() + ' Plain Text <span class="ext">.txt</span></button>' +
      '<button class="btn" id="dl-json">' + codeIcon() + ' JSON       <span class="ext">.json</span></button>' +
      '<button class="btn" id="dl-csv">'  + fileIcon() + ' CSV        <span class="ext">.csv</span></button>' +
      '<div class="toast" id="toast"></div>' +
    '</div>';

  const toast = document.getElementById('toast');

  async function doExport(fmt, btn) {
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'cgx-export', fmt });
      if (res && res.ok) {
        showToast(toast, 'Saved .' + fmt, 'ok');
      } else {
        showToast(toast, 'Error: ' + ((res && res.error) || 'export failed'), 'err');
      }
    } catch (e) {
      showToast(toast, 'Error: ' + e.message, 'err');
    } finally {
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }
  }

  const wire = (id, fmt) => {
    const btn = document.getElementById(id);
    btn.onclick = () => doExport(fmt, btn);
  };
  wire('dl-md',   'md');
  wire('dl-txt',  'txt');
  wire('dl-json', 'json');
  wire('dl-csv',  'csv');
}

/* ─── Init ───────────────────────────────────────────────────────────────── */

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  if (!/chatgpt\.com|chat\.openai\.com/.test(url)) {
    emptyState('Open a ChatGPT conversation<br>to export it.');
    return;
  }

  let status;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'cgx-status' });
  } catch (_) {
    // Content script not present — tab was open before the extension was
    // installed / updated. A reload re-injects it.
    emptyState('Reload the ChatGPT tab,<br>then reopen this popup.');
    return;
  }

  if (!status || !status.ok) {
    emptyState('Open a specific conversation<br>to export it.');
    return;
  }

  renderExport(tab.id, status);
})();
