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
        filter: 'Person_Kind = 3',
        balance:
          'Signed supplier movement total from dbo.The_Movementrestrictions/dbo.The_Details using dbo.The_Account.Account_kind, minus signed payments from dbo.The_Outstandingvalues by Person_No.'
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

function parseDateRange(filters = {}) {
  const fromDate = parseSelectedDate(filters.dateFrom || filters.startDate || filters.date)
    || parseSelectedDate(formatDateInputValue(new Date()));
  const toDate = parseSelectedDate(filters.dateTo || filters.endDate) || fromDate;
  if (toDate.getTime() < fromDate.getTime()) {
    throw badRequest('Invalid date range. dateTo must be greater than or equal to dateFrom.');
  }

  return { fromDate, toDate };
}

function bindDateRange(request, dateRange) {
  request.input('dateFrom', sql.NVarChar, formatDateInputValue(dateRange.fromDate));
  request.input('dateTo', sql.NVarChar, formatDateInputValue(dateRange.toDate));
}

function dateRangeFilter(columnName, dateRange) {
  return `${columnName} >= CONVERT(DATETIME, @dateFrom, 120) AND ${columnName} < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))`;
}

function parsePage(value) {
  const page = Number(value || 1);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), 100000);
}

function parsePageSize(value) {
  const pageSize = Number(value || 50);
  if (!Number.isFinite(pageSize)) return 50;
  return Math.min(Math.max(Math.trunc(pageSize), 10), 200);
}

function bindReportFilters(request, filters = {}) {
  bindDateRange(request, parseDateRange(filters));
  bindSearch(request, searchText(filters.search));
  const page = parsePage(filters.page);
  const pageSize = parsePageSize(filters.pageSize);
  request.input('rowStart', sql.Int, (page - 1) * pageSize + 1);
  request.input('rowEnd', sql.Int, page * pageSize);
}

function reportPaging(filters = {}) {
  const page = parsePage(filters.page);
  const pageSize = parsePageSize(filters.pageSize);
  return { page, pageSize };
}

