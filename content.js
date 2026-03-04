(function () {
  'use strict';

  const BTN_ID  = 'cgx-btn';
  const MENU_ID = 'cgx-menu';

  /* ── URL helpers ───────────────────────────────────────────────────────── */

  function getConvId() {
    // Matches /c/{id} anywhere in the path — relaxed to handle non-UUID formats
    return location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
  }

  // Extract gizmo/project ID from /g/g-xxx or /g/g-xxx-slug paths
  function getGizmoId() {
    return location.pathname.match(/\/g\/(g-[^/]+)/)?.[1] ?? null;
  }

  // True when on the project home page (no conversation open)
  function isProjectHome() {
    return !!getGizmoId() && !getConvId();
  }

  function isOnChatGPT() {
    return /chatgpt\.com|chat\.openai\.com/.test(location.hostname);
  }

  /* ── ChatGPT internal API ──────────────────────────────────────────────── */

  let _session = null;

  async function getSession() {
    if (_session) return _session;
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    if (!r.ok) throw new Error(`Session fetch failed: ${r.status} ${r.statusText}`);
    const data = await r.json();
    if (!data.accessToken) throw new Error('Access token not found — are you logged in?');
    _session = data;
    // Refresh token every 5 minutes (session may expire)
    setTimeout(() => { _session = null; }, 5 * 60 * 1000);
    return data;
  }

  function authHeaders(session) {
    const h = { Authorization: `Bearer ${session.accessToken}` };
    const accountId = session.account?.id ?? session.accounts?.default?.account?.id;
    if (accountId) h['chatgpt-account-id'] = accountId;
    return h;
  }

  async function apiFetch(path) {
    const session = await getSession();
    const r = await fetch(path, {
      credentials: 'include',
      headers: authHeaders(session),
    });
    if (!r.ok) throw new Error(`API ${r.status}: ${r.statusText}`);
    return r.json();
  }

  // For project/GPT conversations the endpoint may differ — try multiple
  async function fetchConvData(convId) {
    const session = await getSession();
    const headers = authHeaders(session);
    const endpoints = [
      `/backend-api/conversation/${convId}`,
      `/backend-api/gizmo_conversation/${convId}`,
      `/backend-api/calpico/chatgpt/rooms/${convId}`,
    ];
    let lastStatus = null;
    for (const url of endpoints) {
      const r = await fetch(url, { credentials: 'include', headers });
      if (r.ok) return r.json();
      lastStatus = r.status;
      if (r.status !== 404) throw new Error(`API ${r.status}`);
    }
    throw new Error(`Conversation not found (${lastStatus}). The conversation may belong to a GPT with restricted access.`);
  }

  // Fetch canvas / deep-research documents attached to a conversation
  async function fetchTextDocs(convId) {
    try {
      const data = await apiFetch(`/backend-api/conversation/${convId}/textdocs`);
      const items = data?.items ?? (Array.isArray(data) ? data : []);
      return items;
    } catch { return []; }
  }

  // Fetch deep research widget HTML via ecosystem API
  async function fetchDeepResearchWidget(resourcePath) {
    const session = await getSession();
    const params = new URLSearchParams({
      force_local: 'false',
      uri: 'connectors://connector_openai_deep_research',
      template_pointer: 'internal://deep-research',
      resource_path: resourcePath,
    });
    const r = await fetch(`/backend-api/ecosystem/widget?${params}`, {
      credentials: 'include',
      headers: authHeaders(session),
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) return r.text();
    const data = await r.json();
    return data.html || null;
  }

  // Fallback: deep research reports cached in IndexedDB widget cache
  async function fetchDeepResearchFromIDB() {
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('oai-ecosys-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
      if (!db.objectStoreNames.contains('resolved-widget-cache')) {
        db.close(); return [];
      }
      const tx = db.transaction('resolved-widget-cache', 'readonly');
      const store = tx.objectStore('resolved-widget-cache');
      const all = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
      db.close();
      return all.filter(e =>
        e.subdomain === 'connector_openai_deep_research' && e.html
      );
    } catch (e) {
      console.warn('[CGX] IDB deep research failed:', e.message);
      return [];
    }
  }

  // Convert widget HTML to markdown-ish text
  function htmlToMdText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    if (!body) return '';
    // Remove scripts and styles
    for (const el of body.querySelectorAll('script,style,head')) el.remove();
    return _nodeToMd(body).replace(/\n{3,}/g, '\n\n').trim();
  }

  function _nodeToMd(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return '';
    const kids = Array.from(node.childNodes).map(_nodeToMd).join('');
    switch (tag) {
      case 'h1': return `\n# ${kids.trim()}\n\n`;
      case 'h2': return `\n## ${kids.trim()}\n\n`;
      case 'h3': return `\n### ${kids.trim()}\n\n`;
      case 'h4': return `\n#### ${kids.trim()}\n\n`;
      case 'p': return `${kids.trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n---\n\n';
      case 'strong': case 'b': return `**${kids.trim()}**`;
      case 'em': case 'i': return `*${kids.trim()}*`;
      case 'a': return `[${kids.trim()}](${node.getAttribute('href') || ''})`;
      case 'li': return `- ${kids.trim()}\n`;
      case 'pre': return `\n\`\`\`\n${kids.trim()}\n\`\`\`\n\n`;
      case 'code': return node.parentElement?.tagName === 'PRE' ? kids : `\`${kids}\``;
      case 'blockquote': return `> ${kids.trim()}\n\n`;
      case 'table': return kids + '\n';
      case 'tr': return kids + '|\n';
      case 'th': case 'td': return `| ${kids.trim()} `;
      default: return kids;
    }
  }

  // Decode literal \uXXXX escape sequences (deep research API returns double-escaped unicode)
  function decodeUnicodeEscapes(str) {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  /* ── Parse conversation tree → ordered messages ────────────────────────── */

  function parseConv(data) {
    // Walk from current_node back to root, then reverse
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
      if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;

      // Detect serialized tool invocations / config blobs that should be hidden
      const WIDGET_PREFIX = 'The latest state of the widget is: ';
      function extractOrFilter(s) {
        if (!s) return '';
        // Deep research widget state → extract report_message
        if (s.startsWith(WIDGET_PREFIX)) {
          try {
            const ws = JSON.parse(s.slice(WIDGET_PREFIX.length));
            const rp = ws.report_message?.content?.parts;
            if (Array.isArray(rp) && rp.length) return rp.join('\n');
          } catch {}
          return '';
        }
        // Parse JSON blobs — extract reports or filter out tool metadata
        const t = s.trim();
        if (t.startsWith('{')) {
          try {
            const o = JSON.parse(t);
            // Raw widget state with report → extract report content
            if (o.report_message?.content?.parts) {
              const rp = o.report_message.content.parts;
              if (Array.isArray(rp) && rp.length) return rp.join('\n');
            }
            // Widget state metadata (plan/status only, no report) → skip
            if (o.status && (o.plan || o.step_statuses_by_plan)) return '';
            // Tool blobs (steer, session_id, connector_settings) → skip
            if (o.path || o.session_id || o.connector_settings) return '';
          } catch {}
        }
        return s;
      }

      // Extract text from parts (strings or objects)
      const partsText = (m.content?.parts ?? [])
        .map(p => {
          if (typeof p === 'string') return extractOrFilter(p);
          if (p && typeof p === 'object') {
            if (typeof p.text === 'string') return extractOrFilter(p.text);
            if (typeof p.result === 'string') return extractOrFilter(p.result);
          }
          return '';
        })
        .join('\n')
        .trim();

      // Fallback: content.text / content.result — also filter tool blobs
      const contentText = extractOrFilter(
        typeof m.content?.text === 'string' ? m.content.text.trim() : ''
      );
      const resultText = extractOrFilter(
        typeof m.content?.result === 'string' ? m.content.result.trim() : ''
      );

      // Pick the best source — skip placeholder stubs ("embedded UI")
      const isPlaceholder = s => /embedded UI|has been displayed/i.test(s);
      const text = [partsText, contentText, resultText]
        .filter(t => t && !isPlaceholder(t))
        .sort((a, b) => b.length - a.length)[0] || '';
      if (!text) continue;

      messages.push({
        id: m.id,
        role,
        content: text,
        timestamp: m.create_time
          ? new Date(m.create_time * 1000).toISOString()
          : null,
      });
    }

    // Off-chain nodes: ct:"code" with response_format_name (structured output)
    for (const node of Object.values(data.mapping)) {
      const m = node.message;
      if (!m) continue;
      if (m.content?.content_type === 'code'
          && m.content?.response_format_name && typeof m.content?.text === 'string') {
        let t = m.content.text.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
          try {
            const parsed = JSON.parse(t);
            t = parsed.markdown || parsed.report || parsed.content || parsed.text
              || parsed.body || parsed.output || (typeof parsed === 'string' ? parsed : t);
          } catch {}
        }
        t = decodeUnicodeEscapes(t);
        if (t.length > 200 && !seen.has(m.id)) {
          seen.add(m.id);
          messages.push({
            id: m.id,
            role: 'assistant',
            content: t,
            timestamp: m.create_time ? new Date(m.create_time * 1000).toISOString() : null,
          });
        }
      }
    }

    return {
      id:        data.conversation_id ?? getConvId() ?? '',
      title:     (data.title || 'ChatGPT Conversation').trim(),
      messages,
      updatedAt: data.update_time
        ? new Date(data.update_time * 1000)
        : new Date(),
      // Project / GPT identifier — ChatGPT Projects may use gizmo_id,
      // workspace_id, or project_id depending on version
      projectId: data.gizmo_id ?? data.workspace_id ?? data.project_id ?? null,
    };
  }

  // Scan raw conversation for deep research indicators
  function deepResearchInfo(rawData) {
    let resourcePath = null;
    let timestamp = null;

    for (const node of Object.values(rawData.mapping || {})) {
      const m = node.message;
      if (!m) continue;

      // venus_widget_state → timestamp of the deep research result
      if (m.metadata?.venus_widget_state) {
        timestamp = m.create_time ? m.create_time * 1000 : null;
      }

      // Tool invocation JSON with path → resource_path for widget API
      for (const p of m.content?.parts ?? []) {
        if (typeof p !== 'string' || !p.startsWith('{')) continue;
        try {
          const o = JSON.parse(p);
          if (o.path && /connector_openai_deep_research/.test(o.path)) {
            resourcePath = o.path;
          }
        } catch {}
      }
    }

    if (!resourcePath && !timestamp) return null;
    return { resourcePath, timestamp };
  }

  // Fetch deep research report and inject into conversation messages
  async function injectDeepResearch(conv, rawData) {
    const info = deepResearchInfo(rawData);
    if (!info) return;

    let html = null;

    // 1. Try widget API (works even for non-cached conversations)
    if (info.resourcePath) {
      try { html = await fetchDeepResearchWidget(info.resourcePath); } catch {}
    }

    // 2. Fallback: IndexedDB cache
    if (!html) {
      const entries = await fetchDeepResearchFromIDB();
      if (entries.length) {
        let best = entries[0];
        if (entries.length > 1 && info.timestamp) {
          best = entries.reduce((a, b) => {
            const da = Math.abs((a.timestamp || a.created_at || 0) - info.timestamp);
            const db = Math.abs((b.timestamp || b.created_at || 0) - info.timestamp);
            return da <= db ? a : b;
          });
        }
        html = best.html;
      }
    }

    if (!html) return;

    const md = decodeUnicodeEscapes(htmlToMdText(html));
    if (md.length < 100) return; // HTML was a JS shell, no useful text

    conv.messages.push({
      role: 'assistant',
      content: md,
      timestamp: info.timestamp ? new Date(info.timestamp).toISOString() : null,
    });
  }

  /* ── Formatters ────────────────────────────────────────────────────────── */

  function docBody(d) {
    return d.content || d.text || d.body || d.markdown || d.value || '';
  }

  function textDocsSection(docs, fmt) {
    if (!docs || !docs.length) return '';
    // Filter out empty docs
    const valid = docs.filter(d => docBody(d));
    if (!valid.length) return '';
    if (fmt === 'md') {
      return '\n\n## Documents\n\n' +
        valid.map(d => `### ${d.title || d.name || 'Untitled'}\n\n${docBody(d)}`).join('\n\n---\n\n') + '\n';
    }
    if (fmt === 'txt') {
      return '\n\n=== Documents ===\n\n' +
        valid.map(d => `[${d.title || d.name || 'Untitled'}]\n${docBody(d)}`).join('\n\n') + '\n';
    }
    return '';
  }

  function toMd(conv) {
    const lines = [
      `# ${conv.title}`,
      `> *Last updated: ${conv.updatedAt.toLocaleString()}*`,
      '',
    ];
    for (const { role, content, timestamp } of conv.messages) {
      const who  = role === 'user' ? 'You' : role === 'tool' ? 'Deep Research' : 'ChatGPT';
      const time = timestamp
        ? ` *(${new Date(timestamp).toLocaleString()})*`
        : '';
      lines.push(`**${who}**${time}`, '', content, '', '---', '');
    }
    return lines.join('\n').trimEnd() + textDocsSection(conv.textDocs, 'md');
  }

  function toTxt(conv) {
    const lines = [conv.title, '-'.repeat(Math.min(conv.title.length, 60)), ''];
    for (const { role, content } of conv.messages) {
      const who = role === 'user' ? 'You' : role === 'tool' ? 'Deep Research' : 'ChatGPT';
      lines.push(`[${who}]`, content, '');
    }
    return lines.join('\n') + textDocsSection(conv.textDocs, 'txt');
  }

  function toJson(conv) {
    const obj = {
      id:          conv.id,
      title:       conv.title,
      lastUpdated: conv.updatedAt.toISOString(),
      messages:    conv.messages,
    };
    if (conv.textDocs?.length) obj.canvasDocuments = conv.textDocs;
    return JSON.stringify(obj, null, 2);
  }

  function toCsv(conv) {
    function esc(s) {
      if (!s) return '""';
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    const rows = ['timestamp,role,content'];
    for (const { role, content, timestamp } of conv.messages) {
      rows.push(`${esc(timestamp || '')},${esc(role)},${esc(content)}`);
    }
    return '\ufeff' + rows.join('\n');
  }

  function toHtmlDoc(conv) {
    function mdToHtml(text) {
      // 1. Escape HTML entities FIRST (before creating any tags)
      text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // 2. Code blocks (protect from further processing)
      const codeBlocks = [];
      text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        codeBlocks.push(`<pre><code>${code}</code></pre>`);
        return `\x00CB${codeBlocks.length - 1}\x00`;
      });

      // 3. Inline code
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

      // 4. Bold, italic
      text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

      // 5. Blockquotes (matching escaped >)
      text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

      // 6. Headers
      text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // 7. Links
      text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

      // 8. Horizontal rules
      text = text.replace(/^---$/gm, '<hr>');

      // 9. Lists (AFTER escaping — safe to create tags now)
      text = text.replace(/(^- .+$(\n|$))+/gm, match => {
        const items = match.trim().split('\n')
          .map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
      });
      text = text.replace(/(^\d+\. .+$(\n|$))+/gm, match => {
        const items = match.trim().split('\n')
          .map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
        return `<ol>${items}</ol>`;
      });
      // +/– style lists
      text = text.replace(/(^[+\u2013\u2014\u2212] .+$(\n|$))+/gm, match => {
        const items = match.trim().split('\n')
          .map(l => `<li>${l.replace(/^[+\u2013\u2014\u2212] /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
      });

      // 10. Paragraphs
      text = text.replace(/\n\n/g, '</p><p>');
      text = text.replace(/\n/g, '<br>');

      // 11. Restore code blocks
      text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);

      return text;
    }
    const msgs = conv.messages.map(m => {
      const who = m.role === 'user' ? 'You' : m.role === 'tool' ? 'Deep Research' : 'ChatGPT';
      const time = m.timestamp
        ? ` <span class="time">${new Date(m.timestamp).toLocaleString()}</span>` : '';
      return `<div class="msg ${m.role}"><div class="role">${who}${time}</div><div class="body"><p>${mdToHtml(m.content)}</p></div></div>`;
    }).join('\n');
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const title = esc(conv.title);
    const date = conv.updatedAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
@page { size: A4; margin: 20mm 22mm 18mm 22mm; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* ── Base ── */
body { font-family: 'Inter', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif;
  font-size: 9.5pt; line-height: 1.75; color: #1a1a1a; letter-spacing: 0.003em;
  max-width: 100%; margin: 0; padding: 0;
  font-feature-settings: 'kern' 1, 'liga' 1, 'calt' 1;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

/* ── Title block — compact to keep content on page 1 ── */
header { margin-bottom: 10pt; padding-bottom: 10pt; border-bottom: 0.75pt solid #000; }
header h1 { font-size: 14pt; font-weight: 600; letter-spacing: -0.025em;
  color: #000; margin-bottom: 2pt; line-height: 1.3; }
header .date { font-size: 7pt; color: #999; letter-spacing: 0.05em; text-transform: uppercase; }

/* ── Messages ── */
.msg { padding: 10pt 0 8pt; }
.msg + .msg { border-top: none; }

/* Subtle whitespace separator instead of a line */
.msg + .msg::before {
  content: ''; display: block; height: 0; margin-bottom: 8pt;
  border-top: 0.25pt solid #d8d8d8; }

/* ── Role labels ── */
.role { font-size: 6.5pt; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.12em; margin-bottom: 4pt; color: #888; }
.msg.user .role { color: #1a1a1a; }
.time { font-weight: 400; color: #bbb; text-transform: none; letter-spacing: 0; font-size: 6.5pt; }

/* ── Body text ── */
.body { font-size: 9.5pt; line-height: 1.75; }
.body p { margin-bottom: 6pt; }
.body p:last-child { margin-bottom: 0; }

/* ── Typography ── */
h1 { font-size: 12pt; font-weight: 600; margin: 14pt 0 5pt; letter-spacing: -0.02em; color: #000; }
h2 { font-size: 11pt; font-weight: 600; margin: 12pt 0 4pt; letter-spacing: -0.01em; color: #000; }
h3 { font-size: 10pt; font-weight: 600; margin: 10pt 0 3pt; color: #111; }
h4 { font-size: 9.5pt; font-weight: 600; margin: 8pt 0 2pt; color: #222; }
strong { font-weight: 600; }
em { font-style: italic; }

/* ── Lists ── */
ul, ol { margin: 4pt 0 4pt 14pt; }
li { margin-bottom: 1.5pt; line-height: 1.65; }
li::marker { color: #aaa; }

/* ── Blockquote ── */
blockquote { border-left: 1.5pt solid #ddd; padding-left: 10pt; color: #555;
  margin: 6pt 0; font-style: italic; font-size: 9pt; }

/* ── Code ── */
pre { background: #f8f8f8; border: 0.5pt solid #e5e5e5; border-radius: 2pt;
  padding: 7pt 9pt; overflow-x: auto; margin: 6pt 0;
  font-size: 7.5pt; line-height: 1.5; }
code { font-family: 'SF Mono', 'JetBrains Mono', 'Consolas', monospace; font-size: 8pt;
  background: #f4f4f4; padding: 0.5pt 2.5pt; border-radius: 1.5pt; }
pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }

/* ── Misc ── */
hr { border: none; border-top: 0.25pt solid #d8d8d8; margin: 10pt 0; }
a { color: #1a1a1a; text-decoration: underline; text-decoration-color: #ccc;
  text-underline-offset: 1.5pt; }

/* ── Print ── */
p { orphans: 3; widows: 3; }
pre { break-inside: avoid; }
h1, h2, h3, h4 { break-after: avoid; }

/* ── Screen preview ── */
@media screen {
  body { max-width: 620px; margin: 0 auto; padding: 48px 32px; }
}
</style></head><body>
<header>
  <h1>${title}</h1>
  <div class="date">${date}</div>
</header>
${msgs}
</body></html>`;
  }

  function exportPdf(conv) {
    const html = toHtmlDoc(conv);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) {
      w.addEventListener('afterprint', () => { w.close(); URL.revokeObjectURL(url); });
      w.onload = () => w.print();
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  /* ── Filename with timestamp ───────────────────────────────────────────── */

  function makeSlug(str) {
    return str.toLowerCase()
      .replace(/[^a-zа-яёa-z0-9\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'conversation';
  }

  function makeFilename(conv, ext) {
    const d   = conv.updatedAt;
    const pad = n => String(n).padStart(2, '0');
    const ts  = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `${makeSlug(conv.title)}_${ts}.${ext}`;
  }

  /* ── Download blob ─────────────────────────────────────────────────────── */

  function dlBlob(content, name, type) {
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([content], { type })),
      download: name,
    });
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => { URL.revokeObjectURL(a.href); a.remove(); });
  }

  /* ── Minimal ZIP generator (STORE, no compression) ────────────────────── */

  const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = _crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    const enc = new TextEncoder();
    const entries = files.map(f => {
      const nameBytes = enc.encode(f.name);
      const dataBytes = enc.encode(f.content);
      return { nameBytes, dataBytes, crc: crc32(dataBytes) };
    });

    // Calculate sizes
    let localSize = 0;
    for (const e of entries) localSize += 30 + e.nameBytes.length + e.dataBytes.length;
    let cdSize = 0;
    for (const e of entries) cdSize += 46 + e.nameBytes.length;
    const eocdSize = 22;
    const buf = new ArrayBuffer(localSize + cdSize + eocdSize);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    let localOff = 0;
    const offsets = [];

    // Write local file headers + data
    for (const e of entries) {
      offsets.push(localOff);
      view.setUint32(localOff, 0x04034b50, true);       // signature
      view.setUint16(localOff + 4, 20, true);            // version needed
      view.setUint16(localOff + 6, 0x0800, true);        // flags: UTF-8
      view.setUint16(localOff + 8, 0, true);             // compression: STORE
      view.setUint16(localOff + 10, 0, true);            // mod time
      view.setUint16(localOff + 12, 0, true);            // mod date
      view.setUint32(localOff + 14, e.crc, true);        // crc-32
      view.setUint32(localOff + 18, e.dataBytes.length, true); // compressed size
      view.setUint32(localOff + 22, e.dataBytes.length, true); // uncompressed size
      view.setUint16(localOff + 26, e.nameBytes.length, true); // filename length
      view.setUint16(localOff + 28, 0, true);            // extra field length
      u8.set(e.nameBytes, localOff + 30);
      u8.set(e.dataBytes, localOff + 30 + e.nameBytes.length);
      localOff += 30 + e.nameBytes.length + e.dataBytes.length;
    }

    // Write central directory
    let cdOff = localOff;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      view.setUint32(cdOff, 0x02014b50, true);           // signature
      view.setUint16(cdOff + 4, 20, true);               // version made by
      view.setUint16(cdOff + 6, 20, true);               // version needed
      view.setUint16(cdOff + 8, 0x0800, true);           // flags: UTF-8
      view.setUint16(cdOff + 10, 0, true);               // compression: STORE
      view.setUint16(cdOff + 12, 0, true);               // mod time
      view.setUint16(cdOff + 14, 0, true);               // mod date
      view.setUint32(cdOff + 16, e.crc, true);           // crc-32
      view.setUint32(cdOff + 20, e.dataBytes.length, true);
      view.setUint32(cdOff + 24, e.dataBytes.length, true);
      view.setUint16(cdOff + 28, e.nameBytes.length, true);
      view.setUint16(cdOff + 30, 0, true);               // extra field length
      view.setUint16(cdOff + 32, 0, true);               // comment length
      view.setUint16(cdOff + 34, 0, true);               // disk number start
      view.setUint16(cdOff + 36, 0, true);               // internal attrs
      view.setUint32(cdOff + 38, 0, true);               // external attrs
      view.setUint32(cdOff + 42, offsets[i], true);       // local header offset
      u8.set(e.nameBytes, cdOff + 46);
      cdOff += 46 + e.nameBytes.length;
    }

    // Write EOCD
    view.setUint32(cdOff, 0x06054b50, true);
    view.setUint16(cdOff + 4, 0, true);                  // disk number
    view.setUint16(cdOff + 6, 0, true);                  // disk with CD
    view.setUint16(cdOff + 8, entries.length, true);      // entries on disk
    view.setUint16(cdOff + 10, entries.length, true);     // total entries
    view.setUint32(cdOff + 12, cdOff - localOff, true);   // CD size
    view.setUint32(cdOff + 16, localOff, true);           // CD offset
    view.setUint16(cdOff + 20, 0, true);                  // comment length

    return new Uint8Array(buf);
  }

  /* ── Export single conversation ────────────────────────────────────────── */

  async function exportSingle(convId, fmt, onProgress) {
    if (onProgress) onProgress('Loading conversation…');
    const raw  = await fetchConvData(convId);
    const conv = parseConv(raw);

    if (onProgress) onProgress('Fetching documents…');
    conv.textDocs = await fetchTextDocs(convId);

    const info = deepResearchInfo(raw);
    if (info) {
      if (onProgress) onProgress('Fetching deep research…');
      await injectDeepResearch(conv, raw);
    }

    if (onProgress) onProgress('Saving…');
    if (fmt === 'pdf') { exportPdf(conv); return conv; }
    const map  = {
      md:   [toMd(conv),   makeFilename(conv, 'md'),   'text/markdown'],
      txt:  [toTxt(conv),  makeFilename(conv, 'txt'),  'text/plain'],
      json: [toJson(conv), makeFilename(conv, 'json'), 'application/json'],
      csv:  [toCsv(conv),  makeFilename(conv, 'csv'),  'text/csv'],
    };
    dlBlob(...map[fmt]);
    return conv;
  }

  /* ── Export all conversations in a project ─────────────────────────────── */

  function convMatchesProject(conv, idSet) {
    return [conv.gizmo_id, conv.workspace_id, conv.project_id]
      .filter(Boolean)
      .some(id => idSet.has(id));
  }

  async function fetchProjectConvs(projectId) {
    // Strip slug suffix: g-p-695cb2c9fa348191b58d0bc58435fe22-vmste → g-p-695cb2c9fa348191b58d0bc58435fe22
    // Gizmo IDs have a 32-char hex hash; anything after it is a slug
    const hexMatch = projectId.match(/^(g-p-[0-9a-f]{32})/);
    const shortId = hexMatch ? hexMatch[1] : projectId;
    const idsToTry = [...new Set([shortId, projectId])];

    // Build auth headers (best-effort — endpoint also works with cookies alone)
    let headers = {};
    try {
      const session = await getSession();
      headers = authHeaders(session);
    } catch { /* proceed with cookies only */ }

    // /backend-api/gizmos/{id}/conversations (paginated via cursor)
    for (const id of idsToTry) {
      try {
        const all = [];
        let cursor = 0;
        while (cursor !== null) {
          const r = await fetch(`/backend-api/gizmos/${id}/conversations?cursor=${cursor}`, {
            credentials: 'include',
            headers,
          });
          if (!r.ok) throw new Error(`API ${r.status}`);
          const data = await r.json();
          const items = data.items ?? [];
          all.push(...items);
          cursor = data.cursor ?? null;
        }
        if (all.length > 0) return all;
      } catch { /* try next id */ }
    }

    throw new Error('Could not find project conversations. Check that you are on a project page.');
  }

  async function exportProject(projectId, fmt, onProgress) {
    if (onProgress) onProgress('Finding conversations…');
    const items = await fetchProjectConvs(projectId);
    if (!items.length) throw new Error('No conversations found in this project.');

    const total = items.length;
    if (onProgress) onProgress(`0 / ${total}`);

    // Fetch each conversation (in parallel, batched to avoid rate limits)
    const batchSize = 5;
    const convs = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(item =>
          apiFetch(`/backend-api/conversation/${item.id}`)
            .then(async raw => {
              const conv = parseConv(raw);
              conv.textDocs = await fetchTextDocs(item.id);
              await injectDeepResearch(conv, raw);
              return conv;
            })
            .catch(e => { console.warn(`[CGX] skip ${item.id}:`, e.message); return null; })
        )
      );
      convs.push(...results.filter(Boolean));
      if (onProgress) onProgress(`${Math.min(i + batchSize, total)} / ${total}`);
    }

    if (!convs.length) throw new Error('Could not load any conversations.');

    if (onProgress) onProgress('Building ZIP…');

    // Build ZIP: each conversation = separate file
    const ext = fmt === 'json' ? 'json' : fmt;
    const formatter = fmt === 'json' ? toJson : fmt === 'md' ? toMd : toTxt;
    const usedNames = new Set();
    const files = convs.map(c => {
      let name = makeFilename(c, ext);
      let i = 2;
      while (usedNames.has(name)) {
        name = name.replace(`.${ext}`, `_${i}.${ext}`);
        i++;
      }
      usedNames.add(name);
      return { name, content: formatter(c) };
    });

    const zipBytes = buildZip(files);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    dlBlob(zipBytes, `project_${stamp}.zip`, 'application/zip');
  }

  /* ── Message selection mode ──────────────────────────────────────────── */

  let _selectionMode = false;
  let _selectionCleanup = null;

  function exitSelectionMode() {
    if (_selectionCleanup) _selectionCleanup();
  }

  async function enterSelectionMode(convId) {
    if (_selectionMode) return;
    _selectionMode = true;

    // Load conversation data upfront
    showProgress('Loading conversation\u2026');
    let conv;
    try {
      const raw = await fetchConvData(convId);
      conv = parseConv(raw);
      conv.textDocs = await fetchTextDocs(convId);
      await injectDeepResearch(conv, raw);
    } catch (e) {
      hideProgress();
      _selectionMode = false;
      alert('[Export] ' + e.message);
      return;
    }
    hideProgress();

    // Find message elements in DOM
    const articles = document.querySelectorAll('[data-message-id]');
    if (!articles.length) {
      alert('[Export] No messages found on this page.');
      _selectionMode = false;
      return;
    }

    const apiIds = new Set(conv.messages.map(m => m.id));
    const checkboxes = [];

    for (const el of articles) {
      const msgId = el.dataset.messageId;
      if (!apiIds.has(msgId)) continue;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.cgxSelect = msgId;
      cb.className = 'cgx-cb cgx-msg-sticky';
      cb.addEventListener('change', updateCount);
      el.prepend(cb);
      checkboxes.push(cb);
    }

    // Floating toolbar
    const toolbar = document.createElement('div');
    toolbar.id = 'cgx-sel-toolbar';
    Object.assign(toolbar.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '100001',
      background: '#2f2f2f',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '12px', padding: '8px 12px',
      display: 'flex', alignItems: 'center', gap: '8px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: '13px', color: '#cdcdcd',
    });

    // Select All
    const selAll = document.createElement('input');
    selAll.type = 'checkbox';
    selAll.className = 'cgx-cb';
    selAll.addEventListener('change', () => {
      checkboxes.forEach(cb => { cb.checked = selAll.checked; });
      updateCount();
    });
    toolbar.appendChild(selAll);

    const countLabel = document.createElement('span');
    countLabel.textContent = '0 selected';
    Object.assign(countLabel.style, { minWidth: '80px', fontSize: '12px', color: '#888' });
    toolbar.appendChild(countLabel);

    // Separator
    const sep = () => {
      const d = document.createElement('div');
      Object.assign(d.style, { width: '1px', height: '20px', background: 'rgba(255,255,255,0.12)' });
      return d;
    };
    toolbar.appendChild(sep());

    function updateCount() {
      const n = checkboxes.filter(cb => cb.checked).length;
      countLabel.textContent = `${n} selected`;
      selAll.checked = n === checkboxes.length;
      selAll.indeterminate = n > 0 && n < checkboxes.length;
    }

    function getSelectedIds() {
      return new Set(checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.cgxSelect));
    }

    function filteredConv() {
      const ids = getSelectedIds();
      if (!ids.size) return null;
      return { ...conv, messages: conv.messages.filter(m => ids.has(m.id)) };
    }

    function tbBtn(label, onClick) {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '7px', padding: '5px 10px',
        color: '#cdcdcd', fontSize: '12px',
        fontFamily: 'inherit', cursor: 'pointer',
      });
      b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.12)';
      b.onmouseleave = () => b.style.background = 'rgba(255,255,255,0.06)';
      b.onclick = onClick;
      toolbar.appendChild(b);
    }

    function doExport(formatFn, ext, mime) {
      const fc = filteredConv();
      if (!fc) { alert('No messages selected.'); return; }
      dlBlob(formatFn(fc), makeFilename(fc, ext), mime);
      exitSelectionMode();
    }

    tbBtn('PDF', () => {
      const fc = filteredConv();
      if (!fc) { alert('No messages selected.'); return; }
      exportPdf(fc);
      exitSelectionMode();
    });
    tbBtn('CSV',  () => doExport(toCsv,  'csv',  'text/csv'));
    tbBtn('MD',   () => doExport(toMd,   'md',   'text/markdown'));
    tbBtn('TXT',  () => doExport(toTxt,  'txt',  'text/plain'));
    tbBtn('JSON', () => doExport(toJson, 'json', 'application/json'));

    toolbar.appendChild(sep());

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '7px', padding: '5px 10px',
      color: '#888', fontSize: '12px', fontFamily: 'inherit', cursor: 'pointer',
    });
    cancelBtn.onclick = exitSelectionMode;
    toolbar.appendChild(cancelBtn);

    document.body.appendChild(toolbar);

    _selectionCleanup = () => {
      checkboxes.forEach(cb => cb.remove());
      toolbar.remove();
      _selectionMode = false;
      _selectionCleanup = null;
    };
  }

  /* ── Project conversation selection ──────────────────────────────────── */

  async function exportProjectSelected(convIds, fmt, onProgress) {
    const total = convIds.length;
    if (onProgress) onProgress(`0 / ${total}`);

    const batchSize = 5;
    const convs = [];
    for (let i = 0; i < convIds.length; i += batchSize) {
      const batch = convIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(id =>
          apiFetch(`/backend-api/conversation/${id}`)
            .then(async raw => {
              const c = parseConv(raw);
              c.textDocs = await fetchTextDocs(id);
              await injectDeepResearch(c, raw);
              return c;
            })
            .catch(e => { console.warn(`[CGX] skip ${id}:`, e.message); return null; })
        )
      );
      convs.push(...results.filter(Boolean));
      if (onProgress) onProgress(`${Math.min(i + batchSize, total)} / ${total}`);
    }

    if (!convs.length) throw new Error('Could not load any conversations.');
    if (onProgress) onProgress('Building ZIP\u2026');

    const ext = fmt === 'json' ? 'json' : fmt;
    const formatter = fmt === 'json' ? toJson : fmt === 'md' ? toMd : toTxt;
    const usedNames = new Set();
    const files = convs.map(c => {
      let name = makeFilename(c, ext);
      let i = 2;
      while (usedNames.has(name)) {
        name = name.replace(`.${ext}`, `_${i}.${ext}`);
        i++;
      }
      usedNames.add(name);
      return { name, content: formatter(c) };
    });

    const zipBytes = buildZip(files);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    dlBlob(zipBytes, `project_${stamp}.zip`, 'application/zip');
  }

  async function showProjectSelectModal(projectId, anchor) {
    closeMenu();
    showProgress('Loading conversations\u2026');
    let items;
    try {
      items = await fetchProjectConvs(projectId);
    } catch (e) {
      hideProgress();
      alert('[Export] ' + e.message);
      return;
    }
    hideProgress();
    if (!items.length) { alert('No conversations found.'); return; }

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'cgx-proj-modal';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '100002',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#2f2f2f', borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.12)',
      width: '480px', maxHeight: '70vh',
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
      color: '#cdcdcd',
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '16px 20px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      fontSize: '15px', fontWeight: '600',
    });
    header.textContent = 'Select conversations to export';
    modal.appendChild(header);

    // Scrollable list
    const list = document.createElement('div');
    Object.assign(list.style, { overflowY: 'auto', flex: '1', padding: '8px 12px' });

    const cbs = [];
    for (const item of items) {
      const row = document.createElement('label');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px', borderRadius: '8px', cursor: 'pointer',
      });
      row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.05)';
      row.onmouseleave = () => row.style.background = '';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.className = 'cgx-cb';
      cb.dataset.convId = item.id;
      cbs.push(cb);

      const info = document.createElement('div');
      info.style.flex = '1';
      info.style.minWidth = '0';

      const titleEl = document.createElement('div');
      Object.assign(titleEl.style, {
        fontSize: '13px', color: '#cdcdcd',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      });
      titleEl.textContent = item.title || 'Untitled';

      const dateEl = document.createElement('div');
      Object.assign(dateEl.style, { fontSize: '11px', color: '#666', marginTop: '2px' });
      const rawTime = item.update_time || item.create_time;
      dateEl.textContent = rawTime
        ? new Date(typeof rawTime === 'number' && rawTime < 1e12 ? rawTime * 1000 : rawTime).toLocaleDateString()
        : '';

      info.appendChild(titleEl);
      info.appendChild(dateEl);
      row.appendChild(cb);
      row.appendChild(info);
      list.appendChild(row);
    }
    modal.appendChild(list);

    // Footer
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      padding: '12px 16px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', gap: '10px',
    });

    // Toggle All
    let allSelected = true;
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'Deselect All';
    Object.assign(toggleBtn.style, {
      background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '7px', padding: '5px 10px',
      color: '#888', fontSize: '12px', fontFamily: 'inherit', cursor: 'pointer',
    });
    toggleBtn.onclick = () => {
      allSelected = !allSelected;
      cbs.forEach(cb => { cb.checked = allSelected; });
      toggleBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
    };
    footer.appendChild(toggleBtn);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    footer.appendChild(spacer);

    // Format segment buttons
    let selectedFmt = 'md';
    const fmtGroup = document.createElement('div');
    Object.assign(fmtGroup.style, {
      display: 'flex', borderRadius: '9px', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.12)',
    });
    const fmtBtns = [];
    for (const [v, l] of [['md','MD'],['txt','TXT'],['json','JSON']]) {
      const b = document.createElement('button');
      b.textContent = l;
      b.dataset.fmt = v;
      Object.assign(b.style, {
        background: v === selectedFmt ? 'rgba(255,255,255,0.15)' : 'transparent',
        border: 'none', padding: '5px 12px',
        color: v === selectedFmt ? '#fff' : '#888',
        fontSize: '12px', fontWeight: v === selectedFmt ? '600' : '400',
        fontFamily: 'inherit', cursor: 'pointer',
        borderRight: v !== 'json' ? '1px solid rgba(255,255,255,0.08)' : 'none',
      });
      b.onclick = () => {
        selectedFmt = v;
        fmtBtns.forEach(fb => {
          const active = fb.dataset.fmt === v;
          fb.style.background = active ? 'rgba(255,255,255,0.15)' : 'transparent';
          fb.style.color = active ? '#fff' : '#888';
          fb.style.fontWeight = active ? '600' : '400';
        });
      };
      fmtBtns.push(b);
      fmtGroup.appendChild(b);
    }
    footer.appendChild(fmtGroup);

    // Export button
    const expBtn = document.createElement('button');
    expBtn.textContent = 'Export ZIP';
    Object.assign(expBtn.style, {
      background: '#fff', border: 'none',
      borderRadius: '9px', padding: '6px 16px',
      color: '#000', fontSize: '13px', fontWeight: '600',
      fontFamily: 'inherit', cursor: 'pointer',
    });
    expBtn.onmouseenter = () => expBtn.style.background = '#e0e0e0';
    expBtn.onmouseleave = () => expBtn.style.background = '#fff';
    expBtn.onclick = async () => {
      const ids = cbs.filter(cb => cb.checked).map(cb => cb.dataset.convId);
      if (!ids.length) { alert('No conversations selected.'); return; }
      overlay.remove();
      await withLoading(anchor, () => exportProjectSelected(ids, selectedFmt, showProgress));
    };
    footer.appendChild(expBtn);

    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /* ── Dropdown menu ─────────────────────────────────────────────────────── */

  function closeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function menuSection(menu, label) {
    const el = document.createElement('div');
    el.textContent = label;
    Object.assign(el.style, {
      padding: '6px 12px 2px',
      fontSize: '11px', fontWeight: '600',
      color: '#6e6e6e',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    });
    menu.appendChild(el);
  }

  function menuItem(menu, label, badge, onClick) {
    const el = document.createElement('button');
    el.innerHTML = `
      <span>${label}</span>
      <span style="font-family:monospace;font-size:11px;color:#5e5e5e">${badge}</span>
    `;
    Object.assign(el.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', padding: '8px 12px',
      background: 'transparent', border: 'none',
      borderRadius: '7px', color: '#cdcdcd',
      fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer',
    });
    el.onmouseenter = () => el.style.background = 'rgba(255,255,255,0.08)';
    el.onmouseleave = () => el.style.background = '';
    el.onclick = onClick;
    menu.appendChild(el);
  }

  function showMenu(anchor, convId, projectId) {
    closeMenu();

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    Object.assign(menu.style, {
      position: 'fixed', zIndex: '99999',
      background: '#2f2f2f',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '10px', padding: '6px',
      minWidth: '220px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    });

    const { bottom, right } = anchor.getBoundingClientRect();
    menu.style.top   = `${bottom + 6}px`;
    menu.style.right = `${window.innerWidth - right}px`;

    // ── Current conversation
    if (convId) {
      menuSection(menu, 'Export conversation');
      menuItem(menu, 'Markdown',   '.md',   () => { closeMenu(); withLoading(anchor, () => exportSingle(convId, 'md',   showProgress)); });
      menuItem(menu, 'Plain Text', '.txt',  () => { closeMenu(); withLoading(anchor, () => exportSingle(convId, 'txt',  showProgress)); });
      menuItem(menu, 'JSON',       '.json', () => { closeMenu(); withLoading(anchor, () => exportSingle(convId, 'json', showProgress)); });
      menuItem(menu, 'CSV',        '.csv',  () => { closeMenu(); withLoading(anchor, () => exportSingle(convId, 'csv',  showProgress)); });
      menuItem(menu, 'PDF (print)','.pdf',  () => { closeMenu(); withLoading(anchor, () => exportSingle(convId, 'pdf',  showProgress)); });
      menuItem(menu, 'Select messages\u2026', '\u2610', () => { closeMenu(); enterSelectionMode(convId); });
    }

    // ── Project (all conversations → ZIP)
    if (projectId) {
      menuSection(menu, 'Export entire project');
      menuItem(menu, 'All as Markdown',   '.zip', () => { closeMenu(); withLoading(anchor, () => exportProject(projectId, 'md',   showProgress)); });
      menuItem(menu, 'All as Plain Text', '.zip', () => { closeMenu(); withLoading(anchor, () => exportProject(projectId, 'txt',  showProgress)); });
      menuItem(menu, 'All as JSON',       '.zip', () => { closeMenu(); withLoading(anchor, () => exportProject(projectId, 'json', showProgress)); });
      menuItem(menu, 'Select conversations\u2026', '\u2610', () => { showProjectSelectModal(projectId, anchor); });
    }

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }

  /* ── Loading / progress helpers ────────────────────────────────────────── */

  const PROGRESS_ID = 'cgx-progress';

  function showProgress(text) {
    let el = document.getElementById(PROGRESS_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = PROGRESS_ID;
      Object.assign(el.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '100000',
        background: '#2f2f2f', color: '#cdcdcd',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '10px', padding: '10px 16px',
        fontSize: '13px', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', gap: '8px',
      });
      // Spinner
      const spin = document.createElement('div');
      Object.assign(spin.style, {
        width: '14px', height: '14px',
        border: '2px solid rgba(255,255,255,0.2)',
        borderTop: '2px solid #cdcdcd',
        borderRadius: '50%',
        animation: 'cgx-spin 0.8s linear infinite',
      });
      if (!document.getElementById('cgx-spin-style')) {
        const style = document.createElement('style');
        style.id = 'cgx-spin-style';
        style.textContent = `
@keyframes cgx-spin { to { transform: rotate(360deg) } }
.cgx-cb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px;
  border: 1.5px solid rgba(255,255,255,0.5); border-radius: 5px; background: transparent;
  cursor: pointer; position: relative; flex-shrink: 0; transition: all .15s;
  outline: none !important; box-shadow: none !important; margin: 1px; }
.cgx-cb:checked { background: #fff; border-color: #fff; }
.cgx-cb:checked::after { content: ''; position: absolute; left: 5px; top: 1.5px;
  width: 5px; height: 9px; border: solid #000; border-width: 0 2px 2px 0;
  transform: rotate(45deg); }
.cgx-cb:hover { border-color: #fff; }
.cgx-cb:focus, .cgx-cb:focus-visible { outline: none !important; }
.cgx-msg-sticky { position: sticky; top: 80px; float: left;
  margin-left: -32px; margin-right: 10px; z-index: 10; }
`;
        document.head.appendChild(style);
      }
      el.appendChild(spin);
      const txt = document.createElement('span');
      txt.dataset.cgxText = '';
      el.appendChild(txt);
      document.body.appendChild(el);
    }
    el.querySelector('[data-cgx-text]').textContent = text;
  }

  function hideProgress() {
    document.getElementById(PROGRESS_ID)?.remove();
  }

  async function withLoading(btn, fn) {
    const html = btn.innerHTML;
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    try {
      await fn();
    } catch (e) {
      alert('[ChatGPT Export] ' + e.message);
    } finally {
      btn.innerHTML = html;
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      hideProgress();
    }
  }

  /* ── Inject Export button into ChatGPT header ──────────────────────────── */

  function createBtn(convId, gizmoId) {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'btn btn-ghost';
    btn.setAttribute('aria-label', 'Export');
    btn.innerHTML = `
      <div class="flex w-full items-center justify-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span class="max-md:hidden">Export</span>
      </div>
    `;

    btn.onclick = e => {
      e.stopPropagation();
      if (document.getElementById(MENU_ID)) { closeMenu(); return; }
      // Pass convId and gizmoId captured at injection time
      showMenu(btn, convId, gizmoId);
    };

    return btn;
  }

  // Find the best injection point in the ChatGPT header
  function findTarget() {
    // Preferred: conversation-header-actions (present on chat pages)
    const convActions = document.getElementById('conversation-header-actions');
    if (convActions) return convActions;

    // Fallback for project home page: right-side cluster in #page-header
    const header = document.getElementById('page-header');
    if (!header) return null;

    // The right side div contains Share / ... buttons
    const candidates = header.querySelectorAll('[class*="justify-end"], [class*="items-center"]');
    for (const el of candidates) {
      if (el.querySelector('button') && el !== header) return el;
    }
    return null;
  }

  function tryInject() {
    if (!isOnChatGPT()) return;
    if (document.getElementById(BTN_ID)) return;

    const convId  = getConvId();
    const gizmoId = getGizmoId();

    // Only inject when we have something to export
    if (!convId && !gizmoId) return;

    const target = findTarget();
    if (!target) return;

    target.insertBefore(createBtn(convId, gizmoId), target.firstChild);
  }

  /* ── SPA navigation (ChatGPT is a React SPA) ───────────────────────────── */

  let lastPath   = location.pathname;
  let debounce   = null;

  function onMutation() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const path = location.pathname;
      if (path !== lastPath) {
        lastPath = path;
        document.getElementById(BTN_ID)?.remove();
        closeMenu();
        exitSelectionMode();
        document.getElementById('cgx-proj-modal')?.remove();
      }
      tryInject();
    }, 300);
  }

  // Patch pushState so we catch programmatic navigation
  const _push = history.pushState.bind(history);
  history.pushState = (...args) => { _push(...args); onMutation(); };
  window.addEventListener('popstate', onMutation);

  // Watch DOM for header appearing after React renders
  new MutationObserver(onMutation)
    .observe(document.documentElement, { childList: true, subtree: true });

  // Initial attempt
  tryInject();
})();
