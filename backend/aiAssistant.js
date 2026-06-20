import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from './paths.js';
import { executeReadonlyQuery } from './db.js';
import { getConnectionSettings, publicConnectionStatus } from './configStore.js';
import { getProfileKnowledge } from './profiles/almohasebProfile.js';

const knowledgePath = resolveProjectPath(process.env.ERP_KNOWLEDGE_PATH, './config/erpKnowledge.json');

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
    profileMappings: getProfileKnowledge(),
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
