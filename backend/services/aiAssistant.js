import * as almohasebProfile from '../profiles/almohasebProfile.js';
import { getConnectionSettings } from '../configStore.js';
import { executeReadonlyQuery } from '../db.js';
import { generateGeminiResponse } from './geminiService.js';

const SUPPORTED_INTENTS = new Set([
  'greeting',
  'help',
  'status',
  'item_last_sale',
  'item_last_purchase',
  'item_stock',
  'item_price',
  'item_details',
  'revenue_range',
  'revenue_breakdown',
  'trading_profit',
  'highest_revenue',
  'supplier_item_purchase_check',
  'supplier_last_payment',
  'customer_last_receipt',
  'customer_balance',
  'supplier_balance',
  'account_lookup',
  'account_statement',
  'smart_search',
  'customer_balances',
  'supplier_balances',
  'unsupported'
]);

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateInputFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftedDateInput(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateInputFromDate(date);
}

function currentYear() {
  return new Date().getFullYear();
}

function normalizeArabicDigits(value) {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return String(value || '').replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    return String(persian.indexOf(digit));
  });
}

function monthNumber(text) {
  const value = String(text || '').toLowerCase();
  const months = [
    ['يناير', 'كانون الثاني', 'january', 'jan'],
    ['فبراير', 'فبرائر', 'شباط', 'february', 'feb'],
    ['مارس', 'آذار', 'march', 'mar'],
    ['ابريل', 'أبريل', 'نيسان', 'april', 'apr'],
    ['مايو', 'أيار', 'may'],
    ['يونيو', 'جوان', 'حزيران', 'june', 'jun'],
    ['يوليو', 'يوليه', 'تموز', 'july', 'jul'],
    ['اغسطس', 'أغسطس', 'اوت', 'آب', 'august', 'aug'],
    ['سبتمبر', 'شتنبر', 'أيلول', 'september', 'sep'],
    ['اكتوبر', 'أكتوبر', 'تشرين الأول', 'october', 'oct'],
    ['نوفمبر', 'تشرين الثاني', 'november', 'nov'],
    ['ديسمبر', 'كانون الأول', 'december', 'dec']
  ];
  const index = months.findIndex((aliases) => aliases.some((alias) => value.includes(alias)));
  return index >= 0 ? index + 1 : null;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function formatDateInput(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseExplicitDate(text) {
  const normalized = normalizeArabicDigits(text);
  const match = normalized.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/) ||
    normalized.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!match) return null;

  if (match[1].length === 4) {
    return formatDateInput(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return formatDateInput(year, Number(match[2]), Number(match[1]));
}

function parseDateRangeFromText(text) {
  const normalized = normalizeArabicDigits(text);
  const relativeRange = parseRelativeDateRangeFromText(normalized);
  if (relativeRange.dateFrom && relativeRange.dateTo) return relativeRange;

  const explicitDates = [...normalized.matchAll(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g)]
    .map((match) => parseExplicitDate(match[0]))
    .filter(Boolean);
  if (explicitDates.length >= 2) return { dateFrom: explicitDates[0], dateTo: explicitDates[1] };
  if (explicitDates.length === 1) return { dateFrom: explicitDates[0], dateTo: explicitDates[0] };

  const month = monthNumber(normalized);
  if (!month) return {};
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : currentYear();
  const dayRange = normalized.match(/(?:من\s+)?(?:يوم\s+)?(\d{1,2})\s*(?:الى|إلى|ل|حتى|-)\s*(?:يوم\s+)?(\d{1,2})/);
  if (dayRange) {
    return {
      dateFrom: formatDateInput(year, month, Number(dayRange[1])),
      dateTo: formatDateInput(year, month, Number(dayRange[2]))
    };
  }
  return {
    dateFrom: formatDateInput(year, month, 1),
    dateTo: formatDateInput(year, month, lastDayOfMonth(year, month))
  };
}

function parseRelativeDateRangeFromText(text) {
  const lower = cleanText(normalizeArabicDigits(text)).toLowerCase();
  if (/(اليوم|النهارده|النهاردة|today)/.test(lower)) {
    const today = todayInputValue();
    return { dateFrom: today, dateTo: today };
  }
  if (/(امس|أمس|البارح|yesterday)/.test(lower)) {
    const yesterday = shiftedDateInput(-1);
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  if (/(هذا الشهر|الشهر الحالي|الشهر هذا|this month)/.test(lower)) {
    const now = new Date();
    const dateFrom = formatDateInput(now.getFullYear(), now.getMonth() + 1, 1);
    const dateTo = formatDateInput(now.getFullYear(), now.getMonth() + 1, lastDayOfMonth(now.getFullYear(), now.getMonth() + 1));
    return { dateFrom, dateTo };
  }
  return {};
}

function cleanText(value) {
  return String(value || '').replace(/[؟?،,:]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeArabicSearchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\bالفتره\b/g, '')
    .replace(/\bالفترة\b/g, '')
    .replace(/\s+/g, '');
}

function searchTextMatches(label, query) {
  const normalizedLabel = normalizeArabicSearchText(label);
  const normalizedQuery = normalizeArabicSearchText(query);
  return Boolean(normalizedLabel && normalizedQuery && (
    normalizedLabel === normalizedQuery ||
    normalizedLabel.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedLabel)
  ));
}

function extractRevenueActor(text) {
  let value = cleanText(normalizeArabicDigits(text));
  [
    /ايرادات/ig, /إيرادات/ig, /ايراد/ig, /إيراد/ig, /الايراد/ig, /الإيراد/ig, /دخل/ig,
    /كم/ig, /بالتفصيل/ig, /تفصيل/ig, /فصل/ig, /فصّل/ig,
    /اليوم/ig, /امس/ig, /أمس/ig, /البارح/ig, /هذا الشهر/ig, /الشهر الحالي/ig,
    /من يوم/ig, /الى/ig, /إلى/ig
  ].forEach((pattern) => {
    value = value.replace(pattern, ' ');
  });
  value = value.replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/g, ' ');
  return cleanText(value);
}

function removeWords(text, patterns) {
  let value = cleanText(normalizeArabicDigits(text));
  patterns.forEach((pattern) => {
    value = value.replace(pattern, ' ');
  });
  return cleanText(value);
}

function isGreeting(text) {
  const value = cleanText(text).toLowerCase();
  return /^(اهلا|أهلا|هلا|مرحبا|السلام عليكم|سلام|هاي|hello|hi)$/.test(value);
}

function isHelpQuestion(text) {
  const lower = cleanText(text).toLowerCase();
  return /^\/?help$|كيف يمكنك مساعدتي|كيف تقدر تساعدني|ماذا تستطيع|شن تقدر|مساعدة|help/.test(lower);
}

function greetingResponse() {
  const responses = [
    'أهلاً، أنا معك. اسألني عن الإيراد، الأرباح، المخزون، أو حساب أي عميل/مورد.',
    'مرحباً، قل لي ما الذي تريد مراجعته: إيراد اليوم، صنف، عميل، مورد، أو كشف حساب.',
    'أهلاً بك. أقدر أراجع لك بيانات المنظومة: الإيرادات، الأرباح، الأصناف، العملاء، الموردين، والسدادات.'
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function numberText(value) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number)
    : String(value || '');
}

function dateText(value) {
  if (!value) return 'غير متوفر';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('en-GB').format(date);
}

function itemIdentity(row) {
  if (!row) return null;
  return {
    itemNo: row.itemCode ?? row.itemId ?? null,
    itemName: row.itemName || '',
    barcode: row.barcode || ''
  };
}

function personIdentity(row, type) {
  if (!row) return null;
  return {
    personNo: row.id ?? row.personNo ?? null,
    personName: row.name || row.personName || '',
    type
  };
}

function buildNextContext({ lastIntent, lastItem, lastPerson, lastReport }) {
  return {
    lastIntent: lastIntent || null,
    lastItem: lastItem || null,
    lastPerson: lastPerson || null,
    lastReport: lastReport || null,
    updatedAt: Date.now()
  };
}

function compactRows(rows, limit = 10) {
  return (rows || []).slice(0, limit);
}

function topNonZero(rows, limit = 20) {
  return (rows || [])
    .filter((row) => Math.abs(Number(row.currentBalance || row.balance || 0)) > 0.0001)
    .sort((a, b) => Math.abs(Number(b.currentBalance || b.balance || 0)) - Math.abs(Number(a.currentBalance || a.balance || 0)))
    .slice(0, limit);
}

function itemLabel(row) {
  const code = row.itemCode ?? row.itemId ?? '';
  const barcode = row.barcode ? `، باركود ${row.barcode}` : '';
  return `${row.itemName || 'صنف غير محدد'}${code ? `، كود ${code}` : ''}${barcode}`;
}

function itemQuantity(row) {
  return row?.formattedQuantity || `${numberText(row?.currentQuantity ?? row?.currentStock)} وحدة`;
}

function itemStockLine(row) {
  const sale = row.salePrice !== null && row.salePrice !== undefined ? `، سعر البيع: ${numberText(row.salePrice)}` : '';
  const purchase = row.purchasePrice !== null && row.purchasePrice !== undefined ? `، سعر الشراء: ${numberText(row.purchasePrice)}` : '';
  return `${row.itemName}: ${itemQuantity(row)}${sale}${purchase}`;
}

function chooseClearItem(query, rows) {
  if (!rows?.length) return null;
  if (rows.length === 1) return rows[0];
  const normalized = String(query || '').trim().toLowerCase();
  const exactMatches = rows.filter((row) => (
    String(row.itemCode || '').toLowerCase() === normalized ||
    String(row.itemId || '').toLowerCase() === normalized ||
    String(row.barcode || '').toLowerCase() === normalized ||
    String(row.itemName || '').trim().toLowerCase() === normalized
  ));
  return exactMatches.length === 1 ? exactMatches[0] : null;
}

function normalizeSearchAlias(query) {
  const value = String(query || '').trim();
  const lower = value.toLowerCase();
  if (lower.includes('andalus') || lower.includes('al-andalus') || lower.includes('al andalus')) return 'الاندلس';
  return value;
}

function parseJsonObject(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1);
  if (!candidate || !candidate.trim().startsWith('{')) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function sanitizeParsedIntent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const intent = String(raw.intent || '').trim();
  if (!SUPPORTED_INTENTS.has(intent) || intent === 'unsupported') return null;
  return {
    intent,
    itemQuery: cleanText(raw.itemQuery || ''),
    supplierQuery: cleanText(raw.supplierQuery || ''),
    customerQuery: cleanText(raw.customerQuery || ''),
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.dateFrom || '')) ? raw.dateFrom : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.dateTo || '')) ? raw.dateTo : ''
  };
}

