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
  // Slack-only: read the right-clicked message aloud (no selection needed).
  // slack.js remembers the right-clicked message and plays it inline.
  chrome.contextMenus.create({
    id: "read-slack-message",
    title: "Read message out loud",
    contexts: ["page"],
    documentUrlPatterns: ["*://app.slack.com/*"],
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
  } else if (info.menuItemId === "read-slack-message" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "SLACK_PLAY_LAST" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TEXT_SELECTED" || message.type === "PLAY_TEXT") {
    chrome.runtime.sendMessage(message).catch(() => {});
  }
});
