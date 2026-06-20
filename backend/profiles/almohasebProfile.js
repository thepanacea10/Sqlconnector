import { sql, executeReadonlyQuery } from '../db.js';

export function getProfileKnowledge() {
  return {
    profile: 'almohaseb',
    rules: {
      customers: {
        table: 'dbo.The_Persons',
        filter: 'Person_Kind = 2',
        balance:
          'Credit invoices from dbo.The_Movementrestrictions where Account_No = 2, minus customer payments from dbo.The_Outstandingvalues by Person_No.'
      },
      suppliers: {
        table: 'dbo.The_Persons',
        filter: 'Person_Kind = 3'
      },
      sales: {
        invoicesTable: 'dbo.The_Movementrestrictions',
        detailsTable: 'dbo.The_Details',
        join: 'The_Movementrestrictions.Movementrestrictions_No = The_Details.Movementrestrictions_No',
        lineTotal: 'Almohaseb normalizes Charge_Value by the default unit quantity and detail quantity.',
        totalFormula: 'SUM(The_Details.Charge_Value / The_Units.Unit_OldQuantity * The_Details.Item_Quntity)',
        accounts: {
          1: 'cash sales, positive',
          2: 'credit sales, positive',
          3: 'cash returns, negative',
          4: 'credit returns, negative'
        },
        dateField: 'The_Movementrestrictions.Movementrestrictions_Date'
      },
      cashboxes: {
        table: 'dbo.The_Outstandingvalues',
        purpose: 'Cashbox, payments, and collections only. Do not use this table for sales totals.',
        sellerField: 'User_No',
        dateField: 'Date_paid',
        amountField: 'Value_paid'
      },
      inventory: {
        baseTable: 'dbo.The_Items',
        note: 'Inventory listing starts from The_Items and uses LEFT JOINs so items without barcode, stock, or price remain visible.'
      }
    }
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_REQUEST';
  return error;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('Invalid numeric id.');
  }
  return id;
}

function parseDays(value) {
  const days = Number(value || 30);
  if (!Number.isFinite(days)) return 30;
  return Math.min(Math.max(Math.trunc(days), 1), 365);
}

function parseSelectedDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw badRequest('Invalid date. Use YYYY-MM-DD.');
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw badRequest('Invalid date. Use YYYY-MM-DD.');
  }

  return date;
}

function searchText(value) {
  return String(value ?? '').trim();
}

function bindSearch(request, search) {
  request.input('search', sql.NVarChar, search);
  request.input('searchLike', sql.NVarChar, `%${search}%`);
}

function bindId(request, id) {
  request.input('id', sql.Int, parseId(id));
}

function bindSelectedDate(request, selectedDate) {
  if (selectedDate) {
    request.input('selectedDate', sql.NVarChar, formatDateInputValue(selectedDate));
  }
}

