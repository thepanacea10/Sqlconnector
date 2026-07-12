import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.TERYAQ_API_BASE || 'http://127.0.0.1:3001';
const reportStart = '2023-08-04';
const reportEnd = '2024-08-02';
const reportEndExclusive = '2024-08-03';

// Edit this list, then rerun:
//   node scripts/generate-financial-audit-report.js
const manualExpenses = [
  // { date: '2024-01-01', name: 'إيجار', amount: 1500, note: '' },
  // { date: '2024-01-01', name: 'راتب', amount: 1000, note: '' }
];

// Enter actual inventory/cash/debt values here when physical count is complete.
const actualSnapshot = {
  actual_cash: 0,
  actual_inventory_value: 0,
  actual_receivables: 0,
  actual_payables: 0
};

const outputFile = path.resolve(
  'reports',
  `financial-audit-${reportStart}_${reportEnd}.html`
);

const periodWhere = (column) => `${column} >= CONVERT(DATETIME, '${reportStart}', 120) AND ${column} < CONVERT(DATETIME, '${reportEndExclusive}', 120)`;
const beforeStartWhere = (column) => `${column} < CONVERT(DATETIME, '${reportStart}', 120)`;
const untilEndWhere = (column) => `${column} < CONVERT(DATETIME, '${reportEndExclusive}', 120)`;

const unitInfo = `
  SELECT
    Item_No,
    MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
  FROM dbo.The_Units
  GROUP BY Item_No
`;

const salesLineTotal = 'ISNULL(d.Charge_Value, 0)';
const salesCostTotal = 'ISNULL(d.Item_Cost, 0) * ISNULL(d.Item_Quntity, 0)';
const normalizedLineTotal = `
  ISNULL(d.Charge_Value, 0)
  / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
  * ISNULL(d.Item_Quntity, 0)
`;

