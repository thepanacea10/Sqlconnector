import fs from 'node:fs/promises';
import { resolveProjectPath } from './paths.js';

const mappingConfigPath = resolveProjectPath(process.env.MAPPING_CONFIG_PATH, './config/mapping.json');

function splitIdentifierPath(rawValue) {
  const value = String(rawValue ?? '').trim();
  const parts = [];
  let buffer = '';
  let inBracket = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '[') {
      inBracket = true;
      buffer += char;
      continue;
    }

    if (char === ']' && inBracket) {
      if (next === ']') {
        buffer += ']]';
        index += 1;
        continue;
      }
      inBracket = false;
      buffer += char;
      continue;
    }

    if (char === '.' && !inBracket) {
      parts.push(buffer.trim());
      buffer = '';
      continue;
    }

    buffer += char;
  }

  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function cleanIdentifierPart(part) {
  const trimmed = String(part ?? '').trim();
  if (!trimmed) throw new Error('Empty SQL identifier part.');
  if (/[;\r\n]|--|\/\*|\*\//.test(trimmed)) {
    throw new Error('Unsafe SQL identifier in mapping configuration.');
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).replace(/]]/g, ']');
  }

  return trimmed;
}

function quoteIdentifierPart(part) {
  const clean = cleanIdentifierPart(part);
  return `[${clean.replace(/]/g, ']]')}]`;
}

function quoteIdentifierPath(value) {
  const parts = splitIdentifierPath(value);
  if (!parts.length) {
    throw new Error('SQL identifier is required.');
  }
  return parts.map(quoteIdentifierPart).join('.');
}

function quoteSingleIdentifier(value) {
  const parts = splitIdentifierPath(value);
  if (parts.length !== 1) {
    throw new Error('Field mapping must contain a single SQL identifier.');
  }
  return quoteIdentifierPart(parts[0]);
}

export async function loadMapping() {
  const raw = await fs.readFile(mappingConfigPath, 'utf8');
  return JSON.parse(raw);
}

export function hasMapping(mapping, keys) {
  return keys.every((key) => String(mapping[key] ?? '').trim());
}

export function requireMapping(mapping, keys) {
  const missing = keys.filter((key) => !String(mapping[key] ?? '').trim());
  if (missing.length) {
    const error = new Error(`Mapping configuration is missing: ${missing.join(', ')}`);
    error.code = 'MAPPING_MISSING';
    error.statusCode = 400;
    throw error;
  }
}

export function table(mapping, key) {
  requireMapping(mapping, [key]);
  return quoteIdentifierPath(mapping[key]);
}

export function field(mapping, key) {
  requireMapping(mapping, [key]);
  return quoteSingleIdentifier(mapping[key]);
}

export function fieldExpr(mapping, key, alias) {
  return `${alias}.${field(mapping, key)}`;
}

export function nullableField(mapping, key, alias, outputAlias) {
  const safeAlias = quoteIdentifierPart(outputAlias);
  if (!String(mapping[key] ?? '').trim()) {
    return `NULL AS ${safeAlias}`;
  }
  return `${fieldExpr(mapping, key, alias)} AS ${safeAlias}`;
}

export function sqlAlias(name) {
  return quoteIdentifierPart(name);
}
