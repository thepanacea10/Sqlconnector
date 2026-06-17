const forbiddenPattern = /\b(insert|update|delete|drop|alter|truncate|exec|execute|merge)\b/i;

function hasMultipleStatements(query) {
  const withoutTrailingSemicolon = query.replace(/;\s*$/, '');
  return withoutTrailingSemicolon.includes(';');
}

export function validateReadonlyQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    const error = new Error('Query is required.');
    error.code = 'INVALID_QUERY';
    error.statusCode = 400;
    throw error;
  }

  const trimmed = query.trim();

  if (!/^select\b/i.test(trimmed)) {
    const error = new Error('Only SELECT statements are allowed.');
    error.code = 'READONLY_VIOLATION';
    error.statusCode = 400;
    throw error;
  }

  if (forbiddenPattern.test(trimmed)) {
    const error = new Error('Query contains a forbidden SQL command.');
    error.code = 'READONLY_VIOLATION';
    error.statusCode = 400;
    throw error;
  }

  if (hasMultipleStatements(trimmed)) {
    const error = new Error('Multiple SQL statements are not allowed.');
    error.code = 'READONLY_VIOLATION';
    error.statusCode = 400;
    throw error;
  }

  if (/\bselect\b[\s\S]{0,400}\binto\b/i.test(trimmed)) {
    const error = new Error('SELECT INTO is not allowed in read-only mode.');
    error.code = 'READONLY_VIOLATION';
    error.statusCode = 400;
    throw error;
  }

  return trimmed.replace(/;\s*$/, '');
}