function formatDateInputValue(date) {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function selectedDateFilter(columnName, selectedDate) {
  if (selectedDate) {
    return `${columnName} >= CONVERT(DATETIME, @selectedDate, 120) AND ${columnName} < DATEADD(DAY, 1, CONVERT(DATETIME, @selectedDate, 120))`;
  }

  return `${columnName} >= CAST(GETDATE() AS DATE) AND ${columnName} < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))`;
}

function revenueDateFilter(selectedDate) {
  return selectedDateFilter('ov.Date_paid', selectedDate);
}

function bindOptionalRevenueFilters(request, filters = {}) {
  if (filters.sellerId) request.input('sellerId', sql.Int, Number(filters.sellerId));
  if (filters.period) request.input('period', sql.NVarChar, String(filters.period));
  if (filters.paymentMethod) request.input('paymentMethod', sql.NVarChar, String(filters.paymentMethod));
  if (filters.movementType) request.input('movementType', sql.NVarChar, String(filters.movementType));
}

function revenueOptionalWhere(filters = {}) {
  const clauses = [];
  if (filters.sellerId) clauses.push('AND revenueRows.sellerId = @sellerId');
  if (filters.period) clauses.push('AND revenueRows.period = @period');
  if (filters.paymentMethod) clauses.push('AND revenueRows.paymentMethod = @paymentMethod');
  if (filters.movementType) clauses.push('AND revenueRows.movementType = @movementType');
  return clauses.join('\n');
}

function revenueRowsSubquery(selectedDate) {
  const dateFilter = revenueDateFilter(selectedDate);

  return `
    SELECT
      ov.Outstandingvalues_No AS movementNo,
      ov.Movementrestrictions_No AS invoiceNo,
      ov.Date_paid AS movementDate,
      ov.Item_Add AS movementCreatedAt,
      CASE
        WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN 1
        ELSE 0
      END AS movementHasRealTime,
      CASE
        WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN N'The_Outstandingvalues.Item_Add'
        ELSE N'The_Outstandingvalues.Date_paid'
      END AS movementDateTimeSource,
      CASE
        WHEN ov.Account_No = 1 AND ISNULL(ov.Value_paid, 0) >= 0 AND ISNULL(ov.Type_Payment, N'') = N'نقداً' THEN N'مبيعات نقدية'
        WHEN ov.Account_No = 1 AND ISNULL(ov.Value_paid, 0) >= 0 THEN ISNULL(NULLIF(ov.Type_Payment, N''), N'طريقة دفع أخرى')
        WHEN ov.Account_No = 2 AND ISNULL(ov.Value_paid, 0) >= 0 AND ISNULL(ov.Type_Payment, N'') = N'نقداً' THEN N'سداد مدين'
        WHEN ov.Account_No = 2 AND ISNULL(ov.Value_paid, 0) >= 0 THEN ISNULL(NULLIF(ov.Type_Payment, N''), N'سداد مدين')
        WHEN ov.Account_No = 3 THEN N'مردودات نقدية'
        WHEN ov.Account_No = 4 THEN N'مردودات مبيعات'
        WHEN ISNULL(ov.Value_paid, 0) < 0 THEN N'حركة عكسية'
        ELSE ISNULL(acc.Account_Name, N'حركة إيراد')
      END AS movementType,
      CASE
        WHEN ov.Account_No IN (3, 4) OR ISNULL(ov.Value_paid, 0) < 0 THEN N'مردودات'
        WHEN ov.Account_No = 1 AND ISNULL(ov.Type_Payment, N'') = N'نقداً' THEN N'مبيعات نقدية'
        WHEN ov.Account_No = 2 AND ISNULL(ov.Type_Payment, N'') = N'نقداً' THEN N'سداد مدينين'
        WHEN ISNULL(ov.Type_Payment, N'') <> N'' THEN ov.Type_Payment
        WHEN ov.Account_No = 2 THEN N'سداد مدينين'
        ELSE N'طريقة دفع أخرى'
      END AS revenueSource,
      ov.Person_No AS customerId,
      ISNULL(customer.Person_Name, N'غير محدد') AS customerName,
      ov.User_No AS sellerId,
      ISNULL(seller.Person_Name, N'غير محدد') AS sellerName,
      ISNULL(seller.Person_Name, N'غير محدد') AS period,
      ISNULL(NULLIF(ov.Type_Payment, N''), N'غير محدد') AS paymentMethod,
      CASE
        WHEN ISNULL(acc.Account_kind, 0) < 0 AND ISNULL(ov.Value_paid, 0) > 0 THEN -ISNULL(ov.Value_paid, 0)
        ELSE ISNULL(ov.Value_paid, 0)
      END AS amount,
      ov.Account_No AS accountNo,
      ISNULL(acc.Account_Name, N'غير محدد') AS accountName,
      ov.Doc_No AS documentNo,
      ov.Doc_Kind AS documentKind,
      ov.Doc_Side AS documentSide,
      ov.Comment AS notes
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    LEFT JOIN dbo.The_Persons customer ON customer.Person_No = ov.Person_No
    LEFT JOIN dbo.The_Persons seller ON seller.Person_No = ov.User_No
    WHERE ${dateFilter}
      AND ov.Account_No IN (1, 2, 3, 4)
  `;
}

function revenueRowsFrom(selectedDate, filters = {}) {
  return `
    FROM (
      ${revenueRowsSubquery(selectedDate)}
    ) revenueRows
    WHERE 1 = 1
    ${revenueOptionalWhere(filters)}
  `;
}

const purchaseAccountNumbers = '7, 8, 11, 12, 24';

const invoiceTotalApply = `
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
`;

const customerBalanceApply = `
  OUTER APPLY (
    SELECT
      SUM(ISNULL(invoiceTotals.total, 0)) AS total,
      MAX(mr.Movementrestrictions_Date) AS lastDate
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
  ) invoices
  OUTER APPLY (
    SELECT
      SUM(ISNULL(ov.Value_paid, 0)) AS total,
      MAX(ov.Date_paid) AS lastDate
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = p.Person_No
  ) outstanding
  OUTER APPLY (
    SELECT TOP (1)
      ledgerRow.[date],
      ledgerRow.amount
    FROM (
      SELECT
        mr.Movementrestrictions_Date AS [date],
        ISNULL(invoiceTotals.total, 0) AS amount
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
      UNION ALL
      SELECT ov.Date_paid AS [date], -ISNULL(ov.Value_paid, 0) AS amount
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = p.Person_No
    ) ledgerRow
    WHERE ledgerRow.[date] IS NOT NULL
    ORDER BY ledgerRow.[date] DESC
  ) lastMovement
`;

export async function getCustomers({ search }) {
  const term = searchText(search);
  const query = `
    SELECT TOP (80)
      p.Person_No AS id,
      p.Person_Name AS name,
      p.Person_tel AS phone,
      p.Person_Add AS address,
      ISNULL(invoices.total, 0) - ISNULL(outstanding.total, 0) AS currentBalance,
      lastMovement.[date] AS lastTransactionDate,
      lastMovement.amount AS lastTransactionAmount
    FROM dbo.The_Persons p
    ${customerBalanceApply}
    WHERE p.Person_Kind = 2
      AND (
        @search = N''
        OR CONVERT(NVARCHAR(4000), p.Person_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), p.Person_tel) LIKE @searchLike
      )
    ORDER BY p.Person_Name ASC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindSearch(request, term));
  return result.recordset || [];
}

export async function getSuppliers({ search }) {
  const term = searchText(search);
  const query = `
    SELECT
      supplierRows.id,
      supplierRows.name,
      supplierRows.phone,
      supplierRows.address,
      ISNULL(outstanding.total, 0) AS currentBalance,
      outstanding.lastDate AS lastTransactionDate,
      outstanding.lastAmount AS lastTransactionAmount
    FROM (
      SELECT TOP (80)
        p.Person_No AS id,
        p.Person_Name AS name,
        p.Person_tel AS phone,
        p.Person_Add AS address
      FROM dbo.The_Persons p
      WHERE p.Person_Kind = 3
        AND (
          @search = N''
          OR CONVERT(NVARCHAR(4000), p.Person_Name) LIKE @searchLike
          OR CONVERT(NVARCHAR(4000), p.Person_tel) LIKE @searchLike
        )
      ORDER BY p.Person_Name ASC
    ) supplierRows
    OUTER APPLY (
      SELECT
        SUM(ISNULL(ov.Value_paid, 0)) AS total,
        MAX(ov.Date_paid) AS lastDate,
        CAST(NULL AS money) AS lastAmount
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = supplierRows.id
        AND ov.Account_No IN (${purchaseAccountNumbers})
    ) outstanding
    ORDER BY supplierRows.name ASC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindSearch(request, term));
  return result.recordset || [];
}

