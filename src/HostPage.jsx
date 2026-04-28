import { useEffect, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { io } from 'socket.io-client';
import { WOOD_TEXTURE } from './components/3d/materials';
import CarpetBoard from './components/3d/CarpetBoard';
import { CarpetBorder, CarpetFringes, BORDER_WIDTH } from './components/3d/CarpetBorder';
import { CONFIG } from './constants';

// 🆕 SES EFEKTİ (ARTIK AUDIOMANAGER KULLANIYORUZ)
import { audioManager } from './audio/AudioManager';

const initAudio = () => {
  audioManager.init().then(() => {
    console.log('🔊 Audio System Initialized');
  });
};


// 🧶 HALI BİLEŞENİ
function MegaCarpetWrapper({ socket, onFinalShow }) {
  const carpetWidth = CONFIG.SLOT_COLS * (CONFIG.PIXELS_PER_SLOT * CONFIG.NODE_SIZE + CONFIG.GAP);
  const carpetDepth = CONFIG.SLOT_ROWS * (CONFIG.PIXELS_PER_SLOT * CONFIG.NODE_SIZE + CONFIG.GAP);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 22, 0]}>
      <CarpetBoard
        socket={socket}
        playLandSound={null} // Artık FlyingPixels içinde AudioManager kullanılıyor
        onFinalShow={onFinalShow}
        carpetWidth={carpetWidth}
        carpetDepth={carpetDepth}
        carpetWidthReal={carpetWidth} // Backwards compatibility if needed
      >
        {/* Çerçeve ve Zeminler */}
        <CarpetBorder width={carpetWidth} depth={carpetDepth} />
        <CarpetFringes width={carpetWidth} depth={carpetDepth} />

        {/* Zemin Tabanı (Backing) */}
        <mesh position={[0, -0.05, 0]} receiveShadow>
          <boxGeometry args={[carpetWidth + BORDER_WIDTH * 2 + 0.05, 0.04, carpetDepth + BORDER_WIDTH * 2 + 0.05]} />
          <meshStandardMaterial color="#300000" roughness={1} />
        </mesh>

        {/* Alt Zemin (Gölge) */}
        <mesh position={[0, -0.08, 0]} receiveShadow>
          <boxGeometry args={[carpetWidth + BORDER_WIDTH * 2, 0.02, carpetDepth + BORDER_WIDTH * 2]} />
          <meshBasicMaterial color="#000" />
        </mesh>
      </CarpetBoard>
    </group>
  );
}

