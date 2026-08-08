# 🛡️ popOUT - Smart Popup & Overlay Blocker for Google Chrome

![popOUT Banner](assets/icon128.png)

**popOUT** is a modern, ultra-lightweight, and privacy-focused Chrome Extension (Manifest V3) built to automatically intercept and block unwanted pop-up windows, pop-unders, automatic script redirections, intrusive **Cookie / GDPR Consent Modal Overlays**, and provide one-click **Site Consent & Cookie Wipe capabilities**.

---

## ✨ Features

- **⚡ Main World Interception**: Safely overrides `window.open` directly in the page execution context at `document_start` to intercept unauthorized popup attempts without breaking core website functionality.
- **🍪 Auto Cookie & GDPR Overlay Blocker**: Features a dynamic `MutationObserver` engine that detects and automatically removes screen-blocking cookie consent dialogs, GDPR banners (Google FC, OneTrust, Didomi, Quantcast, etc.), and modal backdrops while restoring locked scrollbars.
- **🧹 Reset Stored Site Consents & Cookies**: One-click action in the popup dashboard to completely wipe stored Cookies, LocalStorage, IndexedDB, and past GDPR consent choices for the active website, automatically reloading the page.
- **🛡️ Custom Domain Whitelisting**: Instantly toggle protection on/off globally or whitelist specific trusted domains directly from the control dashboard.
- **📊 Real-time Badge & Statistics**: Track blocked popups per active tab with a live badge counter on the extension icon and track lifetime blocked count totals.
- **🔄 Tab Popup Recovery**: View a list of intercepted popup URLs on the current tab and open them safely with a single click if needed.
- **🎨 Glassmorphism Dark UI**: Designed according to modern aesthetic standards with smooth CSS transitions, custom typography (*Plus Jakarta Sans*), clean status rings, and dark glassmorphic cards.

---

## 📁 Project Architecture

```
popOUT/
├── manifest.json              # Extension Manifest V3 metadata & permissions (browsingData, cookies, storage)
├── background/
│   └── service_worker.js      # Background service worker managing tab states, badges & site data wiping
├── content/
│   ├── injected.js            # Main world script intercepting window.open calls
│   └── content.js             # Isolated content script with dynamic Overlay & Cookie Blocker
├── popup/
│   ├── popup.html             # Extension dashboard layout (Includes Consent Reset & Overlay Toggle)
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
1. **Popup Window Blocking**: Open `https://example.com`, open Console (`F12`), and run `window.open("https://google.com")`. The popup will be intercepted and listed in the extension popup dashboard.
2. **Cookie & Overlay Blocking**: Visit sites with invasive consent dialogs (such as news portals like Ensonhaber, etc.). The overlay dialog will be automatically hidden, restoring body scroll.
3. **Reset Stored Site Consents**: Click **"Reset Stored Site Consents & Cookies"** in the popup panel. All stored consent preferences for that origin will be wiped, and the page will refresh automatically.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
