# ChatGPT Exporter

Export any ChatGPT conversation in one click. PDF, Markdown, plain text, CSV, JSON — all processed locally in your browser.

**[Official Website](http://vmste.org/chatgpt-exporter)** &nbsp;|&nbsp; **[Chrome Web Store](#)** &nbsp;|&nbsp; **[Report an Issue](https://github.com/VMSTE/chatgpt-exporter/issues)**

---

## Features

- **6 export formats** — Markdown, plain text, JSON, CSV, PDF (via native print dialog), and full HTML
- **Message selection** — pick individual messages with checkboxes and export only what you need
- **Project batch export** — select specific conversations within a ChatGPT project and download as ZIP
- **Deep Research support** — captures search queries, web results, and synthesis from ChatGPT's Deep Research mode
- **Text Docs & Canvas** — includes attached text documents and canvas content
- **100% local** — nothing leaves your browser. No external servers, no analytics, no tracking

## Export Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| Markdown | `.md` | Clean markdown with role labels and timestamps |
| Plain Text | `.txt` | Simple text, easy to read anywhere |
| JSON | `.json` | Full structured data (roles, timestamps, metadata) |
| CSV | `.csv` | Spreadsheet-ready with `timestamp, role, content` columns |
| PDF | `.pdf` | Professional print-ready document via browser print dialog |
| ZIP | `.zip` | Batch export of multiple conversations from a project |

## Install

### Chrome Web Store

Install from the [Chrome Web Store](#) (link available after review).

Works on all Chromium-based browsers: **Chrome, Brave, Edge, Arc, Opera**.

### Manual install (developer mode)

1. Download or clone this repo
2. Open `chrome://extensions` in your browser
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Open any ChatGPT conversation — the export button appears in the header

## How It Works

The extension injects a minimal export button into the ChatGPT interface. When you click it, a dropdown menu lets you choose the export format. The extension reads conversation data from ChatGPT's internal API using your existing session — no API keys needed.

### Single conversation

Open a conversation → click the export button → pick a format → file downloads instantly.

### Select specific messages

Open a conversation → click **Select messages…** → check the messages you want → choose format from the floating toolbar → export.

### Batch export from a project

Navigate to a ChatGPT project page → click the export button → choose **Select conversations…** → pick which conversations to include → export as ZIP.

## Project Structure

```
manifest.json      Chrome extension manifest (Manifest V3)
background.js      Service worker (install/uninstall hooks)
content.js         Main logic — injected into ChatGPT pages
popup.html         Extension popup UI
popup.js           Popup logic
assets/            Extension icons (16, 32, 48, 128px)
```

Everything runs in a single content script (`content.js`) with zero external dependencies.

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access the current ChatGPT tab to read conversation data |
| `scripting` | Inject the export button into the ChatGPT interface |
| `tabs` | Open the welcome page on first install |
| `host_permissions` (chatgpt.com, chat.openai.com) | Access ChatGPT's internal API to fetch conversation data |

## Privacy

- No data is collected or transmitted
- No analytics, telemetry, or tracking
- No external API calls — everything is processed in-browser
- Conversations are read directly from ChatGPT's API using your existing session
- Source code is fully open for review

## License

MIT

## Contributing

Issues and pull requests are welcome at [github.com/VMSTE/chatgpt-exporter](https://github.com/VMSTE/chatgpt-exporter).
