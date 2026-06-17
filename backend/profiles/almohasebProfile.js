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

const customerBalanceApply = `
  OUTER APPLY (
    SELECT
      SUM(ISNULL(invoiceTotals.total, 0)) AS total,
      MAX(mr.Movementrestrictions_Date) AS lastDate
    FROM dbo.The_Movementrestrictions mr
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Person_No = p.Person_No
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
        ISNULL(invoiceTotals.total, 0) AS amount
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (
        SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
        FROM dbo.The_Details d
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) invoiceTotals
      WHERE mr.Person_No = p.Person_No
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
    WHERE p.Person_Kind = 1
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
  `;

  const result = await executeReadonlyQuery(query, (request) => bindId(request, id));
  return result.recordset?.[0] || null;
}

export async function getCustomerInvoices(id) {
  const query = `
    SELECT TOP (150)
      mr.Movementrestrictions_No AS invoiceNumber,
      mr.Movementrestrictions_Date AS [date],
      ISNULL(invoiceTotals.total, 0) AS total,
      ISNULL(payments.paid, 0) AS paid,
      ISNULL(invoiceTotals.total, 0) - ISNULL(payments.paid, 0) AS remaining
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
      ISNULL(invoiceTotals.total, 0) AS debit,
      CAST(0 AS money) AS credit,
      CAST(1 AS int) AS sortOrder,
      mr.Movementrestrictions_No AS refNo
    FROM dbo.The_Movementrestrictions mr
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Person_No = @id
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

const itemLookups = `
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
    SELECT TOP (1) u.Unit_Type
    FROM dbo.The_Units u
    WHERE u.Item_No = i.Item_No
    ORDER BY CASE WHEN u.Default_Unit = 1 THEN 0 ELSE 1 END, u.Unit_No ASC
  ) unitInfo
  OUTER APPLY (
    SELECT
      SUM(ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0)) AS availableQuantity,
      MAX(idt.Item_Cost) AS cost
    FROM dbo.The_ItemDetails idt
    WHERE idt.Item_No = i.Item_No
  ) stock
  OUTER APPLY (
    SELECT TOP (1) c.Charge_Value
    FROM dbo.the_Charge c
    INNER JOIN dbo.The_ItemDetails idt ON idt.ItemDetails_No = c.ItemDetails_No
    WHERE idt.Item_No = i.Item_No
    ORDER BY CASE WHEN c.Default_Charge = 1 THEN 0 ELSE 1 END, c.Charge_No ASC
  ) price
`;

export async function getInventory({ search }) {
  const term = searchText(search);
  const query = `
    SELECT TOP (120)
      i.Item_No AS id,
      CONVERT(NVARCHAR(50), i.Item_No) AS code,
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      barcode.Barcode AS barcode,
      ISNULL(stock.availableQuantity, 0) AS availableQuantity,
      unitInfo.Unit_Type AS unit,
      stock.cost AS cost,
      price.Charge_Value AS sellingPrice
    FROM dbo.The_Items i
    ${itemLookups}
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
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = i.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    OUTER APPLY (
      SELECT SUM(ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0)) AS availableQuantity
      FROM dbo.The_ItemDetails idt
      WHERE idt.Item_No = i.Item_No
    ) stock
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

export async function getSalesToday() {
  const summaryQuery = `
    SELECT
      ISNULL(SUM(ISNULL(invoiceTotals.total, 0)), 0) AS totalSales,
      COUNT(mr.Movementrestrictions_No) AS invoiceCount,
      ISNULL(AVG(CAST(ISNULL(invoiceTotals.total, 0) AS DECIMAL(18, 2))), 0) AS averageInvoice
    FROM dbo.The_Movementrestrictions mr
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE mr.Movementrestrictions_Date >= CAST(GETDATE() AS DATE)
      AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
      AND ISNULL(mr.Case_Invoice, 0) = 0
  `;

  const productsQuery = `
    SELECT TOP (8)
      COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
      SUM(ISNULL(d.Item_Quntity, 0)) AS quantity,
      SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    INNER JOIN dbo.The_Items i ON i.Item_No = d.Item_No
    OUTER APPLY (
      SELECT TOP (1) t.Trade_Name
      FROM dbo.The_Trade t
      WHERE t.Item_No = i.Item_No
      ORDER BY t.Trade_No ASC
    ) tradeName
    WHERE mr.Movementrestrictions_Date >= CAST(GETDATE() AS DATE)
      AND mr.Movementrestrictions_Date < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
      AND ISNULL(mr.Case_Invoice, 0) = 0
    GROUP BY COALESCE(tradeName.Trade_Name, i.Scientific_Name)
    ORDER BY quantity DESC
  `;

  const [summary, topProducts] = await Promise.all([
    executeReadonlyQuery(summaryQuery),
    executeReadonlyQuery(productsQuery)
  ]);

  return {
    summary: summary.recordset?.[0] || { totalSales: 0, invoiceCount: 0, averageInvoice: 0 },
    topSoldProducts: topProducts.recordset || []
  };
}
