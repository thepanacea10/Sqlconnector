import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from './paths.js';
import { executeReadonlyQuery } from './db.js';
import { getConnectionSettings, publicConnectionStatus } from './configStore.js';
import * as almohasebProfile from './profiles/almohasebProfile.js';

const knowledgePath = resolveProjectPath(process.env.ERP_KNOWLEDGE_PATH, './config/erpKnowledge.json');
const allowedTelegramActions = new Set([
  'get_status',
  'get_revenue_today',
  'get_revenue_by_date',
  'get_revenue_range',
  'get_trading_profit_by_date',
  'get_stock_out_items',
  'get_near_expiry_items',
  'search_item',
  'track_item',
  'customer_statement',
  'supplier_statement',
  'top_selling_items'
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_REQUEST';
  return error;
}

function quoteIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw badRequest('Invalid SQL identifier.');
  }
  return `[${identifier.replace(/]/g, ']]')}]`;
}

function parseTableName(value) {
  const parts = String(value || '').trim().split('.').filter(Boolean);
  if (!parts.length || parts.length > 2) {
    throw badRequest('Invalid table name.');
  }

  const schemaName = parts.length === 2 ? parts[0] : 'dbo';
  const tableName = parts.length === 2 ? parts[1] : parts[0];

  return {
    schemaName,
    tableName,
    quoted: `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
  };
}

function todayInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function extractDate(text) {
  const match = String(text || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match ? match[1] : todayInputValue();
}

function extractPersonNo(text) {
  const source = String(text || '');
  const explicit = source.match(/\bPerson_No\s*=?\s*(\d+)\b/i);
  if (explicit) return Number(explicit[1]);

  const personNo = source.match(/\bperson\s*no\s*=?\s*(\d+)\b/i);
  if (personNo) return Number(personNo[1]);

  const standalone = source.match(/\b(\d{2,8})\b/);
  return standalone ? Number(standalone[1]) : null;
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function readKnowledgeNotes() {
  try {
    const raw = await fs.readFile(knowledgePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { profile: 'almohaseb', notes: [] };
    }
    throw error;
  }
}

export async function saveKnowledgeNote({ topic, text }) {
  const cleanText = String(text || '').trim();
  const cleanTopic = String(topic || '').trim() || `Note ${new Date().toISOString().slice(0, 10)}`;

  if (!cleanText) {
    throw badRequest('Knowledge note text is required.');
  }

  const knowledge = await readKnowledgeNotes();
  const nextKnowledge = {
    profile: knowledge.profile || 'almohaseb',
    notes: [
      {
        topic: cleanTopic.slice(0, 120),
        text: cleanText.slice(0, 4000),
        createdAt: new Date().toISOString()
      },
      ...(Array.isArray(knowledge.notes) ? knowledge.notes : [])
    ]
  };

  await fs.mkdir(path.dirname(knowledgePath), { recursive: true });
  await fs.writeFile(knowledgePath, `${JSON.stringify(nextKnowledge, null, 2)}\n`, 'utf8');
  return nextKnowledge;
}

export async function getDatabaseContext() {
  const settings = await getConnectionSettings();
  const [tables, columns, knowledge] = await Promise.all([
    executeReadonlyQuery(`
      SELECT
        TABLE_SCHEMA AS schemaName,
        TABLE_NAME AS tableName,
        TABLE_TYPE AS tableType
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `),
    executeReadonlyQuery(`
      SELECT
        TABLE_SCHEMA AS schemaName,
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        DATA_TYPE AS dataType,
        IS_NULLABLE AS isNullable,
        ORDINAL_POSITION AS ordinalPosition
      FROM INFORMATION_SCHEMA.COLUMNS
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `),
    readKnowledgeNotes()
  ]);

  return {
    profile: 'almohaseb',
    connection: publicConnectionStatus(settings, Boolean(settings), settings ? 'Connected' : 'Connection is not configured'),
    tables: tables.recordset || [],
    columns: columns.recordset || [],
    profileMappings: almohasebProfile.getProfileKnowledge(),
    knowledge
  };
}

export async function inspectTable(table) {
  const parsed = parseTableName(table);
  const tableName = escapeSqlString(parsed.tableName);
  const schemaName = escapeSqlString(parsed.schemaName);

  const [columns, rowCount, sampleRows, foreignKeys, candidateLinks] = await Promise.all([
    executeReadonlyQuery(`
      SELECT
        COLUMN_NAME AS columnName,
        DATA_TYPE AS dataType,
        IS_NULLABLE AS isNullable,
        ORDINAL_POSITION AS ordinalPosition
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schemaName}'
        AND TABLE_NAME = '${tableName}'
      ORDER BY ORDINAL_POSITION
    `),
    executeReadonlyQuery(`SELECT COUNT(*) AS [recordCount] FROM ${parsed.quoted}`),
    executeReadonlyQuery(`SELECT TOP (10) * FROM ${parsed.quoted}`),
    executeReadonlyQuery(`
      SELECT
        fk.name AS relationshipName,
        parentTable.name AS tableName,
        parentColumn.name AS columnName,
        referencedTable.name AS referencedTable,
        referencedColumn.name AS referencedColumn
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      INNER JOIN sys.tables parentTable ON parentTable.object_id = fkc.parent_object_id
      INNER JOIN sys.columns parentColumn ON parentColumn.object_id = fkc.parent_object_id AND parentColumn.column_id = fkc.parent_column_id
      INNER JOIN sys.tables referencedTable ON referencedTable.object_id = fkc.referenced_object_id
      INNER JOIN sys.columns referencedColumn ON referencedColumn.object_id = fkc.referenced_object_id AND referencedColumn.column_id = fkc.referenced_column_id
      INNER JOIN sys.schemas parentSchema ON parentSchema.schema_id = parentTable.schema_id
      WHERE parentSchema.name = '${schemaName}'
        AND parentTable.name = '${tableName}'
      ORDER BY fk.name, parentColumn.name
    `),
    executeReadonlyQuery(`
      SELECT
        COLUMN_NAME AS columnName,
        CASE
          WHEN COLUMN_NAME = 'Person_No' THEN 'dbo.The_Persons.Person_No'
          WHEN COLUMN_NAME = 'Item_No' THEN 'dbo.The_Items.Item_No'
          WHEN COLUMN_NAME = 'Movementrestrictions_No' THEN 'dbo.The_Movementrestrictions.Movementrestrictions_No'
          WHEN COLUMN_NAME = 'Account_No' THEN 'dbo.The_Account.Account_No'
          WHEN COLUMN_NAME = 'User_No' THEN 'Often links to dbo.The_Persons.Person_No for seller/user rows'
          ELSE ''
        END AS possibleReference
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schemaName}'
        AND TABLE_NAME = '${tableName}'
        AND (
          COLUMN_NAME LIKE '%[_]No'
          OR COLUMN_NAME IN ('Person_No', 'Item_No', 'Movementrestrictions_No', 'Account_No', 'User_No')
        )
      ORDER BY ORDINAL_POSITION
    `)
  ]);

  return {
    table: `${parsed.schemaName}.${parsed.tableName}`,
    columns: columns.recordset || [],
    rowCount: rowCount.recordset?.[0]?.recordCount ?? 0,
    sampleRows: sampleRows.recordset || [],
    foreignKeys: foreignKeys.recordset || [],
    candidateLinks: candidateLinks.recordset || []
  };
}

function customerBalanceQuery(personNo) {
  const filter = personNo ? `p.Person_No = ${Number(personNo)}` : `p.Person_Kind = 2`;
  return `
