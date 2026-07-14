import { executeReadonlyQuery } from '../db.js';
import {
  validateItemId,
  validateItemSearch,
  validatePagination
} from '../utils/stockcountValidation.js';

const itemBaseFrom = `
  FROM dbo.The_Items i
  LEFT JOIN (
    SELECT Item_No, MIN(Trade_Name) AS Trade_Name
    FROM dbo.The_Trade
    GROUP BY Item_No
  ) tradeName ON tradeName.Item_No = i.Item_No
  LEFT JOIN (
    SELECT Item_No, MIN(CONVERT(NVARCHAR(200), Barcode)) AS Barcode
    FROM dbo.The_Barcode
    GROUP BY Item_No
  ) barcode ON barcode.Item_No = i.Item_No
  LEFT JOIN (
    SELECT
      Item_No,
      MAX(CASE WHEN Default_Unit = 1 THEN Unit_Type ELSE NULL END) AS Unit_Type,
      MAX(CASE WHEN Default_Unit = 1 THEN Unit_OldQuantity ELSE NULL END) AS Unit_OldQuantity
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
  OUTER APPLY (
    SELECT TOP (1)
      idt.Exp_date AS expiryDate
    FROM dbo.The_ItemDetails idt
    WHERE idt.Item_No = i.Item_No
      AND ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0) <> 0
    ORDER BY
      CASE WHEN idt.Exp_date IS NULL THEN 1 ELSE 0 END,
      idt.Exp_date ASC,
      idt.ItemDetails_No ASC
  ) batchInfo
`;

const itemSelect = `
  CONVERT(NVARCHAR(50), i.Item_No) AS itemId,
  COALESCE(tradeName.Trade_Name, i.Scientific_Name) AS itemName,
  barcode.Barcode AS barcode,
  ISNULL(stock.availableQuantity, 0) AS rawQuantity,
  unitInfo.Unit_OldQuantity AS packSize,
  price.Charge_Value AS sellingPrice,
  batchInfo.expiryDate AS expiryDate
`;

function bindStockcountSearch(request, sql, { search, barcode }) {
  request.input('search', sql.NVarChar, search || '');
  request.input('searchLike', sql.NVarChar, `%${search || ''}%`);
  request.input('barcode', sql.NVarChar, barcode || '');
}

function itemWhere({ includeItemId = false } = {}) {
  return `
    WHERE (
      @search = N''
      OR CONVERT(NVARCHAR(4000), i.Scientific_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), tradeName.Trade_Name) LIKE @searchLike
      OR CONVERT(NVARCHAR(4000), barcode.Barcode) LIKE @searchLike
      OR CONVERT(NVARCHAR(50), i.Item_No) LIKE @searchLike
    )
    AND (
      @barcode = N''
      OR EXISTS (
        SELECT 1
        FROM dbo.The_Barcode barcodeFilter
        WHERE barcodeFilter.Item_No = i.Item_No
          AND CONVERT(NVARCHAR(200), barcodeFilter.Barcode) = @barcode
      )
    )
    ${includeItemId ? 'AND i.Item_No = @itemNo' : ''}
  `;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatQuantity(number) {
  return Number(number || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function mapStockcountItem(row, readAt) {
  const rawQuantity = Number(row.rawQuantity || 0);
  const packSize = toNumberOrNull(row.packSize);
  const sellingPrice = toNumberOrNull(row.sellingPrice);
  const base = {
    itemId: String(row.itemId),
    itemName: row.itemName === null || row.itemName === undefined ? '' : String(row.itemName),
    barcode: row.barcode === null || row.barcode === undefined || row.barcode === '' ? null : String(row.barcode),
    rawQuantity,
    packSize,
    systemBoxes: null,
    systemUnits: null,
    formattedQuantity: null,
    sellingPrice,
    expiryDate: row.expiryDate || null,
    conversionStatus: 'ok',
    readAt
  };

  if (!Number.isFinite(rawQuantity) || rawQuantity < 0) {
    return {
      ...base,
      conversionStatus: 'negative_stock',
      formattedQuantity: `${formatQuantity(rawQuantity)} وحدة`
    };
  }

  if (!Number.isFinite(packSize) || packSize <= 0) {
    return {
      ...base,
      packSize: null,
      conversionStatus: 'missing_pack_size'
    };
  }

  if (packSize === 1) {
    return {
      ...base,
      systemBoxes: 0,
      systemUnits: rawQuantity,
      formattedQuantity: `${formatQuantity(rawQuantity)} وحدة`
    };
  }

  const systemBoxes = Math.floor(rawQuantity / packSize);
  const systemUnits = rawQuantity % packSize;
  const formattedQuantity = systemUnits > 0
    ? `${formatQuantity(systemBoxes)} علبة و${formatQuantity(systemUnits)} وحدة`
    : `${formatQuantity(systemBoxes)} علبة`;

  return {
    ...base,
    systemBoxes,
    systemUnits,
    formattedQuantity
  };
}

export function stockcountHealth() {
  return {
    service: 'stockcount-api',
    status: 'ok',
    readOnly: true,
    sqlAccess: 'backend-only',
    movementsEndpoint: 'not_implemented',
    readAt: new Date().toISOString()
  };
}

export async function listStockcountItems(query = {}) {
  const pagination = validatePagination(query);
  const filters = validateItemSearch(query);
  const readAt = new Date().toISOString();
  const rowsQuery = `
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY itemName ASC, itemId ASC) AS rowNo,
        COUNT(1) OVER () AS totalItems,
        *
      FROM (
        SELECT
          ${itemSelect}
        ${itemBaseFrom}
        ${itemWhere()}
      ) baseItems
    ) pagedItems
    WHERE pagedItems.rowNo BETWEEN @rowStart AND @rowEnd
    ORDER BY pagedItems.rowNo ASC
  `;

  const result = await executeReadonlyQuery(rowsQuery, (request, sql) => {
    bindStockcountSearch(request, sql, filters);
    request.input('rowStart', sql.Int, pagination.rowStart);
    request.input('rowEnd', sql.Int, pagination.rowEnd);
  });

  const rows = result.recordset || [];
  const totalItems = rows[0]?.totalItems || 0;
  const totalPages = totalItems ? Math.ceil(totalItems / pagination.pageSize) : 0;

  return {
    data: rows.map((row) => mapStockcountItem(row, readAt)),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1
    },
    readAt
  };
}

export async function getStockcountItem(itemId) {
  const safeItemId = validateItemId(itemId);
  const readAt = new Date().toISOString();
  const query = `
    SELECT TOP (1)
      ${itemSelect}
    ${itemBaseFrom}
    ${itemWhere({ includeItemId: true })}
  `;

  const result = await executeReadonlyQuery(query, (request, sql) => {
    bindStockcountSearch(request, sql, { search: '', barcode: '' });
    request.input('itemNo', sql.Int, safeItemId);
  });

  const item = result.recordset?.[0] || null;
  return item ? mapStockcountItem(item, readAt) : null;
}

export async function getStockcountItemStock(itemId) {
  return getStockcountItem(itemId);
}
