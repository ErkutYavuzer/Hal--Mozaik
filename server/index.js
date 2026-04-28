import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'carpet_data.json');
const MAX_SESSIONS = 100;

// 🌐 YEREL IP TESPİTİ
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  let preferredIp = '';

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4 ve internal olmayan (127.0.0.1 gibi) adresi bul
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('192.168.')) {
          return iface.address; // Öncelikli IP bulundu
        }
        if (!preferredIp) preferredIp = iface.address; // Yedek IP (örn: 172.x veya 10.x)
      }
    }
  }
  return preferredIp || 'localhost';
}

const LOCAL_IP = getLocalIp();
console.log(`🌍 Sunucu IP Adresi: ${LOCAL_IP}`);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // origin "*" iken credentials: true olamaz
    methods: ["GET", "POST"]
  },
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Slot Yönetimi (6x10 = 60 kare)
const TOTAL_SLOTS = 60;
const PIXELS_PER_SLOT = 16;
let availableSlots = Array.from({ length: TOTAL_SLOTS }, (_, i) => i);
let carpetState = Array(TOTAL_SLOTS).fill(null).map(() => Array(PIXELS_PER_SLOT * PIXELS_PER_SLOT).fill('#9c8d76'));
let sessions = [];
let currentSessionMotifs = [];
let sessionStartedAt = null;

// 💾 VERİ YÜKLEME (Başlangıçta)
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.carpetState && data.availableSlots) {
        carpetState = data.carpetState;
        availableSlots = data.availableSlots;
        console.log('💾 Kayıtlı halı verisi yüklendi!');
      }
      if (Array.isArray(data.sessions)) {
        sessions = data.sessions;
      }
      if (Array.isArray(data.currentSessionMotifs)) {
        currentSessionMotifs = data.currentSessionMotifs;
      }
      if (data.sessionStartedAt) {
        sessionStartedAt = data.sessionStartedAt;
      }
    } catch (e) {
      console.error('Veri yükleme hatası:', e);
    }
  }
}
loadData();

// 💾 VERİ KAYDETME (Throttle ile - Her 2 saniyede bir max)
let saveTimeout = null;
function saveData() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = { carpetState, availableSlots, sessions, currentSessionMotifs, sessionStartedAt };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data));
      // console.log('💾 Veri diskte güncellendi.'); // Log kirliliği olmaması için kapalı
    } catch (e) {
      console.error('Veri kaydetme hatası:', e);
    }
  }, 2000);
}

function createSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function countFilledSlots() {
  return TOTAL_SLOTS - availableSlots.length;
}

function recordMotif(slotId, pixels) {
  if (!sessionStartedAt) sessionStartedAt = new Date().toISOString();
  currentSessionMotifs.push({
    id: createSessionId(),
    slotId,
    pixels,
    createdAt: new Date().toISOString()
  });
}

function createSessionArchive(reason) {
  const filledSlots = countFilledSlots();
  if (filledSlots === 0 && currentSessionMotifs.length === 0) return null;
  const createdAt = new Date().toISOString();
  const session = {
    id: createSessionId(),
    createdAt,
    startedAt: sessionStartedAt || createdAt,
    reason,
    filledSlots,
    totalSlots: TOTAL_SLOTS,
    percent: Math.round((filledSlots / TOTAL_SLOTS) * 100),
    motifs: currentSessionMotifs,
    carpetState: JSON.parse(JSON.stringify(carpetState))
  };
  sessions.push(session);
  if (sessions.length > MAX_SESSIONS) {
    sessions = sessions.slice(-MAX_SESSIONS);
  }
  currentSessionMotifs = [];
  sessionStartedAt = null;
  saveData();
  return session;
}

app.get('/api/sessions', (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)));
  const list = sessions
    .slice()
    .reverse()
    .slice(0, limit)
    .map(({ id, createdAt, startedAt, reason, filledSlots, totalSlots, percent }) => ({
      id,
      createdAt,
      startedAt,
      reason,
      filledSlots,
      totalSlots,
      percent
    }));
  res.json({ sessions: list });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.find((item) => item.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  res.json(session);
});

app.get('/api/sessions/:id/download', (req, res) => {
  const session = sessions.find((item) => item.id === req.params.id);
  if (!session) return res.status(404).send('session_not_found');
  const fileName = `hali-mozaik-session-${session.id}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(session));
});

// 🚀 PERFORMANS: Update Batching (50ms)
let updateBuffer = [];
let progressDirty = false;

setInterval(() => {
  if (updateBuffer.length > 0) {
    // Toplu güncelleme gönder
    io.emit('batch-update', updateBuffer);
    updateBuffer = [];
  }

  if (progressDirty) {
    // İlerleme durumunu gönder
    const filledCount = TOTAL_SLOTS - availableSlots.length;
    io.emit('carpet-progress', {
      filledSlots: filledCount,
      totalSlots: TOTAL_SLOTS,
      percent: Math.round((filledCount / TOTAL_SLOTS) * 100)
    });
    progressDirty = false;
  }
}, 50);

io.on('connection', (socket) => {
  console.log('🦅 Bir dokumacı bağlandı:', socket.id);

  // 📡 İstemciye IP adresini gönder (QR kod için)
  socket.emit('server-ip', { ip: LOCAL_IP, port: PORT });

  const filledCount = TOTAL_SLOTS - availableSlots.length;
  socket.emit('initial-carpet', {
    carpetState,
    progress: {
      filledSlots: filledCount,
      totalSlots: TOTAL_SLOTS,
      percent: Math.round((filledCount / TOTAL_SLOTS) * 100)
    }
  });

  socket.on('pixel-data', (pixels) => {
    if (availableSlots.length === 0) {
      console.log('🔄 Halı doldu! SIFIRLAMA GÖNDERİLİYOR...');
      createSessionArchive('auto');
      io.emit('carpet-reset');
      availableSlots = Array.from({ length: TOTAL_SLOTS }, (_, i) => i);
      carpetState = Array(TOTAL_SLOTS).fill(null);
      saveData();
      return;
    }

    const randomIndex = Math.floor(Math.random() * availableSlots.length);
    const targetSlot = availableSlots[randomIndex];
    availableSlots.splice(randomIndex, 1);
    carpetState[targetSlot] = pixels;
    recordMotif(targetSlot, pixels);

    saveData(); // Değişikliği kaydet

    // 🚀 Buffer'a ekle (Anında göndermek yerine)
    updateBuffer.push({ slotId: targetSlot, pixels: pixels });
    progressDirty = true;

    // Konsolu çok kirletmemek için logu da azalttık
    // console.log(`📡 VERİ EKLENDİ! Buffer: ${updateBuffer.length}`);
  });

  socket.on('manual-reset', () => {
    console.log('🧹 MANUEL TEMİZLİK EMRİ GELDİ!');
    createSessionArchive('manual');
    io.emit('carpet-reset');
    availableSlots = Array.from({ length: TOTAL_SLOTS }, (_, i) => i);
    carpetState = Array(TOTAL_SLOTS).fill(null).map(() => Array(PIXELS_PER_SLOT * PIXELS_PER_SLOT).fill('#9c8d76'));
    saveData(); // Temizliği kaydet
    console.log('✨ Sunucu hafızası sıfırlandı.');
  });
});

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`🦅 Halı Tezgahı Sunucusu ${PORT} portunda çalışıyor...`);
});
