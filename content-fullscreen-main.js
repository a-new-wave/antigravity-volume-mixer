// MAIN World Fullscreen Override Content Script
// Intercepts requestFullscreen calls and simulates standard fullscreen behavior

(function () {
  if (window.__antigravity_fs_injected) return;
  window.__antigravity_fs_injected = true;

  console.log('[Antigravity] Injecting pseudo-fullscreen overrides.');

  let activeFsElement = null;

  // Custom event dispatcher
  function dispatchFsEvent(element) {
    const event = new Event('fullscreenchange', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    document.dispatchEvent(event);
  }

  // Override Element.prototype.requestFullscreen
  const originalRequestFullscreen = Element.prototype.requestFullscreen ||
                                    Element.prototype.webkitRequestFullscreen ||
                                    Element.prototype.mozRequestFullScreen ||
                                    Element.prototype.msRequestFullscreen;

  async function customRequestFullscreen() {
    const element = this;
    console.log('[Antigravity] Intercepted requestFullscreen on', element.tagName);
    
    // Add special viewport scaling classes
    element.classList.add('antigravity-pseudo-fullscreen');
    activeFsElement = element;

    // Send entering message to isolated content script
    window.postMessage({
      type: 'ANTIGRAVITY_FS_ENTER',
      tagName: element.tagName,
      id: element.id,
      className: element.className
    }, '*');

    dispatchFsEvent(element);
    return Promise.resolve();
  }

  if (Element.prototype.requestFullscreen) Element.prototype.requestFullscreen = customRequestFullscreen;
  if (Element.prototype.webkitRequestFullscreen) Element.prototype.webkitRequestFullscreen = customRequestFullscreen;
  if (Element.prototype.mozRequestFullScreen) Element.prototype.mozRequestFullScreen = customRequestFullscreen;
  if (Element.prototype.msRequestFullscreen) Element.prototype.msRequestFullscreen = customRequestFullscreen;

  // Override Document.prototype.exitFullscreen
  const originalExitFullscreen = document.exitFullscreen ||
                                 document.webkitExitFullscreen ||
                                 document.mozCancelFullScreen ||
                                 document.msExitFullscreen;

  async function customExitFullscreen() {
    console.log('[Antigravity] Intercepted exitFullscreen');
    
    if (activeFsElement) {
      const element = activeFsElement;
      element.classList.remove('antigravity-pseudo-fullscreen');
      activeFsElement = null;
      
      // Send exit message to isolated content script
      window.postMessage({ type: 'ANTIGRAVITY_FS_EXIT' }, '*');
      
      dispatchFsEvent(element);
    }
    return Promise.resolve();
  }

  if (document.exitFullscreen) document.exitFullscreen = customExitFullscreen;
  if (document.webkitExitFullscreen) document.webkitExitFullscreen = customExitFullscreen;
  if (document.mozCancelFullScreen) document.mozCancelFullScreen = customExitFullscreen;
  if (document.msExitFullscreen) document.msExitFullscreen = customExitFullscreen;

  // Override getters for fullscreen elements
  Object.defineProperties(document, {
    fullscreenElement: {
      get: () => activeFsElement,
      configurable: true
    },
    webkitFullscreenElement: {
      get: () => activeFsElement,
      configurable: true
    },
    mozFullScreenElement: {
      get: () => activeFsElement,
      configurable: true
    },
    msFullscreenElement: {
      get: () => activeFsElement,
      configurable: true
    },
    fullscreenEnabled: {
      get: () => true,
      configurable: true
    },
    webkitFullscreenEnabled: {
      get: () => true,
      configurable: true
    }
  });

  // Handle Escape key to exit pseudo-fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeFsElement) {
      console.log('[Antigravity] Escape key pressed, exiting pseudo-fullscreen.');
      document.exitFullscreen();
    }
  }, true);

  // Handle external exit triggers (e.g. from service worker exiting OS fullscreen mode)
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'ANTIGRAVITY_FS_EXIT_FORCED') {
      console.log('[Antigravity] Forced exit from pseudo-fullscreen.');
      if (activeFsElement) {
        const element = activeFsElement;
        element.classList.remove('antigravity-pseudo-fullscreen');
        activeFsElement = null;
        dispatchFsEvent(element);
      }
    }
  });

})();
