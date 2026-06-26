// Aura — background service worker (Manifest V3)
//
// Responsibilities:
//   1. Handle the "quick-save" keyboard command (Ctrl/Cmd+Shift+Y) by saving the
//      active tab into a pending-saves queue that the New Tab dashboard drains.
//   2. Answer FETCH_METADATA messages from the dashboard by fetching a page and
//      extracting its Open Graph / Twitter / <title> metadata.
//
// Note: MV3 service workers have no DOM, so `DOMParser` is unavailable here.
// Metadata is therefore extracted with regex over the raw HTML.

const QUICK_SAVE = "QUICK_SAVE";
const FETCH_METADATA = "FETCH_METADATA";

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "quick-save") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith("chrome://")) return;

  const payload = {
    url: tab.url,
    title: tab.title || tab.url,
    favicon: tab.favIconUrl || "",
    timestamp: Date.now(),
  };

  // Persist so the dashboard picks it up even if no New Tab is open right now.
  const { pendingSaves = [] } = await chrome.storage.local.get("pendingSaves");
  pendingSaves.push(payload);
  await chrome.storage.local.set({ pendingSaves });

  // Best-effort live notify; ignore "no receiver" errors.
  chrome.runtime.sendMessage({ type: QUICK_SAVE, payload }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === FETCH_METADATA) {
    fetchMetadata(message.url)
      .then(sendResponse)
      .catch(() => sendResponse({ error: true }));
    return true; // keep the message channel open for the async response
  }
});

// Pull the `content` attribute out of a <meta> tag matched by a property/name
// selector, regardless of attribute order.
function metaContent(html, attr, value) {
  const tag = new RegExp(`<meta[^>]*\\b${attr}=["']${value}["'][^>]*>`, "i");
  const match = html.match(tag);
  if (!match) return null;
  const content = match[0].match(/\bcontent=["']([^"']*)["']/i);
  return content ? decodeEntities(content[1].trim()) : null;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'");
}

async function fetchMetadata(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const html = await res.text();

    const ogImage =
      metaContent(html, "property", "og:image") ||
      metaContent(html, "name", "twitter:image") ||
      null;

    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const ogTitle =
      metaContent(html, "property", "og:title") ||
      (titleTag ? decodeEntities(titleTag[1].trim()) : null);

    const ogDesc =
      metaContent(html, "property", "og:description") ||
      metaContent(html, "name", "description") ||
      null;

    return { ogImage, ogTitle, ogDesc };
  } catch {
    return { ogImage: null, ogTitle: null, ogDesc: null };
  }
}
