// src/utils/logger.js
const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../data/bot.log');
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

const levels = { info: '\x1b[32mINFO\x1b[0m', warn: '\x1b[33mWARN\x1b[0m', error: '\x1b[31mERROR\x1b[0m' };

function log(level, message) {
  const ts  = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] ${level.toUpperCase()}: ${message}\n`;

  process.stdout.write(`[${ts}] ${levels[level] || level}: ${message}\n`);

  try {
    const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
    if (stat > MAX_SIZE) fs.writeFileSync(LOG_FILE, line);
    else fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
}

module.exports = {
  info:  (m) => log('info',  m),
  warn:  (m) => log('warn',  m),
  error: (m) => log('error', m)
};
