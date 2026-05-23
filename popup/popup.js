// Antigravity Mixer – Popup Controller
// Captures tab audio directly from popup context (valid user gesture).

// ─── DOM Cache ───────────────────────────────────────────────────────
const activeCountEl  = document.getElementById('active-count');
const audibleCountEl = document.getElementById('audible-count');
const channelsContainer = document.getElementById('channels-container');
const audibleList    = document.getElementById('audible-list');
const emptyState     = document.getElementById('empty-state');
const audibleEmpty   = document.getElementById('audible-empty');
const btnMuteAll     = document.getElementById('btn-mute-all');
const btnResetAll    = document.getElementById('btn-reset-all');
const statusToast    = document.getElementById('status-toast');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const btnSpacingToggle = document.getElementById('btn-spacing-toggle');
const toggleChannels = document.getElementById('toggle-channels');
const toggleAudible  = document.getElementById('toggle-audible');

// ─── State ───────────────────────────────────────────────────────────
let mixerState   = { channels: {}, audibleTabs: {} };
let meterInterval = null;
let toastTimer    = null;

// ─── Init ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialise settings
  await initSettings();

  // Initialise collapsible sections (collapsed by default)
  await initCollapsibleSections();

  // Load state and start visualizer
  await refreshState();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'session') await refreshState();
  });

  // Action listeners
  btnMuteAll.addEventListener('click', handleMuteAll);
  btnResetAll.addEventListener('click', handleResetAll);
  btnThemeToggle.addEventListener('click', toggleTheme);
  btnSpacingToggle.addEventListener('click', cycleSpacing);
  toggleChannels.addEventListener('click', () => toggleSection('channels'));
  toggleAudible.addEventListener('click', () => toggleSection('audible'));

  // Auto-capture the active tab on popup open
  attemptAutoCapture();

  startMetering();
});

// ─── Settings Management ─────────────────────────────────────────────
async function initSettings() {
  const data = await chrome.storage.local.get({ theme: 'dark', spacing: 'normal' });
  setTheme(data.theme);
  setSpacing(data.spacing);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const darkIcon = btnThemeToggle.querySelector('.theme-icon-dark');
  const lightIcon = btnThemeToggle.querySelector('.theme-icon-light');

  if (theme === 'light') {
    darkIcon.style.display = 'none';
    lightIcon.style.display = 'block';
  } else {
    darkIcon.style.display = 'block';
    lightIcon.style.display = 'none';
  }
}

async function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  await chrome.storage.local.set({ theme: newTheme });
  showToast(`Switched to ${newTheme} mode`, 'success');
}

function setSpacing(spacing) {
  document.documentElement.setAttribute('data-spacing', spacing);
  
  // Update button title
  const formattedName = spacing.charAt(0).toUpperCase() + spacing.slice(1);
  btnSpacingToggle.title = `Spacing Density: ${formattedName}`;

  // Toggle SVG visibility
  const iconComfy = btnSpacingToggle.querySelector('.spacing-icon-comfortable');
  const iconNormal = btnSpacingToggle.querySelector('.spacing-icon-normal');
  const iconCompact = btnSpacingToggle.querySelector('.spacing-icon-compact');

  if (iconComfy && iconNormal && iconCompact) {
    iconComfy.style.display = spacing === 'comfortable' ? 'block' : 'none';
    iconNormal.style.display = spacing === 'normal' ? 'block' : 'none';
    iconCompact.style.display = spacing === 'compact' ? 'block' : 'none';
  }
}

async function cycleSpacing() {
  const currentSpacing = document.documentElement.getAttribute('data-spacing') || 'normal';
  let newSpacing = 'normal';

  if (currentSpacing === 'comfortable') {
    newSpacing = 'normal';
  } else if (currentSpacing === 'normal') {
    newSpacing = 'compact';
  } else if (currentSpacing === 'compact') {
    newSpacing = 'comfortable';
  }

  setSpacing(newSpacing);
  await chrome.storage.local.set({ spacing: newSpacing });
  showToast(`Spacing set to ${newSpacing}`, 'success');
}

// ─── Collapsible Sections ────────────────────────────────────────────
async function initCollapsibleSections() {
  const data = await chrome.storage.local.get({
    sectionChannelsCollapsed: true,
    sectionAudibleCollapsed: true
  });

  applySectionState('channels', data.sectionChannelsCollapsed);
  applySectionState('audible', data.sectionAudibleCollapsed);
}

