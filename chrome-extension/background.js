// Background service worker - handles sidepanel and context menu

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Failed to set panel behavior:", error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-selection",
    title: "Read out loud",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-selection" && info.selectionText) {
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "PLAY_TEXT",
          text: info.selectionText,
        });
      }, 500);
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TEXT_SELECTED" || message.type === "PLAY_TEXT") {
    chrome.runtime.sendMessage(message).catch(() => {});
  }
});
