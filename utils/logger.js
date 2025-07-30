// utils/logger.js
// Utility functions for logging

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generates a timestamped log file path
 * @returns {string} The path to the log file
 */
function getTimestampedLogFilePath() {
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return path.join(logsDir, `import_timetable_${timestamp}.log`);
}

// Initialize log file path
const logFilePath = getTimestampedLogFilePath();

/**
 * Logs a message to both console and file
 * @param {string} msg - The message to log
 */
function logMessage(msg) {
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}`;
    console.log(fullMsg);
    fs.appendFileSync(logFilePath, fullMsg + "\n");
}

export { getTimestampedLogFilePath, logMessage };