function applySectionState(section, isCollapsed) {
  const toggleBtn = section === 'channels' ? toggleChannels : toggleAudible;
  const content = section === 'channels' ? channelsContainer : audibleList;

  if (isCollapsed) {
    toggleBtn.classList.remove('expanded');
    content.classList.add('collapsed');
  } else {
    toggleBtn.classList.add('expanded');
    content.classList.remove('collapsed');
  }
}

async function toggleSection(section) {
  const toggleBtn = section === 'channels' ? toggleChannels : toggleAudible;
  const content = section === 'channels' ? channelsContainer : audibleList;
  const isCurrentlyCollapsed = content.classList.contains('collapsed');

  if (isCurrentlyCollapsed) {
    toggleBtn.classList.add('expanded');
    content.classList.remove('collapsed');
  } else {
    toggleBtn.classList.remove('expanded');
    content.classList.add('collapsed');
  }

  const storageKey = section === 'channels' ? 'sectionChannelsCollapsed' : 'sectionAudibleCollapsed';
  await chrome.storage.local.set({ [storageKey]: !isCurrentlyCollapsed });
}

// ─── Auto-Capture ────────────────────────────────────────────────────
function attemptAutoCapture() {
  // Query session state first to check if already captured
  chrome.storage.session.get({ channels: {} }, (sessionData) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) return;

      // Skip system tabs
      const url = activeTab.url || '';
      const isSystemUrl = url.startsWith('chrome://') ||
                          url.startsWith('chrome-extension://') ||
                          url.startsWith('edge://') ||
                          url.startsWith('about:') ||
                          url.startsWith('devtools://');
      if (isSystemUrl) return;

      // Skip if already captured
      if (sessionData.channels[activeTab.id]?.captured) {
        console.log('Active tab already captured.');
        return;
      }

      // Try capturing tab media stream using initial click gesture
      chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id }, (streamId) => {
        if (chrome.runtime.lastError) {
          console.warn('Auto-capture gesture check failed:', chrome.runtime.lastError.message);
          return;
        }

        chrome.runtime.sendMessage({
          type: 'CAPTURE_TAB',
          tabId: activeTab.id,
          streamId
        }, (response) => {
          if (response && response.success) {
            showToast(`Auto-captured active tab`, 'success');
            refreshState();
          }
        });
      });
    });
  });
}

