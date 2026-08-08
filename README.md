# 🛡️ popOUT - Smart Popup Window Blocker for Google Chrome

![popOUT Banner](assets/icon128.png)

**popOUT** is a modern, ultra-lightweight, and privacy-focused Chrome Extension (Manifest V3) built to automatically intercept and block unwanted pop-up windows, pop-unders, and automatic script redirections — while providing seamless site whitelist management and tab recovery options.

---

## ✨ Features

- **⚡ Main World Interception**: Safely overrides `window.open` directly in the page execution context at `document_start` to intercept unauthorized popup attempts without breaking core website functionality.
- **🛡️ Custom Domain Whitelisting**: Instantly toggle protection on/off globally or whitelist specific trusted domains directly from the control dashboard.
- **📊 Real-time Badge & Statistics**: Track blocked popups per active tab with a live badge counter on the extension icon and track lifetime blocked count totals.
- **🔄 Tab Popup Recovery**: View a list of intercepted popup URLs on the current tab and open them safely with a single click if needed.
- **🎨 Glassmorphism Dark UI**: Designed according to modern aesthetic standards with smooth CSS transitions, custom typography (*Plus Jakarta Sans*), clean status rings, and dark glassmorphic cards.

---

## 📁 Project Architecture

```
popOUT/
├── manifest.json              # Extension Manifest V3 metadata & permissions
├── background/
│   └── service_worker.js      # Background service worker managing tab states & badge counts
├── content/
│   ├── injected.js            # Main world script intercepting window.open calls
│   └── content.js             # Isolated content script bridging page events to background
├── popup/
│   ├── popup.html             # Extension dashboard layout
│   ├── popup.css              # Glassmorphic dark design system & typography
│   └── popup.js               # Control panel UI logic & Chrome API event handlers
├── assets/
│   ├── icon16.png             # 16x16 Extension Icon
│   ├── icon48.png             # 48x48 Extension Icon
│   └── icon128.png            # 128x128 Extension Icon
└── README.md                  # Project documentation
```

---

## 🛠️ Installation & Testing Guide

1. Clone or download this repository to your local computer.
2. Open **Google Chrome** and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click **Load unpacked** (Paketlenmemiş öge yükle).
5. Select the `popOUT` project directory.

### How to Verify:
1. Navigate to any website (e.g., `https://example.com`).
2. Open Chrome Developer Console (`F12` or `Ctrl+Shift+I`).
3. Execute `window.open("https://google.com")` in the console.
4. Observe that the popup window is blocked, the extension badge increments, and opening the popOUT icon dashboard allows you to view or open the blocked URL.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
