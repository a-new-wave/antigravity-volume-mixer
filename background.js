// Antigravity Mixer – Background Service Worker
// All listeners are registered synchronously at top level.

// ─── Initialise storage on installation ─────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.set({
    channels: {},
    audibleTabs: {}
  });
  console.log('Antigravity Mixer installed — session state initialised.');
});

// ─── Helpers ─────────────────────────────────────────────────────────

async function getMixerState() {
  const data = await chrome.storage.session.get({ channels: {}, audibleTabs: {} });
  return data;
}

async function saveChannel(tabId, channelData) {
  const state = await getMixerState();
  state.channels[tabId] = {
    ...(state.channels[tabId] || {}),
    ...channelData,
    tabId: parseInt(tabId, 10)
  };
  await chrome.storage.session.set(state);
  return state;
}

async function removeChannel(tabId) {
  const state = await getMixerState();
  delete state.channels[tabId];
  await chrome.storage.session.set(state);
  return state;
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture and process tab audio for real-time mixing and equalization.'
  });
}

// ─── Tab lifecycle ───────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const state = await getMixerState();
    if (state.channels[tabId]) {
      console.log(`Tab ${tabId} closed. Cleaning up capture.`);
      if (state.channels[tabId].captured) {
        await ensureOffscreen();
        await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId });
      }
      await removeChannel(tabId);
    }
    if (state.audibleTabs[tabId]) {
      delete state.audibleTabs[tabId];
      await chrome.storage.session.set(state);
    }
  } catch (err) {
    console.error('Error handling tab removal:', err);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    const state = await getMixerState();
    let updated = false;

    // Track audible status (excluding system URLs)
    if (changeInfo.audible !== undefined) {
      const isSystemUrl = tab.url && (
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('devtools://')
      );

      if (changeInfo.audible && !isSystemUrl) {
        state.audibleTabs[tabId] = {
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl
        };
      } else {
        delete state.audibleTabs[tabId];
      }
      updated = true;
    }

    // Handle tab title/icon updates for active channels
    if (state.channels[tabId]) {
      if (changeInfo.title) {
        state.channels[tabId].title = changeInfo.title;
        updated = true;
      }
      if (changeInfo.favIconUrl) {
        state.channels[tabId].favIconUrl = changeInfo.favIconUrl;
        updated = true;
      }

      // Navigation kills the media stream — mark uncaptured
      if (changeInfo.status === 'loading') {
        console.log(`Tab ${tabId} reloaded/navigated. Releasing capture state.`);
        if (state.channels[tabId].captured) {
          try {
            await ensureOffscreen();
            await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId });
          } catch (e) {
            console.warn('Could not notify offscreen on reload:', e);
          }
          state.channels[tabId].captured = false;
          updated = true;
        }
      }
    }

    if (updated) {
      await chrome.storage.session.set(state);
    }
  } catch (err) {
    console.error('Error in onUpdated handler:', err);
  }
});

// ─── Keyboard shortcuts ──────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;

    const state = await getMixerState();
    const channel = state.channels[activeTab.id];
    if (!channel || !channel.captured) return;

    if (command === 'volume_up_active') {
      const newGain = Math.min(channel.gain + 0.1, 9.0);
      await saveChannel(activeTab.id, { gain: newGain });
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ type: 'SET_GAIN', tabId: activeTab.id, gain: newGain });
    } else if (command === 'volume_down_active') {
      const newGain = Math.max(channel.gain - 0.1, 0.0);
      await saveChannel(activeTab.id, { gain: newGain });
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ type: 'SET_GAIN', tabId: activeTab.id, gain: newGain });
    } else if (command === 'mute_toggle_active') {
      const newMute = !channel.muted;
      await saveChannel(activeTab.id, { muted: newMute });
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ type: 'SET_MUTE', tabId: activeTab.id, muted: newMute });
    }
  } catch (err) {
    console.error('Error handling keyboard command:', err);
  }
});

