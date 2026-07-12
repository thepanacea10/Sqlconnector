import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
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

function formatPackMovementQuantity(value, packSize) {
  const raw = Math.abs(Number(value || 0));
  const pack = Number(packSize || 0);
  if (!Number.isFinite(raw)) return '-';
  if (!Number.isFinite(pack) || pack <= 1) return `${formatNumber(raw)} وحدة`;
  const packages = Math.floor(raw / pack);
  const units = raw - packages * pack;
  if (packages > 0 && units > 0) return `${formatNumber(packages)} علبة + ${formatNumber(units)} وحدة`;
  if (packages > 0) return `${formatNumber(packages)} علبة`;
  return `${formatNumber(units)} وحدة`;
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

function formatShortDate(value) {
  if (!value) return '-';
  const parts = splitSqlDateTime(value);
  if (parts) return `${parts.day}-${parts.month}-${parts.year}`;
  return formatDate(value).replace(/\//g, '-');
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

function shiftInputDate(value, days) {
  const base = value ? new Date(`${value}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return todayInputValue();
  base.setDate(base.getDate() + days);
  const localDate = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function inputDateRange(dateFrom, dateTo) {
  const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date();
  const end = dateTo ? new Date(`${dateTo}T00:00:00`) : start;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [todayInputValue()];
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const days = [];
  const cursor = new Date(first);
  while (cursor <= last) {
    const localDate = new Date(cursor.getTime() - cursor.getTimezoneOffset() * 60000);
    days.push(localDate.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function inputDateFromValue(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function exportRowsAsCsv(filename, headers, rows) {
  const csvRows = [
    headers.map((header) => header.label),
    ...rows.map((row) => headers.map((header) => {
      const source = header.value ?? header.key;
      const rawValue = typeof source === 'function' ? source(row) : row[source];
      const value = header.render ? header.render(row) : header.format ? header.format(rawValue, row) : rawValue;
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

function exportRowsAsExcel(filename, headers, rows) {
  const tableRows = [
    headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join(''),
    ...rows.map((row) => headers.map((header) => {
      const source = header.value ?? header.key;
      const rawValue = typeof source === 'function' ? source(row) : row[source];
      const value = header.render ? header.render(row) : header.format ? header.format(rawValue, row) : rawValue;
      return `<td>${escapeHtml(value ?? '')}</td>`;
    }).join(''))
  ].map((row) => `<tr>${row}</tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printedAtText() {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false
  }).format(new Date());
}

function PrintHeader({ title, meta = [] }) {
  return (
    <div className="print-header">
      <div>
        <h1>{title}</h1>
        <p>Teryaq SQL Connector</p>
      </div>
      <div className="print-meta">
        {meta.filter((item) => item?.value !== undefined && item.value !== null && item.value !== '').map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrintTable({ columns, rows }) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          {columns.map((column) => <th key={column.key}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {(rows || []).map((row, index) => (
          <tr key={row.id ?? row.movementNo ?? row.invoiceNumber ?? row.refNo ?? index}>
            {columns.map((column) => {
              const raw = typeof column.value === 'function' ? column.value(row) : row[column.key];
              const value = column.format ? column.format(raw, row) : raw;
              return <td key={column.key}>{value ?? '-'}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintFooter({ totals = [] }) {
  return (
    <div className="print-footer">
      <div className="print-totals">
        {totals.filter((item) => item?.value !== undefined && item.value !== null && item.value !== '').map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="print-signature">
        <span>تاريخ الطباعة: {printedAtText()}</span>
        <span>التوقيع: ____________________</span>
      </div>
    </div>
  );
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
const APP_STATE_KEY = 'teryaq:last-state:v1';

function readStoredAppState() {
  try {
    return JSON.parse(window.localStorage.getItem(APP_STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStoredAppState(nextState) {
  try {
    window.localStorage.setItem(APP_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // Storage can be unavailable in private contexts; the app should still work normally.
  }
}

function patchStoredAppState(patch) {
  const current = readStoredAppState();
  writeStoredAppState({
    ...current,
    ...patch,
    modules: {
      ...(current.modules || {}),
      ...(patch.modules || {})
    }
  });
}

function storedModuleState(moduleKey) {
  return readStoredAppState().modules?.[moduleKey] || {};
}

function patchStoredModuleState(moduleKey, patch) {
  const current = readStoredAppState();
  writeStoredAppState({
    ...current,
    modules: {
      ...(current.modules || {}),
      [moduleKey]: {
        ...(current.modules?.[moduleKey] || {}),
        ...patch
      }
    }
  });
}

function useStoredState(moduleKey, field, initialValue) {
  const [value, setValue] = useState(() => {
    const storedValue = storedModuleState(moduleKey)?.[field];
    return storedValue === undefined ? initialValue : storedValue;
  });

  useEffect(() => {
    patchStoredModuleState(moduleKey, { [field]: value });
  }, [moduleKey, field, value]);

  return [value, setValue];
}

function App() {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [route, setRoute] = useState(() => {
    const currentPath = window.location.pathname;
    if (currentPath !== '/') return currentPath;
    const savedRoute = readStoredAppState().route;
    return savedRoute === '/ai-assistant' ? savedRoute : currentPath;
  });

  const navigate = (path) => {
    patchStoredAppState({ route: path, activeModule: path === '/ai-assistant' ? null : readStoredAppState().activeModule || null });
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

function Button({ icon: Icon, children, variant = 'primary', className = '', ...props }) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} type="button" {...props}>
      {Icon ? <Icon size={20} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function SetupPage({ onConnected }) {
  const emptyForm = {
    id: '',
    name: '',
    server: '',
    database: '',
    user: '',
    password: '',
    port: '',
    encrypt: false,
    trustServerCertificate: true
  };
  const [form, setForm] = useState({
    ...emptyForm
  });
  const [savedConnections, setSavedConnections] = useState([]);
  const [activeConnectionId, setActiveConnectionId] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [result, setResult] = useState(null);

  const loadSavedConnections = async () => {
    try {
      const data = await api.savedConnections();
      setSavedConnections(data.connections || []);
      setActiveConnectionId(data.activeConnectionId || '');
    } catch (error) {
      setResult({ ok: false, text: 'تعذر تحميل الاتصالات المحفوظة', details: error.message });
    }
  };

  useEffect(() => {
    loadSavedConnections();
  }, []);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const selectSavedConnection = (connection) => {
    setForm({
      ...emptyForm,
      ...connection,
      password: '',
      port: connection.port ?? ''
    });
    setResult({
      ok: true,
      text: 'تم اختيار الاتصال',
      details: 'أدخل كلمة المرور فقط إذا أردت تغييرها، أو استخدم الاتصال المحفوظ مباشرة.'
    });
  };

  const newConnection = () => {
    setForm({ ...emptyForm });
    setResult(null);
  };

  const useSavedConnection = async (connection) => {
    setBusyAction(`use-${connection.id}`);
    setResult(null);
    try {
      const data = await api.useSavedConnection(connection.id);
      setResult({ ok: true, text: 'Connected', details: data.message });
      onConnected(data.connection);
    } catch (error) {
      setResult({ ok: false, text: 'Connection Failed', details: error.message });
    } finally {
      setBusyAction('');
    }
  };

  const testConnection = async () => {
    setBusyAction('test');
    setResult(null);
    try {
      const data = await api.testConnection(form);
      setResult({ ok: true, text: 'Connected', details: data.message });
    } catch (error) {
      setResult({ ok: false, text: 'Connection Failed', details: error.message });
    } finally {
      setBusyAction('');
    }
  };

  const saveConnection = async () => {
    setBusyAction('save');
    setResult(null);
    try {
      const data = await api.saveConnection(form);
      setResult({ ok: true, text: 'Connected', details: data.message });
      await loadSavedConnections();
      onConnected(data.connection);
    } catch (error) {
      setResult({ ok: false, text: 'Connection Failed', details: error.message });
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
          {savedConnections.length ? (
            <div className="saved-connections">
              <div className="saved-connections-header">
                <div>
                  <span>الاتصالات المحفوظة</span>
                  <strong>اختر قاعدة البيانات التي تريد العمل عليها</strong>
                </div>
                <Button icon={Save} variant="ghost" onClick={newConnection}>اتصال جديد</Button>
              </div>
              <div className="saved-connection-grid">
                {savedConnections.map((connection) => (
                  <article
                    className={`saved-connection-card ${connection.id === activeConnectionId ? 'is-active' : ''}`}
                    key={connection.id}
                  >
                    <div>
                      <strong>{connection.name || connection.server}</strong>
                      <span>{connection.server}</span>
                      <small>{connection.database} · {connection.user}</small>
                    </div>
                    <div className="saved-connection-actions">
                      <Button
                        icon={PlugZap}
                        onClick={() => useSavedConnection(connection)}
                        disabled={Boolean(busyAction)}
                      >
                        {busyAction === `use-${connection.id}` ? 'جاري الاتصال' : 'استخدام'}
                      </Button>
                      <Button
                        icon={Server}
                        variant="secondary"
                        onClick={() => selectSavedConnection(connection)}
                        disabled={Boolean(busyAction)}
                      >
                        تعديل
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          <TextInput
            label="اسم الاتصال"
            value={form.name}
            onChange={(value) => updateField('name', value)}
            autoComplete="off"
          />
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
  const validModules = ['customers', 'items', 'sales', 'trading', 'reports', 'analytics', 'settings'];
  const [activeModule, setActiveModule] = useState(() => {
    const savedModule = readStoredAppState().activeModule;
    return validModules.includes(savedModule) ? savedModule : null;
  });

  const cards = useMemo(
    () => [
      { key: 'customers', title: 'حسابات الزبائن', icon: Users, tone: 'teal' },
      { key: 'items', title: 'الأصناف', icon: Package, tone: 'blue' },
      { key: 'sales', title: 'إيراد اليوم', icon: BadgeDollarSign, tone: 'violet' },
      { key: 'trading', title: 'المتاجرة والأرباح', icon: ClipboardList, tone: 'green' },
      { key: 'reports', title: 'التقارير', icon: Database, tone: 'slate' },
      { key: 'analytics', title: 'مركز التحليلات', icon: Boxes, tone: 'teal' },
      { key: 'ai', title: 'المساعد الذكي', icon: Bot, tone: 'slate' }
    ],
    []
  );

  const currentCard = cards.find((card) => card.key === activeModule)
    || (activeModule === 'settings' ? { title: 'حالة الاتصال', icon: Server } : null);

  const openModule = (moduleKey) => {
    if (moduleKey === 'ai') {
      patchStoredAppState({ activeModule: null, route: '/ai-assistant' });
      onOpenAssistant();
      return;
    }
    patchStoredAppState({ activeModule: moduleKey, route: '/' });
    setActiveModule(moduleKey);
  };

  const closeModule = () => {
    patchStoredAppState({ activeModule: null, route: '/' });
    setActiveModule(null);
  };

  return (
    <main className="dashboard-page">
      {activeModule ? (
        <ModuleRouter
          card={currentCard}
          moduleKey={activeModule}
          onBack={closeModule}
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
              <Button icon={Server} variant="ghost" onClick={() => openModule('settings')}>حالة الاتصال</Button>
            </div>
          </header>

          <section className="dashboard-grid">
            {cards.map((card) => (
              <button
                className={`dashboard-card tone-${card.tone}`}
                key={card.key}
                type="button"
                onClick={() => openModule(card.key)}
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
  if (moduleKey === 'items') return <ItemsModule title="الأصناف" icon={PackageSearch} onBack={onBack} />;
  if (moduleKey === 'sales') {
    return <RevenueDrilldownModule title="تفاصيل الإيراد" icon={card.icon} onBack={onBack} />;
  }
  if (moduleKey === 'trading') return <TradingProfitModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'reports') return <ReportsModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'analytics') return <AnalyticsCenterModule title={card.title} icon={card.icon} onBack={onBack} />;
  if (moduleKey === 'settings') return <ConnectionStatusModule title={card.title} icon={card.icon} onBack={onBack} onSetup={onSetup} />;
  return null;
}

const analyticsModules = [
  { key: 'global', title: 'البحث العالمي', icon: Search, status: 'ready' },
  { key: 'item-card', title: 'بطاقة الصنف الاحترافية', icon: PackageSearch, status: 'ready' },
  { key: 'daily-profit', title: 'لوحة الأرباح اليومية', icon: BadgeDollarSign, status: 'ready' },
  { key: 'shortages', title: 'تحليل النواقص الذكي', icon: AlertTriangle, status: 'ready' },
  { key: 'expiry', title: 'تقرير انتهاء الصلاحية', icon: CalendarClock, status: 'ready' },
  { key: 'price-changes', title: 'مراقبة الأسعار', icon: FileSpreadsheet, status: 'ready' },
  { key: 'item-profit', title: 'كشف ربح الصنف', icon: ClipboardList, status: 'ready' },
  { key: 'compare', title: 'مقارنة الفترات', icon: Database, status: 'ready' },
  { key: 'goods-capital', title: 'المتاجرة والأرباح', icon: Package, status: 'ready' },
  { key: 'alerts', title: 'تنبيهات ذكية', icon: AlertTriangle, status: 'ready' },
  { key: 'manager', title: 'Dashboard للمدير', icon: Boxes, status: 'ready' },
  { key: 'timeline', title: 'سجل كامل للصنف Timeline', icon: ClipboardList, status: 'ready' },
  { key: 'exports', title: 'تصدير احترافي', icon: FileSpreadsheet, status: 'todo' },
  { key: 'assistant', title: 'مساعد تقارير بدون AI', icon: Bot, status: 'ready' }
];

function AnalyticsCenterModule({ title, icon, onBack }) {
  const [active, setActive] = useState(null);
  const activeConfig = analyticsModules.find((item) => item.key === active);

  if (activeConfig) {
    return (
      <ModuleShell title={activeConfig.title} icon={activeConfig.icon} onBack={() => setActive(null)}>
        <AnalyticsModuleContent moduleKey={activeConfig.key} onOpenModule={setActive} />
      </ModuleShell>
    );
  }

  return (
    <ModuleShell title={title} icon={icon} onBack={onBack}>
      <section className="analytics-grid">
        {analyticsModules.map((module) => (
          <button
            className={`analytics-card ${module.status === 'todo' ? 'is-muted' : ''}`}
            key={module.key}
            type="button"
            onClick={() => setActive(module.key)}
          >
            <module.icon size={24} />
            <span>{module.title}</span>
            <small>{module.status === 'todo' ? 'قريباً' : 'جاهز للعرض'}</small>
          </button>
        ))}
      </section>
    </ModuleShell>
  );
}

function AnalyticsModuleContent({ moduleKey, onOpenModule }) {
  if (moduleKey === 'global') return <AnalyticsGlobalSearch />;
  if (moduleKey === 'item-card') return <AnalyticsItemLookup mode="card" />;
  if (moduleKey === 'item-profit') return <AnalyticsItemLookup mode="profit" />;
  if (moduleKey === 'timeline') return <AnalyticsItemLookup mode="timeline" />;
  if (moduleKey === 'daily-profit') return <AnalyticsDailyProfit />;
  if (moduleKey === 'shortages') return <AnalyticsSmartShortages />;
  if (moduleKey === 'expiry') return <AnalyticsExpiryReport />;
  if (moduleKey === 'price-changes') return <AnalyticsPriceChanges />;
  if (moduleKey === 'compare') return <AnalyticsComparePeriods />;
  if (moduleKey === 'goods-capital') return <AnalyticsGoodsCapital />;
  if (moduleKey === 'alerts') return <AnalyticsAlerts />;
  if (moduleKey === 'manager') return <AnalyticsManagerDashboard />;
  if (moduleKey === 'assistant') return <AnalyticsTemplateAssistant onOpenModule={onOpenModule} />;
  return <div className="soft-state">سيتم تفعيل هذا الجزء بعد تثبيت قوالب التصدير الخاصة بالمركز.</div>;
}

function AnalyticsToolbar({ children, actions }) {
  return (
    <div className="analytics-toolbar">
      <div>{children}</div>
      <div className="analytics-toolbar-actions">{actions}</div>
    </div>
  );
}

function AnalyticsGlobalSearch() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.analyticsGlobalSearch(query);
      setRows(data.rows || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { key: 'resultType', label: 'النوع' },
    { key: 'title', label: 'النتيجة' },
    { key: 'subtitle', label: 'تفاصيل' }
  ];

  if (selectedItemId) {
    return <AnalyticsItemDetails itemId={selectedItemId} mode="card" onClear={() => setSelectedItemId('')} />;
  }

  return (
    <>
      <SearchBar icon={Search} value={query} onChange={setQuery} onSubmit={runSearch} placeholder="ابحث عن صنف، باركود، فاتورة، زبون، مورد، حركة" />
      <AsyncBlock loading={loading} error={error} empty={!rows.length} emptyMessage="ابدأ البحث أو لا توجد نتائج">
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(row) => {
            if (row.targetType === 'item') setSelectedItemId(row.targetId);
          }}
        />
      </AsyncBlock>
    </>
  );
}

function AnalyticsItemLookup({ mode }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setSelectedItemId('');
    try {
      const data = await api.analyticsGlobalSearch(query);
      setResults((data.rows || []).filter((row) => row.targetType === 'item'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (selectedItemId) {
    return <AnalyticsItemDetails itemId={selectedItemId} mode={mode} onClear={() => setSelectedItemId('')} />;
  }

  return (
    <>
      <SearchBar icon={Search} value={query} onChange={setQuery} onSubmit={search} placeholder="اكتب اسم الصنف أو الكود أو الباركود" />
      <AsyncBlock loading={loading} error={error} empty={!results.length} emptyMessage="اختر الصنف يدوياً بعد البحث">
        <div className="compact-list">
          {results.map((row) => (
            <button className="compact-row" type="button" key={`${row.targetId}-${row.title}`} onClick={() => setSelectedItemId(row.targetId)}>
              <strong>{row.title}</strong>
              <span>{row.subtitle || row.targetId}</span>
            </button>
          ))}
        </div>
      </AsyncBlock>
    </>
  );
}

function AnalyticsItemDetails({ itemId, mode, onClear }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');

  const applyMonth = (value) => {
    setSelectedMonth(value);
    if (!value) return;
    const [year, month] = value.split('-').map(Number);
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEndDate = new Date(year, month, 0);
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;
    setDateFrom(monthStart);
    setDateTo(monthEnd);
  };

  const clearDateRange = () => {
    setSelectedMonth('');
    setDateFrom('');
    setDateTo('');
  };

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    const loader = mode === 'profit'
      ? api.analyticsItemProfit(itemId, { dateFrom, dateTo })
      : mode === 'timeline'
        ? api.analyticsItemTimeline(itemId)
        : api.analyticsItemCard(itemId);
    loader
      .then((result) => {
        if (!ignore) setData(result);
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [itemId, mode, dateFrom, dateTo]);

  const item = data?.item;
  const metricCards = [
    ['المخزون', item?.formattedQuantity || item?.currentStock],
    ['بالوحدة', item?.rawQuantityInSmallUnits ?? item?.currentStock],
    ['آخر شراء', item?.purchasePrice],
    ['آخر بيع', item?.salePrice],
    ['متوسط التكلفة', data?.metrics?.averageCost],
    ['أعلى سعر بيع', data?.metrics?.highestSalePrice],
    ['أقل سعر بيع', data?.metrics?.lowestSalePrice],
    ['ربح تقريبي', data?.metrics?.approximateProfit],
    ['أول شراء', formatDate(data?.metrics?.firstPurchaseDate)],
    ['آخر شراء', formatDate(data?.metrics?.lastPurchaseDate)],
    ['آخر بيع', formatDate(data?.metrics?.lastSaleDate)],
    ['عدد المبيعات', data?.metrics?.salesCount]
  ];

  const movementColumns = [
    { key: 'date', label: 'التاريخ', format: formatDate },
    { key: 'movementType', label: 'الحركة' },
    { key: 'movementNo', label: 'رقم الحركة' },
    { key: 'personName', label: 'الطرف' },
    { key: 'quantity', label: 'الكمية', format: formatNumber },
    { key: 'price', label: 'السعر', format: formatNumber },
    { key: 'total', label: 'الإجمالي', format: formatNumber }
  ];

  return (
    <AsyncBlock loading={loading} error={error} empty={!data?.item}>
      <div className="analytics-detail-header">
        <Button icon={ArrowRight} variant="ghost" onClick={onClear}>رجوع للبحث</Button>
        <div>
          <h3>{item?.itemName}</h3>
          <p>{item?.barcode || item?.itemCode}</p>
        </div>
      </div>
      {mode === 'timeline' ? (
        <DataTable columns={movementColumns} rows={data?.rows || []} />
      ) : mode === 'profit' ? (
        <>
          <AnalyticsToolbar>
            <div className="date-row compact">
              <TextInput label="من تاريخ" type="date" value={dateFrom} onChange={(value) => { setDateFrom(value); setSelectedMonth(''); }} />
              <TextInput label="إلى تاريخ" type="date" value={dateTo} onChange={(value) => { setDateTo(value); setSelectedMonth(''); }} />
              <TextInput label="اختيار شهر" type="month" value={selectedMonth} onChange={applyMonth} />
              <Button icon={RefreshCcw} variant="secondary" onClick={clearDateRange}>كل الفترة</Button>
            </div>
          </AnalyticsToolbar>
          <section className="summary-grid compact">
            {[
              ['إجمالي المشتريات', data?.summary?.totalPurchasedQuantity],
              ['إجمالي المبيعات', data?.summary?.totalSoldQuantity],
              ['المتبقي', data?.summary?.remainingQuantity],
              ['قيمة المبيعات', data?.summary?.totalSalesValue],
              ['الربح التقريبي', data?.summary?.totalApproximateProfit],
              ['هامش الربح', data?.summary?.profitMarginPercent]
            ].map(([label, value]) => <SummaryCard key={label} label={label} value={value === null || value === undefined ? 'غير متوفر' : formatNumber(value)} />)}
          </section>
          <DataTable columns={[{ key: 'name', label: 'المورد' }, { key: 'quantity', label: 'الكمية', format: formatNumber }, { key: 'total', label: 'الإجمالي', format: formatNumber }]} rows={data?.suppliers || []} />
        </>
      ) : (
        <>
          <section className="summary-grid compact">
            {metricCards.map(([label, value]) => <SummaryCard key={label} label={label} value={value === null || value === undefined ? 'غير متوفر' : value} />)}
          </section>
          <h3 className="section-title">الموردون</h3>
          <DataTable columns={[{ key: 'name', label: 'المورد' }, { key: 'movementCount', label: 'الحركات', format: formatNumber }, { key: 'quantity', label: 'الكمية', format: formatNumber }]} rows={data?.suppliers || []} />
          <h3 className="section-title">العملاء</h3>
          <DataTable columns={[{ key: 'name', label: 'العميل' }, { key: 'movementCount', label: 'الحركات', format: formatNumber }, { key: 'quantity', label: 'الكمية', format: formatNumber }]} rows={data?.customers || []} />
        </>
      )}
    </AsyncBlock>
  );
}

function AnalyticsDailyProfit() {
  const [dateFrom, setDateFrom] = useState(todayInputValue());
  const [dateTo, setDateTo] = useState(todayInputValue());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.analyticsDailyProfit({ dateFrom, dateTo }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  const columns = [
    { key: 'itemName', label: 'الصنف' },
    { key: 'quantity', label: 'الكمية', format: formatNumber },
    { key: 'salesValue', label: 'المبيعات', format: formatNumber },
    { key: 'approximateProfit', label: 'ربح تقريبي', format: formatNumber }
  ];
  return (
    <>
      <AnalyticsToolbar actions={<Button icon={FileSpreadsheet} variant="secondary" onClick={() => exportRowsAsCsv(`analytics-profit-${dateFrom}-${dateTo}.csv`, columns, data?.bestProfitItems || [])}>CSV</Button>}>
        <div className="date-row compact">
          <TextInput label="من تاريخ" type="date" value={dateFrom} onChange={setDateFrom} />
          <TextInput label="إلى تاريخ" type="date" value={dateTo} onChange={setDateTo} />
          <Button icon={RefreshCcw} onClick={load}>تحديث</Button>
        </div>
      </AnalyticsToolbar>
      <AsyncBlock loading={loading} error={error} empty={!data}>
        <section className="summary-grid compact">
          <SummaryCard label="إيراد الفترة" value={formatNumber(data?.revenue?.netRevenue)} />
          <SummaryCard label="الربح الرسمي" value={data?.tradingProfit?.netProfit === undefined ? 'غير متوفر' : formatNumber(data.tradingProfit.netProfit)} />
          <SummaryCard label="عدد الحركات" value={formatNumber(data?.revenue?.movementCount)} />
        </section>
        <h3 className="section-title">أفضل 20 صنفاً ربحاً</h3>
        <DataTable columns={columns} rows={data?.bestProfitItems || []} />
        <h3 className="section-title">أقل 20 صنفاً ربحاً</h3>
        <DataTable columns={columns} rows={data?.worstProfitItems || []} />
      </AsyncBlock>
    </>
  );
}

function AnalyticsSmartShortages() {
  return <AnalyticsSimpleTable loader={api.analyticsSmartShortages} filename="analytics-shortages.csv" columns={[
    { key: 'itemName', label: 'الصنف' },
    { key: 'barcode', label: 'الباركود' },
    { key: 'lastPurchaseDate', label: 'آخر شراء', format: formatDate },
    { key: 'lastSaleDate', label: 'آخر بيع', format: formatDate },
    { key: 'lastSupplier', label: 'آخر مورد' },
    { key: 'purchasePrice', label: 'آخر شراء', format: formatNumber },
    { key: 'salePrice', label: 'آخر بيع', format: formatNumber },
    { key: 'suggestedReorderQuantity', label: 'اقتراح الطلب', format: (value) => value ?? 'غير متوفر' }
  ]} />;
}

function AnalyticsExpiryReport() {
  const [days, setDays] = useState(90);
  return (
    <>
      <div className="segmented">
        {[30, 60, 90, 180].map((option) => (
          <button className={days === option ? 'is-active' : ''} key={option} type="button" onClick={() => setDays(option)}>
            {option === 180 ? '6 أشهر' : `${option} يوم`}
          </button>
        ))}
      </div>
      <AnalyticsSimpleTable loader={() => api.analyticsExpiry(days)} filename={`analytics-expiry-${days}.csv`} columns={[
        { key: 'itemName', label: 'الصنف' },
        { key: 'barcode', label: 'الباركود' },
        { key: 'formattedQuantity', label: 'الكمية' },
        { key: 'expiryDate', label: 'الصلاحية', format: formatDate },
        { key: 'daysRemaining', label: 'الأيام', format: formatNumber },
        { key: 'purchasePrice', label: 'شراء', format: formatNumber },
        { key: 'salePrice', label: 'بيع', format: formatNumber },
        { key: 'estimatedValue', label: 'قيمة تقديرية', format: formatNumber }
      ]} reloadKey={days} />
    </>
  );
}

function AnalyticsPriceChanges() {
  return <AnalyticsSimpleTable loader={api.analyticsPriceChanges} filename="analytics-price-changes.csv" columns={[
    { key: 'itemName', label: 'الصنف' },
    { key: 'barcode', label: 'الباركود' },
    { key: 'previousPurchasePrice', label: 'السابق', format: formatNumber },
    { key: 'latestPurchasePrice', label: 'الحالي', format: formatNumber },
    { key: 'difference', label: 'الفرق', format: formatNumber },
    { key: 'percentChange', label: '%', format: formatNumber },
    { key: 'latestPriceDate', label: 'آخر تاريخ', format: formatDate },
    { key: 'supplierName', label: 'المورد' }
  ]} />;
}

function AnalyticsComparePeriods() {
  const [filters, setFilters] = useState({ leftFrom: todayInputValue(), leftTo: todayInputValue(), rightFrom: todayInputValue(), rightTo: todayInputValue() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try { setData(await api.analyticsComparePeriods(filters)); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return (
    <>
      <div className="date-row compact">
        <TextInput label="الفترة 1 من" type="date" value={filters.leftFrom} onChange={(value) => update('leftFrom', value)} />
        <TextInput label="الفترة 1 إلى" type="date" value={filters.leftTo} onChange={(value) => update('leftTo', value)} />
        <TextInput label="الفترة 2 من" type="date" value={filters.rightFrom} onChange={(value) => update('rightFrom', value)} />
        <TextInput label="الفترة 2 إلى" type="date" value={filters.rightTo} onChange={(value) => update('rightTo', value)} />
        <Button icon={RefreshCcw} onClick={load}>قارن</Button>
      </div>
      <AsyncBlock loading={loading} error={error} empty={!data}>
        <section className="summary-grid compact">
          <SummaryCard label="إيراد الفترة 1" value={formatNumber(data?.left?.revenue?.netRevenue)} />
          <SummaryCard label="إيراد الفترة 2" value={formatNumber(data?.right?.revenue?.netRevenue)} />
          <SummaryCard label="ربح الفترة 1" value={formatNumber(data?.left?.profit?.netProfit)} />
          <SummaryCard label="ربح الفترة 2" value={formatNumber(data?.right?.profit?.netProfit)} />
        </section>
      </AsyncBlock>
    </>
  );
}

function AnalyticsGoodsCapital() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.analyticsGoodsCapital());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <AnalyticsToolbar actions={<Button icon={RefreshCcw} variant="secondary" onClick={load}>تحديث</Button>}>
        <p className="muted-text">ملخص مالي سريع بنفس شكل شاشة المتاجرة والأرباح في المحاسب.</p>
      </AnalyticsToolbar>
      <AsyncBlock loading={loading} error={error} empty={!data}>
        <div className="goods-capital-sections">
          {(data?.sections || [{ title: 'بضاعة', rows: data?.rows || [] }]).map((section) => (
            <section className="goods-capital-card" key={section.title}>
              <h3>{section.title}</h3>
              <div className="goods-capital-list">
                {(section.rows || []).map((row) => (
                  <div className={`goods-capital-row ${row.highlight ? 'is-highlight' : ''}`} key={`${section.title}-${row.label}`}>
                    <span>{row.label}</span>
                    <strong>{formatNumber(row.value)}</strong>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="muted-text">{data?.formula}</p>
      </AsyncBlock>
    </>
  );
}

function AnalyticsUsersReport() {
  const [dateFrom, setDateFrom] = useState(todayInputValue());
  const [dateTo, setDateTo] = useState(todayInputValue());
  const columns = [
    { key: 'sellerName', label: 'المستخدم/الفترة' },
    { key: 'total', label: 'المبيعات', format: formatNumber },
    { key: 'movementCount', label: 'عدد الحركات', format: formatNumber }
  ];
  return (
    <>
      <div className="date-row compact">
        <TextInput label="من تاريخ" type="date" value={dateFrom} onChange={setDateFrom} />
        <TextInput label="إلى تاريخ" type="date" value={dateTo} onChange={setDateTo} />
      </div>
      <AnalyticsSimpleTable loader={() => api.analyticsUsersReport({ dateFrom, dateTo })} filename={`analytics-users-${dateFrom}-${dateTo}.csv`} columns={columns} reloadKey={`${dateFrom}-${dateTo}`} />
    </>
  );
}

function AnalyticsAlerts() {
  return <AnalyticsSimpleTable loader={api.analyticsAlerts} filename="analytics-alerts.csv" columns={[
    { key: 'severity', label: 'الأهمية' },
    { key: 'title', label: 'التنبيه' },
    { key: 'value', label: 'العدد', format: formatNumber },
    { key: 'message', label: 'التفاصيل' }
  ]} />;
}

function AnalyticsManagerDashboard() {
  const [dateFrom, setDateFrom] = useState(todayInputValue());
  const [dateTo, setDateTo] = useState(todayInputValue());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try { setData(await api.analyticsManagerDashboard({ dateFrom, dateTo })); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="date-row compact">
        <TextInput label="من تاريخ" type="date" value={dateFrom} onChange={setDateFrom} />
        <TextInput label="إلى تاريخ" type="date" value={dateTo} onChange={setDateTo} />
        <Button icon={RefreshCcw} onClick={load}>تحديث</Button>
      </div>
      <AsyncBlock loading={loading} error={error} empty={!data}>
        <section className="summary-grid compact">
          {Object.entries(data?.summary || {}).map(([key, value]) => <SummaryCard key={key} label={key} value={value === null ? 'غير متوفر' : formatNumber(value)} />)}
        </section>
      </AsyncBlock>
    </>
  );
}

function AnalyticsTemplateAssistant({ onOpenModule }) {
  const prompts = [
    ['أعطني تقرير أرباح آخر أسبوع', 'daily-profit'],
    ['ما أكثر 20 صنفاً مبيعاً؟', 'daily-profit'],
    ['ما أكثر 20 صنفاً ربحاً؟', 'daily-profit'],
    ['ما الأصناف التي لم تُبع منذ 90 يوماً؟', 'shortages'],
    ['ما قيمة المخزون الحالية حسب آخر تكلفة شراء؟', 'manager'],
    ['قارن بين فترتين', 'compare']
  ];
  return (
    <div className="compact-list">
      {prompts.map(([label, target]) => (
        <button className="compact-row" key={label} type="button" onClick={() => onOpenModule(target)}>
          <strong>{label}</strong>
          <span>فتح التقرير المناسب</span>
        </button>
      ))}
    </div>
  );
}

function AnalyticsSimpleTable({ loader, columns, filename, reloadKey = '' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await loader();
      setRows(data.rows || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [reloadKey]);
  return (
    <>
      <AnalyticsToolbar actions={<Button icon={FileSpreadsheet} variant="secondary" onClick={() => exportRowsAsCsv(filename, columns, rows)}>CSV</Button>}>
        <Button icon={RefreshCcw} variant="secondary" onClick={load}>تحديث</Button>
      </AnalyticsToolbar>
      <AsyncBlock loading={loading} error={error} empty={!rows.length}>
        <DataTable columns={columns} rows={rows} />
      </AsyncBlock>
    </>
  );
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
          <Button icon={ArrowRight} variant="ghost" className="module-back-button" onClick={onBack}>رجوع</Button>
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
  const moduleKey = 'customers';
  const [accountType, setAccountType] = useStoredState(moduleKey, 'accountType', '');
  const [search, setSearch] = useStoredState(moduleKey, 'search', '');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useStoredState(moduleKey, 'selectedAccount', null);
  const [showArchived, setShowArchived] = useStoredState(moduleKey, 'showArchived', false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSupplier = accountType === 'suppliers';

  useEffect(() => {
    if (accountType && !['customers', 'suppliers'].includes(accountType)) {
      setAccountType('');
      setSelectedAccount(null);
    }
  }, [accountType]);

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
  const exportVisibleAccounts = () => {
    exportRowsAsCsv(`${isSupplier ? 'suppliers' : 'customers'}-balances-${todayInputValue()}.csv`, [
      { label: isSupplier ? 'اسم المورد' : 'اسم الزبون', value: (row) => cleanAccountText(row.name) || '-' },
      { label: 'رقم الهاتف إن وجد', value: (row) => cleanAccountText(row.phone) || '' },
      { label: 'الرصيد', value: (row) => formatNumber(accountBalance(row)) },
      { label: 'آخر حركة', value: (row) => formatDate(row.lastTransactionDate) },
      { label: 'قيمة آخر حركة', value: (row) => formatNumber(row.lastTransactionAmount) }
    ], visibleAccounts);
  };

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
            <Button icon={FileSpreadsheet} variant="secondary" onClick={exportVisibleAccounts}>
              تصدير Excel
            </Button>
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
  const moduleKey = 'customer-details';
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

  const [activeTab, setActiveTab] = useStoredState(moduleKey, 'activeTab', 'ledger');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showArchivedInvoices, setShowArchivedInvoices] = useStoredState(moduleKey, 'showArchivedInvoices', false);
  const [ledgerDateFrom, setLedgerDateFrom] = useStoredState(moduleKey, 'ledgerDateFrom', '');
  const [ledgerDateTo, setLedgerDateTo] = useStoredState(moduleKey, 'ledgerDateTo', '');

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab('stock');
    }
  }, [activeTab]);
  const [selectedInvoice, setSelectedInvoice] = useStoredState(moduleKey, 'selectedInvoice', null);

  const activeTabConfig = tabs.find((tab) => tab.key === activeTab);

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await activeTabConfig.loader(customer.id, activeTab === 'ledger' ? {
          showArchived: showArchivedInvoices ? '1' : '0',
          dateFrom: ledgerDateFrom,
          dateTo: ledgerDateTo
        } : undefined);
        setRows(data.rows || []);
      } catch (requestError) {
        setError(requestError.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [activeTab, customer.id, showArchivedInvoices, ledgerDateFrom, ledgerDateTo]);

  const openInvoice = (row) => {
    const movementNo = row?.rowType === 'sales-invoice' ? row.refNo : row?.invoiceNumber;
    if (!movementNo || (activeTab !== 'ledger' && activeTab !== 'invoices') || row?.rowType === 'payment') return;
    setSelectedInvoice({ type: 'sales', movementNo });
  };

  if (selectedInvoice) {
    return (
      <InvoiceDetailsView
        type={selectedInvoice.type}
        movementNo={selectedInvoice.movementNo}
        onBack={() => setSelectedInvoice(null)}
      />
    );
  }

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

      {activeTab === 'ledger' ? (
        <div className="inline-filters">
          <label>
            <span>من تاريخ</span>
            <input type="date" value={ledgerDateFrom} onChange={(event) => setLedgerDateFrom(event.target.value)} />
          </label>
          <label>
            <span>إلى تاريخ</span>
            <input type="date" value={ledgerDateTo} onChange={(event) => setLedgerDateTo(event.target.value)} />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showArchivedInvoices}
              onChange={(event) => setShowArchivedInvoices(event.target.checked)}
            />
            <span>إظهار الفواتير المؤرشفة</span>
          </label>
        </div>
      ) : null}

      <AsyncBlock loading={loading} error={error} empty={!rows.length}>
        <DataTable columns={activeTabConfig.columns} rows={rows} onRowClick={activeTab === 'ledger' || activeTab === 'invoices' ? openInvoice : undefined} />
        <section className="print-only print-report">
          <PrintHeader
            title="كشف حساب زبون"
            meta={[
              { label: 'الزبون', value: customer.name || '-' },
              { label: 'الهاتف', value: customer.phone || '-' },
              { label: 'التقرير', value: activeTabConfig.label }
            ]}
          />
          <PrintTable
            columns={[
              { key: 'date', label: 'التاريخ', format: formatDate },
              { key: 'description', label: 'البيان' },
              { key: 'debit', label: 'مدين', format: formatNumber },
              { key: 'credit', label: 'دائن', format: formatNumber },
              { key: 'runningBalance', label: 'الرصيد', format: formatNumber }
            ]}
            rows={activeTab === 'ledger' ? rows : []}
          />
          <PrintFooter totals={[
            { label: 'الرصيد الحالي', value: formatNumber(customer.currentBalance) }
          ]} />
        </section>
      </AsyncBlock>
    </div>
  );
}

function SupplierDetails({ supplier, onClose }) {
  const moduleKey = 'supplier-details';
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
  const [activeTab, setActiveTab] = useStoredState(moduleKey, 'activeTab', 'ledger');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useStoredState(moduleKey, 'selectedInvoice', null);
  const [showArchivedInvoices, setShowArchivedInvoices] = useStoredState(moduleKey, 'showArchivedInvoices', false);
  const [ledgerDateFrom, setLedgerDateFrom] = useStoredState(moduleKey, 'ledgerDateFrom', '');
  const [ledgerDateTo, setLedgerDateTo] = useStoredState(moduleKey, 'ledgerDateTo', '');
  const activeTabConfig = tabs.find((tab) => tab.key === activeTab);

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await activeTabConfig.loader(supplier.id, activeTab === 'ledger' ? {
          showArchived: showArchivedInvoices ? '1' : '0',
          dateFrom: ledgerDateFrom,
          dateTo: ledgerDateTo
        } : undefined);
        setRows(data.rows || []);
      } catch (requestError) {
        setError(requestError.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [activeTab, supplier.id, showArchivedInvoices, ledgerDateFrom, ledgerDateTo]);

  const openInvoice = (row) => {
    const movementNo = row?.rowType === 'purchase-invoice' ? row.refNo : row?.invoiceNumber;
    if (!movementNo || (activeTab !== 'ledger' && activeTab !== 'purchaseInvoices') || row?.rowType === 'payment') return;
    setSelectedInvoice({ type: 'purchase', movementNo });
  };

  if (selectedInvoice) {
    return (
      <InvoiceDetailsView
        type={selectedInvoice.type}
        movementNo={selectedInvoice.movementNo}
        onBack={() => setSelectedInvoice(null)}
      />
    );
  }

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

      {activeTab === 'ledger' ? (
        <div className="inline-filters">
          <label>
            <span>من تاريخ</span>
            <input type="date" value={ledgerDateFrom} onChange={(event) => setLedgerDateFrom(event.target.value)} />
          </label>
          <label>
            <span>إلى تاريخ</span>
            <input type="date" value={ledgerDateTo} onChange={(event) => setLedgerDateTo(event.target.value)} />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showArchivedInvoices}
              onChange={(event) => setShowArchivedInvoices(event.target.checked)}
            />
            <span>إظهار الفواتير المؤرشفة</span>
          </label>
        </div>
      ) : null}

      <AsyncBlock loading={loading} error={error} empty={!rows.length}>
        <DataTable columns={activeTabConfig.columns} rows={rows} onRowClick={activeTab === 'ledger' || activeTab === 'purchaseInvoices' ? openInvoice : undefined} />
        <section className="print-only print-report">
          <PrintHeader
            title="كشف حساب مورد"
            meta={[
              { label: 'المورد', value: supplier.name || '-' },
              { label: 'الهاتف', value: supplier.phone || '-' },
              { label: 'التقرير', value: activeTabConfig.label }
            ]}
          />
          <PrintTable
            columns={[
              { key: 'date', label: 'التاريخ', format: formatDate },
              { key: 'description', label: 'البيان' },
              { key: 'debit', label: 'مدين', format: formatNumber },
              { key: 'credit', label: 'دائن', format: formatNumber },
              { key: 'runningBalance', label: 'الرصيد', format: formatNumber }
            ]}
            rows={activeTab === 'ledger' ? rows : []}
          />
          <PrintFooter totals={[
            { label: 'الرصيد الحالي', value: formatNumber(supplier.currentBalance) }
          ]} />
        </section>
      </AsyncBlock>
    </div>
  );
}

function InvoiceDetailsView({ type, movementNo, onBack }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isPurchase = type === 'purchase';
  const title = isPurchase ? 'فاتورة شراء' : 'فاتورة بيع';

  useEffect(() => {
    setLoading(true);
    setError('');
    const loader = isPurchase ? api.purchaseInvoice : api.salesInvoice;
    loader(movementNo)
      .then((data) => setInvoice(data))
      .catch((requestError) => {
        setError(requestError.message);
        setInvoice(null);
      })
      .finally(() => setLoading(false));
  }, [isPurchase, movementNo]);

  const header = invoice?.header || {};
  const items = invoice?.items || [];
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  return (
    <div className="details-panel invoice-details-page">
      <div className="details-head">
        <div>
          <h3>{title}</h3>
          <p>رقم الحركة: {movementNo}</p>
        </div>
        <Button icon={ArrowRight} variant="ghost" onClick={onBack}>رجوع</Button>
      </div>

      <div className="revenue-actions">
        <Button icon={Printer} variant="ghost" onClick={() => window.print()}>طباعة PDF</Button>
      </div>

      <AsyncBlock loading={loading} error={error} empty={!invoice?.header}>
        <section className="invoice-print-area">
          <div className="invoice-header-card">
            <div>
              <span>النظام</span>
              <strong>Teryaq SQL Connector</strong>
            </div>
            <div>
              <span>نوع الفاتورة</span>
              <strong>{title}</strong>
            </div>
            <div>
              <span>رقم الفاتورة</span>
              <strong>{header.invoiceNo || header.movementNo || '-'}</strong>
            </div>
            <div>
              <span>رقم الحركة</span>
              <strong>{header.movementNo || '-'}</strong>
            </div>
            <div>
              <span>التاريخ</span>
              <strong>{formatDate(header.date)}</strong>
            </div>
            <div>
              <span>{isPurchase ? 'المورد' : 'الزبون'}</span>
              <strong>{header.personName || '-'}</strong>
            </div>
            <div>
              <span>الحساب</span>
              <strong>{header.accountLabel || '-'}</strong>
            </div>
            <div>
              <span>الإجمالي</span>
              <strong>{formatNumber(header.total)}</strong>
            </div>
          </div>

          {header.notes ? <p className="invoice-notes">{header.notes}</p> : null}

          <div className="invoice-items-list">
            {items.map((item, index) => (
              <div className="invoice-item-row" key={`${item.itemNo}-${item.barcode}-${index}`}>
                <div>
                  <strong>{item.itemName || '-'}</strong>
                  <span>{item.barcode || '-'}</span>
                </div>
                <div className="invoice-item-total">
                  <span>{formatNumber(item.quantity)} × {formatNumber(item.price)} =</span>
                  <strong>{formatNumber(item.total)}</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="invoice-total-bar">
            <span>إجمالي البنود</span>
            <strong>{formatNumber(itemsTotal || header.total)}</strong>
          </div>
        </section>
        <section className="print-only print-report">
          <PrintHeader
            title={title}
            meta={[
              { label: 'رقم الفاتورة', value: header.invoiceNo || header.movementNo || '-' },
              { label: 'رقم الحركة', value: header.movementNo || '-' },
              { label: 'التاريخ', value: formatDate(header.date) },
              { label: isPurchase ? 'المورد' : 'الزبون', value: header.personName || '-' },
              { label: 'الحساب', value: header.accountLabel || '-' }
            ]}
          />
          <PrintTable
            columns={[
              { key: 'itemName', label: 'الصنف' },
              { key: 'barcode', label: 'الكود/الباركود' },
              { key: 'quantity', label: 'الكمية', format: formatNumber },
              { key: 'price', label: 'السعر', format: formatNumber },
              { key: 'total', label: 'الإجمالي', format: formatNumber }
            ]}
            rows={items}
          />
          <PrintFooter totals={[
            { label: 'إجمالي البنود', value: formatNumber(itemsTotal || header.total) },
            { label: 'إجمالي الفاتورة', value: formatNumber(header.total) }
          ]} />
        </section>
      </AsyncBlock>
    </div>
  );
}

function ItemsModule({ title, icon, onBack }) {
  const moduleKey = 'items';
  const tabs = [
    { key: 'stock', label: 'المخزون', icon: Boxes },
    { key: 'track', label: 'تتبع صنف', icon: Search },
    { key: 'out', label: 'أصناف نفدت', icon: AlertTriangle },
    { key: 'expiry', label: 'قرب الانتهاء', icon: CalendarClock }
  ];
  const [activeTab, setActiveTab] = useStoredState(moduleKey, 'activeTab', 'stock');
  const [search, setSearch] = useStoredState(moduleKey, 'search', '');
  const [stockRows, setStockRows] = useState([]);
  const [outRows, setOutRows] = useState([]);
  const [expiryRows, setExpiryRows] = useState([]);
  const [trackResults, setTrackResults] = useState([]);
  const [trackData, setTrackData] = useState(null);
  const [trackTab, setTrackTab] = useStoredState(moduleKey, 'trackTab', 'summary');
  const [selectedTrackItemId, setSelectedTrackItemId] = useStoredState(moduleKey, 'selectedTrackItemId', '');
  const [availableOnly, setAvailableOnly] = useStoredState(moduleKey, 'availableOnly', true);
  const [sort, setSort] = useStoredState(moduleKey, 'sort', 'name');
  const [expiryDays, setExpiryDays] = useStoredState(moduleKey, 'expiryDays', 90);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const loadActiveTab = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'stock') {
        const data = await api.itemStock({ search, availableOnly, sort });
        setStockRows(data.rows || []);
      } else if (activeTab === 'track') {
        if (!selectedTrackItemId) setTrackData(null);
        if (!search.trim()) {
          setTrackResults([]);
        } else {
          const data = await api.itemSearch(search);
          setTrackResults(data.rows || []);
        }
      } else if (activeTab === 'out') {
        const data = await api.outOfStockItems({ search, sort });
        setOutRows(data.rows || []);
      } else if (activeTab === 'expiry') {
        const data = await api.itemExpiry({ search, days: expiryDays });
        setExpiryRows(data.rows || []);
      }
    } catch (requestError) {
      setError(requestError.message);
      if (activeTab === 'stock') setStockRows([]);
      if (activeTab === 'track') {
        if (!selectedTrackItemId) setTrackData(null);
        setTrackResults([]);
      }
      if (activeTab === 'out') setOutRows([]);
      if (activeTab === 'expiry') setExpiryRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActiveTab();
  }, [activeTab, availableOnly, sort, expiryDays]);

  useEffect(() => {
    if (activeTab !== 'track' || !selectedTrackItemId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.itemTrack(selectedTrackItemId)
      .then((data) => {
        if (!cancelled) setTrackData(data);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setTrackData(null);
          setSelectedTrackItemId('');
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedTrackItemId]);

  const selectTrackItem = async (item) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.itemTrack(item.itemId);
      setTrackData(data);
      setSelectedTrackItemId(item.itemId);
      setTrackTab('summary');
    } catch (requestError) {
      setTrackData(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const clearTrackedItem = () => {
    setTrackData(null);
    setSelectedTrackItemId('');
    setTrackTab('summary');
  };

  const stockColumns = [
    { key: 'itemCode', label: 'الكود' },
    { key: 'itemName', label: 'الصنف' },
    { key: 'barcode', label: 'الباركود' },
    { key: 'formattedQuantity', label: 'الكمية المعروضة' },
    { key: 'rawQuantityInSmallUnits', label: 'الكمية بالوحدة', format: formatNumber },
    { key: 'purchasePrice', label: 'سعر الشراء', format: formatNumber },
    { key: 'salePrice', label: 'سعر البيع', format: formatNumber },
    { key: 'expiryDate', label: 'الصلاحية', format: formatDate },
    { key: 'unitName', label: 'الوحدة' }
  ];
  const outColumns = [
    { key: 'itemCode', label: 'الكود' },
    { key: 'itemName', label: 'الصنف' },
    { key: 'barcode', label: 'الباركود' },
    { key: 'lastPurchaseDate', label: 'آخر شراء', format: formatDate },
    { key: 'lastSaleDate', label: 'آخر بيع', format: formatDate },
    { key: 'lastSupplier', label: 'آخر مورد' },
    { key: 'lastCustomer', label: 'آخر عميل' },
    { key: 'purchasePrice', label: 'سعر الشراء الأخير', format: formatNumber },
    { key: 'salePrice', label: 'سعر البيع الأخير', format: formatNumber },
  ];
  const expiryColumns = [
    { key: 'itemCode', label: 'الكود' },
    { key: 'itemName', label: 'الصنف' },
    { key: 'barcode', label: 'الباركود' },
    { key: 'formattedQuantity', label: 'الكمية' },
    { key: 'expiryDate', label: 'الصلاحية', format: formatDate },
    { key: 'daysRemaining', label: 'الأيام', format: formatNumber },
    { key: 'purchasePrice', label: 'سعر الشراء', format: formatNumber },
    { key: 'salePrice', label: 'سعر البيع', format: formatNumber }
  ];
  const movementColumns = [
    { key: 'date', label: 'التاريخ', format: formatDate },
    { key: 'movementType', label: 'نوع الحركة' },
    { key: 'movementNo', label: 'رقم الحركة' },
    { key: 'personName', label: 'العميل/المورد' },
    { key: 'quantity', label: 'الكمية', render: (row) => formatPackMovementQuantity(row.quantity, trackedItem?.packSize) },
    { key: 'price', label: 'السعر', format: formatNumber },
    { key: 'total', label: 'الإجمالي', format: formatNumber }
  ];
  const purchaseMovementColumns = [
    { key: 'date', label: 'التاريخ', format: formatDate },
    { key: 'movementType', label: 'نوع الحركة' },
    { key: 'movementNo', label: 'رقم الحركة' },
    { key: 'personName', label: 'المورد' },
    { key: 'displayQuantity', label: 'الكمية', render: (row) => formatPackMovementQuantity(row.quantity, trackedItem?.packSize) },
    { key: 'displayPurchasePrice', label: 'سعر الشراء', render: (row) => formatNumber(row.total) },
    { key: 'displayTotal', label: 'الإجمالي', render: (row) => formatNumber(row.total) }
  ];
  const purchaseRows = (trackData?.movements || []).filter((row) => row.movementGroup === 'purchase');
  const salesRows = (trackData?.movements || []).filter((row) => row.movementGroup === 'sale');

  const exportItems = async () => {
    if (activeTab === 'stock') {
      setExporting(true);
      setError('');
      try {
        const data = await api.itemStock({ search, availableOnly, sort, limit: 'all' });
        const rows = data.rows || [];
        if (!rows.length) {
          window.alert('لا توجد بيانات للتصدير');
          return;
        }
        exportRowsAsExcel(`items-stock-${todayInputValue()}.xls`, stockColumns, rows);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setExporting(false);
      }
      return;
    }
    if (activeTab === 'out') {
      if (!outRows.length) {
        window.alert('لا توجد أصناف نافدة حالياً');
        return;
      }
      exportRowsAsCsv(`items-out-of-stock-${todayInputValue()}.csv`, outColumns, outRows);
    }
    if (activeTab === 'expiry') exportRowsAsCsv(`items-expiry-${todayInputValue()}.csv`, expiryColumns, expiryRows);
    if (activeTab === 'track') exportRowsAsCsv(`item-track-${todayInputValue()}.csv`, movementColumns, trackData?.movements || []);
  };

  const activeRows = activeTab === 'stock'
    ? stockRows
    : activeTab === 'out'
      ? outRows
      : activeTab === 'expiry'
        ? expiryRows
        : trackData?.item ? [trackData.item] : trackResults;

  const trackSummary = trackData?.summary || {};
  const trackedItem = trackData?.item;
  const trackTabs = [
    { key: 'summary', label: 'ملخص' },
    { key: 'purchases', label: 'مشتريات' },
    { key: 'sales', label: 'مبيعات' },
    { key: 'suppliers', label: 'موردون' },
    { key: 'customers', label: 'عملاء' },
    { key: 'all', label: 'كل الحركات' }
  ];

  const searchPlaceholder = activeTab === 'track'
    ? 'ابحث باسم الصنف أو الكود أو الباركود ثم اضغط بحث'
    : 'اسم الصنف أو الكود أو الباركود';

  const activeTabInfo = tabs.find((tab) => tab.key === activeTab);
  const ActiveIcon = activeTabInfo?.icon || PackageSearch;

  const renderFilters = () => {
    if (activeTab === 'stock') {
      return (
        <div className="accounts-toolbar item-filters">
          <label className="archive-toggle">
            <input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />
            <span>المتوفر فقط</span>
          </label>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">ترتيب بالاسم</option>
            <option value="quantity">ترتيب بالكمية</option>
            <option value="expiry">ترتيب بالصلاحية</option>
          </select>
        </div>
      );
    }
    if (activeTab === 'out') {
      return (
        <div className="accounts-toolbar item-filters">
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">ترتيب بالاسم</option>
            <option value="quantity">الأقل كمية أولاً</option>
          </select>
        </div>
      );
    }
    if (activeTab === 'expiry') {
      return (
        <div className="segment-control">
          {[30, 60, 90].map((days) => (
            <button className={expiryDays === days ? 'is-active' : ''} key={days} type="button" onClick={() => setExpiryDays(days)}>
              {days} يوم
            </button>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={(
        <div className="revenue-actions">
          <Button icon={FileSpreadsheet} variant="secondary" onClick={exportItems} disabled={exporting}>
            {exporting ? 'جاري التصدير' : 'تصدير Excel'}
          </Button>
        </div>
      )}
    >
      <div className="segment-control">
        {tabs.map((tab) => (
          <button className={activeTab === tab.key ? 'is-active' : ''} key={tab.key} type="button" onClick={() => {
            setActiveTab(tab.key);
            setError('');
            setTrackData(null);
            setTrackResults([]);
            if (tab.key !== 'track') setSelectedTrackItemId('');
            setTrackTab('summary');
          }}>
            {tab.label}
          </button>
        ))}
      </div>
      <SearchBar
        icon={ActiveIcon}
        value={search}
        onChange={setSearch}
        onSubmit={loadActiveTab}
        placeholder={searchPlaceholder}
      />
      {renderFilters()}

      {activeTab === 'track' && !search.trim() ? (
        <div className="soft-state">اكتب اسم الصنف أو الكود أو الباركود لعرض سجل الحركة الكامل</div>
      ) : null}

      <AsyncBlock
        loading={loading}
        error={error}
        empty={activeTab === 'track' ? Boolean(search && !trackedItem && !trackResults.length) : !activeRows.length}
        emptyMessage={activeTab === 'out' ? 'لا توجد أصناف نافدة حالياً' : undefined}
      >
        {activeTab === 'stock' ? <DataTable columns={stockColumns} rows={stockRows} /> : null}
        {activeTab === 'out' ? <DataTable columns={outColumns} rows={outRows} /> : null}
        {activeTab === 'expiry' ? <DataTable columns={expiryColumns} rows={expiryRows} /> : null}
        {activeTab === 'track' && !trackedItem && trackResults.length ? (
          <div className="customer-grid compact-account-grid">
            {trackResults.map((item) => (
              <button className="customer-card compact-account-card" key={item.itemId} type="button" onClick={() => selectTrackItem(item)}>
                <div>
                  <strong>{item.itemName || '-'}</strong>
                  <span>{item.barcode || 'بدون باركود'} | كود {item.itemCode || '-'}</span>
                  <span>{item.formattedQuantity || formatNumber(item.currentQuantity)} | سعر البيع {formatNumber(item.salePrice)}</span>
                </div>
                <Eye size={18} />
              </button>
            ))}
          </div>
        ) : null}
        {activeTab === 'track' && trackedItem ? (
          <div className="details-panel">
            <section className="invoice-summary-card">
              <div>
                <div>
                  <span>الصنف</span>
                  <strong>{trackedItem.itemName || '-'}</strong>
                </div>
                <strong>{trackedItem.formattedQuantity || formatNumber(trackedItem.currentStock)}</strong>
              </div>
              <dl>
                <div><dt>الكود</dt><dd>{trackedItem.itemCode || '-'}</dd></div>
                <div><dt>الباركود</dt><dd>{trackedItem.barcode || '-'}</dd></div>
                <div><dt>المخزون بالوحدة</dt><dd>{formatNumber(trackedItem.rawQuantityInSmallUnits)}</dd></div>
                <div><dt>آخر سعر شراء</dt><dd>{formatNumber(trackedItem.purchasePrice)}</dd></div>
                <div><dt>آخر سعر بيع</dt><dd>{formatNumber(trackedItem.salePrice)}</dd></div>
              </dl>
              <Button icon={ArrowRight} variant="ghost" onClick={clearTrackedItem}>رجوع إلى النتائج</Button>
            </section>
            <div className="segment-control">
              {trackTabs.map((tab) => (
                <button className={trackTab === tab.key ? 'is-active' : ''} key={tab.key} type="button" onClick={() => setTrackTab(tab.key)}>
                  {tab.label}
                </button>
              ))}
            </div>
            {trackTab === 'summary' ? (
              <div className="summary-grid">
                <SummaryCard icon={Package} label="الكمية الداخلة" value={formatNumber(trackSummary.quantityIn)} />
                <SummaryCard icon={BadgeDollarSign} label="الكمية الخارجة" value={formatNumber(trackSummary.quantityOut)} />
                <SummaryCard icon={AlertTriangle} label="مرتجعات البيع" value={formatNumber(trackSummary.salesReturns)} />
                <SummaryCard icon={ClipboardList} label="مرتجعات الشراء" value={formatNumber(trackSummary.purchaseReturns)} />
                <SummaryCard icon={CheckCircle2} label="المخزون الحالي" value={trackedItem.formattedQuantity || formatNumber(trackedItem.currentStock)} highlight />
                <SummaryCard icon={FileSpreadsheet} label="ربح تقريبي" value={formatNumber(trackSummary.approximateProfit)} />
              </div>
            ) : null}
            {trackTab === 'purchases' ? <DataTable columns={purchaseMovementColumns} rows={purchaseRows} /> : null}
            {trackTab === 'sales' ? <DataTable columns={movementColumns} rows={salesRows} /> : null}
            {trackTab === 'suppliers' ? (
              <DataTable
                columns={[
                  { key: 'name', label: 'المورد' },
                  { key: 'movementCount', label: 'الحركات', format: formatNumber },
                  { key: 'quantity', label: 'الكمية', format: formatNumber },
                  { key: 'lastPurchaseDate', label: 'آخر شراء', format: formatDate },
                  { key: 'total', label: 'القيمة', format: formatNumber }
                ]}
                rows={trackData.suppliers || []}
              />
            ) : null}
            {trackTab === 'customers' ? (
              <DataTable
                columns={[
                  { key: 'name', label: 'العميل' },
                  { key: 'movementCount', label: 'الحركات', format: formatNumber },
                  { key: 'quantity', label: 'الكمية', format: formatNumber },
                  { key: 'lastSaleDate', label: 'آخر بيع', format: formatDate },
                  { key: 'total', label: 'القيمة', format: formatNumber }
                ]}
                rows={trackData.customers || []}
              />
            ) : null}
            <section className="drill-section">
              {trackTab === 'all' ? <DataTable columns={movementColumns} rows={trackData.movements || []} /> : null}
            </section>
          </div>
        ) : null}
      </AsyncBlock>
    </ModuleShell>
  );
}

function buildSalesDailyReport(revenueData, dateFrom, dateTo) {
  const days = inputDateRange(dateFrom, dateTo);
  const dayMap = new Map(days.map((date) => [date, { date, periods: [], total: 0, movementCount: 0 }]));

  (revenueData?.rows || []).forEach((row) => {
    const date = inputDateFromValue(row.movementDate || row.date || row.createdAt);
    if (!dayMap.has(date)) dayMap.set(date, { date, periods: [], total: 0, movementCount: 0 });
    const day = dayMap.get(date);
    const periodName = row.period || row.sellerName || 'غير محدد';
    let period = day.periods.find((item) => item.period === periodName);
    if (!period) {
      period = { period: periodName, total: 0, movementCount: 0 };
      day.periods.push(period);
    }
    const amount = Number(row.amount || 0);
    period.total += amount;
    period.movementCount += 1;
    day.total += amount;
    day.movementCount += 1;
  });

  const orderedDays = Array.from(dayMap.values()).sort((left, right) => left.date.localeCompare(right.date));
  orderedDays.forEach((day) => {
    day.periods.sort((left, right) => left.period.localeCompare(right.period, 'ar'));
  });

  const totalRevenue = orderedDays.reduce((total, day) => total + Number(day.total || 0), 0);
  const totalMovements = orderedDays.reduce((total, day) => total + Number(day.movementCount || 0), 0);
  const dayCount = orderedDays.length;
  const averageDailyRevenue = dayCount ? totalRevenue / dayCount : 0;

  return {
    days: orderedDays,
    summary: {
      totalRevenue,
      totalMovements,
      dayCount,
      averageDailyRevenue
    }
  };
}

function flattenSalesDailyReportRows(dailyReport) {
  const rows = [];
  (dailyReport?.days || []).forEach((day) => {
    day.periods.forEach((period) => {
      rows.push({
        rowType: 'period',
        date: day.date,
        period: period.period,
        revenue: period.total,
        movementCount: period.movementCount
      });
    });
    rows.push({
      rowType: 'day-total',
      date: day.date,
      period: 'إجمالي اليوم',
      revenue: day.total,
      movementCount: day.movementCount
    });
  });
  rows.push({
    rowType: 'range-total',
    date: '',
    period: 'إجمالي الفترة',
    revenue: dailyReport?.summary?.totalRevenue || 0,
    movementCount: dailyReport?.summary?.totalMovements || 0
  });
  return rows;
}

function SalesDailyReport({ dailyReport }) {
  if (!dailyReport?.days?.length) return <div className="soft-state">لا توجد بيانات</div>;

  return (
    <section className="daily-sales-report">
      <div className="section-title-row">
        <h3 className="subheading">التقرير اليومي حسب الفترات</h3>
      </div>
      {dailyReport.days.map((day) => (
        <article className="daily-sales-day" key={day.date}>
          <div className="daily-sales-date">{formatDate(day.date)}</div>
          <div className="table-wrap">
            <table className="data-table daily-sales-table">
              <thead>
                <tr>
                  <th>الفترة</th>
                  <th>الإيراد</th>
                  <th>عدد الحركات</th>
                </tr>
              </thead>
              <tbody>
                {day.periods.length ? day.periods.map((period) => (
                  <tr key={`${day.date}-${period.period}`}>
                    <td>{period.period}</td>
                    <td>{formatNumber(period.total)}</td>
                    <td>{formatNumber(period.movementCount)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td>لا توجد حركات</td>
                    <td>{formatNumber(0)}</td>
                    <td>{formatNumber(0)}</td>
                  </tr>
                )}
                <tr className="daily-total-row">
                  <td>إجمالي اليوم</td>
                  <td>{formatNumber(day.total)}</td>
                  <td>{formatNumber(day.movementCount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      ))}
      <div className="range-total-panel">
        <div>
          <span>إجمالي الإيرادات للفترة كاملة</span>
          <strong>{formatNumber(dailyReport.summary.totalRevenue)}</strong>
        </div>
        <div>
          <span>إجمالي عدد الحركات</span>
          <strong>{formatNumber(dailyReport.summary.totalMovements)}</strong>
        </div>
        <div>
          <span>عدد الأيام</span>
          <strong>{formatNumber(dailyReport.summary.dayCount)}</strong>
        </div>
        <div>
          <span>متوسط الإيراد اليومي</span>
          <strong>{formatNumber(dailyReport.summary.averageDailyRevenue)}</strong>
        </div>
      </div>
    </section>
  );
}

function ReportsModule({ title, icon, onBack }) {
  const moduleKey = 'reports';
  const reportTabs = [
    { key: 'purchases', label: 'المشتريات', endpoint: 'purchases', invoiceType: 'purchase' },
    { key: 'sales', label: 'المبيعات', endpoint: 'sales', invoiceType: 'sales' },
    { key: 'supplier-payments', label: 'سدادات الموردين', endpoint: 'supplier-payments' },
    { key: 'customer-receipts', label: 'قبوض العملاء', endpoint: 'customer-receipts' },
    { key: 'returns-sales', label: 'مرتجعات البيع', endpoint: 'returns', extra: { type: 'sales' }, invoiceType: 'sales' },
    { key: 'returns-purchase', label: 'مرتجعات الشراء', endpoint: 'returns', extra: { type: 'purchase' }, invoiceType: 'purchase' },
    { key: 'item-movements', label: 'حركة صنف', endpoint: 'item-movements' }
  ];
  const [activeReport, setActiveReport] = useStoredState(moduleKey, 'activeReport', 'purchases');
  const [dateFrom, setDateFrom] = useStoredState(moduleKey, 'dateFrom', todayInputValue());
  const [dateTo, setDateTo] = useStoredState(moduleKey, 'dateTo', todayInputValue());
  const [search, setSearch] = useStoredState(moduleKey, 'search', '');
  const [page, setPage] = useStoredState(moduleKey, 'page', 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useStoredState(moduleKey, 'selectedInvoice', null);
  const activeConfig = reportTabs.find((tab) => tab.key === activeReport) || reportTabs[0];
  const isSalesDailyReport = activeReport === 'sales';

  useEffect(() => {
    if (!reportTabs.some((tab) => tab.key === activeReport)) {
      setActiveReport('purchases');
    }
  }, [activeReport]);

  const invoiceColumns = [
    { key: 'date', label: 'التاريخ', format: formatDate },
    { key: 'movementNo', label: 'رقم الحركة' },
    { key: 'invoiceNo', label: 'رقم الفاتورة' },
    { key: 'personName', label: activeConfig.invoiceType === 'purchase' ? 'المورد' : 'العميل' },
    { key: 'itemCount', label: 'عدد الأصناف', format: formatNumber },
    { key: 'total', label: 'إجمالي الفاتورة', format: formatNumber }
  ];
  const paymentColumns = [
    { key: 'date', label: 'التاريخ', format: formatDate },
    { key: 'personName', label: activeReport === 'supplier-payments' ? 'المورد' : 'العميل' },
    { key: 'amount', label: 'المبلغ', format: formatNumber },
    { key: 'paymentMethod', label: activeReport === 'supplier-payments' ? 'طريقة الدفع' : 'طريقة القبض' },
    { key: 'movementNo', label: 'رقم الحركة' },
    { key: 'notes', label: 'الملاحظات' }
  ];
  const itemMovementColumns = [
    { key: 'date', label: 'التاريخ', format: formatDate },
    { key: 'movementType', label: 'نوع الحركة' },
    { key: 'movementNo', label: 'رقم الحركة' },
    { key: 'quantity', label: 'الكمية', format: formatNumber },
    { key: 'unitPrice', label: 'سعر الوحدة', format: formatNumber },
    { key: 'total', label: 'الإجمالي', format: formatNumber },
    { key: 'personName', label: 'العميل أو المورد' }
  ];
  const columns = activeReport === 'supplier-payments' || activeReport === 'customer-receipts'
    ? paymentColumns
    : activeReport === 'item-movements'
      ? itemMovementColumns
      : invoiceColumns;

  const loadReport = async (nextPage = page) => {
    setLoading(true);
    setError('');
    try {
      const result = isSalesDailyReport
        ? await api.revenueDetails({ dateFrom, dateTo })
        : await api.report(activeConfig.endpoint, {
            dateFrom,
            dateTo,
            search,
            page: nextPage,
            pageSize: 50,
            ...(activeConfig.extra || {})
          });
      setData(result);
      setPage(nextPage);
    } catch (requestError) {
      setData(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setData(null);
    loadReport(1);
  }, [activeReport]);

  const rows = data?.rows || [];
  const salesDailyReport = useMemo(
    () => (isSalesDailyReport ? buildSalesDailyReport(data, dateFrom, dateTo) : null),
    [isSalesDailyReport, data, dateFrom, dateTo]
  );
  const summary = isSalesDailyReport
    ? {
        movementCount: salesDailyReport?.summary?.totalMovements || 0,
        totalAmount: salesDailyReport?.summary?.totalRevenue || 0,
        averageAmount: salesDailyReport?.summary?.averageDailyRevenue || 0,
        dayCount: salesDailyReport?.summary?.dayCount || 0
      }
    : data?.summary || {};
  const hasNextPage = rows.length >= Number(data?.pageSize || 50);
  const exportReport = () => {
    if (isSalesDailyReport) {
      const exportRows = flattenSalesDailyReportRows(salesDailyReport);
      if (!exportRows.length) {
        window.alert('لا توجد بيانات للتصدير');
        return;
      }
      exportRowsAsCsv(`sales-daily-${dateFrom}-${dateTo}.csv`, [
        { label: 'التاريخ', value: (row) => row.date ? formatDate(row.date) : '' },
        { label: 'الفترة', value: 'period' },
        { label: 'الإيراد', value: (row) => formatNumber(row.revenue) },
        { label: 'عدد الحركات', value: (row) => formatNumber(row.movementCount) }
      ], exportRows);
      return;
    }

    if (!rows.length) {
      window.alert('لا توجد بيانات للتصدير');
      return;
    }
    exportRowsAsCsv(`report-${activeReport}-${dateFrom}-${dateTo}.csv`, columns, rows);
  };
  const openReportRow = (row) => {
    if (activeReport === 'item-movements') {
      const type = row.invoiceType === 'purchase' ? 'purchase' : 'sales';
      if (row.movementNo) setSelectedInvoice({ type, movementNo: row.movementNo });
      return;
    }
    if (activeConfig.invoiceType && row.movementNo) {
      setSelectedInvoice({ type: activeConfig.invoiceType, movementNo: row.movementNo });
    }
  };

  if (selectedInvoice) {
    return (
      <ModuleShell title="تفاصيل الفاتورة" icon={ClipboardList} onBack={() => setSelectedInvoice(null)}>
        <InvoiceDetailsView type={selectedInvoice.type} movementNo={selectedInvoice.movementNo} onBack={() => setSelectedInvoice(null)} />
      </ModuleShell>
    );
  }

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={(
        <div className="revenue-actions compact-icon-actions">
          <Button icon={Printer} variant="ghost" className="icon-action" onClick={() => window.print()}>PDF</Button>
          <Button icon={FileSpreadsheet} variant="secondary" className="icon-action" onClick={exportReport}>Excel</Button>
        </div>
      )}
    >
      <div className="segment-control reports-tabs">
        {reportTabs.map((tab) => (
          <button className={activeReport === tab.key ? 'is-active' : ''} key={tab.key} type="button" onClick={() => setActiveReport(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="report-toolbar compact-report-toolbar">
        <label className="date-from-field">
          <span>من تاريخ</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="date-to-field">
          <span>إلى تاريخ</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="report-search-field">
          <span>بحث</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isSalesDailyReport ? 'غير مستخدم في التقرير اليومي' : activeReport === 'item-movements' ? 'اسم الصنف أو الباركود' : 'بحث'}
            disabled={isSalesDailyReport}
          />
        </label>
        <Button icon={RefreshCcw} variant="secondary" onClick={() => loadReport(1)}>تحديث</Button>
      </div>
      <div className="summary-grid">
        {isSalesDailyReport ? (
          <>
            <SummaryCard icon={BadgeDollarSign} label="إجمالي الإيرادات للفترة" value={formatNumber(summary.totalAmount)} highlight />
            <SummaryCard icon={ClipboardList} label="إجمالي عدد الحركات" value={formatNumber(summary.movementCount)} />
            <SummaryCard icon={Database} label="عدد الأيام" value={formatNumber(summary.dayCount)} />
            <SummaryCard icon={FileSpreadsheet} label="متوسط الإيراد اليومي" value={formatNumber(summary.averageAmount)} />
          </>
        ) : (
          <>
            <SummaryCard icon={ClipboardList} label="عدد الحركات" value={formatNumber(summary.movementCount)} />
            <SummaryCard icon={BadgeDollarSign} label="مجموع المبالغ" value={formatNumber(summary.totalAmount)} highlight />
            <SummaryCard icon={FileSpreadsheet} label="متوسط الحركة" value={formatNumber(summary.averageAmount)} />
          </>
        )}
      </div>
      <AsyncBlock loading={loading} error={error} empty={isSalesDailyReport ? !salesDailyReport?.days?.length : !rows.length}>
        {isSalesDailyReport ? (
          <SalesDailyReport dailyReport={salesDailyReport} />
        ) : (
          <>
            <DataTable columns={columns} rows={rows} onRowClick={openReportRow} />
            <div className="pagination-row">
              <Button icon={ArrowRight} variant="ghost" onClick={() => loadReport(Math.max(page - 1, 1))} disabled={page <= 1}>السابق</Button>
              <strong>صفحة {formatNumber(page)}</strong>
              <Button icon={ArrowLeft} variant="ghost" onClick={() => loadReport(page + 1)} disabled={!hasNextPage}>التالي</Button>
            </div>
          </>
        )}
        <section className="print-only print-report">
          <PrintHeader
            title={`تقرير ${activeConfig.label}`}
            meta={[
              { label: 'الفترة', value: `${dateFrom} إلى ${dateTo}` },
              { label: 'البحث', value: search || 'الكل' }
            ]}
          />
          {isSalesDailyReport ? (
            <PrintTable
              columns={[
                { key: 'date', label: 'التاريخ', format: formatDate },
                { key: 'period', label: 'الفترة' },
                { key: 'revenue', label: 'الإيراد', format: formatNumber },
                { key: 'movementCount', label: 'عدد الحركات', format: formatNumber }
              ]}
              rows={flattenSalesDailyReportRows(salesDailyReport)}
            />
          ) : (
            <PrintTable columns={columns} rows={rows} />
          )}
          <PrintFooter totals={[
            { label: 'عدد الحركات', value: formatNumber(summary.movementCount) },
            { label: isSalesDailyReport ? 'إجمالي الإيرادات' : 'مجموع المبالغ', value: formatNumber(summary.totalAmount) }
          ]} />
        </section>
      </AsyncBlock>
    </ModuleShell>
  );
}

function TradingProfitModule({ title, icon, onBack }) {
  const moduleKey = 'trading';
  const [dateFrom, setDateFrom] = useStoredState(moduleKey, 'dateFrom', todayInputValue());
  const [dateTo, setDateTo] = useStoredState(moduleKey, 'dateTo', todayInputValue());
  const [selectedOfficialUser, setSelectedOfficialUser] = useStoredState(moduleKey, 'officialUser', 'all');
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
  const actualRevenue = data?.actualRevenue || {};
  const reconciliation = data?.reconciliation || {};
  const officialUsers = useMemo(() => {
    const users = Array.from(new Set((data?.movements || []).map((row) => row.tradingUser || row.description).filter(Boolean)));
    return users;
  }, [data?.movements]);
  const officialDetailRows = useMemo(() => {
    const sourceRows = (data?.movements || []).filter((row) => {
      const user = row.tradingUser || row.description || '';
      return selectedOfficialUser === 'all' || user === selectedOfficialUser;
    });
    const groups = new Map();
    for (const row of sourceRows) {
      const key = String(row.date || '').slice(0, 10) || formatDate(row.date);
      const group = groups.get(key) || { date: row.date, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    const result = [];
    let periodRevenue = 0;
    let periodProfit = 0;
    Array.from(groups.entries())
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .forEach(([key, group]) => {
        let dayRevenue = 0;
        let dayProfit = 0;
        group.rows
          .slice()
          .forEach((row, index) => {
            const amount = Number(row.amount || 0);
            const profit = Number(row.profit || 0);
            dayRevenue += amount;
            dayProfit += profit;
            result.push({
              ...row,
              id: `official-${key}-${row.tradingUser || row.description}-${index}`,
              displayDate: formatDate(row.date),
              userName: row.tradingUser || row.description,
              rowType: 'user'
            });
          });
        periodRevenue += dayRevenue;
        periodProfit += dayProfit;
        result.push({
          id: `day-total-${key}`,
          displayDate: 'إجمالي اليوم',
          userName: '',
          amount: dayRevenue,
          profit: dayProfit,
          rowType: 'day-total'
        });
      });
    if (result.length) {
      result.push({
        id: 'period-total',
        displayDate: 'إجمالي الفترة',
        userName: '',
        amount: periodRevenue,
        profit: periodProfit,
        rowType: 'period-total'
      });
    }
    return result;
  }, [data?.movements, selectedOfficialUser]);
  const shiftTradingDates = (days) => {
    setDateFrom((value) => shiftInputDate(value, days));
    setDateTo((value) => shiftInputDate(value, days));
  };
  const exportTradingRows = () => {
    exportRowsAsCsv(`trading-profit-${dateFrom}-${dateTo}.csv`, [
      { label: 'المصدر', value: 'sourceTable' },
      { label: 'التاريخ', value: (row) => formatDate(row.date) },
      { label: 'النوع', value: 'kind' },
      { label: 'البيان', value: 'description' },
      { label: 'الإيراد', value: 'amount' },
      { label: 'الربح', value: 'profit' },
      { label: 'التكلفة', value: 'cost' }
    ], [...(data?.movements || []), ...(data?.actualMovements || [])]);
  };

  return (
    <ModuleShell
      title={title}
      icon={icon}
      onBack={onBack}
      actions={(
        <div className="revenue-actions compact-icon-actions">
          <Button icon={Printer} variant="ghost" className="icon-action" title="طباعة PDF" onClick={() => window.print()}>PDF</Button>
          <Button icon={FileSpreadsheet} variant="secondary" className="icon-action" title="تصدير Excel" onClick={exportTradingRows}>Excel</Button>
        </div>
      )}
    >
      <div className="report-toolbar compact-report-toolbar">
        <button className="day-nav-button prev-day-button" type="button" onClick={() => shiftTradingDates(-1)} title="اليوم السابق">
          <ArrowRight size={18} />
        </button>
        <button className="day-nav-button next-day-button" type="button" onClick={() => shiftTradingDates(1)} title="اليوم التالي">
          <ArrowLeft size={18} />
        </button>
        <label className="date-from-field">
          <span>من تاريخ</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="date-to-field">
          <span>إلى تاريخ</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <Button icon={RefreshCcw} variant="secondary" onClick={loadTrading}>تحديث التقرير</Button>
      </div>

      <AsyncBlock loading={loading} error={error} empty={!data}>
        {reconciliation.isSnapshotIncomplete ? (
          <div className="report-warning">
            <AlertTriangle size={18} />
            <div>
              <strong>تنبيه: ملخص المتاجرة الرسمي غير مكتمل مقارنةً بالحركات الفعلية.</strong>
              <span>
                الإيراد الرسمي: {formatNumber(reconciliation.officialRevenue)} | الإيراد الفعلي حسب إيراد اليوم: {formatNumber(reconciliation.actualRevenue)} | الفرق غير المسجل: {formatNumber(reconciliation.shortfall)}
              </span>
            </div>
          </div>
        ) : null}

        <div className="section-title-row compact-section-title">
          <div>
            <p className="eyebrow">Source: The_Profit</p>
            <h3>ملخص المتاجرة الرسمي</h3>
          </div>
        </div>
        <div className="summary-grid">
          <SummaryCard icon={BadgeDollarSign} label="الإيرادات" value={formatNumber(summary.revenue)} />
          <SummaryCard icon={Package} label="تكلفة البضاعة" value={formatNumber(summary.costOfGoods)} />
          <SummaryCard icon={ClipboardList} label="مجمل الربح" value={formatNumber(summary.grossProfit)} />
          <SummaryCard icon={FileSpreadsheet} label="سدادات الموردين" value={formatNumber(summary.supplierPayments)} />
          <SummaryCard icon={AlertTriangle} label="المصاريف" value={formatNumber(summary.expenses)} />
          <SummaryCard icon={CheckCircle2} label="صافي الربح" value={formatNumber(summary.netProfit)} highlight />
        </div>

        <section className="drill-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Source: The_Profit</p>
              <h3>تفاصيل المتاجرة الرسمية</h3>
            </div>
            <div className="official-user-filter">
              <select value={selectedOfficialUser} onChange={(event) => setSelectedOfficialUser(event.target.value)}>
                <option value="all">كل المستخدمين</option>
                {officialUsers.map((user) => (
                  <option key={user} value={user}>{user}</option>
                ))}
              </select>
              <span className="count-badge">{formatNumber(officialDetailRows.filter((row) => row.rowType === 'user').length)}</span>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'displayDate', label: 'التاريخ' },
              { key: 'userName', label: 'المستخدم' },
              { key: 'amount', label: 'الإيراد', format: formatNumber },
              { key: 'profit', label: 'الربح', format: formatNumber }
            ]}
            rows={officialDetailRows}
            rowClassName={(row) => row.rowType === 'period-total' ? 'is-period-total' : row.rowType === 'day-total' ? 'is-day-total' : ''}
          />
        </section>

        {reconciliation.isSnapshotIncomplete ? (
          <section className="drill-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Source: The_Outstandingvalues</p>
                <h3>الحركات الفعلية حسب إيراد اليوم</h3>
              </div>
              <span className="count-badge">{formatNumber(actualRevenue.movementCount || 0)}</span>
            </div>
            <div className="summary-grid">
              <SummaryCard icon={BadgeDollarSign} label="صافي الإيراد الفعلي" value={formatNumber(actualRevenue.netRevenue)} highlight />
              <SummaryCard icon={ClipboardList} label="المبيعات النقدية" value={formatNumber(actualRevenue.cashSalesTotal)} />
              <SummaryCard icon={FileSpreadsheet} label="سداد مدينين" value={formatNumber(actualRevenue.debtorPaymentsTotal)} />
              <SummaryCard icon={Package} label="مدفوعات إلكترونية" value={formatNumber(actualRevenue.electronicPaymentsTotal)} />
              <SummaryCard icon={AlertTriangle} label="المردودات" value={formatNumber(actualRevenue.returnsTotal)} />
              <SummaryCard icon={CheckCircle2} label="عدد الحركات" value={formatNumber(actualRevenue.movementCount)} />
            </div>
            <DataTable
              columns={[
                { key: 'date', label: 'التاريخ', format: formatDate },
                { key: 'kind', label: 'النوع' },
                { key: 'description', label: 'البيان' },
                { key: 'amount', label: 'القيمة', format: formatNumber }
              ]}
              rows={data?.actualMovements || []}
            />
          </section>
        ) : null}
        <section className="print-only print-report">
          <PrintHeader
            title="المتاجرة والأرباح"
            meta={[
              { label: 'الفترة', value: `${dateFrom} إلى ${dateTo}` },
              { label: 'المصدر الرسمي', value: 'The_Profit' }
            ]}
          />
          {reconciliation.isSnapshotIncomplete ? (
            <div className="print-warning">
              تنبيه: ملخص المتاجرة الرسمي غير مكتمل مقارنةً بالحركات الفعلية.
              الإيراد الرسمي: {formatNumber(reconciliation.officialRevenue)}،
              الإيراد الفعلي حسب إيراد اليوم: {formatNumber(reconciliation.actualRevenue)}،
              الفرق غير المسجل: {formatNumber(reconciliation.shortfall)}
            </div>
          ) : null}
          <PrintTable
            columns={[
              { key: 'label', label: 'البند' },
              { key: 'value', label: 'القيمة' }
            ]}
            rows={[
              { label: 'الإيرادات', value: formatNumber(summary.revenue) },
              { label: 'تكلفة البضاعة', value: formatNumber(summary.costOfGoods) },
              { label: 'مجمل الربح', value: formatNumber(summary.grossProfit) },
              { label: 'المصاريف', value: formatNumber(summary.expenses) },
              { label: 'صافي الربح', value: formatNumber(summary.netProfit) }
            ]}
          />
          <h2 className="print-section-title">تفاصيل المصدر الرسمي</h2>
          <PrintTable
            columns={[
              { key: 'date', label: 'التاريخ', format: formatDate },
              { key: 'description', label: 'المستخدم/الفترة' },
              { key: 'amount', label: 'الإيراد', format: formatNumber },
              { key: 'cost', label: 'التكلفة', format: formatNumber },
              { key: 'profit', label: 'الربح', format: formatNumber }
            ]}
            rows={data?.movements || []}
          />
          <PrintFooter totals={[
            { label: 'الإيرادات', value: formatNumber(summary.revenue) },
            { label: 'صافي الربح', value: formatNumber(summary.netProfit) }
          ]} />
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
  const moduleKey = 'sales';
  const [data, setData] = useState(null);
  const [dashboardReference, setDashboardReference] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [periodData, setPeriodData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useStoredState(moduleKey, 'dateFrom', todayInputValue());
  const [dateTo, setDateTo] = useStoredState(moduleKey, 'dateTo', todayInputValue());
  const [periodFilter, setPeriodFilter] = useStoredState(moduleKey, 'periodFilter', '');
  const [selectedPeriod, setSelectedPeriod] = useStoredState(moduleKey, 'selectedPeriod', null);
  const [selectedSource, setSelectedSource] = useStoredState(moduleKey, 'selectedSource', null);
  const [selectedMovement, setSelectedMovement] = useStoredState(moduleKey, 'selectedMovement', null);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState('');

  const loadOverview = async () => {
    setLoading(true);
    setError('');
    try {
      const [result, dashboardResult] = await Promise.all([
        api.revenueDetails({ dateFrom, dateTo, period: periodFilter }),
        dateFrom === dateTo ? api.salesToday(dateFrom) : Promise.resolve(null)
      ]);
      setData(result);
      setDashboardReference(dashboardResult);
      api.revenueDiagnostics(dateFrom)
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
  }, [dateFrom, dateTo, periodFilter]);

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
    setPeriodData(null);
    setPeriodLoading(true);
    try {
      const result = await api.revenueDetails({ dateFrom, dateTo, period: periodName });
      setPeriodData({
        ...result,
        requestedPeriod: periodName
      });
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

  useEffect(() => {
    if (!selectedPeriod) return;
    let cancelled = false;
    setPeriodData(null);
    setPeriodLoading(true);
    api.revenueDetails({ dateFrom, dateTo, period: selectedPeriod })
      .then((result) => {
        if (!cancelled) {
          setPeriodData({
            ...result,
            requestedPeriod: selectedPeriod
          });
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.message);
          setPeriodData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPeriodLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriod, dateFrom, dateTo]);
  const shiftRevenueDates = (days) => {
    setDateFrom((value) => shiftInputDate(value, days));
    setDateTo((value) => shiftInputDate(value, days));
  };

  const periodDataMatchesSelection = Boolean(periodData && periodData.requestedPeriod === selectedPeriod);
  const activePeriodData = periodDataMatchesSelection ? periodData : null;
  const sourceRows = activePeriodData?.sources || [];
  const selectedMovements = useMemo(() => {
    if (!selectedSource) return [];
    return (activePeriodData?.rows || []).filter((row) => row.revenueSource === selectedSource.sourceName);
  }, [activePeriodData, selectedSource]);
  const sourceSum = useMemo(() => sumBy(sourceRows, 'total'), [sourceRows]);
  const movementSum = useMemo(() => sumBy(selectedMovements, 'amount'), [selectedMovements]);
  const selectedPeriodOverview = periodRows.find((row) => row.period === selectedPeriod);
  const periodTotal = Number(activePeriodData?.summary?.netRevenue ?? selectedPeriodOverview?.total ?? 0);

  const exportVisibleRows = () => {
    const rows = selectedSource ? selectedMovements : selectedPeriod ? (activePeriodData?.rows || []) : (data?.rows || []);
    exportRowsAsCsv(`revenue-${dateFrom || 'today'}-${dateTo || dateFrom || 'today'}.csv`, [
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
        <div className="revenue-actions compact-icon-actions">
          <Button icon={Printer} variant="ghost" className="icon-action" title="طباعة PDF" onClick={() => window.print()}>PDF</Button>
          <Button icon={FileSpreadsheet} variant="secondary" className="icon-action" title="تصدير Excel" onClick={exportVisibleRows}>Excel</Button>
        </div>
      )}
    >
      <div className="report-toolbar compact-report-toolbar revenue-filter-toolbar">
        <button className="day-nav-button prev-day-button" type="button" onClick={() => shiftRevenueDates(-1)} title="اليوم السابق">
          <ArrowRight size={18} />
        </button>
        <button className="day-nav-button next-day-button" type="button" onClick={() => shiftRevenueDates(1)} title="اليوم التالي">
          <ArrowLeft size={18} />
        </button>
        <label className="date-from-field">
          <span>من تاريخ</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="date-to-field">
          <span>إلى تاريخ</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="filter-wide">
          <span>الفترة</span>
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            <option value="">الكل</option>
            {periodOptions.map((periodName) => (
              <option key={periodName} value={periodName}>{periodName}</option>
            ))}
          </select>
        </label>
        <Button icon={RefreshCcw} variant="secondary" onClick={loadOverview}>تحديث التقرير</Button>
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
              <SummaryCard icon={CheckCircle2} label="صافي الإيراد النهائي" value={formatNumber(summary.netRevenue)} highlight />
              <SummaryCard icon={BadgeDollarSign} label="إجمالي المبيعات النقدية" value={formatNumber(summary.cashSalesTotal)} />
              <SummaryCard icon={Users} label="إجمالي سداد المدينين" value={formatNumber(summary.debtorPaymentsTotal)} />
              <SummaryCard icon={FileSpreadsheet} label="إجمالي المدفوعات الإلكترونية" value={formatNumber(summary.electronicPaymentsTotal)} />
              <SummaryCard icon={AlertTriangle} label="إجمالي المردودات" value={formatNumber(summary.returnsTotal)} />
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
        <section className="print-only print-report">
          <PrintHeader
            title="إيراد اليوم"
            meta={[
              { label: 'الفترة', value: `${dateFrom} إلى ${dateTo}` },
              { label: 'المستوى', value: currentLevel },
              { label: 'الفترة/المستخدم', value: selectedPeriod || periodFilter || 'الكل' },
              { label: 'مصدر الإيراد', value: selectedSource?.sourceName || 'الكل' }
            ]}
          />
          <h2 className="print-section-title">ملخص الإيراد</h2>
          <PrintTable
            columns={[
              { key: 'label', label: 'البند' },
              { key: 'value', label: 'القيمة' }
            ]}
            rows={[
              { label: 'صافي الإيراد النهائي', value: formatNumber(summary.netRevenue) },
              { label: 'إجمالي المبيعات النقدية', value: formatNumber(summary.cashSalesTotal) },
              { label: 'إجمالي المدفوعات الإلكترونية', value: formatNumber(summary.electronicPaymentsTotal) },
              { label: 'إجمالي سداد المدينين', value: formatNumber(summary.debtorPaymentsTotal) },
              { label: 'إجمالي المردودات', value: formatNumber(summary.returnsTotal) }
            ]}
          />
          <h2 className="print-section-title">{selectedPeriod ? 'مصادر الإيراد' : 'تفصيل الفترات'}</h2>
          <PrintTable
            columns={[
              { key: 'name', label: selectedPeriod ? 'المصدر' : 'الفترة' },
              { key: 'total', label: 'القيمة', format: formatNumber },
              { key: 'movementCount', label: 'عدد الحركات', format: formatNumber }
            ]}
            rows={selectedPeriod ? sourceRows.map((row) => ({
              name: displayRevenueSource(row.sourceName),
              total: row.total,
              movementCount: row.movementCount
            })) : periodRows.map((row) => ({
              name: row.period,
              total: row.total,
              movementCount: row.movementCount
            }))}
          />
          {selectedSource ? (
            <>
              <h2 className="print-section-title">تفاصيل الحركات</h2>
              <PrintTable
                columns={[
                  { key: 'movementNo', label: 'رقم الحركة' },
                  { key: 'invoiceNo', label: 'رقم الفاتورة' },
                  { key: 'movementDate', label: 'التاريخ', value: (row) => formatMovementDate(row) },
                  { key: 'movementType', label: 'نوع الحركة' },
                  { key: 'customerName', label: 'العميل' },
                  { key: 'period', label: 'الفترة' },
                  { key: 'paymentMethod', label: 'طريقة الدفع' },
                  { key: 'amount', label: 'القيمة', format: formatNumber }
                ]}
                rows={selectedMovements}
              />
            </>
          ) : null}
          <PrintFooter totals={[
            { label: 'صافي الإيراد', value: formatNumber(summary.netRevenue) },
            { label: 'عدد الحركات', value: formatNumber(summary.movementCount) }
          ]} />
        </section>
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
        <article
          className="movement-card movement-slim-card"
          key={row.movementNo}
          role="button"
          tabIndex={0}
          onClick={() => onOpenMovement(row.movementNo)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onOpenMovement(row.movementNo);
          }}
        >
          <div className="movement-slim-main">
            <div>
              <strong>{row.movementType || '-'}</strong>
              <span>{formatShortDate(row.movementDate)}</span>
            </div>
            <div>
              <span>العميل: {row.customerName || '-'}</span>
              <span>{row.invoiceNo ? `فاتورة #${row.invoiceNo}` : 'بدون فاتورة'}</span>
            </div>
          </div>
          <div className="movement-slim-amount">
            <strong className={Number(row.amount || 0) < 0 ? 'is-negative' : ''}>{formatNumber(row.amount)}</strong>
            <span>{row.paymentMethod || '-'}</span>
          </div>
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
      <div className="invoice-summary-card">
        <div>
          <span>الإجمالي</span>
          <strong>{formatNumber(movement.amount)}</strong>
        </div>
        <dl>
          <div><dt>العميل</dt><dd>{movement.customerName || '-'}</dd></div>
          <div><dt>التاريخ والوقت</dt><dd>{formatInvoiceDate(movement)}</dd></div>
          <div><dt>نوع الحركة</dt><dd>{movement.accountName || movement.movementType || '-'}</dd></div>
          <div><dt>طريقة الدفع</dt><dd>{movement.paymentMethod || '-'}</dd></div>
          <div><dt>رقم الفاتورة</dt><dd>{movement.invoiceNo || '-'}</dd></div>
          <div><dt>رقم الحركة</dt><dd>{movement.movementNo || '-'}</dd></div>
          {movement.discount ? <div><dt>الخصم</dt><dd>{formatNumber(movement.discount)}</dd></div> : null}
          {(movement.notes || movement.invoiceDetails) ? <div><dt>ملاحظات</dt><dd>{movement.notes || movement.invoiceDetails}</dd></div> : null}
        </dl>
      </div>

      <div className="invoice-detail-head compact-section-head">
        <Eye size={18} />
        <div>
          <p className="eyebrow">الأصناف</p>
          <h3>بنود الفاتورة</h3>
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
              {row.barcode ? (
                <button
                  className="barcode-copy"
                  type="button"
                  title="نسخ الباركود"
                  onClick={() => navigator.clipboard?.writeText(String(row.barcode))}
                >
                  {row.barcode}
                </button>
              ) : <span>-</span>}
            </div>
            <div className="invoice-item-equation">
              {formatNumber(row.quantity)} × {formatNumber(unitPrice)} = <strong>{formatNumber(row.chargeValue)}</strong>
            </div>
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

function SummaryCard({ label, value, icon: Icon = BadgeDollarSign, highlight = false }) {
  return (
    <div className={`summary-card ${highlight ? 'is-highlight' : ''}`}>
      <Icon size={16} />
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
      <Button icon={Search} variant="secondary" type="submit">بحث</Button>
    </form>
  );
}

function AsyncBlock({ loading, error, empty, emptyMessage = 'لا توجد بيانات', children }) {
  if (loading) {
    return <div className="soft-state"><RefreshCcw size={24} />جاري التحميل</div>;
  }

  if (error) {
    return <div className="soft-state is-error"><AlertTriangle size={24} />{error}</div>;
  }

  if (empty) {
    return <div className="soft-state">{emptyMessage}</div>;
  }

  return children;
}

function DataTable({ columns, rows, onRowClick, rowClassName }) {
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
              className={[onRowClick ? 'is-clickable' : '', rowClassName ? rowClassName(row) : ''].filter(Boolean).join(' ')}
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
