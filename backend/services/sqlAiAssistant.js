import { executeReadonlyQuery } from '../db.js';
import { validateReadonlyQuery } from '../queryGuard.js';
import { generateGeminiResponse } from './geminiService.js';

const MAX_ROWS = 200;
const EXPLANATION_ROWS = 60;

const destructivePromptPattern =
  /\b(insert|update|delete|drop|alter|truncate|exec|execute|merge|create|grant|revoke|openrowset|opendatasource)\b|(^|[^a-z0-9_])(xp_|sp_)|احذف|حذف|امسح|مسح|عدّل|عدل|غير|غيّر|انشئ|أنشئ|اسقط|دروب/i;

const knownTables = [
  'The_Items',
  'The_ItemDetails',
  'The_Details',
  'The_Movementrestrictions',
  'The_Outstandingvalues',
  'The_Persons',
  'The_Account',
  'The_Profit',
  'The_Units',
  'The_Barcode'
];

function httpError(message, statusCode = 400, code = 'AI_ASSISTANT_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function currentLocalDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
}

function assertSafeQuestion(question) {
  const text = String(question || '').trim();
  if (!text) throw httpError('السؤال مطلوب.', 400, 'INVALID_QUESTION');
  if (destructivePromptPattern.test(text)) {
    throw httpError('هذا الطلب مرفوض لأن المساعد يعمل بوضع القراءة فقط.', 400, 'READONLY_VIOLATION');
  }
  return text;
}

function enforceTopLimit(query) {
  const safeQuery = validateReadonlyQuery(query);
  const topMatch = safeQuery.match(/\btop\s*\(?\s*(\d+)\s*\)?/i);
  if (topMatch) {
    const requested = Number(topMatch[1]);
    if (Number.isFinite(requested) && requested <= MAX_ROWS) return safeQuery;
    throw httpError(`الحد الأقصى المسموح هو TOP (${MAX_ROWS}).`, 400, 'READONLY_LIMIT');
  }

  if (/^select\s+distinct\b/i.test(safeQuery)) {
    return safeQuery.replace(/^select\s+distinct\b/i, `SELECT DISTINCT TOP (${MAX_ROWS})`);
  }

  return safeQuery.replace(/^select\b/i, `SELECT TOP (${MAX_ROWS})`);
}

function planningSystemPrompt() {
  return [
    'You are the SQL planning layer for Teryaq SQL Connector.',
    'The user asks Arabic natural language questions about Almohaseb 3 pharmacy data.',
    'Return JSON only. No markdown. No explanation outside JSON.',
    '',
    'Database: Microsoft SQL Server 2008. Use SQL Server 2008-compatible syntax only.',
    'Allowed operation: SELECT only. Always add TOP (200) unless the query is an aggregate returning a tiny result.',
    'Always alias aggregate columns with clear English names, for example AS totalRevenue, AS invoiceCount, AS balance.',
    'Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, EXEC, MERGE, CREATE, GRANT, REVOKE, INTO, xp_, sp_, OPENROWSET, OPENDATASOURCE, OFFSET/FETCH, FORMAT, CONCAT, STRING_AGG, JSON functions, EOMONTH, IIF.',
    'Never use comments or semicolon chains.',
    '',
    `Known tables: ${knownTables.join(', ')}.`,
    'Common known Almohaseb fields:',
    '- The_Persons: Person_No, Person_Name, Person_Kind. Customers usually Person_Kind = 2. Suppliers usually Person_Kind = 3.',
    '- The_Items: Item_No, Item_Name and item code/name fields may vary.',
    '- The_Barcode: item barcode data, often linked by Item_No.',
    '- The_Movementrestrictions: Movementrestrictions_No, Movementrestrictions_No, The_Movementrestrictions_Date, Account_No, User_No.',
    '- The_Details: Movementrestrictions_No, Item_No, Charge_Value, Item_Quntity, Unit_OldQuantity.',
    '- The_Outstandingvalues: Date_paid, Value_paid, Account_No, Person_No, User_No, Type_Payment.',
    '- The_Profit: official Almohaseb trading/profit snapshot fields such as Trading_Date, Trading_User, Trading_Income, Trading_Profit.',
    '',
    'If field names are uncertain, ask for clarification instead of guessing.',
    'Prefer official/source tables already used by Teryaq logic when possible.',
    '',
    'JSON shape:',
    '{"needsSql":true,"sql":"SELECT TOP (200) ...","answerIfNoSql":"","warnings":[],"suggestedFollowups":[]}',
    'If the request is unclear or unsupported, set needsSql=false and put a concise Arabic clarification in answerIfNoSql.'
  ].join('\n');
}