function revenueDateFilter(dateRange) {
  if (dateRange instanceof Date || !dateRange?.fromDate) {
    return selectedDateFilter('ov.Date_paid', dateRange);
  }

  return dateRangeFilter('ov.Date_paid', dateRange);
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

function revenueRowsSubquery(dateRange) {
  const dateFilter = revenueDateFilter(dateRange);

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

function revenueRowsFrom(dateRange, filters = {}) {
  return `
    FROM (
      ${revenueRowsSubquery(dateRange)}
    ) revenueRows
    WHERE 1 = 1
    ${revenueOptionalWhere(filters)}
  `;
}

const purchaseAccountNumbers = '7, 8, 11, 12, 24';
const outstandingPaymentRootExpression = `
  CASE
    WHEN ov.Doc_Kind IS NOT NULL
      AND LTRIM(RTRIM(ov.Doc_Kind)) <> N''
      AND LTRIM(RTRIM(ov.Doc_Kind)) <> N'0'
      AND LTRIM(RTRIM(ov.Doc_Kind)) NOT LIKE N'%[^0-9]%'
    THEN CONVERT(INT, LTRIM(RTRIM(ov.Doc_Kind)))
    ELSE ov.Outstandingvalues_No
  END
`;

function parseBooleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseOptionalStatementDateRange(options = {}) {
  const fromDate = parseSelectedDate(options.dateFrom || options.startDate || options.from);
  const toDate = parseSelectedDate(options.dateTo || options.endDate || options.to) || fromDate;
  if (fromDate && toDate && toDate.getTime() < fromDate.getTime()) {
    throw badRequest('Invalid date range. dateTo must be greater than or equal to dateFrom.');
  }
  return fromDate ? { fromDate, toDate } : null;
}

function statementDateFilter(columnName, dateRange) {
  if (!dateRange) return '';
  return `AND ${dateRangeFilter(columnName, dateRange)}`;
}

function bindStatementOptions(request, id, options = {}) {
  bindId(request, id);
  const dateRange = parseOptionalStatementDateRange(options);
  if (dateRange) bindDateRange(request, dateRange);
}

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

const supplierInvoiceTotalApply = `
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
        MAX(Unit_OldQuantity) AS Unit_OldQuantity
      FROM dbo.The_Units
      GROUP BY Item_No
    ) unitInfo ON unitInfo.Item_No = d.Item_No
    WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
  ) invoiceTotals
`;

const supplierBalanceApply = `
  OUTER APPLY (
    SELECT
      SUM(ISNULL(invoiceTotals.total, 0) * ISNULL(acc.Account_kind, 1)) AS total,
      MAX(mr.Movementrestrictions_Date) AS lastDate
    FROM dbo.The_Movementrestrictions mr
    INNER JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    ${supplierInvoiceTotalApply}
    WHERE mr.Person_No = supplierRows.id
      AND mr.Account_No IN (${purchaseAccountNumbers})
  ) supplierMovements
  OUTER APPLY (
    SELECT
      SUM(ISNULL(ov.Value_paid, 0)) AS total,
      MAX(ov.Date_paid) AS lastDate,
      CAST(NULL AS money) AS lastAmount
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = supplierRows.id
  ) supplierPayments
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
    SELECT TOP (200)
      supplierRows.id,
      supplierRows.name,
      supplierRows.phone,
      supplierRows.address,
      ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) AS currentBalance,
      CASE
        WHEN ISNULL(supplierMovements.lastDate, '19000101') >= ISNULL(supplierPayments.lastDate, '19000101') THEN supplierMovements.lastDate
        ELSE supplierPayments.lastDate
      END AS lastTransactionDate,
      supplierPayments.lastAmount AS lastTransactionAmount
    FROM (
      SELECT
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
      ) supplierRows
    ${supplierBalanceApply}
    ORDER BY
      CASE WHEN ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) = 0 THEN 1 ELSE 0 END ASC,
      ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) ASC,
      supplierRows.name ASC
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
    ${supplierInvoiceTotalApply}
    OUTER APPLY (
      SELECT SUM(ABS(ISNULL(ov.Value_paid, 0))) AS paid
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Movementrestrictions_No = mr.Movementrestrictions_No
        AND ov.Account_No IN (${purchaseAccountNumbers})
    ) payments
    WHERE mr.Person_No = @id
      AND mr.Account_No IN (${purchaseAccountNumbers})
    ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getSupplierPayments(id) {
  const query = `
    SELECT TOP (150)
      N'P-' + CONVERT(NVARCHAR(30), MIN(paymentRows.Outstandingvalues_No)) AS paymentNumber,
      MIN(paymentRows.Date_paid) AS [date],
      ABS(SUM(ISNULL(paymentRows.Value_paid, 0))) AS amount,
      ISNULL(MAX(NULLIF(paymentRows.Type_Payment, N'')), N'غير محدد') AS paymentMethod,
      MAX(paymentRows.Movementrestrictions_No) AS invoiceNumber,
      ISNULL(MAX(NULLIF(paymentRows.Comment, N'')), N'') AS notes
    FROM (
      SELECT
        ov.Outstandingvalues_No,
        ov.Movementrestrictions_No,
        ov.Value_paid,
        ov.Date_paid,
        ov.Type_Payment,
        ov.Comment,
        ov.Person_No,
        ov.Account_No,
        ov.User_No,
        ov.Item_Add,
        ov.CashBook_No,
        ov.Computer_Name
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = @id
        AND ov.Account_No IN (${purchaseAccountNumbers})
    ) paymentRows
    GROUP BY
      paymentRows.Person_No,
      paymentRows.Account_No,
      paymentRows.Date_paid,
      ISNULL(paymentRows.Type_Payment, N''),
      paymentRows.User_No,
      paymentRows.Item_Add,
      paymentRows.CashBook_No,
      ISNULL(paymentRows.Computer_Name, N''),
      ISNULL(paymentRows.Comment, N'')
    ORDER BY MIN(paymentRows.Date_paid) DESC, MIN(paymentRows.Outstandingvalues_No) DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getSupplierStatement(id, options = {}) {
  const showArchived = parseBooleanOption(options.showArchived, false);
  const dateRange = parseOptionalStatementDateRange(options);
  const invoiceArchiveFilter = showArchived ? '' : 'AND ISNULL(mr.Case_Invoice, 0) = 0';
  const invoiceDateFilter = statementDateFilter('mr.Movementrestrictions_Date', dateRange);
  const paymentDateFilter = statementDateFilter('ov.Date_paid', dateRange);
  const paymentArchiveFilter = showArchived ? '' : 'AND (linkedInvoice.Movementrestrictions_No IS NULL OR ISNULL(linkedInvoice.Case_Invoice, 0) = 0)';
  const statementRowsQuery = `
    SELECT
      mr.Movementrestrictions_Date AS [date],
      N'فاتورة شراء رقم ' + CONVERT(NVARCHAR(30), mr.Movementrestrictions_No) AS description,
      CASE WHEN ISNULL(invoiceTotals.total, 0) * ISNULL(acc.Account_kind, 1) > 0 THEN ISNULL(invoiceTotals.total, 0) * ISNULL(acc.Account_kind, 1) ELSE 0 END AS debit,
      CASE WHEN ISNULL(invoiceTotals.total, 0) * ISNULL(acc.Account_kind, 1) < 0 THEN ABS(ISNULL(invoiceTotals.total, 0) * ISNULL(acc.Account_kind, 1)) ELSE 0 END AS credit,
      ISNULL(invoiceTotals.total, 0) * ISNULL(acc.Account_kind, 1) AS balanceAmount,
      CAST(1 AS int) AS sortOrder,
      mr.Movementrestrictions_No AS refNo,
      N'purchase-invoice' AS rowType
    FROM dbo.The_Movementrestrictions mr
    INNER JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    ${supplierInvoiceTotalApply}
    WHERE mr.Person_No = @id
      AND mr.Account_No IN (${purchaseAccountNumbers})
      ${invoiceArchiveFilter}
      ${invoiceDateFilter}
    UNION ALL
    SELECT
      paymentRows.[date],
      N'سداد مورد رقم ' + CONVERT(NVARCHAR(30), paymentRows.paymentRootNo) AS description,
      paymentRows.amount AS debit,
      CAST(0 AS money) AS credit,
      paymentRows.balanceAmount,
      CAST(2 AS int) AS sortOrder,
      paymentRows.paymentRootNo AS refNo,
      N'payment' AS rowType
    FROM (
      SELECT
        MIN(grouped.Outstandingvalues_No) AS paymentRootNo,
        MIN(grouped.Date_paid) AS [date],
        ABS(SUM(ISNULL(grouped.Value_paid, 0))) AS amount,
        -SUM(ISNULL(grouped.Value_paid, 0)) AS balanceAmount
      FROM (
        SELECT
          ov.Outstandingvalues_No,
          ov.Value_paid,
          ov.Date_paid,
          ov.Person_No,
          ov.Account_No,
          ov.User_No,
          ov.Type_Payment,
          ov.Item_Add,
          ov.CashBook_No,
          ov.Computer_Name,
          ov.Comment
        FROM dbo.The_Outstandingvalues ov
        LEFT JOIN dbo.The_Movementrestrictions linkedInvoice ON linkedInvoice.Movementrestrictions_No = ov.Movementrestrictions_No
        WHERE ov.Person_No = @id
          ${paymentArchiveFilter}
          ${paymentDateFilter}
      ) grouped
      GROUP BY
        grouped.Person_No,
        grouped.Account_No,
        grouped.Date_paid,
        ISNULL(grouped.Type_Payment, N''),
        grouped.User_No,
        grouped.Item_Add,
        grouped.CashBook_No,
        ISNULL(grouped.Computer_Name, N''),
        ISNULL(grouped.Comment, N'')
    ) paymentRows
  `;

  const query = `
    SELECT TOP (250)
      statementRows.[date],
      statementRows.description,
      statementRows.debit,
      statementRows.credit,
      statementRows.refNo,
      statementRows.rowType,
      (
        SELECT SUM(balanceRows.balanceAmount)
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

  const result = await executeReadonlyQuery(query, (request) => bindStatementOptions(request, id, options));
  return result.recordset || [];
}

export async function getSupplierDiagnostics(id) {
  const query = `
    SELECT TOP (1)
      p.Person_No AS supplierId,
      p.Person_Name AS supplierName,
      ABS(ISNULL(supplierMovements.total, 0)) AS totalPurchases,
      ABS(ISNULL(supplierPayments.total, 0)) AS totalPayments,
      ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) AS calculatedBalance,
      ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) AS balanceFromAlmohaseb,
      ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) AS balanceFromCurrentApi,
      supplierMovements.total AS signedMovementTotal,
      supplierPayments.total AS signedPaymentTotal
    FROM dbo.The_Persons p
    CROSS APPLY (
      SELECT p.Person_No AS id
    ) supplierRows
    ${supplierBalanceApply}
    WHERE p.Person_No = @id
      AND p.Person_Kind = 3
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset?.[0] || null;
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
      N'P-' + CONVERT(NVARCHAR(30), MIN(receiptRows.Outstandingvalues_No)) AS receiptNumber,
      MIN(receiptRows.Date_paid) AS [date],
      SUM(ISNULL(receiptRows.Value_paid, 0)) AS amount,
      ISNULL(MAX(NULLIF(receiptRows.Type_Payment, N'')), N'') + CASE WHEN MAX(NULLIF(receiptRows.Comment, N'')) IS NULL THEN N'' ELSE N' - ' + MAX(NULLIF(receiptRows.Comment, N'')) END AS notes
    FROM (
      SELECT
        ov.Outstandingvalues_No,
        ov.Value_paid,
        ov.Date_paid,
        ov.Type_Payment,
        ov.Comment,
        ov.Person_No,
        ov.Account_No,
        ov.User_No,
        ov.Item_Add,
        ov.CashBook_No,
        ov.Computer_Name
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = @id
    ) receiptRows
    GROUP BY
      receiptRows.Person_No,
      receiptRows.Account_No,
      receiptRows.Date_paid,
      ISNULL(receiptRows.Type_Payment, N''),
      receiptRows.User_No,
      receiptRows.Item_Add,
      receiptRows.CashBook_No,
      ISNULL(receiptRows.Computer_Name, N''),
      ISNULL(receiptRows.Comment, N'')
    ORDER BY MIN(receiptRows.Date_paid) DESC, MIN(receiptRows.Outstandingvalues_No) DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getCustomerStatement(id, options = {}) {
  const showArchived = parseBooleanOption(options.showArchived, false);
  const dateRange = parseOptionalStatementDateRange(options);
  const invoiceArchiveFilter = showArchived ? '' : 'AND ISNULL(mr.Case_Invoice, 0) = 0';
  const invoiceDateFilter = statementDateFilter('mr.Movementrestrictions_Date', dateRange);
  const paymentDateFilter = statementDateFilter('ov.Date_paid', dateRange);
  const paymentArchiveFilter = showArchived ? '' : 'AND (linkedInvoice.Movementrestrictions_No IS NULL OR ISNULL(linkedInvoice.Case_Invoice, 0) = 0)';
  const statementRowsQuery = `
    SELECT
      mr.Movementrestrictions_Date AS [date],
      N'فاتورة رقم ' + CONVERT(NVARCHAR(30), mr.Movementrestrictions_No) AS description,
      ISNULL(invoiceTotals.total, 0) AS debit,
      CAST(0 AS money) AS credit,
      CAST(1 AS int) AS sortOrder,
      mr.Movementrestrictions_No AS refNo,
      N'sales-invoice' AS rowType
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
      ${invoiceArchiveFilter}
      ${invoiceDateFilter}
    UNION ALL
    SELECT
      paymentRows.[date],
      N'دفعة رقم ' + CONVERT(NVARCHAR(30), paymentRows.paymentRootNo) AS description,
      CAST(0 AS money) AS debit,
      paymentRows.amount AS credit,
      CAST(2 AS int) AS sortOrder,
      paymentRows.paymentRootNo AS refNo,
      N'payment' AS rowType
    FROM (
      SELECT
        MIN(grouped.Outstandingvalues_No) AS paymentRootNo,
        MIN(grouped.Date_paid) AS [date],
        SUM(ISNULL(grouped.Value_paid, 0)) AS amount
      FROM (
        SELECT
          ov.Outstandingvalues_No,
          ov.Value_paid,
          ov.Date_paid,
          ov.Person_No,
          ov.Account_No,
          ov.User_No,
          ov.Type_Payment,
          ov.Item_Add,
          ov.CashBook_No,
          ov.Computer_Name,
          ov.Comment
        FROM dbo.The_Outstandingvalues ov
        LEFT JOIN dbo.The_Movementrestrictions linkedInvoice ON linkedInvoice.Movementrestrictions_No = ov.Movementrestrictions_No
        WHERE ov.Person_No = @id
          ${paymentArchiveFilter}
          ${paymentDateFilter}
      ) grouped
      GROUP BY
        grouped.Person_No,
        grouped.Account_No,
        grouped.Date_paid,
        ISNULL(grouped.Type_Payment, N''),
        grouped.User_No,
        grouped.Item_Add,
        grouped.CashBook_No,
        ISNULL(grouped.Computer_Name, N''),
        ISNULL(grouped.Comment, N'')
    ) paymentRows
  `;

  const query = `
    SELECT TOP (250)
      statementRows.[date],
      statementRows.description,
      statementRows.debit,
      statementRows.credit,
      statementRows.refNo,
      statementRows.rowType,
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

  const result = await executeReadonlyQuery(query, (request) => bindStatementOptions(request, id, options));
  return result.recordset || [];
}

async function getInvoiceDetails(movementNo, { type }) {
  const accountFilter = type === 'purchase'
    ? `mr.Account_No IN (${purchaseAccountNumbers})`
    : 'mr.Account_No IN (1, 2, 3, 4)';
  const headerQuery = `
    SELECT TOP (1)
      mr.Movementrestrictions_No AS movementNo,
      mr.Purchase_invoice AS invoiceNo,
      mr.Movementrestrictions_Date AS [date],
      mr.Person_No AS personNo,
      ISNULL(person.Person_Name, N'غير محدد') AS personName,
      mr.Account_No AS accountNo,
      ISNULL(acc.Account_Name, N'غير محدد') AS accountLabel,
      ISNULL(invoiceTotals.total, 0) AS total,
      ISNULL(mr.Invoice_Details, N'') AS notes
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    OUTER APPLY (
      SELECT SUM(
        ISNULL(d.Charge_Value, 0)
        / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
        * ISNULL(d.Item_Quntity, 0)
      ) AS total
      FROM dbo.The_Details d
      OUTER APPLY (
        SELECT TOP (1)
          COALESCE(NULLIF(barcodeUnit.Unit_OldQuantity, 0), NULLIF(defaultUnit.Unit_OldQuantity, 0), 1) AS Unit_OldQuantity
        FROM (SELECT 1 AS oneRow) seed
        LEFT JOIN dbo.The_Barcode barcodeInfo
          ON barcodeInfo.Item_No = d.Item_No
          AND CONVERT(NVARCHAR(200), barcodeInfo.Barcode) = CONVERT(NVARCHAR(200), d.Barcode)
        LEFT JOIN dbo.The_Units barcodeUnit
          ON barcodeUnit.Item_No = d.Item_No
          AND barcodeUnit.Unit_No = barcodeInfo.Unit_No
        LEFT JOIN dbo.The_Units defaultUnit
          ON defaultUnit.Item_No = d.Item_No
          AND defaultUnit.Default_Unit = 1
      ) unitInfo
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Movementrestrictions_No = @movementNo
      AND ${accountFilter}
  `;

  const itemsQuery = `
    SELECT
      d.Item_No AS itemNo,
      ISNULL(item.Scientific_Name, N'غير محدد') AS itemName,
      COALESCE(NULLIF(CONVERT(NVARCHAR(200), d.Barcode), N''), barcodeInfo.Barcode, N'') AS barcode,
      ISNULL(COALESCE(barcodeUnit.Unit_Type, defaultUnit.Unit_Type), N'') AS unitName,
      ISNULL(d.Item_Quntity, 0) AS quantity,
      ISNULL(d.Charge_Value, 0)
        / CASE
          WHEN ISNULL(COALESCE(barcodeUnit.Unit_OldQuantity, defaultUnit.Unit_OldQuantity), 0) = 0 THEN 1
          ELSE COALESCE(barcodeUnit.Unit_OldQuantity, defaultUnit.Unit_OldQuantity)
        END AS price,
      ISNULL(d.Charge_Value, 0)
        / CASE
          WHEN ISNULL(COALESCE(barcodeUnit.Unit_OldQuantity, defaultUnit.Unit_OldQuantity), 0) = 0 THEN 1
          ELSE COALESCE(barcodeUnit.Unit_OldQuantity, defaultUnit.Unit_OldQuantity)
        END
        * ISNULL(d.Item_Quntity, 0) AS total
    FROM dbo.The_Details d
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    LEFT JOIN dbo.The_Barcode barcodeInfo
      ON barcodeInfo.Item_No = d.Item_No
      AND CONVERT(NVARCHAR(200), barcodeInfo.Barcode) = CONVERT(NVARCHAR(200), d.Barcode)
    LEFT JOIN dbo.The_Units barcodeUnit
      ON barcodeUnit.Item_No = d.Item_No
      AND barcodeUnit.Unit_No = barcodeInfo.Unit_No
    LEFT JOIN dbo.The_Units defaultUnit
      ON defaultUnit.Item_No = d.Item_No
      AND defaultUnit.Default_Unit = 1
    WHERE d.Movementrestrictions_No = @movementNo
    ORDER BY d.Details_No ASC
  `;

  const bindMovement = (request) => {
    request.input('movementNo', sql.Int, Number(movementNo));
  };
  const [headerResult, itemsResult] = await Promise.all([
    executeReadonlyQuery(headerQuery, bindMovement),
    executeReadonlyQuery(itemsQuery, bindMovement)
  ]);
  const header = headerResult.recordset?.[0] || null;
  return {
    header,
    items: header ? (itemsResult.recordset || []) : []
  };
}

export async function getSalesInvoiceDetails(movementNo) {
  return getInvoiceDetails(movementNo, { type: 'sales' });
}

export async function getPurchaseInvoiceDetails(movementNo) {
  return getInvoiceDetails(movementNo, { type: 'purchase' });
}

function reportInvoiceRows({ accountFilter, fallbackTypeLabel, personKind, filters = {} }) {
  const dateRange = parseDateRange(filters);
  const paging = reportPaging(filters);
  const dateFilter = dateRangeFilter('mr.Movementrestrictions_Date', dateRange);
  const personKindFilter = personKind ? `AND ISNULL(person.Person_Kind, 0) = ${personKind}` : '';
  const fromQuery = `
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    OUTER APPLY (
      SELECT
        COUNT(1) AS itemCount,
        SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
      FROM dbo.The_Details d
      LEFT JOIN (
        SELECT Item_No, MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
        FROM dbo.The_Units
        GROUP BY Item_No
      ) unitInfo ON unitInfo.Item_No = d.Item_No
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE ${dateFilter}
      AND ISNULL(mr.Case_Invoice, 0) = 0
      AND ${accountFilter}
      ${personKindFilter}
      AND (
        @search = N''
        OR CONVERT(NVARCHAR(4000), person.Person_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), mr.Movementrestrictions_No) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), mr.Purchase_invoice) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), acc.Account_Name) LIKE @searchLike
      )
  `;
  const rowsQuery = `
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC) AS rowNo,
        mr.Movementrestrictions_Date AS [date],
        mr.Movementrestrictions_No AS movementNo,
        mr.Purchase_invoice AS invoiceNo,
        ISNULL(person.Person_Name, N'غير محدد') AS personName,
        ISNULL(acc.Account_Name, N'${fallbackTypeLabel}') AS movementType,
        ISNULL(invoiceTotals.itemCount, 0) AS itemCount,
        ISNULL(invoiceTotals.total, 0) AS total,
        mr.Account_No AS accountNo
      ${fromQuery}
    ) pagedRows
    WHERE pagedRows.rowNo BETWEEN @rowStart AND @rowEnd
    ORDER BY pagedRows.rowNo ASC
  `;
  const summaryQuery = `
    SELECT
      COUNT(1) AS movementCount,
      ISNULL(SUM(ISNULL(invoiceTotals.total, 0)), 0) AS totalAmount,
      CASE WHEN COUNT(1) = 0 THEN 0 ELSE ISNULL(SUM(ISNULL(invoiceTotals.total, 0)), 0) / COUNT(1) END AS averageAmount
    ${fromQuery}
  `;
  return { rowsQuery, summaryQuery, bind: (request) => bindReportFilters(request, filters), paging };
}

async function runPagedReport(report) {
  const [rowsResult, summaryResult] = await Promise.all([
    executeReadonlyQuery(report.rowsQuery, report.bind),
    executeReadonlyQuery(report.summaryQuery, report.bind)
  ]);
  return {
    ...report.paging,
    rows: rowsResult.recordset || [],
    summary: summaryResult.recordset?.[0] || { movementCount: 0, totalAmount: 0, averageAmount: 0 }
  };
}

export async function getPurchasesReport(filters = {}) {
  return runPagedReport(reportInvoiceRows({
    accountFilter: `mr.Account_No IN (${purchaseAccountNumbers})`,
    fallbackTypeLabel: 'فاتورة شراء',
    personKind: 3,
    filters
  }));
}

export async function getSalesReport(filters = {}) {
  return runPagedReport(reportInvoiceRows({
    accountFilter: 'mr.Account_No IN (1, 2)',
    fallbackTypeLabel: 'فاتورة بيع',
    personKind: null,
    filters
  }));
}

export async function getReturnsReport(filters = {}) {
  const type = String(filters.type || 'sales');
  const isPurchase = type === 'purchase';
  return runPagedReport(reportInvoiceRows({
    accountFilter: isPurchase ? 'mr.Account_No IN (8)' : 'mr.Account_No IN (3, 4)',
    fallbackTypeLabel: isPurchase ? 'مرتجع شراء' : 'مرتجع بيع',
    personKind: null,
    filters
  }));
}

function paymentReportRows({ accountFilter, personLabel, filters = {} }) {
  const dateRange = parseDateRange(filters);
  const paging = reportPaging(filters);
  const dateFilter = dateRangeFilter('ov.Date_paid', dateRange);
  const groupedFromQuery = `
    FROM (
      SELECT
        MIN(grouped.Outstandingvalues_No) AS paymentRootNo,
        MIN(grouped.Date_paid) AS [date],
        MAX(grouped.personName) AS personName,
        ABS(SUM(ISNULL(grouped.Value_paid, 0))) AS amount,
        ISNULL(MAX(NULLIF(grouped.Type_Payment, N'')), N'غير محدد') AS paymentMethod,
        MAX(grouped.Movementrestrictions_No) AS movementNo,
        ISNULL(MAX(NULLIF(grouped.Comment, N'')), N'') AS notes
      FROM (
        SELECT
          ov.Outstandingvalues_No,
          ov.Movementrestrictions_No,
          ov.Value_paid,
          ov.Date_paid,
          ov.Type_Payment,
          ov.Comment,
          ov.Person_No,
          ov.Account_No,
          ov.User_No,
          ov.Item_Add,
          ov.CashBook_No,
          ov.Computer_Name,
          ISNULL(person.Person_Name, N'غير محدد') AS personName
        FROM dbo.The_Outstandingvalues ov
        LEFT JOIN dbo.The_Persons person ON person.Person_No = ov.Person_No
        WHERE ${dateFilter}
          AND ${accountFilter}
          AND (
            @search = N''
            OR CONVERT(NVARCHAR(4000), person.Person_Name) LIKE @searchLike
            OR CONVERT(NVARCHAR(4000), ov.Type_Payment) LIKE @searchLike
            OR CONVERT(NVARCHAR(4000), ov.Comment) LIKE @searchLike
            OR CONVERT(NVARCHAR(50), ov.Outstandingvalues_No) LIKE @searchLike
            OR CONVERT(NVARCHAR(50), ov.Movementrestrictions_No) LIKE @searchLike
          )
      ) grouped
      GROUP BY
        grouped.Person_No,
        grouped.Account_No,
        grouped.Date_paid,
        ISNULL(grouped.Type_Payment, N''),
        grouped.User_No,
        grouped.Item_Add,
        grouped.CashBook_No,
        ISNULL(grouped.Computer_Name, N''),
        ISNULL(grouped.Comment, N'')
    ) paymentRows
  `;
  const rowsQuery = `
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY paymentRows.[date] DESC, paymentRows.paymentRootNo DESC) AS rowNo,
        paymentRows.[date],
        paymentRows.personName,
        paymentRows.amount,
        paymentRows.paymentMethod,
        paymentRows.paymentRootNo AS paymentNo,
        paymentRows.movementNo,
        paymentRows.notes,
        N'${personLabel}' AS personLabel
      ${groupedFromQuery}
    ) pagedRows
    WHERE pagedRows.rowNo BETWEEN @rowStart AND @rowEnd
    ORDER BY pagedRows.rowNo ASC
  `;
  const summaryQuery = `
    SELECT
      COUNT(1) AS movementCount,
      ISNULL(SUM(paymentRows.amount), 0) AS totalAmount,
      CASE WHEN COUNT(1) = 0 THEN 0 ELSE ISNULL(SUM(paymentRows.amount), 0) / COUNT(1) END AS averageAmount
    ${groupedFromQuery}
  `;
  return { rowsQuery, summaryQuery, bind: (request) => bindReportFilters(request, filters), paging };
}

export async function getSupplierPaymentsReport(filters = {}) {
  return runPagedReport(paymentReportRows({
    accountFilter: `ov.Account_No IN (${purchaseAccountNumbers})`,
    personLabel: 'المورد',
    filters
  }));
}

export async function getCustomerReceiptsReport(filters = {}) {
  return runPagedReport(paymentReportRows({
    accountFilter: 'ISNULL(person.Person_Kind, 0) = 2',
    personLabel: 'العميل',
    filters
  }));
}

export async function getItemMovementReport(filters = {}) {
  const dateRange = parseDateRange(filters);
  const paging = reportPaging(filters);
  const term = searchText(filters.search);
  if (!term) return { ...paging, rows: [], summary: { movementCount: 0, totalAmount: 0, averageAmount: 0 } };
  const dateFilter = dateRangeFilter('mr.Movementrestrictions_Date', dateRange);
  const fromQuery = `
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = d.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    WHERE ${dateFilter}
      AND (
        CONVERT(NVARCHAR(4000), item.Scientific_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), d.Barcode) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), d.Item_No) = @search
      )
  `;
  const rowsQuery = `
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC, d.Details_No DESC) AS rowNo,
        mr.Movementrestrictions_Date AS [date],
        ISNULL(acc.Account_Name, N'حركة') AS movementType,
        mr.Movementrestrictions_No AS movementNo,
        mr.Purchase_invoice AS invoiceNo,
        d.Item_No AS itemNo,
        COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد') AS itemName,
        ISNULL(person.Person_Name, N'غير محدد') AS personName,
        ISNULL(d.Item_Quntity, 0) AS quantity,
        CASE WHEN ISNULL(d.Item_Quntity, 0) = 0 THEN ISNULL(d.Charge_Value, 0) ELSE ISNULL(d.Charge_Value, 0) / ABS(ISNULL(d.Item_Quntity, 1)) END AS unitPrice,
        ISNULL(d.Charge_Value, 0) AS total,
        mr.Account_No AS accountNo,
        CASE WHEN mr.Account_No IN (${purchaseAccountNumbers}) THEN N'purchase' ELSE N'sales' END AS invoiceType
      ${fromQuery}
    ) pagedRows
    WHERE pagedRows.rowNo BETWEEN @rowStart AND @rowEnd
    ORDER BY pagedRows.rowNo ASC
  `;
  const summaryQuery = `
    SELECT
      COUNT(1) AS movementCount,
      ISNULL(SUM(ISNULL(d.Charge_Value, 0)), 0) AS totalAmount,
      CASE WHEN COUNT(1) = 0 THEN 0 ELSE ISNULL(SUM(ISNULL(d.Charge_Value, 0)), 0) / COUNT(1) END AS averageAmount
    ${fromQuery}
  `;
  return runPagedReport({ rowsQuery, summaryQuery, bind: (request) => bindReportFilters(request, filters), paging });
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
      ) AS Unit_Type,
      COALESCE(
        MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END),
        MAX(Unit_OldQuantity),
        1
      ) AS Unit_OldQuantity
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

function bindItemSearch(request, search) {
  bindSearch(request, searchText(search));
}

function itemSortClause(sort) {
  if (sort === 'quantity') return 'ISNULL(stock.availableQuantity, 0) DESC, itemName ASC';
  if (sort === 'expiry') return 'batchInfo.expiryDate ASC, itemName ASC';
  return 'itemName ASC';
}

function stockNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatStockNumber(value) {
  return stockNumber(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function withFormattedStockQuantity(rows, quantityKey = 'currentQuantity') {
  return (rows || []).map((row) => {
    const rawQuantityInSmallUnits = stockNumber(row[quantityKey]);
    const packSize = stockNumber(row.packSize) > 1 ? stockNumber(row.packSize) : 1;
    const packageQuantity = packSize > 1 ? Math.floor(rawQuantityInSmallUnits / packSize) : 0;
    const remainingUnits = packSize > 1
      ? rawQuantityInSmallUnits - packageQuantity * packSize
      : rawQuantityInSmallUnits;
    let formattedQuantity = `${formatStockNumber(rawQuantityInSmallUnits)} وحدة`;
    if (packSize > 1) {
      if (packageQuantity > 0 && remainingUnits > 0) {
        formattedQuantity = `${formatStockNumber(packageQuantity)} علبة + ${formatStockNumber(remainingUnits)} وحدة`;
      } else if (packageQuantity > 0) {
        formattedQuantity = `${formatStockNumber(packageQuantity)} علبة`;
      } else {
        formattedQuantity = `${formatStockNumber(remainingUnits)} وحدة`;
      }
    }

    return {
      ...row,
      rawQuantityInSmallUnits,
      packSize,
      packageQuantity,
      remainingUnits,
      formattedQuantity
    };
  });
}

export async function getItemStock({ search, availableOnly, sort, limit } = {}) {
  const term = searchText(search);
  const onlyAvailable = String(availableOnly || '').toLowerCase() === 'true';
  const requestedLimit = String(limit || '').toLowerCase() === 'all' ? 10000 : Number(limit || 500);
  const safeLimit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 10000);
  const query = `
    SELECT TOP (${safeLimit})
      i.Item_No AS itemCode,
      i.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      ISNULL(stock.availableQuantity, 0) AS currentQuantity,
      unitInfo.Unit_OldQuantity AS packSize,
      unitInfo.Unit_Type AS unitName,
      batchInfo.batchNo AS batch,
      batchInfo.expiryDate AS expiryDate,
      stock.cost AS purchasePrice,
      price.Charge_Value AS salePrice
    FROM dbo.The_Items i
    ${itemJoins}
    OUTER APPLY (
      SELECT TOP (1)
        CONVERT(NVARCHAR(50), idt.ItemDetails_No) AS batchNo,
        idt.Exp_date AS expiryDate
      FROM dbo.The_ItemDetails idt
      WHERE idt.Item_No = i.Item_No
        AND ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0) <> 0
      ORDER BY
        CASE WHEN idt.Exp_date IS NULL THEN 1 ELSE 0 END,
        idt.Exp_date ASC,
        idt.ItemDetails_No ASC
    ) batchInfo
    WHERE (
      @search = N''
      OR CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
      OR CONVERT(NVARCHAR(50), i.Item_No) LIKE @searchLike
    )
    ${onlyAvailable ? 'AND ISNULL(stock.availableQuantity, 0) > 0' : ''}
    ORDER BY ${itemSortClause(sort)}
  `;

  const result = await executeReadonlyQuery(query, (request) => bindItemSearch(request, term));
  return withFormattedStockQuantity(result.recordset || []);
}

export async function getOutOfStockItems({ search, sort } = {}) {
  const term = searchText(search);
  const query = `
    SELECT TOP (500)
      i.Item_No AS itemCode,
      i.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      ISNULL(stock.availableQuantity, 0) AS currentQuantity,
      unitInfo.Unit_OldQuantity AS packSize,
      stock.cost AS purchasePrice,
      price.Charge_Value AS salePrice,
      lastSale.lastSaleDate,
      lastPurchase.lastPurchaseDate,
      lastPurchase.lastSupplier
    FROM dbo.The_Items i
    ${itemJoins}
    OUTER APPLY (
      SELECT MAX(mr.Movementrestrictions_Date) AS lastSaleDate
      FROM dbo.The_Details d
      INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
      WHERE d.Item_No = i.Item_No
        AND mr.Account_No IN (1, 2)
    ) lastSale
    OUTER APPLY (
      SELECT TOP (1)
        mr.Movementrestrictions_Date AS lastPurchaseDate,
        supplier.Person_Name AS lastSupplier
      FROM dbo.The_Details d
      INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
      LEFT JOIN dbo.The_Persons supplier ON supplier.Person_No = mr.Person_No
      WHERE d.Item_No = i.Item_No
        AND mr.Account_No = 7
      ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
    ) lastPurchase
    WHERE ISNULL(stock.availableQuantity, 0) <= 0
      AND (
        @search = N''
        OR CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), i.Item_No) LIKE @searchLike
      )
    ORDER BY ${sort === 'quantity' ? 'ISNULL(stock.availableQuantity, 0) ASC, itemName ASC' : 'itemName ASC'}
  `;

  const result = await executeReadonlyQuery(query, (request) => bindItemSearch(request, term));
  return withFormattedStockQuantity(result.recordset || []);
}

export async function getItemExpiryReport({ search, days } = {}) {
  const term = searchText(search);
  const safeDays = parseDays(days || 90);
  const query = `
    SELECT TOP (500)
      i.Item_No AS itemCode,
      i.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      CONVERT(NVARCHAR(50), idt.ItemDetails_No) AS batch,
      ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0) AS quantity,
      idt.Exp_date AS expiryDate,
      DATEDIFF(DAY, DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0), idt.Exp_date) AS daysRemaining,
      idt.Item_Cost AS purchasePrice,
      price.Charge_Value AS salePrice,
      unitInfo.Unit_OldQuantity AS packSize,
      unitInfo.Unit_Type AS unitName
    FROM dbo.The_ItemDetails idt
    INNER JOIN dbo.The_Items i ON i.Item_No = idt.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = i.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    OUTER APPLY (
      SELECT TOP (1) b.Barcode
      FROM dbo.The_Barcode b
      WHERE b.Item_No = i.Item_No
      ORDER BY b.Bar_No ASC
    ) barcode
    OUTER APPLY (
      SELECT TOP (1) u.Unit_Type, u.Unit_OldQuantity
      FROM dbo.The_Units u
      WHERE u.Item_No = i.Item_No
      ORDER BY CASE WHEN u.Default_Unit = 1 THEN 0 ELSE 1 END, u.Unit_No ASC
    ) unitInfo
    OUTER APPLY (
      SELECT MAX(c.Charge_Value) AS Charge_Value
      FROM dbo.the_Charge c
      WHERE c.ItemDetails_No = idt.ItemDetails_No
    ) price
    WHERE idt.Exp_date IS NOT NULL
      AND idt.Exp_date >= DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0)
      AND idt.Exp_date < DATEADD(DAY, @days + 1, DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0))
      AND ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0) > 0
      AND (
        @search = N''
        OR CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), i.Item_No) LIKE @searchLike
      )
    ORDER BY idt.Exp_date ASC, itemName ASC
  `;

  const result = await executeReadonlyQuery(query, (request) => {
    bindItemSearch(request, term);
    request.input('days', sql.Int, safeDays);
  });
  return { days: safeDays, rows: withFormattedStockQuantity(result.recordset || [], 'quantity') };
}

export async function searchItems({ query } = {}) {
  const term = searchText(query);
  if (!term) return [];

  const queryText = `
    SELECT TOP (80)
      i.Item_No AS itemCode,
      i.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      ISNULL(stock.availableQuantity, 0) AS currentQuantity,
      unitInfo.Unit_OldQuantity AS packSize,
      unitInfo.Unit_Type AS unitName,
      stock.cost AS purchasePrice,
      price.Charge_Value AS salePrice
    FROM dbo.The_Items i
    ${itemJoins}
    WHERE (
      CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
      OR CONVERT(NVARCHAR(50), i.Item_No) = @search
    )
    ORDER BY
      CASE WHEN CONVERT(NVARCHAR(50), i.Item_No) = @search THEN 0 ELSE 1 END,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) ASC
  `;
  const result = await executeReadonlyQuery(queryText, (request) => bindItemSearch(request, term));
  return withFormattedStockQuantity(result.recordset || []);
}

export async function trackItem({ itemId }) {
  const safeItemId = Number(itemId);
  if (!Number.isInteger(safeItemId) || safeItemId <= 0) {
    return { item: null, summary: {}, movements: [], suppliers: [], customers: [] };
  }

  const itemQuery = `
    SELECT TOP (1)
      i.Item_No AS itemCode,
      i.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      ISNULL(stock.availableQuantity, 0) AS currentStock,
      unitInfo.Unit_OldQuantity AS packSize,
      unitInfo.Unit_Type AS unitName,
      stock.cost AS purchasePrice,
      price.Charge_Value AS salePrice
    FROM dbo.The_Items i
    ${itemJoins}
    WHERE i.Item_No = @itemNo
  `;
  const itemResult = await executeReadonlyQuery(itemQuery, (request) => request.input('itemNo', sql.Int, safeItemId));
  const item = withFormattedStockQuantity(itemResult.recordset || [], 'currentStock')[0] || null;
  if (!item) return { item: null, summary: {}, movements: [], suppliers: [], customers: [] };

  const bindItem = (request) => request.input('itemNo', sql.Int, Number(item.itemId));
  const movementsQuery = `
    SELECT TOP (500)
      mr.Movementrestrictions_Date AS [date],
      ISNULL(acc.Account_Name, N'حركة') AS movementType,
      mr.Movementrestrictions_No AS movementNo,
      mr.Purchase_invoice AS invoiceNo,
      ISNULL(person.Person_Name, N'غير محدد') AS personName,
      CASE
        WHEN mr.Account_No IN (1, 3, 8) THEN -ISNULL(d.Item_Quntity, 0)
        WHEN mr.Account_No IN (2, 4) THEN -ISNULL(d.Item_Quntity, 0)
        WHEN mr.Account_No IN (7) THEN ISNULL(d.Item_Quntity, 0)
        ELSE ISNULL(d.Item_Quntity, 0) * ISNULL(acc.Account_kind, 1)
      END AS quantity,
      CASE WHEN ISNULL(d.Item_Quntity, 0) = 0 THEN ISNULL(d.Charge_Value, 0) ELSE ISNULL(d.Charge_Value, 0) / ABS(ISNULL(d.Item_Quntity, 1)) END AS price,
      ISNULL(d.Charge_Value, 0) AS total,
      d.Item_Cost AS itemCost,
      CASE
        WHEN mr.Account_No IN (7, 8) THEN N'purchase'
        WHEN mr.Account_No IN (1, 2, 3, 4) THEN N'sale'
        ELSE N'other'
      END AS movementGroup
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    WHERE d.Item_No = @itemNo
    ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
  `;
  const summaryQuery = `
    SELECT
      SUM(CASE WHEN mr.Account_No IN (7) THEN ISNULL(d.Item_Quntity, 0) ELSE 0 END) AS quantityIn,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Item_Quntity, 0) ELSE 0 END) AS quantityOut,
      SUM(CASE WHEN mr.Account_No IN (3, 4) THEN ISNULL(d.Item_Quntity, 0) ELSE 0 END) AS salesReturns,
      SUM(CASE WHEN mr.Account_No IN (8) THEN ISNULL(d.Item_Quntity, 0) ELSE 0 END) AS purchaseReturns,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) - (ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)) ELSE 0 END) AS approximateProfit,
      MAX(CASE WHEN mr.Account_No = 7 THEN mr.Movementrestrictions_Date ELSE NULL END) AS lastPurchaseDate,
      MAX(CASE WHEN mr.Account_No IN (1, 2) THEN mr.Movementrestrictions_Date ELSE NULL END) AS lastSaleDate
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    WHERE d.Item_No = @itemNo
  `;
  const suppliersQuery = `
    SELECT TOP (20)
      ISNULL(person.Person_Name, N'غير محدد') AS name,
      COUNT(DISTINCT mr.Movementrestrictions_No) AS movementCount,
      SUM(ISNULL(d.Item_Quntity, 0)) AS quantity,
      SUM(ISNULL(d.Charge_Value, 0)) AS total,
      MAX(mr.Movementrestrictions_Date) AS lastPurchaseDate
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    WHERE d.Item_No = @itemNo
      AND mr.Account_No = 7
    GROUP BY ISNULL(person.Person_Name, N'غير محدد')
    ORDER BY total DESC
  `;
  const customersQuery = `
    SELECT TOP (20)
      ISNULL(person.Person_Name, N'عام') AS name,
      COUNT(DISTINCT mr.Movementrestrictions_No) AS movementCount,
      SUM(ISNULL(d.Item_Quntity, 0)) AS quantity,
      SUM(ISNULL(d.Charge_Value, 0)) AS total,
      MAX(mr.Movementrestrictions_Date) AS lastSaleDate
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    WHERE d.Item_No = @itemNo
      AND mr.Account_No IN (1, 2)
    GROUP BY ISNULL(person.Person_Name, N'عام')
    ORDER BY total DESC
  `;

  const [movementsResult, summaryResult, suppliersResult, customersResult] = await Promise.all([
    executeReadonlyQuery(movementsQuery, bindItem),
    executeReadonlyQuery(summaryQuery, bindItem),
    executeReadonlyQuery(suppliersQuery, bindItem),
    executeReadonlyQuery(customersQuery, bindItem)
  ]);

  return {
    item,
    summary: summaryResult.recordset?.[0] || {},
    movements: movementsResult.recordset || [],
    suppliers: suppliersResult.recordset || [],
    customers: customersResult.recordset || []
  };
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
    WHERE idt.Exp_date >= DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0)
      AND idt.Exp_date < DATEADD(DAY, @days + 1, DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0))
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

  const officialTradingUsers = `
    SELECT N'الفترة الصباحية' AS Trading_User, 1 AS sortOrder
    UNION ALL SELECT N'الفترة المسائية', 2
    UNION ALL SELECT N'الفترة الليلية', 3
    UNION ALL SELECT N'احمد الرجيلي', 4
    UNION ALL SELECT N'مدير النظام', 5
    UNION ALL SELECT N'عبدالوهاب', 6
  `;

  const liveProfitRows = `
    SELECT
      tp.Trading_No,
      tp.Trading_Date,
      tp.Trading_User,
      tp.Trading_Income,
      tp.Trading_Profit,
      tp.Refresh_Profit
    FROM dbo.The_Profit tp
    WHERE tp.Trading_Date >= CONVERT(DATETIME, @dateFrom, 120)
      AND tp.Trading_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @dateTo, 120))
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.The_Profit newer
        WHERE DATEDIFF(DAY, newer.Trading_Date, tp.Trading_Date) = 0
          AND ISNULL(newer.Trading_User, N'') = ISNULL(tp.Trading_User, N'')
          AND newer.Trading_No > tp.Trading_No
      )
  `;

  const officialProfitRows = `
    SELECT
      liveRows.Trading_No,
      liveRows.Trading_Date,
      liveRows.Trading_User,
      liveRows.Trading_Income,
      liveRows.Trading_Profit,
      liveRows.Refresh_Profit,
      officialUsers.sortOrder
    FROM (
      ${liveProfitRows}
    ) liveRows
    INNER JOIN (
      ${officialTradingUsers}
    ) officialUsers ON officialUsers.Trading_User = ISNULL(liveRows.Trading_User, N'')
  `;

  const query = `
    SELECT
      ISNULL(SUM(liveRows.Trading_Income), 0) AS revenue,
      ISNULL(SUM(liveRows.Trading_Income - liveRows.Trading_Profit), 0) AS costOfGoods,
      ISNULL(SUM(liveRows.Trading_Profit), 0) AS grossProfit,
      CAST(0 AS money) AS supplierPayments,
      CAST(0 AS money) AS expenses,
      ISNULL(SUM(liveRows.Trading_Profit), 0) AS netProfit,
      COUNT(*) AS liveRowCount,
      N'The_Profit' AS sourceTable
    FROM (
      ${officialProfitRows}
    ) liveRows
  `;

  const movementsQuery = `
    SELECT TOP (5000)
      movementRows.[date],
      movementRows.kind,
      movementRows.description,
      movementRows.tradingUser,
      movementRows.amount,
      movementRows.profit,
      movementRows.cost,
      movementRows.refreshProfit,
      movementRows.referenceNo,
      movementRows.sourceTable
    FROM (
      SELECT
        MIN(liveRows.Trading_Date) AS [date],
        N'المتاجرة والأرباح' AS kind,
        ISNULL(liveRows.Trading_User, N'') AS description,
        ISNULL(liveRows.Trading_User, N'') AS tradingUser,
        SUM(liveRows.Trading_Income) AS amount,
        SUM(liveRows.Trading_Profit) AS profit,
        SUM(liveRows.Trading_Income - liveRows.Trading_Profit) AS cost,
        MAX(CONVERT(int, liveRows.Refresh_Profit)) AS refreshProfit,
        MAX(liveRows.Trading_No) AS referenceNo,
        N'The_Profit' AS sourceTable,
        MIN(liveRows.sortOrder) AS sortOrder
      FROM (
        ${officialProfitRows}
      ) liveRows
      GROUP BY
        DATEDIFF(DAY, 0, liveRows.Trading_Date),
        ISNULL(liveRows.Trading_User, N'')
      HAVING SUM(ISNULL(liveRows.Trading_Income, 0)) <> 0
        OR SUM(ISNULL(liveRows.Trading_Profit, 0)) <> 0
    ) movementRows
    ORDER BY movementRows.[date] ASC, movementRows.sortOrder ASC, movementRows.description ASC
  `;

  const dateRange = { fromDate, toDate };
  const actualRevenueFrom = revenueRowsFrom(dateRange, {});
  const actualSummaryQuery = `
    SELECT
      ISNULL(SUM(amount), 0) AS netRevenue,
      COUNT(*) AS movementCount,
      ISNULL(SUM(CASE WHEN revenueSource = N'مبيعات نقدية' THEN amount ELSE 0 END), 0) AS cashSalesTotal,
      ISNULL(SUM(CASE WHEN revenueSource = N'سداد مدينين' THEN amount ELSE 0 END), 0) AS debtorPaymentsTotal,
      ABS(ISNULL(SUM(CASE WHEN revenueSource = N'مردودات' THEN amount ELSE 0 END), 0)) AS returnsTotal,
      ISNULL(SUM(CASE WHEN revenueSource NOT IN (N'مبيعات نقدية', N'سداد مدينين', N'مردودات') THEN amount ELSE 0 END), 0) AS electronicPaymentsTotal,
      N'The_Outstandingvalues' AS sourceTable
    ${actualRevenueFrom}
  `;

  const actualMovementsQuery = `
    SELECT TOP (1500)
      movementDate AS [date],
      movementType AS kind,
      sellerName + N' - ' + revenueSource AS description,
      amount,
      CAST(NULL AS money) AS profit,
      CAST(NULL AS money) AS cost,
      CAST(NULL AS int) AS refreshProfit,
      movementNo AS referenceNo,
      N'The_Outstandingvalues' AS sourceTable,
      movementNo,
      invoiceNo,
      customerName,
      sellerName,
      paymentMethod,
      revenueSource,
      accountNo
    ${actualRevenueFrom}
    ORDER BY movementDate DESC, movementNo DESC
  `;

  const bindDates = (request) => {
    request.input('dateFrom', sql.NVarChar, formatDateInputValue(fromDate));
    request.input('dateTo', sql.NVarChar, formatDateInputValue(toDate));
  };

  const [summaryResult, movementsResult, actualSummaryResult, actualMovementsResult] = await Promise.all([
    executeReadonlyQuery(query, bindDates),
    executeReadonlyQuery(movementsQuery, bindDates),
    executeReadonlyQuery(actualSummaryQuery, bindDates),
    executeReadonlyQuery(actualMovementsQuery, bindDates)
  ]);
  const officialSummary = summaryResult.recordset?.[0] || {};
  const actualRevenue = actualSummaryResult.recordset?.[0] || {
    netRevenue: 0,
    movementCount: 0,
    cashSalesTotal: 0,
    debtorPaymentsTotal: 0,
    returnsTotal: 0,
    electronicPaymentsTotal: 0,
    sourceTable: 'The_Outstandingvalues'
  };
  const officialRevenue = Number(officialSummary.revenue || 0);
  const actualNetRevenue = Number(actualRevenue.netRevenue || 0);
  const revenueDifference = actualNetRevenue - officialRevenue;
  const isMissingOfficial = Number(officialSummary.liveRowCount || 0) === 0 && actualNetRevenue > 1;
  const isSnapshotIncomplete = revenueDifference > 1;
  const reconciliation = {
    officialRevenue,
    actualRevenue: actualNetRevenue,
    shortfall: isSnapshotIncomplete ? revenueDifference : 0,
    isSnapshotIncomplete,
    source: 'The_Profit'
  };

  return {
    dateFrom: formatDateInputValue(fromDate),
    dateTo: formatDateInputValue(toDate),
    summary: officialSummary,
    officialSummary,
    actualRevenue,
    reconciliation,
    staleSource: {
      isStale: isSnapshotIncomplete,
      isMissingOfficial,
      isDifferent: isSnapshotIncomplete,
      officialRevenue,
      actualNetRevenue,
      revenueDifference,
      message: isSnapshotIncomplete ? 'ملخص المتاجرة غير محدث — توجد حركات إيراد لم تظهر في جدول الأرباح الرسمي.' : ''
    },
    movements: movementsResult.recordset || [],
    actualMovements: actualMovementsResult.recordset || []
  };
}

export async function getTradingProfitDebug({ date } = {}) {
  const selectedDate = parseSelectedDate(date) || parseSelectedDate(formatDateInputValue(new Date()));
  const bindDate = (request) => {
    request.input('selectedDate', sql.NVarChar, formatDateInputValue(selectedDate));
  };

  const debugRowsSource = `
    SELECT
      mr.Movementrestrictions_No AS movement_no,
      mr.Purchase_invoice AS invoice_no,
      mr.Movementrestrictions_Date AS movement_date,
      mr.Account_No AS account_no,
      acc.Account_kind AS account_kind,
      mr.Case_Invoice AS case_invoice,
      ISNULL(acc.Account_Name, N'حركة بيع') AS movement_type_label,
      ISNULL(p.Person_Name, N'') AS person_name,
      ISNULL(invoiceTotals.sales_total, 0) AS sales_total,
      CAST(0 AS money) AS payment_total,
      ISNULL(invoiceTotals.cost_total, 0) AS cost_total,
      CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.sales_total, 0) ELSE -ISNULL(invoiceTotals.sales_total, 0) END AS contribution_to_revenue,
      CASE
        WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.sales_total, 0) - ISNULL(invoiceTotals.cost_total, 0)
        ELSE -(ISNULL(invoiceTotals.sales_total, 0) - ISNULL(invoiceTotals.cost_total, 0))
      END AS contribution_to_profit,
      N'The_Movementrestrictions/The_Details' AS source_table
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    LEFT JOIN dbo.The_Persons p ON p.Person_No = mr.Person_No
    OUTER APPLY (
      SELECT
        SUM(ISNULL(d.Charge_Value, 0)) AS sales_total,
        SUM(ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)) AS cost_total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Movementrestrictions_Date >= CONVERT(DATETIME, @selectedDate, 120)
      AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @selectedDate, 120))
      AND mr.Account_No IN (1, 2, 3, 4)
    UNION ALL
    SELECT
      ov.Outstandingvalues_No AS movement_no,
      ov.Movementrestrictions_No AS invoice_no,
      ov.Date_paid AS movement_date,
      ov.Account_No AS account_no,
      acc.Account_kind AS account_kind,
      CAST(NULL AS bit) AS case_invoice,
      CASE
        WHEN p.Person_Kind = 2 THEN N'سداد زبون'
        WHEN p.Person_Kind = 3 THEN N'سداد مورد'
        ELSE ISNULL(acc.Account_Name, N'حركة مالية')
      END AS movement_type_label,
      ISNULL(p.Person_Name, N'') AS person_name,
      CAST(0 AS money) AS sales_total,
      ISNULL(ov.Value_paid, 0) AS payment_total,
      CAST(0 AS money) AS cost_total,
      CAST(0 AS money) AS contribution_to_revenue,
      CAST(0 AS money) AS contribution_to_profit,
      N'The_Outstandingvalues' AS source_table
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    LEFT JOIN dbo.The_Persons p ON p.Person_No = ov.Person_No
    WHERE ov.Date_paid >= CONVERT(DATETIME, @selectedDate, 120)
      AND ov.Date_paid < DATEADD(DAY, 1, CONVERT(DATETIME, @selectedDate, 120))
    UNION ALL
    SELECT
      tp.Trading_No AS movement_no,
      CAST(NULL AS int) AS invoice_no,
      tp.Trading_Date AS movement_date,
      CAST(NULL AS int) AS account_no,
      CAST(NULL AS smallint) AS account_kind,
      CAST(NULL AS bit) AS case_invoice,
      N'نتيجة تقرير المتاجرة في المحاسب' AS movement_type_label,
      ISNULL(tp.Trading_User, N'') AS person_name,
      ISNULL(tp.Trading_Income, 0) AS sales_total,
      CAST(0 AS money) AS payment_total,
      ISNULL(tp.Trading_Income, 0) - ISNULL(tp.Trading_Profit, 0) AS cost_total,
      ISNULL(tp.Trading_Income, 0) AS contribution_to_revenue,
      ISNULL(tp.Trading_Profit, 0) AS contribution_to_profit,
      N'The_Profit' AS source_table
    FROM dbo.The_Profit tp
    WHERE tp.Trading_Date >= CONVERT(DATETIME, @selectedDate, 120)
      AND tp.Trading_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @selectedDate, 120))
  `;

  const debugRowsQuery = `
    SELECT TOP (1000)
      debugRows.movement_no,
      debugRows.invoice_no,
      debugRows.movement_date,
      debugRows.account_no,
      debugRows.account_kind,
      debugRows.case_invoice,
      debugRows.movement_type_label,
      debugRows.person_name,
      debugRows.sales_total,
      debugRows.payment_total,
      debugRows.cost_total,
      debugRows.contribution_to_revenue,
      debugRows.contribution_to_profit,
      debugRows.source_table
    FROM (
      ${debugRowsSource}
    ) debugRows
    ORDER BY debugRows.movement_date, debugRows.source_table, debugRows.movement_no
  `;

  const groupedQuery = `
    SELECT
      grouped.account_no,
      grouped.account_kind,
      grouped.case_invoice,
      grouped.movement_type_label,
      grouped.source_table,
      COUNT(*) AS row_count,
      SUM(grouped.sales_total) AS sales_total,
      SUM(grouped.payment_total) AS payment_total,
      SUM(grouped.cost_total) AS cost_total,
      SUM(grouped.contribution_to_revenue) AS contribution_to_revenue,
      SUM(grouped.contribution_to_profit) AS contribution_to_profit
    FROM (
      ${debugRowsSource}
    ) grouped
    GROUP BY
      grouped.account_no,
      grouped.account_kind,
      grouped.case_invoice,
      grouped.movement_type_label,
      grouped.source_table
    ORDER BY grouped.source_table, grouped.account_no, grouped.case_invoice
  `;

  const currentTradingPathQuery = `
    SELECT
      ISNULL(SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) ELSE -ISNULL(d.Charge_Value, 0) END), 0) AS currentRevenue,
      ISNULL(SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0) ELSE -(ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)) END), 0) AS currentCost,
      ISNULL(SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) - (ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)) ELSE -(ISNULL(d.Charge_Value, 0) - (ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0))) END), 0) AS currentProfit
    FROM dbo.The_Movementrestrictions mr
    INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
    WHERE mr.Movementrestrictions_Date >= CONVERT(DATETIME, @selectedDate, 120)
      AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CONVERT(DATETIME, @selectedDate, 120))
      AND ISNULL(mr.Case_Invoice, 0) = 0
      AND mr.Account_No IN (1, 2, 3, 4)
  `;

  const [rowsResult, groupedResult, currentPathResult] = await Promise.all([
    executeReadonlyQuery(debugRowsQuery, bindDate),
    executeReadonlyQuery(groupedQuery, bindDate),
    executeReadonlyQuery(currentTradingPathQuery, bindDate)
  ]);

  return {
    date: formatDateInputValue(selectedDate),
    currentTradingPath: currentPathResult.recordset?.[0] || {},
    rows: rowsResult.recordset || [],
    groupedTotals: groupedResult.recordset || []
  };
}

export async function getRevenueDetails(filters = {}) {
  const dateRange = parseDateRange(filters);
  const revenueFrom = revenueRowsFrom(dateRange, filters);
  const bindFilters = (request) => {
    bindDateRange(request, dateRange);
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
    ${revenueRowsFrom(dateRange, {})}
    GROUP BY sellerId, sellerName
    UNION ALL
    SELECT 'period' AS optionType, period AS optionValue, period AS optionLabel
    ${revenueRowsFrom(dateRange, {})}
    GROUP BY period
    UNION ALL
    SELECT 'paymentMethod' AS optionType, paymentMethod AS optionValue, paymentMethod AS optionLabel
    ${revenueRowsFrom(dateRange, {})}
    GROUP BY paymentMethod
    UNION ALL
    SELECT 'movementType' AS optionType, movementType AS optionValue, movementType AS optionLabel
    ${revenueRowsFrom(dateRange, {})}
    GROUP BY movementType
    ORDER BY optionType, optionLabel
  `;

  const [rowsResult, summaryResult, sourcesResult, sellerTotalsResult, filterOptionsResult] = await Promise.all([
    executeReadonlyQuery(rowsQuery, bindFilters),
    executeReadonlyQuery(summaryQuery, bindFilters),
    executeReadonlyQuery(sourcesQuery, bindFilters),
    executeReadonlyQuery(sellerTotalsQuery, bindFilters),
    executeReadonlyQuery(filterOptionsQuery, (request) => bindDateRange(request, dateRange))
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
    selectedDate: formatDateInputValue(dateRange.fromDate),
    dateFrom: formatDateInputValue(dateRange.fromDate),
    dateTo: formatDateInputValue(dateRange.toDate),
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

function analyticsDateRange(filters = {}) {
  return parseDateRange({
    dateFrom: filters.dateFrom || filters.from || filters.startDate,
    dateTo: filters.dateTo || filters.to || filters.endDate
  });
}

function analyticsOptionalDateRange(filters = {}) {
  const fromDate = parseSelectedDate(filters.dateFrom || filters.from || filters.startDate);
  const toDate = parseSelectedDate(filters.dateTo || filters.to || filters.endDate) || fromDate;
  if (!fromDate && !toDate) return null;
  if (!fromDate && toDate) return { fromDate: toDate, toDate };
  if (toDate.getTime() < fromDate.getTime()) {
    throw badRequest('Invalid date range. dateTo must be greater than or equal to dateFrom.');
  }
  return { fromDate, toDate };
}

function isRowInsideDateRange(rowDate, dateRange) {
  if (!dateRange) return true;
  if (!rowDate) return false;
  const date = rowDate instanceof Date ? rowDate : new Date(rowDate);
  if (Number.isNaN(date.getTime())) return false;
  const value = formatDateInputValue(date);
  const from = formatDateInputValue(dateRange.fromDate);
  const to = formatDateInputValue(dateRange.toDate);
  return value >= from && value <= to;
}

function groupAnalyticsRows(rows, nameKey, dateKey) {
  const grouped = new Map();
  for (const row of rows) {
    const name = row[nameKey] || row.personName || 'غير محدد';
    const existing = grouped.get(name) || {
      name,
      movementCount: 0,
      quantity: 0,
      total: 0,
      [dateKey]: null
    };
    existing.movementCount += 1;
    existing.quantity += Math.abs(Number(row.quantity || 0));
    existing.total += Number(row.total || 0);
    if (!existing[dateKey] || new Date(row.date) > new Date(existing[dateKey])) {
      existing[dateKey] = row.date;
    }
    grouped.set(name, existing);
  }
  return Array.from(grouped.values()).sort((left, right) => Number(right.total || 0) - Number(left.total || 0)).slice(0, 20);
}

function analyticsUnavailable(value) {
  return value === undefined ? null : value;
}

export async function analyticsGlobalSearch({ q } = {}) {
  const term = searchText(q);
  if (!term) return { query: '', rows: [] };

  const bindSearch = (request) => bindItemSearch(request, term);
  const itemQuery = `
    SELECT TOP (10)
      N'صنف' AS resultType,
      CONVERT(NVARCHAR(50), i.Item_No) AS id,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS title,
      ISNULL(barcode.Barcode, N'') AS subtitle,
      N'item' AS targetType,
      CONVERT(NVARCHAR(50), i.Item_No) AS targetId
    FROM dbo.The_Items i
    ${itemJoins}
    WHERE @search <> N''
      AND (
        CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), i.Item_No) LIKE @searchLike
      )
    ORDER BY title ASC
  `;
  const personsQuery = `
    SELECT TOP (10)
      CASE WHEN p.Person_Kind = 2 THEN N'زبون' ELSE N'مورد' END AS resultType,
      CONVERT(NVARCHAR(50), p.Person_No) AS id,
      p.Person_Name AS title,
      ISNULL(p.Person_tel, N'') AS subtitle,
      CASE WHEN p.Person_Kind = 2 THEN N'customer' ELSE N'supplier' END AS targetType,
      CONVERT(NVARCHAR(50), p.Person_No) AS targetId
    FROM dbo.The_Persons p
    WHERE p.Person_Kind IN (2, 3)
      AND @search <> N''
      AND (
        CONVERT(NVARCHAR(4000), p.Person_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), p.Person_tel) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), p.Person_No) LIKE @searchLike
      )
    ORDER BY p.Person_Name ASC
  `;
  const invoicesQuery = `
    SELECT TOP (15)
      CASE WHEN mr.Account_No IN (7, 8, 11, 12, 24) THEN N'فاتورة شراء' ELSE N'فاتورة بيع' END AS resultType,
      CONVERT(NVARCHAR(50), mr.Movementrestrictions_No) AS id,
      N'حركة رقم ' + CONVERT(NVARCHAR(50), mr.Movementrestrictions_No) AS title,
      ISNULL(person.Person_Name, N'غير محدد') + N' - ' + CONVERT(NVARCHAR(10), mr.Movementrestrictions_Date, 103) AS subtitle,
      CASE WHEN mr.Account_No IN (7, 8, 11, 12, 24) THEN N'purchase-invoice' ELSE N'sales-invoice' END AS targetType,
      CONVERT(NVARCHAR(50), mr.Movementrestrictions_No) AS targetId
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Persons person ON person.Person_No = mr.Person_No
    WHERE @search <> N''
      AND (
        CONVERT(NVARCHAR(50), mr.Movementrestrictions_No) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), mr.Purchase_invoice) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), person.Person_Name) LIKE @searchLike
      )
    ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
  `;
  const movementsQuery = `
    SELECT TOP (10)
      N'حركة' AS resultType,
      CONVERT(NVARCHAR(50), ov.Outstandingvalues_No) AS id,
      N'حركة دفع رقم ' + CONVERT(NVARCHAR(50), ov.Outstandingvalues_No) AS title,
      ISNULL(person.Person_Name, N'غير محدد') + N' - ' + ISNULL(ov.Type_Payment, N'') AS subtitle,
      N'revenue-movement' AS targetType,
      CONVERT(NVARCHAR(50), ov.Outstandingvalues_No) AS targetId
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Persons person ON person.Person_No = ov.Person_No
    WHERE @search <> N''
      AND (
        CONVERT(NVARCHAR(50), ov.Outstandingvalues_No) LIKE @searchLike
        OR CONVERT(NVARCHAR(50), ov.Movementrestrictions_No) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), person.Person_Name) LIKE @searchLike
        OR CONVERT(NVARCHAR(4000), ov.Type_Payment) LIKE @searchLike
      )
    ORDER BY ov.Date_paid DESC, ov.Outstandingvalues_No DESC
  `;

  const [items, persons, invoices, movements] = await Promise.all([
    executeReadonlyQuery(itemQuery, bindSearch),
    executeReadonlyQuery(personsQuery, bindSearch),
    executeReadonlyQuery(invoicesQuery, bindSearch),
    executeReadonlyQuery(movementsQuery, bindSearch)
  ]);

  return {
    query: term,
    rows: [
      ...(items.recordset || []),
      ...(persons.recordset || []),
      ...(invoices.recordset || []),
      ...(movements.recordset || [])
    ]
  };
}

export async function analyticsItemCard({ itemId } = {}) {
  const track = await trackItem({ itemId });
  if (!track.item) return track;

  const bindItem = (request) => request.input('itemNo', sql.Int, Number(track.item.itemId));
  const metricsQuery = `
    SELECT
      AVG(CASE WHEN mr.Account_No = 7 THEN NULLIF(d.Charge_Value, 0) / CASE WHEN ABS(ISNULL(d.Item_Quntity, 0)) = 0 THEN NULL ELSE ABS(d.Item_Quntity) END ELSE NULL END) AS averageCost,
      MAX(CASE WHEN mr.Account_No IN (1, 2) THEN NULLIF(d.Charge_Value, 0) / CASE WHEN ABS(ISNULL(d.Item_Quntity, 0)) = 0 THEN NULL ELSE ABS(d.Item_Quntity) END ELSE NULL END) AS highestSalePrice,
      MIN(CASE WHEN mr.Account_No IN (1, 2) THEN NULLIF(d.Charge_Value, 0) / CASE WHEN ABS(ISNULL(d.Item_Quntity, 0)) = 0 THEN NULL ELSE ABS(d.Item_Quntity) END ELSE NULL END) AS lowestSalePrice,
      MIN(CASE WHEN mr.Account_No = 7 THEN mr.Movementrestrictions_Date ELSE NULL END) AS firstPurchaseDate,
      COUNT(DISTINCT CASE WHEN mr.Account_No IN (1, 2) THEN mr.Movementrestrictions_No ELSE NULL END) AS salesCount,
      SUM(CASE WHEN mr.Account_No IN (1, 2) AND mr.Movementrestrictions_Date >= DATEADD(MONTH, -1, DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0)) THEN ABS(ISNULL(d.Item_Quntity, 0)) ELSE 0 END) AS salesQuantityLastMonth,
      SUM(CASE WHEN mr.Account_No IN (1, 2) AND mr.Movementrestrictions_Date >= DATEADD(YEAR, -1, DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0)) THEN ABS(ISNULL(d.Item_Quntity, 0)) ELSE 0 END) AS salesQuantityLastYear
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    WHERE d.Item_No = @itemNo
  `;
  const trendQuery = `
    SELECT TOP (12)
      CONVERT(CHAR(7), mr.Movementrestrictions_Date, 120) AS period,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ABS(ISNULL(d.Item_Quntity, 0)) ELSE 0 END) AS salesQuantity,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) ELSE 0 END) AS salesValue
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    WHERE d.Item_No = @itemNo
      AND mr.Movementrestrictions_Date >= DATEADD(MONTH, -12, DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0))
    GROUP BY CONVERT(CHAR(7), mr.Movementrestrictions_Date, 120)
    ORDER BY period DESC
  `;
  const [metricsResult, trendResult] = await Promise.all([
    executeReadonlyQuery(metricsQuery, bindItem),
    executeReadonlyQuery(trendQuery, bindItem)
  ]);
  return {
    ...track,
    metrics: {
      ...(metricsResult.recordset?.[0] || {}),
      lastPurchaseDate: track.summary?.lastPurchaseDate || null,
      lastSaleDate: track.summary?.lastSaleDate || null,
      approximateProfit: analyticsUnavailable(track.summary?.approximateProfit)
    },
    trend: (trendResult.recordset || []).reverse()
  };
}

export async function analyticsDailyProfit(filters = {}) {
  const dateRange = analyticsDateRange(filters);
  const dateFrom = formatDateInputValue(dateRange.fromDate);
  const dateTo = formatDateInputValue(dateRange.toDate);
  const [revenue, trading] = await Promise.all([
    getRevenueDetails({ dateFrom, dateTo }),
    getTradingProfit({ dateFrom, dateTo })
  ]);
  const bind = (request) => bindDateRange(request, dateRange);
  const itemsQuery = `
    SELECT TOP (20)
      d.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, item.Scientific_Name) AS itemName,
      SUM(ABS(ISNULL(d.Item_Quntity, 0))) AS quantity,
      SUM(ISNULL(d.Charge_Value, 0)) AS salesValue,
      SUM(CASE WHEN d.Item_Cost IS NULL THEN 0 ELSE ISNULL(d.Charge_Value, 0) - (ISNULL(d.Item_Cost, 0) * ABS(ISNULL(d.Item_Quntity, 0))) END) AS approximateProfit
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = d.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    WHERE mr.Account_No IN (1, 2)
      AND ${dateRangeFilter('mr.Movementrestrictions_Date', dateRange)}
    GROUP BY d.Item_No, COALESCE(tradeName.Trade_Name, item.Scientific_Name)
    ORDER BY approximateProfit DESC
  `;
  const mostSoldQuery = itemsQuery.replace('ORDER BY approximateProfit DESC', 'ORDER BY quantity DESC');
  const worstQuery = itemsQuery.replace('ORDER BY approximateProfit DESC', 'ORDER BY approximateProfit ASC');
  const [bestItems, worstItems, mostSold] = await Promise.all([
    executeReadonlyQuery(itemsQuery, bind),
    executeReadonlyQuery(worstQuery, bind),
    executeReadonlyQuery(mostSoldQuery, bind)
  ]);
  return {
    dateFrom,
    dateTo,
    revenue: revenue.summary || {},
    tradingProfit: trading.summary || {},
    bestProfitItems: bestItems.recordset || [],
    worstProfitItems: worstItems.recordset || [],
    mostSoldItems: mostSold.recordset || []
  };
}

export async function analyticsSmartShortages() {
  const rows = await getOutOfStockItems({ search: '', sort: 'name' });
  return {
    rows: rows.map((row) => ({
      ...row,
      outOfStockSince: row.lastSaleDate || null,
      averageSalesPerMonth: null,
      suggestedReorderQuantity: null,
      lastPurchaseQuantity: null
    }))
  };
}

export async function analyticsExpiry({ days } = {}) {
  const result = await getItemExpiryReport({ days: days || 90 });
  return {
    ...result,
    rows: (result.rows || []).map((row) => ({
      ...row,
      estimatedValue: Number(row.quantity || 0) * Number(row.purchasePrice || 0)
    }))
  };
}

export async function analyticsPriceChanges() {
  const query = `
    SELECT TOP (200)
      latest.Item_No AS itemId,
      COALESCE(tradeName.Trade_Name, item.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      previous.purchasePrice AS previousPurchasePrice,
      latest.purchasePrice AS latestPurchasePrice,
      latest.purchasePrice - previous.purchasePrice AS difference,
      CASE WHEN previous.purchasePrice = 0 THEN NULL ELSE ((latest.purchasePrice - previous.purchasePrice) / previous.purchasePrice) * 100 END AS percentChange,
      previous.purchaseDate AS previousPriceDate,
      latest.purchaseDate AS latestPriceDate,
      latest.supplierName
    FROM (
      SELECT
        d.Item_No,
        d.Item_Cost AS purchasePrice,
        mr.Movementrestrictions_Date AS purchaseDate,
        mr.Movementrestrictions_No,
        supplier.Person_Name AS supplierName,
        ROW_NUMBER() OVER (PARTITION BY d.Item_No ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC, d.Details_No DESC) AS rn
      FROM dbo.The_Details d
      INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
      LEFT JOIN dbo.The_Persons supplier ON supplier.Person_No = mr.Person_No
      WHERE mr.Account_No = 7
        AND d.Item_Cost IS NOT NULL
    ) latest
    INNER JOIN (
      SELECT
        d.Item_No,
        d.Item_Cost AS purchasePrice,
        mr.Movementrestrictions_Date AS purchaseDate,
        ROW_NUMBER() OVER (PARTITION BY d.Item_No ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC, d.Details_No DESC) AS rn
      FROM dbo.The_Details d
      INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
      WHERE mr.Account_No = 7
        AND d.Item_Cost IS NOT NULL
    ) previous ON previous.Item_No = latest.Item_No AND previous.rn = 2
    LEFT JOIN dbo.The_Items item ON item.Item_No = latest.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = latest.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    OUTER APPLY (
      SELECT TOP (1) b.Barcode
      FROM dbo.The_Barcode b
      WHERE b.Item_No = latest.Item_No
      ORDER BY b.Bar_No ASC
    ) barcode
    WHERE latest.rn = 1
      AND ISNULL(latest.purchasePrice, 0) <> ISNULL(previous.purchasePrice, 0)
    ORDER BY ABS(latest.purchasePrice - previous.purchasePrice) DESC
  `;
  const result = await executeReadonlyQuery(query);
  return { rows: result.recordset || [] };
}

export async function analyticsItemProfit({ itemId, dateFrom, dateTo, from, to } = {}) {
  const card = await analyticsItemCard({ itemId });
  const dateRange = analyticsOptionalDateRange({ dateFrom, dateTo, from, to });
  const movements = (card.movements || []).filter((row) => isRowInsideDateRange(row.date, dateRange));
  const purchaseRows = movements.filter((row) => row.movementGroup === 'purchase');
  const saleRows = movements.filter((row) => row.movementGroup === 'sale');
  const positivePurchases = purchaseRows.filter((row) => Number(row.quantity || 0) > 0);
  const positiveSales = saleRows.filter((row) => Number(row.quantity || 0) < 0);
  const totalSalesValue = positiveSales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalApproximateProfit = positiveSales.reduce((sum, row) => {
    const quantity = Math.abs(Number(row.quantity || 0));
    return sum + Number(row.total || 0) - (Number(row.itemCost || 0) * quantity);
  }, 0);
  return {
    item: card.item || null,
    dateFrom: dateRange ? formatDateInputValue(dateRange.fromDate) : null,
    dateTo: dateRange ? formatDateInputValue(dateRange.toDate) : null,
    summary: {
      totalPurchasedQuantity: dateRange
        ? positivePurchases.reduce((sum, row) => sum + Math.abs(Number(row.quantity || 0)), 0)
        : card.summary?.quantityIn ?? null,
      totalSoldQuantity: dateRange
        ? positiveSales.reduce((sum, row) => sum + Math.abs(Number(row.quantity || 0)), 0)
        : card.summary?.quantityOut ?? null,
      remainingQuantity: card.item?.currentStock ?? null,
      costOfGoodsSold: null,
      totalSalesValue: dateRange
        ? totalSalesValue
        : (card.movements || []).filter((row) => row.movementGroup === 'sale').reduce((sum, row) => sum + Number(row.total || 0), 0),
      totalApproximateProfit: dateRange ? totalApproximateProfit : card.summary?.approximateProfit ?? null,
      profitMarginPercent: null
    },
    suppliers: dateRange ? groupAnalyticsRows(positivePurchases, 'personName', 'lastPurchaseDate') : card.suppliers || [],
    customers: dateRange ? groupAnalyticsRows(positiveSales, 'personName', 'lastSaleDate') : card.customers || []
  };
}

export async function analyticsComparePeriods(filters = {}) {
  const left = parseDateRange({
    dateFrom: filters.leftFrom || filters.fromA || filters.dateFromA,
    dateTo: filters.leftTo || filters.toA || filters.dateToA
  });
  const right = parseDateRange({
    dateFrom: filters.rightFrom || filters.fromB || filters.dateFromB,
    dateTo: filters.rightTo || filters.toB || filters.dateToB
  });
  const [leftRevenue, rightRevenue, leftTrading, rightTrading] = await Promise.all([
    getRevenueDetails({ dateFrom: formatDateInputValue(left.fromDate), dateTo: formatDateInputValue(left.toDate) }),
    getRevenueDetails({ dateFrom: formatDateInputValue(right.fromDate), dateTo: formatDateInputValue(right.toDate) }),
    getTradingProfit({ dateFrom: formatDateInputValue(left.fromDate), dateTo: formatDateInputValue(left.toDate) }),
    getTradingProfit({ dateFrom: formatDateInputValue(right.fromDate), dateTo: formatDateInputValue(right.toDate) })
  ]);
  return {
    left: {
      dateFrom: formatDateInputValue(left.fromDate),
      dateTo: formatDateInputValue(left.toDate),
      revenue: leftRevenue.summary || {},
      profit: leftTrading.summary || {}
    },
    right: {
      dateFrom: formatDateInputValue(right.fromDate),
      dateTo: formatDateInputValue(right.toDate),
      revenue: rightRevenue.summary || {},
      profit: rightTrading.summary || {}
    }
  };
}

export async function analyticsUsersReport(filters = {}) {
  const dateRange = analyticsDateRange(filters);
  const revenue = await getRevenueDetails({
    dateFrom: formatDateInputValue(dateRange.fromDate),
    dateTo: formatDateInputValue(dateRange.toDate)
  });
  return {
    dateFrom: formatDateInputValue(dateRange.fromDate),
    dateTo: formatDateInputValue(dateRange.toDate),
    rows: revenue.sellerTotals || []
  };
}

export async function analyticsGoodsCapital() {
  const query = `
    SELECT
      ISNULL(profitTotals.grossProfit, 0) AS grossProfit,
      ISNULL(lostDamaged.value, 0) AS lostDamaged,
      ISNULL(generalExpenses.value, 0) AS generalExpenses,
      ISNULL(profitTotals.grossProfit, 0)
        - ISNULL(lostDamaged.value, 0)
        - ISNULL(generalExpenses.value, 0) AS netProfit,
      ISNULL(profitTotals.grossRevenue, 0) AS grossRevenue,
      ISNULL(supplierPayments.value, 0) AS supplierPayments,
      ISNULL(procurementExpenses.value, 0) AS procurementExpenses,
      ISNULL(partnerWithdrawals.value, 0) AS partnerWithdrawals,
      ISNULL(profitTotals.grossRevenue, 0)
        - ISNULL(supplierPayments.value, 0)
        - ISNULL(procurementExpenses.value, 0)
        - ISNULL(partnerWithdrawals.value, 0)
        - ISNULL(generalExpenses.value, 0) AS netRevenue,
      ISNULL(stockBalance.value, 0) AS stockBalance,
      ISNULL(receivableBalance.value, 0) AS debitBalances,
      ISNULL(supplierCredit.value, 0) AS creditBalances,
      ISNULL(stockBalance.value, 0)
        + ISNULL(receivableBalance.value, 0)
        + (
          ISNULL(profitTotals.grossRevenue, 0)
          - ISNULL(supplierPayments.value, 0)
          - ISNULL(procurementExpenses.value, 0)
          - ISNULL(partnerWithdrawals.value, 0)
          - ISNULL(generalExpenses.value, 0)
        )
        - ISNULL(supplierCredit.value, 0) AS capital
    FROM (SELECT 1 AS id) anchor
    OUTER APPLY (
      SELECT
        SUM(ISNULL(Trading_Income, 0)) AS grossRevenue,
        SUM(ISNULL(Trading_Profit, 0)) AS grossProfit
      FROM dbo.The_Profit
    ) profitTotals
    OUTER APPLY (
      SELECT SUM(
        CASE
          WHEN mr.Account_No IN (15, 17) THEN 1
          WHEN mr.Account_No IN (16, 18) THEN -1
          ELSE 0
        END
        * ISNULL(d.Item_Cost, 0)
        * ABS(ISNULL(d.Item_Quntity, 0))
        / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
      ) AS value
      FROM dbo.The_Movementrestrictions mr
      INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
      LEFT JOIN (
        SELECT
          Item_No,
          COALESCE(
            MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END),
            MAX(Unit_OldQuantity),
            1
          ) AS Unit_OldQuantity
        FROM dbo.The_Units
        GROUP BY Item_No
      ) unitInfo ON unitInfo.Item_No = d.Item_No
      WHERE mr.Account_No IN (15, 16, 17, 18)
    ) lostDamaged
    OUTER APPLY (
      SELECT ABS(SUM(ISNULL(ov.Value_paid, 0))) AS value
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Account_No = 11
    ) generalExpenses
    OUTER APPLY (
      SELECT ABS(SUM(ISNULL(ov.Value_paid, 0))) AS value
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Account_No = 7
    ) supplierPayments
    OUTER APPLY (
      SELECT SUM(
        CASE
          WHEN mr.Account_No = 21 THEN 1
          WHEN mr.Account_No = 22 THEN -1
          ELSE 0
        END * ISNULL(expenseTotals.total, 0)
      ) AS value
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (
        SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total
        FROM dbo.The_Details d
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) expenseTotals
      WHERE mr.Account_No IN (21, 22)
    ) procurementExpenses
    OUTER APPLY (
      SELECT SUM(
        CASE
          WHEN mr.Account_No = 13 THEN 1
          WHEN mr.Account_No = 14 THEN -1
          ELSE 0
        END * ISNULL(withdrawalTotals.total, 0)
      ) AS value
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (
        SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total
        FROM dbo.The_Details d
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) withdrawalTotals
      WHERE mr.Account_No IN (13, 14)
    ) partnerWithdrawals
    OUTER APPLY (
      SELECT SUM(
        ISNULL(idt.Item_Quantity, 0)
        * ISNULL(idt.Item_Cost, 0)
        / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
      ) AS value
      FROM dbo.The_ItemDetails idt
      LEFT JOIN (
        SELECT
          Item_No,
          COALESCE(
            MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END),
            MAX(Unit_OldQuantity),
            1
          ) AS Unit_OldQuantity
        FROM dbo.The_Units
        GROUP BY Item_No
      ) unitInfo ON unitInfo.Item_No = idt.Item_No
    ) stockBalance
    OUTER APPLY (
      SELECT
        ISNULL(creditSales.total, 0)
          - ISNULL(creditReturns.total, 0)
          - ISNULL(creditPayments.total, 0) AS value
      FROM (SELECT 1 AS id) receivableAnchor
      OUTER APPLY (
        SELECT SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
        FROM dbo.The_Movementrestrictions mr
        INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
        LEFT JOIN (
          SELECT
            Item_No,
            MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
          FROM dbo.The_Units
          GROUP BY Item_No
        ) unitInfo ON unitInfo.Item_No = d.Item_No
        WHERE mr.Account_No = 2
      ) creditSales
      OUTER APPLY (
        SELECT SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
        FROM dbo.The_Movementrestrictions mr
        INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
        LEFT JOIN (
          SELECT
            Item_No,
            MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
          FROM dbo.The_Units
          GROUP BY Item_No
        ) unitInfo ON unitInfo.Item_No = d.Item_No
        WHERE mr.Account_No = 4
      ) creditReturns
      OUTER APPLY (
        SELECT SUM(ISNULL(ov.Value_paid, 0)) AS total
        FROM dbo.The_Outstandingvalues ov
        WHERE ov.Account_No = 2
      ) creditPayments
    ) receivableBalance
    OUTER APPLY (
      SELECT SUM(CASE WHEN supplierRows.balance < 0 THEN ABS(supplierRows.balance) ELSE 0 END) AS value
      FROM (
        SELECT
          p.Person_No AS id,
          ISNULL(supplierMovements.total, 0) - ISNULL(supplierPayments.total, 0) AS balance
        FROM dbo.The_Persons p
        OUTER APPLY (
          SELECT SUM(
            ISNULL(d.Charge_Value, 0)
            / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
            * ISNULL(d.Item_Quntity, 0)
            * ISNULL(acc.Account_kind, 1)
          ) AS total
          FROM dbo.The_Movementrestrictions mr
          INNER JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
          INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
          LEFT JOIN (
            SELECT
              Item_No,
              MAX(Unit_OldQuantity) AS Unit_OldQuantity
            FROM dbo.The_Units
            GROUP BY Item_No
          ) unitInfo ON unitInfo.Item_No = d.Item_No
          WHERE mr.Person_No = p.Person_No
            AND mr.Account_No IN (${purchaseAccountNumbers})
        ) supplierMovements
        OUTER APPLY (
          SELECT SUM(ISNULL(ov.Value_paid, 0)) AS total
          FROM dbo.The_Outstandingvalues ov
          WHERE ov.Person_No = p.Person_No
        ) supplierPayments
        WHERE p.Person_Kind = 3
      ) supplierRows
    ) supplierCredit
  `;
  const result = await executeReadonlyQuery(query);
  const summary = result.recordset?.[0] || {};
  const profitRows = [
    { label: 'إجمالي أرباح', value: summary.grossProfit },
    { label: 'تلف وفقد', value: summary.lostDamaged },
    { label: 'مصروفات عامة', value: summary.generalExpenses },
    { label: 'صافي أرباح', value: summary.netProfit, highlight: true }
  ];
  const revenueRows = [
    { label: 'إجمالي إيرادات', value: summary.grossRevenue },
    { label: 'سداد موردين', value: summary.supplierPayments },
    { label: 'مصروفات مشتريات', value: summary.procurementExpenses },
    { label: 'مسحوبات الشركاء', value: summary.partnerWithdrawals },
    { label: 'مصروفات عامة', value: summary.generalExpenses },
    { label: 'صافي إيرادات', value: summary.netRevenue, highlight: true }
  ];
  const goodsRows = [
    { label: 'رصيد البضاعة', value: summary.stockBalance },
    { label: 'أرصدة مدينة', value: summary.debitBalances },
    { label: 'رصيد النقدية', value: summary.netRevenue, highlight: true },
    { label: 'أرصدة دائنة', value: summary.creditBalances },
    { label: 'رأس المال', value: summary.capital, highlight: true }
  ];
  const averageRows = [
    { label: 'متوسط الإيرادات', value: Number(summary.netRevenue || 0) / 365, highlight: true },
    { label: 'متوسط الأرباح', value: Number(summary.netProfit || 0) / 365, highlight: true }
  ];
  return {
    summary,
    sections: [
      { title: 'الأرباح', rows: profitRows },
      { title: 'الإيرادات', rows: revenueRows },
      { title: 'بضاعة', rows: goodsRows },
      { title: 'متوسط صافي إيراد وأرباح خلال 365 يوم', rows: averageRows }
    ],
    rows: goodsRows,
    formula: 'رأس المال = رصيد البضاعة + أرصدة مدينة + رصيد النقدية - أرصدة دائنة'
  };
}

export async function analyticsAlerts() {
  const [shortages, expiry, priceChanges] = await Promise.all([
    analyticsSmartShortages(),
    analyticsExpiry({ days: 30 }),
    analyticsPriceChanges()
  ]);
  const alerts = [];
  if (shortages.rows.length) alerts.push({ severity: 'high', title: 'أصناف نافدة', value: shortages.rows.length, message: 'توجد أصناف رصيدها صفر أو أقل.' });
  if (expiry.rows.length) alerts.push({ severity: 'medium', title: 'قرب انتهاء', value: expiry.rows.length, message: 'توجد أصناف تنتهي خلال 30 يوم.' });
  const significant = (priceChanges.rows || []).filter((row) => Math.abs(Number(row.percentChange || 0)) >= 20);
  if (significant.length) alerts.push({ severity: 'medium', title: 'تغير سعر شراء', value: significant.length, message: 'توجد أصناف تغير سعر شرائها بنسبة 20% أو أكثر.' });
  return { rows: alerts };
}

export async function analyticsManagerDashboard(filters = {}) {
  const dateRange = analyticsDateRange(filters);
  const dateFrom = formatDateInputValue(dateRange.fromDate);
  const dateTo = formatDateInputValue(dateRange.toDate);
  const [revenue, trading, shortages, expiry] = await Promise.all([
    getRevenueDetails({ dateFrom, dateTo }),
    getTradingProfit({ dateFrom, dateTo }),
    analyticsSmartShortages(),
    analyticsExpiry({ days: 90 })
  ]);
  const bestUser = (revenue.sellerTotals || []).slice().sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0] || null;
  return {
    dateFrom,
    dateTo,
    summary: {
      revenueToday: revenue.summary?.netRevenue ?? 0,
      profitToday: trading.summary?.netProfit ?? null,
      cashSales: revenue.summary?.cashSalesTotal ?? 0,
      electronicPayments: revenue.summary?.electronicPaymentsTotal ?? 0,
      debtorPayments: revenue.summary?.debtorPaymentsTotal ?? 0,
      returnsToday: revenue.summary?.returnsTotal ?? 0,
      outOfStockCount: shortages.rows.length,
      nearExpiryCount: expiry.rows.length,
      bestUserName: bestUser?.sellerName || null,
      bestUserRevenue: bestUser?.total || null
    },
    topItems: []
  };
}

export async function analyticsItemTimeline({ itemId } = {}) {
  const track = await trackItem({ itemId });
  return {
    item: track.item,
    rows: (track.movements || []).slice().sort((left, right) => new Date(left.date) - new Date(right.date))
  };
}
