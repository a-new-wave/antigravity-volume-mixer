// Offscreen Audio Engine for Antigravity Mixer
const captures = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'START_CAPTURE') {
        const { streamId, tabId } = msg;
        console.log(`[Offscreen] START_CAPTURE for tab ${tabId}`);

        if (captures.has(tabId)) {
          // Release existing capture before starting a new one
          await stopCapture(tabId);
        }

        // Capture stream using getUserMedia
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId
            }
          },
          video: false
        });

        // Initialize AudioContext
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);

        // Bass Filter (Lowshelf @ 200Hz)
        const bassFilter = audioCtx.createBiquadFilter();
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 200;
        bassFilter.gain.value = 0;

        // Mid Filter (Peaking @ 1000Hz)
        const midFilter = audioCtx.createBiquadFilter();
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1000;
        midFilter.Q.value = 1.0;
        midFilter.gain.value = 0;

        // Treble Filter (Highshelf @ 3000Hz)
        const trebleFilter = audioCtx.createBiquadFilter();
        trebleFilter.type = 'highshelf';
        trebleFilter.frequency.value = 3000;
        trebleFilter.gain.value = 0;

        // Gain Node
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;

        // Analyser Node for visual metering
        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;

        // Assemble the Web Audio graph
        source.connect(bassFilter);
        bassFilter.connect(midFilter);
        midFilter.connect(trebleFilter);
        trebleFilter.connect(gainNode);
        gainNode.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);

        // Store capture reference
        captures.set(tabId, {
          stream,
          audioCtx,
          source,
          bassFilter,
          midFilter,
          trebleFilter,
          gainNode,
          analyserNode,
          gainVal: 1.0,
          muted: false
        });

        sendResponse({ success: true });
      } 
      
      else if (msg.type === 'STOP_CAPTURE') {
        const { tabId } = msg;
        console.log(`[Offscreen] STOP_CAPTURE for tab ${tabId}`);
        await stopCapture(tabId);
        sendResponse({ success: true });
      } 
      
      else if (msg.type === 'SET_GAIN') {
        const { tabId, gain } = msg;
        const cap = captures.get(tabId);
        if (cap) {
          cap.gainVal = gain;
          if (!cap.muted) {
            cap.gainNode.gain.setTargetAtTime(gain, cap.audioCtx.currentTime, 0.01);
          }
        }
        sendResponse({ success: true });
      } 
      
      else if (msg.type === 'SET_EQ') {
        const { tabId, eq } = msg;
        const cap = captures.get(tabId);
        if (cap && eq) {
          cap.bassFilter.gain.setTargetAtTime(eq.bass, cap.audioCtx.currentTime, 0.01);
          cap.midFilter.gain.setTargetAtTime(eq.mid, cap.audioCtx.currentTime, 0.01);
          cap.trebleFilter.gain.setTargetAtTime(eq.treble, cap.audioCtx.currentTime, 0.01);
        }
        sendResponse({ success: true });
      } 
      
      else if (msg.type === 'SET_PRESET') {
        const { tabId, preset } = msg;
        const cap = captures.get(tabId);
        if (cap) {
          let bass = 0, mid = 0, treble = 0;
          if (preset === 'bass_boost') {
            bass = 8; mid = 0; treble = -2;
          } else if (preset === 'voice_boost') {
            bass = -4; mid = 6; treble = 4;
          }
          cap.bassFilter.gain.setTargetAtTime(bass, cap.audioCtx.currentTime, 0.01);
          cap.midFilter.gain.setTargetAtTime(mid, cap.audioCtx.currentTime, 0.01);
          cap.trebleFilter.gain.setTargetAtTime(treble, cap.audioCtx.currentTime, 0.01);
        }
        sendResponse({ success: true });
      } 
      
      else if (msg.type === 'SET_MUTE') {
        const { tabId, muted } = msg;
        const cap = captures.get(tabId);
        if (cap) {
          cap.muted = muted;
          const targetGain = muted ? 0.0 : cap.gainVal;
          cap.gainNode.gain.setTargetAtTime(targetGain, cap.audioCtx.currentTime, 0.01);
        }
        sendResponse({ success: true });
      } 
      
      else if (msg.type === 'GET_LEVELS') {
        const levels = {};
        for (const [tabId, cap] of captures.entries()) {
          if (cap.muted) {
            levels[tabId] = 0;
            continue;
          }
          const bufferLength = cap.analyserNode.frequencyBinCount;
          const dataArray = new Float32Array(bufferLength);
          cap.analyserNode.getFloatTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sum / bufferLength);
          levels[tabId] = Math.min(rms * 1.8, 1.0); // Boost scale factor for visual effect
        }
        sendResponse(levels);
      }
    } catch (err) {
      console.error('[Offscreen] Error handling message:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});

// Helper: Clean up tab audio resources
async function stopCapture(tabId) {
  const cap = captures.get(tabId);
  if (!cap) return;

  try {
    // Stop all media stream tracks
    if (cap.stream) {
      cap.stream.getTracks().forEach(track => track.stop());
    }

    // Disconnect Web Audio graph
    if (cap.source) cap.source.disconnect();
    if (cap.bassFilter) cap.bassFilter.disconnect();
    if (cap.midFilter) cap.midFilter.disconnect();
    if (cap.trebleFilter) cap.trebleFilter.disconnect();
    if (cap.gainNode) cap.gainNode.disconnect();
    if (cap.analyserNode) cap.analyserNode.disconnect();

    // Close AudioContext
    if (cap.audioCtx && cap.audioCtx.state !== 'closed') {
      await cap.audioCtx.close();
    }
  } catch (err) {
    console.error(`Error cleaning up resources for tab ${tabId}:`, err);
  } finally {
    captures.delete(tabId);
  }
}
