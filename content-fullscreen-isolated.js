// ISOLATED World Bridge Content Script
// Bridges communication between page (MAIN world) and extension (service worker)

(function () {
  if (window.__antigravity_fs_isolated_injected) return;
  window.__antigravity_fs_isolated_injected = true;

  console.log('[Antigravity] Isolated bridge script injected.');

  // Listen to messages from the page (MAIN world)
  window.addEventListener('message', async (event) => {
    // Only accept messages from our own page/frame
    if (event.source !== window) return;

    if (event.data && event.data.type === 'ANTIGRAVITY_FS_ENTER') {
      console.log('[Antigravity Bridge] ENTER message received from MAIN world.');
      try {
        await chrome.runtime.sendMessage({ type: 'FULLSCREEN_ENTER' });
      } catch (err) {
        console.error('Failed to send FULLSCREEN_ENTER:', err);
      }
    } 
    
    else if (event.data && event.data.type === 'ANTIGRAVITY_FS_EXIT') {
      console.log('[Antigravity Bridge] EXIT message received from MAIN world.');
      try {
        await chrome.runtime.sendMessage({ type: 'FULLSCREEN_EXIT' });
      } catch (err) {
        console.error('Failed to send FULLSCREEN_EXIT:', err);
      }
    }
  });

  // Listen to messages from the service worker
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FORCE_EXIT_FULLSCREEN') {
      console.log('[Antigravity Bridge] FORCE_EXIT_FULLSCREEN received from background.');
      window.postMessage({ type: 'ANTIGRAVITY_FS_EXIT_FORCED' }, '*');
      sendResponse({ success: true });
    }
  });

  // Detect browser/window fullscreen changes (e.g. exit via OS buttons)
  let lastState = false;
  window.addEventListener('resize', () => {
    const isBrowserFullscreen = window.innerWidth === window.screen.width && 
                                window.innerHeight === window.screen.height;
    
    if (lastState && !isBrowserFullscreen) {
      console.log('[Antigravity Bridge] Detected OS-level fullscreen exit via window resize.');
      window.postMessage({ type: 'ANTIGRAVITY_FS_EXIT_FORCED' }, '*');
      chrome.runtime.sendMessage({ type: 'FULLSCREEN_EXIT' }).catch(() => {});
    }
    lastState = isBrowserFullscreen;
  });

})();