async function parseIntentWithGemini(message) {
  const systemInstruction = [
    'You extract intent for an Arabic pharmacy ERP assistant.',
    'Return JSON only. No markdown. No explanation.',
    'Never return SQL.',
    'Schema: {"intent":"","itemQuery":"","supplierQuery":"","customerQuery":"","dateFrom":"","dateTo":""}',
    'Supported intents: item_last_sale, item_last_purchase, item_stock, item_price, item_details, revenue_range, revenue_breakdown, trading_profit, highest_revenue, supplier_item_purchase_check, supplier_last_payment, customer_last_receipt, customer_balance, supplier_balance, account_lookup, account_statement, smart_search, customer_balances, supplier_balances, status, greeting, help, unsupported.',
    'Extract itemQuery/person/date ranges. Never put the full sentence in itemQuery.',
    'If the message starts with عميل or زبون, use customer_balance and put only the name in customerQuery.',
    'If the message starts with مورد or شركة, use supplier_balance and put only the name in supplierQuery.',
    'Use account_statement for كشف حساب, especially as a follow-up to the last customer or supplier.',
    'Use trading_profit for questions about ارباح, أرباح, صافي الربح, المتاجرة والأرباح.',
    'Use revenue_breakdown for follow-up requests like فصل المدفوعات الإلكترونية, تفصيل مصادر الإيراد, فصل المردودات.',
    'Use smart_search for a standalone name that could be an item, customer, or supplier.',
    'Use supplier_last_payment for questions like: متى اخر سداد للمورد احمد الصديق, اخر دفعة لشركة النور.',
    'Use customer_last_receipt for questions like: متى اخر سداد للعميل احمد, اخر قبض من الزبون.',
    'For Arabic month names, use year 2026 if no year is provided.'
  ].join('\n');
  const prompt = JSON.stringify({ message: String(message || '') });
  const response = await generateGeminiResponse({ systemInstruction, prompt });
  return sanitizeParsedIntent(parseJsonObject(response));
}