// ─── Main message router ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'GET_MIXER_STATE': {
          const state = await getMixerState();
          sendResponse(state);
          break;
        }

        case 'ACTIVATE_AND_REOPEN_POPUP': {
          const { tabId } = msg;
          chrome.tabs.update(tabId, { active: true }, () => {
            setTimeout(() => {
              chrome.action.openPopup().catch((err) => {
                console.warn('Failed to programmatically open popup:', err);
              });
            }, 200);
          });
          sendResponse({ success: true });
          break;
        }

        case 'CAPTURE_TAB': {
          // Called from popup which already obtained streamId via user gesture
          const { tabId, streamId } = msg;
          console.log(`Starting capture for tab ${tabId}`);
          await ensureOffscreen();
          const response = await chrome.runtime.sendMessage({
            type: 'START_CAPTURE',
            streamId,
            tabId
          });

          if (response && response.success) {
            // Get fresh tab info
            let tab;
            try {
              tab = await chrome.tabs.get(tabId);
            } catch {
              tab = { title: 'Unknown', url: '', favIconUrl: '' };
            }

            await saveChannel(tabId, {
              title: tab.title,
              url: tab.url,
              favIconUrl: tab.favIconUrl,
              gain: 1.0,
              muted: false,
              eq: { bass: 0, mid: 0, treble: 0 },
              preset: 'normal',
              captured: true,
              fullscreenFix: false
            });
          }
          sendResponse({ success: true });
          break;
        }

        case 'RELEASE_TAB': {
          const { tabId } = msg;
          console.log(`Releasing capture for tab ${tabId}`);
          await ensureOffscreen();
          await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId });
          const updatedState = await removeChannel(tabId);
          sendResponse({ success: true, state: updatedState });
          break;
        }

        case 'SET_GAIN': {
          const { tabId, gain } = msg;
          await saveChannel(tabId, { gain });
          await ensureOffscreen();
          await chrome.runtime.sendMessage({ type: 'SET_GAIN', tabId, gain });
          sendResponse({ success: true });
          break;
        }

        case 'SET_EQ': {
          const { tabId, eq } = msg;
          await saveChannel(tabId, { eq });
          await ensureOffscreen();
          await chrome.runtime.sendMessage({ type: 'SET_EQ', tabId, eq });
          sendResponse({ success: true });
          break;
        }

        case 'SET_PRESET': {
          const { tabId, preset, eq } = msg;
          await saveChannel(tabId, { preset, eq });
          await ensureOffscreen();
          await chrome.runtime.sendMessage({ type: 'SET_PRESET', tabId, preset });
          sendResponse({ success: true });
          break;
        }

        case 'SET_MUTE': {
          const { tabId, muted } = msg;
          await saveChannel(tabId, { muted });
          await ensureOffscreen();
          await chrome.runtime.sendMessage({ type: 'SET_MUTE', tabId, muted });
          sendResponse({ success: true });
          break;
        }

        case 'GET_LEVELS': {
          await ensureOffscreen();
          const levels = await chrome.runtime.sendMessage({ type: 'GET_LEVELS' });
          sendResponse(levels);
          break;
        }

        case 'INJECT_FULLSCREEN_FIX': {
          const { tabId } = msg;
          console.log(`Injecting fullscreen fix into tab ${tabId}`);

          await chrome.scripting.insertCSS({
            target: { tabId },
            files: ['content-fullscreen.css']
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-fullscreen-isolated.js']
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: ['content-fullscreen-main.js']
          });

          await saveChannel(tabId, { fullscreenFix: true });
          sendResponse({ success: true });
          break;
        }

        case 'FULLSCREEN_ENTER': {
          if (sender.tab) {
            await chrome.windows.update(sender.tab.windowId, { state: 'fullscreen' });
          }
          sendResponse({ success: true });
          break;
        }

        case 'FULLSCREEN_EXIT': {
          if (sender.tab) {
            await chrome.windows.update(sender.tab.windowId, { state: 'normal' });
          }
          sendResponse({ success: true });
          break;
        }

        default:
          break;
      }
    } catch (error) {
      console.error('Error handling message in service worker:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open for async response
});
