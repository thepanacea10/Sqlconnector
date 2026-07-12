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

const defaultSavedConnections = [
  {
    id: 'localhost-sqlexpress',
    name: 'Localhost SQLEXPRESS',
    server: 'localhost\\SQLEXPRESS',
    database: 'AlmohasebSQL',
    user: 'ah',
    password: '123456',
    port: null,
    encrypt: false,
    trustServerCertificate: true,
    tdsVersion: '7_3_A'
  },
  {
    id: 'desktop-sqlexpress',
    name: 'DESKTOP SQLEXPRESS',
    server: 'DESKTOP-7GFVGFG\\SQLEXPRESS',
    database: 'AlmohasebSQL',
    user: 'ah',
    password: '123456',
    port: null,
    encrypt: false,
    trustServerCertificate: true,
    tdsVersion: '7_3_A'
  }
];

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
    return JSON.parse(raw.trimStart());
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function connectionId(settings) {
  return String(settings.id || `${settings.server}-${settings.database}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSavedConnection(input = {}) {
  const normalized = normalizeConnectionSettings(input);
  return {
    id: connectionId(input),
    name: String(input.name || input.label || input.server || 'SQL Server').trim(),
    ...normalized
  };
}

function publicSavedConnection(connection) {
  return {
    id: connection.id,
    name: connection.name,
    server: connection.server,
    database: connection.database,
    user: connection.user,
    port: connection.port,
    encrypt: connection.encrypt,
    trustServerCertificate: connection.trustServerCertificate,
    tdsVersion: connection.tdsVersion,
    lastConnectionAt: connection.lastConnectionAt ?? null
  };
}

function mergeConnections(...groups) {
  const byId = new Map();
  groups.flat().filter(Boolean).forEach((connection) => {
    const normalized = normalizeSavedConnection(connection);
    byId.set(normalized.id, { ...byId.get(normalized.id), ...normalized });
  });
  return Array.from(byId.values());
}

async function readConnectionConfig() {
  const raw = await readJson(connectionConfigPath);
  if (!raw) {
    const savedConnections = mergeConnections(defaultSavedConnections);
    return {
      activeConnectionId: savedConnections[0]?.id ?? null,
      activeConnection: savedConnections[0] ?? null,
      savedConnections
    };
  }

  if (Array.isArray(raw.savedConnections) || raw.activeConnection) {
    const savedConnections = mergeConnections(defaultSavedConnections, raw.savedConnections || []);
    const activeFromFile = raw.activeConnection ? normalizeSavedConnection(raw.activeConnection) : null;
    const activeConnectionId = raw.activeConnectionId || activeFromFile?.id || savedConnections[0]?.id || null;
    const activeConnection =
      activeFromFile ||
      savedConnections.find((connection) => connection.id === activeConnectionId) ||
      savedConnections[0] ||
      null;

    return {
      activeConnectionId: activeConnection?.id || activeConnectionId,
      activeConnection,
      savedConnections: mergeConnections(savedConnections, activeConnection ? [activeConnection] : [])
    };
  }

  const legacyConnection = normalizeSavedConnection({
    id: connectionId(raw),
    name: raw.name || raw.server,
    ...raw
  });

  return {
    activeConnectionId: legacyConnection.id,
    activeConnection: legacyConnection,
    savedConnections: mergeConnections(defaultSavedConnections, [legacyConnection])
  };
}

async function writeConnectionConfig(config) {
  await fs.mkdir(path.dirname(connectionConfigPath), { recursive: true });
  await fs.writeFile(connectionConfigPath, JSON.stringify(config, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });

  try {
    await fs.chmod(connectionConfigPath, 0o600);
  } catch {
    // Windows may ignore POSIX modes; the file remains backend-only and gitignored.
  }
}

export async function getConnectionSettings() {
  const fromEnv = envConnectionSettings();
  if (fromEnv) return fromEnv;

  const config = await readConnectionConfig();
  return config.activeConnection ? normalizeConnectionSettings(config.activeConnection) : null;
}

export async function saveConnectionSettings(settings) {
  const config = await readConnectionConfig();
  const requestedId = connectionId(settings);
  const existing = config.savedConnections.find((connection) => connection.id === requestedId);
  const mergedSettings = {
    ...(existing || {}),
    ...settings,
    password: settings.password || existing?.password || ''
  };
  const normalized = normalizeSavedConnection(mergedSettings);
  const savedConnections = mergeConnections(config.savedConnections, [normalized]);
  await writeConnectionConfig({
    activeConnectionId: normalized.id,
    activeConnection: normalized,
    savedConnections
  });

  return normalized;
}

export async function getSavedConnections() {
  const config = await readConnectionConfig();
  return {
    activeConnectionId: config.activeConnectionId,
    connections: config.savedConnections.map(publicSavedConnection)
  };
}

export async function getSavedConnection(connectionId) {
  const config = await readConnectionConfig();
  return config.savedConnections.find((connection) => connection.id === connectionId) || null;
}

export async function activateSavedConnection(connectionId, testedSettings) {
  const config = await readConnectionConfig();
  const savedConnection = config.savedConnections.find((connection) => connection.id === connectionId);
  if (!savedConnection) {
    const error = new Error('Saved connection was not found.');
    error.code = 'SAVED_CONNECTION_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const activeConnection = normalizeSavedConnection({
    ...savedConnection,
    ...testedSettings,
    id: savedConnection.id,
    name: savedConnection.name
  });
  await writeConnectionConfig({
    activeConnectionId: activeConnection.id,
    activeConnection,
    savedConnections: mergeConnections(config.savedConnections, [activeConnection])
  });
  return activeConnection;
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