function explanationSystemPrompt() {
  return [
    'You are the Arabic business analyst inside Teryaq SQL Connector.',
    'Explain SQL result rows to a pharmacy owner in concise Arabic.',
    'Do not invent numbers. Use only the provided result rows and metadata.',
    'If results are empty, say clearly that no matching data was found.',
    'Return JSON only: {"answer":"","keyNumbers":[],"table":[],"suggestedFollowups":[],"warnings":[]}.',
    'table may contain a small display-ready subset, max 20 rows.'
  ].join('\n');
}

async function createSqlPlan(question) {
  const prompt = JSON.stringify({
    today: currentLocalDate(),
    question,
    output: 'JSON only'
  });
  const text = await generateGeminiResponse({
    systemInstruction: planningSystemPrompt(),
    prompt
  });
  const plan = extractJson(text);
  if (!plan) {
    throw httpError('تعذر فهم خطة Gemini بصيغة JSON آمنة.', 502, 'INVALID_AI_JSON');
  }
  return plan;
}

async function explainRows({ question, sql, rows, warnings }) {
  const prompt = JSON.stringify({
    question,
    sql,
    warnings,
    rowCount: rows.length,
    sampleRows: rows.slice(0, EXPLANATION_ROWS)
  });

  try {
    const text = await generateGeminiResponse({
      systemInstruction: explanationSystemPrompt(),
      prompt
    });
    const parsed = extractJson(text);
    if (parsed?.answer) {
      return {
        answer: parsed.answer,
        keyNumbers: Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
        table: Array.isArray(parsed.table) ? parsed.table : [],
        suggestedFollowups: Array.isArray(parsed.suggestedFollowups) ? parsed.suggestedFollowups : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
      };
    }
  } catch {
    // Keep the assistant useful even if explanation wording fails.
  }

  return {
    answer: rows.length ? `وجدت ${rows.length} صف مطابق. راجع الجدول المختصر أدناه.` : 'لم أجد بيانات مطابقة لهذا السؤال.',
    keyNumbers: [],
    table: rows.slice(0, 20),
    suggestedFollowups: ['اسألني عن فترة أخرى', 'اطلب تفاصيل أكثر'],
    warnings: []
  };
}

export async function askSqlAssistant(question) {
  const safeQuestion = assertSafeQuestion(question);
  const warnings = [];
  const plan = await createSqlPlan(safeQuestion);

  if (!plan.needsSql) {
    return {
      answer: plan.answerIfNoSql || 'أحتاج توضيحًا أكثر حتى أجيب بدقة.',
      data: [],
      sql: '',
      warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
      suggestedFollowups: Array.isArray(plan.suggestedFollowups) ? plan.suggestedFollowups : []
    };
  }

  if (!plan.sql) {
    throw httpError('لم يرجع Gemini استعلام SELECT صالح.', 502, 'MISSING_SQL');
  }

  const sql = enforceTopLimit(plan.sql);
  const result = await executeReadonlyQuery(sql);
  const rows = result.recordset || [];
  if (rows.length >= MAX_ROWS) {
    warnings.push(`تم عرض أول ${MAX_ROWS} صف فقط لحماية الأداء.`);
  }
  if (Array.isArray(plan.warnings)) warnings.push(...plan.warnings);

  const explanation = await explainRows({
    question: safeQuestion,
    sql,
    rows,
    warnings
  });

  return {
    answer: explanation.answer,
    data: explanation.table?.length ? explanation.table : rows.slice(0, 20),
    sql,
    warnings: [...warnings, ...(explanation.warnings || [])],
    suggestedFollowups: explanation.suggestedFollowups || [],
    keyNumbers: explanation.keyNumbers || []
  };
}
