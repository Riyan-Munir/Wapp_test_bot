// server.js
require('dotenv').config();
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const logger  = require('./src/utils/logger');

const { initWhatsApp, isWhatsAppReady, getLatestQR, getLatestQRString, isQRPending, qrEventEmitter, listGroups } = require('./src/whatsapp/whatsappClient');
const { startScheduler, stopScheduler, triggerManualCheck } = require('./src/scheduler/scheduler');
const { refreshSession, closeBrowser }                      = require('./src/scraper/cmsScraper');
const { getAllRecords }                                      = require('./src/utils/notificationStore');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// ── SSE QR events ─────────────────────────────────────────────────────────────
app.get('/qr/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  if      (isWhatsAppReady())    send('ready', null);
  else if (getLatestQR())        send('qr', getLatestQR());
  else if (getLatestQRString())  send('qr_raw', getLatestQRString());
  else                           send('waiting', null);

  const onQR   = d  => send('qr', d);
  const onRaw  = r  => send('qr_raw', r);
  const onRdy  = () => { send('ready', null); cleanup(); };
  const onDisc = () => send('waiting', null);

  qrEventEmitter.on('qr', onQR); qrEventEmitter.on('qr_raw', onRaw);
  qrEventEmitter.on('ready', onRdy); qrEventEmitter.on('disconnected', onDisc);

  function cleanup() {
    qrEventEmitter.off('qr', onQR); qrEventEmitter.off('qr_raw', onRaw);
    qrEventEmitter.off('ready', onRdy); qrEventEmitter.off('disconnected', onDisc);
  }
  req.on('close', cleanup);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => clearInterval(ping));
});

// ── QR page ───────────────────────────────────────────────────────────────────
app.get('/qr', (_, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html><head><title>WhatsApp Login</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#fff;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161616;border-radius:20px;padding:32px;display:flex;flex-direction:column;align-items:center;gap:20px;box-shadow:0 0 40px rgba(37,211,102,.1);max-width:380px;width:100%}
h1{font-size:18px;color:#25D366;text-align:center}
.qr-wrap{background:#fff;border-radius:12px;padding:10px;border:3px solid #25D366;width:264px;height:264px;display:flex;align-items:center;justify-content:center;position:relative}
#qr-img{width:244px;height:244px;display:none}
#qr-canvas{display:none;align-items:center;justify-content:center}
#loading{display:flex;flex-direction:column;align-items:center;gap:10px;position:absolute}
.dots{display:flex;gap:6px}.dot{width:8px;height:8px;border-radius:50%;background:#25D366;animation:p 1.2s ease-in-out infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes p{0%,100%{opacity:.15;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
.steps{width:100%;display:flex;flex-direction:column;gap:8px}
.step{background:#1f1f1f;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;font-size:12px;color:#ccc}
.num{background:#25D366;color:#000;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:11px;flex-shrink:0}
#status{font-size:12px;color:#888;text-align:center}#timer{font-size:11px;color:#555;text-align:center;display:none}
.badge{background:#25D366;color:#000;padding:8px 24px;border-radius:999px;font-weight:bold;font-size:16px;display:none}
</style></head><body><div class="card">
<h1 id="title">📱 Scan to Connect WhatsApp</h1>
<div class="badge" id="badge">✓ WhatsApp Connected</div>
<div class="qr-wrap" id="wrap">
  <div id="loading"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><p style="color:#888;font-size:12px" id="lt">Starting...</p></div>
  <img id="qr-img"/><div id="qr-canvas"></div>
</div>
<div class="steps" id="steps">
  <div class="step"><div class="num">1</div>Open WhatsApp on your phone</div>
  <div class="step"><div class="num">2</div>Tap ⋮ → Linked Devices</div>
  <div class="step"><div class="num">3</div>Tap Link a Device → scan here</div>
</div>
<p id="status">Connecting...</p><p id="timer"></p>
</div><script>
const img=document.getElementById('qr-img'),cv=document.getElementById('qr-canvas'),
ld=document.getElementById('loading'),lt=document.getElementById('lt'),
st=document.getElementById('status'),ti=document.getElementById('timer'),
badge=document.getElementById('badge'),wrap=document.getElementById('wrap'),
steps=document.getElementById('steps'),title=document.getElementById('title');
let exp=null;
function showQR(src){ld.style.display='none';cv.style.display='none';img.src=src;img.style.display='block';st.textContent='QR ready — scan now';ti.style.display='block';startTimer(60);}
function showRaw(raw){ld.style.display='none';img.style.display='none';cv.innerHTML='';try{new QRCode(cv,{text:raw,width:244,height:244});cv.style.display='flex';}catch(e){st.textContent='QR error — refresh';}st.textContent='QR ready — scan now';ti.style.display='block';startTimer(60);}
function showReady(){wrap.style.display='none';steps.style.display='none';badge.style.display='block';title.textContent='✅ WhatsApp Connected';st.textContent='Bot running.';ti.style.display='none';if(exp)clearInterval(exp);}
function showWait(){ld.style.display='flex';lt.textContent='Waiting for QR...';img.style.display='none';cv.style.display='none';st.textContent='QR will appear shortly...';}
function startTimer(s){if(exp)clearInterval(exp);let r=s;ti.textContent='Expires in '+r+'s';exp=setInterval(()=>{r--;ti.textContent=r>0?'Expires in '+r+'s':'Waiting for new QR...';if(r<=0)clearInterval(exp);},1000);}
(function connect(){const es=new EventSource('/qr/events');es.onmessage=e=>{const{type,data}=JSON.parse(e.data);if(type==='qr')showQR(data);else if(type==='qr_raw')showRaw(data);else if(type==='ready')showReady();else showWait();};es.onerror=()=>{st.textContent='Reconnecting...';es.close();setTimeout(connect,3000);};})();
</script></body></html>`);
});

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', whatsappReady: isWhatsAppReady(), qrPending: isQRPending(), uptime: Math.floor(process.uptime()) }));

app.get('/groups', async (_, res) => {
  if (!isWhatsAppReady()) return res.status(503).json({ error: 'WhatsApp not ready. Visit /qr.' });
  try { res.json({ groups: await listGroups() }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/assignments', (_, res) => {
  const r = getAllRecords();
  res.json({ count: Object.keys(r).length, records: r });
});

app.post('/check', (_, res) => {
  res.json({ message: 'Manual check triggered.' });
  triggerManualCheck().catch(e => logger.error(`Manual check: ${e.message}`));
});

app.post('/refresh-session', (_, res) => {
  res.json({ message: 'Session refresh triggered.' });
  refreshSession().catch(e => logger.error(`Manual refresh: ${e.message}`));
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  logger.info('Shutting down...');
  stopScheduler();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── WhatsApp retry loop ───────────────────────────────────────────────────────
async function startWhatsApp(attempt = 1) {
  try {
    logger.info(`WhatsApp init attempt #${attempt}...`);
    await initWhatsApp();
  } catch (err) {
    logger.error(`WhatsApp init failed: ${err.message}`);
    const delay = Math.min(30000 * attempt, 120000);
    logger.info(`Retrying in ${delay / 1000}s...`);
    setTimeout(() => startWhatsApp(attempt + 1), delay);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const url = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`;
  logger.info('═══════════════════════════════════════');
  logger.info('   Bahria CMS Assignment Bot Started   ');
  logger.info('═══════════════════════════════════════');
  logger.info(`QR Page:   ${url}/qr`);
  logger.info(`Health:    ${url}/health`);
  logger.info(`Groups:    ${url}/groups`);
  logger.info('───────────────────────────────────────');
  startScheduler();
  startWhatsApp();
});
