import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Barcode,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  Eye,
  LockKeyhole,
  Package,
  PackageSearch,
  PlugZap,
  RefreshCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Users,
  XCircle
} from 'lucide-react';
import { api } from './api.js';

const numberFormatter = new Intl.NumberFormat('ar-EG', {
  maximumFractionDigits: 2
});

const dateFormatter = new Intl.DateTimeFormat('ar-EG', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? numberFormatter.format(number) : String(value);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateFormatter.format(date);
}

function todayInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function App() {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const loadStatus = async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const data = await api.status();
      setStatus(data);
    } catch (error) {
      setStatusError(error.message);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (loadingStatus) {
    return <FullPageState icon={Database} title="جاري فحص الاتصال" />;
  }

  if (statusError) {
    return (
      <FullPageState
        icon={AlertTriangle}
        title="تعذر تحميل الحالة"
        message={statusError}
        action={<Button icon={RefreshCcw} onClick={loadStatus}>إعادة المحاولة</Button>}
      />
    );
  }

  return (
    <div className="app-shell">
      {status?.connected ? (
        <Dashboard status={status} onRefresh={loadStatus} onSetup={() => setStatus({ connected: false })} />
      ) : (
        <SetupPage onConnected={(nextStatus) => setStatus(nextStatus)} />
      )}
    </div>
  );
}

function FullPageState({ icon: Icon, title, message, action }) {
  return (
    <main className="full-state" dir="rtl">
      <Icon size={42} />
      <h1>{title}</h1>
      {message ? <p>{message}</p> : null}
      {action}
    </main>
  );
}

