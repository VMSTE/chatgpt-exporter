/* ─────────────────────────────────────────────────────────────────────────
 * Runs in the ChatGPT tab context (via chrome.scripting.executeScript).
 * Fetches the full conversation from ChatGPT's internal API.
 * Self-contained — no references to popup variables.
 * ─────────────────────────────────────────────────────────────────────── */
async function fetchConversation() {
  const convId = location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!convId) return null;

  // Get Bearer token from ChatGPT session
  const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
  if (!sessionRes.ok) return null;
  const session = await sessionRes.json();
  if (!session.accessToken) return null;

  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const accountId = session.account?.id ?? session.accounts?.default?.account?.id;
  if (accountId) headers['chatgpt-account-id'] = accountId;

  // Try multiple endpoints — project/GPT conversations may differ
  let data = null;
  for (const path of [
    `/backend-api/conversation/${convId}`,
    `/backend-api/gizmo_conversation/${convId}`,
    `/backend-api/calpico/chatgpt/rooms/${convId}`,
  ]) {
    const r = await fetch(path, { credentials: 'include', headers });
    if (r.ok) { data = await r.json(); break; }
  }
  if (!data) return null;

  // Walk conversation tree from current_node to root
  const chain = [];
  let id = data.current_node;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = data.mapping[id];
    if (!node) break;
    chain.unshift(node);
    id = node.parent;
  }

  const messages = [];
  for (const node of chain) {
    const m = node.message;
    if (!m) continue;
    const role = m.author?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = (m.content?.parts ?? [])
      .filter(p => typeof p === 'string')
      .join('')
      .trim();
    if (!text) continue;
    messages.push({
      role,
      content: text,
      timestamp: m.create_time
        ? new Date(m.create_time * 1000).toISOString()
        : null,
    });
  }

  return {
    id:        data.conversation_id ?? convId,
    title:     (data.title || 'ChatGPT Conversation').trim(),
    messages,
    updatedAt: data.update_time
      ? new Date(data.update_time * 1000).toISOString()
      : new Date().toISOString(),
  };
}

/* ─── Formatters (run in popup context) ──────────────────────────────────── */

function toMarkdown(conv) {
  const updated = new Date(conv.updatedAt).toLocaleString();
  const lines = [`# ${conv.title}`, `> *Last updated: ${updated}*`, ''];
  for (const { role, content, timestamp } of conv.messages) {
    const who  = role === 'user' ? 'You' : 'ChatGPT';
    const time = timestamp ? ` *(${new Date(timestamp).toLocaleString()})*` : '';
    lines.push(`**${who}**${time}`, '', content, '', '---', '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function toPlainText(conv) {
  const lines = [conv.title, '-'.repeat(Math.min(conv.title.length, 60)), ''];
  for (const { role, content } of conv.messages) {
    lines.push(`[${role === 'user' ? 'You' : 'ChatGPT'}]`, content, '');
  }
  return lines.join('\n');
}

function toJSON(conv) {
  return JSON.stringify({
    id:          conv.id,
    title:       conv.title,
    lastUpdated: conv.updatedAt,
    messages:    conv.messages,
  }, null, 2);
}

/* ─── File helpers ───────────────────────────────────────────────────────── */

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'conversation';
}

function makeFilename(conv, ext) {
  const d   = new Date(conv.updatedAt);
  const pad = n => String(n).padStart(2, '0');
  const ts  = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${slugify(conv.title)}_${ts}.${ext}`;
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── SVG icons ──────────────────────────────────────────────────────────── */

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

/* ─── Init ───────────────────────────────────────────────────────────────── */

const app = document.getElementById('app');
let toastTimer = null;

function showToast(toast, msg, type) {
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3500);
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  const onChatGPT = /chatgpt\.com|chat\.openai\.com/.test(url);

  /* ── Not on ChatGPT ──────────────────────────────────────────────────── */
  if (!onChatGPT) {
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
        '<p>Open a ChatGPT conversation<br>to export it.</p>' +
      '</div>';
    return;
  }

  /* ── Fetch conversation via API ─────────────────────────────────────────── */
  let conv = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func:   fetchConversation,
    });
    conv = res.result;
  } catch (_) { /* page may still be loading */ }

  /* ── No conversation open ────────────────────────────────────────────── */
  if (!conv || !conv.messages.length) {
    const titleFromTab = tab.title
      ?.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim()
      ?? 'ChatGPT';

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
        '<p>Open a specific conversation<br>to export it.</p>' +
      '</div>';
    return;
  }

  const msgCount = conv.messages.length;
  const updated  = new Date(conv.updatedAt).toLocaleDateString();

  app.innerHTML =
    '<div class="content">' +
      '<div class="meta">' +
        '<div class="meta-label">Conversation</div>' +
        '<div class="meta-value" title="' + esc(conv.title) + '">' + esc(conv.title) + '</div>' +
      '</div>' +
      '<div class="meta">' +
        '<div class="meta-label">' + msgCount + ' message' + (msgCount !== 1 ? 's' : '') + ' &nbsp;·&nbsp; ' + updated + '</div>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<button class="btn" id="dl-md">'   + fileIcon() + ' Markdown   <span class="ext">.md</span></button>' +
      '<button class="btn" id="dl-txt">'  + fileIcon() + ' Plain Text <span class="ext">.txt</span></button>' +
      '<button class="btn" id="dl-json">' + codeIcon() + ' JSON       <span class="ext">.json</span></button>' +
      '<div class="toast" id="toast"></div>' +
    '</div>';

  const toast = document.getElementById('toast');

  /* ── Export ────────────────────────────────────────────────────────────── */
  async function doExport(fmt) {
    try {
      // Re-fetch to get latest state
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func:   fetchConversation,
      });
      const d = res.result;
      if (!d || !d.messages.length) {
        showToast(toast, 'No messages found.', 'err');
        return;
      }
      const name    = makeFilename(d, fmt);
      const builders = {
        md:   [toMarkdown(d),  name, 'text/markdown'],
        txt:  [toPlainText(d), name, 'text/plain'],
        json: [toJSON(d),      name, 'application/json'],
      };
      download(...builders[fmt]);
      showToast(toast, 'Saved: ' + name, 'ok');
    } catch (e) {
      showToast(toast, 'Error: ' + e.message, 'err');
    }
  }

  document.getElementById('dl-md').onclick   = () => doExport('md');
  document.getElementById('dl-txt').onclick  = () => doExport('txt');
  document.getElementById('dl-json').onclick = () => doExport('json');
})();