SELECT TOP (50)
  p.Person_No,
  p.Person_Name,
  ISNULL(creditInvoices.creditSalesTotal, 0) AS creditSalesTotal,
  ISNULL(payments.paymentsTotal, 0) AS paymentsTotal,
  ISNULL(creditInvoices.creditSalesTotal, 0) - ISNULL(payments.paymentsTotal, 0) AS finalBalance
FROM dbo.The_Persons p
OUTER APPLY (
  SELECT SUM(ISNULL(invoiceTotals.total, 0)) AS creditSalesTotal
  FROM dbo.The_Movementrestrictions mr
  OUTER APPLY (
    SELECT SUM(
      ISNULL(d.Charge_Value, 0)
      / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
      * ISNULL(d.Item_Quntity, 0)
    ) AS total
    FROM dbo.The_Details d
    LEFT JOIN (
      SELECT
        Item_No,
        MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
      FROM dbo.The_Units
      GROUP BY Item_No
    ) unitInfo ON unitInfo.Item_No = d.Item_No
    WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
  ) invoiceTotals
  WHERE mr.Person_No = p.Person_No
    AND mr.Account_No = 2
) creditInvoices
OUTER APPLY (
  SELECT SUM(ISNULL(ov.Value_paid, 0)) AS paymentsTotal
  FROM dbo.The_Outstandingvalues ov
  WHERE ov.Person_No = p.Person_No
) payments
WHERE ${filter}
ORDER BY p.Person_Name ASC
`.trim();
}

function customerStatementQuery(personNo) {
  const safePersonNo = personNo ? Number(personNo) : 270;
  return `
