import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { testConnection, executeReadonlyQuery, closePool } from './db.js';
import {
  getConnectionSettings,
  publicConnectionStatus,
  saveConnectionSettings
} from './configStore.js';
import { projectRoot } from './paths.js';
import * as almohasebProfile from './profiles/almohasebProfile.js';

const app = express();
const host = process.env.API_HOST || '0.0.0.0';
const port = Number(process.env.API_PORT || 3001);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function messageFromError(error) {
  if (error?.originalError?.message) return error.originalError.message;
  if (error?.precedingErrors?.length) {
    return error.precedingErrors.map((item) => item.message).join(' ');
  }
  return error?.message || 'Unexpected error';
}

app.post(
  '/api/test-connection',
  asyncRoute(async (req, res) => {
    const settings = await testConnection(req.body);
    res.json({
      success: true,
      message: 'Connected',
      connection: publicConnectionStatus(settings, true, 'Connected')
    });
  })
);

app.post(
  '/api/save-connection',
  asyncRoute(async (req, res) => {
    const testedSettings = await testConnection(req.body);
    const savedSettings = await saveConnectionSettings(testedSettings);
    await closePool();

    res.json({
      success: true,
      message: 'Saved',
      connection: publicConnectionStatus(savedSettings, true, 'Connected')
    });
  })
);

app.get(
  '/api/status',
  asyncRoute(async (_req, res) => {
    const settings = await getConnectionSettings();
    if (!settings) {
      res.json({
        success: true,
        profile: 'almohaseb',
        ...publicConnectionStatus(null, false, 'Connection is not configured')
      });
      return;
    }

    try {
      await executeReadonlyQuery('SELECT 1 AS ok');
      res.json({
        success: true,
        profile: 'almohaseb',
        ...publicConnectionStatus(settings, true, 'Connected')
      });
    } catch (error) {
      res.json({
        success: false,
        profile: 'almohaseb',
        ...publicConnectionStatus(settings, false, messageFromError(error))
      });
    }
  })
);

app.post(
  '/api/query-readonly',
  asyncRoute(async (req, res) => {
    const result = await executeReadonlyQuery(req.body?.query);
    res.json({
      success: true,
      rows: result.recordset || [],
      rowsAffected: result.rowsAffected || []
    });
  })
);

app.get(
  '/api/customers',
  asyncRoute(async (req, res) => {
    const customers = await almohasebProfile.getCustomers({ search: req.query.search });
    res.json({ success: true, profile: 'almohaseb', customers });
  })
);

app.get(
  '/api/suppliers',
  asyncRoute(async (req, res) => {
    const suppliers = await almohasebProfile.getSuppliers({ search: req.query.search });
    res.json({ success: true, profile: 'almohaseb', suppliers });
  })
);

app.get(
  '/api/customer/:id',
  asyncRoute(async (req, res) => {
    const customer = await almohasebProfile.getCustomer(req.params.id);
    res.json({ success: true, profile: 'almohaseb', customer });
  })
);

app.get(
  '/api/customer/:id/ledger',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getCustomerStatement(req.params.id);
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/customer/:id/invoices',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getCustomerInvoices(req.params.id);
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/customer/:id/receipts',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getCustomerReceipts(req.params.id);
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/items',
  asyncRoute(async (req, res) => {
    const items = await almohasebProfile.getInventory({ search: req.query.search });
    res.json({ success: true, profile: 'almohaseb', items });
  })
);

app.get(
  '/api/shortages',
  asyncRoute(async (_req, res) => {
    const rows = await almohasebProfile.getShortages();
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/expiry',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getExpiry({ days: req.query.days });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/sales-today',
  asyncRoute(async (_req, res) => {
    const result = await almohasebProfile.getSalesToday();
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

const distPath = path.resolve(projectRoot, 'dist');
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  const payload = {
    success: false,
    message: messageFromError(error),
    code: error.code || 'SERVER_ERROR'
  };

  if (error.sqlDiagnostics) {
    payload.sqlDiagnostics = error.sqlDiagnostics;
  }

  if (error.sqlError) {
    payload.sqlError = error.sqlError;
  }

  res.status(statusCode).json(payload);
});

app.listen(port, host, () => {
  console.log(`Teryaq SQL Connector API listening on http://${host}:${port} using Almohaseb profile`);
});
