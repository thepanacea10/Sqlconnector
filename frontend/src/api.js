const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiBaseUrl}${path}`;
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'تعذر تنفيذ الطلب');
  }

  return data;
}

export const api = {
  status: () => request('/api/status'),
  savedConnections: () => request('/api/connections'),
  useSavedConnection: (id) =>
    request(`/api/connections/${encodeURIComponent(id)}/use`, {
      method: 'POST'
    }),
  testConnection: (payload) =>
    request('/api/test-connection', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  saveConnection: (payload) =>
    request('/api/save-connection', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  customers: (search) => request(`/api/customers?search=${encodeURIComponent(search || '')}`),
  suppliers: (search) => request(`/api/suppliers?search=${encodeURIComponent(search || '')}`),
  supplierLedger: (id, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    return request(`/api/supplier/${encodeURIComponent(id)}/ledger${query ? `?${query}` : ''}`);
  },
  supplierInvoices: (id) => request(`/api/supplier/${encodeURIComponent(id)}/invoices`),
  supplierPayments: (id) => request(`/api/supplier/${encodeURIComponent(id)}/payments`),
  customerLedger: (id, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    return request(`/api/customer/${encodeURIComponent(id)}/ledger${query ? `?${query}` : ''}`);
  },
  customerInvoices: (id) => request(`/api/customer/${encodeURIComponent(id)}/invoices`),
  customerReceipts: (id) => request(`/api/customer/${encodeURIComponent(id)}/receipts`),
  salesInvoice: (movementNo) => request(`/api/invoices/sales/${encodeURIComponent(movementNo)}`),
  purchaseInvoice: (movementNo) => request(`/api/invoices/purchases/${encodeURIComponent(movementNo)}`),
  items: (search) => request(`/api/items?search=${encodeURIComponent(search || '')}`),
  itemStock: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/items/stock?${params.toString()}`);
  },
  itemSearch: (query) => request(`/api/items/search?query=${encodeURIComponent(query || '')}`),
  itemTrack: (itemId) => request(`/api/items/track?itemId=${encodeURIComponent(itemId || '')}`),
  outOfStockItems: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/items/out-of-stock?${params.toString()}`);
  },
  itemExpiry: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/items/expiry?${params.toString()}`);
  },
  shortages: () => request('/api/shortages'),
  expiry: (days) => request(`/api/expiry?days=${encodeURIComponent(days)}`),
  salesToday: (date) => request(`/api/sales-today?date=${encodeURIComponent(date || '')}`),
  tradingProfit: ({ dateFrom, dateTo } = {}) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return request(`/api/trading-profit?${params.toString()}`);
  },
  revenueDetails: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/revenue-details?${params.toString()}`);
  },
  revenueDiagnostics: (date) => request(`/api/revenue-diagnostics?date=${encodeURIComponent(date || '')}`),
  revenueMovement: (id) => request(`/api/revenue-movement/${encodeURIComponent(id)}`),
  analyticsGlobalSearch: (q) => request(`/api/analytics/global-search?q=${encodeURIComponent(q || '')}`),
  analyticsItemCard: (itemId) => request(`/api/analytics/item-card?itemId=${encodeURIComponent(itemId || '')}`),
  analyticsDailyProfit: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/analytics/daily-profit?${params.toString()}`);
  },
  analyticsSmartShortages: () => request('/api/analytics/smart-shortages'),
  analyticsExpiry: (days) => request(`/api/analytics/expiry?days=${encodeURIComponent(days || 90)}`),
  analyticsPriceChanges: () => request('/api/analytics/price-changes'),
  analyticsItemProfit: (itemId, filters = {}) => {
    const params = new URLSearchParams();
    params.set('itemId', itemId || '');
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/analytics/item-profit?${params.toString()}`);
  },
  analyticsComparePeriods: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/analytics/compare-periods?${params.toString()}`);
  },
  analyticsUsersReport: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/analytics/users-report?${params.toString()}`);
  },
  analyticsGoodsCapital: () => request('/api/analytics/goods-capital'),
  analyticsAlerts: () => request('/api/analytics/alerts'),
  analyticsManagerDashboard: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/analytics/manager-dashboard?${params.toString()}`);
  },
  analyticsItemTimeline: (itemId) => request(`/api/analytics/item-timeline?itemId=${encodeURIComponent(itemId || '')}`),
  report: (name, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    return request(`/api/reports/${encodeURIComponent(name)}?${params.toString()}`);
  },
  queryReadonly: (query) =>
    request('/api/query-readonly', {
      method: 'POST',
      body: JSON.stringify({ query })
    }),
  aiContext: () => request('/api/ai/context'),
  aiChat: (payload) =>
    request('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  aiAsk: (payload) =>
    request('/api/ai/ask', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  aiSaveKnowledge: (payload) =>
    request('/api/ai/knowledge', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  aiExploreTable: (table) => request(`/api/ai/explorer/${encodeURIComponent(table || '')}`)
};