function Button({ icon: Icon, children, variant = 'primary', ...props }) {
  return (
    <button className={`button button-${variant}`} type="button" {...props}>
      {Icon ? <Icon size={20} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function SetupPage({ onConnected }) {
  const [form, setForm] = useState({
    server: '',
    database: '',
    user: '',
    password: '',
    port: '',
    encrypt: false,
    trustServerCertificate: true
  });
  const [busyAction, setBusyAction] = useState('');
  const [result, setResult] = useState(null);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const testConnection = async () => {
    setBusyAction('test');
    setResult(null);
    try {
      const data = await api.testConnection(form);
      setResult({ ok: true, text: '✅ Connected', details: data.message });
    } catch (error) {
      setResult({ ok: false, text: '❌ Connection Failed', details: error.message });
    } finally {
      setBusyAction('');
    }
  };

  const saveConnection = async () => {
    setBusyAction('save');
    setResult(null);
    try {
      const data = await api.saveConnection(form);
      setResult({ ok: true, text: '✅ Connected', details: data.message });
      onConnected(data.connection);
    } catch (error) {
      setResult({ ok: false, text: '❌ Connection Failed', details: error.message });
    } finally {
      setBusyAction('');
    }
  };

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <div className="brand-row">
          <div className="brand-mark">
            <Database size={26} />
          </div>
          <div>
            <p className="eyebrow">Teryaq SQL Connector</p>
            <h1>إعداد اتصال SQL Server</h1>
          </div>
        </div>

        <div className="security-strip">
          <ShieldCheck size={20} />
          <span>وضع القراءة فقط</span>
          <LockKeyhole size={18} />
        </div>

        <form className="connection-form" onSubmit={(event) => event.preventDefault()}>
          <TextInput
            label="عنوان السيرفر"
            value={form.server}
            onChange={(value) => updateField('server', value)}
            autoComplete="off"
          />
          <TextInput
            label="اسم قاعدة البيانات"
            value={form.database}
            onChange={(value) => updateField('database', value)}
            autoComplete="off"
          />
          <TextInput
            label="اسم المستخدم"
            value={form.user}
            onChange={(value) => updateField('user', value)}
            autoComplete="username"
          />
          <TextInput
            label="كلمة المرور"
            type="password"
            value={form.password}
            onChange={(value) => updateField('password', value)}
            autoComplete="current-password"
          />
          <TextInput
            label="المنفذ"
            type="number"
            value={form.port}
            onChange={(value) => updateField('port', value)}
          />

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={form.encrypt}
              onChange={(event) => updateField('encrypt', event.target.checked)}
            />
            <span>Encrypt</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={form.trustServerCertificate}
              onChange={(event) => updateField('trustServerCertificate', event.target.checked)}
            />
            <span>Trust Server Certificate</span>
          </label>

          {result ? (
            <div className={`result-box ${result.ok ? 'is-success' : 'is-error'}`}>
              <strong>{result.text}</strong>
              <span>{result.details}</span>
            </div>
          ) : null}

          <div className="button-grid">
            <Button icon={PlugZap} onClick={testConnection} disabled={Boolean(busyAction)}>
              {busyAction === 'test' ? 'جاري الاختبار' : 'اختبار الاتصال'}
            </Button>
            <Button icon={Save} variant="secondary" onClick={saveConnection} disabled={Boolean(busyAction)}>
              {busyAction === 'save' ? 'جاري الحفظ' : 'حفظ الاتصال'}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}

function TextInput({ label, type = 'text', value, onChange, ...props }) {
  return (
    <label className="input-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  );
}

function Dashboard({ status, onRefresh, onSetup }) {
  const [activeModule, setActiveModule] = useState(null);

  const cards = useMemo(
    () => [
      { key: 'customers', title: 'حسابات الزبائن', icon: Users, tone: 'teal' },
      { key: 'items', title: 'الأصناف', icon: Package, tone: 'blue' },
      { key: 'inventory', title: 'المخزون', icon: Boxes, tone: 'green' },
      { key: 'shortages', title: 'النواقص', icon: AlertTriangle, tone: 'amber' },
      { key: 'expiry', title: 'قريب الانتهاء', icon: CalendarClock, tone: 'rose' },
      { key: 'sales', title: 'مبيعات اليوم', icon: BadgeDollarSign, tone: 'violet' }
    ],
    []
  );

  const currentCard = cards.find((card) => card.key === activeModule);

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Teryaq SQL Connector</p>
          <h1>لوحة الأعمال</h1>
        </div>
        <div className="header-actions">
          <Button icon={RefreshCcw} variant="ghost" onClick={onRefresh}>تحديث</Button>
          <Button icon={Server} variant="ghost" onClick={onSetup}>الاتصال</Button>
        </div>
      </header>

      <section className="status-band">
        <StatusItem icon={CheckCircle2} label="حالة الاتصال" value={status.status || 'Connected'} />
        <StatusItem icon={Server} label="السيرفر" value={status.server || '-'} />
        <StatusItem icon={Database} label="قاعدة البيانات" value={status.database || '-'} />
        <StatusItem icon={CalendarClock} label="آخر اتصال" value={formatDate(status.lastConnectionTime)} />
      </section>

      {activeModule ? (
        <ModuleRouter card={currentCard} moduleKey={activeModule} onBack={() => setActiveModule(null)} />
      ) : (
        <section className="dashboard-grid">
          {cards.map((card) => (
            <button className={`dashboard-card tone-${card.tone}`} key={card.key} type="button" onClick={() => setActiveModule(card.key)}>
              <card.icon size={28} />
              <span>{card.title}</span>
              <ArrowRight size={20} />
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

function StatusItem({ icon: Icon, label, value }) {
  return (
    <div className="status-item">
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ModuleRouter({ card, moduleKey, onBack }) {
  if (moduleKey === 'customers') return <CustomersModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'items') return <InventoryModule title="الأصناف" icon={PackageSearch} onBack={onBack} />;
  if (moduleKey === 'inventory') return <InventoryModule title="المخزون" icon={Boxes} onBack={onBack} />;
  if (moduleKey === 'shortages') return <ShortagesModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'expiry') return <ExpiryModule title={card.title} icon={card.icon} onBack={onBack} />;
  return <SalesTodayModule title={card.title} icon={card.icon} onBack={onBack} />;
}

function ModuleShell({ title, icon: Icon, onBack, children, actions }) {
  return (
    <section className="module-shell">
      <div className="module-header">
        <div className="module-title">
          <Icon size={24} />
          <h2>{title}</h2>
        </div>
        <div className="module-actions">
          {actions}
          <Button icon={ArrowRight} variant="ghost" onClick={onBack}>رجوع</Button>
        </div>
      </div>
      {children}
    </section>
  );
}

function CustomersModule({ title, icon, onBack }) {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.customers(search);
      setCustomers(data.customers || []);
    } catch (requestError) {
      setError(requestError.message);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  return (
    <ModuleShell title={title} icon={icon} onBack={onBack}>
      <SearchBar
        icon={Users}
        value={search}
        onChange={setSearch}
        onSubmit={loadCustomers}
        placeholder="الاسم أو الهاتف"
      />

      {selectedCustomer ? (
        <CustomerDetails customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
      ) : (
        <AsyncBlock loading={loading} error={error} empty={!customers.length}>
          <div className="customer-grid">
            {customers.map((customer) => (
              <button className="customer-card" type="button" key={customer.id} onClick={() => setSelectedCustomer(customer)}>
                <div className="customer-card-head">
                  <strong>{customer.name || '-'}</strong>
                  <Eye size={18} />
                </div>
                <span>{customer.phone || '-'}</span>
                <span>{customer.address || '-'}</span>
                <div className="metric-row">
                  <span>الرصيد</span>
                  <strong>{formatNumber(customer.currentBalance)}</strong>
                </div>
                <div className="metric-row">
                  <span>آخر حركة</span>
                  <strong>{formatDate(customer.lastTransactionDate)}</strong>
                </div>
                <div className="metric-row">
                  <span>قيمة آخر حركة</span>
                  <strong>{formatNumber(customer.lastTransactionAmount)}</strong>
                </div>
              </button>
            ))}
          </div>
        </AsyncBlock>
      )}
    </ModuleShell>
  );
}

function CustomerDetails({ customer, onClose }) {
  const tabs = [
    {
      key: 'ledger',
      label: 'كشف الحساب',
      loader: api.customerLedger,
      columns: [
        { key: 'date', label: 'Date', format: formatDate },
        { key: 'description', label: 'Description' },
        { key: 'debit', label: 'Debit', format: formatNumber },
        { key: 'credit', label: 'Credit', format: formatNumber },
        { key: 'runningBalance', label: 'Running Balance', format: formatNumber }
      ]
    },
    {
      key: 'invoices',
      label: 'فواتير البيع',
      loader: api.customerInvoices,
      columns: [
        { key: 'invoiceNumber', label: 'Invoice number' },
        { key: 'date', label: 'Date', format: formatDate },
        { key: 'total', label: 'Total', format: formatNumber },
        { key: 'paid', label: 'Paid', format: formatNumber },
        { key: 'remaining', label: 'Remaining', format: formatNumber }
      ]
    },
    {
      key: 'receipts',
      label: 'سندات القبض',
      loader: api.customerReceipts,
      columns: [
        { key: 'receiptNumber', label: 'Receipt number' },
        { key: 'date', label: 'Date', format: formatDate },
        { key: 'amount', label: 'Amount', format: formatNumber },
        { key: 'notes', label: 'Notes' }
      ]
    }
  ];

  const [activeTab, setActiveTab] = useState('ledger');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const activeTabConfig = tabs.find((tab) => tab.key === activeTab);

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await activeTabConfig.loader(customer.id);
        setRows(data.rows || []);
      } catch (requestError) {
        setError(requestError.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [activeTab, customer.id]);

  return (
    <div className="details-panel">
      <div className="details-head">
        <div>
          <h3>{customer.name || '-'}</h3>
          <p>{customer.phone || '-'}</p>
        </div>
        <Button icon={ArrowRight} variant="ghost" onClick={onClose}>القائمة</Button>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            className={tab.key === activeTab ? 'is-active' : ''}
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AsyncBlock loading={loading} error={error} empty={!rows.length}>
        <DataTable columns={activeTabConfig.columns} rows={rows} />
      </AsyncBlock>
    </div>
  );
}

function InventoryModule({ title, icon, onBack }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadItems = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.items(search);
      setItems(data.items || []);
    } catch (requestError) {
      setError(requestError.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  return (
    <ModuleShell title={title} icon={icon} onBack={onBack}>
      <SearchBar
        icon={Barcode}
        value={search}
        onChange={setSearch}
        onSubmit={loadItems}
        placeholder="اسم الصنف أو الباركود أو الكود"
      />
      <AsyncBlock loading={loading} error={error} empty={!items.length}>
        <DataTable
          columns={[
            { key: 'itemName', label: 'Item name' },
            { key: 'availableQuantity', label: 'Available quantity', format: formatNumber },
            { key: 'unit', label: 'Unit' },
            { key: 'cost', label: 'Cost', format: formatNumber },
            { key: 'sellingPrice', label: 'Selling price', format: formatNumber }
          ]}
          rows={items}
        />
      </AsyncBlock>
    </ModuleShell>
  );
}

function ShortagesModule({ title, icon, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.shortages()
      .then((data) => setRows(data.rows || []))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ModuleShell title={title} icon={icon} onBack={onBack}>
      <AsyncBlock loading={loading} error={error} empty={!rows.length}>
        <DataTable
          columns={[
            { key: 'itemName', label: 'Item name' },
            { key: 'currentQuantity', label: 'Current quantity', format: formatNumber },
            { key: 'minimumQuantity', label: 'Minimum quantity', format: formatNumber },
            { key: 'missingQuantity', label: 'Missing quantity', format: formatNumber }
          ]}
          rows={rows}
        />
      </AsyncBlock>
    </ModuleShell>
  );
}

function ExpiryModule({ title, icon, onBack }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.expiry(days)
      .then((data) => setRows(data.rows || []))
      .catch((requestError) => {
        setError(requestError.message);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={
        <div className="segment-control">
          {[30, 60, 90].map((option) => (
            <button className={option === days ? 'is-active' : ''} key={option} type="button" onClick={() => setDays(option)}>
              {option}
            </button>
          ))}
        </div>
      }
    >
      <AsyncBlock loading={loading} error={error} empty={!rows.length}>
        <DataTable
          columns={[
            { key: 'itemName', label: 'Item name' },
            { key: 'batch', label: 'Batch' },
            { key: 'expiryDate', label: 'Expiry date', format: formatDate },
            { key: 'quantity', label: 'Quantity', format: formatNumber }
          ]}
          rows={rows}
        />
      </AsyncBlock>
    </ModuleShell>
  );
}

function SalesTodayModule({ title, icon, onBack }) {
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayInputValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSalesToday = async () => {
    setLoading(true);
    setError('');
    try {
      const salesData = await api.salesToday(selectedDate);
      setData(salesData);
    } catch (requestError) {
      setError(requestError.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSalesToday();
  }, [selectedDate]);

  const summary = data?.summary || {};

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={
        <TextInput
          label="التاريخ"
          type="date"
          value={selectedDate}
          onChange={setSelectedDate}
        />
      }
    >
      <AsyncBlock loading={loading} error={error} empty={false}>
        <div className="summary-grid">
          <SummaryCard label="إجمالي الصناديق" value={formatNumber(summary.totalSales)} />
          <SummaryCard label="عدد البائعين" value={formatNumber(summary.sellerCount)} />
          <SummaryCard label="الحركات النقدية" value={formatNumber(summary.entryCount)} />
        </div>
        <h3 className="subheading">صناديق البائعين</h3>
        <DataTable
          columns={[
            { key: 'sellerName', label: 'اسم البائع' },
            { key: 'total', label: 'الإجمالي', format: formatNumber },
            { key: 'entryCount', label: 'عدد الحركات', format: formatNumber }
          ]}
          rows={data?.sellerCashboxes || []}
        />
        <h3 className="subheading">Top sold products</h3>
        <DataTable
          columns={[
            { key: 'itemName', label: 'Item name' },
            { key: 'quantity', label: 'Quantity', format: formatNumber },
            { key: 'total', label: 'Total', format: formatNumber }
          ]}
          rows={data?.topSoldProducts || []}
        />
      </AsyncBlock>
    </ModuleShell>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SearchBar({ icon: Icon, value, onChange, onSubmit, placeholder }) {
  return (
    <form className="search-bar" onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}>
      <Icon size={20} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <Button icon={Search} variant="secondary">بحث</Button>
    </form>
  );
}

function AsyncBlock({ loading, error, empty, children }) {
  if (loading) {
    return <div className="soft-state"><RefreshCcw size={24} />جاري التحميل</div>;
  }

  if (error) {
    return <div className="soft-state is-error"><AlertTriangle size={24} />{error}</div>;
  }

  if (empty) {
    return <div className="soft-state">لا توجد بيانات</div>;
  }

  return children;
}

function DataTable({ columns, rows }) {
  if (!rows?.length) {
    return <div className="soft-state">لا توجد بيانات</div>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id ?? row.invoiceNumber ?? row.receiptNumber ?? `${row.itemName || 'row'}-${rowIndex}`}>
              {columns.map((column) => (
                <td key={column.key}>{column.format ? column.format(row[column.key]) : row[column.key] ?? '-'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
