// src/utils/notificationStore.js
const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

const STORE_PATH = path.join(__dirname, '../../data/notifications.json');

const key = (course, title) => `${course.trim()}::${title.trim()}`;

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch (_) { return {}; }
}

function save(store) {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2)); }
  catch (e) { logger.error(`Store save: ${e.message}`); }
}

// Point 2: deadline shown in msg = original CMS string (e.g. "11 March 8pm")
// but actual lock = end of that calendar day (23:59:59)
// The scraper already parses to 23:59 — we just store the original display string separately
function upsertRecord(courseName, title, deadlineDisplay, deadlineMs) {
  const store = load();
  const k     = key(courseName, title);
  const now   = new Date().toISOString();
  let deadlineChanged = false;

  if (store[k]) {
    // Point 4: no duplicate — only update if deadline actually changed
    if (store[k].deadlineMs !== deadlineMs) {
      deadlineChanged = true;
      logger.info(`Deadline changed for "${title}": ${store[k].deadlineDisplay} → ${deadlineDisplay}`);
      // Point 1: extension gets 2 fresh msg slots (48hr + 6hr reset), extensionSent reset too
      store[k] = {
        ...store[k],
        deadlineDisplay,
        deadlineMs,
        alert48hrSent:     false,
        alert6hrSent:      false,
        extensionNotified: false,
        isExtension:       true,   // flag so msg shows "Extended" context
        updatedAt:         now
      };
    }
    // else: same deadline, same record — no change (fixes point 4)
  } else {
    store[k] = {
      courseName,
      title,
      deadlineDisplay,  // original string from CMS for display in msg
      deadlineMs,       // end-of-day timestamp for logic
      alert48hrSent:     false,
      alert6hrSent:      false,
      extensionNotified: false,
      isExtension:       false,
      createdAt:         now,
      updatedAt:         now
    };
  }

  save(store);
  return { record: store[k], deadlineChanged };
}

function markFlags(courseName, title, flags) {
  const store = load();
  const k = key(courseName, title);
  if (store[k]) {
    Object.assign(store[k], flags, { updatedAt: new Date().toISOString() });
    save(store);
  }
}

// Point 3: remove assignment once deadline day has passed (not 7 days later)
// Uses end-of-day logic: remove when current date > deadline date
function cleanupExpired() {
  const store  = load();
  const now    = Date.now();
  let removed  = 0;

  for (const k of Object.keys(store)) {
    const { deadlineMs, alert48hrSent, alert6hrSent } = store[k];
    if (!deadlineMs) continue;

    // Past end-of-day deadline AND both notifications sent (or deadline >2 days past)
    const pastDeadline = now > deadlineMs;
    const allSent      = alert48hrSent && alert6hrSent;
    const longPast     = now - deadlineMs > 2 * 24 * 3600000; // safety: remove after 2 days regardless

    if (pastDeadline && (allSent || longPast)) {
      delete store[k];
      removed++;
    }
  }

  if (removed) { save(store); logger.info(`Removed ${removed} expired assignment(s).`); }
}

function getAllRecords() { return load(); }

module.exports = { upsertRecord, markFlags, getAllRecords, cleanupExpired };