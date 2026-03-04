# Chrome Web Store Listing

## Name
ChatGPT Exporter — Export Conversations to PDF, Markdown & More

## Short Description (132 chars max)
Export ChatGPT conversations as PDF, Markdown, Text, CSV, JSON. Free, open-source, 100% local.

## Detailed Description

Export any ChatGPT conversation in one click.

SUPPORTED FORMATS:
• Markdown (.md) — clean, readable format for notes and documentation
• Plain Text (.txt) — simple text, opens anywhere
• JSON (.json) — structured data with roles, timestamps, and metadata
• CSV (.csv) — spreadsheet-ready, opens in Excel and Google Sheets
• PDF (.pdf) — professional print-ready document via native print dialog
• ZIP (.zip) — batch export multiple conversations from a project

KEY FEATURES:
• Message selection — pick specific messages with checkboxes and export only what you need
• Project batch export — select conversations within a ChatGPT project, download as a single ZIP
• Deep Research — captures search queries, web results, and synthesis from ChatGPT Deep Research mode
• Text Docs & Canvas — includes attached documents and canvas content

PRIVACY:
• 100% local — all processing happens in your browser
• No data sent to external servers
• No analytics, telemetry, or tracking
• Open-source — full code available on GitHub

HOW TO USE:
1. Open any ChatGPT conversation
2. Click the export button in the conversation header
3. Choose your format — the file downloads instantly

For selective export, click "Select messages…" to check individual messages before exporting.

For project batch export, navigate to a project page and click "Select conversations…" to pick which conversations to include.

Works on chatgpt.com and chat.openai.com.

Website: http://vmste.org/chatgpt-exporter
Source: https://github.com/VMSTE/chatgpt-exporter

---

## Category
Productivity

## Language
English

## Website
http://vmste.org/chatgpt-exporter

## Privacy Policy
Not required (no data collection)

Single Purpose Description:
This extension exports ChatGPT conversations to various file formats (PDF, Markdown, Text, CSV, JSON).

---

## Permission Justifications

### activeTab
Required to access the current ChatGPT tab and read conversation content for export. The extension only activates on chatgpt.com and chat.openai.com.

### scripting
Required to inject the export button UI into the ChatGPT page interface. The button appears in the conversation header and provides the export menu.

### tabs
Required to open the welcome page (vmste.org/chatgpt-exporter) when the extension is first installed. Not used for any other purpose.

### Host permissions (chatgpt.com, chat.openai.com)
Required to access ChatGPT's internal conversation API to fetch conversation data (messages, metadata, timestamps) for export. The extension uses the user's existing authenticated session — no external API keys or authentication is needed.

---

## Required Assets

### Icon
✅ 128x128 — assets/icon128.png (already included)

### Screenshots (1280x800 or 640x400)
You need to create at least 1 screenshot (recommended 3-5):

1. **Export menu** — showing the dropdown with all format options on a ChatGPT conversation
2. **Message selection** — showing checkboxes on messages with the floating toolbar
3. **Project batch export** — showing the conversation selection modal
4. **PDF output** — showing the clean, professional PDF result
5. **Popup** — showing the extension popup with conversation info

### Promotional tiles (optional)
- Small promo tile: 440x280
- Large promo tile: 920x680
