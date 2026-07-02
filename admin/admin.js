/**
 * TRIDEX LIVE - Admin Panel Mantigi (admin.js)
 */
(() => {
  'use strict';

  /** app.js ile ayni mantik: bas frekans enerjisindeki ani sicramalari "beat" olarak algilar */
  class BeatDetector {
    constructor(analyser, { threshold = 1.4, cooldownMs = 180, historySize = 43 } = {}) {
      this.analyser = analyser;
      this.threshold = threshold;
      this.cooldownMs = cooldownMs;
      this.historySize = historySize;
      this.energyHistory = [];
      this.lastBeatTime = 0;
      this.data = new Uint8Array(analyser.frequencyBinCount);
    }

    getBassEnergy() {
      this.analyser.getByteFrequencyData(this.data);
      const bassBins = Math.max(4, Math.floor(this.data.length * 0.12));
      let sum = 0;
      for (let i = 0; i < bassBins; i++) sum += this.data[i] * this.data[i];
      return sum / bassBins;
    }

    check() {
      const energy = this.getBassEnergy();
      this.energyHistory.push(energy);
      if (this.energyHistory.length > this.historySize) this.energyHistory.shift();

      const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
      const now = Date.now();
      const cooledDown = now - this.lastBeatTime > this.cooldownMs;

      if (avgEnergy > 4 && energy > avgEnergy * this.threshold && cooledDown) {
        this.lastBeatTime = now;
        return true;
      }
      return false;
    }
  }

  const connectBtn = document.getElementById('connectBtn');
  const serverUrlInput = document.getElementById('serverUrl');
  const adminKeyInput = document.getElementById('adminKey');
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');

  const audienceCount = document.getElementById('audienceCount');
  const torchCount = document.getElementById('torchCount');
  const adminCount = document.getElementById('adminCount');

  const colorPicker = document.getElementById('colorPicker');
  const sendColorBtn = document.getElementById('sendColorBtn');
  const countdownSeconds = document.getElementById('countdownSeconds');
  const sendCountdownBtn = document.getElementById('sendCountdownBtn');
  const intervalMsInput = document.getElementById('intervalMs');
  const durationMsInput = document.getElementById('durationMs');

  const logBox = document.getElementById('log');

  const startMicAutoBtn = document.getElementById('startMicAutoBtn');
  const startSystemAutoBtn = document.getElementById('startSystemAutoBtn');
  const stopAutoBtn = document.getElementById('stopAutoBtn');
  const beatDot = document.getElementById('beatDot');
  const beatText = document.getElementById('beatText');
  const sensitivitySlider = document.getElementById('sensitivitySlider');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const cooldownInput = document.getElementById('cooldownInput');
  const pulseDurationInput = document.getElementById('pulseDurationInput');

  let autoAudioCtx = null;
  let autoStream = null;
  let beatDetector = null;
  let autoRafId = null;
  let autoModeActive = false;

  let ws = null;

  function log(line) {
    const time = new Date().toLocaleTimeString('tr-TR');
    logBox.innerHTML += `[${time}] ${line}\n`;
    logBox.scrollTop = logBox.scrollHeight;
  }

  function defaultWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host;
  }

  function connect() {
    const url = serverUrlInput.value.trim() || defaultWsUrl();
    ws = new WebSocket(url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', role: 'admin', adminKey: adminKeyInput.value }));
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (msg.type === 'registered') {
        connDot.classList.add('online');
        connText.textContent = 'Bağlı (admin)';
        log('Sunucuya admin olarak bağlanıldı.');
        setCommandsEnabled(true);
      }

      if (msg.type === 'error') {
        connText.textContent = 'Hata: ' + msg.message;
        log('HATA: ' + msg.message);
      }

      if (msg.type === 'stats') {
        audienceCount.textContent = msg.stats.audience;
        torchCount.textContent = msg.stats.torchCapable;
        adminCount.textContent = msg.stats.admins;
      }

      if (msg.type === 'commandSent') {
        log(`Komut gönderildi: ${msg.cmd} ${JSON.stringify(msg.params || {})}`);
      }
    };

    ws.onclose = () => {
      connDot.classList.remove('online');
      connText.textContent = 'Bağlantı koptu';
      setCommandsEnabled(false);
    };

    ws.onerror = () => {
      log('WebSocket hatası oluştu.');
    };
  }

  function setCommandsEnabled(enabled) {
    document.querySelectorAll('.cmd-grid button').forEach((b) => (b.disabled = !enabled));
    sendColorBtn.disabled = !enabled;
    sendCountdownBtn.disabled = !enabled;
  }

  function sendCommand(cmd, params = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('Önce sunucuya bağlanın.');
      return;
    }
    ws.send(JSON.stringify({ type: 'command', cmd, params }));
  }

  connectBtn.addEventListener('click', connect);

  document.querySelectorAll('.cmd-grid button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      const params = {};
      if (cmd === 'BLINK' || cmd === 'STROBE') {
        params.intervalMs = Number(intervalMsInput.value) || 150;
        params.durationMs = Number(durationMsInput.value) || 4000;
      }
      sendCommand(cmd, params);
    });
  });

  sendColorBtn.addEventListener('click', () => {
    sendCommand('COLOR', { color: colorPicker.value });
  });

  sendCountdownBtn.addEventListener('click', () => {
    sendCommand('COUNTDOWN', { seconds: Number(countdownSeconds.value) || 3 });
  });

  sensitivitySlider.addEventListener('input', () => {
    sensitivityValue.textContent = (Number(sensitivitySlider.value) / 100).toFixed(2);
    if (beatDetector) beatDetector.threshold = Number(sensitivitySlider.value) / 100;
  });

  cooldownInput.addEventListener('change', () => {
    if (beatDetector) beatDetector.cooldownMs = Number(cooldownInput.value) || 180;
  });

  async function startAutoMode(source) {
    if (autoModeActive) return;
    try {
      if (source === 'mic') {
        autoStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        // Sistem/sekme sesi paylasimi - sadece Chrome masaustunde, "sekme sesini paylas" secilmeli
        autoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // Video izlemesine gerek yok, sadece ses lazim
        autoStream.getVideoTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      log('Ses erişimi alınamadı: ' + e.message);
      return;
    }

    autoAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = autoAudioCtx.createMediaStreamSource(autoStream);
    const analyser = autoAudioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    src.connect(analyser);

    beatDetector = new BeatDetector(analyser, {
      threshold: Number(sensitivitySlider.value) / 100,
      cooldownMs: Number(cooldownInput.value) || 180
    });

    autoModeActive = true;
    beatDot.classList.add('online');
    beatText.textContent = 'Dinleniyor…';
    startMicAutoBtn.disabled = true;
    startSystemAutoBtn.disabled = true;
    stopAutoBtn.disabled = false;
    log('Oto-ritim modu başlatıldı (' + (source === 'mic' ? 'mikrofon' : 'sistem sesi') + ').');

    autoLoop();
  }

  function autoLoop() {
    if (!autoModeActive || !beatDetector) return;
    if (beatDetector.check()) {
      const durationMs = Number(pulseDurationInput.value) || 90;
      sendCommand('PULSE', { durationMs });
      flashBeatIndicator();
    }
    autoRafId = requestAnimationFrame(autoLoop);
  }

  function flashBeatIndicator() {
    beatDot.style.background = '#ff6ac1';
    setTimeout(() => {
      beatDot.style.background = '';
    }, 90);
  }

  function stopAutoMode() {
    autoModeActive = false;
    if (autoRafId) cancelAnimationFrame(autoRafId);
    if (autoStream) autoStream.getTracks().forEach((t) => t.stop());
    if (autoAudioCtx) autoAudioCtx.close();
    beatDot.classList.remove('online');
    beatText.textContent = 'Pasif';
    startMicAutoBtn.disabled = false;
    startSystemAutoBtn.disabled = false;
    stopAutoBtn.disabled = true;
    log('Oto-ritim modu durduruldu.');
  }

  startMicAutoBtn.addEventListener('click', () => startAutoMode('mic'));
  startSystemAutoBtn.addEventListener('click', () => startAutoMode('system'));
  stopAutoBtn.addEventListener('click', stopAutoMode);

  setCommandsEnabled(false);
})();
