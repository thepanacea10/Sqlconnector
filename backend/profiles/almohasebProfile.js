import { sql, executeReadonlyQuery } from '../db.js';

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

const customerBalanceApply = `
  OUTER APPLY (
    SELECT
      SUM(
        CASE
          WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0)
          WHEN mr.Account_No IN (3, 4) THEN -ISNULL(invoiceTotals.total, 0)
          ELSE 0
        END
      ) AS total,
      MAX(mr.Movementrestrictions_Date) AS lastDate
    FROM dbo.The_Movementrestrictions mr
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Person_No = p.Person_No
      AND mr.Account_No IN (1, 2, 3, 4)
  ) invoices
  OUTER APPLY (
    SELECT
      SUM(ISNULL(ov.Value_paid, 0)) AS total,
      MAX(ov.Date_paid) AS lastDate
    FROM dbo.The_Outstandingvalues ov
    WHERE ov.Person_No = p.Person_No
  ) outstanding
  OUTER APPLY (
    SELECT
      SUM(ISNULL(r.Value_received, 0)) AS total,
      MAX(r.Date_Received) AS lastDate
    FROM dbo.The_Receipts r
    WHERE r.User_no = p.Person_No
  ) receipts
  OUTER APPLY (
    SELECT TOP (1)
      ledgerRow.[date],
      ledgerRow.amount
    FROM (
      SELECT
        mr.Movementrestrictions_Date AS [date],
        CASE
          WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0)
          WHEN mr.Account_No IN (3, 4) THEN -ISNULL(invoiceTotals.total, 0)
          ELSE 0
        END AS amount
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (
        SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
        FROM dbo.The_Details d
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) invoiceTotals
      WHERE mr.Person_No = p.Person_No
        AND mr.Account_No IN (1, 2, 3, 4)
      UNION ALL
      SELECT ov.Date_paid AS [date], -ISNULL(ov.Value_paid, 0) AS amount
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = p.Person_No
      UNION ALL
      SELECT r.Date_Received AS [date], -ISNULL(r.Value_received, 0) AS amount
      FROM dbo.The_Receipts r
      WHERE r.User_no = p.Person_No
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
      ISNULL(invoices.total, 0) - ISNULL(outstanding.total, 0) - ISNULL(receipts.total, 0) AS currentBalance,
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
  `;

  const result = await executeReadonlyQuery(query, (request) => bindSearch(request, term));
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
      CASE
        WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0)
        WHEN mr.Account_No IN (3, 4) THEN -ISNULL(invoiceTotals.total, 0)
        ELSE 0
      END AS total,
      ISNULL(payments.paid, 0) AS paid,
      CASE
        WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0)
        WHEN mr.Account_No IN (3, 4) THEN -ISNULL(invoiceTotals.total, 0)
        ELSE 0
      END - ISNULL(payments.paid, 0) AS remaining
    FROM dbo.The_Movementrestrictions mr
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    OUTER APPLY (
      SELECT SUM(ISNULL(ov.Value_paid, 0)) AS paid
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Movementrestrictions_No = mr.Movementrestrictions_No
    ) payments
    WHERE mr.Person_No = @id
      AND mr.Account_No IN (1, 2, 3, 4)
    ORDER BY mr.Movementrestrictions_Date DESC, mr.Movementrestrictions_No DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getCustomerReceipts(id) {
  const query = `
    SELECT TOP (150)
      receiptRow.receiptNumber,
      receiptRow.[date],
      receiptRow.amount,
      receiptRow.notes
      FROM (
      SELECT
        N'R-' + CONVERT(NVARCHAR(30), r.Receipts_No) AS receiptNumber,
        r.Date_Received AS [date],
        ISNULL(r.Value_received, 0) AS amount,
        r.Type_Payment AS notes,
        r.User_no AS personId
      FROM dbo.The_Receipts r
      UNION ALL
      SELECT
        N'P-' + CONVERT(NVARCHAR(30), ov.Outstandingvalues_No) AS receiptNumber,
        ov.Date_paid AS [date],
        ISNULL(ov.Value_paid, 0) AS amount,
        ISNULL(ov.Type_Payment, N'') + CASE WHEN ov.Comment IS NULL OR ov.Comment = N'' THEN N'' ELSE N' - ' + ov.Comment END AS notes,
        ov.Person_No AS personId
      FROM dbo.The_Outstandingvalues ov
    ) receiptRow
    WHERE receiptRow.personId = @id
    ORDER BY receiptRow.[date] DESC, receiptRow.receiptNumber DESC
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset || [];
}

export async function getCustomerStatement(id) {
  const statementRowsQuery = `
    SELECT
      mr.Movementrestrictions_Date AS [date],
      N'فاتورة رقم ' + CONVERT(NVARCHAR(30), mr.Movementrestrictions_No) AS description,
      CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(invoiceTotals.total, 0) ELSE 0 END AS debit,
      CASE WHEN mr.Account_No IN (3, 4) THEN ISNULL(invoiceTotals.total, 0) ELSE 0 END AS credit,
      CAST(1 AS int) AS sortOrder,
      mr.Movementrestrictions_No AS refNo
    FROM dbo.The_Movementrestrictions mr
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Person_No = @id
      AND mr.Account_No IN (1, 2, 3, 4)
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
    UNION ALL
    SELECT
      r.Date_Received AS [date],
      N'سند قبض رقم ' + CONVERT(NVARCHAR(30), r.Receipts_No) AS description,
      CAST(0 AS money) AS debit,
      ISNULL(r.Value_received, 0) AS credit,
      CAST(3 AS int) AS sortOrder,
      r.Receipts_No AS refNo
    FROM dbo.The_Receipts r
    WHERE r.User_no = @id
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

  const sellerCashboxesQuery = `
    SELECT
      ov.User_No AS sellerId,
      p.Person_Name AS sellerName,
      SUM(ISNULL(ov.Value_paid, 0)) AS total,
      COUNT(ov.Outstandingvalues_No) AS entryCount
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Persons p ON p.Person_No = ov.User_No
    WHERE ${cashboxDateFilter}
      AND ov.Account_No IN (1, 3)
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
          WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)
          WHEN mr.Account_No IN (3, 4) THEN -(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0))
          ELSE 0
        END
      ) AS total
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    INNER JOIN dbo.The_Items i ON i.Item_No = d.Item_No
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
  const [sellerCashboxes, topProducts] = await Promise.all([
    executeReadonlyQuery(sellerCashboxesQuery, bindDate),
    executeReadonlyQuery(productsQuery, bindDate)
  ]);
  const cashboxRows = sellerCashboxes.recordset || [];

  return {
    selectedDate: formatDateInputValue(selectedDate),
    summary: {
      totalSales: cashboxRows.reduce((total, row) => total + Number(row.total || 0), 0),
      sellerCount: cashboxRows.length,
      entryCount: cashboxRows.reduce((total, row) => total + Number(row.entryCount || 0), 0)
    },
    sellerCashboxes: cashboxRows,
    topSoldProducts: topProducts.recordset || []
  };
}