SELECT TOP (250)
  rows.[date],
  rows.description,
  rows.debit,
  rows.credit,
  (
    SELECT SUM(balanceRows.debit - balanceRows.credit)
    FROM (
      SELECT
        mr.Movementrestrictions_Date AS [date],
        ISNULL(invoiceTotals.total, 0) AS debit,
        CAST(0 AS money) AS credit,
        CAST(1 AS int) AS sortOrder,
        mr.Movementrestrictions_No AS refNo
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (
        SELECT SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
        FROM dbo.The_Details d
        LEFT JOIN (
          SELECT
            Item_No,
            MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
          FROM dbo.The_Units
          GROUP BY Item_No
        ) unitInfo ON unitInfo.Item_No = d.Item_No
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) invoiceTotals
      WHERE mr.Person_No = ${safePersonNo}
        AND mr.Account_No = 2
      UNION ALL
      SELECT
        ov.Date_paid AS [date],
        CAST(0 AS money) AS debit,
        ISNULL(ov.Value_paid, 0) AS credit,
        CAST(2 AS int) AS sortOrder,
        ov.Outstandingvalues_No AS refNo
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = ${safePersonNo}
    ) balanceRows
    WHERE balanceRows.[date] IS NOT NULL
      AND (
        balanceRows.[date] < rows.[date]
        OR (
          balanceRows.[date] = rows.[date]
          AND (
            balanceRows.sortOrder < rows.sortOrder
            OR (
              balanceRows.sortOrder = rows.sortOrder
              AND balanceRows.refNo <= rows.refNo
            )
          )
        )
      )
  ) AS runningBalance
FROM (
  SELECT
    mr.Movementrestrictions_Date AS [date],
    N'Credit invoice ' + CONVERT(NVARCHAR(30), mr.Movementrestrictions_No) AS description,
    ISNULL(invoiceTotals.total, 0) AS debit,
    CAST(0 AS money) AS credit,
    CAST(1 AS int) AS sortOrder,
    mr.Movementrestrictions_No AS refNo
  FROM dbo.The_Movementrestrictions mr
  OUTER APPLY (
    SELECT SUM(
      ISNULL(d.Charge_Value, 0)
      / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
      * ISNULL(d.Item_Quntity, 0)
    ) AS total
    FROM dbo.The_Details d
    LEFT JOIN (
      SELECT
        Item_No,
        MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
      FROM dbo.The_Units
      GROUP BY Item_No
    ) unitInfo ON unitInfo.Item_No = d.Item_No
    WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
  ) invoiceTotals
  WHERE mr.Person_No = ${safePersonNo}
    AND mr.Account_No = 2
  UNION ALL
  SELECT
    ov.Date_paid AS [date],
    N'Payment ' + CONVERT(NVARCHAR(30), ov.Outstandingvalues_No) AS description,
    CAST(0 AS money) AS debit,
    ISNULL(ov.Value_paid, 0) AS credit,
    CAST(2 AS int) AS sortOrder,
    ov.Outstandingvalues_No AS refNo
  FROM dbo.The_Outstandingvalues ov
  WHERE ov.Person_No = ${safePersonNo}
) rows
WHERE rows.[date] IS NOT NULL
ORDER BY rows.[date] DESC, rows.sortOrder DESC, rows.refNo DESC
`.trim();
}

function dailySalesQuery(dateValue) {
  const safeDate = escapeSqlString(dateValue);
  return `
