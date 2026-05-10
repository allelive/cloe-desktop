// ==================== Cloe Desktop — Renderer (GIF Mode) ====================

// ==================== Config ====================
const WS_PORT = 19850;
const CROSSFADE_MS = 300;
const IDLE_INTERVAL = { min: 8000, max: 15000 };
const REACTION_DURATION = 3000;

// Resolve base path for assets (GIFs, audio)
// Dev mode: Vite serves from http://localhost:5173/ → use /gifs/
// Packaged file:// → base URL from ~/.cloe dataDir via preload (no HTTP static route)
const DATA_DIR_BASE = (typeof window !== 'undefined' && window.electronAPI?.getDataDir?.()) || '';
const BASE = (location.protocol === 'file:' && DATA_DIR_BASE)
  ? DATA_DIR_BASE
  : '/';

let GIF_ANIMATIONS = {
  blink:       `${BASE}gifs/blink.gif`,
  smile:       `${BASE}gifs/smile.gif`,
  kiss:        `${BASE}gifs/kiss.gif`,
  nod:         `${BASE}gifs/nod.gif`,
  wave:        `${BASE}gifs/wave.gif`,
  think:       `${BASE}gifs/think.gif`,
  tease:       `${BASE}gifs/tease.gif`,
  speak:       `${BASE}gifs/speak.gif`,
  shake_head:  `${BASE}gifs/shake_head.gif`,
  working:     `${BASE}gifs/working.gif`,
  clap:        `${BASE}gifs/clap.gif`,
  shy:         `${BASE}gifs/shy.gif`,
  yawn:        `${BASE}gifs/yawn.gif`,
  laugh:       `${BASE}gifs/laugh.gif`,
};

// Weighted idle playlist (blink & smile most frequent)
let IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss', 'think', 'nod', 'shake_head'];

// Fallback to default set when current set doesn't have the action
let ACTION_MAP = {};
let FALLBACK_GIF_ANIMATIONS = {};
let FALLBACK_ACTION_MAP = {};

// ==================== State ====================
let currentGif = 'blink';
let activeLayer = 'a';
let isTransitioning = false;
let isReacting = false;
let isWorking = false;      // True = locked in working mode (no idle)
let isSpeaking = false;     // True = TTS audio playing (highest priority, nothing can interrupt)
let pendingGif = null;
let idleTimer = null;
let reactionTimer = null;

// ==================== DOM ====================
const gifLayerA = document.getElementById('cloe-gif-a');
const gifLayerB = document.getElementById('cloe-gif-b');
const wsStatus = document.getElementById('ws-status');

function getActive()  { return activeLayer === 'a' ? gifLayerA : gifLayerB; }
function getHidden()  { return activeLayer === 'a' ? gifLayerB : gifLayerA; }
function swapLayers() { activeLayer = activeLayer === 'a' ? 'b' : 'a'; }

/** Resolved absolute href — compares full resource URL, not just filename (img.src getter is always absolute). */
function resolvedGifHref(s) {
  try {
    return new URL(s, location.href).href;
  } catch {
    return s;
  }
}

