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
  customerLedger: (id) => request(`/api/customer/${encodeURIComponent(id)}/ledger`),
  customerInvoices: (id) => request(`/api/customer/${encodeURIComponent(id)}/invoices`),
  customerReceipts: (id) => request(`/api/customer/${encodeURIComponent(id)}/receipts`),
  items: (search) => request(`/api/items?search=${encodeURIComponent(search || '')}`),
  shortages: () => request('/api/shortages'),
  expiry: (days) => request(`/api/expiry?days=${encodeURIComponent(days)}`),
  salesToday: () => request('/api/sales-today')
};
