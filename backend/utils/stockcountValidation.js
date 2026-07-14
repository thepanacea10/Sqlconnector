export const MAX_STOCKCOUNT_PAGE_SIZE = 500;
const MAX_SEARCH_LENGTH = 120;
const MAX_BARCODE_LENGTH = 120;

function validationError(message, code = 'INVALID_STOCKCOUNT_REQUEST') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw validationError(`${fieldName} must be a positive integer.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw validationError(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

export function validatePagination(query = {}) {
  const page = parsePositiveInteger(query.page, 1, 'page');
  const pageSize = parsePositiveInteger(query.pageSize, 100, 'pageSize');

  if (pageSize > MAX_STOCKCOUNT_PAGE_SIZE) {
    throw validationError(`pageSize must not exceed ${MAX_STOCKCOUNT_PAGE_SIZE}.`);
  }

  return {
    page,
    pageSize,
    rowStart: (page - 1) * pageSize + 1,
    rowEnd: page * pageSize
  };
}

export function validateItemSearch(query = {}) {
  const search = query.search === undefined || query.search === null ? '' : String(query.search);
  const barcode = query.barcode === undefined || query.barcode === null ? '' : String(query.barcode);

  if (search.length > MAX_SEARCH_LENGTH) {
    throw validationError(`search must not exceed ${MAX_SEARCH_LENGTH} characters.`);
  }

  if (barcode.length > MAX_BARCODE_LENGTH) {
    throw validationError(`barcode must not exceed ${MAX_BARCODE_LENGTH} characters.`);
  }

  return { search, barcode };
}

export function validateItemId(value) {
  const text = String(value || '').trim();
  if (!/^\d+$/.test(text)) {
    throw validationError('itemId must be a positive integer.');
  }
  const itemId = Number(text);
  if (!Number.isSafeInteger(itemId) || itemId < 1) {
    throw validationError('itemId must be a positive integer.');
  }
  return itemId;
}