// ==================== GIF Switch (double-buffer crossfade) ====================
function preloadGif(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

function switchGif(name, autoReturn = true) {
  const src = GIF_ANIMATIONS[name];
  if (!src) return;

  const active = getActive();

  // Already showing — skip but keep scheduling (full resolved URL, not filename-only endsWith)
  if (resolvedGifHref(active.src) === resolvedGifHref(src)) {
    if (!autoReturn) scheduleNextIdle();
    return;
  }

  // Queue if mid-transition
  if (isTransitioning) {
    pendingGif = { name, autoReturn };
    return;
  }

  isTransitioning = true;
  const next = getHidden();

  preloadGif(src).then(() => {
    next.src = src;
    next.style.opacity = '1';
    active.style.opacity = '0';
    swapLayers();
    currentGif = name;

    setTimeout(() => {
      isTransitioning = false;

      // Drain queue first
      if (pendingGif) {
        const queued = pendingGif;
        pendingGif = null;
        switchGif(queued.name, queued.autoReturn);
        return;
      }

      if (autoReturn) {
        // In working mode, return to working.gif after reaction
        if (isWorking) {
          isReacting = true;
          reactionTimer = setTimeout(() => {
            isReacting = false;
            stopAudio();
            switchGif('working', false);
          }, REACTION_DURATION);
          return;
        }

        isReacting = true;
        reactionTimer = setTimeout(() => {
          isReacting = false;
          stopAudio();
          startIdleLoop();
        }, REACTION_DURATION);
      } else {
        scheduleNextIdle();
      }
    }, CROSSFADE_MS);
  }).catch((err) => {
    console.error(`[switchGif] ${name}: ${err.message}`);
    isTransitioning = false;
  });
}

function resetGif() {
  const active = getActive();
  const src = active.src;
  active.src = '';
  active.src = src;
}

// ==================== Idle Loop ====================
function scheduleNextIdle() {
  clearTimeout(idleTimer);
  if (isReacting || isWorking || isWalking) return;
  const delay = IDLE_INTERVAL.min + Math.random() * (IDLE_INTERVAL.max - IDLE_INTERVAL.min);
  idleTimer = setTimeout(playRandomIdle, delay);
}

function playRandomIdle() {
  if (isReacting || isWorking || isWalking) return;
  const choices = IDLE_PLAYLIST.filter((n) => n !== currentGif);
  const pool = choices.length > 0 ? choices : IDLE_PLAYLIST;
  const next = pool[Math.floor(Math.random() * pool.length)];
  switchGif(next, false);
}

function startIdleLoop() {
  if (isWalking) return;
  const first = IDLE_PLAYLIST[Math.floor(Math.random() * IDLE_PLAYLIST.length)];
  switchGif(first, false);
}

// ==================== Audio ====================

// --- Legacy Audio (non-streaming, for pre-recorded and HTTP audio) ---
function playAudio(source, onEnded) {
  stopAudio();
  // Support: data URL (data:audio/...;base64,...), full URL, or pre-recorded name
  let src;
  if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://')) {
    src = source;
  } else {
    src = `${BASE}audio/${source}.mp3`;
  }
  const audio = new Audio(src);
  audio.volume = 0.9;
  window._currentAudio = audio;
  audio.play().catch((e) => console.error('Audio error:', e));
  audio.addEventListener('ended', () => {
    window._currentAudio = null;
    if (onEnded) onEnded();
  });
  // Also handle load error — don't get stuck if audio fails
  audio.addEventListener('error', () => {
    console.error('[Audio] Failed to load:', src.substring(0, 80));
    window._currentAudio = null;
    if (onEnded) onEnded();
  });
  return audio;
}

function stopAudio() {
  if (window._currentAudio) {
    window._currentAudio.pause();
    window._currentAudio = null;
  }
}