function fallbackParseIntent(message, conversationContext = {}) {
  const text = cleanText(normalizeArabicDigits(message));
  const lower = text.toLowerCase();
  const range = parseDateRangeFromText(text);

  if (isGreeting(text)) return { intent: 'greeting', ...range };
  if (isHelpQuestion(text)) return { intent: 'help', ...range };
  if (/status|الحالة|الاتصال|السيرفر|الخادم/.test(lower)) return { intent: 'status', ...range };

  if (/^(كم سعره|كم سعرها|سعره|سعرها|السعر|بكم|كم السعر|كم بيعه|كم سعر البيع)$/.test(lower)) {
    return { intent: 'item_price', itemQuery: conversationContext?.lastItem?.itemName || '', ...range };
  }
  if (/^(كم موجود منه|كم موجودة منه|كم باقي|كميته|كمية|كم مخزونه|المخزون|موجود منه)$/.test(lower)) {
    return { intent: 'item_stock', itemQuery: conversationContext?.lastItem?.itemName || '', ...range };
  }
  if (/^(متى اخر بيع|اخر بيع|آخر بيع)$/.test(lower)) {
    return { intent: 'item_last_sale', itemQuery: conversationContext?.lastItem?.itemName || '', ...range };
  }
  if (/^(متى اخر شراء|اخر شراء|آخر شراء|من اي شركة شريناه|من أي شركة شريناه)$/.test(lower)) {
    return { intent: 'item_last_purchase', itemQuery: conversationContext?.lastItem?.itemName || '', ...range };
  }

  if (/أرصدة العملاء|ارصدة العملاء|كل العملاء|قائمة العملاء|ديون العملاء/.test(lower)) return { intent: 'customer_balances', ...range };
  if (/أرصدة الموردين|ارصدة الموردين|كل الموردين|قائمة الموردين|ديون الموردين/.test(lower)) return { intent: 'supplier_balances', ...range };

  if (/(فصل|فصّل|فصللي|تفصيل|فصلها|فصلهم|حلل|تحليل).*(مدفوعات|الكتروني|إلكتروني|مصادر|طرق الدفع|مردودات|نقد|سداد|ايراد|إيراد)/.test(lower)) {
    return { intent: 'revenue_breakdown', ...range };
  }
  if (/(بالتفصيل|تفصيل|فصل|فصّل|حلل|تحليل)/.test(lower) && conversationContext?.lastReport?.type === 'revenue') {
    return { intent: 'revenue_breakdown', ...range };
  }

  if (/(اخر|آخر|متى|احدث|أحدث).*(سداد|دفعة|دفع|تحويل|صك)/.test(lower) && /(مورد|شركة)/.test(lower)) {
    return {
      intent: 'supplier_last_payment',
      supplierQuery: removeWords(text, [
        /متى/ig, /اخر/ig, /آخر/ig, /احدث/ig, /أحدث/ig, /سداد/ig, /دفعة/ig, /دفع/ig,
        /تحويل/ig, /صك/ig, /للمورد/ig, /المورد/ig, /مورد/ig, /للشركة/ig, /الشركة/ig, /شركة/ig
      ]),
      ...range
    };
  }

  if (/(اخر|آخر|متى|احدث|أحدث).*(قبض|سداد|دفعة|دفع|تحصيل)/.test(lower) && /(عميل|زبون)/.test(lower)) {
    return {
      intent: 'customer_last_receipt',
      customerQuery: removeWords(text, [
        /متى/ig, /اخر/ig, /آخر/ig, /احدث/ig, /أحدث/ig, /قبض/ig, /سداد/ig, /دفعة/ig,
        /دفع/ig, /تحصيل/ig, /من/ig, /للعميل/ig, /العميل/ig, /عميل/ig, /للزبون/ig, /الزبون/ig, /زبون/ig
      ]),
      ...range
    };
  }

  const supplierPurchase = text.match(/(?:هل\s+)?(?:اشترينا|شرينا|متى\s+اشترينا)\s+(.+?)\s+من\s+(?:شركة\s+)?(.+)$/i);
  if (supplierPurchase) {
    return {
      intent: 'supplier_item_purchase_check',
      itemQuery: cleanText(supplierPurchase[1]),
      supplierQuery: cleanText(supplierPurchase[2]),
      ...range
    };
  }

  if (/اخر\s+(?:مره|مرة)\s+تم\s+بيع|اخر\s+مرة\s+انباع|آخر\s+بيع|اخر\s+بيع|تتبع\s+بيع|متى\s+اخر\s+بيع/.test(lower)) {
    return {
      intent: 'item_last_sale',
      itemQuery: removeWords(text, [
        /متى/ig, /اخر/ig, /آخر/ig, /مره/ig, /مرة/ig, /تم/ig, /بيع/ig, /انباع/ig, /تتبع/ig
      ]),
      ...range
    };
  }

  if (/اخر\s+شراء|آخر\s+شراء|اشترينا|شرينا|متى\s+اخر\s+شراء/.test(lower)) {
    return {
      intent: 'item_last_purchase',
      itemQuery: removeWords(text, [
        /متى/ig, /اخر/ig, /آخر/ig, /مره/ig, /مرة/ig, /اشترينا/ig, /شرينا/ig, /شراء/ig, /هل/ig
      ]),
      ...range
    };
  }

  if (/اعلى|أعلى|اكثر يوم|أكثر يوم|اكبر|أكبر/.test(lower) && /ايراد|إيراد|دخل/.test(lower)) {
    return { intent: 'highest_revenue', ...range };
  }

  if (/ارباح|أرباح|ربح|الربح|صافي الربح|المتاجرة/.test(lower)) {
    return {
      intent: 'trading_profit',
      dateFrom: range.dateFrom || parseExplicitDate(text) || todayInputValue(),
      dateTo: range.dateTo || parseExplicitDate(text) || todayInputValue()
    };
  }

  if (/ايراد|إيراد|ايرادات|إيرادات|دخل/.test(lower)) {
    return {
      intent: 'revenue_range',
      dateFrom: range.dateFrom || parseExplicitDate(text) || todayInputValue(),
      dateTo: range.dateTo || parseExplicitDate(text) || todayInputValue()
    };
  }

  if (/رصيد|حساب/.test(lower) && /عميل|زبون/.test(lower)) {
    return { intent: 'customer_balance', customerQuery: removeWords(text, [/رصيد/ig, /حساب/ig, /العميل/ig, /عميل/ig, /الزبون/ig, /زبون/ig]), ...range };
  }
  if (/رصيد|حساب/.test(lower) && /مورد|شركة/.test(lower)) {
    return { intent: 'supplier_balance', supplierQuery: removeWords(text, [/رصيد/ig, /حساب/ig, /المورد/ig, /مورد/ig, /الشركة/ig, /شركة/ig]), ...range };
  }
  if (/^(كشف حساب|الكشف|كشف)$/.test(lower)) {
    return { intent: 'account_statement', customerQuery: '', supplierQuery: '', ...range };
  }
  if (/كشف حساب/.test(lower)) {
    const query = removeWords(text, [/كشف حساب/ig, /كشف/ig, /حساب/ig]);
    return { intent: 'account_statement', customerQuery: query, supplierQuery: query, ...range };
  }
  if (/^(?:ال)?(?:عميل|زبون)\s+/.test(lower)) {
    return { intent: 'customer_balance', customerQuery: removeWords(text, [/العميل/ig, /عميل/ig, /الزبون/ig, /زبون/ig]), ...range };
  }
  if (/^(?:ال)?(?:مورد|شركة)\s+/.test(lower)) {
    return { intent: 'supplier_balance', supplierQuery: removeWords(text, [/المورد/ig, /مورد/ig, /الشركة/ig, /شركة/ig]), ...range };
  }
  if (/رصيد|حساب|كشف حساب/.test(lower)) {
    return { intent: 'account_lookup', customerQuery: removeWords(text, [/رصيد/ig, /حساب/ig, /كشف حساب/ig]), supplierQuery: removeWords(text, [/رصيد/ig, /حساب/ig, /كشف حساب/ig]), ...range };
  }

  if (/كم\s+سعر|سعر|بكم/.test(lower)) {
    return { intent: 'item_price', itemQuery: removeWords(text, [/كم/ig, /سعر/ig, /السعر/ig, /بكم/ig, /من/ig]), ...range };
  }
  if (/تفاصيل|بيانات|هل.*متوفر|موجود|مخزون|كمية|صنف|دواء|كم/.test(lower)) {
    return { intent: /تفاصيل|بيانات/.test(lower) ? 'item_details' : 'item_stock', itemQuery: removeWords(text, [/تفاصيل/ig, /بيانات/ig, /هل/ig, /متوفر/ig, /موجود/ig, /مخزون/ig, /كمية/ig, /صنف/ig, /دواء/ig, /كم/ig, /من/ig]), ...range };
  }

  if (/^[\p{L}\p{N}\s.\-+]+$/u.test(text) && text.length >= 3) {
    return { intent: 'smart_search', itemQuery: text, customerQuery: text, supplierQuery: text, ...range };
  }

  return { intent: 'unsupported', ...range };
}