SELECT
  ISNULL(SUM(
    CASE
      WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0)
      WHEN mr.Account_No IN (3, 4) THEN -ISNULL(invoiceTotals.total, 0)
      ELSE 0
    END
  ), 0) AS netSales,
  SUM(CASE WHEN mr.Account_No IN (1, 2) THEN 1 ELSE 0 END) AS invoiceCount,
  SUM(CASE WHEN mr.Account_No IN (3, 4) THEN 1 ELSE 0 END) AS returnCount
FROM dbo.The_Movementrestrictions mr
OUTER APPLY (
  SELECT SUM(
    ISNULL(d.Charge_Value, 0)
    / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
    * ISNULL(d.Item_Quntity, 0)
  ) AS total
  FROM dbo.The_Details d
  LEFT JOIN (
    SELECT
      Item_No,
      MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
    FROM dbo.The_Units
    GROUP BY Item_No
  ) unitInfo ON unitInfo.Item_No = d.Item_No
  WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
) invoiceTotals
WHERE mr.Movementrestrictions_Date >= CONVERT(DATETIME, '${safeDate}', 120)
  AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CONVERT(DATETIME, '${safeDate}', 120))
  AND ISNULL(mr.Case_Invoice, 0) = 0
  AND mr.Account_No IN (1, 2, 3, 4)
`.trim();
}

function cashboxQuery(dateValue) {
  const safeDate = escapeSqlString(dateValue);
  return `
SELECT
  ov.User_No AS sellerId,
  p.Person_Name AS sellerName,
  SUM(ISNULL(ov.Value_paid, 0)) AS cashboxTotal,
  COUNT(ov.Outstandingvalues_No) AS entryCount
FROM dbo.The_Outstandingvalues ov
LEFT JOIN dbo.The_Persons p ON p.Person_No = ov.User_No
WHERE ov.Date_paid >= CONVERT(DATETIME, '${safeDate}', 120)
  AND ov.Date_paid < DATEADD(DAY, 1, CONVERT(DATETIME, '${safeDate}', 120))
  AND ov.Account_No IN (1, 3)
GROUP BY ov.User_No, p.Person_Name
ORDER BY cashboxTotal DESC, sellerName ASC
`.trim();
}

function tableStructureQuery(tableName) {
  const parsed = parseTableName(tableName);
  return `
SELECT
  COLUMN_NAME AS columnName,
  DATA_TYPE AS dataType,
  IS_NULLABLE AS isNullable,
  ORDINAL_POSITION AS ordinalPosition
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = '${escapeSqlString(parsed.schemaName)}'
  AND TABLE_NAME = '${escapeSqlString(parsed.tableName)}'