const queries = {
  sourceSummary: `
    SELECT 'The_Movementrestrictions' AS sourceTable, COUNT(*) AS [rowCount] FROM dbo.The_Movementrestrictions
    UNION ALL SELECT 'The_Details', COUNT(*) FROM dbo.The_Details
    UNION ALL SELECT 'The_Outstandingvalues', COUNT(*) FROM dbo.The_Outstandingvalues
    UNION ALL SELECT 'The_Persons', COUNT(*) FROM dbo.The_Persons
    UNION ALL SELECT 'The_Items', COUNT(*) FROM dbo.The_Items
    UNION ALL SELECT 'The_ItemDetails', COUNT(*) FROM dbo.The_ItemDetails
  `,
  accountMovementSummary: `
    SELECT
      mr.Account_No,
      ISNULL(acc.Account_Name, N'غير محدد') AS accountName,
      ISNULL(acc.Account_kind, 0) AS accountKind,
      COUNT(*) AS invoiceCount,
      SUM(ISNULL(lines.total, 0)) AS grossTotal,
      SUM(ISNULL(lines.total, 0) * ISNULL(acc.Account_kind, 1)) AS signedTotal
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    OUTER APPLY (
      SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total
      FROM dbo.The_Details d
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) lines
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
    GROUP BY mr.Account_No, acc.Account_Name, acc.Account_kind
    ORDER BY mr.Account_No
  `,
  paymentSummary: `
    SELECT
      ov.Account_No,
      ISNULL(acc.Account_Name, N'غير محدد') AS accountName,
      ISNULL(NULLIF(ov.Type_Payment, N''), N'غير محدد') AS paymentType,
      COUNT(*) AS movementCount,
      SUM(ISNULL(ov.Value_paid, 0)) AS total
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    WHERE ${periodWhere('ov.Date_paid')}
    GROUP BY ov.Account_No, acc.Account_Name, ov.Type_Payment
    ORDER BY ov.Account_No, paymentType
  `,
  salesSummary: `
    SELECT
      COUNT(DISTINCT mr.Movementrestrictions_No) AS invoiceCount,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ${salesLineTotal} ELSE 0 END) AS salesGross,
      SUM(CASE WHEN mr.Account_No IN (3, 4) THEN ${salesLineTotal} ELSE 0 END) AS returnsGross,
      SUM(CASE WHEN mr.Account_No = 1 THEN ${salesLineTotal} ELSE 0 END) AS cashSales,
      SUM(CASE WHEN mr.Account_No = 2 THEN ${salesLineTotal} ELSE 0 END) AS creditSales,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ${salesCostTotal} ELSE -${salesCostTotal} END) AS costTotal,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ${salesLineTotal} ELSE -${salesLineTotal} END) AS netSales,
      AVG(CASE WHEN invoiceTotals.total > 0 THEN invoiceTotals.total ELSE NULL END) AS avgInvoice,
      MAX(invoiceTotals.total) AS maxInvoice,
      MIN(CASE WHEN invoiceTotals.total > 0 THEN invoiceTotals.total ELSE NULL END) AS minInvoice
    FROM dbo.The_Movementrestrictions mr
    INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
    OUTER APPLY (
      SELECT SUM(ISNULL(d2.Charge_Value, 0)) AS total
      FROM dbo.The_Details d2
      WHERE d2.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (1, 2, 3, 4)
  `,
  purchaseSummary: `
    SELECT
      COUNT(DISTINCT mr.Movementrestrictions_No) AS invoiceCount,
      SUM(CASE WHEN mr.Account_No = 7 THEN ${normalizedLineTotal} ELSE 0 END) AS purchaseGross,
      SUM(CASE WHEN mr.Account_No = 8 THEN ${normalizedLineTotal} ELSE 0 END) AS purchaseReturns,
      SUM(CASE WHEN mr.Account_No IN (7, 8) THEN ${normalizedLineTotal} * ISNULL(acc.Account_kind, -1) ELSE 0 END) AS signedPurchases,
      AVG(CASE WHEN invoiceTotals.total > 0 THEN invoiceTotals.total ELSE NULL END) AS avgInvoice,
      MAX(invoiceTotals.total) AS maxInvoice,
      MIN(CASE WHEN invoiceTotals.total > 0 THEN invoiceTotals.total ELSE NULL END) AS minInvoice
    FROM dbo.The_Movementrestrictions mr
    INNER JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    INNER JOIN dbo.The_Details d ON d.Movementrestrictions_No = mr.Movementrestrictions_No
    LEFT JOIN (${unitInfo}) unitInfo ON unitInfo.Item_No = d.Item_No
    OUTER APPLY (
      SELECT SUM(
        ISNULL(d2.Charge_Value, 0)
        / CASE WHEN ISNULL(unitInfo2.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo2.Unit_OldQuantity END
        * ISNULL(d2.Item_Quntity, 0)
      ) AS total
      FROM dbo.The_Details d2
      LEFT JOIN (${unitInfo}) unitInfo2 ON unitInfo2.Item_No = d2.Item_No
      WHERE d2.Movementrestrictions_No = mr.Movementrestrictions_No
    ) invoiceTotals
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (7, 8)
  `,
  topSoldItems: `
    SELECT TOP (20)
      COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد') AS name,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(d.Item_Quntity, 0) ELSE -ISNULL(d.Item_Quntity, 0) END) AS quantity,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ${salesLineTotal} ELSE -${salesLineTotal} END) AS total
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (SELECT TOP (1) Trade_Name FROM dbo.The_Trade t WHERE t.Item_No = d.Item_No ORDER BY Trade_No) tradeName
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (1, 2, 3, 4)
    GROUP BY COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد')
    ORDER BY total DESC
  `,
  topSalesCustomers: `
    SELECT TOP (20)
      ISNULL(p.Person_Name, N'غير محدد') AS name,
      COUNT(DISTINCT mr.Movementrestrictions_No) AS invoiceCount,
      SUM(CASE WHEN mr.Account_No IN (1, 2) THEN ISNULL(lines.total, 0) ELSE -ISNULL(lines.total, 0) END) AS total
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Persons p ON p.Person_No = mr.Person_No
    OUTER APPLY (SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No) lines
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (1, 2, 3, 4)
    GROUP BY ISNULL(p.Person_Name, N'غير محدد')
    ORDER BY total DESC
  `,
  unusualSalesInvoices: `
    SELECT TOP (30)
      mr.Movementrestrictions_No AS invoiceNo,
      mr.Movementrestrictions_Date AS invoiceDate,
      ISNULL(p.Person_Name, N'غير محدد') AS personName,
      ISNULL(acc.Account_Name, N'غير محدد') AS accountName,
      ISNULL(lines.total, 0) AS total
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Persons p ON p.Person_No = mr.Person_No
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    OUTER APPLY (SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No) lines
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (1, 2, 3, 4)
    ORDER BY ISNULL(lines.total, 0) DESC
  `,
  topPurchasedItems: `
    SELECT TOP (20)
      COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد') AS name,
      SUM(ISNULL(d.Item_Quntity, 0)) AS quantity,
      SUM(${normalizedLineTotal}) AS total
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN (${unitInfo}) unitInfo ON unitInfo.Item_No = d.Item_No
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (SELECT TOP (1) Trade_Name FROM dbo.The_Trade t WHERE t.Item_No = d.Item_No ORDER BY Trade_No) tradeName
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No = 7
    GROUP BY COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد')
    ORDER BY total DESC
  `,
  topSuppliers: `
    SELECT TOP (20)
      ISNULL(p.Person_Name, N'غير محدد') AS name,
      COUNT(DISTINCT mr.Movementrestrictions_No) AS invoiceCount,
      SUM(ISNULL(lines.total, 0)) AS total
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Persons p ON p.Person_No = mr.Person_No
    OUTER APPLY (
      SELECT SUM(
        ISNULL(d.Charge_Value, 0)
        / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
        * ISNULL(d.Item_Quntity, 0)
      ) AS total
      FROM dbo.The_Details d
      LEFT JOIN (${unitInfo}) unitInfo ON unitInfo.Item_No = d.Item_No
      WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
    ) lines
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No = 7
    GROUP BY ISNULL(p.Person_Name, N'غير محدد')
    ORDER BY total DESC
  `,
  customerLedgerSummary: `
    SELECT TOP (50)
      p.Person_No AS personNo,
      p.Person_Name AS name,
      ISNULL(opening.creditSales, 0) - ISNULL(opening.payments, 0) AS openingBalance,
      ISNULL(periodRows.creditSales, 0) AS periodSales,
      ISNULL(periodRows.payments, 0) AS periodPayments,
      ISNULL(closing.creditSales, 0) - ISNULL(closing.payments, 0) AS closingBalance,
      ISNULL(lastInvoice.lastCreditInvoiceDate, NULL) AS lastCreditInvoiceDate
    FROM dbo.The_Persons p
    OUTER APPLY (
      SELECT SUM(ISNULL(lines.total, 0)) AS creditSales
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No) lines
      WHERE mr.Person_No = p.Person_No AND mr.Account_No = 2 AND ${beforeStartWhere('mr.Movementrestrictions_Date')}
    ) openingSales
    OUTER APPLY (
      SELECT SUM(ISNULL(ov.Value_paid, 0)) AS payments
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = p.Person_No AND ${beforeStartWhere('ov.Date_paid')}
    ) openingPayments
    OUTER APPLY (SELECT ISNULL(openingSales.creditSales, 0) AS creditSales, ISNULL(openingPayments.payments, 0) AS payments) opening
    OUTER APPLY (
      SELECT SUM(ISNULL(lines.total, 0)) AS creditSales
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No) lines
      WHERE mr.Person_No = p.Person_No AND mr.Account_No = 2 AND ${periodWhere('mr.Movementrestrictions_Date')}
    ) periodSales
    OUTER APPLY (
      SELECT SUM(ISNULL(ov.Value_paid, 0)) AS payments
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = p.Person_No AND ${periodWhere('ov.Date_paid')}
    ) periodPayments
    OUTER APPLY (SELECT ISNULL(periodSales.creditSales, 0) AS creditSales, ISNULL(periodPayments.payments, 0) AS payments) periodRows
    OUTER APPLY (
      SELECT SUM(ISNULL(lines.total, 0)) AS creditSales
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (SELECT SUM(ISNULL(d.Charge_Value, 0)) AS total FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No) lines
      WHERE mr.Person_No = p.Person_No AND mr.Account_No = 2 AND ${untilEndWhere('mr.Movementrestrictions_Date')}
    ) closingSales
    OUTER APPLY (
      SELECT SUM(ISNULL(ov.Value_paid, 0)) AS payments
      FROM dbo.The_Outstandingvalues ov
      WHERE ov.Person_No = p.Person_No AND ${untilEndWhere('ov.Date_paid')}
    ) closingPayments
    OUTER APPLY (SELECT ISNULL(closingSales.creditSales, 0) AS creditSales, ISNULL(closingPayments.payments, 0) AS payments) closing
    OUTER APPLY (
      SELECT MAX(mr.Movementrestrictions_Date) AS lastCreditInvoiceDate
      FROM dbo.The_Movementrestrictions mr
      WHERE mr.Person_No = p.Person_No AND mr.Account_No = 2 AND ${untilEndWhere('mr.Movementrestrictions_Date')}
    ) lastInvoice
    WHERE p.Person_Kind = 2
      AND ABS(ISNULL(closing.creditSales, 0) - ISNULL(closing.payments, 0)) > 0.001
    ORDER BY closingBalance DESC
  `,
  supplierLedgerSummary: `
    SELECT TOP (50)
      p.Person_No AS personNo,
      p.Person_Name AS name,
      ISNULL(opening.movements, 0) - ISNULL(opening.payments, 0) AS openingBalance,
      ISNULL(periodRows.purchases, 0) AS periodPurchases,
      ISNULL(periodRows.payments, 0) AS periodPayments,
      ISNULL(closing.movements, 0) - ISNULL(closing.payments, 0) AS closingBalance
    FROM dbo.The_Persons p
    OUTER APPLY (
      SELECT SUM(ISNULL(lines.total, 0) * ISNULL(acc.Account_kind, 1)) AS movements
      FROM dbo.The_Movementrestrictions mr
      INNER JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
      OUTER APPLY (
        SELECT SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
        FROM dbo.The_Details d
        LEFT JOIN (${unitInfo}) unitInfo ON unitInfo.Item_No = d.Item_No
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) lines
      WHERE mr.Person_No = p.Person_No AND mr.Account_No IN (7,8,11,12,24) AND ${beforeStartWhere('mr.Movementrestrictions_Date')}
    ) openingMovements
    OUTER APPLY (SELECT SUM(ISNULL(ov.Value_paid, 0)) AS payments FROM dbo.The_Outstandingvalues ov WHERE ov.Person_No = p.Person_No AND ${beforeStartWhere('ov.Date_paid')}) openingPayments
    OUTER APPLY (SELECT ISNULL(openingMovements.movements, 0) AS movements, ISNULL(openingPayments.payments, 0) AS payments) opening
    OUTER APPLY (
      SELECT SUM(ISNULL(lines.total, 0)) AS purchases
      FROM dbo.The_Movementrestrictions mr
      OUTER APPLY (
        SELECT SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
        FROM dbo.The_Details d
        LEFT JOIN (${unitInfo}) unitInfo ON unitInfo.Item_No = d.Item_No
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) lines
      WHERE mr.Person_No = p.Person_No AND mr.Account_No = 7 AND ${periodWhere('mr.Movementrestrictions_Date')}
    ) periodPurchases
    OUTER APPLY (SELECT SUM(ISNULL(ov.Value_paid, 0)) AS payments FROM dbo.The_Outstandingvalues ov WHERE ov.Person_No = p.Person_No AND ${periodWhere('ov.Date_paid')}) periodPayments
    OUTER APPLY (SELECT ISNULL(periodPurchases.purchases, 0) AS purchases, ISNULL(periodPayments.payments, 0) AS payments) periodRows
    OUTER APPLY (
      SELECT SUM(ISNULL(lines.total, 0) * ISNULL(acc.Account_kind, 1)) AS movements
      FROM dbo.The_Movementrestrictions mr
      INNER JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
      OUTER APPLY (
        SELECT SUM(
          ISNULL(d.Charge_Value, 0)
          / CASE WHEN ISNULL(unitInfo.Unit_OldQuantity, 0) = 0 THEN 1 ELSE unitInfo.Unit_OldQuantity END
          * ISNULL(d.Item_Quntity, 0)
        ) AS total
        FROM dbo.The_Details d
        LEFT JOIN (${unitInfo}) unitInfo ON unitInfo.Item_No = d.Item_No
        WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No
      ) lines
      WHERE mr.Person_No = p.Person_No AND mr.Account_No IN (7,8,11,12,24) AND ${untilEndWhere('mr.Movementrestrictions_Date')}
    ) closingMovements
    OUTER APPLY (SELECT SUM(ISNULL(ov.Value_paid, 0)) AS payments FROM dbo.The_Outstandingvalues ov WHERE ov.Person_No = p.Person_No AND ${untilEndWhere('ov.Date_paid')}) closingPayments
    OUTER APPLY (SELECT ISNULL(closingMovements.movements, 0) AS movements, ISNULL(closingPayments.payments, 0) AS payments) closing
    WHERE p.Person_Kind = 3
      AND ABS(ISNULL(closing.movements, 0) - ISNULL(closing.payments, 0)) > 0.001
    ORDER BY closingBalance ASC
  `,
  inventorySummary: `
    SELECT
      COUNT(*) AS itemCount,
      SUM(ISNULL(stock.quantity, 0) * ISNULL(stock.cost, 0)) AS inventoryValue,
      SUM(CASE WHEN ISNULL(stock.quantity, 0) < 0 THEN 1 ELSE 0 END) AS negativeItems,
      SUM(CASE WHEN ISNULL(stock.quantity, 0) = 0 AND i.Last_Movement IS NOT NULL THEN 1 ELSE 0 END) AS zeroWithMovement,
      SUM(CASE WHEN i.Last_Movement IS NULL OR i.Last_Movement < DATEADD(DAY, -180, CONVERT(DATETIME, '${reportEndExclusive}', 120)) THEN 1 ELSE 0 END) AS dormantItems
    FROM dbo.The_Items i
    OUTER APPLY (
      SELECT SUM(ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0)) AS quantity, MAX(ISNULL(idt.Item_Cost, 0)) AS cost
      FROM dbo.The_ItemDetails idt
      WHERE idt.Item_No = i.Item_No
    ) stock
  `,
  topInventoryValue: `
    SELECT TOP (30)
      COALESCE(tradeName.Trade_Name, i.Scientific_Name, N'غير محدد') AS name,
      ISNULL(stock.quantity, 0) AS quantity,
      ISNULL(stock.cost, 0) AS cost,
      ISNULL(stock.quantity, 0) * ISNULL(stock.cost, 0) AS value
    FROM dbo.The_Items i
    OUTER APPLY (SELECT TOP (1) Trade_Name FROM dbo.The_Trade t WHERE t.Item_No = i.Item_No ORDER BY Trade_No) tradeName
    OUTER APPLY (
      SELECT SUM(ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0)) AS quantity, MAX(ISNULL(idt.Item_Cost, 0)) AS cost
      FROM dbo.The_ItemDetails idt
      WHERE idt.Item_No = i.Item_No
    ) stock
    ORDER BY value DESC
  `,
  negativeStock: `
    SELECT TOP (30)
      COALESCE(tradeName.Trade_Name, i.Scientific_Name, N'غير محدد') AS name,
      ISNULL(stock.quantity, 0) AS quantity,
      ISNULL(stock.cost, 0) AS cost,
      ISNULL(stock.quantity, 0) * ISNULL(stock.cost, 0) AS value
    FROM dbo.The_Items i
    OUTER APPLY (SELECT TOP (1) Trade_Name FROM dbo.The_Trade t WHERE t.Item_No = i.Item_No ORDER BY Trade_No) tradeName
    OUTER APPLY (
      SELECT SUM(ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0)) AS quantity, MAX(ISNULL(idt.Item_Cost, 0)) AS cost
      FROM dbo.The_ItemDetails idt
      WHERE idt.Item_No = i.Item_No
    ) stock
    WHERE ISNULL(stock.quantity, 0) < 0
    ORDER BY stock.quantity ASC
  `,
  auditNoDetailSales: `
    SELECT TOP (30) mr.Movementrestrictions_No AS invoiceNo, mr.Movementrestrictions_Date AS invoiceDate, ISNULL(acc.Account_Name, N'') AS accountName
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (1,2,3,4)
      AND NOT EXISTS (SELECT 1 FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No)
    ORDER BY mr.Movementrestrictions_Date DESC
  `,
  auditNoDetailPurchases: `
    SELECT TOP (30) mr.Movementrestrictions_No AS invoiceNo, mr.Movementrestrictions_Date AS invoiceDate, ISNULL(acc.Account_Name, N'') AS accountName
    FROM dbo.The_Movementrestrictions mr
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = mr.Account_No
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (7,8)
      AND NOT EXISTS (SELECT 1 FROM dbo.The_Details d WHERE d.Movementrestrictions_No = mr.Movementrestrictions_No)
    ORDER BY mr.Movementrestrictions_Date DESC
  `,
  auditReceiptsWithoutPerson: `
    SELECT TOP (30) ov.Outstandingvalues_No AS movementNo, ov.Date_paid AS movementDate, ov.Account_No, ISNULL(acc.Account_Name, N'') AS accountName, ov.Value_paid AS amount
    FROM dbo.The_Outstandingvalues ov
    LEFT JOIN dbo.The_Account acc ON acc.Account_No = ov.Account_No
    WHERE ${periodWhere('ov.Date_paid')}
      AND (ov.Person_No IS NULL OR ov.Person_No = 0)
    ORDER BY ov.Date_paid DESC
  `,
  auditBelowCost: `
    SELECT TOP (30)
      mr.Movementrestrictions_No AS invoiceNo,
      mr.Movementrestrictions_Date AS invoiceDate,
      COALESCE(tradeName.Trade_Name, item.Scientific_Name, N'غير محدد') AS itemName,
      ${salesLineTotal} AS saleTotal,
      ${salesCostTotal} AS costTotal,
      ${salesLineTotal} - ${salesCostTotal} AS difference
    FROM dbo.The_Details d
    INNER JOIN dbo.The_Movementrestrictions mr ON mr.Movementrestrictions_No = d.Movementrestrictions_No
    LEFT JOIN dbo.The_Items item ON item.Item_No = d.Item_No
    OUTER APPLY (SELECT TOP (1) Trade_Name FROM dbo.The_Trade t WHERE t.Item_No = d.Item_No ORDER BY Trade_No) tradeName
    WHERE ${periodWhere('mr.Movementrestrictions_Date')}
      AND mr.Account_No IN (1,2)
      AND ${salesLineTotal} < ${salesCostTotal}
    ORDER BY difference ASC
  `
};

