import tediousSql from 'mssql';
import msnodesqlv8Sql from 'mssql/msnodesqlv8.js';
import { getConnectionSettings, normalizeConnectionSettings } from './configStore.js';
import { validateReadonlyQuery } from './queryGuard.js';

let activePool = null;
let activePoolKey = '';

const sqlDriver = (process.env.SQL_DRIVER || (process.platform === 'win32' ? 'msnodesqlv8' : 'tedious')).toLowerCase();
const sql = sqlDriver === 'msnodesqlv8' ? msnodesqlv8Sql : tediousSql;

function parseServerName(server) {
  const rawServer = String(server || '').trim();
  const slashIndex = rawServer.indexOf('\\');

  if (slashIndex === -1) {
    return {
      rawServer,
      host: rawServer,
      instanceName: ''
    };
  }

  return {
    rawServer,
    host: rawServer.slice(0, slashIndex),
    instanceName: rawServer.slice(slashIndex + 1)
  };
}

function authenticationMode(settings) {
  return settings.user ? 'sql-password' : 'windows-integrated';
}

function escapeOdbcValue(value) {
  return String(value ?? '').replace(/}/g, '}}');
}

function buildOdbcConnectionString(settings, parsed, nativeClientDriver) {
  const serverTarget = parsed.instanceName ? settings.server : `${parsed.host},${settings.port || 1433}`;
  return [
    `Driver={${escapeOdbcValue(nativeClientDriver)}}`,
    `Server=${serverTarget}`,
    `Database=${settings.database}`,
    `Uid=${settings.user}`,
    `Pwd=${settings.password}`,
    'Trusted_Connection=No',
    `Encrypt=${settings.encrypt ? 'Yes' : 'No'}`,
    `TrustServerCertificate=${settings.trustServerCertificate ? 'Yes' : 'No'}`
  ].join(';');
}

function connectionDiagnostics(settings, config) {
  const parsed = parseServerName(settings.server);

  return {
    driver: sqlDriver,
    server: settings.server,
    resolvedServerHost: parsed.host,
    database: settings.database,
    configuredPort: settings.port,
    effectivePort: config.port ?? null,
    instanceName: parsed.instanceName || null,
    authenticationMode: authenticationMode(settings),
    encrypt: settings.encrypt,
    trustServerCertificate: settings.trustServerCertificate,
    tdsVersion: config.options.tdsVersion ?? null,
    nativeClientDriver: config.nativeClientDriver ?? null
  };
}

function serializeSqlError(error) {
  return {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    number: error?.number,
    state: error?.state,
    class: error?.class,
    serverName: error?.serverName,
    procName: error?.procName,
    lineNumber: error?.lineNumber,
    originalError: error?.originalError
      ? {
          name: error.originalError.name,
          code: error.originalError.code,
          message: error.originalError.message,
          number: error.originalError.number,
          state: error.originalError.state,
          class: error.originalError.class,
          serverName: error.originalError.serverName,
          procName: error.originalError.procName,
          lineNumber: error.originalError.lineNumber
        }
      : null,
    precedingErrors: Array.isArray(error?.precedingErrors)
      ? error.precedingErrors.map((item) => ({
          name: item?.name,
          code: item?.code,
          message: item?.message,
          number: item?.number,
          state: item?.state,
          class: item?.class,
          serverName: item?.serverName,
          procName: item?.procName,
          lineNumber: item?.lineNumber
        }))
      : []
  };
}

function logConnectionAttempt(label, diagnostics) {
  console.info(`[sql:${label}] connection diagnostics`, diagnostics);
}

function logConnectionFailure(label, diagnostics, error) {
  console.error(`[sql:${label}] mssql error`, {
    diagnostics,
    error: serializeSqlError(error)
  });
}

function decorateConnectionError(error, diagnostics) {
  error.sqlDiagnostics = diagnostics;
  error.sqlError = serializeSqlError(error);
  return error;
}

function buildSqlConfig(settings) {
  const parsed = parseServerName(settings.server);
  const config = {
    server: parsed.host,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    options: {
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate,
      tdsVersion: settings.tdsVersion || '7_3_A'
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    },
    requestTimeout: 30000,
    connectionTimeout: 15000
  };

  if (sqlDriver === 'msnodesqlv8') {
    config.options.trustedConnection = false;
    config.nativeClientDriver = process.env.SQL_ODBC_DRIVER || 'SQL Server';
    config.connectionString = buildOdbcConnectionString(settings, parsed, config.nativeClientDriver);
    delete config.options.tdsVersion;
  }

  if (parsed.instanceName) {
    config.options.instanceName = parsed.instanceName;
  } else {
    config.port = settings.port || 1433;
  }

  return config;
}

function poolKey(settings) {
  return JSON.stringify({
    server: settings.server,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    port: settings.port,
    encrypt: settings.encrypt,
    trustServerCertificate: settings.trustServerCertificate,
    tdsVersion: settings.tdsVersion,
    driver: sqlDriver
  });
}

export { sql };

export async function closePool() {
  if (activePool) {
    await activePool.close();
    activePool = null;
    activePoolKey = '';
  }
}

async function getPool() {
  const settings = await getConnectionSettings();
  if (!settings) {
    const error = new Error('SQL connection is not configured.');
    error.code = 'NO_CONNECTION_CONFIG';
    error.statusCode = 400;
    throw error;
  }

  const nextPoolKey = poolKey(settings);
  if (activePool && activePoolKey === nextPoolKey) {
    return activePool;
  }

  await closePool();
  const config = buildSqlConfig(settings);
  const diagnostics = connectionDiagnostics(settings, config);
  logConnectionAttempt('pool', diagnostics);

  try {
    activePool = await new sql.ConnectionPool(config).connect();
  } catch (error) {
    logConnectionFailure('pool', diagnostics, error);
    throw decorateConnectionError(error, diagnostics);
  }

  activePoolKey = nextPoolKey;
  return activePool;
}

export async function testConnection(input) {
  const settings = normalizeConnectionSettings(input);
  const config = buildSqlConfig(settings);
  const diagnostics = connectionDiagnostics(settings, config);
  logConnectionAttempt('test', diagnostics);

  let testPool;
  try {
    testPool = await new sql.ConnectionPool(config).connect();
    await testPool.request().query('SELECT 1 AS ok');
    console.info('[sql:test] connection succeeded', diagnostics);
  } catch (error) {
    logConnectionFailure('test', diagnostics, error);
    throw decorateConnectionError(error, diagnostics);
  } finally {
    if (testPool) {
      await testPool.close();
    }
  }

  return {
    ...settings,
    lastConnectionAt: new Date().toISOString()
  };
}

export async function executeReadonlyQuery(query, bindInputs) {
  const safeQuery = validateReadonlyQuery(query);
  const pool = await getPool();
  const request = pool.request();

  if (bindInputs) {
    bindInputs(request, sql);
  }

  return request.query(safeQuery);
}
