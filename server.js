/**
 * TRIDEX LIVE - Merkezi Sunucu
 * -----------------------------
 * - Express ile statik dosyalari sunar (public/ katilimci, admin/ kontrol paneli)
 * - ws ile WebSocket baglantilarini yonetir
 * - Admin panelinden gelen komutlari tum katilimci cihazlara
 *   senkronize bir "executeAt" zaman damgasi ile yayinlar
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
// Admin paneline baglanmak icin gereken anahtar. Prodüksiyonda mutlaka degistirin!
const ADMIN_KEY = process.env.ADMIN_KEY || 'tridex2026';
// Komutun tum cihazlara ulasip hazirlanmasi icin tampon sure (ms)
const SYNC_BUFFER_MS = 200;

app.use('/', express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', connected: clients.size, time: Date.now() });
});

// ws (WebSocket) baglantisi -> meta bilgisi
const clients = new Map(); // ws -> { id, role, connectedAt }
let clientCounter = 0;

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastToAudience(message) {
  const data = JSON.stringify(message);
  clients.forEach((meta, ws) => {
    if (meta.role === 'audience' && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastToAdmins(message) {
  const data = JSON.stringify(message);
  clients.forEach((meta, ws) => {
    if (meta.role === 'admin' && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function getStats() {
  let audience = 0;
  let admins = 0;
  let torchCapable = 0;
  clients.forEach((meta) => {
    if (meta.role === 'admin') admins++;
    else {
      audience++;
      if (meta.torchCapable) torchCapable++;
    }
  });
  return { audience, admins, torchCapable };
}

const VALID_COMMANDS = new Set([
  'WHITE_ON',
  'BLACK',
  'BLINK',
  'STROBE',
  'COLOR',
  'COUNTDOWN',
  'STOP',
  'PULSE' // Ritme gore tek atimlik hizli flas (oto-ritim modu icin)
]);

wss.on('connection', (ws) => {
  const id = ++clientCounter;
  clients.set(ws, { id, role: 'audience', connectedAt: Date.now(), torchCapable: false });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return; // gecersiz JSON, yoksay
    }

    const meta = clients.get(ws);
    if (!meta) return;

    switch (msg.type) {
      // Baglanan cihaz kendini "audience" (katilimci) ya da "admin" olarak tanitir
      case 'register': {
        if (msg.role === 'admin') {
          if (msg.adminKey !== ADMIN_KEY) {
            safeSend(ws, { type: 'error', message: 'Gecersiz admin anahtari' });
            ws.close();
            return;
          }
          meta.role = 'admin';
        } else {
          meta.role = 'audience';
          meta.torchCapable = !!msg.torchCapable;
        }
        clients.set(ws, meta);
        safeSend(ws, { type: 'registered', id: meta.id, serverTime: Date.now() });
        broadcastToAdmins({ type: 'stats', stats: getStats() });
        break;
      }

      // Katilimci, torch destegini sonradan bildirirse (kamera izni geciktiyse)
      case 'capability': {
        meta.torchCapable = !!msg.torchCapable;
        clients.set(ws, meta);
        broadcastToAdmins({ type: 'stats', stats: getStats() });
        break;
      }

      // Saat senkronizasyonu icin ping/pong
      case 'ping': {
        safeSend(ws, { type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        break;
      }

      // Sadece admin komut gonderebilir
      case 'command': {
        if (meta.role !== 'admin') return;
        if (!VALID_COMMANDS.has(msg.cmd)) return;

        const now = Date.now();
        const payload = {
          type: 'command',
          cmd: msg.cmd,
          params: msg.params || {},
          serverTime: now,
          executeAt: now + (Number(msg.delayMs) || SYNC_BUFFER_MS)
        };
        broadcastToAudience(payload);
        if (msg.cmd !== 'PULSE') {
          broadcastToAdmins({ type: 'commandSent', cmd: msg.cmd, params: payload.params, at: now });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastToAdmins({ type: 'stats', stats: getStats() });
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`TRIDEX LIVE sunucusu port ${PORT} uzerinde calisiyor`);
  console.log(`Katilimci sayfasi : http://localhost:${PORT}/`);
  console.log(`Admin paneli      : http://localhost:${PORT}/admin/admin.html`);
  console.log(`Admin anahtari    : ${ADMIN_KEY} (ADMIN_KEY env degiskeni ile degistirin)`);
});