async function extractIntent(message, conversationContext = {}) {
  let parsed = null;
  let fallbackUsed = false;
  try {
    parsed = await parseIntentWithGemini(message);
  } catch {
    parsed = null;
  }
  const normalizedMessage = cleanText(normalizeArabicDigits(message));
  const lowerMessage = normalizedMessage.toLowerCase();
  const relativeRange = parseRelativeDateRangeFromText(normalizedMessage);
  if (
    parsed?.intent?.startsWith('item_') &&
    /^(?:ال)?(?:عميل|زبون|مورد|شركة)\s+/.test(lowerMessage)
  ) {
    parsed = null;
  }
  if (/^كشف حساب$|^كشف$|^الكشف$/.test(lowerMessage) && parsed?.intent !== 'account_statement') {
    parsed = null;
  }
  if (
    /(فصل|فصّل|فصللي|تفصيل|فصلها|فصلهم|حلل|تحليل).*(مدفوعات|الكتروني|إلكتروني|مصادر|طرق الدفع|مردودات|نقد|سداد|ايراد|إيراد)/.test(lowerMessage) &&
    parsed?.intent !== 'revenue_breakdown'
  ) {
    parsed = null;
  }
  if (
    /(بالتفصيل|تفصيل|فصل|فصّل|حلل|تحليل)/.test(lowerMessage) &&
    conversationContext?.lastReport?.type === 'revenue' &&
    parsed?.intent !== 'revenue_breakdown'
  ) {
    parsed = null;
  }
  if (
    parsed?.intent === 'item_stock' &&
    /^[\p{L}\p{N}\s.\-+]+$/u.test(normalizedMessage) &&
    !/(كم|هل|موجود|متوفر|مخزون|صنف|دواء|سعر|بيع|شراء)/.test(lowerMessage)
  ) {
    parsed = null;
  }
  if (parsed && relativeRange.dateFrom && relativeRange.dateTo) {
    parsed.dateFrom = relativeRange.dateFrom;
    parsed.dateTo = relativeRange.dateTo;
  }
  if (!parsed) {
    parsed = fallbackParseIntent(message, conversationContext);
    fallbackUsed = true;
  }
  return {
    intent: parsed.intent || 'unsupported',
    params: {
      itemQuery: parsed.itemQuery || '',
      supplierQuery: parsed.supplierQuery || '',
      customerQuery: parsed.customerQuery || '',
      dateFrom: parsed.dateFrom || '',
      dateTo: parsed.dateTo || ''
    },
    meta: { fallbackUsed }
  };
}

async function findPersonByName({ query, personKind }) {
  const term = String(query || '').trim();
  if (!term) return null;
  const compactTerm = term.replace(/\s+/g, '');
  const result = await executeReadonlyQuery(`
    SELECT TOP (1)
      p.Person_No AS id,
      p.Person_Name AS name,
      p.Person_tel AS phone,
      p.Person_Add AS address
    FROM dbo.The_Persons p
    WHERE p.Person_Kind = @personKind
      AND (
        CONVERT(NVARCHAR(4000), p.Person_Name) = @query
        OR CONVERT(NVARCHAR(4000), p.Person_Name) LIKE @queryLike
        OR REPLACE(CONVERT(NVARCHAR(4000), p.Person_Name), N' ', N'') LIKE @compactQueryLike
      )
    ORDER BY
      CASE WHEN CONVERT(NVARCHAR(4000), p.Person_Name) = @query THEN 0 ELSE 1 END,
      p.Person_Name ASC
  `, (request, sql) => {
    request.input('personKind', sql.Int, Number(personKind));
    request.input('query', sql.NVarChar, term);
    request.input('queryLike', sql.NVarChar, `%${term}%`);
    request.input('compactQueryLike', sql.NVarChar, `%${compactTerm}%`);
  });
  return result.recordset?.[0] || null;
}

async function backendStatusContext() {
  const settings = await getConnectionSettings();
  let sqlConnected = false;
  let sqlError = '';
  try {
    await executeReadonlyQuery('SELECT 1 AS ok');
    sqlConnected = true;
  } catch (error) {
    sqlError = error.message || 'SQL connection failed';
  }
  return {
    backend: { port: Number(process.env.API_PORT || 3001), status: 'running' },
    sql: { connected: sqlConnected, server: settings?.server || null, database: settings?.database || null, error: sqlError }
  };
}

async function resolveItems(query) {
  const itemQuery = normalizeSearchAlias(query);
  if (!itemQuery) return { query: itemQuery, rows: [], clearItem: null };
  const rows = await almohasebProfile.getItemStock({ search: itemQuery, availableOnly: '', sort: 'name' });
  return { query: itemQuery, rows, clearItem: chooseClearItem(itemQuery, rows) };
}

async function fetchItemByContext(item) {
  if (!item?.itemNo && !item?.barcode && !item?.itemName) return null;
  const search = item.itemNo || item.barcode || item.itemName;
  const rows = await almohasebProfile.getItemStock({ search, availableOnly: '', sort: 'name' });
  return rows.find((row) => String(row.itemCode || row.itemId || '') === String(item.itemNo || '')) ||
    rows.find((row) => String(row.barcode || '') === String(item.barcode || '')) ||
    rows[0] ||
    null;
}

function ambiguousItemResponse(query, rows) {
  const lines = compactRows(rows, 5).map((row, index) => `${index + 1}. ${itemLabel(row)} - الموجود: ${itemQuantity(row)}`);
  return [
    `وجدت أكثر من صنف مطابق لـ "${query}".`,
    ...lines,
    'أي صنف تقصد؟ اكتب الاسم أو الكود أو الباركود.'
  ].join('\n');
}

async function resolveSingleItem(query, conversationContext) {
  const effectiveQuery = query || conversationContext?.lastItem?.itemName || '';
  if (!effectiveQuery && conversationContext?.lastItem) {
    const item = await fetchItemByContext(conversationContext.lastItem);
    return { item, response: item ? '' : 'لم أجد الصنف السابق. اكتب اسم الصنف أو الكود من جديد.' };
  }
  if (!effectiveQuery) return { item: null, response: 'أي صنف تقصد؟ اكتب اسم الصنف أو الكود.' };
  const { rows, clearItem } = await resolveItems(effectiveQuery);
  if (!rows.length) return { item: null, response: `لم أجد أي صنف مطابق لـ "${effectiveQuery}".` };
  if (!clearItem) return { item: null, response: ambiguousItemResponse(effectiveQuery, rows) };
  return { item: clearItem, response: '' };
}

async function resolveSupplier(query) {
  const supplierQuery = normalizeSearchAlias(query);
  if (!supplierQuery) return { supplier: null, rows: [], response: 'اكتب اسم المورد.' };
  const rows = await almohasebProfile.getSuppliers({ search: supplierQuery });
  const supplier = rows[0] || await findPersonByName({ query: supplierQuery, personKind: 3 });
  if (!supplier) return { supplier: null, rows, response: `لم أجد مورداً باسم "${supplierQuery}".` };
  if (rows.length > 1) {
    const exact = rows.filter((row) => String(row.name || '').trim() === supplierQuery);
    if (exact.length !== 1) {
      return {
        supplier: null,
        rows,
        response: [
          `وجدت أكثر من مورد مطابق لـ "${supplierQuery}".`,
          ...compactRows(rows, 5).map((row, index) => `${index + 1}. ${row.name}`),
          'أي مورد تقصد؟ اكتب الاسم بشكل أوضح.'
        ].join('\n')
      };
    }
    return { supplier: exact[0], rows, response: '' };
  }
  return { supplier, rows, response: '' };
}

async function resolveCustomer(query) {
  const customerQuery = normalizeSearchAlias(query);
  if (!customerQuery) return { customer: null, rows: [], response: 'اكتب اسم العميل.' };
  const rows = await almohasebProfile.getCustomers({ search: customerQuery });
  const customer = rows[0] || await findPersonByName({ query: customerQuery, personKind: 2 });
  if (!customer) return { customer: null, rows, response: `لم أجد عميلاً باسم "${customerQuery}".` };
  if (rows.length > 1) {
    const exact = rows.filter((row) => String(row.name || '').trim() === customerQuery);
    if (exact.length !== 1) {
      return {
        customer: null,
        rows,
        response: [
          `وجدت أكثر من عميل مطابق لـ "${customerQuery}".`,
          ...compactRows(rows, 5).map((row, index) => `${index + 1}. ${row.name}`),
          'أي عميل تقصد؟ اكتب الاسم بشكل أوضح.'
        ].join('\n')
      };
    }
    return { customer: exact[0], rows, response: '' };
  }
  return { customer, rows, response: '' };
}

