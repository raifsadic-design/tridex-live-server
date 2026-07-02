/**
 * TRIDEX LIVE - Admin Panel Mantigi (admin.js)
 */
(() => {
  'use strict';

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

  setCommandsEnabled(false);
})();
