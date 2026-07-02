/**
 * TRIDEX LIVE - Katilimci Uygulamasi (app.js)
 * --------------------------------------------
 * Akis:
 *  1) "Gosteriye Katil" -> mikrofon izni + kamera(torch tespiti) izni + wake lock
 *  2) WebSocket ile sunucuya "audience" olarak baglanma
 *  3) Saat senkronizasyonu (ping/pong -> offset hesapla)
 *  4) Sunucudan gelen komutlari executeAt zamaninda calistir
 *  5) Torch destekleniyorsa LED flas, desteklenmiyorsa (orn. iPhone Safari)
 *     otomatik olarak tam ekran beyaz/siyah flasa gec
 */

(() => {
  'use strict';

  // ---------- DOM referanslari ----------
  const joinButton = document.getElementById('joinButton');
  const statusText = document.getElementById('statusText');
  const liveInfo = document.getElementById('liveInfo');
  const modeBadge = document.getElementById('modeBadge');
  const vuBar = document.getElementById('vuBar');
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');
  const flashOverlay = document.getElementById('flashOverlay');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNumber = document.getElementById('countdownNumber');
  const hiddenCamera = document.getElementById('hiddenCamera');

  // ---------- Durum ----------
  let ws = null;
  let clockOffsetMs = 0; // sunucu zamani - istemci zamani (ping/pong ile hesaplanir)
  let torchTrack = null; // torch destekleyen kamera track'i (varsa)
  let torchSupported = false;
  let wakeLock = null;
  let audioCtx = null;
  let analyser = null;
  let vuRafId = null;
  let activeTimers = [];

  const configuredUrl = (window.TRIDEX_CONFIG && window.TRIDEX_CONFIG.WS_URL) || '';
  const WS_URL = configuredUrl || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);

  // ---------- Service Worker kaydi ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {
        // sw kaydi basarisiz olsa da uygulama calismaya devam eder
      });
    });
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function clearActiveTimers() {
    activeTimers.forEach((t) => clearTimeout(t));
    activeTimers = [];
  }

  // ---------- Wake Lock (ekranin kapanmasini engelle) ----------
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      // Wake lock alinamasa da gosteri devam eder
      console.warn('Wake lock alinamadi:', e);
    }
  }

  // ---------- Mikrofon izni + basit ses/ritim analizi ----------
  async function setupAudioAnalysis() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      startVuLoop();
      return true;
    } catch (e) {
      console.warn('Mikrofon izni alinamadi:', e);
      setStatus('Mikrofon izni verilmedi. Isik gosterisi yine de sunucu komutlariyla calisacak.');
      return false;
    }
  }

  function startVuLoop() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    function loop() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length; // 0-255 arasi kaba ses siddeti
      const pct = Math.min(100, Math.round((avg / 160) * 100));
      vuBar.style.width = pct + '%';
      vuRafId = requestAnimationFrame(loop);
    }
    loop();
  }

  // ---------- Torch (LED flas) yetenegi tespiti ----------
  // Not: iPhone Safari, WebRTC MediaStreamTrack.applyConstraints({torch}) desteklemez.
  // Bu durumda torchSupported false kalir ve sistem otomatik ekran flasina gecer.
  async function setupTorchCapability() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      const track = stream.getVideoTracks()[0];
      hiddenCamera.srcObject = stream;

      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps && 'torch' in caps) {
        torchTrack = track;
        torchSupported = true;
      } else {
        // Torch yok -> kamerayi kapat, ekran flasina guveniyoruz
        track.stop();
        torchSupported = false;
      }
    } catch (e) {
      console.warn('Kamera erisimi/torch tespiti basarisiz:', e);
      torchSupported = false;
    }

    modeBadge.textContent = 'Mod: ' + (torchSupported ? 'LED Flaş (Torch)' : 'Ekran Flaşı');
  }

  async function setTorch(on) {
    if (!torchSupported || !torchTrack) return false;
    try {
      await torchTrack.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch (e) {
      console.warn('Torch ayarlanamadi, ekran flasina dusuluyor:', e);
      torchSupported = false;
      return false;
    }
  }

  // ---------- WebSocket baglantisi ----------
  function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      connDot.classList.add('online');
      connText.textContent = 'Bağlandı';
      ws.send(JSON.stringify({ type: 'register', role: 'audience', torchCapable: torchSupported }));
      syncClock();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      connDot.classList.remove('online');
      connText.textContent = 'Bağlantı koptu, yeniden deneniyor…';
      setTimeout(connectWebSocket, 1500);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function syncClock() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const clientTime = Date.now();
    ws.send(JSON.stringify({ type: 'ping', clientTime }));
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'registered': {
        // Ilk kaba senkron: sunucu-istemci farki
        clockOffsetMs = msg.serverTime - Date.now();
        break;
      }
      case 'pong': {
        const now = Date.now();
        const rtt = now - msg.clientTime;
        // RTT'nin yarisi kadar telafi ederek daha hassas offset hesapla
        clockOffsetMs = msg.serverTime + rtt / 2 - now;
        break;
      }
      case 'command': {
        scheduleCommand(msg);
        break;
      }
      default:
        break;
    }
  }

  // Sunucudan gelen executeAt (sunucu zamaninda) -> yerel zamana cevirip zamanla
  function scheduleCommand(msg) {
    const localExecuteAt = msg.executeAt - clockOffsetMs;
    const delay = Math.max(0, localExecuteAt - Date.now());
    const timer = setTimeout(() => runCommand(msg.cmd, msg.params || {}), delay);
    activeTimers.push(timer);
  }

  // ---------- Komut yurutucu ----------
  function runCommand(cmd, params) {
    switch (cmd) {
      case 'WHITE_ON':
        clearActiveTimers();
        applyFlash('white');
        setTorch(true);
        break;

      case 'BLACK':
        clearActiveTimers();
        applyFlash('black');
        setTorch(false);
        break;

      case 'BLINK':
        clearActiveTimers();
        runBlinkPattern(params.intervalMs || 500, params.durationMs || 4000);
        break;

      case 'STROBE':
        clearActiveTimers();
        runBlinkPattern(params.intervalMs || 80, params.durationMs || 3000);
        break;

      case 'COLOR':
        clearActiveTimers();
        applyColorFlash(params.color || '#ff00ff');
        break;

      case 'COUNTDOWN':
        clearActiveTimers();
        runCountdown(params.seconds || 3);
        break;

      case 'STOP':
      default:
        clearActiveTimers();
        applyFlash('black');
        setTorch(false);
        hideCountdown();
        break;
    }
  }

  function applyFlash(mode) {
    flashOverlay.classList.remove('white', 'black', 'color');
    flashOverlay.style.backgroundColor = '';
    if (mode === 'white') flashOverlay.classList.add('white');
    if (mode === 'black') flashOverlay.classList.add('black');
  }

  function applyColorFlash(hexColor) {
    flashOverlay.classList.remove('white', 'black');
    flashOverlay.classList.add('color');
    flashOverlay.style.backgroundColor = hexColor;
    // Torch renkli isik veremez (sadece acik/kapali), o yuzden renk komutunda
    // torch destekli cihazlarda da gorsel geri bildirim icin ekran kullanilir.
  }

  function runBlinkPattern(intervalMs, durationMs) {
    let on = false;
    const endTime = Date.now() + durationMs;

    function tick() {
      if (Date.now() >= endTime) {
        applyFlash('black');
        setTorch(false);
        return;
      }
      on = !on;
      applyFlash(on ? 'white' : 'black');
      setTorch(on);
      const t = setTimeout(tick, intervalMs);
      activeTimers.push(t);
    }
    tick();
  }

  function runCountdown(seconds) {
    countdownOverlay.classList.remove('hidden');
    let remaining = seconds;
    countdownNumber.textContent = remaining;

    function tick() {
      remaining -= 1;
      if (remaining <= 0) {
        hideCountdown();
        return;
      }
      countdownNumber.textContent = remaining;
      const t = setTimeout(tick, 1000);
      activeTimers.push(t);
    }
    const t = setTimeout(tick, 1000);
    activeTimers.push(t);
  }

  function hideCountdown() {
    countdownOverlay.classList.add('hidden');
  }

  // ---------- "Gosteriye Katil" butonu ----------
  joinButton.addEventListener('click', async () => {
    joinButton.disabled = true;
    joinButton.textContent = 'Hazırlanıyor…';
    setStatus('İzinler isteniyor, lütfen izin ver…');

    await requestWakeLock();
    await setupAudioAnalysis();
    await setupTorchCapability();

    connectWebSocket();

    document.body.classList.add('live');
    joinButton.classList.add('hidden');
    liveInfo.classList.remove('hidden');
    setStatus('Gösteriye katıldın! Telefonunu kaldır ve komut bekle.');
  });

  // Sekme tekrar goruntulenebilir oldugunda wake lock'u yeniden al (bazi tarayicilar otomatik birakir)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock === null && document.body.classList.contains('live')) {
      await requestWakeLock();
    }
  });
})();
