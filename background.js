chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://vmste.org/chatgpt-exporter' });
  }
});

chrome.runtime.setUninstallURL('https://github.com/VMSTE/chatgpt-exporter/issues');
