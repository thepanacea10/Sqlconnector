import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { testConnection, executeReadonlyQuery, closePool } from './db.js';
import {
  activateSavedConnection,
  getSavedConnection,
  getSavedConnections,
  getConnectionSettings,
  publicConnectionStatus,
  saveConnectionSettings
} from './configStore.js';
import { projectRoot } from './paths.js';
import * as almohasebProfile from './profiles/almohasebProfile.js';
import {
  createAssistantResponse,
  getDatabaseContext,
  inspectTable,
  saveKnowledgeNote
} from './aiAssistant.js';
import { processAssistantMessage } from './services/aiAssistant.js';
import { askSqlAssistant } from './services/sqlAiAssistant.js';
import { startTelegramBot } from './telegramBot.js';

const app = express();
const host = process.env.API_HOST || '0.0.0.0';
const port = Number(process.env.API_PORT || 3001);
const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const appVersion = packageInfo.version || '0.0.0';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function backendRuntimeStatus() {
  return {
    backend: {
      host,
      port,
      version: appVersion
    }
  };
}

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
    const existingConnection = req.body?.id ? await getSavedConnection(req.body.id) : null;
    const connectionInput = {
      ...(existingConnection || {}),
      ...req.body,
      password: req.body?.password || existingConnection?.password || ''
    };
    const settings = await testConnection(connectionInput);
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
    const existingConnection = req.body?.id ? await getSavedConnection(req.body.id) : null;
    const connectionInput = {
      ...(existingConnection || {}),
      ...req.body,
      password: req.body?.password || existingConnection?.password || ''
    };
    const testedSettings = await testConnection(connectionInput);
    const savedSettings = await saveConnectionSettings({
      ...connectionInput,
      ...testedSettings,
      id: connectionInput.id,
      name: connectionInput.name
    });
    await closePool();

    res.json({
      success: true,
      message: 'Saved',
      connection: publicConnectionStatus(savedSettings, true, 'Connected')
    });
  })
);

app.get(
  '/api/connections',
  asyncRoute(async (_req, res) => {
    const result = await getSavedConnections();
    res.json({
      success: true,
      ...result
    });
  })
);

app.post(
  '/api/connections/:id/use',
  asyncRoute(async (req, res) => {
    const savedConnection = await getSavedConnection(req.params.id);
    if (!savedConnection) {
      res.status(404).json({ success: false, message: 'Saved connection was not found.' });
      return;
    }

    const testedSettings = await testConnection(savedConnection);
    const activeConnection = await activateSavedConnection(req.params.id, testedSettings);
    await closePool();

    res.json({
      success: true,
      message: 'Connected',
      connection: publicConnectionStatus(activeConnection, true, 'Connected')
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
        ...backendRuntimeStatus(),
        ...publicConnectionStatus(null, false, 'Connection is not configured')
      });
      return;
    }

    try {
      await executeReadonlyQuery('SELECT 1 AS ok');
      res.json({
        success: true,
        profile: 'almohaseb',
        ...backendRuntimeStatus(),
        ...publicConnectionStatus(settings, true, 'Connected')
      });
    } catch (error) {
      res.json({
        success: false,
        profile: 'almohaseb',
        ...backendRuntimeStatus(),
        ...publicConnectionStatus(settings, false, messageFromError(error))
      });
    }
  })
);

