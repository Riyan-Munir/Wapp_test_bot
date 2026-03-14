// src/scheduler/assignmentProcessor.js
const store            = require('../utils/notificationStore');
const { sendMessage }  = require('../whatsapp/whatsappClient');
const { closeBrowser } = require('../scraper/cmsScraper');
const messages         = require('../whatsapp/messages');
const alerts           = require('../utils/alertService');
const logger           = require('../utils/logger');

const H48 = 48 * 3600000;
const H6  =  6 * 3600000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function processAssignments(assignments) {
  const now = Date.now();

  const batch48    = [];
  const batch6     = [];
  const extensions = [];

  for (const a of assignments) {
    const { courseName, title, deadline: deadlineDisplay, deadlineMs } = a;
    if (!deadlineMs) { logger.warn(`No deadline parsed for "${title}".`); continue; }

    const { record, deadlineChanged } = store.upsertRecord(courseName, title, deadlineDisplay, deadlineMs);

    if (deadlineMs < now) continue;

    const remaining   = deadlineMs - now;
    const isSudden    = remaining <= 24 * 3600000;
    const isExtension = record.isExtension || false;
    const within6hr   = remaining <= H6;
    const within48hr  = remaining <= H48;

    if (deadlineChanged && !record.extensionNotified)
      extensions.push({ courseName, title, deadlineDisplay });

    if (within6hr) {
      // Auto-mark 48hr as sent — no point sending it when 6hr is imminent
      if (!record.alert48hrSent) {
        store.markFlags(courseName, title, { alert48hrSent: true });
        record.alert48hrSent = true;
      }
      if (!record.alert6hrSent)
        batch6.push({ courseName, title, deadlineDisplay, isExtension });
    } else if (within48hr) {
      if (!record.alert48hrSent)
        batch48.push({ courseName, title, deadlineDisplay, isSudden, isExtension });
    }
  }

  const totalPending = extensions.length + (batch48.length > 0 ? 1 : 0) + (batch6.length > 0 ? 1 : 0);

  if (totalPending === 0) {
    logger.info('No notifications to send.');
    store.cleanupExpired();
    return;
  }

  logger.info(`Closing scraper browser, waiting for memory reclaim...`);
  await closeBrowser();
  await sleep(4000);

  // Extension alerts
  for (const { courseName, title, deadlineDisplay } of extensions) {
    logger.info(`Sending extension alert: "${title}"`);
    const sent = await safeSend(messages.alertExtended({ courseName, title, deadlineDisplay }));
    if (sent) store.markFlags(courseName, title, { extensionNotified: true });
    else logger.error(`Extension alert failed for "${title}" — will retry next cycle.`);
    await sleep(3000);
  }

  // 48hr batch
  if (batch48.length > 0) {
    logger.info(`Sending 48hr batch: ${batch48.length} assignment(s).`);
    const sent = await safeSend(messages.alert48hrBatch(batch48));
    if (sent) {
      for (const { courseName, title } of batch48)
        store.markFlags(courseName, title, { alert48hrSent: true });
      logger.info('48hr batch sent.');
    } else {
      alerts.sendFailed('48hr');
      logger.error('48hr batch failed — will retry next cycle.');
    }
    await sleep(3000);
  }

  // 6hr batch
  if (batch6.length > 0) {
    logger.info(`Sending 6hr batch: ${batch6.length} assignment(s).`);
    const sent = await safeSend(messages.alert6hrBatch(batch6));
    if (sent) {
      for (const { courseName, title } of batch6)
        store.markFlags(courseName, title, { alert6hrSent: true });
      logger.info('6hr batch sent.');
    } else {
      alerts.sendFailed('6hr');
      logger.error('6hr batch failed — will retry next cycle.');
    }
  }

  store.cleanupExpired();
}

async function safeSend(text, retries = 5, delay = 8000) {
  for (let i = 1; i <= retries; i++) {
    try { await sendMessage(text); return true; }
    catch (err) {
      logger.error(`Send attempt ${i}/${retries}: ${err.message}`);
      if (i < retries) await sleep(delay);
    }
  }
  return false;
}

module.exports = { processAssignments };