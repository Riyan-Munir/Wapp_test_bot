// src/utils/alertService.js
// Env vars needed:
//   ADMIN_EMAIL=you@gmail.com
//   GMAIL_USER=yourbot@gmail.com
//   GMAIL_APP_PASSWORD=xxxx xxxx   (Gmail App Password, not login password)
//   ADMIN_PHONE=923001234567        (optional, WhatsApp DM when session alive)

const dns    = require('dns').promises;
const logger = require('./logger');

const lastSent = {};
const COOLDOWN = 10 * 60 * 1000;

function canSend(type) {
  const now = Date.now();
  if (lastSent[type] && now - lastSent[type] < COOLDOWN) return false;
  lastSent[type] = now;
  return true;
}

// Resolve smtp.gmail.com to IPv4 explicitly — Railway can't reach Gmail over IPv6
async function resolveIPv4(hostname) {
  try {
    const results = await dns.resolve4(hostname);
    if (results && results.length) return results[0];
  } catch (_) {}
  return hostname; // fallback to hostname if DNS fails
}

async function sendEmail(subject, body) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to   = process.env.ADMIN_EMAIL;

  if (!user || !pass || !to) {
    logger.warn('[Alert] Email skipped — GMAIL_USER / GMAIL_APP_PASSWORD / ADMIN_EMAIL not set.');
    return false;
  }

  try {
    const nodemailer = require('nodemailer');
    const ipv4       = await resolveIPv4('smtp.gmail.com');
    logger.info(`[Alert] Connecting to Gmail SMTP at ${ipv4}:587`);

    const transporter = nodemailer.createTransport({
      host:   ipv4,          // IPv4 address directly — bypasses IPv6 resolution
      port:   587,
      secure: false,
      requireTLS: true,
      auth:   { user, pass },
      tls: {
        servername:          'smtp.gmail.com', // SNI still uses hostname for cert check
        rejectUnauthorized:  false
      }
    });

    await transporter.sendMail({
      from:    `"CMS Bot" <${user}>`,
      to,
      subject: `CMS Bot: ${subject}`,
      text:    `${body}\n\nTime: ${new Date().toISOString()}\nServer: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost'}`
    });

    logger.info(`[Alert] Email sent → ${to} | ${subject}`);
    return true;
  } catch (err) {
    logger.error(`[Alert] Email failed (${err.code || 'ERR'}): ${err.message}`);
    return false;
  }
}

async function sendWhatsAppDM(text) {
  const phone = process.env.ADMIN_PHONE;
  if (!phone) return false;
  try {
    const { isWhatsAppReady, sendDirectMessage } = require('../whatsapp/whatsappClient');
    if (!isWhatsAppReady()) { logger.warn('[Alert] WhatsApp DM skipped — session not ready.'); return false; }
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    await sendDirectMessage(chatId, text);
    logger.info(`[Alert] WhatsApp DM sent → ${phone}`);
    return true;
  } catch (err) {
    logger.error(`[Alert] WhatsApp DM failed: ${err.message}`);
    return false;
  }
}

async function dispatch(type, subject, message, emailOnly = false) {
  logger.info(`[Alert] Dispatching "${type}"...`);
  if (!canSend(type)) { logger.info(`[Alert] "${type}" suppressed (cooldown).`); return; }

  const waText = `🤖 *CMS Bot Alert*\n\n${message}\n\n⏰ ${new Date().toISOString()}`;
  if (!emailOnly) await sendWhatsAppDM(waText);
  await sendEmail(subject, message);
}

module.exports = {
  whatsappDisconnected: (reason) =>
    dispatch('wa_disconnected', 'WhatsApp Session Disconnected',
      `WhatsApp session disconnected.\n\nReason: ${reason}\n\nOpen /qr to re-authenticate:\nhttps://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}/qr`,
      true),

  whatsappAuthFailed: (msg) =>
    dispatch('wa_auth_fail', 'WhatsApp Auth Failed',
      `WhatsApp auth failed.\n\nError: ${msg}\n\nOpen /qr to re-scan:\nhttps://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}/qr`,
      true),

  qrRequired: () =>
    dispatch('qr_required', 'WhatsApp QR Scan Required',
      `WhatsApp session not found — QR scan needed.\n\nOpen /qr to link WhatsApp:\nhttps://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}/qr`,
      true),

  cmsLoginFailed: (err) =>
    dispatch('cms_login', 'CMS Login Failed',
      `CMS login failed.\n\nError: ${err}\n\nCheck CMS_ENROLLMENT and CMS_PASSWORD env vars.`),

  scrapeFailed: (err) =>
    dispatch('scrape_fail', 'CMS Scrape Failed',
      `CMS scrape failed.\n\nError: ${err}`),

  sendFailed: (type) =>
    dispatch('send_fail', `WhatsApp Group Send Failed (${type})`,
      `Failed to deliver ${type} notification to the group after all retries.\n\nStudents did NOT receive this message.`),
};