async function query(name, sql) {
  const response = await fetch(`${API_BASE}/api/query-readonly`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`${name}: ${payload.message || response.statusText}`);
  }
  return payload.rows || [];
}

function n(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return n(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value) {
  return n(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-GB');
}

function escapeHtml(value) {
  return String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + n(row[key]), 0);
}

function table(columns, rows, empty = 'لا توجد بيانات') {
  if (!rows?.length) return `<p class="empty">${empty}</p>`;
  return `
    <table>
      <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${columns.map((column) => {
          const value = typeof column.value === 'function' ? column.value(row) : row[column.value];
          return `<td class="${column.className || ''}">${escapeHtml(value)}</td>`;
        }).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

function card(label, value, note = '') {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function section(title, body, options = {}) {
  return `<section class="page ${options.compact ? 'compact' : ''}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function percentage(value, total) {
  if (!n(total)) return '0%';
  return `${((n(value) / n(total)) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function rowsByAccount(paymentSummary, accountNo) {
  return paymentSummary.filter((row) => Number(row.Account_No) === accountNo);
}

function expenseRows(data) {
  return data.paymentSummary
    .filter((row) => [11, 12].includes(Number(row.Account_No)))
    .map((row) => ({
      date: 'خلال الفترة',
      name: `${row.accountName} - ${row.paymentType}`,
      amount: Math.abs(n(row.total)),
      note: 'مصروف مسجل في منظومة المحاسب 3'
    }));
}

function renderReport(data) {
  const sales = data.salesSummary[0] || {};
  const purchases = data.purchaseSummary[0] || {};
  const inventory = data.inventorySummary[0] || {};
  const customerClosing = sum(data.customerLedgerSummary, 'closingBalance');
  const supplierClosing = sum(data.supplierLedgerSummary, 'closingBalance');
  const officialSales = n(sales.netSales);
  const officialCost = n(sales.costTotal);
  const grossProfit = officialSales - officialCost;
  const systemExpenseRows = expenseRows(data);
  const registeredExpenses = systemExpenseRows.reduce((total, row) => total + n(row.amount), 0);
  const manualExpenseTotal = manualExpenses.reduce((total, row) => total + n(row.amount), 0);
  const finalExpenses = registeredExpenses + manualExpenseTotal;
  const profitBeforeManual = grossProfit - registeredExpenses;
  const profitAfterManual = grossProfit - finalExpenses;
  const cashInRows = data.paymentSummary.filter((row) => [1, 2, 3, 4, 9, 10, 26].includes(Number(row.Account_No)));
  const cashOutRows = data.paymentSummary.filter((row) => [7, 11, 13, 21, 25].includes(Number(row.Account_No)));
  const cashIn = cashInRows.reduce((total, row) => total + Math.max(0, n(row.total)), 0);
  const cashOut = cashOutRows.reduce((total, row) => total + Math.abs(Math.min(0, n(row.total))), 0) + manualExpenseTotal;
  const netCashFlow = cashIn - cashOut;
  const inventoryValue = n(inventory.inventoryValue);
  const expectedWealth = netCashFlow + inventoryValue + customerClosing - Math.abs(supplierClosing);
  const actualWealth = n(actualSnapshot.actual_cash) + n(actualSnapshot.actual_inventory_value) + n(actualSnapshot.actual_receivables) - n(actualSnapshot.actual_payables);
  const financialGap = expectedWealth - actualWealth;
  const totalPurchases = n(purchases.purchaseGross) - n(purchases.purchaseReturns);
  const totalCustomerPayments = sum(rowsByAccount(data.paymentSummary, 2), 'total');
  const totalSupplierPayments = Math.abs(sum(rowsByAccount(data.paymentSummary, 7), 'total'));
  const returns = n(sales.returnsGross);

  const warningRows = [
    { finding: 'فواتير بيع بدون أصناف', count: data.auditNoDetailSales.length, impact: 'قد تسبب نقصاً في الربح أو حركة نقدية غير مفسرة' },
    { finding: 'فواتير شراء بدون أصناف', count: data.auditNoDetailPurchases.length, impact: 'قد تؤثر على المخزون أو رصيد المورد' },
    { finding: 'حركات مالية بدون شخص واضح', count: data.auditReceiptsWithoutPerson.length, impact: 'تحتاج ربطها بالعميل/المورد الصحيح' },
    { finding: 'أصناف بيعت بأقل من التكلفة', count: data.auditBelowCost.length, impact: 'تخفض الربح أو تكشف خطأ سعر/تكلفة' },
    { finding: 'أصناف بمخزون سالب', count: n(inventory.negativeItems), impact: 'قد تعني نقص جرد أو فاتورة شراء ناقصة' }
  ];

  const conclusionPoints = [
    profitAfterManual >= 0 ? 'صافي الربح بعد المصروفات اليدوية موجب، لكن يجب ربطه بالنقد والمخزون والديون قبل اعتماده.' : 'صافي الربح بعد المصروفات اليدوية سالب ويحتاج مراجعة بنود المصروفات والتكلفة.',
    netCashFlow >= 0 ? 'التدفق النقدي موجب حسب الحركات المسجلة واليدوية.' : 'التدفق النقدي سالب، وهذا قد يفسر نقص النقدية أو زيادة الالتزامات.',
    inventoryValue > Math.abs(netCashFlow) ? 'جزء معتبر من رأس المال محبوس في المخزون حسب قيمة النظام الحالية.' : 'قيمة المخزون ليست العامل الوحيد، ويجب مراجعة النقد والديون.',
    customerClosing > 0 ? 'توجد أرباح/أموال محبوسة في ديون العملاء ويجب مطابقتها بكشوف العملاء.' : 'رصيد العملاء لا يظهر ككتلة ديون كبيرة ضمن العينة النشطة.',
    Math.abs(supplierClosing) > 0 ? 'توجد التزامات موردين يجب خصمها من رأس المال المتاح.' : 'التزامات الموردين الظاهرة محدودة حسب الحساب الحالي.',
    manualExpenseTotal > 0 ? 'المصروفات اليدوية أثرت مباشرة على صافي الربح ورأس المال.' : 'لم يتم إدخال مصروفات يدوية، لذلك التقرير لا يغطي المصروفات غير المسجلة بعد.',
    financialGap !== 0 ? 'الفجوة المالية ستبقى تقديرية حتى إدخال الموجود الفعلي: نقد، مخزون فعلي، ديون فعلية.' : 'الفجوة المالية صفر لأن الموجود الفعلي لم يتم إدخاله أو يساوي المفترض.',
    'يجب اعتماد الجرد بعد مراجعة الأصناف السالبة، الفواتير بلا أصناف، وفروقات السداد.',
    'الأرقام التاريخية للمخزون تعتمد على الموجود الحالي ما لم تتوفر لقطة جرد فعلية للفترة.',
    'قبل اعتماد التقرير، أدخل المصروفات اليدوية والموجود الفعلي في أعلى السكربت وأعد توليد HTML.'
  ];

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>تقرير الجرد المالي السنوي - المحاسب 3</title>
  <style>
    :root { --ink:#101828; --muted:#667085; --line:#d0d5dd; --soft:#f8fafc; --brand:#0f766e; --danger:#b42318; --warn:#b54708; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Tahoma, Arial, sans-serif; color: var(--ink); background: #eef2f6; line-height: 1.55; }
    .toolbar { position: sticky; top: 0; z-index: 5; display:flex; gap:10px; justify-content:space-between; align-items:center; padding:12px 18px; background:#fff; border-bottom:1px solid var(--line); }
    button { border:0; border-radius:8px; padding:10px 16px; background:var(--brand); color:#fff; font-weight:800; cursor:pointer; }
    main { width: min(100%, 1120px); margin: 0 auto; padding: 18px; }
    .page { background:#fff; border:1px solid var(--line); border-radius:10px; padding:22px; margin: 0 0 16px; box-shadow:0 12px 28px rgba(16,24,40,.08); page-break-after: always; }
    .page.compact { page-break-after:auto; }
    h1, h2, h3 { margin: 0 0 10px; line-height:1.25; }
    h1 { font-size: 26px; }
    h2 { font-size: 20px; color:#0f172a; border-bottom:2px solid var(--brand); padding-bottom:8px; }
    h3 { font-size: 15px; margin-top:14px; }
    p { margin: 6px 0 10px; }
    .muted, small { color: var(--muted); }
    .hero { display:grid; grid-template-columns: 1.2fr .8fr; gap:18px; align-items:start; }
    .metrics { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px; margin: 12px 0; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--soft); min-height:76px; }
    .metric span { display:block; color:var(--muted); font-size:12px; font-weight:700; }
    .metric strong { display:block; margin-top:5px; font-size:19px; direction:ltr; text-align:right; }
    .metric small { display:block; margin-top:3px; font-size:11px; }
    .analysis { border-right:4px solid var(--brand); background:#f0fdfa; padding:10px 12px; border-radius:8px; }
    .warning { border-right-color: var(--warn); background:#fffbeb; }
    .danger { color: var(--danger); font-weight:800; }
    table { width:100%; border-collapse:collapse; margin:10px 0 14px; font-size:12px; }
    th, td { border:1px solid var(--line); padding:6px 7px; text-align:right; vertical-align:top; }
    th { background:#f2f4f7; color:#344054; font-weight:800; }
    td.num { direction:ltr; text-align:left; white-space:nowrap; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .empty { color:var(--muted); background:var(--soft); border:1px dashed var(--line); padding:12px; border-radius:8px; }
    pre { white-space:pre-wrap; direction:ltr; text-align:left; background:#111827; color:#f9fafb; padding:12px; border-radius:8px; font-size:11px; }
    ol { margin-top:8px; }
    li { margin: 5px 0; }
    .footer-note { display:flex; justify-content:space-between; gap:20px; color:var(--muted); border-top:1px solid var(--line); padding-top:10px; margin-top:14px; font-size:12px; }
    @page { size: A4 portrait; margin: 10mm; }
    @media print {
      body { background:#fff; font-size:12px; }
      .toolbar { display:none; }
      main { width:100%; padding:0; }
      .page { border:0; box-shadow:none; border-radius:0; margin:0; padding:0; page-break-after:always; }
      .page.compact { page-break-after:auto; }
      table { page-break-inside:auto; font-size:10.5px; }
      thead { display:table-header-group; }
      tr { page-break-inside:avoid; }
      .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .metric { break-inside:avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <strong>تقرير الجرد المالي السنوي - المحاسب 3</strong>
    <button onclick="window.print()">طباعة A4 / حفظ PDF</button>
  </div>
  <main>
    <section class="page">
      <div class="hero">
        <div>
          <h1>تقرير الجرد المالي السنوي</h1>
          <p class="muted">من ${dateText(reportStart)} إلى ${dateText(reportEnd)} - قاعدة بيانات AlmohasebSQL</p>
          <p class="analysis">الغرض من التقرير هو تتبع المال خلال السنة: المبيعات، المشتريات، التحصيلات، المدفوعات، الديون، المخزون، المصروفات المسجلة واليدوية، ثم تقدير الفجوة المالية.</p>
        </div>
        <div>
          <h3>مصادر البيانات المستخدمة</h3>
          ${table([
            { label: 'المصدر', value: 'sourceTable' },
            { label: 'عدد السجلات', value: (row) => qty(row.rowCount), className: 'num' }
          ], data.sourceSummary)}
        </div>
      </div>
      <div class="metrics">
        ${card('إجمالي المبيعات', money(n(sales.salesGross)))}
        ${card('إجمالي المرتجعات', money(returns))}
        ${card('صافي المبيعات', money(officialSales))}
        ${card('إجمالي المشتريات', money(totalPurchases))}
        ${card('المصروفات المسجلة', money(registeredExpenses))}
        ${card('المصروفات اليدوية', money(manualExpenseTotal))}
        ${card('إجمالي المصروفات النهائي', money(finalExpenses))}
        ${card('سدادات العملاء', money(totalCustomerPayments))}
        ${card('مدفوعات الموردين/المشتريات', money(totalSupplierPayments))}
        ${card('الديون لنا', money(customerClosing))}
        ${card('الديون علينا', money(Math.abs(supplierClosing)))}
        ${card('قيمة المخزون حسب النظام', money(inventoryValue), 'قيمة حالية وقت توليد التقرير')}
        ${card('النقدية الداخلة', money(cashIn))}
        ${card('النقدية الخارجة', money(cashOut))}
        ${card('صافي التدفق النقدي', money(netCashFlow))}
        ${card('الفجوة المالية المتوقعة', money(financialGap))}
        ${card('صافي الربح قبل اليدوية', money(profitBeforeManual))}
        ${card('صافي الربح بعد اليدوية', money(profitAfterManual))}
      </div>
      <div class="footer-note"><span>تاريخ التوليد: ${new Date().toLocaleString('en-GB')}</span><span>توقيع المراجع: __________________</span></div>
    </section>

    ${section('1. الملخص التنفيذي والتحليل العام', `
      <div class="grid-2">
        <div>
          <h3>معادلة الربح</h3>
          ${table([
            { label: 'البند', value: 'label' },
            { label: 'القيمة', value: (row) => money(row.value), className: 'num' }
          ], [
            { label: 'صافي المبيعات', value: officialSales },
            { label: 'تكلفة البضاعة المباعة', value: officialCost },
            { label: 'مجمل الربح', value: grossProfit },
            { label: 'المصروفات المسجلة', value: registeredExpenses },
            { label: 'المصروفات اليدوية', value: manualExpenseTotal },
            { label: 'صافي الربح النهائي', value: profitAfterManual }
          ])}
        </div>
        <div>
          <h3>معادلة الفجوة المالية</h3>
          ${table([
            { label: 'البند', value: 'label' },
            { label: 'القيمة', value: (row) => money(row.value), className: 'num' }
          ], [
            { label: 'صافي التدفق النقدي', value: netCashFlow },
            { label: '+ قيمة المخزون', value: inventoryValue },
            { label: '+ الديون لنا', value: customerClosing },
            { label: '- الديون علينا', value: -Math.abs(supplierClosing) },
            { label: 'الأموال المفترض وجودها', value: expectedWealth },
            { label: 'الموجود الفعلي المدخل يدوياً', value: actualWealth },
            { label: 'الفجوة المالية', value: financialGap }
          ])}
        </div>
      </div>
      <p class="analysis warning">تنبيه: الموجود الفعلي مضبوط حالياً على صفر في متغيرات التقرير. بعد إدخال النقد الفعلي، الجرد الفعلي، الديون الفعلية، والالتزامات الفعلية ستصبح الفجوة المالية قابلة للاعتماد.</p>
    `)}

    ${section('2. تقرير المبيعات', `
      <div class="metrics">
        ${card('عدد فواتير البيع', qty(sales.invoiceCount))}
        ${card('إجمالي المبيعات', money(sales.salesGross))}
        ${card('المبيعات النقدية', money(sales.cashSales))}
        ${card('المبيعات الآجلة', money(sales.creditSales))}
        ${card('متوسط الفاتورة', money(sales.avgInvoice))}
        ${card('أعلى فاتورة', money(sales.maxInvoice))}
        ${card('أقل فاتورة', money(sales.minInvoice))}
        ${card('تكلفة المبيعات', money(sales.costTotal))}
      </div>
      <div class="grid-2">
        <div><h3>أفضل 20 صنف مبيعاً</h3>${table([
          { label: 'الصنف', value: 'name' },
          { label: 'الكمية', value: (row) => qty(row.quantity), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
        ], data.topSoldItems)}</div>
        <div><h3>أفضل 20 عميل حسب قيمة المبيعات</h3>${table([
          { label: 'العميل', value: 'name' },
          { label: 'عدد الفواتير', value: (row) => qty(row.invoiceCount), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
        ], data.topSalesCustomers)}</div>
      </div>
      <h3>الفواتير الكبيرة أو غير المعتادة</h3>
      ${table([
        { label: 'رقم الفاتورة', value: 'invoiceNo' },
        { label: 'التاريخ', value: (row) => dateText(row.invoiceDate) },
        { label: 'العميل', value: 'personName' },
        { label: 'النوع', value: 'accountName' },
        { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
      ], data.unusualSalesInvoices)}
    `)}

    ${section('3. تقرير المشتريات', `
      <div class="metrics">
        ${card('عدد فواتير الشراء', qty(purchases.invoiceCount))}
        ${card('إجمالي المشتريات', money(purchases.purchaseGross))}
        ${card('مردودات المشتريات', money(purchases.purchaseReturns))}
        ${card('صافي المشتريات', money(totalPurchases))}
        ${card('متوسط فاتورة الشراء', money(purchases.avgInvoice))}
        ${card('أعلى فاتورة شراء', money(purchases.maxInvoice))}
      </div>
      <div class="grid-2">
        <div><h3>أعلى 20 مورد</h3>${table([
          { label: 'المورد', value: 'name' },
          { label: 'عدد الفواتير', value: (row) => qty(row.invoiceCount), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
        ], data.topSuppliers)}</div>
        <div><h3>أكثر 20 صنف تم شراؤه</h3>${table([
          { label: 'الصنف', value: 'name' },
          { label: 'الكمية', value: (row) => qty(row.quantity), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
        ], data.topPurchasedItems)}</div>
      </div>
    `)}

    ${section('4. العملاء والديون لنا', `
      <div class="metrics">
        ${card('إجمالي أرصدة العملاء', money(customerClosing))}
        ${card('إجمالي السدادات', money(totalCustomerPayments))}
        ${card('عدد العملاء ذوي رصيد', qty(data.customerLedgerSummary.length))}
      </div>
      <h3>أعلى العملاء حسب الرصيد</h3>
      ${table([
        { label: 'العميل', value: 'name' },
        { label: 'رصيد أول المدة', value: (row) => money(row.openingBalance), className: 'num' },
        { label: 'مبيعات الفترة', value: (row) => money(row.periodSales), className: 'num' },
        { label: 'سداد الفترة', value: (row) => money(row.periodPayments), className: 'num' },
        { label: 'رصيد آخر المدة', value: (row) => money(row.closingBalance), className: 'num' },
        { label: 'عمر تقريبي', value: (row) => row.lastCreditInvoiceDate ? `${Math.max(0, Math.floor((new Date(reportEndExclusive) - new Date(row.lastCreditInvoiceDate)) / 86400000))} يوم` : '-' }
      ], data.customerLedgerSummary)}
      <p class="analysis">أعمار الديون تقريبية حسب آخر فاتورة آجلة متاحة لكل عميل. لتدقيق كامل يجب مطابقة كل دفعة مع فاتورتها إن وجدت.</p>
    `)}

    ${section('5. الموردون والديون علينا', `
      <div class="metrics">
        ${card('إجمالي أرصدة الموردين', money(supplierClosing))}
        ${card('إجمالي المدفوعات/الحركات', money(totalSupplierPayments))}
        ${card('عدد الموردين ذوي رصيد', qty(data.supplierLedgerSummary.length))}
      </div>
      ${table([
        { label: 'المورد', value: 'name' },
        { label: 'رصيد أول المدة', value: (row) => money(row.openingBalance), className: 'num' },
        { label: 'مشتريات الفترة', value: (row) => money(row.periodPurchases), className: 'num' },
        { label: 'مدفوعات الفترة', value: (row) => money(row.periodPayments), className: 'num' },
        { label: 'رصيد آخر المدة', value: (row) => money(row.closingBalance), className: 'num' }
      ], data.supplierLedgerSummary)}
    `)}

    ${section('6. النقدية والصندوق', `
      <div class="grid-2">
        <div><h3>النقدية الداخلة</h3>${table([
          { label: 'الحساب', value: 'accountName' },
          { label: 'طريقة الدفع', value: 'paymentType' },
          { label: 'عدد الحركات', value: (row) => qty(row.movementCount), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
        ], cashInRows)}</div>
        <div><h3>النقدية الخارجة</h3>${table([
          { label: 'الحساب', value: 'accountName' },
          { label: 'طريقة الدفع', value: 'paymentType' },
          { label: 'عدد الحركات', value: (row) => qty(row.movementCount), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.total), className: 'num' }
        ], cashOutRows)}</div>
      </div>
      <div class="metrics">${card('إجمالي الداخل', money(cashIn))}${card('إجمالي الخارج', money(cashOut))}${card('صافي التدفق النقدي', money(netCashFlow))}</div>
    `)}

    ${section('7. تقرير المصروفات', `
      <h3>مصروفات مسجلة في المنظومة</h3>
      ${table([
        { label: 'التاريخ', value: 'date' },
        { label: 'البند', value: 'name' },
        { label: 'المبلغ', value: (row) => money(row.amount), className: 'num' },
        { label: 'النسبة', value: (row) => percentage(row.amount, finalExpenses) },
        { label: 'ملاحظة', value: 'note' }
      ], systemExpenseRows)}
      <h3>مصروفات يدوية خارج المنظومة</h3>
      ${table([
        { label: 'التاريخ', value: 'date' },
        { label: 'البند', value: 'name' },
        { label: 'المبلغ', value: (row) => money(row.amount), className: 'num' },
        { label: 'النسبة', value: (row) => percentage(row.amount, finalExpenses) },
        { label: 'ملاحظة', value: 'note' }
      ], manualExpenses)}
      <pre>const manualExpenses = ${JSON.stringify(manualExpenses, null, 2)};</pre>
    `)}

    ${section('8. المخزون والجرد', `
      <div class="metrics">
        ${card('عدد الأصناف', qty(inventory.itemCount))}
        ${card('قيمة المخزون حسب النظام', money(inventoryValue))}
        ${card('أصناف سالبة الكمية', qty(inventory.negativeItems))}
        ${card('أصناف صفرية ولها حركة', qty(inventory.zeroWithMovement))}
        ${card('أصناف راكدة تقريبياً', qty(inventory.dormantItems))}
      </div>
      <div class="grid-2">
        <div><h3>الأصناف الأعلى قيمة في المخزون</h3>${table([
          { label: 'الصنف', value: 'name' },
          { label: 'الكمية', value: (row) => qty(row.quantity), className: 'num' },
          { label: 'التكلفة', value: (row) => money(row.cost), className: 'num' },
          { label: 'القيمة', value: (row) => money(row.value), className: 'num' }
        ], data.topInventoryValue)}</div>
        <div><h3>الأصناف سالبة الكمية</h3>${table([
          { label: 'الصنف', value: 'name' },
          { label: 'الكمية', value: (row) => qty(row.quantity), className: 'num' },
          { label: 'التكلفة', value: (row) => money(row.cost), className: 'num' },
          { label: 'قيمة الفرق', value: (row) => money(row.value), className: 'num' }
        ], data.negativeStock)}</div>
      </div>
      <p class="analysis warning">لا توجد لقطة جرد فعلية مدخلة في متغيرات التقرير. عند توفرها أدخل قيمة الجرد الفعلي في actual_inventory_value للمقارنة.</p>
    `)}

    ${section('9. تقرير الفجوة المالية', `
      ${table([
        { label: 'المعادلة', value: 'label' },
        { label: 'القيمة', value: (row) => money(row.value), className: 'num' }
      ], [
        { label: 'النقدية المتوقعة', value: netCashFlow },
        { label: '+ قيمة المخزون', value: inventoryValue },
        { label: '+ الديون لنا', value: customerClosing },
        { label: '- الديون علينا', value: -Math.abs(supplierClosing) },
        { label: '= الأموال المفترض وجودها', value: expectedWealth },
        { label: 'الموجود الفعلي', value: actualWealth },
        { label: 'الفجوة المالية', value: financialGap }
      ])}
      <pre>const actualSnapshot = ${JSON.stringify(actualSnapshot, null, 2)};</pre>
      <p class="analysis">تفسير الفجوة المحتمل: عجز نقدي، عجز مخزون، ديون غير محصلة، مصروفات غير مسجلة، سحوبات شخصية، أخطاء إدخال، أو فواتير ناقصة.</p>
    `)}

    ${section('10. التدقيق والتحذيرات', `
      ${table([
        { label: 'الملاحظة', value: 'finding' },
        { label: 'العدد/القيمة', value: (row) => qty(row.count), className: 'num' },
        { label: 'الأثر', value: 'impact' }
      ], warningRows)}
      <div class="grid-2">
        <div><h3>فواتير بيع بدون أصناف</h3>${table([
          { label: 'رقم الفاتورة', value: 'invoiceNo' },
          { label: 'التاريخ', value: (row) => dateText(row.invoiceDate) },
          { label: 'الحساب', value: 'accountName' }
        ], data.auditNoDetailSales)}</div>
        <div><h3>أصناف بيعت بأقل من التكلفة</h3>${table([
          { label: 'الفاتورة', value: 'invoiceNo' },
          { label: 'الصنف', value: 'itemName' },
          { label: 'البيع', value: (row) => money(row.saleTotal), className: 'num' },
          { label: 'التكلفة', value: (row) => money(row.costTotal), className: 'num' },
          { label: 'الفرق', value: (row) => money(row.difference), className: 'num' }
        ], data.auditBelowCost)}</div>
      </div>
    `)}

    ${section('11. الاستنتاج المالي', `
      <ol>${conclusionPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
      <h3>أهم 10 نقاط يجب مراجعتها قبل اعتماد الجرد</h3>
      <ol>
        <li>إدخال كل المصروفات اليدوية غير المسجلة وإعادة توليد التقرير.</li>
        <li>إدخال النقد الفعلي في الصندوق والحسابات الإلكترونية.</li>
        <li>مطابقة أعلى 20 عميل مدين مع كشوفهم الورقية أو رسائل التحصيل.</li>
        <li>مطابقة أعلى 20 مورد مع كشوف الموردين.</li>
        <li>تصفية الأصناف السالبة قبل اعتماد المخزون.</li>
        <li>مراجعة فواتير البيع والشراء بدون أصناف.</li>
        <li>مراجعة الأصناف التي بيعت بأقل من التكلفة.</li>
        <li>فصل السحوبات الشخصية عن المصروفات التشغيلية.</li>
        <li>مطابقة طرق الدفع الإلكترونية مع كشوف المصارف والمحافظ.</li>
        <li>إجراء جرد فعلي للأصناف الأعلى قيمة لأنها تؤثر مباشرة على رأس المال.</li>
      </ol>
    `, { compact: true })}
  </main>
</body>
</html>`;

  return html;
}

async function main() {
  const entries = Object.entries(queries);
  const data = {};
  for (const [name, sql] of entries) {
    process.stdout.write(`Running ${name}... `);
    data[name] = await query(name, sql);
    process.stdout.write(`${data[name].length} rows\n`);
  }
  const html = renderReport(data);
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, html, 'utf8');
  console.log(`Report written: ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