async function accountLookupContext(query) {
  const normalizedQuery = normalizeSearchAlias(query);
  if (!normalizedQuery) return { query: normalizedQuery, error: 'No account name was provided.' };
  const [customers, suppliers] = await Promise.all([
    almohasebProfile.getCustomers({ search: normalizedQuery }),
    almohasebProfile.getSuppliers({ search: normalizedQuery })
  ]);
  const customer = customers[0] || await findPersonByName({ query: normalizedQuery, personKind: 2 });
  const supplier = suppliers[0] || await findPersonByName({ query: normalizedQuery, personKind: 3 });
  return {
    query: normalizedQuery,
    customer,
    supplier,
    matches: {
      customers: compactRows(customers.length ? customers : (customer ? [customer] : []), 5),
      suppliers: compactRows(suppliers.length ? suppliers : (supplier ? [supplier] : []), 5)
    }
  };
}

function latestMovement(trackData, group) {
  return (trackData?.movements || []).find((row) => row.movementGroup === group) || null;
}

function movementLine(movement) {
  if (!movement) return 'لا توجد حركة مطابقة.';
  return [
    `التاريخ: ${dateText(movement.date)}`,
    `رقم الحركة: ${movement.movementNo || '-'}`,
    `الفاتورة: ${movement.invoiceNo || '-'}`,
    `الطرف: ${movement.personName || '-'}`,
    `الكمية: ${numberText(Math.abs(Number(movement.quantity || 0)))}`,
    `السعر: ${numberText(movement.price)}`,
    `الإجمالي: ${numberText(movement.total)}`
  ].join('\n');
}

async function handleItemStockLike(intent, conversationContext) {
  const { item, response } = await resolveSingleItem(intent.params.itemQuery, conversationContext);
  if (!item) return { response, nextContext: null };

  const sale = item.salePrice !== null && item.salePrice !== undefined ? numberText(item.salePrice) : 'غير متوفر';
  const purchase = item.purchasePrice !== null && item.purchasePrice !== undefined ? numberText(item.purchasePrice) : 'غير متوفر';
  let responseText;
  if (intent.intent === 'item_price') {
    responseText = `${item.itemName}\nسعر البيع: ${sale}\nسعر الشراء: ${purchase}`;
  } else if (intent.intent === 'item_details') {
    responseText = [
      itemLabel(item),
      `الموجود: ${itemQuantity(item)}`,
      `سعر البيع: ${sale}`,
      `سعر الشراء: ${purchase}`
    ].join('\n');
  } else {
    responseText = `متوفر:\n${itemStockLine(item)}`;
  }
  return { response: responseText, nextContext: buildNextContext({ lastIntent: intent.intent, lastItem: itemIdentity(item) }) };
}

async function handleItemLastMovement(intent, conversationContext) {
  const { item, response } = await resolveSingleItem(intent.params.itemQuery, conversationContext);
  if (!item) return { response, nextContext: null };
  const track = await almohasebProfile.trackItem({ itemId: item.itemId || item.itemCode });
  const group = intent.intent === 'item_last_purchase' ? 'purchase' : 'sale';
  const movement = latestMovement(track, group);
  const label = group === 'purchase' ? 'آخر شراء' : 'آخر بيع';
  return {
    response: movement
      ? `${label} للصنف ${item.itemName}\n${movementLine(movement)}`
      : `لا توجد حركة ${group === 'purchase' ? 'شراء' : 'بيع'} للصنف ${item.itemName}.`,
    nextContext: buildNextContext({ lastIntent: intent.intent, lastItem: itemIdentity(item) })
  };
}

async function handleSupplierItemPurchaseCheck(intent, conversationContext) {
  const { item, response: itemResponse } = await resolveSingleItem(intent.params.itemQuery, conversationContext);
  if (!item) return { response: itemResponse, nextContext: null };
  const { supplier, response: supplierResponse } = await resolveSupplier(intent.params.supplierQuery);
  if (!supplier) return { response: supplierResponse, nextContext: buildNextContext({ lastIntent: intent.intent, lastItem: itemIdentity(item) }) };

  const track = await almohasebProfile.trackItem({ itemId: item.itemId || item.itemCode });
  const supplierName = String(supplier.name || '').trim();
  const purchase = (track.movements || []).find((row) => (
    row.movementGroup === 'purchase' &&
    String(row.personName || '').trim().includes(supplierName)
  ));

  return {
    response: purchase
      ? [
          `نعم، اشترينا ${item.itemName} من ${supplier.name}.`,
          movementLine(purchase)
        ].join('\n')
      : `لا توجد عملية شراء مسجلة للصنف ${item.itemName} من ${supplier.name}.`,
    nextContext: buildNextContext({
      lastIntent: intent.intent,
      lastItem: itemIdentity(item),
      lastPerson: personIdentity(supplier, 'supplier')
    })
  };
}

function revenueResponseLines({ dateFrom, dateTo, summary, titleSuffix = '' }) {
  return [
    `إيراد ${titleSuffix ? `${titleSuffix} ` : ''}من ${dateText(dateFrom)} إلى ${dateText(dateTo)}:`,
    `الصافي: ${numberText(summary.netRevenue)}`,
    `عدد الحركات: ${numberText(summary.movementCount)}`,
    `المبيعات النقدية: ${numberText(summary.cashSalesTotal)}`,
    `سداد المدينين: ${numberText(summary.debtorPaymentsTotal)}`,
    `المدفوعات الإلكترونية: ${numberText(summary.electronicPaymentsTotal)}`,
    `المردودات: ${numberText(summary.returnsTotal)}`
  ];
}

function revenueReportContext({ dateFrom, dateTo, label = '', sellerId = '', period = '' }) {
  return {
    type: 'revenue',
    dateFrom,
    dateTo,
    label,
    sellerId: sellerId ? String(sellerId) : '',
    period: period ? String(period) : ''
  };
}