// ==================== Action Dispatch ====================
function handleAction(data) {
  const action = data.action;
  console.log('[Action]', action, data);

  // ── Highest priority: speaking (TTS audio playing) ──
  // Nothing can interrupt a speak in progress — drop all other actions.
  // The only exception is another 'speak' (re-trigger / override).
  if (isSpeaking && action !== 'speak') {
    console.log('[Action] Dropped — speak in progress:', action);
    return;
  }

  // ── Walking takes priority: ignore all actions except idle/stop ──
  if (isWalking && action !== 'walk_right' && action !== 'walk_left' && action !== 'idle') {
    console.log('[Action] Dropped — walk in progress:', action);
    return;
  }

  // ── Working mode: lock into working GIF until "idle" action ──
  if (action === 'working') {
    clearTimeout(idleTimer);
    clearTimeout(reactionTimer);
    isWorking = true;
    isReacting = false;
    // Use working.gif as default working animation, allow override
    const gifName = data.gif || 'working';
    switchGif(gifName);
    return;
  }

  // ── Exit working mode, resume idle loop ──
  if (action === 'idle') {
    isWorking = false;
    isReacting = false;
    clearTimeout(reactionTimer);
    // If audio is playing (e.g. TTS speak), don't kill it — wait for it to
    // finish naturally, then return to idle.  This prevents plugin hooks
    // (post_llm_call → idle) from cutting off a speak animation mid-playback.
    if (window._currentAudio) {
      console.log('[idle] Audio playing — deferring idle until audio ends');
      const audio = window._currentAudio;
      const onEnd = () => {
        audio.removeEventListener('ended', onEnd);
        audio.removeEventListener('error', onEnd);
        stopAudio();
        startIdleLoop();
      };
      audio.addEventListener('ended', onEnd);
      audio.addEventListener('error', onEnd);
      return;
    }
    stopAudio();
    startIdleLoop();
    return;
  }

  // Interrupt idle
  clearTimeout(idleTimer);
  isReacting = true;

  // Handle compound action (expression with sub-type)
  if (action === 'expression') {
    if (data.expression === 'happy' || data.expression === 'smile') {
      switchGif('smile');
    } else {
      resetGif();
    }
    return;
  }

  // ── Walk action: switch GIF + move window across screen (must check before ACTION_MAP) ──
  if (action === 'walk_right' || action === 'walk_left') {
    const walkGif = GIF_ANIMATIONS[action];
    if (walkGif) switchGif(action, false);
    const direction = action === 'walk_right' ? 1 : -1;
    startWalk(direction * 2);
    return;
  }

  // Direct mapping or fallback
  let gifName = ACTION_MAP[action];
  let animSrc = GIF_ANIMATIONS;

  if (!gifName && FALLBACK_ACTION_MAP[action]) {
    // Fallback to default set
    gifName = FALLBACK_ACTION_MAP[action];
    animSrc = FALLBACK_GIF_ANIMATIONS;
  }
  if (gifName) {
    // Temporarily use the fallback animation source for switchGif
    const savedAnims = GIF_ANIMATIONS;
    if (animSrc !== GIF_ANIMATIONS) GIF_ANIMATIONS = animSrc;
    if (action === 'speak') {
      // Priority 1: Dynamic TTS via HTTP (audio_url field)
      if (data.audio_url) {
        isSpeaking = true;
        switchGif(gifName, false);
        playAudio(data.audio_url, () => {
          isSpeaking = false;
          isWorking = false;   // speak 结束后解锁 working 状态，避免死锁
          isReacting = false;
          startIdleLoop();
        });
      }
      // Priority 2: Pre-recorded audio (audio field)
      else {
        switchGif(gifName);
        if (data.audio) {
          playAudio(data.audio);
        }
      }
    } else {
      switchGif(gifName);
    }
    // Restore animation source if we used fallback
    if (animSrc !== savedAnims) GIF_ANIMATIONS = savedAnims;
  } else {
    resetGif();
  }
}

// ==================== Context Usage HUD ====================

const contextBar = document.getElementById('context-bar');
const contextBarFill = document.getElementById('context-bar-fill');
const contextBarText = document.getElementById('context-bar-text');

function initContextBar() {
  // Default: visible. localStorage only hides if explicitly set to 'false'.
  const hidden = localStorage.getItem('cloe-context-bar-visible') === 'false';
  if (!hidden) contextBar.classList.add('visible');

  // Listen for changes from the settings panel (different window, same origin)
  window.addEventListener('storage', (e) => {
    if (e.key === 'cloe-context-bar-visible') {
      const newVisible = e.newValue !== 'false';
      contextBar.classList.toggle('visible', newVisible);
    }
  });
}

function updateContextBar(usagePct) {
  const pct = Math.max(0, Math.min(100, usagePct));

  contextBarFill.style.width = `${pct}%`;
  contextBarText.textContent = `${Math.round(pct)}%`;

  // Remove all state classes
  contextBarFill.classList.remove('warn', 'danger', 'critical');

  // Apply color based on usage
  if (pct >= 90) {
    contextBarFill.classList.add('critical');
  } else if (pct >= 75) {
    contextBarFill.classList.add('danger');
  } else if (pct >= 50) {
    contextBarFill.classList.add('warn');
  }
}

initContextBar();

// ==================== Window Drag ====================
const container = document.getElementById('gif-container');
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

container.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  window.electronAPI?.moveWindow(e.screenX - dragStartX, e.screenY - dragStartY);
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mouseup', () => { isDragging = false; });