ORDER BY ORDINAL_POSITION
`.trim();
}

function detectTableName(message) {
  const match = String(message || '').match(/\b(The_[A-Za-z0-9_]+)\b/);
  return match ? match[1] : null;
}

function createSuggestedQueries(message) {
  const text = String(message || '');
  const normalized = text.toLowerCase();
  const dateValue = extractDate(text);
  const personNo = extractPersonNo(text);
  const tableName = detectTableName(text);
  const suggestions = [];

  if (/balance|customer|رصيد|عميل|زبون|حساب|سالم|payment|دفعة|مدفوع/i.test(text)) {
    suggestions.push({
      title: personNo ? `Verify customer balance for Person_No ${personNo}` : 'Verify customer balances',
      sql: customerBalanceQuery(personNo)
    });

    if (personNo) {
      suggestions.push({
        title: `Customer running statement for Person_No ${personNo}`,
        sql: customerStatementQuery(personNo)
      });
    }
  }

  if (/sales|sale|مبيعات|فاتورة|returns|مردود|daily|today|اليوم/.test(normalized)) {
    suggestions.push({
      title: `Verify daily net sales for ${dateValue}`,
      sql: dailySalesQuery(dateValue)
    });
  }

  if (/cashbox|cash|collection|payment|صندوق|تحصيل|دفعات|مدفوعات/.test(normalized)) {
    suggestions.push({
      title: `Inspect seller cashboxes for ${dateValue}`,
      sql: cashboxQuery(dateValue)
    });
  }

  if (tableName) {
    suggestions.push({
      title: `Show structure for dbo.${tableName}`,
      sql: tableStructureQuery(tableName)
    });
  }

  if (!suggestions.length) {
    suggestions.push(
      { title: `Verify daily net sales for ${dateValue}`, sql: dailySalesQuery(dateValue) },
      { title: personNo ? `Verify customer balance for Person_No ${personNo}` : 'Verify customer balance formula', sql: customerBalanceQuery(personNo) }
    );
  }

  return suggestions;
}

export async function createAssistantResponse({ message, expectedValue, actualValue }) {
  const text = String(message || '').trim();
  if (!text) {
    throw badRequest('Message is required.');
  }

  const context = await getDatabaseContext();
  const dateValue = extractDate(text);
  const personNo = extractPersonNo(text);
  const suggestions = createSuggestedQueries(text);
  const hasComparison = expectedValue !== undefined && expectedValue !== null && String(expectedValue).trim() !== '';
  const comparisonLine = hasComparison
    ? `\n\n### Comparison mode\n- Expected value: \`${expectedValue}\`\n- Actual value: \`${actualValue ?? '-'}\`\n- Start by running the verification query, then compare the computed columns with both values.`
    : '';

  const content = `
### Almohaseb investigation
I will use the active \`${context.profile}\` rules and keep every database action read-only.

Key rules currently loaded:
- Customers: \`The_Persons.Person_Kind = 2\`
- Customer balance: credit invoices \`Account_No = 2\` minus \`The_Outstandingvalues.Value_paid\` by \`Person_No\`
- Sales totals: Almohaseb-normalized \`Charge_Value / Unit_OldQuantity * Item_Quntity\`
- Sales accounts: \`1,2\` are positive; \`3,4\` are returns and negative
- Daily sales date: \`Movementrestrictions_Date >= selectedDate AND < nextDate\`
- Cashboxes/payments: \`The_Outstandingvalues\`, not sales totals

Investigation focus:
- Selected date: \`${dateValue}\`
- Person_No: \`${personNo ?? 'not specified'}\`
- Connected database: \`${context.connection.database ?? '-'}\`
- Available tables loaded: \`${context.tables.length}\`
${comparisonLine}

Run the suggested SQL below to verify the mismatch source. Each query is SELECT-only and can be executed from this panel.
`.trim();

  return {
    role: 'assistant',
    content,
    suggestedQueries: suggestions,
    contextSummary: {
      profile: context.profile,
      database: context.connection.database,
      server: context.connection.server,
      tableCount: context.tables.length,
      columnCount: context.columns.length
    }
  };
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number)
    : String(value ?? '-');
}

function formatDateForReply(value) {
  if (!value) return '-';
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('en-GB').format(date);
}

function todayDateInput() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function normalizeArabicDigits(value) {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return String(value || '').replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    const persianIndex = persian.indexOf(digit);
    return persianIndex >= 0 ? String(persianIndex) : digit;
  });
}