export async function getSupplierInvoices(id) {
  const query = `
    SELECT TOP (150)
      mr.Movementrestrictions_No AS invoiceNumber,
      mr.Purchase_invoice AS purchaseInvoice,
      mr.Movementrestrictions_Date AS [date],
      ISNULL(acc.Account_Name, N'فاتورة شراء') AS invoiceType,
      ISNULL(invoiceTotals.total, 0) AS total,
      ISNULL(payments.paid, 0) AS paid,
      ISNULL(invoiceTotals.total, 0) - ISNULL(payments.paid, 0) AS remaining
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    ${invoiceTotalApply}
    OUTER APPLY (
      SELECT SUM(ABS(ISNULL(ov.Value_paid, 0))) AS paid
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Movementrestrictions_No = mr.Movementrestrictions_No
        AND ov.Account_No IN (${purchaseAccountNumbers})
    ) payments
    WHERE mr.Person_No = @id
      AND mr.Account_No IN (${purchaseAccountNumbers})
      AND ISNULL(mr.Case_Invoice, 0) = 0
    ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getSupplierPayments(id) {
  const query = `
    SELECT TOP (150)
      N'P-' + CONVERT(NVARCHAR(30), ov.Outstandingvalues_No) AS paymentNumber,
      ov.Date_paid AS [date],
      ABS(ISNULL(ov.Value_paid, 0)) AS amount,
      ISNULL(NULLIF(ov.Type_Payment, N''), N'غير محدد') AS paymentMethod,
      ov.Movementrestrictions_No AS invoiceNumber,
      ISNULL(ov.Comment, N'') AS notes
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = @id
      AND ov.Account_No IN (${purchaseAccountNumbers})
    ORDER BY ov.Date_paid DESC, ov.Outstandingvalues_No DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getSupplierStatement(id) {
  const statementRowsQuery = `
    SELECT
      mr.Movementrestrictions_Date AS [date],
      N'فاتورة شراء رقم ' + CONVERT(NVARCHAR(30), mr.Movementrestrictions_No) AS description,
      CAST(0 AS money) AS debit,
      ISNULL(invoiceTotals.total, 0) AS credit,
      CAST(1 AS int) AS sortOrder,
      mr.Movementrestrictions_No AS refNo
    FROM dbo.The_Movementrestrictions mr
    ${invoiceTotalApply}
    WHERE mr.Person_No = @id
      AND mr.Account_No IN (${purchaseAccountNumbers})
      AND ISNULL(mr.Case_Invoice, 0) = 0
    UNION ALL
    SELECT
      ov.Date_paid AS [date],
      N'سداد مورد رقم ' + CONVERT(NVARCHAR(30), ov.Outstandingvalues_No) AS description,
      ABS(ISNULL(ov.Value_paid, 0)) AS debit,
      CAST(0 AS money) AS credit,
      CAST(2 AS int) AS sortOrder,
      ov.Outstandingvalues_No AS refNo
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = @id
      AND ov.Account_No IN (${purchaseAccountNumbers})
  `;

  const query = `
    SELECT TOP (250)
      statementRows.[date],
      statementRows.description,
      statementRows.debit,
      statementRows.credit,
      (
        SELECT SUM(balanceRows.credit - balanceRows.debit)
        FROM (
          ${statementRowsQuery}
        ) balanceRows
        WHERE balanceRows.[date] IS NOT NULL
          AND (
            balanceRows.[date] < statementRows.[date]
            OR (
              balanceRows.[date] = statementRows.[date]
              AND (
                balanceRows.sortOrder < statementRows.sortOrder
                OR (
                  balanceRows.sortOrder = statementRows.sortOrder
                  AND balanceRows.refNo <= statementRows.refNo
                )
              )
            )
          )
      ) AS runningBalance
    FROM (
      ${statementRowsQuery}
    ) statementRows
    WHERE statementRows.[date] IS NOT NULL
    ORDER BY statementRows.[date] DESC, statementRows.sortOrder DESC, statementRows.refNo DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getCustomer(id) {
  const query = `
    SELECT TOP (1)
      p.Person_No AS id,
      p.Person_Name AS name,
      p.Person_tel AS phone,
      p.Person_Add AS address
    FROM dbo.The_Persons p
    WHERE p.Person_No = @id
      AND p.Person_Kind = 2
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset?.[0] || null;
}

export async function getCustomerInvoices(id) {
  const query = `
    SELECT TOP (150)
      mr.Movementrestrictions_No AS invoiceNumber,
      mr.Account_No AS accountNo,
      mr.Movementrestrictions_Date AS [date],
      ISNULL(invoiceTotals.total, 0) AS total,
      ISNULL(payments.paid, 0) AS paid,
      ISNULL(invoiceTotals.total, 0) - ISNULL(payments.paid, 0) AS remaining
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
    OUTER APPLY (
      SELECT SUM(ISNULL(ov.Value_paid, 0)) AS paid
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Movementrestrictions_No = mr.Movementrestrictions_No
    ) payments
    WHERE mr.Person_No = @id
      AND mr.Account_No = 2
    ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getCustomerReceipts(id) {
  const query = `
    SELECT TOP (150)
      N'P-' + CONVERT(NVARCHAR(30), ov.Outstandingvalues_No) AS receiptNumber,
      ov.Date_paid AS [date],
      ISNULL(ov.Value_paid, 0) AS amount,
      ISNULL(ov.Type_Payment, N'') + CASE WHEN ov.Comment IS NULL OR ov.Comment = N'' THEN N'' ELSE N' - ' + ov.Comment END AS notes
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = @id
    ORDER BY ov.Date_paid DESC, ov.Outstandingvalues_No DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getCustomerStatement(id) {
  const statementRowsQuery = `
    SELECT
      mr.Movementrestrictions_Date AS [date],
      N'فاتورة رقم ' + CONVERT(NVARCHAR(30), mr.Movementrestrictions_No) AS description,
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
    WHERE mr.Person_No = @id
      AND mr.Account_No = 2
    UNION ALL
    SELECT
      ov.Date_paid AS [date],
      N'دفعة رقم ' + CONVERT(NVARCHAR(30), ov.Outstandingvalues_No) AS description,
      CAST(0 AS money) AS debit,
      ISNULL(ov.Value_paid, 0) AS credit,
      CAST(2 AS int) AS sortOrder,
      ov.Outstandingvalues_No AS refNo
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = @id
  `;

  const query = `
    SELECT TOP (250)
      statementRows.[date],
      statementRows.description,
      statementRows.debit,
      statementRows.credit,
      (
        SELECT SUM(balanceRows.debit - balanceRows.credit)
        FROM (
          ${statementRowsQuery}
        ) balanceRows
        WHERE balanceRows.[date] IS NOT NULL
          AND (
            balanceRows.[date] < statementRows.[date]
            OR (
              balanceRows.[date] = statementRows.[date]
              AND (
                balanceRows.sortOrder < statementRows.sortOrder
                OR (
                  balanceRows.sortOrder = statementRows.sortOrder
                  AND balanceRows.refNo <= statementRows.refNo
                )
              )
            )
          )
      ) AS runningBalance
    FROM (
      ${statementRowsQuery}
    ) statementRows
    WHERE statementRows.[date] IS NOT NULL
    ORDER BY statementRows.[date] DESC, statementRows.sortOrder DESC, statementRows.refNo DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

const itemJoins = `
  LEFT JOIN (
    SELECT Item_No, MIN(Trade_Name) AS Trade_Name
    FROM dbo.The_Trade
    GROUP BY Item_No
  ) tradeName ON tradeName.Item_No = i.Item_No
  LEFT JOIN (
    SELECT Item_No, MIN(Barcode) AS Barcode
    FROM dbo.The_Barcode
    GROUP BY Item_No
  ) barcode ON barcode.Item_No = i.Item_No
  LEFT JOIN (
    SELECT
      Item_No,
      COALESCE(
        MAX(CASE WHEN Default_Unit = 1 THEN Unit_Type ELSE NULL END),
        MIN(Unit_Type)
      ) AS Unit_Type
    FROM dbo.The_Units
    GROUP BY Item_No
  ) unitInfo ON unitInfo.Item_No = i.Item_No
  LEFT JOIN (
    SELECT
      Item_No,
      SUM(ISNULL(Item_Quantity, 0) - ISNULL(Item_Reserved, 0)) AS availableQuantity,
      MAX(Item_Cost) AS cost
    FROM dbo.The_ItemDetails
    GROUP BY Item_No
  ) stock ON stock.Item_No = i.Item_No
  LEFT JOIN (
    SELECT
      idt.Item_No,
      MAX(c.Charge_Value) AS Charge_Value
    FROM dbo.The_ItemDetails idt
    LEFT JOIN dbo.the_Charge c ON c.ItemDetails_No = idt.ItemDetails_No
    GROUP BY idt.Item_No
  ) price ON price.Item_No = i.Item_No
`;

export async function getInventory({ search }) {
  const term = searchText(search);
  const query = `
    SELECT
      i.Item_No AS id,
      CONVERT(NVARCHAR(50), i.Item_No) AS code,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      ISNULL(stock.availableQuantity, 0) AS availableQuantity,
      unitInfo.Unit_Type AS unit,
      stock.cost AS cost,
      price.Charge_Value AS sellingPrice
    FROM dbo.The_Items i
    ${itemJoins}
    WHERE (
      @search = N''
      OR CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
      OR CONVERT(NVARCHAR(50), i.Item_No) LIKE @searchLike
    )
    ORDER BY COALESCE(tradeName.Trade_Name, i.Scientific_Name) ASC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindSearch(request, term));
  return result.recordset || [];
}

export async function getShortages() {
  const query = `
    SELECT TOP (200)
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      ISNULL(stock.availableQuantity, 0) AS currentQuantity,
      ISNULL(i.Out_quantitative, 0) AS minimumQuantity,
      ISNULL(i.Out_quantitative, 0) - ISNULL(stock.availableQuantity, 0) AS missingQuantity
    FROM dbo.The_Items i
    LEFT JOIN (
      SELECT Item_No, MIN(Trade_Name) AS Trade_Name
      FROM dbo.The_Trade
      GROUP BY Item_No
    ) tradeName ON tradeName.Item_No = i.Item_No
    LEFT JOIN (
      SELECT
        Item_No,
        SUM(ISNULL(Item_Quantity, 0) - ISNULL(Item_Reserved, 0)) AS availableQuantity
      FROM dbo.The_ItemDetails
      GROUP BY Item_No
    ) stock ON stock.Item_No = i.Item_No
    WHERE ISNULL(i.Out_quantitative, 0) > 0
      AND ISNULL(stock.availableQuantity, 0) < ISNULL(i.Out_quantitative, 0)
    ORDER BY missingQuantity DESC, COALESCE(tradeName.Trade_Name, i.Scientific_Name) ASC
  `;

  const result = await executeReadonlyQuery(query);
  return result.recordset || [];
}

export async function getExpiry({ days }) {
  const safeDays = parseDays(days);
  const query = `
    SELECT TOP (200)
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      CONVERT(NVARCHAR(50), idt.ItemDetails_No) AS batch,
      idt.Exp_date AS expiryDate,
      ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0) AS quantity
    FROM dbo.The_ItemDetails idt
    INNER JOIN dbo.The_Items i ON i.Item_No = idt.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = i.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    WHERE idt.Exp_date >= CAST(GETDATE() AS DATE)
      AND idt.Exp_date < DATEADD(DAY, @days + 1, CAST(GETDATE() AS DATE))
      AND ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0) > 0
    ORDER BY idt.Exp_date ASC, COALESCE(tradeName.Trade_Name, i.Scientific_Name) ASC
  `;

  const result = await executeReadonlyQuery(query, (request) => {
    request.input('days', sql.Int, safeDays);
  });

  return {
    days: safeDays,
    rows: result.recordset || []
  };
}

export async function getSalesToday({ date } = {}) {
  const selectedDate = parseSelectedDate(date);
  const cashboxDateFilter = selectedDateFilter('ov.Date_paid', selectedDate);
  const invoiceDateFilter = selectedDateFilter('mr.Movementrestrictions_Date', selectedDate);

  const summaryQuery = `
    SELECT
      ISNULL(SUM(
        CASE
          WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0)
          WHEN mr.Account_No IN (3, 4) THEN -ISNULL(invoiceTotals.total, 0)
          ELSE 0
        END
      ), 0) AS totalSales,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN 1 ELSE 0 END) AS invoiceCount,
      SUM(CASE WHEN mr.Account_No IN (3, 4) THEN 1 ELSE 0 END) AS returnCount,
      CASE
        WHEN SUM(CASE WHEN mr.Account_No IN (1, 2) THEN 1 ELSE 0 END) = 0 THEN 0
        ELSE
          SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0) ELSE 0 END)
          / SUM(CASE WHEN mr.Account_No IN (1, 2) THEN 1 ELSE 0 END)
      END AS averageInvoice
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
    WHERE ${invoiceDateFilter}
      AND ISNULL(mr.Case_Invoice, 0) = 0
      AND mr.Account_No IN (1, 2, 3, 4)
  `;

  const sellerCashboxesQuery = `
    SELECT
      ov.User_No AS sellerId,
      p.Person_Name AS sellerName,
      SUM(
        CASE
          WHEN ISNULL(acc.Account_kind, 0) < 0 AND ISNULL(ov.Value_paid, 0) > 0 THEN -ISNULL(ov.Value_paid, 0)
          ELSE ISNULL(ov.Value_paid, 0)
        END
      ) AS total,
      COUNT(ov.Outstandingvalues_No) AS entryCount
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    LEFT JOIN dbo.The_Persons p ON p.Person_No = ov.User_No
    WHERE ${cashboxDateFilter}
      AND ov.Account_No IN (1, 2, 3, 4)
    GROUP BY ov.User_No, p.Person_Name
    ORDER BY total DESC, sellerName ASC
  `;

  const productsQuery = `
    SELECT TOP (8)
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      SUM(
        CASE
          WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Item_Quntity, 0)
          WHEN mr.Account_No IN (3, 4) THEN -ISNULL(d.Item_Quntity, 0)
          ELSE 0
        END
      ) AS quantity,
      SUM(
        CASE
          WHEN mr.Account_No IN (1, 2) THEN
            ISNULL(d.Charge_Value, 0)
            / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
            * ISNULL(d.Item_Quntity, 0)
          WHEN mr.Account_No IN (3, 4) THEN
            -(
              ISNULL(d.Charge_Value, 0)
              / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
              * ISNULL(d.Item_Quntity, 0)
            )
          ELSE 0
        END
      ) AS total
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    INNER JOIN dbo.The_Items i ON i.Item_No = d.Item_No
    LEFT JOIN (
      SELECT
        Item_No,
        MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
      FROM dbo.The_Units
      GROUP BY Item_No
    ) unitInfo ON unitInfo.Item_No = d.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = i.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    WHERE ${invoiceDateFilter}
      AND ISNULL(mr.Case_Invoice, 0) = 0
      AND mr.Account_No IN (1, 2, 3, 4)
    GROUP BY COALESCE(tradeName.Trade_Name, i.Scientific_Name)
    ORDER BY quantity DESC
  `;

  const bindDate = (request) => bindSelectedDate(request, selectedDate);
  const [summary, sellerCashboxes, topProducts] = await Promise.all([
    executeReadonlyQuery(summaryQuery, bindDate),
    executeReadonlyQuery(sellerCashboxesQuery, bindDate),
    executeReadonlyQuery(productsQuery, bindDate)
  ]);
  const cashboxRows = sellerCashboxes.recordset || [];

  return {
    selectedDate: formatDateInputValue(selectedDate),
    summary: summary.recordset?.[0] || { totalSales: 0, invoiceCount: 0, returnCount: 0, averageInvoice: 0 },
    cashboxSummary: {
      totalCashbox: cashboxRows.reduce((total, row) => total + Number(row.total || 0), 0),
      sellerCount: cashboxRows.length,
      entryCount: cashboxRows.reduce((total, row) => total + Number(row.entryCount || 0), 0)
    },
    sellerCashboxes: cashboxRows,
    topSoldProducts: topProducts.recordset || []
  };
}

export async function getTradingProfit({ dateFrom, dateTo } = {}) {
  const fromDate = parseSelectedDate(dateFrom) || parseSelectedDate(formatDateInputValue(new Date()));
  const toDate = parseSelectedDate(dateTo) || fromDate;

  const query = `
    SELECT
      ISNULL(sales.revenue, 0) AS revenue,
      ISNULL(sales.costOfGoods, 0) AS costOfGoods,
      ISNULL(sales.grossProfit, 0) AS grossProfit,
      ISNULL(supplierPayments.total, 0) AS supplierPayments,
      ISNULL(expenses.total, 0) AS expenses,
      ISNULL(sales.grossProfit, 0) - ISNULL(expenses.total, 0) AS netProfit
    FROM (
      SELECT
        SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) ELSE -ISNULL(d.Charge_Value, 0) END) AS revenue,
        SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0) ELSE -(ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)) END) AS costOfGoods,
        SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) - (ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)) ELSE -(ISNULL(d.Charge_Value, 0) - (ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0))) END) AS grossProfit
      FROM dbo.The_Movementrestrictions mr
      INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
      WHERE mr.Movementrestrictions_Date >= CONVERT(DATETIME, @dateFrom, 120)
        AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
        AND ISNULL(mr.Case_Invoice, 0) = 0
        AND mr.Account_No IN (1, 2, 3, 4)
    ) sales
    CROSS JOIN (
      SELECT SUM(ABS(ISNULL(ov.Value_paid, 0))) AS total
      FROM dbo.The_Outstandingvalues ov
      INNER JOIN dbo.The_Persons p ON p.Person_No = ov.Person_No
      WHERE ov.Date_paid >= CONVERT(DATETIME, @dateFrom, 120)
        AND ov.Date_paid < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
        AND p.Person_Kind = 3
        AND ov.Account_No IN (${purchaseAccountNumbers})
    ) supplierPayments
    CROSS JOIN (
      SELECT SUM(ABS(ISNULL(ov.Value_paid, 0))) AS total
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Date_paid >= CONVERT(DATETIME, @dateFrom, 120)
        AND ov.Date_paid < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
        AND ov.Account_No = 11
    ) expenses
  `;

  const movementsQuery = `
    SELECT TOP (80)
      movementRows.[date],
      movementRows.kind,
      movementRows.description,
      movementRows.amount
    FROM (
      SELECT mr.Movementrestrictions_Date AS [date], N'إيراد' AS kind,
        ISNULL(acc.Account_Name, N'مبيعات') AS description,
        SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) ELSE -ISNULL(d.Charge_Value, 0) END) AS amount
      FROM dbo.The_Movementrestrictions mr
      INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
      LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
      WHERE mr.Movementrestrictions_Date >= CONVERT(DATETIME, @dateFrom, 120)
        AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
        AND ISNULL(mr.Case_Invoice, 0) = 0
        AND mr.Account_No IN (1, 2, 3, 4)
      GROUP BY mr.Movementrestrictions_Date, acc.Account_Name
      UNION ALL
      SELECT ov.Date_paid AS [date], N'سداد مورد' AS kind,
        ISNULL(p.Person_Name, N'مورد') AS description,
        ABS(ISNULL(ov.Value_paid, 0)) AS amount
      FROM dbo.The_Outstandingvalues ov
      INNER JOIN dbo.The_Persons p ON p.Person_No = ov.Person_No
      WHERE ov.Date_paid >= CONVERT(DATETIME, @dateFrom, 120)
        AND ov.Date_paid < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
        AND p.Person_Kind = 3
        AND ov.Account_No IN (${purchaseAccountNumbers})
      UNION ALL
      SELECT ov.Date_paid AS [date], N'مصروف' AS kind,
        ISNULL(ov.Comment, N'مصروفات عامة') AS description,
        ABS(ISNULL(ov.Value_paid, 0)) AS amount
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Date_paid >= CONVERT(DATETIME, @dateFrom, 120)
        AND ov.Date_paid < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
        AND ov.Account_No = 11
    ) movementRows
    ORDER BY movementRows.[date] DESC
  `;

  const bindDates = (request) => {
    request.input('dateFrom', sql.NVarChar, formatDateInputValue(fromDate));
    request.input('dateTo', sql.NVarChar, formatDateInputValue(toDate));
  };

  const [summaryResult, movementsResult] = await Promise.all([
    executeReadonlyQuery(query, bindDates),
    executeReadonlyQuery(movementsQuery, bindDates)
  ]);

  return {
    dateFrom: formatDateInputValue(fromDate),
    dateTo: formatDateInputValue(toDate),
    summary: summaryResult.recordset?.[0] || {},
    movements: movementsResult.recordset || []
  };
}

export async function getRevenueDetails(filters = {}) {
  const selectedDate = parseSelectedDate(filters.date);
  const revenueFrom = revenueRowsFrom(selectedDate, filters);
  const bindFilters = (request) => {
    bindSelectedDate(request, selectedDate);
    bindOptionalRevenueFilters(request, filters);
  };

  const rowsQuery = `
    SELECT TOP (1500)
      movementNo,
      invoiceNo,
      movementDate,
      movementType,
      customerName,
      sellerId,
      sellerName,
      paymentMethod,
      amount,
      period,
      notes,
      revenueSource,
      accountNo,
      accountName,
      documentNo,
      documentKind,
      documentSide
    ${revenueFrom}
    ORDER BY movementDate DESC, movementNo DESC
  `;

  const summaryQuery = `
    SELECT
      ISNULL(SUM(CASE WHEN revenueSource = N'مبيعات نقدية' THEN amount ELSE 0 END), 0) AS cashSalesTotal,
      ISNULL(SUM(CASE WHEN revenueSource = N'سداد مدينين' THEN amount ELSE 0 END), 0) AS debtorPaymentsTotal,
      ABS(ISNULL(SUM(CASE WHEN revenueSource = N'مردودات' THEN amount ELSE 0 END), 0)) AS returnsTotal,
      ISNULL(SUM(CASE WHEN revenueSource NOT IN (N'مبيعات نقدية', N'سداد مدينين', N'مردودات') THEN amount ELSE 0 END), 0) AS electronicPaymentsTotal,
      ISNULL(SUM(amount), 0) AS netRevenue,
      COUNT(*) AS movementCount
    ${revenueFrom}
  `;

  const sourcesQuery = `
    SELECT
      revenueSource AS sourceName,
      ISNULL(SUM(amount), 0) AS total,
      COUNT(*) AS movementCount
    ${revenueFrom}
    GROUP BY revenueSource
    ORDER BY
      CASE
        WHEN revenueSource = N'مبيعات نقدية' THEN 1
        WHEN revenueSource = N'سداد مدينين' THEN 2
        WHEN revenueSource = N'مردودات' THEN 99
        ELSE 10
      END,
      revenueSource
  `;

  const sellerTotalsQuery = `
    SELECT
      sellerId,
      sellerName,
      ISNULL(SUM(amount), 0) AS total,
      COUNT(*) AS movementCount
    ${revenueFrom}
    GROUP BY sellerId, sellerName
    ORDER BY total DESC, sellerName ASC
  `;

  const filterOptionsQuery = `
    SELECT 'seller' AS optionType, CONVERT(NVARCHAR(50), sellerId) AS optionValue, sellerName AS optionLabel
    ${revenueRowsFrom(selectedDate, {})}
    GROUP BY sellerId, sellerName
    UNION ALL
    SELECT 'period' AS optionType, period AS optionValue, period AS optionLabel
    ${revenueRowsFrom(selectedDate, {})}
    GROUP BY period
    UNION ALL
    SELECT 'paymentMethod' AS optionType, paymentMethod AS optionValue, paymentMethod AS optionLabel
    ${revenueRowsFrom(selectedDate, {})}
    GROUP BY paymentMethod
    UNION ALL
    SELECT 'movementType' AS optionType, movementType AS optionValue, movementType AS optionLabel
    ${revenueRowsFrom(selectedDate, {})}
    GROUP BY movementType
    ORDER BY optionType, optionLabel
  `;

  const [rowsResult, summaryResult, sourcesResult, sellerTotalsResult, filterOptionsResult] = await Promise.all([
    executeReadonlyQuery(rowsQuery, bindFilters),
    executeReadonlyQuery(summaryQuery, bindFilters),
    executeReadonlyQuery(sourcesQuery, bindFilters),
    executeReadonlyQuery(sellerTotalsQuery, bindFilters),
    executeReadonlyQuery(filterOptionsQuery, (request) => bindSelectedDate(request, selectedDate))
  ]);

  const summary = summaryResult.recordset?.[0] || {
    cashSalesTotal: 0,
    debtorPaymentsTotal: 0,
    returnsTotal: 0,
    electronicPaymentsTotal: 0,
    netRevenue: 0,
    movementCount: 0
  };

  const expectedTotal = filters.expectedTotal === undefined || filters.expectedTotal === null || filters.expectedTotal === ''
    ? null
    : Number(filters.expectedTotal);
  const difference = Number.isFinite(expectedTotal) ? Number(summary.netRevenue || 0) - expectedTotal : 0;

  return {
    selectedDate: formatDateInputValue(selectedDate),
    filters: {
      sellerId: filters.sellerId || '',
      period: filters.period || '',
      paymentMethod: filters.paymentMethod || '',
      movementType: filters.movementType || ''
    },
    summary: {
      ...summary,
      expectedTotal,
      difference
    },
    sources: sourcesResult.recordset || [],
    sellerTotals: sellerTotalsResult.recordset || [],
    filterOptions: filterOptionsResult.recordset || [],
    rows: rowsResult.recordset || []
  };
}

export async function getRevenueDiagnostics(filters = {}) {
  const selectedDate = parseSelectedDate(filters.date);
  const dateFilter = revenueDateFilter(selectedDate);
  const query = `
    SELECT
      COUNT(1) AS totalRecords,
      SUM(CASE WHEN CONVERT(CHAR(8), ov.Date_paid, 108) <> '00:00:00' THEN 1 ELSE 0 END) AS datePaidRealTime,
      SUM(CASE WHEN ov.Date_paid IS NOT NULL AND CONVERT(CHAR(8), ov.Date_paid, 108) = '00:00:00' THEN 1 ELSE 0 END) AS datePaidDateOnly,
      SUM(CASE WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN 1 ELSE 0 END) AS outstandingItemAddRealTime,
      SUM(CASE WHEN ov.Item_Add IS NOT NULL AND CONVERT(CHAR(8), ov.Item_Add, 108) = '00:00:00' THEN 1 ELSE 0 END) AS outstandingItemAddDateOnly,
      SUM(CASE WHEN CONVERT(CHAR(8), mr.Movementrestrictions_Date, 108) <> '00:00:00' THEN 1 ELSE 0 END) AS movementDateRealTime,
      SUM(CASE WHEN mr.Movementrestrictions_Date IS NOT NULL AND CONVERT(CHAR(8), mr.Movementrestrictions_Date, 108) = '00:00:00' THEN 1 ELSE 0 END) AS movementDateDateOnly,
      SUM(CASE WHEN CONVERT(CHAR(8), mr.Item_Add, 108) <> '00:00:00' THEN 1 ELSE 0 END) AS movementItemAddRealTime,
      SUM(CASE WHEN mr.Item_Add IS NOT NULL AND CONVERT(CHAR(8), mr.Item_Add, 108) = '00:00:00' THEN 1 ELSE 0 END) AS movementItemAddDateOnly
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = ov.Movementrestrictions_No
    WHERE ${dateFilter}
      AND ov.Account_No IN (1, 2, 3, 4)
  `;

  const result = await executeReadonlyQuery(query, (request) => bindSelectedDate(request, selectedDate));
  const row = result.recordset?.[0] || {};
  const outstandingRealTime = Number(row.outstandingItemAddRealTime || 0);
  const movementRealTime = Number(row.movementItemAddRealTime || 0);

  return {
    selectedDate: formatDateInputValue(selectedDate),
    sourceFieldUsedForDatetime: outstandingRealTime > 0
      ? 'The_Outstandingvalues.Item_Add'
      : 'The_Outstandingvalues.Date_paid',
    invoiceDatetimeSource: movementRealTime > 0
      ? 'The_Movementrestrictions.Item_Add'
      : 'The_Movementrestrictions.Movementrestrictions_Date',
    businessDateField: 'The_Outstandingvalues.Date_paid',
    diagnostics: {
      totalRecords: Number(row.totalRecords || 0),
      datePaidRealTime: Number(row.datePaidRealTime || 0),
      datePaidDateOnly: Number(row.datePaidDateOnly || 0),
      outstandingItemAddRealTime,
      outstandingItemAddDateOnly: Number(row.outstandingItemAddDateOnly || 0),
      movementDateRealTime: Number(row.movementDateRealTime || 0),
      movementDateDateOnly: Number(row.movementDateDateOnly || 0),
      movementItemAddRealTime: movementRealTime,
      movementItemAddDateOnly: Number(row.movementItemAddDateOnly || 0)
    }
  };
}

export async function getRevenueMovementDetails(movementNo) {
  const queryHeader = `
    SELECT TOP (1)
      ov.Outstandingvalues_No AS movementNo,
      ov.Movementrestrictions_No AS invoiceNo,
      ov.Date_paid AS movementDate,
      ov.Item_Add AS movementCreatedAt,
      CASE
        WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN 1
        ELSE 0
      END AS movementHasRealTime,
      CASE
        WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN N'The_Outstandingvalues.Item_Add'
        ELSE N'The_Outstandingvalues.Date_paid'
      END AS movementDateTimeSource,
      ov.Value_paid AS amount,
      ov.Type_Payment AS paymentMethod,
      ov.Account_No AS accountNo,
      acc.Account_Name AS accountName,
      ov.Person_No AS customerId,
      customer.Person_Name AS customerName,
      ov.User_No AS sellerId,
      seller.Person_Name AS sellerName,
      ov.Doc_No AS documentNo,
      ov.Doc_Kind AS documentKind,
      ov.Doc_Side AS documentSide,
      ov.Comment AS notes,
      mr.Movementrestrictions_Date AS invoiceDate,
      mr.Item_Add AS invoiceCreatedAt,
      CASE
        WHEN CONVERT(CHAR(8), mr.Item_Add, 108) <> '00:00:00' THEN 1
        ELSE 0
      END AS invoiceHasRealTime,
      CASE
        WHEN CONVERT(CHAR(8), mr.Item_Add, 108) <> '00:00:00' THEN N'The_Movementrestrictions.Item_Add'
        ELSE N'The_Movementrestrictions.Movementrestrictions_Date'
      END AS invoiceDateTimeSource,
      mr.Invoice_Details AS invoiceDetails,
      mr.Case_Invoice AS caseInvoice
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    LEFT JOIN dbo.The_Persons customer ON customer.Person_No = ov.Person_No
    LEFT JOIN dbo.The_Persons seller ON seller.Person_No = ov.User_No
    LEFT JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = ov.Movementrestrictions_No
    WHERE ov.Outstandingvalues_No = @id
  `;

  const headerResult = await executeReadonlyQuery(queryHeader, (request) => bindId(request, movementNo));
  const header = headerResult.recordset?.[0] || null;

  if (!header?.invoiceNo) {
    return { movement: header, invoiceLines: [], linkedPayments: [] };
  }

  const queryLines = `
    SELECT TOP (500)
      d.Details_No AS detailNo,
      d.Item_No AS itemNo,
      COALESCE(tradeName.Trade_Name, item.Scientific_Name) AS itemName,
      d.Barcode AS barcode,
      d.Item_Quntity AS quantity,
      unitInfo.Unit_Type AS unit,
      d.Charge_Value AS chargeValue,
      d.Item_Cost AS itemCost,
      d.Exp_date AS expiryDate,
      d.Comment AS notes
    FROM dbo.The_Details d
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = d.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    OUTER APPLY (
      SELECT TOP (1) u.Unit_Type
      FROM dbo.The_Units u
      WHERE u.Item_No = d.Item_No
      ORDER BY CASE WHEN u.Default_Unit = 1 THEN 0 ELSE 1 END, u.Unit_No ASC
    ) unitInfo
    WHERE d.Movementrestrictions_No = @invoiceNo
    ORDER BY d.Details_No ASC
  `;

  const queryPayments = `
    SELECT TOP (200)
      ov.Outstandingvalues_No AS movementNo,
      ov.Date_paid AS movementDate,
      ov.Item_Add AS movementCreatedAt,
      CASE
        WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN 1
        ELSE 0
      END AS movementHasRealTime,
      CASE
        WHEN CONVERT(CHAR(8), ov.Item_Add, 108) <> '00:00:00' THEN N'The_Outstandingvalues.Item_Add'
        ELSE N'The_Outstandingvalues.Date_paid'
      END AS movementDateTimeSource,
      ov.Value_paid AS amount,
      ov.Type_Payment AS paymentMethod,
      ov.Account_No AS accountNo,
      acc.Account_Name AS accountName,
      seller.Person_Name AS sellerName,
      ov.Comment AS notes
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    LEFT JOIN dbo.The_Persons seller ON seller.Person_No = ov.User_No
    WHERE ov.Movementrestrictions_No = @invoiceNo
    ORDER BY ov.Date_paid DESC, ov.Outstandingvalues_No DESC
  `;

  const bindInvoice = (request) => request.input('invoiceNo', sql.Int, Number(header.invoiceNo));
  const [linesResult, paymentsResult] = await Promise.all([
    executeReadonlyQuery(queryLines, bindInvoice),
    executeReadonlyQuery(queryPayments, bindInvoice)
  ]);

  return {
    movement: header,
    invoiceLines: linesResult.recordset || [],
    linkedPayments: paymentsResult.recordset || []
  };
}
