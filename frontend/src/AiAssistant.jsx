import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clipboard,
  Database,
  Play,
  RefreshCcw,
  Save,
  Search,
  Send,
  Table2
} from 'lucide-react';
import { api } from './api.js';

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(number)
    : String(value);
}

function AssistantButton({ icon: Icon, children, variant = 'primary', ...props }) {
  return (
    <button className={`button button-${variant}`} type="button" {...props}>
      {Icon ? <Icon size={18} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function SimpleTable({ rows }) {
  if (!rows?.length) {
    return <div className="soft-state">لا توجد بيانات</div>;
  }

  const columns = Object.keys(rows[0]);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{row[column] === null || row[column] === undefined ? '-' : String(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownBlock({ content }) {
  const parts = String(content || '').split(/```(?:sql)?\n?|\n?```/i);

  return (
    <div className="markdown-block">
      {parts.map((part, index) => {
        const isCode = index % 2 === 1;
        if (isCode) {
          return <pre key={index}><code>{part.trim()}</code></pre>;
        }

        return part.split('\n').map((line, lineIndex) => {
          const text = line.trim();
          if (!text) return null;
          if (text.startsWith('### ')) return <h3 key={`${index}-${lineIndex}`}>{text.slice(4)}</h3>;
          if (text.startsWith('## ')) return <h2 key={`${index}-${lineIndex}`}>{text.slice(3)}</h2>;
          if (text.startsWith('- ')) return <p className="markdown-bullet" key={`${index}-${lineIndex}`}>{text}</p>;
          return <p key={`${index}-${lineIndex}`}>{text}</p>;
        });
      })}
    </div>
  );
}

function QuerySuggestion({ suggestion, onExecute }) {
  const [copied, setCopied] = useState(false);

  const copySql = async () => {
    await navigator.clipboard.writeText(suggestion.sql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="query-suggestion">
      <div className="query-suggestion-head">
        <strong>{suggestion.title}</strong>
        <div className="query-actions">
          <AssistantButton icon={Clipboard} variant="ghost" onClick={copySql}>
            {copied ? 'تم النسخ' : 'نسخ SQL'}
          </AssistantButton>
          <AssistantButton icon={Play} variant="secondary" onClick={() => onExecute(suggestion.sql)}>
            تنفيذ
          </AssistantButton>
        </div>
      </div>
      <pre><code>{suggestion.sql}</code></pre>
    </div>
  );
}

function MessageBubble({ message, onExecute }) {
  return (
    <article className={`assistant-message is-${message.role}`}>
      <div className="assistant-message-role">
        {message.role === 'assistant' ? <Bot size={18} /> : <span />}
        <strong>{message.role === 'assistant' ? 'المساعد' : 'أنت'}</strong>
      </div>
      <MarkdownBlock content={message.content} />
      {message.suggestedQueries?.length ? (
        <div className="query-list">
          {message.suggestedQueries.map((suggestion, index) => (
            <QuerySuggestion
              key={`${suggestion.title}-${index}`}
              suggestion={suggestion}
              onExecute={onExecute}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ContextPanel({ context, loading, onKnowledgeSaved }) {
  const notes = context?.knowledge?.notes || [];
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const saveNote = async (event) => {
    event.preventDefault();
    if (!text.trim() || saving) return;

    setSaving(true);
    setMessage('');
    try {
      const data = await api.aiSaveKnowledge({ topic, text });
      onKnowledgeSaved?.(data.knowledge);
      setTopic('');
      setText('');
      setMessage('تم حفظ الملاحظة');
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="assistant-side">
      <section className="assistant-panel">
        <h3>سياق قاعدة البيانات</h3>
        {loading ? (
          <div className="soft-state"><RefreshCcw size={20} />جاري تحميل السياق</div>
        ) : (
          <dl className="context-list">
            <div><dt>Profile</dt><dd>{context?.profile || '-'}</dd></div>
            <div><dt>Server</dt><dd>{context?.connection?.server || '-'}</dd></div>
            <div><dt>Database</dt><dd>{context?.connection?.database || '-'}</dd></div>
            <div><dt>Tables</dt><dd>{formatNumber(context?.tables?.length || 0)}</dd></div>
            <div><dt>Columns</dt><dd>{formatNumber(context?.columns?.length || 0)}</dd></div>
          </dl>
        )}
      </section>

      <section className="assistant-panel">
        <h3>ذاكرة Almohaseb</h3>
        <div className="knowledge-list">
          {notes.map((note) => (
            <details key={note.topic}>
              <summary>{note.topic}</summary>
              <p>{note.text}</p>
            </details>
          ))}
        </div>
        <form className="knowledge-form" onSubmit={saveNote}>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="موضوع القاعدة"
          />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="احفظ ملاحظة أو قاعدة Almohaseb مكتشفة"
            rows={4}
          />
          <AssistantButton icon={Save} variant="secondary" type="submit" disabled={saving || !text.trim()}>
            {saving ? 'جاري الحفظ' : 'حفظ معرفة'}
          </AssistantButton>
          {message ? <p className="form-note">{message}</p> : null}
        </form>
      </section>
    </aside>
  );
}

function DatabaseExplorer({ context }) {
  const [table, setTable] = useState('The_Movementrestrictions');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tableOptions = useMemo(
    () => (context?.tables || []).map((item) => `${item.schemaName}.${item.tableName}`),
    [context]
  );

  const inspect = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.aiExploreTable(table);
      setResult(data);
    } catch (requestError) {
      setError(requestError.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="assistant-panel explorer-panel">
      <div className="assistant-section-head">
        <div>
          <h3>Database explorer</h3>
          <p>استكشف البنية، عدد الصفوف، عينات، والعلاقات المحتملة.</p>
        </div>
        <Table2 size={22} />
      </div>
      <div className="explorer-form">
        <input
          list="assistant-table-list"
          value={table}
          onChange={(event) => setTable(event.target.value)}
          placeholder="dbo.The_Movementrestrictions"
        />
        <datalist id="assistant-table-list">
          {tableOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <AssistantButton icon={Search} variant="secondary" onClick={inspect} disabled={loading}>
          {loading ? 'جاري الفحص' : 'فحص'}
        </AssistantButton>
      </div>
      {error ? <div className="soft-state is-error"><AlertTriangle size={20} />{error}</div> : null}
      {result ? (
        <div className="explorer-result">
          <div className="summary-grid">
            <div className="summary-card">
              <span>الجدول</span>
              <strong>{result.table}</strong>
            </div>
            <div className="summary-card">
              <span>عدد الصفوف</span>
              <strong>{formatNumber(result.rowCount)}</strong>
            </div>
          </div>
          <h3 className="subheading">الأعمدة</h3>
          <SimpleTable rows={result.columns || []} />
          <h3 className="subheading">علاقات رسمية</h3>
          <SimpleTable rows={result.foreignKeys || []} />
          <h3 className="subheading">علاقات محتملة</h3>
          <SimpleTable rows={result.candidateLinks || []} />
          <h3 className="subheading">عينة صفوف</h3>
          <SimpleTable rows={result.sampleRows || []} />
        </div>
      ) : null}
    </section>
  );
}

export default function AiAssistantPage({ onBack }) {
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        '### مساعد Teryaq الداخلي\nاسألني عن أرصدة العملاء، فروقات المبيعات، بنية جداول Almohaseb، أو اطلب SQL للتحقق. كل التنفيذ داخل هذه اللوحة يمر عبر حارس read-only.'
    }
  ]);
  const [input, setInput] = useState('');
  const [expectedValue, setExpectedValue] = useState('');
  const [actualValue, setActualValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [queryError, setQueryError] = useState('');

  const loadContext = async () => {
    setContextLoading(true);
    setContextError('');
    try {
      const data = await api.aiContext();
      setContext(data);
    } catch (requestError) {
      setContextError(requestError.message);
    } finally {
      setContextLoading(false);
    }
  };

  useEffect(() => {
    loadContext();
  }, []);

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const userMessage = { role: 'user', content: text };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setBusy(true);

    try {
      const response = await api.aiChat({
        message: text,
        expectedValue,
        actualValue
      });
      setMessages((current) => [...current, response.message]);
    } catch (requestError) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: `### تعذر إنشاء الرد\n${requestError.message}` }
      ]);
    } finally {
      setBusy(false);
    }
  };

  const executeQuery = async (query) => {
    setQueryError('');
    setQueryResult({ loading: true, rows: [] });
    try {
      const data = await api.queryReadonly(query);
      setQueryResult({ loading: false, rows: data.rows || [], rowsAffected: data.rowsAffected || [] });
    } catch (requestError) {
      setQueryError(requestError.message);
      setQueryResult(null);
    }
  };

  return (
    <main className="assistant-page">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Teryaq SQL Connector</p>
          <h1>المساعد الذكي الداخلي</h1>
        </div>
        <div className="header-actions">
          <AssistantButton icon={RefreshCcw} variant="ghost" onClick={loadContext}>تحديث السياق</AssistantButton>
          <AssistantButton icon={ArrowRight} variant="ghost" onClick={onBack}>رجوع</AssistantButton>
        </div>
      </header>

      {contextError ? (
        <div className="soft-state is-error"><AlertTriangle size={20} />{contextError}</div>
      ) : null}

      <div className="assistant-layout">
        <ContextPanel
          context={context}
          loading={contextLoading}
          onKnowledgeSaved={(knowledge) => setContext((current) => ({ ...current, knowledge }))}
        />

        <section className="assistant-main">
          <section className="assistant-panel chat-panel">
            <div className="assistant-section-head">
              <div>
                <h3>Investigation chat</h3>
                <p>اكتب سؤالًا أو أدخل قيمة متوقعة/فعلية للمقارنة.</p>
              </div>
              <Bot size={24} />
            </div>

            <div className="comparison-row">
              <label>
                <span>Expected</span>
                <input value={expectedValue} onChange={(event) => setExpectedValue(event.target.value)} placeholder="392.500" />
              </label>
              <label>
                <span>Actual</span>
                <input value={actualValue} onChange={(event) => setActualValue(event.target.value)} placeholder="القيمة الظاهرة" />
              </label>
            </div>

            <div className="conversation">
              {messages.map((message, index) => (
                <MessageBubble key={index} message={message} onExecute={executeQuery} />
              ))}
              {busy ? <div className="soft-state"><RefreshCcw size={20} />جاري التحليل</div> : null}
            </div>

            <form className="assistant-input" onSubmit={sendMessage}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="مثال: Why is customer balance different for Person_No 270?"
                rows={4}
              />
              <AssistantButton icon={Send} type="submit" disabled={busy}>إرسال</AssistantButton>
            </form>
          </section>

          <section className="assistant-panel">
            <div className="assistant-section-head">
              <div>
                <h3>Query result</h3>
                <p>نتائج تنفيذ الاستعلامات المقترحة تظهر هنا.</p>
              </div>
              <Database size={22} />
            </div>
            {queryError ? <div className="soft-state is-error"><AlertTriangle size={20} />{queryError}</div> : null}
            {queryResult?.loading ? <div className="soft-state"><RefreshCcw size={20} />جاري التنفيذ</div> : null}
            {queryResult && !queryResult.loading ? <SimpleTable rows={queryResult.rows} /> : null}
          </section>

          <DatabaseExplorer context={context} />
        </section>
      </div>
    </main>
  );
}