function parseFlexibleDate(value) {
  const text = normalizeArabicDigits(value);
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  const lower = text.toLowerCase();
  if (/(yesterday|أمس|امس)/i.test(lower)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  return null;
}

function monthRange(dateValue = todayDateInput()) {
  const [year, month] = dateValue.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { dateFrom: from, dateTo: to };
}

function extractSearchTerm(message, keywords = []) {
  let text = String(message || '').trim();
  keywords.forEach((keyword) => {
    text = text.replace(new RegExp(keyword, 'ig'), ' ');
  });
  [
    'كم',
    'اعطني',
    'أعطني',
    'اريد',
    'أريد',
    'كشف حساب',
    'حساب',
    'تتبع',
    'حركة صنف',
    'صنف',
    'عن',
    'يوم',
    'بتاريخ',
    'هذا',
    'الشهر',
    'اليوم',
    'امس',
    'أمس'
  ].forEach((word) => {
    text = text.replace(new RegExp(word, 'ig'), ' ');
  });
  text = text.replace(/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function sanitizeIntent(intent) {
  if (!intent || typeof intent !== 'object') return null;
  const action = String(intent.action || '').trim();
  if (!allowedTelegramActions.has(action)) return null;
  return {
    action,
    params: intent.params && typeof intent.params === 'object' ? intent.params : {},
    replyLanguage: intent.replyLanguage === 'ar' ? 'ar' : 'ar'
  };
}

function heuristicIntent(message) {
  const text = normalizeArabicDigits(message).trim();
  const date = parseFlexibleDate(text);
  if (/^\/?status\b|الحالة|الاتصال/.test(text)) return { action: 'get_status', params: {}, replyLanguage: 'ar' };
  if (/نافد|نفدت|ناقص|خلص|out.?of.?stock/i.test(text)) return { action: 'get_stock_out_items', params: {}, replyLanguage: 'ar' };
  if (/قرب الانتهاء|قريب الانتهاء|الصلاحية|منتهي|expiry/i.test(text)) return { action: 'get_near_expiry_items', params: { days: 90 }, replyLanguage: 'ar' };
  if (/تتبع|حركة صنف|track/i.test(text)) return { action: 'track_item', params: { query: extractSearchTerm(text, ['تتبع', 'حركة صنف', 'track']) }, replyLanguage: 'ar' };
  if (/صنف|دواء|بحث|search/i.test(text) && !/اكثر|أكثر|مبيع/.test(text)) return { action: 'search_item', params: { query: extractSearchTerm(text, ['صنف', 'دواء', 'بحث', 'search']) }, replyLanguage: 'ar' };
  if (/أكثر|اكثر|top|مبيع/.test(text)) return { action: 'top_selling_items', params: { ...(text.includes('الشهر') ? monthRange(date || todayDateInput()) : { dateFrom: date || todayDateInput(), dateTo: date || todayDateInput() }), limit: 20 }, replyLanguage: 'ar' };
  if (/أرباح|ارباح|ربح|المتاجرة|profit/i.test(text)) return { action: 'get_trading_profit_by_date', params: { date: date || todayDateInput() }, replyLanguage: 'ar' };
  if (/كشف حساب|حساب زبون|حساب عميل/.test(text)) return { action: 'customer_statement', params: { query: extractSearchTerm(text, ['كشف حساب', 'حساب زبون', 'حساب عميل']) }, replyLanguage: 'ar' };
  if (/كشف مورد|حساب مورد|مورد/.test(text)) return { action: 'supplier_statement', params: { query: extractSearchTerm(text, ['كشف مورد', 'حساب مورد', 'مورد']) }, replyLanguage: 'ar' };
  if (/إيراد|ايراد|مبيعات|الفترة|cash|revenue/i.test(text)) return date ? { action: 'get_revenue_by_date', params: { date }, replyLanguage: 'ar' } : { action: 'get_revenue_today', params: {}, replyLanguage: 'ar' };
  return null;
}

function telegramIntentSystemPrompt() {
  return `You classify Arabic pharmacy ERP questions into exactly one allowed action. Return strict JSON only. Never return SQL.
Allowed actions: ${Array.from(allowedTelegramActions).join(', ')}.
Use params with ISO dates YYYY-MM-DD. If the user asks "today", use ${todayDateInput()}. If unclear, return {"action":"clarify","params":{"question":"..."}}.`;
}

function parseJsonObject(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function callOpenAiForIntent(message) {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.AI_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: telegramIntentSystemPrompt()
        },
        { role: 'user', content: String(message || '') }
      ]
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return parseJsonObject(content);
}

async function callGeminiForIntent(message) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.AI_MODEL || 'gemini-1.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json'
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${telegramIntentSystemPrompt()}\n\nUser question:\n${String(message || '')}`
            }
          ]
        }
      ]
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n');
  return parseJsonObject(content);
}

async function callAiForIntent(message) {
  const provider = String(process.env.AI_PROVIDER || '').toLowerCase();
  if (provider === 'gemini') {
    return (await callGeminiForIntent(message)) || (await callOpenAiForIntent(message));
  }
  return (await callOpenAiForIntent(message)) || (await callGeminiForIntent(message));
}

export async function classifyTelegramIntent(message) {
  const aiIntent = sanitizeIntent(await callAiForIntent(message));
  if (aiIntent) return aiIntent;
  const fallback = sanitizeIntent(heuristicIntent(message));
  if (fallback) return fallback;
  return {
    action: 'clarify',
    params: {
      question: 'لم أفهم الطلب بدقة. اسأل مثلاً: كم إيراد اليوم؟ أو أعطني الأصناف النافدة.'
    },
    replyLanguage: 'ar'
  };
}

async function topSellingItems({ dateFrom, dateTo, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 20);
  const from = parseFlexibleDate(dateFrom) || todayDateInput();
  const to = parseFlexibleDate(dateTo) || from;
  const query = `
    SELECT TOP (${safeLimit})
      COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد') AS itemName,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Item_Quntity, 0) WHEN mr.Account_No IN (3, 4) THEN -ISNULL(d.Item_Quntity, 0) ELSE 0 END) AS quantity,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) WHEN mr.Account_No IN (3, 4) THEN -ISNULL(d.Charge_Value, 0) ELSE 0 END) AS total
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = d.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    WHERE mr.Movementrestrictions_Date >= CONVERT(DATETIME, @dateFrom, 120)
      AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
      AND ISNULL(mr.Case_Invoice, 0) = 0
      AND mr.Account_No IN (1, 2, 3, 4)
    GROUP BY COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد')
    ORDER BY quantity DESC, total DESC
  `;
  const result = await executeReadonlyQuery(query, (request, sql) => {
    request.input('dateFrom', sql.NVarChar, from);
    request.input('dateTo', sql.NVarChar, to);
  });
  return { dateFrom: from, dateTo: to, rows: result.recordset || [] };
}

function conciseList(rows, mapper, emptyText = 'لا توجد بيانات.') {
  if (!rows?.length) return emptyText;
  return rows.slice(0, 20).map(mapper).join('\n');
}

export async function executeTelegramAction(intent) {
  const safeIntent = sanitizeIntent(intent);
  if (!safeIntent) {
    return { text: 'الطلب غير مدعوم حالياً.' };
  }
  const params = safeIntent.params || {};

  if (safeIntent.action === 'get_status') {
    const settings = await getConnectionSettings();
    await executeReadonlyQuery('SELECT 1 AS ok');
    return { text: `متصل ✅\nالسيرفر: ${settings.server}\nالقاعدة: ${settings.database}` };
  }

  if (safeIntent.action === 'get_revenue_today' || safeIntent.action === 'get_revenue_by_date') {
    const date = safeIntent.action === 'get_revenue_today' ? todayDateInput() : (parseFlexibleDate(params.date) || todayDateInput());
    const data = await almohasebProfile.getRevenueDetails({ dateFrom: date, dateTo: date });
    const summary = data.summary || {};
    return {
      text: `إيراد ${formatDateForReply(date)}\nالصافي: ${formatNumber(summary.netRevenue)}\nالنقدي: ${formatNumber(summary.cashSalesTotal)}\nسداد مدينين: ${formatNumber(summary.debtorPaymentsTotal)}\nإلكتروني: ${formatNumber(summary.electronicPaymentsTotal)}\nمردودات: ${formatNumber(summary.returnsTotal)}`
    };
  }

  if (safeIntent.action === 'get_revenue_range') {
    const dateFrom = parseFlexibleDate(params.dateFrom) || todayDateInput();
    const dateTo = parseFlexibleDate(params.dateTo) || dateFrom;
    const data = await almohasebProfile.getRevenueDetails({ dateFrom, dateTo });
    return { text: `إيراد الفترة ${formatDateForReply(dateFrom)} - ${formatDateForReply(dateTo)}\nالصافي: ${formatNumber(data.summary?.netRevenue)}` };
  }

  if (safeIntent.action === 'get_trading_profit_by_date') {
    const date = parseFlexibleDate(params.date) || todayDateInput();
    const data = await almohasebProfile.getTradingProfit({ dateFrom: date, dateTo: date });
    return { text: `أرباح ${formatDateForReply(date)}\nالإيراد الرسمي: ${formatNumber(data.summary?.revenue)}\nصافي الربح: ${formatNumber(data.summary?.netProfit)}${data.reconciliation?.isSnapshotIncomplete ? '\nتنبيه: ملخص المتاجرة الرسمي غير مكتمل مقارنة بالحركات الفعلية.' : ''}` };
  }

  if (safeIntent.action === 'get_stock_out_items') {
    const rows = await almohasebProfile.getOutOfStockItems({ search: params.query || '' });
    return { text: `الأصناف النافدة:\n${conciseList(rows, (row, index) => `${index + 1}. ${row.itemName || '-'} - آخر بيع: ${formatDateForReply(row.lastSaleDate)}`)}` };
  }

  if (safeIntent.action === 'get_near_expiry_items') {
    const data = await almohasebProfile.getItemExpiryReport({ search: params.query || '', days: params.days || 90 });
    const rows = data.rows || data || [];
    return { text: `أصناف قرب الانتهاء:\n${conciseList(rows, (row, index) => `${index + 1}. ${row.itemName || '-'} - ${formatDateForReply(row.expiryDate)} - الكمية: ${row.formattedQuantity || formatNumber(row.quantity)}`)}` };
  }

  if (safeIntent.action === 'search_item') {
    const rows = await almohasebProfile.searchItems({ query: params.query || '' });
    return { text: `نتائج البحث:\n${conciseList(rows, (row, index) => `${index + 1}. ${row.itemName || '-'}\nالكود: ${row.itemCode || '-'} | الباركود: ${row.barcode || '-'} | الكمية: ${row.formattedQuantity || formatNumber(row.currentQuantity)}`)}` };
  }

  if (safeIntent.action === 'track_item') {
    const query = params.query || '';
    const rows = await almohasebProfile.searchItems({ query });
    if (!rows.length) return { text: 'لم أجد هذا الصنف.' };
    const data = await almohasebProfile.trackItem({ itemId: rows[0].itemId });
    return { text: `تتبع الصنف: ${data.item?.itemName || rows[0].itemName}\nالمخزون: ${data.item?.formattedQuantity || formatNumber(data.item?.currentStock)}\nالداخل: ${formatNumber(data.summary?.quantityIn)}\nالخارج: ${formatNumber(data.summary?.quantityOut)}\nربح تقريبي: ${formatNumber(data.summary?.approximateProfit)}` };
  }

  if (safeIntent.action === 'customer_statement') {
    const customers = await almohasebProfile.getCustomers({ search: params.query || '' });
    if (!customers.length) return { text: 'لم أجد هذا الزبون.' };
    const customer = customers[0];
    const rows = await almohasebProfile.getCustomerStatement(customer.id);
    return { text: `كشف حساب ${customer.name}\nالرصيد: ${formatNumber(customer.currentBalance)}\nآخر الحركات:\n${conciseList(rows, (row) => `${formatDateForReply(row.date)} | ${row.description || '-'} | مدين ${formatNumber(row.debit)} | دائن ${formatNumber(row.credit)} | رصيد ${formatNumber(row.runningBalance)}`, 'لا توجد حركات.')}` };
  }

  if (safeIntent.action === 'supplier_statement') {
    const suppliers = await almohasebProfile.getSuppliers({ search: params.query || '' });
    if (!suppliers.length) return { text: 'لم أجد هذا المورد.' };
    const supplier = suppliers[0];
    const rows = await almohasebProfile.getSupplierStatement(supplier.id);
    return { text: `كشف حساب ${supplier.name}\nالرصيد: ${formatNumber(supplier.currentBalance)}\nآخر الحركات:\n${conciseList(rows, (row) => `${formatDateForReply(row.date)} | ${row.description || '-'} | مدين ${formatNumber(row.debit)} | دائن ${formatNumber(row.credit)} | رصيد ${formatNumber(row.runningBalance)}`, 'لا توجد حركات.')}` };
  }

  if (safeIntent.action === 'top_selling_items') {
    const range = params.dateFrom || params.dateTo ? params : monthRange(todayDateInput());
    const data = await topSellingItems(range);
    return { text: `أكثر الأصناف مبيعاً ${formatDateForReply(data.dateFrom)} - ${formatDateForReply(data.dateTo)}:\n${conciseList(data.rows, (row, index) => `${index + 1}. ${row.itemName || '-'} | كمية: ${formatNumber(row.quantity)} | قيمة: ${formatNumber(row.total)}`)}` };
  }

  return { text: 'هذا التقرير غير متاح حالياً.' };
}

export async function answerTelegramQuestion(message) {
  const intent = await classifyTelegramIntent(message);
  if (intent.action === 'clarify') {
    return { text: intent.params?.question || 'يرجى توضيح الطلب.', intent };
  }
  try {
    const result = await executeTelegramAction(intent);
    return { ...result, intent };
  } catch (error) {
    return {
      text: `تعذر تنفيذ الطلب: ${error.message || 'خطأ غير معروف'}`,
      intent
    };
  }
}