// ==================== WebSocket ====================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    ws.onopen = () => {
      wsStatus.style.color = '#4CAF50';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'set-config') {
          // Dynamic config update from action set switch
          const newAnims = {};
          for (const [key, val] of Object.entries(msg.animations || {})) {
            // Values come as "gifs/xxx.gif" — prepend BASE
            const relative = val.startsWith('/') ? val.slice(1) : val;
            newAnims[key] = `${BASE}${relative}`;
          }
          GIF_ANIMATIONS = newAnims;
          IDLE_PLAYLIST = msg.idlePlaylist || [];
          ACTION_MAP = msg.actionMap || {};

          // Store default set as fallback
          if (msg.fallbackAnimations) {
            const fbAnims = {};
            for (const [key, val] of Object.entries(msg.fallbackAnimations)) {
              const relative = val.startsWith('/') ? val.slice(1) : val;
              fbAnims[key] = `${BASE}${relative}`;
            }
            FALLBACK_GIF_ANIMATIONS = fbAnims;
            FALLBACK_ACTION_MAP = msg.fallbackActionMap || {};
          } else {
            FALLBACK_GIF_ANIMATIONS = {};
            FALLBACK_ACTION_MAP = {};
          }

          // Always reset timers so the new action set applies immediately (same action name can map to a different file)
          clearTimeout(idleTimer);
          clearTimeout(reactionTimer);
          isReacting = false;
          startIdleLoop();
          console.log(`[set-config] Updated: ${Object.keys(GIF_ANIMATIONS).length} animations, ${IDLE_PLAYLIST.length} idle entries`);
        } else if (msg.type === 'context-usage') {
          // Context window usage HUD update
          updateContextBar(msg.usage_pct);
        } else {
          handleAction(msg);
        }
      } catch (e) { console.error('WS parse:', e); }
    };

    ws.onclose = () => {
      wsStatus.style.color = '#f44336';
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {
    console.error('WS init:', e);
    wsStatus.style.color = '#f44336';
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

// ==================== Walk Mode ====================
// Move the Cloe window across the screen, bounce at edges, return to origin
let isWalking = false;
let walkRafId = null;

function startWalk(speed = 1.5) {
  if (isWalking) return;
  isWalking = true;
  clearTimeout(idleTimer);
  clearTimeout(reactionTimer);
  isReacting = true;

  const api = window.electronAPI;
  if (!api?.getWorkAreaSize || !api?.getWindowPosition) {
    console.error('[Walk] Missing electronAPI');
    isWalking = false;
    isReacting = false;
    startIdleLoop();
    return;
  }

  // Record starting position to return to after round-trip
  api.getWindowPosition().then((startPos) => {
    if (!startPos) { isWalking = false; return; }
    const originX = startPos.x;

    api.getWorkAreaSize().then((screen) => {
      if (!screen) { isWalking = false; return; }
      const screenWidth = screen.width;
      const MARGIN = 40;
      let direction = speed > 0 ? 1 : -1;
      let currentSpeed = Math.abs(speed);

      function switchWalkGif(dir) {
        const gifName = dir > 0 ? 'walk_right' : 'walk_left';
        if (GIF_ANIMATIONS[gifName]) switchGif(gifName, false);
      }

      // Set initial walk GIF
      switchWalkGif(direction);

      let bounced = false;

      function tick() {
        if (!isWalking) return;

        api.getWindowPosition().then((pos) => {
          if (!pos || !isWalking) return;

          // Only bounce once at the edge, then walk straight back to origin
          if (!bounced && pos.x + 380 + MARGIN >= screenWidth && direction > 0) {
            direction = -1;
            bounced = true;
            switchWalkGif(direction);
          } else if (!bounced && pos.x - MARGIN <= 0 && direction < 0) {
            direction = 1;
            bounced = true;
            switchWalkGif(direction);
          }

          api.moveWindow(Math.round(currentSpeed * direction), 0);

          // Check if we've returned to origin after bouncing
          if (bounced && Math.abs(pos.x - originX) < currentSpeed + 2) {
            stopWalk();
            return;
          }

          walkRafId = requestAnimationFrame(tick);
        });
      }
      walkRafId = requestAnimationFrame(tick);
    });
  });
}

function stopWalk() {
  isWalking = false;
  if (walkRafId) {
    cancelAnimationFrame(walkRafId);
    walkRafId = null;
  }
  isReacting = false;
  startIdleLoop();
}

// ==================== Init ====================
startIdleLoop();
connectWebSocket();
