// src/scheduler/scheduler.js
const cron = require('node-cron');
const { scrapeAssignments, refreshSession } = require('../scraper/cmsScraper');
const { processAssignments }               = require('./assignmentProcessor');
const { isWhatsAppReady }                  = require('../whatsapp/whatsappClient');
const logger                               = require('../utils/logger');

let checkTask   = null;
let refreshTask = null;
let running     = false;

function waitForWhatsApp() {
  if (isWhatsAppReady()) return Promise.resolve();
  logger.info('Waiting for WhatsApp... (open /qr to scan)');
  return new Promise(resolve => {
    const t = setInterval(() => { if (isWhatsAppReady()) { clearInterval(t); resolve(); } }, 5000);
  });
}

async function runCheck() {
  if (running) { logger.warn('Check already running — skipping.'); return; }
  running = true;
  logger.info('── Assignment check started ──');
  try {
    await waitForWhatsApp();
    const assignments = await scrapeAssignments();
    await processAssignments(assignments);
    logger.info(`── Check complete (${assignments.length} assignments) ──`);
  } catch (err) {
    logger.error(`Check failed: ${err.message}`);
  } finally {
    running = false;
  }
}

function startScheduler() {
  const checkMins    = parseInt(process.env.CHECK_INTERVAL_MINUTES || '30', 10);
  const refreshHours = parseInt(process.env.SESSION_REFRESH_HOURS  || '6',  10);

  logger.info(`Scheduler: check every ${checkMins}min, session refresh every ${refreshHours}hr`);

  checkTask = cron.schedule(`*/${checkMins} * * * *`, runCheck);

  refreshTask = cron.schedule(`0 */${refreshHours} * * *`, () => {
    logger.info('Scheduled session refresh.');
    refreshSession().catch(e => logger.error(`Refresh error: ${e.message}`));
  });

  // First check 10s after startup
  setTimeout(runCheck, 10000);
}

function stopScheduler() {
  checkTask?.stop();
  refreshTask?.stop();
  checkTask = null; refreshTask = null;
  logger.info('Scheduler stopped.');
}

module.exports = { startScheduler, stopScheduler, triggerManualCheck: runCheck };
