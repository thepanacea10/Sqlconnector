import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Barcode,
  Bot,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  Eye,
  FileSpreadsheet,
  LockKeyhole,
  Package,
  PackageSearch,
  PlugZap,
  Printer,
  RefreshCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Users,
  XCircle
} from 'lucide-react';
import { api } from './api.js';
import AiAssistantPage from './AiAssistant.jsx';

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2
});

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? numberFormatter.format(number) : String(value);
}

function splitSqlDateTime(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
    second: match[6]
  };
}

function hasRealTimeValue(value) {
  const parts = splitSqlDateTime(value);
  if (!parts?.hour) return false;
  return `${parts.hour}:${parts.minute || '00'}:${parts.second || '00'}` !== '00:00:00';
}

function formatDateParts(parts) {
  return `${parts.day}/${parts.month}/${parts.year}`;
}

function formatDate(value) {
  if (!value) return '-';
  const parts = splitSqlDateTime(value);
  if (parts) {
    const dateText = formatDateParts(parts);
    return hasRealTimeValue(value) ? `${dateText} ${parts.hour}:${parts.minute}` : dateText;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB').format(date);
}

function formatBusinessDateTime(dateValue, timeValue, hasRealTime) {
  const dateParts = splitSqlDateTime(dateValue);
  if (!dateParts) return formatDate(dateValue);
  const dateText = formatDateParts(dateParts);
  const timeParts = hasRealTime ? splitSqlDateTime(timeValue) : null;
  return timeParts?.hour ? `${dateText} ${timeParts.hour}:${timeParts.minute}` : dateText;
}

function formatMovementDate(row) {
  return formatBusinessDateTime(row?.movementDate, row?.movementCreatedAt, row?.movementHasRealTime);
}

function formatInvoiceDate(row) {
  return formatBusinessDateTime(row?.invoiceDate || row?.movementDate, row?.invoiceCreatedAt || row?.movementCreatedAt, row?.invoiceHasRealTime || row?.movementHasRealTime);
}

function todayInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function exportRowsAsCsv(filename, headers, rows) {
  const csvRows = [
    headers.map((header) => header.label),
    ...rows.map((row) => headers.map((header) => {
      const value = typeof header.value === 'function' ? header.value(row) : row[header.value];
      return value ?? '';
    }))
  ];
  const csv = csvRows
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function sumBy(rows, field = 'amount') {
  return (rows || []).reduce((total, row) => total + Number(row[field] || 0), 0);
}

function differenceBetween(left, right) {
  return Number(left || 0) - Number(right || 0);
}

function hasMismatch(left, right) {
  return Math.abs(differenceBetween(left, right)) > 0.0001;
}

const ConnectionContext = createContext(null);

function App() {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [route, setRoute] = useState(() => window.location.pathname);

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setRoute(path);
  };

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

  useEffect(() => {
    const handlePopState = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
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
      {status?.connected && route === '/ai-assistant' ? (
        <AiAssistantPage onBack={() => navigate('/')} />
      ) : status?.connected ? (
        <ConnectionContext.Provider value={status}>
          <Dashboard
            status={status}
            onRefresh={loadStatus}
            onSetup={() => setStatus({ connected: false })}
            onOpenAssistant={() => navigate('/ai-assistant')}
          />
        </ConnectionContext.Provider>
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

function Dashboard({ status, onRefresh, onSetup, onOpenAssistant }) {
  const [activeModule, setActiveModule] = useState(null);

  const cards = useMemo(
    () => [
      { key: 'customers', title: 'حسابات الزبائن', icon: Users, tone: 'teal' },
      { key: 'items', title: 'الأصناف', icon: Package, tone: 'blue' },
      { key: 'inventory', title: 'المخزون', icon: Boxes, tone: 'green' },
      { key: 'shortages', title: 'النواقص', icon: AlertTriangle, tone: 'amber' },
      { key: 'expiry', title: 'قريب الانتهاء', icon: CalendarClock, tone: 'rose' },
      { key: 'sales', title: 'إيراد اليوم', icon: BadgeDollarSign, tone: 'violet' },
      { key: 'trading', title: 'المتاجرة والأرباح', icon: ClipboardList, tone: 'green' },
      { key: 'ai', title: 'المساعد الذكي', icon: Bot, tone: 'slate' }
    ],
    []
  );

  const currentCard = cards.find((card) => card.key === activeModule)
    || (activeModule === 'settings' ? { title: 'حالة الاتصال', icon: Server } : null);

  return (
    <main className="dashboard-page">
      {activeModule ? (
        <ModuleRouter
          card={currentCard}
          moduleKey={activeModule}
          onBack={() => setActiveModule(null)}
          onSetup={onSetup}
        />
      ) : (
        <>
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">Teryaq SQL Connector</p>
              <ConnectionStatusLine status={status} />
            </div>
            <div className="header-actions">
              <Button icon={RefreshCcw} variant="ghost" onClick={onRefresh}>تحديث</Button>
              <Button icon={Server} variant="ghost" onClick={() => setActiveModule('settings')}>حالة الاتصال</Button>
            </div>
          </header>

          <section className="dashboard-grid">
            {cards.map((card) => (
              <button
                className={`dashboard-card tone-${card.tone}`}
                key={card.key}
                type="button"
                onClick={() => (card.key === 'ai' ? onOpenAssistant() : setActiveModule(card.key))}
              >
                <card.icon size={28} />
                <span>{card.title}</span>
                <ArrowRight size={20} />
              </button>
            ))}
          </section>
        </>
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

function ConnectionStatusLine({ status }) {
  const connected = Boolean(status?.connected);
  return (
    <div className={`dashboard-connection-line ${connected ? 'is-connected' : 'is-disconnected'}`}>
      <strong>{status?.database || 'AlmohasebSQL'}</strong>
      {connected ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
    </div>
  );
}

function ModuleRouter({ card, moduleKey, onBack, onSetup }) {
  if (moduleKey === 'customers') return <CustomersModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'items') return <InventoryModule title="الأصناف" icon={PackageSearch} onBack={onBack} />;
  if (moduleKey === 'inventory') return <InventoryModule title="المخزون" icon={Boxes} onBack={onBack} />;
  if (moduleKey === 'shortages') return <ShortagesModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'expiry') return <ExpiryModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'sales') {
    return <RevenueDrilldownModule title="تفاصيل الإيراد" icon={card.icon} onBack={onBack} />;
  }
  if (moduleKey === 'trading') return <TradingProfitModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'settings') return <ConnectionStatusModule title={card.title} icon={card.icon} onBack={onBack} onSetup={onSetup} />;
  return null;
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

function ConnectionBadge({ status }) {
  if (!status) return null;
  return (
    <div className={`connection-badge ${status.connected ? 'is-connected' : 'is-disconnected'}`}>
      <span>{status.connected ? 'Connected' : 'Disconnected'}</span>
      {status.database ? <small>{status.database}</small> : null}
    </div>
  );
}

function ConnectionStatusModule({ title, icon, onBack, onSetup }) {
  const status = useContext(ConnectionContext);
  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={<Button icon={PlugZap} variant="secondary" onClick={onSetup}>تعديل الاتصال</Button>}
    >
      <section className="status-band">
        <StatusItem icon={CheckCircle2} label="حالة الاتصال" value={status?.status || 'Connected'} />
        <StatusItem icon={Server} label="السيرفر" value={status?.server || '-'} />
        <StatusItem icon={Database} label="قاعدة البيانات" value={status?.database || '-'} />
        <StatusItem icon={CalendarClock} label="آخر اتصال" value={formatDate(status?.lastConnectionTime)} />
      </section>
    </ModuleShell>
  );
}

function CustomersModule({ title, icon, onBack }) {
  const [accountType, setAccountType] = useState('');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSupplier = accountType === 'suppliers';

  const loadAccounts = async () => {
    if (!accountType) return;
    setLoading(true);
    setError('');
    try {
      const data = isSupplier ? await api.suppliers(search) : await api.customers(search);
      setAccounts(isSupplier ? data.suppliers || [] : data.customers || []);
    } catch (requestError) {
      setError(requestError.message);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [accountType]);

  const visibleAccounts = useMemo(() => prepareAccounts(accounts, { showArchived }), [accounts, showArchived]);

  return (
    <ModuleShell title={title} icon={icon} onBack={onBack}>
      {!accountType ? (
        <AccountTypeSelector onSelect={setAccountType} />
      ) : selectedAccount ? (
        isSupplier ? (
          <SupplierDetails supplier={selectedAccount} onClose={() => setSelectedAccount(null)} />
        ) : (
          <CustomerDetails customer={selectedAccount} onClose={() => setSelectedAccount(null)} />
        )
      ) : (
        <>
          <div className="accounts-toolbar">
            <Button icon={ArrowRight} variant="ghost" onClick={() => {
              setAccountType('');
              setSearch('');
              setAccounts([]);
            }}>
              رجوع للاختيار
            </Button>
            <label className="archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              <span>إظهار المؤرشف</span>
            </label>
          </div>

          <SearchBar
            icon={Users}
            value={search}
            onChange={setSearch}
            onSubmit={loadAccounts}
            placeholder="الاسم أو الهاتف"
          />

          <AsyncBlock loading={loading} error={error} empty={!visibleAccounts.length}>
            <AccountCardGrid
              accounts={visibleAccounts}
              type={isSupplier ? 'supplier' : 'customer'}
              onSelect={setSelectedAccount}
            />
          </AsyncBlock>
        </>
      )}
    </ModuleShell>
  );
}

function AccountTypeSelector({ onSelect }) {
  return (
    <section className="account-type-grid">
      <button className="account-type-card tone-teal" type="button" onClick={() => onSelect('customers')}>
        <Users size={30} />
        <strong>الزبائن</strong>
        <span>حسابات العملاء والأرصدة المطلوبة</span>
      </button>
      <button className="account-type-card tone-rose" type="button" onClick={() => onSelect('suppliers')}>
        <ClipboardList size={30} />
        <strong>الموردين</strong>
        <span>أرصدة الموردين والمتابعة</span>
      </button>
    </section>
  );
}

function accountBalance(account) {
  const value = account?.currentBalance ?? account?.balance ?? account?.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanAccountText(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-' || text === 'غيرمحدد' || text === 'غير محدد') return '';
  return text;
}

function isArchivedAccount(account) {
  const balance = accountBalance(account);
  return balance !== null && Math.abs(balance) < 0.0001;
}

function prepareAccounts(accounts, { showArchived }) {
  return [...(accounts || [])]
    .filter((account) => showArchived || !isArchivedAccount(account))
    .sort((left, right) => {
      const leftArchived = isArchivedAccount(left) ? 1 : 0;
      const rightArchived = isArchivedAccount(right) ? 1 : 0;
      if (leftArchived !== rightArchived) return leftArchived - rightArchived;
      const leftBalance = Math.abs(accountBalance(left) ?? 0);
      const rightBalance = Math.abs(accountBalance(right) ?? 0);
      return rightBalance - leftBalance;
    });
}

function AccountCardGrid({ accounts, type, onSelect }) {
  return (
    <div className="customer-grid compact-account-grid">
      {accounts.map((account) => (
        <AccountCard
          account={account}
          key={account.id}
          type={type}
          onSelect={() => onSelect(account)}
        />
      ))}
    </div>
  );
}

function AccountCard({ account, type, onSelect }) {
  const balance = accountBalance(account);
  const archived = isArchivedAccount(account);
  const name = cleanAccountText(account.name) || '-';
  const phone = cleanAccountText(account.phone);
  return (
    <button className={`customer-card compact-account-card ${archived ? 'is-archived' : ''}`} type="button" onClick={onSelect}>
      <div className="customer-card-head">
        <strong>{name}</strong>
        <Eye size={16} />
      </div>
      {phone ? <span>{phone}</span> : null}
      <div className="account-balance-row">
        <span>{type === 'supplier' ? 'القيمة' : 'الرصيد'}</span>
        <strong className={type === 'supplier' ? 'supplier-balance' : 'customer-balance'}>
          {balance === null ? '-' : formatNumber(balance)}
        </strong>
      </div>
    </button>
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

      <div className="revenue-actions">
        <Button icon={Printer} variant="ghost" onClick={() => window.print()}>طباعة كشف حساب</Button>
        <Button icon={FileSpreadsheet} variant="secondary" onClick={() => exportRowsAsCsv(`customer-${customer.id}-${activeTab}.csv`, activeTabConfig.columns, rows)}>
          تصدير Excel
        </Button>
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

function SupplierDetails({ supplier, onClose }) {
  const tabs = [
    {
      key: 'ledger',
      label: 'كشف الحساب',
      loader: api.supplierLedger,
      columns: [
        { key: 'date', label: 'التاريخ', format: formatDate },
        { key: 'description', label: 'البيان' },
        { key: 'debit', label: 'مدين', format: formatNumber },
        { key: 'credit', label: 'دائن', format: formatNumber },
        { key: 'runningBalance', label: 'الرصيد', format: formatNumber }
      ]
    },
    {
      key: 'purchaseInvoices',
      label: 'فواتير الشراء',
      loader: api.supplierInvoices,
      columns: [
        { key: 'invoiceNumber', label: 'رقم الحركة' },
        { key: 'purchaseInvoice', label: 'رقم فاتورة الشراء' },
        { key: 'date', label: 'التاريخ', format: formatDate },
        { key: 'invoiceType', label: 'النوع' },
        { key: 'total', label: 'الإجمالي', format: formatNumber },
        { key: 'paid', label: 'المسدد', format: formatNumber },
        { key: 'remaining', label: 'المتبقي', format: formatNumber }
      ]
    },
    {
      key: 'payments',
      label: 'السدادات',
      loader: api.supplierPayments,
      columns: [
        { key: 'paymentNumber', label: 'رقم السداد' },
        { key: 'date', label: 'التاريخ', format: formatDate },
        { key: 'amount', label: 'القيمة', format: formatNumber },
        { key: 'paymentMethod', label: 'طريقة الدفع' },
        { key: 'invoiceNumber', label: 'رقم الحركة' },
        { key: 'notes', label: 'ملاحظات' }
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
        const data = await activeTabConfig.loader(supplier.id);
        setRows(data.rows || []);
      } catch (requestError) {
        setError(requestError.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [activeTab, supplier.id]);

  return (
    <div className="details-panel supplier-details-panel">
      <div className="details-head">
        <div>
          <h3>{supplier.name || '-'}</h3>
          {supplier.phone ? <p>{supplier.phone}</p> : null}
        </div>
        <Button icon={ArrowRight} variant="ghost" onClick={onClose}>القائمة</Button>
      </div>

      <div className="revenue-actions">
        <Button icon={Printer} variant="ghost" onClick={() => window.print()}>طباعة كشف حساب</Button>
        <Button icon={FileSpreadsheet} variant="secondary" onClick={() => exportRowsAsCsv(`supplier-${supplier.id}-${activeTab}.csv`, activeTabConfig.columns, rows)}>
          تصدير Excel
        </Button>
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

  const exportInventory = () => {
    exportRowsAsCsv(`inventory-${todayInputValue()}.csv`, [
      { label: 'اسم الصنف', value: 'itemName' },
      { label: 'الكمية المتاحة', value: 'availableQuantity' },
      { label: 'الوحدة', value: 'unit' },
      { label: 'التكلفة', value: 'cost' },
      { label: 'سعر البيع', value: 'sellingPrice' }
    ], items);
  };

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={(
        <div className="revenue-actions">
          <Button icon={Printer} variant="ghost" onClick={() => window.print()}>طباعة PDF</Button>
          <Button icon={FileSpreadsheet} variant="secondary" onClick={exportInventory}>تصدير Excel</Button>
        </div>
      )}
    >
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

function TradingProfitModule({ title, icon, onBack }) {
  const [dateFrom, setDateFrom] = useState(todayInputValue());
  const [dateTo, setDateTo] = useState(todayInputValue());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTrading = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.tradingProfit({ dateFrom, dateTo });
      setData(result);
    } catch (requestError) {
      setError(requestError.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrading();
  }, []);

  const summary = data?.summary || {};

  return (
    <ModuleShell title={title} icon={icon} onBack={onBack}>
      <div className="report-toolbar">
        <label>
          <span>من تاريخ</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>إلى تاريخ</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <Button icon={RefreshCcw} variant="secondary" onClick={loadTrading}>تحديث التقرير</Button>
      </div>

      <AsyncBlock loading={loading} error={error} empty={!data}>
        <section className="trading-hero">
          <div>
            <p className="eyebrow">ملخص الفترة</p>
            <h3>صافي الربح</h3>
          </div>
          <strong className={Number(summary.netProfit || 0) >= 0 ? 'is-positive' : 'is-negative'}>
            {formatNumber(summary.netProfit)}
          </strong>
        </section>

        <div className="summary-grid">
          <SummaryCard label="الإيرادات" value={formatNumber(summary.revenue)} />
          <SummaryCard label="تكلفة البضاعة" value={formatNumber(summary.costOfGoods)} />
          <SummaryCard label="مجمل الربح" value={formatNumber(summary.grossProfit)} />
          <SummaryCard label="سدادات الموردين" value={formatNumber(summary.supplierPayments)} />
          <SummaryCard label="المصاريف" value={formatNumber(summary.expenses)} />
          <SummaryCard label="صافي الربح" value={formatNumber(summary.netProfit)} />
        </div>

        <section className="drill-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">الحركة</p>
              <h3>تفاصيل الفترة</h3>
            </div>
            <span className="count-badge">{formatNumber(data?.movements?.length || 0)}</span>
          </div>
          <DataTable
            columns={[
              { key: 'date', label: 'التاريخ', format: formatDate },
              { key: 'kind', label: 'النوع' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'القيمة', format: formatNumber }
            ]}
            rows={data?.movements || []}
          />
        </section>
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

function RevenueDrilldownModule({ title, icon, onBack }) {
  const [data, setData] = useState(null);
  const [dashboardReference, setDashboardReference] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [periodData, setPeriodData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(todayInputValue());
  const [periodFilter, setPeriodFilter] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState('');

  const loadOverview = async () => {
    setLoading(true);
    setError('');
    setSelectedPeriod(null);
    setSelectedSource(null);
    setSelectedMovement(null);
    setPeriodData(null);
    try {
      const [result, dashboardResult] = await Promise.all([
        api.revenueDetails({ date, period: periodFilter }),
        api.salesToday(date)
      ]);
      setData(result);
      setDashboardReference(dashboardResult);
      api.revenueDiagnostics(date)
        .then(setDiagnostics)
        .catch(() => setDiagnostics(null));
    } catch (requestError) {
      setError(requestError.message);
      setData(null);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, [date, periodFilter]);

  const periodOptions = useMemo(() => {
    const fixed = ['الفترة الصباحية', 'الفترة المسائية', 'الفترة الليلية'];
    const actual = (data?.filterOptions || [])
      .filter((option) => option.optionType === 'period')
      .map((option) => option.optionLabel)
      .filter(Boolean);
    return [...new Set([...fixed, ...actual])];
  }, [data]);

  const periodRows = useMemo(() => {
    const totals = new Map((data?.sellerTotals || []).map((row) => [row.sellerName, row]));
    const rows = periodOptions.map((periodName) => {
      const row = totals.get(periodName);
      return {
        period: periodName,
        total: Number(row?.total || 0),
        movementCount: Number(row?.movementCount || 0)
      };
    });
    return periodFilter ? rows.filter((row) => row.period === periodFilter) : rows;
  }, [data, periodOptions, periodFilter]);

  const periodSum = useMemo(() => sumBy(periodRows, 'total'), [periodRows]);
  const summary = data?.summary || {};
  const dashboardTotal = dashboardReference?.cashboxSummary?.totalCashbox;
  const overviewDifference = differenceBetween(periodSum, summary.netRevenue);
  const dashboardDifference = dashboardTotal === undefined ? 0 : differenceBetween(summary.netRevenue, dashboardTotal);

  const openPeriod = async (periodName) => {
    setSelectedPeriod(periodName);
    setSelectedSource(null);
    setSelectedMovement(null);
    setMovementError('');
    setPeriodLoading(true);
    try {
      const result = await api.revenueDetails({ date, period: periodName });
      setPeriodData(result);
    } catch (requestError) {
      setError(requestError.message);
      setPeriodData(null);
    } finally {
      setPeriodLoading(false);
    }
  };

  const openSource = (source) => {
    setSelectedSource(source);
    setSelectedMovement(null);
    setMovementError('');
  };

  const backToPeriods = () => {
    setSelectedPeriod(null);
    setSelectedSource(null);
    setSelectedMovement(null);
    setPeriodData(null);
    setMovementError('');
  };

  const backToSources = () => {
    setSelectedSource(null);
    setSelectedMovement(null);
    setMovementError('');
  };

  const openMovement = async (movementNo) => {
    setMovementLoading(true);
    setMovementError('');
    try {
      const result = await api.revenueMovement(movementNo);
      setSelectedMovement(result);
    } catch (requestError) {
      setMovementError(requestError.message);
    } finally {
      setMovementLoading(false);
    }
  };

  const sourceRows = periodData?.sources || [];
  const selectedMovements = useMemo(() => {
    if (!selectedSource) return [];
    return (periodData?.rows || []).filter((row) => row.revenueSource === selectedSource.sourceName);
  }, [periodData, selectedSource]);
  const sourceSum = useMemo(() => sumBy(sourceRows, 'total'), [sourceRows]);
  const movementSum = useMemo(() => sumBy(selectedMovements, 'amount'), [selectedMovements]);
  const periodTotal = Number(periodData?.summary?.netRevenue || selectedPeriod?.total || 0);

  const exportVisibleRows = () => {
    const rows = selectedSource ? selectedMovements : selectedPeriod ? (periodData?.rows || []) : (data?.rows || []);
    exportRowsAsCsv(`revenue-${date || 'today'}.csv`, [
      { label: 'رقم الحركة', value: 'movementNo' },
      { label: 'رقم الفاتورة', value: 'invoiceNo' },
      { label: 'تاريخ الحركة', value: (row) => formatMovementDate(row) },
      { label: 'نوع الحركة', value: 'movementType' },
      { label: 'اسم العميل', value: 'customerName' },
      { label: 'الفترة', value: 'period' },
      { label: 'طريقة الدفع', value: 'paymentMethod' },
      { label: 'القيمة', value: 'amount' },
      { label: 'ملاحظات', value: 'notes' }
    ], rows);
  };

  const currentLevel = selectedSource ? 'تفاصيل الحركات' : selectedPeriod ? 'مصادر الإيراد' : 'الفترات';

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={(
        <div className="revenue-actions">
          <Button icon={Printer} variant="ghost" onClick={() => window.print()}>طباعة PDF</Button>
          <Button icon={FileSpreadsheet} variant="secondary" onClick={exportVisibleRows}>تصدير Excel</Button>
        </div>
      )}
    >
      <div className="report-toolbar">
        <label>
          <span>التاريخ</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          <span>الفترة</span>
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            <option value="">الكل</option>
            {periodOptions.map((periodName) => (
              <option key={periodName} value={periodName}>{periodName}</option>
            ))}
          </select>
        </label>
      </div>

      <AsyncBlock loading={loading} error={error} empty={!data}>
        {!selectedPeriod ? (
          <>
            {hasMismatch(periodSum, summary.netRevenue) ? (
              <ValidationWarning difference={overviewDifference} />
            ) : null}
            {dashboardTotal !== undefined && hasMismatch(summary.netRevenue, dashboardTotal) ? (
              <ValidationWarning difference={dashboardDifference} />
            ) : null}

            <section className="drill-section">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Level 1</p>
                  <h3>الفترات</h3>
                </div>
                <span className="count-badge">{formatNumber(periodRows.length)}</span>
              </div>
              <div className="drill-card-list">
                {periodRows.map((period) => (
                  <button
                    className="drill-card"
                    key={period.period}
                    type="button"
                    onClick={() => period.movementCount ? openPeriod(period.period) : null}
                    disabled={!period.movementCount}
                  >
                    <div>
                      <strong>{period.period}</strong>
                      <span>{formatNumber(period.movementCount)} حركة</span>
                    </div>
                    <div className="drill-card-total">
                      <strong>{formatNumber(period.total)}</strong>
                      <ArrowRight size={18} />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <RevenueDiagnosticsPanel diagnostics={diagnostics} />

            <div className="summary-grid">
              <SummaryCard label="صافي الإيراد النهائي" value={formatNumber(summary.netRevenue)} />
              <SummaryCard label="إجمالي المبيعات النقدية" value={formatNumber(summary.cashSalesTotal)} />
              <SummaryCard label="إجمالي سداد المدينين" value={formatNumber(summary.debtorPaymentsTotal)} />
              <SummaryCard label="إجمالي المدفوعات الإلكترونية" value={formatNumber(summary.electronicPaymentsTotal)} />
              <SummaryCard label="إجمالي المردودات" value={formatNumber(summary.returnsTotal)} />
              <SummaryCard label="عدد الحركات" value={formatNumber(summary.movementCount)} />
            </div>
          </>
        ) : null}

        {selectedPeriod && !selectedSource ? (
          <section className="drill-section">
            <div className="drill-nav">
              <Button icon={ArrowRight} variant="ghost" onClick={backToPeriods}>رجوع إلى الفترات</Button>
            </div>
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Level 2</p>
                <h3>مصادر الإيراد - {selectedPeriod}</h3>
              </div>
              <strong>{formatNumber(periodTotal)}</strong>
            </div>
            {periodLoading ? (
              <div className="soft-state"><RefreshCcw size={24} />جاري تحميل مصادر الإيراد</div>
            ) : (
              <>
                {hasMismatch(sourceSum, periodTotal) ? <ValidationWarning difference={differenceBetween(sourceSum, periodTotal)} /> : null}
                <div className="drill-card-list">
                  {sourceRows.map((source) => (
                    <button className="drill-card" key={source.sourceName} type="button" onClick={() => openSource(source)}>
                      <div>
                        <strong>{displayRevenueSource(source.sourceName)}</strong>
                        <span>{formatNumber(source.movementCount)} حركة</span>
                      </div>
                      <div className={`drill-card-total ${Number(source.total || 0) < 0 ? 'is-negative' : ''}`}>
                        <strong>{formatNumber(source.total)}</strong>
                        <ArrowRight size={18} />
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : null}

        {selectedPeriod && selectedSource ? (
          <section className="drill-section">
            <div className="drill-nav">
              <Button icon={ArrowRight} variant="ghost" onClick={backToSources}>رجوع إلى مصادر الإيراد</Button>
            </div>
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Level 3</p>
                <h3>تفاصيل الحركات - {displayRevenueSource(selectedSource.sourceName)}</h3>
              </div>
              <strong>{formatNumber(selectedSource.total)}</strong>
            </div>
            {hasMismatch(movementSum, selectedSource.total) ? (
              <ValidationWarning difference={differenceBetween(movementSum, selectedSource.total)} />
            ) : null}
            <MovementCardList rows={selectedMovements} onOpenMovement={openMovement} />
            <div className="desktop-table">
              <DataTable
                columns={[
                  {
                    key: 'movementNo',
                    label: 'رقم الحركة',
                    render: (row) => (
                      <button className="link-button" type="button" onClick={(event) => {
                        event.stopPropagation();
                        openMovement(row.movementNo);
                      }}>
                        {row.movementNo}
                      </button>
                    )
                  },
                  {
                    key: 'invoiceNo',
                    label: 'رقم الفاتورة',
                    render: (row) => row.invoiceNo ? (
                      <button className="link-button" type="button" onClick={(event) => {
                        event.stopPropagation();
                        openMovement(row.movementNo);
                      }}>
                        {row.invoiceNo}
                      </button>
                    ) : '-'
                  },
                  { key: 'movementDate', label: 'تاريخ الحركة', render: formatMovementDate },
                  { key: 'movementType', label: 'نوع الحركة' },
                  { key: 'customerName', label: 'اسم العميل' },
                  { key: 'period', label: 'الفترة' },
                  { key: 'paymentMethod', label: 'طريقة الدفع' },
                  { key: 'amount', label: 'القيمة', format: formatNumber },
                  { key: 'notes', label: 'ملاحظات' }
                ]}
                rows={selectedMovements}
                onRowClick={(row) => openMovement(row.movementNo)}
              />
            </div>

            {movementError ? <div className="soft-state is-error"><AlertTriangle size={24} />{movementError}</div> : null}
            {movementLoading ? <div className="soft-state"><RefreshCcw size={24} />جاري تحميل تفاصيل الحركة</div> : null}
            {selectedMovement?.movement ? <RevenueMovementDetails selectedMovement={selectedMovement} /> : null}
          </section>
        ) : null}
      </AsyncBlock>
    </ModuleShell>
  );
}

function displayRevenueSource(sourceName) {
  if (sourceName === 'مبيعات نقدية') return 'نقداً';
  if (sourceName === 'مردودات') return 'مردودات';
  return sourceName || '-';
}

function MovementCardList({ rows, onOpenMovement }) {
  return (
    <div className="movement-card-list">
      {rows.map((row) => (
        <article className="movement-card" key={row.movementNo}>
          <div className="movement-card-head">
            <div>
              <strong>{row.movementType || '-'}</strong>
              <span>{formatMovementDate(row)}</span>
            </div>
            <strong className={Number(row.amount || 0) < 0 ? 'is-negative' : ''}>{formatNumber(row.amount)}</strong>
          </div>
          <dl className="movement-card-fields">
            <div>
              <dt>طريقة الدفع</dt>
              <dd>{row.paymentMethod || '-'}</dd>
            </div>
            <div>
              <dt>اسم العميل</dt>
              <dd>{row.customerName || '-'}</dd>
            </div>
            <div>
              <dt>الفترة</dt>
              <dd>{row.period || '-'}</dd>
            </div>
            <div>
              <dt>رقم الفاتورة</dt>
              <dd>
                {row.invoiceNo ? (
                  <button className="link-button" type="button" onClick={() => onOpenMovement(row.movementNo)}>
                    {row.invoiceNo}
                  </button>
                ) : '-'}
              </dd>
            </div>
            <div>
              <dt>رقم الحركة</dt>
              <dd>
                <button className="link-button" type="button" onClick={() => onOpenMovement(row.movementNo)}>
                  {row.movementNo}
                </button>
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function RevenueDiagnosticsPanel({ diagnostics }) {
  if (!diagnostics?.diagnostics) return null;
  const data = diagnostics.diagnostics;
  return (
    <details className="diagnostics-panel">
      <summary>تشخيص وقت الحركات</summary>
      <div className="diagnostics-grid">
        <InfoPill label="مصدر وقت الحركة" value={diagnostics.sourceFieldUsedForDatetime} />
        <InfoPill label="مصدر وقت الفاتورة" value={diagnostics.invoiceDatetimeSource} />
        <InfoPill label="حركات بوقت حقيقي" value={formatNumber(data.outstandingItemAddRealTime)} />
        <InfoPill label="حركات بتاريخ فقط" value={formatNumber(data.datePaidDateOnly)} />
      </div>
    </details>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="info-pill">
      <span>{label}</span>
      <strong>{value ?? '-'}</strong>
    </div>
  );
}

function ValidationWarning({ difference }) {
  return (
    <div className="audit-alert">
      يوجد فرق في المطابقة: {formatNumber(difference)}
    </div>
  );
}

function RevenueMovementDetails({ selectedMovement }) {
  const movement = selectedMovement.movement;
  const invoiceLines = selectedMovement.invoiceLines || [];
  const linkedPayments = selectedMovement.linkedPayments || [];

  return (
    <section className="detail-drawer invoice-detail-screen">
      <div className="invoice-detail-head">
        <Eye size={22} />
        <div>
          <p className="eyebrow">تفاصيل الفاتورة</p>
          <h3>الفاتورة {movement.invoiceNo || movement.movementNo}</h3>
        </div>
      </div>

      <div className="invoice-info-grid">
        <InfoPill label="رقم الفاتورة" value={movement.invoiceNo || '-'} />
        <InfoPill label="تاريخ الفاتورة" value={formatInvoiceDate(movement)} />
        <InfoPill label="نوع الحركة" value={movement.accountName || movement.movementType || '-'} />
        <InfoPill label="اسم العميل" value={movement.customerName || '-'} />
        <InfoPill label="الفترة" value={movement.sellerName || movement.period || '-'} />
        <InfoPill label="طريقة الدفع" value={movement.paymentMethod || '-'} />
        <InfoPill label="الإجمالي" value={formatNumber(movement.amount)} />
        <InfoPill label="الخصم" value={movement.discount ? formatNumber(movement.discount) : '-'} />
        <InfoPill label="الملاحظات" value={movement.notes || movement.invoiceDetails || '-'} />
      </div>

      <div className="section-title-row">
        <div>
          <p className="eyebrow">الأصناف</p>
          <h3>بنود الفاتورة الأصلية</h3>
        </div>
        <span className="count-badge">{formatNumber(invoiceLines.length)}</span>
      </div>
      <InvoiceItemCards rows={invoiceLines} />

      {linkedPayments.length ? (
        <>
          <div className="section-title-row">
            <div>
              <p className="eyebrow">الحركات</p>
              <h3>دفعات مرتبطة بنفس الفاتورة</h3>
            </div>
            <span className="count-badge">{formatNumber(linkedPayments.length)}</span>
          </div>
          <div className="linked-payment-list">
            {linkedPayments.map((payment) => (
              <article className="linked-payment-card" key={payment.movementNo}>
                <div>
                  <strong>{payment.accountName || '-'}</strong>
                  <span>{formatMovementDate(payment)}</span>
                </div>
                <div>
                  <span>{payment.paymentMethod || '-'}</span>
                  <strong>{formatNumber(payment.amount)}</strong>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function InvoiceItemCards({ rows }) {
  if (!rows.length) {
    return <div className="soft-state">لا توجد بنود مرتبطة بهذه الفاتورة</div>;
  }

  return (
    <div className="invoice-item-list">
      {rows.map((row) => {
        const quantity = Number(row.quantity || 0);
        const lineTotal = Number(row.chargeValue || 0);
        const unitPrice = quantity ? lineTotal / quantity : lineTotal;
        return (
          <article className="invoice-item-card" key={row.detailNo}>
            <div className="invoice-item-main">
              <strong>{row.itemName || '-'}</strong>
              <span>{row.barcode || '-'}</span>
            </div>
            <dl className="invoice-item-fields">
              <div>
                <dt>الكمية</dt>
                <dd>{formatNumber(row.quantity)}</dd>
              </div>
              <div>
                <dt>العبوة/الوحدة</dt>
                <dd>{row.unit || '-'}</dd>
              </div>
              <div>
                <dt>السعر</dt>
                <dd>{formatNumber(unitPrice)}</dd>
              </div>
              <div>
                <dt>الإجمالي</dt>
                <dd>{formatNumber(row.chargeValue)}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function RevenueDetailsModule({ title, icon, onBack }) {
  const [data, setData] = useState(null);
  const [dashboardReference, setDashboardReference] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(todayInputValue());
  const [filters, setFilters] = useState({
    sellerId: '',
    period: '',
    paymentMethod: '',
    movementType: '',
    expectedTotal: ''
  });
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState('');

  const loadRevenue = async () => {
    setLoading(true);
    setError('');
    try {
      const [result, dashboardResult] = await Promise.all([
        api.revenueDetails({ date, ...filters }),
        api.salesToday(date)
      ]);
      setData(result);
      setDashboardReference(dashboardResult);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRevenue();
  }, [date, filters.sellerId, filters.period, filters.paymentMethod, filters.movementType, filters.expectedTotal]);

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const optionsFor = (optionType) =>
    (data?.filterOptions || []).filter((option) => option.optionType === optionType);

  const openMovement = async (movementNo) => {
    setMovementLoading(true);
    setMovementError('');
    try {
      const result = await api.revenueMovement(movementNo);
      setSelectedMovement(result);
    } catch (requestError) {
      setMovementError(requestError.message);
    } finally {
      setMovementLoading(false);
    }
  };

  const exportExcel = () => {
    const rows = data?.rows || [];
    const headers = ['رقم الحركة', 'رقم الفاتورة', 'تاريخ الحركة', 'نوع الحركة', 'اسم العميل', 'اسم البائع', 'طريقة الدفع', 'القيمة', 'الفترة', 'ملاحظات'];
    const csvRows = [
      headers,
      ...rows.map((row) => [
        row.movementNo,
        row.invoiceNo,
        formatDate(row.movementDate),
        row.movementType,
        row.customerName,
        row.sellerName,
        row.paymentMethod,
        row.amount,
        row.period,
        row.notes || ''
      ])
    ];
    const csv = csvRows
      .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `revenue-audit-${date || 'today'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const summary = data?.summary || {};
  const dashboardTotal = dashboardReference?.cashboxSummary?.totalCashbox;
  const automaticDifference = Number(summary.netRevenue || 0) - Number(dashboardTotal || 0);
  const manualDifference = Number(summary.difference || 0);
  const hasManualDifference = filters.expectedTotal !== '' && Math.abs(manualDifference) > 0.0001;
  const hasDashboardDifference = dashboardTotal !== undefined && Math.abs(automaticDifference) > 0.0001;

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={(
        <div className="revenue-actions">
          <Button icon={Printer} variant="ghost" onClick={() => window.print()}>طباعة PDF</Button>
          <Button icon={FileSpreadsheet} variant="secondary" onClick={exportExcel}>تصدير Excel</Button>
        </div>
      )}
    >
      <div className="audit-filters">
        <label>
          <span>التاريخ</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          <span>البائع</span>
          <select value={filters.sellerId} onChange={(event) => updateFilter('sellerId', event.target.value)}>
            <option value="">الكل</option>
            {optionsFor('seller').map((option) => (
              <option key={`seller-${option.optionValue}`} value={option.optionValue}>{option.optionLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>الفترة</span>
          <select value={filters.period} onChange={(event) => updateFilter('period', event.target.value)}>
            <option value="">الكل</option>
            {optionsFor('period').map((option) => (
              <option key={`period-${option.optionValue}`} value={option.optionValue}>{option.optionLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>طريقة الدفع</span>
          <select value={filters.paymentMethod} onChange={(event) => updateFilter('paymentMethod', event.target.value)}>
            <option value="">الكل</option>
            {optionsFor('paymentMethod').map((option) => (
              <option key={`payment-${option.optionValue}`} value={option.optionValue}>{option.optionLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>نوع الحركة</span>
          <select value={filters.movementType} onChange={(event) => updateFilter('movementType', event.target.value)}>
            <option value="">الكل</option>
            {optionsFor('movementType').map((option) => (
              <option key={`type-${option.optionValue}`} value={option.optionValue}>{option.optionLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>إجمالي لوحة التحكم</span>
          <input
            inputMode="decimal"
            value={filters.expectedTotal}
            onChange={(event) => updateFilter('expectedTotal', event.target.value)}
            placeholder={dashboardTotal === undefined ? 'اختياري' : formatNumber(dashboardTotal)}
          />
        </label>
      </div>

      <AsyncBlock loading={loading} error={error} empty={!data}>
        {hasDashboardDifference ? (
          <div className="audit-alert">
            يوجد فرق بين إجمالي التقرير وإجمالي لوحة التحكم السابق: {formatNumber(automaticDifference)}
          </div>
        ) : null}
        {hasManualDifference ? (
          <div className="audit-alert">
            يوجد فرق بين إجمالي التقرير والإجمالي المدخل: {formatNumber(manualDifference)}
          </div>
        ) : null}

        <div className="summary-grid">
          <SummaryCard label="إجمالي المبيعات النقدية" value={formatNumber(summary.cashSalesTotal)} />
          <SummaryCard label="إجمالي سداد المدينين" value={formatNumber(summary.debtorPaymentsTotal)} />
          <SummaryCard label="إجمالي المردودات" value={formatNumber(summary.returnsTotal)} />
          <SummaryCard label="إجمالي المدفوعات الإلكترونية" value={formatNumber(summary.electronicPaymentsTotal)} />
          <SummaryCard label="صافي الإيراد النهائي" value={formatNumber(summary.netRevenue)} />
          <SummaryCard label="عدد الحركات" value={formatNumber(summary.movementCount)} />
        </div>

        <section className="revenue-sources">
          <h3 className="subheading">مصادر الإيراد</h3>
          {(data?.sources || []).map((source) => (
            <div className={`source-line ${Number(source.total || 0) < 0 ? 'is-negative' : ''}`} key={source.sourceName}>
              <span>{source.sourceName}</span>
              <strong>{formatNumber(source.total)}</strong>
            </div>
          ))}
          <div className="source-line is-total">
            <span>الصافي النهائي</span>
            <strong>{formatNumber(summary.netRevenue)}</strong>
          </div>
        </section>

        <h3 className="subheading">إيراد الفترات</h3>
        <DataTable
          columns={[
            { key: 'sellerName', label: 'اسم البائع' },
            { key: 'total', label: 'الإيراد', format: formatNumber },
            { key: 'movementCount', label: 'عدد الحركات', format: formatNumber }
          ]}
          rows={data?.sellerTotals || []}
          onRowClick={(row) => updateFilter('sellerId', String(row.sellerId ?? ''))}
        />

        <h3 className="subheading">كل حركات الإيراد</h3>
        <DataTable
          columns={[
            {
              key: 'movementNo',
              label: 'رقم الحركة',
              render: (row) => (
                <button className="link-button" type="button" onClick={(event) => {
                  event.stopPropagation();
                  openMovement(row.movementNo);
                }}>
                  {row.movementNo}
                </button>
              )
            },
            {
              key: 'invoiceNo',
              label: 'رقم الفاتورة',
              render: (row) => row.invoiceNo ? (
                <button className="link-button" type="button" onClick={(event) => {
                  event.stopPropagation();
                  openMovement(row.movementNo);
                }}>
                  {row.invoiceNo}
                </button>
              ) : '-'
            },
            { key: 'movementDate', label: 'تاريخ الحركة', format: formatDate },
            { key: 'movementType', label: 'نوع الحركة' },
            { key: 'customerName', label: 'اسم العميل' },
            { key: 'sellerName', label: 'اسم البائع' },
            { key: 'paymentMethod', label: 'طريقة الدفع' },
            { key: 'amount', label: 'القيمة', format: formatNumber },
            { key: 'period', label: 'الفترة' },
            { key: 'notes', label: 'ملاحظات' }
          ]}
          rows={data?.rows || []}
          onRowClick={(row) => openMovement(row.movementNo)}
        />

        {movementError ? <div className="soft-state is-error"><AlertTriangle size={24} />{movementError}</div> : null}
        {movementLoading ? <div className="soft-state"><RefreshCcw size={24} />جاري تحميل تفاصيل الحركة</div> : null}
        {selectedMovement?.movement ? (
          <section className="detail-drawer">
            <div className="module-title">
              <Eye size={22} />
              <div>
                <p className="eyebrow">Audit trace</p>
                <h3>تفاصيل الحركة {selectedMovement.movement.movementNo}</h3>
              </div>
            </div>
            <div className="summary-grid">
              <SummaryCard label="رقم الفاتورة" value={selectedMovement.movement.invoiceNo || '-'} />
              <SummaryCard label="الحساب" value={selectedMovement.movement.accountName || '-'} />
              <SummaryCard label="طريقة الدفع" value={selectedMovement.movement.paymentMethod || '-'} />
              <SummaryCard label="القيمة" value={formatNumber(selectedMovement.movement.amount)} />
            </div>
            <h3 className="subheading">دفعات مرتبطة بنفس الفاتورة</h3>
            <DataTable
              columns={[
                { key: 'movementNo', label: 'رقم الحركة' },
                { key: 'movementDate', label: 'التاريخ', format: formatDate },
                { key: 'accountName', label: 'الحساب' },
                { key: 'paymentMethod', label: 'طريقة الدفع' },
                { key: 'amount', label: 'القيمة', format: formatNumber },
                { key: 'sellerName', label: 'البائع' },
                { key: 'notes', label: 'ملاحظات' }
              ]}
              rows={selectedMovement.linkedPayments || []}
            />
            <h3 className="subheading">بنود الفاتورة الأصلية</h3>
            <DataTable
              columns={[
                { key: 'detailNo', label: 'رقم البند' },
                { key: 'itemName', label: 'الصنف' },
                { key: 'barcode', label: 'الباركود' },
                { key: 'quantity', label: 'الكمية', format: formatNumber },
                { key: 'chargeValue', label: 'القيمة', format: formatNumber },
                { key: 'itemCost', label: 'التكلفة', format: formatNumber },
                { key: 'expiryDate', label: 'الصلاحية', format: formatDate },
                { key: 'notes', label: 'ملاحظات' }
              ]}
              rows={selectedMovement.invoiceLines || []}
            />
          </section>
        ) : null}
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

function DataTable({ columns, rows, onRowClick }) {
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
            <tr
              className={onRowClick ? 'is-clickable' : ''}
              key={row.id ?? row.movementNo ?? row.invoiceNumber ?? row.receiptNumber ?? `${row.itemName || 'row'}-${rowIndex}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : column.format ? column.format(row[column.key]) : row[column.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