// ─── Toast notifications ─────────────────────────────────────────────
function showToast(message, type = 'info', durationMs = 2500) {
  statusToast.textContent = message;
  statusToast.className = `status-toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    statusToast.classList.remove('show');
  }, durationMs);
}

// ─── State refresh ───────────────────────────────────────────────────
async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_MIXER_STATE' });
    if (state) {
      mixerState = state;
      renderUI();
    }
  } catch (err) {
    console.error('Failed to fetch mixer state:', err);
  }
}

// ─── Global actions ──────────────────────────────────────────────────
async function handleMuteAll() {
  const channelIds = Object.keys(mixerState.channels);
  if (channelIds.length === 0) return;

  const anyUnmuted = Object.values(mixerState.channels).some(ch => !ch.muted);

  for (const tabId of channelIds) {
    await chrome.runtime.sendMessage({
      type: 'SET_MUTE',
      tabId: parseInt(tabId, 10),
      muted: anyUnmuted
    });
  }
  showToast(anyUnmuted ? 'All channels muted' : 'All channels unmuted', 'info');
  await refreshState();
}

async function handleResetAll() {
  const channelIds = Object.keys(mixerState.channels);
  if (channelIds.length === 0) return;

  for (const tabId of channelIds) {
    await chrome.runtime.sendMessage({
      type: 'SET_GAIN',
      tabId: parseInt(tabId, 10),
      gain: 1.0
    });
  }
  showToast('All volumes reset to 100%', 'success');
  await refreshState();
}

// ─── Render ──────────────────────────────────────────────────────────
function renderUI() {
  renderActiveChannels();
  renderAudibleTabs();
}

function renderActiveChannels() {
  const channels = Object.values(mixerState.channels);
  activeCountEl.textContent = channels.length;

  if (channels.length === 0) {
    emptyState.style.display = 'flex';
    channelsContainer.querySelectorAll('.channel-strip').forEach(s => s.remove());
    return;
  }

  emptyState.style.display = 'none';

  const existingStrips = new Map();
  channelsContainer.querySelectorAll('.channel-strip').forEach(strip => {
    existingStrips.set(strip.dataset.tabId, strip);
  });

  channels.forEach(ch => {
    const tabIdStr = String(ch.tabId);
    let strip = existingStrips.get(tabIdStr);

    if (!strip) {
      strip = createChannelStrip(ch);
      channelsContainer.appendChild(strip);
    } else {
      updateChannelStrip(strip, ch);
    }
    existingStrips.delete(tabIdStr);
  });

  // Remove orphaned strips
  for (const [, strip] of existingStrips) {
    strip.remove();
  }
}

// ─── Channel Strip Builder ───────────────────────────────────────────
function createChannelStrip(ch) {
  const strip = document.createElement('div');
  strip.className = 'channel-strip';
  strip.dataset.tabId = ch.tabId;

  const domain = ch.url ? (() => { try { return new URL(ch.url).hostname; } catch { return 'Unknown'; } })() : 'Unknown';

  // LED bars (10 segments, top = 9/hot, bottom = 0/cool)
  let ledBarsHtml = '';
  for (let i = 9; i >= 0; i--) {
    let colorClass = 'active-green';
    if (i >= 8) colorClass = 'active-red';
    else if (i >= 6) colorClass = 'active-yellow';
    ledBarsHtml += `<div class="led-bar" data-index="${i}" data-color="${colorClass}"></div>`;
  }

  strip.innerHTML = `
    <div class="channel-left">
      <div class="favicon-wrapper btn-focus" title="Focus Tab">
        <img src="${ch.favIconUrl || '../icons/icon-16.svg'}" onerror="this.src='../icons/icon-16.svg'">
      </div>
      <div class="led-meter" id="led-meter-${ch.tabId}">
        ${ledBarsHtml}
      </div>
    </div>

    <div class="channel-middle">
      <div class="channel-title-container btn-focus" title="Focus Tab">
        <span class="channel-title" title="${ch.title}">${ch.title}</span>
        <span class="channel-domain">${domain}</span>
      </div>
      <div class="slider-container">
        <div class="volume-slider-wrapper">
          <input type="range" class="volume-slider" min="0" max="9.0" step="0.1" value="${ch.gain}">
        </div>
        <span class="volume-value">${Math.round(ch.gain * 100)}%</span>
      </div>
    </div>

    <div class="channel-right">
      <div class="eq-container">
        <div class="eq-band">
          <input type="range" class="eq-slider eq-bass" min="-12" max="12" step="1" value="${ch.eq?.bass || 0}" style="writing-mode: vertical-lr; direction: rtl;">
          <span class="eq-label">BASS</span>
        </div>
        <div class="eq-band">
          <input type="range" class="eq-slider eq-mid" min="-12" max="12" step="1" value="${ch.eq?.mid || 0}" style="writing-mode: vertical-lr; direction: rtl;">
          <span class="eq-label">MID</span>
        </div>
        <div class="eq-band">
          <input type="range" class="eq-slider eq-treble" min="-12" max="12" step="1" value="${ch.eq?.treble || 0}" style="writing-mode: vertical-lr; direction: rtl;">
          <span class="eq-label">TREB</span>
        </div>
      </div>
      <div class="control-toolbar">
        <select class="preset-select">
          <option value="normal" ${ch.preset === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="bass_boost" ${ch.preset === 'bass_boost' ? 'selected' : ''}>Bass Boost</option>
          <option value="voice_boost" ${ch.preset === 'voice_boost' ? 'selected' : ''}>Voice</option>
        </select>

        <button class="icon-btn btn-fs-fix ${ch.fullscreenFix ? 'active blue' : ''}" title="Fix Fullscreen Bug">
          <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
        </button>

        <button class="icon-btn btn-mute ${ch.muted ? 'active' : 'active green'}" title="Mute/Unmute">
          <svg viewBox="0 0 24 24" width="11" height="11">
            ${ch.muted
              ? '<path fill="currentColor" d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4l-2.12 2.12L12 8.24V4z"/>'
              : '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'
            }
          </svg>
        </button>

        <button class="icon-btn btn-release" title="Release Capture">
          <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </div>
  `;

  attachChannelListeners(strip, ch.tabId);
  return strip;
}

// ─── Update existing strip ───────────────────────────────────────────
function updateChannelStrip(strip, ch) {
  const volSlider = strip.querySelector('.volume-slider');
  const volValue  = strip.querySelector('.volume-value');

  if (parseFloat(volSlider.value) !== parseFloat(ch.gain)) {
    volSlider.value = ch.gain;
  }
  volValue.textContent = `${Math.round(ch.gain * 100)}%`;

  if (ch.gain > 1.0) {
    volSlider.classList.add('boosted');
    volValue.classList.add('boosted');
  } else {
    volSlider.classList.remove('boosted');
    volValue.classList.remove('boosted');
  }

  const bassSlider = strip.querySelector('.eq-bass');
  const midSlider  = strip.querySelector('.eq-mid');
  const trebSlider = strip.querySelector('.eq-treble');

  if (parseInt(bassSlider.value) !== (ch.eq?.bass || 0)) bassSlider.value = ch.eq?.bass || 0;
  if (parseInt(midSlider.value)  !== (ch.eq?.mid  || 0)) midSlider.value  = ch.eq?.mid  || 0;
  if (parseInt(trebSlider.value) !== (ch.eq?.treble || 0)) trebSlider.value = ch.eq?.treble || 0;

  const presetSel = strip.querySelector('.preset-select');
  if (presetSel.value !== ch.preset) presetSel.value = ch.preset;

  const fsBtn = strip.querySelector('.btn-fs-fix');
  fsBtn.className = `icon-btn btn-fs-fix${ch.fullscreenFix ? ' active blue' : ''}`;

  const muteBtn = strip.querySelector('.btn-mute');
  if (ch.muted) {
    muteBtn.className = 'icon-btn btn-mute active';
    muteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4l-2.12 2.12L12 8.24V4z"/></svg>';
  } else {
    muteBtn.className = 'icon-btn btn-mute active green';
    muteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  }
}

// ─── Channel strip event listeners ───────────────────────────────────
function attachChannelListeners(strip, tabId) {
  const focusTargets = strip.querySelectorAll('.btn-focus');
  const volSlider    = strip.querySelector('.volume-slider');
  const volValue     = strip.querySelector('.volume-value');
  const bassSlider   = strip.querySelector('.eq-bass');
  const midSlider    = strip.querySelector('.eq-mid');
  const trebSlider   = strip.querySelector('.eq-treble');
  const presetSel    = strip.querySelector('.preset-select');
  const fsBtn        = strip.querySelector('.btn-fs-fix');
  const muteBtn      = strip.querySelector('.btn-mute');
  const releaseBtn   = strip.querySelector('.btn-release');

  // Focus tab on click
  focusTargets.forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.update(tabId, { active: true });
    });
  });

  // Volume slider
  volSlider.addEventListener('input', async () => {
    const gain = parseFloat(volSlider.value);
    volValue.textContent = `${Math.round(gain * 100)}%`;

    if (gain > 1.0) {
      volSlider.classList.add('boosted');
      volValue.classList.add('boosted');
    } else {
      volSlider.classList.remove('boosted');
      volValue.classList.remove('boosted');
    }

    try {
      await chrome.runtime.sendMessage({ type: 'SET_GAIN', tabId, gain });
    } catch (e) {
      console.error('Failed to set gain:', e);
    }
  });

  // EQ sliders
  const handleEq = async () => {
    const eq = {
      bass:   parseInt(bassSlider.value, 10),
      mid:    parseInt(midSlider.value, 10),
      treble: parseInt(trebSlider.value, 10)
    };
    try {
      await chrome.runtime.sendMessage({ type: 'SET_EQ', tabId, eq });
    } catch (e) {
      console.error('Failed to set EQ:', e);
    }
  };
  bassSlider.addEventListener('input', handleEq);
  midSlider.addEventListener('input', handleEq);
  trebSlider.addEventListener('input', handleEq);

  // Preset
  presetSel.addEventListener('change', async () => {
    const preset = presetSel.value;
    let eq = { bass: 0, mid: 0, treble: 0 };
    if (preset === 'bass_boost') eq = { bass: 8, mid: 0, treble: -2 };
    else if (preset === 'voice_boost') eq = { bass: -4, mid: 6, treble: 4 };

    bassSlider.value = eq.bass;
    midSlider.value  = eq.mid;
    trebSlider.value = eq.treble;

    try {
      await chrome.runtime.sendMessage({ type: 'SET_PRESET', tabId, preset, eq });
    } catch (e) {
      console.error('Failed to set preset:', e);
    }
  });

  // Fullscreen fix
  fsBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'INJECT_FULLSCREEN_FIX', tabId });
      if (response && response.success) {
        fsBtn.className = 'icon-btn btn-fs-fix active blue';
        showToast('Fullscreen fix injected', 'success');
        await refreshState();
      }
    } catch (err) {
      console.error('Fullscreen fix failed:', err);
      showToast('Fullscreen fix failed', 'error');
    }
  });

  // Mute
  muteBtn.addEventListener('click', async () => {
    const isMuted = mixerState.channels[tabId]?.muted;
    try {
      await chrome.runtime.sendMessage({ type: 'SET_MUTE', tabId, muted: !isMuted });
      await refreshState();
    } catch (e) {
      console.error('Mute toggle failed:', e);
    }
  });

  // Release
  releaseBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RELEASE_TAB', tabId });
      if (response && response.success) {
        strip.remove();
        showToast('Channel released', 'info');
        await refreshState();
      }
    } catch (e) {
      console.error('Failed to release tab:', e);
    }
  });
}

// ─── Audible Tabs ────────────────────────────────────────────────────
function renderAudibleTabs() {
  const audible = Object.values(mixerState.audibleTabs).filter(
    tab => !mixerState.channels[tab.tabId]
  );

  audibleCountEl.textContent = audible.length;

  if (audible.length === 0) {
    audibleEmpty.style.display = 'flex';
    audibleList.innerHTML = '<div class="empty-state" id="audible-empty"><p class="empty-hint">No tabs playing audio</p></div>';
    return;
  }

  audibleList.innerHTML = '';

  audible.forEach(tab => {
    const item = document.createElement('div');
    item.className = 'audible-item';

    item.innerHTML = `
      <div class="audible-info">
        <img class="audible-favicon" src="${tab.favIconUrl || '../icons/icon-16.svg'}" onerror="this.src='../icons/icon-16.svg'">
        <span class="audible-title" title="${tab.title}">${tab.title}</span>
      </div>
      <button class="btn-capture" data-tab-id="${tab.tabId}">CAPTURE</button>
    `;

    item.querySelector('.btn-capture').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '...';
      btn.classList.add('capturing');

      try {
        const streamId = await new Promise((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId(
            { targetTabId: tab.tabId },
            (id) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(id);
              }
            }
          );
        });

        const response = await chrome.runtime.sendMessage({
          type: 'CAPTURE_TAB',
          tabId: tab.tabId,
          streamId
        });

        if (response && response.success) {
          showToast(`Captured "${tab.title}"`, 'success');
        } else {
          showToast('Capture failed', 'error');
        }

        await refreshState();
      } catch (err) {
        console.warn('Direct background capture blocked (activeTab constraint). Re-routing via switch-and-reopen:', err.message);
        
        // Notify background worker to switch tabs and programmatically reopen the popup on the new active tab.
        // Once the popup opens on the target tab, its onload auto-capture handler will capture it instantly.
        chrome.runtime.sendMessage({
          type: 'ACTIVATE_AND_REOPEN_POPUP',
          tabId: tab.tabId
        });
      }
    });

    audibleList.appendChild(item);
  });
}

// ─── VU Metering ─────────────────────────────────────────────────────
function startMetering() {
  if (meterInterval) clearInterval(meterInterval);

  meterInterval = setInterval(async () => {
    const channelIds = Object.keys(mixerState.channels);
    if (channelIds.length === 0) return;

    try {
      const levels = await chrome.runtime.sendMessage({ type: 'GET_LEVELS' });
      if (!levels) return;

      for (const [tabId, rmsVal] of Object.entries(levels)) {
        updateLedMeter(parseInt(tabId, 10), rmsVal);
      }
    } catch {
      // Ignore background communication errors
    }
  }, 100);
}

// Dynamically scale/color the LED columns based on volume level
function updateLedMeter(tabId, level) {
  const meterEl = document.getElementById(`led-meter-${tabId}`);
  if (!meterEl) return;

  const barCount = 10;
  const activeSegments = Math.round(level * barCount);

  meterEl.querySelectorAll('.led-bar').forEach(bar => {
    const idx   = parseInt(bar.dataset.index, 10);
    const color = bar.dataset.color;

    if (idx < activeSegments) {
      bar.classList.add(color);
      bar.style.opacity = '1';
    } else {
      bar.classList.remove('active-green', 'active-yellow', 'active-red');
      bar.style.opacity = '0.3';
    }
  });
}