async function handleRevenueBreakdown(conversationContext, originalMessage = '') {
  const report = conversationContext?.lastReport;
  if (!report || report.type !== 'revenue') {
    return {
      response: 'تقصد تفصيل أي إيراد؟ اكتب أولاً مثل: إيراد اليوم، أو إيراد أحمد الرجيلي اليوم.',
      nextContext: null
    };
  }

  const filters = {
    dateFrom: report.dateFrom || todayInputValue(),
    dateTo: report.dateTo || report.dateFrom || todayInputValue(),
    sellerId: report.sellerId || '',
    period: report.period || ''
  };
  let label = report.label || 'الإيراد';
  const actor = extractRevenueActor(originalMessage);

  if (actor) {
    const available = await almohasebProfile.getRevenueDetails({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    const seller = (available.sellerTotals || []).find((row) => searchTextMatches(row.sellerName, actor));
    const periodOption = (available.filterOptions || []).find((row) => row.optionType === 'period' && searchTextMatches(row.optionLabel, actor));
    const sellerOption = (available.filterOptions || []).find((row) => row.optionType === 'seller' && searchTextMatches(row.optionLabel, actor));

    if (seller || sellerOption) {
      filters.sellerId = String((seller || sellerOption).sellerId || (seller || sellerOption).optionValue || '');
      filters.period = '';
      label = seller?.sellerName || sellerOption?.optionLabel || actor;
    } else if (periodOption) {
      filters.period = periodOption.optionValue || '';
      filters.sellerId = '';
      label = periodOption.optionLabel || actor;
    }
  }

  const data = await almohasebProfile.getRevenueDetails(filters);
  const lower = String(originalMessage || '').toLowerCase();
  const onlyElectronic = /الكتروني|إلكتروني|مدفوعات|بطاقات|موبي|يسر|الجمهورية/.test(lower);
  const electronicNames = new Set(['مبيعات نقدية', 'سداد مدينين', 'مردودات']);
  const sources = (data.sources || []).filter((row) => (
    onlyElectronic ? !electronicNames.has(String(row.sourceName || '')) : true
  ));

  if (!sources.length) {
    return {
      response: `لا توجد مصادر مطابقة داخل ${label || 'تقرير الإيراد'} لهذه الفترة.`,
      nextContext: buildNextContext({ lastIntent: 'revenue_breakdown', lastReport: report })
    };
  }

  const total = sources.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const count = sources.reduce((sum, row) => sum + Number(row.movementCount || 0), 0);
  const title = onlyElectronic ? 'تفصيل المدفوعات الإلكترونية' : 'تفصيل مصادر الإيراد';

  return {
    response: [
      `${title} - ${label || 'الإيراد'}`,
      `الفترة: ${dateText(filters.dateFrom)} إلى ${dateText(filters.dateTo)}`,
      ...sources.map((row) => `${row.sourceName}: ${numberText(row.total)} (${numberText(row.movementCount)} حركة)`),
      `الإجمالي: ${numberText(total)}`,
      `عدد الحركات: ${numberText(count)}`
    ].join('\n'),
    nextContext: buildNextContext({
      lastIntent: 'revenue_breakdown',
      lastReport: revenueReportContext({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        label,
        sellerId: filters.sellerId,
        period: filters.period
      })
    })
  };
}

async function handleRevenueRange(intent, originalMessage = '') {
  const dateFrom = intent.params.dateFrom || todayInputValue();
  const dateTo = intent.params.dateTo || dateFrom;
  const data = await almohasebProfile.getRevenueDetails({ dateFrom, dateTo });
  const actor = extractRevenueActor(originalMessage);

  if (actor) {
    const seller = (data.sellerTotals || []).find((row) => searchTextMatches(row.sellerName, actor));
    const periodOption = (data.filterOptions || []).find((row) => row.optionType === 'period' && searchTextMatches(row.optionLabel, actor));
    const sellerOption = (data.filterOptions || []).find((row) => row.optionType === 'seller' && searchTextMatches(row.optionLabel, actor));

    if (seller || sellerOption || periodOption) {
      const filtered = seller || sellerOption
        ? await almohasebProfile.getRevenueDetails({ dateFrom, dateTo, sellerId: (seller || sellerOption).sellerId || (seller || sellerOption).optionValue })
        : await almohasebProfile.getRevenueDetails({ dateFrom, dateTo, period: periodOption.optionValue });
      return {
        response: revenueResponseLines({
          dateFrom,
          dateTo,
          summary: filtered.summary || {},
          titleSuffix: (seller?.sellerName || sellerOption?.optionLabel || periodOption?.optionLabel || actor)
        }).join('\n'),
        nextContext: buildNextContext({
          lastIntent: 'revenue_range',
          lastReport: revenueReportContext({
            dateFrom,
            dateTo,
            label: (seller?.sellerName || sellerOption?.optionLabel || periodOption?.optionLabel || actor),
            sellerId: (seller || sellerOption)?.sellerId || (seller || sellerOption)?.optionValue || '',
            period: periodOption?.optionValue || ''
          })
        })
      };
    }

    return {
      response: [
        `لم أجد فترة أو مستخدماً باسم "${actor}" في إيراد هذه الفترة.`,
        'الموجود:',
        ...(data.sellerTotals || []).slice(0, 8).map((row) => `${row.sellerName}: ${numberText(row.total)}`)
      ].join('\n'),
      nextContext: buildNextContext({ lastIntent: 'revenue_range', lastReport: revenueReportContext({ dateFrom, dateTo, label: 'الإيراد' }) })
    };
  }

  const summary = data.summary || {};
  return {
    response: revenueResponseLines({ dateFrom, dateTo, summary }).join('\n'),
    nextContext: buildNextContext({ lastIntent: 'revenue_range', lastReport: revenueReportContext({ dateFrom, dateTo, label: 'إيراد الفترة' }) })
  };
}

async function handleTradingProfit(intent) {
  const dateFrom = intent.params.dateFrom || todayInputValue();
  const dateTo = intent.params.dateTo || dateFrom;
  const data = await almohasebProfile.getTradingProfit({ dateFrom, dateTo });
  const summary = data.summary || {};
  const reconciliation = data.reconciliation || {};
  const lines = [
    `الأرباح والمتاجرة من ${dateText(dateFrom)} إلى ${dateText(dateTo)}:`,
    `الإيراد الرسمي: ${numberText(summary.revenue)}`,
    `تكلفة البضاعة: ${numberText(summary.costOfGoods)}`,
    `صافي الربح: ${numberText(summary.netProfit)}`,
    `عدد الفترات: ${numberText(summary.liveRowCount)}`
  ];
  if (reconciliation.isSnapshotIncomplete) {
    lines.push(`تنبيه: الملخص الرسمي غير مكتمل. الإيراد الفعلي حسب إيراد اليوم: ${numberText(reconciliation.actualRevenue)}، الفرق: ${numberText(reconciliation.shortfall)}.`);
  }
  return {
    response: lines.join('\n'),
    nextContext: buildNextContext({ lastIntent: 'trading_profit' })
  };
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

async function handleHighestRevenue(intent, originalMessage) {
  const dateFrom = intent.params.dateFrom || parseDateRangeFromText(originalMessage).dateFrom || todayInputValue();
  const dateTo = intent.params.dateTo || parseDateRangeFromText(originalMessage).dateTo || dateFrom;
  const data = await almohasebProfile.getRevenueDetails({ dateFrom, dateTo });
  const lower = String(originalMessage || '').toLowerCase();

  if (/فترة|فتره|shift|period/.test(lower)) {
    const row = (data.sellerTotals || []).slice().sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0];
    return {
      response: row ? `أعلى فترة إيراد: ${row.sellerName}\nالإيراد: ${numberText(row.total)}\nعدد الحركات: ${numberText(row.movementCount)}` : 'لا توجد بيانات إيراد للفترة المطلوبة.',
      nextContext: buildNextContext({ lastIntent: 'highest_revenue' })
    };
  }

  if (/مصدر|طريقة|source/.test(lower)) {
    const row = (data.sources || []).slice().sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0];
    return {
      response: row ? `أعلى مصدر إيراد: ${row.sourceName}\nالإيراد: ${numberText(row.total)}\nعدد الحركات: ${numberText(row.movementCount)}` : 'لا توجد بيانات إيراد للفترة المطلوبة.',
      nextContext: buildNextContext({ lastIntent: 'highest_revenue' })
    };
  }

  const byDay = new Map();
  (data.rows || []).forEach((row) => {
    const key = dateKey(row.movementDate || row.date);
    const current = byDay.get(key) || { date: key, total: 0, movementCount: 0 };
    current.total += Number(row.amount || 0);
    current.movementCount += 1;
    byDay.set(key, current);
  });
  const day = Array.from(byDay.values()).sort((a, b) => b.total - a.total)[0];
  return {
    response: day ? `أعلى يوم إيراد: ${dateText(day.date)}\nالإيراد: ${numberText(day.total)}\nعدد الحركات: ${numberText(day.movementCount)}` : 'لا توجد بيانات إيراد للفترة المطلوبة.',
    nextContext: buildNextContext({ lastIntent: 'highest_revenue' })
  };
}

async function handleAccountLookup(intent) {
  const query = intent.params.customerQuery || intent.params.supplierQuery;
  const data = await accountLookupContext(query);
  if (data.customer && data.supplier) {
    return {
      response: [
        `وجدت عميل ومورد باسم قريب من "${data.query}".`,
        `العميل: ${data.customer.name}`,
        `المورد: ${data.supplier.name}`,
        'اكتب: رصيد العميل ... أو رصيد المورد ...'
      ].join('\n'),
      nextContext: null
    };
  }
  if (data.customer) {
    return {
      response: `العميل ${data.customer.name}\nالرصيد: ${numberText(data.customer.currentBalance ?? data.customer.balance ?? 0)}`,
      nextContext: buildNextContext({ lastIntent: 'customer_balance', lastPerson: personIdentity(data.customer, 'customer') })
    };
  }
  if (data.supplier) {
    return {
      response: `المورد ${data.supplier.name}\nالرصيد: ${numberText(data.supplier.currentBalance ?? data.supplier.balance ?? 0)}`,
      nextContext: buildNextContext({ lastIntent: 'supplier_balance', lastPerson: personIdentity(data.supplier, 'supplier') })
    };
  }
  return { response: `لم أجد عميلاً أو مورداً باسم "${data.query}".`, nextContext: null };
}

function statementPreviewLine(row) {
  const debit = Number(row.debit || 0);
  const credit = Number(row.credit || 0);
  const parts = [
    dateText(row.date),
    row.description || 'حركة',
    debit ? `مدين ${numberText(debit)}` : '',
    credit ? `دائن ${numberText(credit)}` : '',
    `الرصيد ${numberText(row.runningBalance)}`
  ].filter(Boolean);
  return parts.join(' | ');
}

async function handleAccountStatement(intent, conversationContext) {
  const query = cleanText(intent.params.customerQuery || intent.params.supplierQuery || '');
  let person = conversationContext?.lastPerson || null;

  if (query) {
    const data = await accountLookupContext(query);
    if (data.customer && data.supplier) {
      return {
        response: [
          `وجدت عميل ومورد باسم قريب من "${data.query}".`,
          `العميل: ${data.customer.name}`,
          `المورد: ${data.supplier.name}`,
          'اكتب: كشف حساب العميل ... أو كشف حساب المورد ...'
        ].join('\n'),
        nextContext: null
      };
    }
    if (data.customer) person = personIdentity(data.customer, 'customer');
    if (data.supplier) person = personIdentity(data.supplier, 'supplier');
    if (!person) return { response: `لم أجد عميلاً أو مورداً باسم "${data.query}". من تقصد؟`, nextContext: null };
  }

  if (!person?.personNo) {
    return { response: 'كشف حساب من؟ اكتب اسم العميل أو المورد.', nextContext: null };
  }

  const rows = person.type === 'supplier'
    ? await almohasebProfile.getSupplierStatement(person.personNo, { showArchived: false })
    : await almohasebProfile.getCustomerStatement(person.personNo, { showArchived: false });
  const title = person.type === 'supplier' ? 'كشف حساب المورد' : 'كشف حساب العميل';
  const currentBalance = rows[0]?.runningBalance ?? 0;
  const preview = compactRows(rows, 6).map(statementPreviewLine);

  return {
    response: [
      `${title} ${person.personName}`,
      `الرصيد الحالي: ${numberText(currentBalance)}`,
      preview.length ? 'آخر الحركات:' : 'لا توجد حركات في كشف الحساب.',
      ...preview
    ].join('\n'),
    nextContext: buildNextContext({ lastIntent: 'account_statement', lastPerson: person })
  };
}

async function handleSmartSearch(intent, conversationContext) {
  const query = normalizeSearchAlias(intent.params.customerQuery || intent.params.supplierQuery || intent.params.itemQuery);
  if (!query) return { response: 'ما الذي تريد البحث عنه؟ اكتب اسم صنف أو عميل أو مورد.', nextContext: null };

  const [customers, suppliers, itemResult] = await Promise.all([
    almohasebProfile.getCustomers({ search: query }),
    almohasebProfile.getSuppliers({ search: query }),
    resolveItems(query)
  ]);
  const customer = customers[0] || await findPersonByName({ query, personKind: 2 });
  const supplier = suppliers[0] || await findPersonByName({ query, personKind: 3 });
  const hasClearItem = Boolean(itemResult.clearItem);

  if (customer && supplier) {
    return {
      response: [
        `وجدت عميل ومورد قريبين من "${query}".`,
        `العميل: ${customer.name}`,
        `المورد: ${supplier.name}`,
        'اكتب: عميل ... أو مورد ... حتى أحدد المقصود.'
      ].join('\n'),
      nextContext: null
    };
  }

  if ((customer || supplier) && hasClearItem) {
    return {
      response: [
        `وجدت حساباً وصنفاً قريبين من "${query}".`,
        customer ? `الحساب: العميل ${customer.name}` : `الحساب: المورد ${supplier.name}`,
        `الصنف: ${itemResult.clearItem.itemName}`,
        'اكتب: عميل ... أو صنف ... حتى أحدد المقصود.'
      ].join('\n'),
      nextContext: null
    };
  }

  if (customer) {
    return {
      response: `العميل ${customer.name}\nالرصيد: ${numberText(customer.currentBalance ?? customer.balance ?? 0)}`,
      nextContext: buildNextContext({ lastIntent: 'customer_balance', lastPerson: personIdentity(customer, 'customer') })
    };
  }

  if (supplier) {
    return {
      response: `المورد ${supplier.name}\nالرصيد: ${numberText(supplier.currentBalance ?? supplier.balance ?? 0)}`,
      nextContext: buildNextContext({ lastIntent: 'supplier_balance', lastPerson: personIdentity(supplier, 'supplier') })
    };
  }

  if (itemResult.rows.length) {
    return handleItemStockLike({ intent: 'item_stock', params: { itemQuery: query } }, conversationContext);
  }

  return {
    response: `لم أجد "${query}" كعميل أو مورد أو صنف. وضّح لي: هل تقصد حساباً أم صنفاً؟`,
    nextContext: null
  };
}

async function handleCustomerBalance(intent) {
  const query = normalizeSearchAlias(intent.params.customerQuery);
  if (!query) return { response: 'اكتب اسم العميل.', nextContext: null };
  const customers = await almohasebProfile.getCustomers({ search: query });
  const customer = customers[0] || await findPersonByName({ query, personKind: 2 });
  return {
    response: customer ? `العميل ${customer.name}\nالرصيد: ${numberText(customer.currentBalance ?? customer.balance ?? 0)}` : `لم أجد عميلاً باسم "${query}".`,
    nextContext: customer ? buildNextContext({ lastIntent: 'customer_balance', lastPerson: personIdentity(customer, 'customer') }) : null
  };
}

async function handleSupplierBalance(intent) {
  const query = normalizeSearchAlias(intent.params.supplierQuery);
  if (!query) return { response: 'اكتب اسم المورد.', nextContext: null };
  const { supplier, response } = await resolveSupplier(query);
  return {
    response: supplier ? `المورد ${supplier.name}\nالرصيد: ${numberText(supplier.currentBalance ?? supplier.balance ?? 0)}` : response,
    nextContext: supplier ? buildNextContext({ lastIntent: 'supplier_balance', lastPerson: personIdentity(supplier, 'supplier') }) : null
  };
}

async function handleSupplierLastPayment(intent) {
  const query = normalizeSearchAlias(intent.params.supplierQuery);
  if (!query) return { response: 'اكتب اسم المورد.', nextContext: null };
  const { supplier, response } = await resolveSupplier(query);
  if (!supplier) return { response, nextContext: null };

  const payments = await almohasebProfile.getSupplierPayments(supplier.id);
  const payment = payments[0];
  if (!payment) {
    return {
      response: `لا توجد سدادات مسجلة للمورد ${supplier.name}.`,
      nextContext: buildNextContext({ lastIntent: 'supplier_last_payment', lastPerson: personIdentity(supplier, 'supplier') })
    };
  }

  const lines = [
    `آخر سداد للمورد ${supplier.name}`,
    `التاريخ: ${dateText(payment.date)}`,
    `المبلغ: ${numberText(payment.amount)}`,
    `طريقة الدفع: ${payment.paymentMethod || '-'}`,
    `رقم الحركة: ${payment.paymentNumber || '-'}`
  ];
  if (payment.invoiceNumber) lines.push(`الفاتورة: ${payment.invoiceNumber}`);
  if (payment.notes) lines.push(`ملاحظات: ${payment.notes}`);

  return {
    response: lines.join('\n'),
    nextContext: buildNextContext({ lastIntent: 'supplier_last_payment', lastPerson: personIdentity(supplier, 'supplier') })
  };
}

async function handleCustomerLastReceipt(intent) {
  const query = normalizeSearchAlias(intent.params.customerQuery);
  if (!query) return { response: 'اكتب اسم العميل.', nextContext: null };
  const { customer, response } = await resolveCustomer(query);
  if (!customer) return { response, nextContext: null };

  const receipts = await almohasebProfile.getCustomerReceipts(customer.id);
  const receipt = receipts[0];
  if (!receipt) {
    return {
      response: `لا توجد قبض/سدادات مسجلة للعميل ${customer.name}.`,
      nextContext: buildNextContext({ lastIntent: 'customer_last_receipt', lastPerson: personIdentity(customer, 'customer') })
    };
  }

  const lines = [
    `آخر قبض من العميل ${customer.name}`,
    `التاريخ: ${dateText(receipt.date)}`,
    `المبلغ: ${numberText(receipt.amount)}`,
    `رقم الحركة: ${receipt.receiptNumber || '-'}`
  ];
  if (receipt.notes) lines.push(`ملاحظات: ${receipt.notes}`);

  return {
    response: lines.join('\n'),
    nextContext: buildNextContext({ lastIntent: 'customer_last_receipt', lastPerson: personIdentity(customer, 'customer') })
  };
}

function debugAssistant({ intent, contextUsed, contextExpired, fallbackUsed }) {
  if (process.env.NODE_ENV === 'production') return;
  console.info('[ai-assistant] parsed', {
    intent: intent?.intent || null,
    itemQuery: intent?.params?.itemQuery || '',
    supplierQuery: intent?.params?.supplierQuery || '',
    customerQuery: intent?.params?.customerQuery || '',
    dateRange: [intent?.params?.dateFrom || '', intent?.params?.dateTo || ''].filter(Boolean).join('..'),
    contextUsed: Boolean(contextUsed),
    contextExpired: Boolean(contextExpired),
    fallbackParserUsed: Boolean(fallbackUsed)
  });
}

export async function processAssistantMessage(message, options = {}) {
  const text = String(message || '').trim();
  if (!text) {
    const error = new Error('message is required');
    error.statusCode = 400;
    throw error;
  }

  const conversationContext = options.conversationContext || {};
  const intent = await extractIntent(text, conversationContext);
  debugAssistant({
    intent,
    contextUsed: Boolean(conversationContext?.lastItem || conversationContext?.lastPerson || conversationContext?.lastReport || conversationContext?.lastIntent),
    contextExpired: Boolean(options.contextExpired),
    fallbackUsed: intent.meta?.fallbackUsed
  });

  let result;
  switch (intent.intent) {
    case 'greeting':
      result = { response: greetingResponse(), nextContext: buildNextContext({ lastIntent: 'greeting' }) };
      break;
    case 'help':
      result = {
        response: [
          'أقدر أساعدك في الإيراد، الأرباح، المخزون، أسعار الأصناف، آخر بيع/شراء، وحسابات العملاء والموردين.',
          'أفهم أيضاً المتابعة مثل: كم سعره؟ كم موجود منه؟ كشف حساب؟',
          'مثال: إيرادات اليوم، أرباح اليوم، Tusskan، عميل البهيجي، متى آخر سداد للمورد أحمد الصديق.'
        ].join('\n'),
        nextContext: null
      };
      break;
    case 'status': {
      const status = await backendStatusContext();
      result = {
        response: [
          'حالة Teryaq',
          `الباكند: ${status.backend.status}`,
          `SQL: ${status.sql.connected ? 'متصل' : 'غير متصل'}`,
          `قاعدة البيانات: ${status.sql.database || '-'}`
        ].join('\n'),
        nextContext: buildNextContext({ lastIntent: 'status' })
      };
      break;
    }
    case 'item_stock':
    case 'item_price':
    case 'item_details':
      result = await handleItemStockLike(intent, conversationContext);
      break;
    case 'item_last_sale':
    case 'item_last_purchase':
      result = await handleItemLastMovement(intent, conversationContext);
      break;
    case 'supplier_item_purchase_check':
      result = await handleSupplierItemPurchaseCheck(intent, conversationContext);
      break;
    case 'revenue_range':
      result = await handleRevenueRange(intent, text);
      break;
    case 'revenue_breakdown':
      result = await handleRevenueBreakdown(conversationContext, text);
      break;
    case 'trading_profit':
      result = await handleTradingProfit(intent);
      break;
    case 'highest_revenue':
      result = await handleHighestRevenue(intent, text);
      break;
    case 'supplier_last_payment':
      result = await handleSupplierLastPayment(intent);
      break;
    case 'customer_last_receipt':
      result = await handleCustomerLastReceipt(intent);
      break;
    case 'customer_balance':
      result = await handleCustomerBalance(intent);
      break;
    case 'supplier_balance':
      result = await handleSupplierBalance(intent);
      break;
    case 'account_lookup':
      result = await handleAccountLookup(intent);
      break;
    case 'account_statement':
      result = await handleAccountStatement(intent, conversationContext);
      break;
    case 'smart_search':
      result = await handleSmartSearch(intent, conversationContext);
      break;
    case 'customer_balances': {
      const customers = topNonZero(await almohasebProfile.getCustomers({ search: '' }), 20);
      result = {
        response: ['أعلى أرصدة العملاء:', ...customers.slice(0, 10).map((row, index) => `${index + 1}. ${row.name}: ${numberText(row.currentBalance)}`)].join('\n'),
        nextContext: buildNextContext({ lastIntent: 'customer_balances' })
      };
      break;
    }
    case 'supplier_balances': {
      const suppliers = topNonZero(await almohasebProfile.getSuppliers({ search: '' }), 20);
      result = {
        response: ['أعلى أرصدة الموردين:', ...suppliers.slice(0, 10).map((row, index) => `${index + 1}. ${row.name}: ${numberText(row.currentBalance)}`)].join('\n'),
        nextContext: buildNextContext({ lastIntent: 'supplier_balances' })
      };
      break;
    }
    default:
      result = { response: 'لم أفهم الطلب. اكتب مثلاً: متى آخر مرة تم بيع Tusskan، أو كم إيراد شهر يونيو.', nextContext: null };
  }

  return {
    response: result.response,
    intent: { action: intent.intent, params: intent.params },
    context: {},
    nextContext: result.nextContext || null
  };
}