app.post(
  '/api/chat',
  asyncRoute(async (req, res) => {
    const result = await processAssistantMessage(req.body?.message);
    res.json({
      success: true,
      response: result.response
    });
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
  '/api/ai/context',
  asyncRoute(async (_req, res) => {
    const context = await getDatabaseContext();
    res.json({ success: true, ...context });
  })
);

app.post(
  '/api/ai/ask',
  asyncRoute(async (req, res) => {
    const result = await askSqlAssistant(req.body?.question);
    res.json({ success: true, ...result });
  })
);

app.post(
  '/api/ai/chat',
  asyncRoute(async (req, res) => {
    const response = await createAssistantResponse({
      message: req.body?.message,
      expectedValue: req.body?.expectedValue,
      actualValue: req.body?.actualValue
    });
    res.json({ success: true, message: response });
  })
);

app.get(
  '/api/ai/explorer/:table',
  asyncRoute(async (req, res) => {
    const result = await inspectTable(req.params.table);
    res.json({ success: true, ...result });
  })
);

app.post(
  '/api/ai/knowledge',
  asyncRoute(async (req, res) => {
    const knowledge = await saveKnowledgeNote({
      topic: req.body?.topic,
      text: req.body?.text
    });
    res.json({ success: true, knowledge });
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
  '/api/supplier/:id/ledger',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getSupplierStatement(req.params.id, req.query || {});
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/supplier/:id/invoices',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getSupplierInvoices(req.params.id);
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/supplier/:id/payments',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getSupplierPayments(req.params.id);
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/supplier/:id/diagnostics',
  asyncRoute(async (req, res) => {
    const diagnostics = await almohasebProfile.getSupplierDiagnostics(req.params.id);
    res.json({ success: true, profile: 'almohaseb', diagnostics });
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
    const rows = await almohasebProfile.getCustomerStatement(req.params.id, req.query || {});
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
  '/api/invoices/sales/:movementNo',
  asyncRoute(async (req, res) => {
    const invoice = await almohasebProfile.getSalesInvoiceDetails(req.params.movementNo);
    if (!invoice.header) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }
    res.json({ success: true, profile: 'almohaseb', ...invoice });
  })
);

app.get(
  '/api/invoices/purchases/:movementNo',
  asyncRoute(async (req, res) => {
    const invoice = await almohasebProfile.getPurchaseInvoiceDetails(req.params.movementNo);
    if (!invoice.header) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }
    res.json({ success: true, profile: 'almohaseb', ...invoice });
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
  '/api/items/stock',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getItemStock({
      search: req.query.search,
      availableOnly: req.query.availableOnly,
      sort: req.query.sort,
      limit: req.query.limit
    });
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/items/search',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.searchItems({ query: req.query.query });
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/items/track',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.trackItem({ itemId: req.query.itemId });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/items/out-of-stock',
  asyncRoute(async (req, res) => {
    const rows = await almohasebProfile.getOutOfStockItems({
      search: req.query.search,
      sort: req.query.sort
    });
    res.json({ success: true, profile: 'almohaseb', rows });
  })
);

app.get(
  '/api/items/expiry',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getItemExpiryReport({
      search: req.query.search,
      days: req.query.days
    });
    res.json({ success: true, profile: 'almohaseb', ...result });
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
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getSalesToday({ date: req.query.date });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/trading-profit',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getTradingProfit({
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/trading-profit-debug',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getTradingProfitDebug({
      date: req.query.date
    });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/revenue-details',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getRevenueDetails({
      date: req.query.date,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      sellerId: req.query.sellerId,
      period: req.query.period,
      paymentMethod: req.query.paymentMethod,
      movementType: req.query.movementType,
      expectedTotal: req.query.expectedTotal
    });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/revenue-diagnostics',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getRevenueDiagnostics({ date: req.query.date });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/revenue-movement/:id',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getRevenueMovementDetails(req.params.id);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/global-search',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsGlobalSearch({ q: req.query.q });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/item-card',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsItemCard({ itemId: req.query.itemId });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/daily-profit',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsDailyProfit(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/smart-shortages',
  asyncRoute(async (_req, res) => {
    const result = await almohasebProfile.analyticsSmartShortages();
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/expiry',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsExpiry({ days: req.query.days });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/price-changes',
  asyncRoute(async (_req, res) => {
    const result = await almohasebProfile.analyticsPriceChanges();
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/item-profit',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsItemProfit(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/compare-periods',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsComparePeriods(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/users-report',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsUsersReport(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/goods-capital',
  asyncRoute(async (_req, res) => {
    const result = await almohasebProfile.analyticsGoodsCapital();
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/alerts',
  asyncRoute(async (_req, res) => {
    const result = await almohasebProfile.analyticsAlerts();
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/manager-dashboard',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsManagerDashboard(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/analytics/item-timeline',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.analyticsItemTimeline({ itemId: req.query.itemId });
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/reports/purchases',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getPurchasesReport(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/reports/sales',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getSalesReport(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/reports/supplier-payments',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getSupplierPaymentsReport(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/reports/customer-receipts',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getCustomerReceiptsReport(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/reports/returns',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getReturnsReport(req.query);
    res.json({ success: true, profile: 'almohaseb', ...result });
  })
);

app.get(
  '/api/reports/item-movements',
  asyncRoute(async (req, res) => {
    const result = await almohasebProfile.getItemMovementReport(req.query);
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
  startTelegramBot();
});
