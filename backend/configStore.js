import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from './paths.js';

const connectionConfigPath = resolveProjectPath(
  process.env.CONNECTION_CONFIG_PATH,
  './config/connection.json'
);

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeConnectionSettings(input = {}) {
  const settings = {
    server: String(input.server ?? input.SQL_SERVER ?? '').trim(),
    database: String(input.database ?? input.SQL_DATABASE ?? '').trim(),
    user: String(input.user ?? input.username ?? input.SQL_USER ?? '').trim(),
    password: String(input.password ?? input.SQL_PASSWORD ?? ''),
    port: readNumber(input.port ?? input.SQL_PORT, 1433),
    encrypt: toBoolean(input.encrypt ?? input.SQL_ENCRYPT, false),
    trustServerCertificate: toBoolean(
      input.trustServerCertificate ?? input.SQL_TRUST_SERVER_CERTIFICATE,
      true
    ),
    tdsVersion: String(input.tdsVersion ?? input.SQL_TDS_VERSION ?? '7_3_A').trim(),
    lastConnectionAt: input.lastConnectionAt ?? null
  };

  const missing = [];
  if (!settings.server) missing.push('server');
  if (!settings.database) missing.push('database');
  if (!settings.user) missing.push('user');

  if (missing.length) {
    const error = new Error(`Missing SQL connection fields: ${missing.join(', ')}`);
    error.code = 'INVALID_CONNECTION_SETTINGS';
    error.statusCode = 400;
    throw error;
  }

  return settings;
}

function envConnectionSettings() {
  if (!process.env.SQL_SERVER) return null;
  return normalizeConnectionSettings({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: process.env.SQL_PORT,
    encrypt: process.env.SQL_ENCRYPT,
    trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE,
    tdsVersion: process.env.SQL_TDS_VERSION
  });
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function getConnectionSettings() {
  const fromEnv = envConnectionSettings();
  if (fromEnv) return fromEnv;

  const fromFile = await readJson(connectionConfigPath);
  return fromFile ? normalizeConnectionSettings(fromFile) : null;
}

export async function saveConnectionSettings(settings) {
  const normalized = normalizeConnectionSettings(settings);
  await fs.mkdir(path.dirname(connectionConfigPath), { recursive: true });
  await fs.writeFile(connectionConfigPath, JSON.stringify(normalized, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });

  try {
    await fs.chmod(connectionConfigPath, 0o600);
  } catch {
    // Windows may ignore POSIX modes; the file remains backend-only and gitignored.
  }

  return normalized;
}

export function publicConnectionStatus(settings, connected = false, message = '') {
  return {
    connected,
    status: connected ? 'Connected' : 'Disconnected',
    server: settings?.server ?? null,
    database: settings?.database ?? null,
    lastConnectionTime: settings?.lastConnectionAt ?? null,
    message
  };
}
