// Content script - detects text selection and sends to sidepanel

let debounceTimer = null;
let lastSelectedText = "";

document.addEventListener("mouseup", handleSelection);
document.addEventListener("keyup", handleSelection);

function handleSelection() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const text = window.getSelection().toString().trim();
    if (text && text !== lastSelectedText) {
      lastSelectedText = text;
      sendTextToExtension(text);
    }
  }, 200);
}

function sendTextToExtension(text) {
  try {
    chrome.runtime.sendMessage({ type: "TEXT_SELECTED", text });
  } catch (e) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SELECTION") {
    sendResponse({ text: window.getSelection().toString().trim() });
  }
  return true;
});

document.addEventListener("mousedown", () => {
  if (window.getSelection().toString().trim() === "") {
    lastSelectedText = "";
  }
});