// 🏠 ANA SAYFA
export default function HostPage() {
  const [showQR, setShowQR] = useState(false);
  const [qrImageURL, setQrImageURL] = useState('');
  const [socket, setSocket] = useState(null);
  const [isFinalShow, setIsFinalShow] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionError, setSessionError] = useState('');

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions?limit=1');
      if (!response.ok) throw new Error('session_fetch_failed');
      const data = await response.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setSessionError('');
    } catch {
      setSessions([]);
      setSessionError('oturum_bulunamadi');
    }
  }, []);

  useEffect(() => {
    // Socket Bağlantısı
    const socketUrl = `${window.location.protocol}//${window.location.hostname}:3003`;
    const newSocket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      upgrade: true
    });
    setSocket(newSocket);

    fetchSessions();

    // Sunucu IP Dinleme
    newSocket.on('server-ip', ({ ip }) => {
      console.log('🌍 Sunucu IP:', ip);
      const protocol = window.location.protocol;
      const host = ip === 'localhost' ? 'localhost' : ip;
      const appPort = window.location.port || '3002'; // Mevcut Vite portunu al
      const clientUrl = `${protocol}//${host}:${appPort}/?role=client`;
      console.log('🔗 QR Hedef URL:', clientUrl);

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(clientUrl)}`;
      setQrImageURL(qrUrl);
    });

    newSocket.on('carpet-reset', () => {
      setTimeout(() => {
        fetchSessions();
      }, 500);
    });

    return () => {
      newSocket.off('server-ip');
      newSocket.off('carpet-reset');
      newSocket.close();
    };
  }, [fetchSessions]);

  const latestSession = sessions[0];
  const sessionDownloadUrl = latestSession ? `${window.location.origin}/api/sessions/${latestSession.id}/download` : '';
  const sessionQrUrl = latestSession
    ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(sessionDownloadUrl)}`
    : '';

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a1a' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      >
        <fog attach="fog" args={['#1a1a1a', 100, 300]} /> {/* Sis daha geriye çekildi, renk arka planla eşitlendi */}
        <PerspectiveCamera makeDefault position={[0, 22, 90]} fov={50} />

        <OrbitControls
          maxPolarAngle={Math.PI / 1.5} // Daha aşağıya bakabilme (2.1 -> 1.5 radyan)
          minPolarAngle={Math.PI / 6}   // Daha yukarı çıkabilme (3 -> 6)
          minDistance={15}
          maxDistance={150}
          target={[0, 22, 0]}
          enableDamping
          dampingFactor={0.05}
          minAzimuthAngle={-Math.PI / 2} // 90 derece sola
          maxAzimuthAngle={Math.PI / 2}  // 90 derece sağa
        />

        <ambientLight intensity={0.7} color="#ffffff" /> {/* Ortam ışığı düşürüldü (1.2 -> 0.7) - Kontrast arttı */}
        <spotLight
          position={[0, 50, 70]}
          angle={0.6}
          penumbra={0.5}
          intensity={12} // Daha güçlü odak ışığı (8 -> 12)
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          color="#fffbf0"
        />

        <pointLight position={[30, 40, 40]} intensity={6} color="#fff8e7" /> {/* Yan ışıklar güçlendirildi (4 -> 6) */}
        <pointLight position={[-30, 40, 40]} intensity={6} color="#fff8e7" />

        {/* HALI GRUBU */}
        <group rotation={[0, Math.PI, -Math.PI / 2]} position={[28, 22, 0]} scale={1.5}>
          <MegaCarpetWrapper socket={socket} onFinalShow={(val) => setIsFinalShow(val)} />
        </group>

        {/* 🏛️ 3D YAZI (Duvara Sabitlendi) */}
        <group position={[0, 48, 0]}>
          <Text
            fontSize={6}
            color="#222"
            anchorX="center"
            anchorY="middle"
            letterSpacing={0.25}
          >
            HALI MOZAİK
            <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.2} />
          </Text>
          <Text
            position={[0, -5, 0]}
            fontSize={1.4}
            color="#555"
            anchorX="center"
            anchorY="middle"
            letterSpacing={0.4}
          >
            İNTERAKTİF KOLEKTİF SANAT ENSTALASYONU
          </Text>
        </group>

        {/* 🎭 DRAMATİK ARKA PLAN IŞIĞI (Duvara Vuran Spot) */}
        <spotLight
          position={[0, 80, -10]}
          angle={0.5}
          penumbra={1}
          intensity={15}
          color="#ffd700"
          target-position={[0, 48, -2]}
        />

        {/* KORİDOR (DUVARLAR VE ZEMİN) */}
        {/* Arka Duvar */}
        <mesh position={[0, 22, -2]} receiveShadow>
          <planeGeometry args={[200, 100]} />
          <meshStandardMaterial color="#f5f3ed" roughness={0.9} />
        </mesh>

        {/* Sol Duvar */}
        <mesh position={[-80, 22, 50]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial color="#f0ebe0" roughness={0.9} />
        </mesh>

        {/* Sağ Duvar */}
        <mesh position={[80, 22, 50]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial color="#f0ebe0" roughness={0.9} />
        </mesh>

        {/* Zemin Parke */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -8, 50]} receiveShadow>
          <planeGeometry args={[200, 150]} />
          <meshStandardMaterial
            map={WOOD_TEXTURE}
            roughness={0.4} // Daha parlak zemin
            metalness={0.2}
            repeat={[12, 12]}
          />
        </mesh>
        {/* 🎨 POST-PROCESSING (Görsel Cila) */}
        <EffectComposer disableNormalPass>
          <Bloom
            luminanceThreshold={0.9} // Eşik yükseltildi (0.8 -> 0.9) - Daha az parlama (wash-out), daha net görünüm
            mipLevels={9}
            intensity={isFinalShow ? 10.0 : 1.0} // Finalde patlama efekti
            radius={0.6}
          />
          <Vignette eskil={false} offset={0.1} darkness={0.6} /> {/* Vinyet azaltıldı (0.7 -> 0.6) */}
        </EffectComposer>
      </Canvas>

      {/* UI BUTONLARI */}
      <button type="button" onClick={() => { setShowQR(!showQR); initAudio(); }} style={{
        position: 'absolute', top: 20, right: 20, background: showQR ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(5px)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '12px 24px',
        borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', transition: 'all 0.3s ease',
        zIndex: 100, boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '8px'
      }}>
        <span style={{ fontSize: '18px' }}>🎵 / 📱</span> {showQR ? 'Kapat' : 'Başlat / Katıl'}
      </button>

      <button type="button" onClick={() => { if (window.confirm('Tüm mozaikler silinecek. Emin misiniz?')) { if (socket) socket.emit('manual-reset'); } }} style={{
        position: 'absolute', top: 70, right: 20, background: 'rgba(255, 50, 50, 0.2)', backdropFilter: 'blur(5px)',
        border: '1px solid rgba(255, 50, 50, 0.3)', color: '#ffcccc', padding: '10px 20px', borderRadius: '30px',
        cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: 'all 0.3s ease', zIndex: 100,
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '8px'
      }}>
        <span style={{ fontSize: '16px' }}>🧹</span> Temizle
      </button>

      {/* QR MODAL */}
      <div style={{
        position: 'absolute', top: 130, right: 20, opacity: showQR ? 1 : 0, pointerEvents: showQR ? 'all' : 'none',
        transform: showQR ? 'translateY(0)' : 'translateY(-20px)', transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', padding: '15px', borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
        color: 'white', fontFamily: 'sans-serif', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', width: '190px'
      }}>
        <div style={{ width: '130px', height: '130px', background: 'white', borderRadius: '8px', padding: '5px', boxSizing: 'border-box' }}>
          {qrImageURL && <img src={qrImageURL} alt="QR Kod" style={{ width: '100%', height: '100%', display: 'block' }} />}
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#ffd700' }}>TARA & KATIL</p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', opacity: 0.6, lineHeight: '1.4' }}>Aynı Wi-Fi ağında<br />olduğunuzdan emin olun</p>
        </div>
        <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
        <div style={{ textAlign: 'center', width: '100%' }}>
          <p style={{ margin: 0, fontSize: '12px', fontWeight: '700', color: '#ffd700' }}>SON OTURUM</p>
          {latestSession ? (
            <>
              <div style={{ width: '130px', height: '130px', background: 'white', borderRadius: '8px', padding: '5px', boxSizing: 'border-box', margin: '8px auto 6px' }}>
                <img src={sessionQrUrl} alt="Oturum QR" style={{ width: '100%', height: '100%', display: 'block' }} />
              </div>
              <a href={sessionDownloadUrl} style={{ color: '#fff', fontSize: '11px', textDecoration: 'underline' }}>Oturumu indir (JSON)</a>
            </>
          ) : (
            <p style={{ margin: '6px 0 0', fontSize: '11px', opacity: 0.6 }}>{sessionError ? 'Oturum bulunamadı' : 'Henüz oturum yok'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
