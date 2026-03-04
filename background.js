chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'http://vmste.org/chatgpt-exporter' });
  }
});

chrome.runtime.setUninstallURL('https://github.com/VMSTE/chatgpt-exporter/issues');
