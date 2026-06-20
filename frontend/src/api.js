async function request(path, options = {}) {
  const response = await fetch(path, {
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
  supplierLedger: (id) => request(`/api/supplier/${encodeURIComponent(id)}/ledger`),
  supplierInvoices: (id) => request(`/api/supplier/${encodeURIComponent(id)}/invoices`),
  supplierPayments: (id) => request(`/api/supplier/${encodeURIComponent(id)}/payments`),
  customerLedger: (id) => request(`/api/customer/${encodeURIComponent(id)}/ledger`),
  customerInvoices: (id) => request(`/api/customer/${encodeURIComponent(id)}/invoices`),
  customerReceipts: (id) => request(`/api/customer/${encodeURIComponent(id)}/receipts`),
  items: (search) => request(`/api/items?search=${encodeURIComponent(search || '')}`),
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
  aiSaveKnowledge: (payload) =>
    request('/api/ai/knowledge', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  aiExploreTable: (table) => request(`/api/ai/explorer/${encodeURIComponent(table || '')}`)
};
