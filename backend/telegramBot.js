import { executeReadonlyQuery } from './db.js';
import { getConnectionSettings } from './configStore.js';
import { processAssistantMessage } from './services/aiAssistant.js';
import { transcribeGeminiAudio } from './services/geminiService.js';

const CONTEXT_TTL_MS = 10 * 60 * 1000;
const MAX_VOICE_BYTES = 20 * 1024 * 1024;

let botStarted = false;
let lastUpdateId = 0;
let pollingTimer = null;

const chatContexts = new Map();

function botToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function allowedChatIds() {
  return new Set(
    String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function telegramUrl(method) {
  return `https://api.telegram.org/bot${botToken()}/${method}`;
}

function telegramFileUrl(filePath) {
  return `https://api.telegram.org/file/bot${botToken()}/${filePath}`;
}

function isAllowedChat(chatId) {
  const allowed = allowedChatIds();
  if (!allowed.size) return false;
  return allowed.has(String(chatId));
}

function isDevelopment() {
  return process.env.NODE_ENV !== 'production';
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return null;
  const safe = {
    lastIntent: context.lastIntent || null,
    lastItem: context.lastItem
      ? {
          itemNo: context.lastItem.itemNo ?? null,
          itemName: context.lastItem.itemName || '',
          barcode: context.lastItem.barcode || ''
        }
      : null,
    lastPerson: context.lastPerson
      ? {
          personNo: context.lastPerson.personNo ?? null,
          personName: context.lastPerson.personName || '',
          type: context.lastPerson.type || ''
        }
      : null,
    lastReport: context.lastReport
      ? {
          type: context.lastReport.type || '',
          dateFrom: context.lastReport.dateFrom || '',
          dateTo: context.lastReport.dateTo || '',
          label: context.lastReport.label || '',
          sellerId: context.lastReport.sellerId || '',
          period: context.lastReport.period || ''
        }
      : null,
    updatedAt: Number(context.updatedAt || Date.now())
  };

  if (!safe.lastIntent && !safe.lastItem && !safe.lastPerson && !safe.lastReport) return null;
  return safe;
}

function getConversationContext(chatId) {
  const context = chatContexts.get(String(chatId));
  if (!context) return { context: null, expired: false };

  const expired = Date.now() - Number(context.updatedAt || 0) > CONTEXT_TTL_MS;
  if (expired) {
    chatContexts.delete(String(chatId));
    return { context: null, expired: true };
  }

  return { context, expired: false };
}

function setConversationContext(chatId, context) {
  const safe = sanitizeContext(context);
  const key = String(chatId);
  if (!safe) {
    chatContexts.delete(key);
    return;
  }
  chatContexts.set(key, safe);
}

function logConversationState({ intent, contextUsed, contextExpired }) {
  if (!isDevelopment()) return;
    console.info('[telegram] conversation', {
      intent: intent?.action || null,
      contextUsed: Boolean(contextUsed),
    contextExpired: Boolean(contextExpired)
  });
}

function helpText() {
  return [
    'مساعد Teryaq جاهز.',
    '',
    'اسألني بشكل طبيعي، مثل:',
    'كم إيراد اليوم؟',
    'كم أرباح يوم 24/06/2026؟',
    'Tusskan',
    'كم سعره؟',
    'كم موجود منه؟',
    'رصيد العميل عبدالسلام عبدالقادر',
    'أرصدة العملاء',
    'وتقدر ترسل سؤالاً صوتياً أيضاً.',
    '',
    'الأوامر:',
    '/status - حالة الاتصال',
    '/help - هذه المساعدة'
  ].join('\n');
}

async function telegramRequest(method, payload = {}) {
  const response = await fetch(telegramUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Telegram ${method} failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function getBotInfo() {
  const response = await fetch(telegramUrl('getMe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  if (!response.ok) {
    const error = new Error(`Telegram token validation failed: ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  const data = await response.json();
  if (!data.ok) {
    const error = new Error('Telegram token validation failed.');
    error.statusCode = data.error_code || null;
    throw error;
  }

  return data.result;
}

async function sendMessage(chatId, text) {
  const chunks = [];
  const source = String(text || '').trim() || 'لا توجد نتيجة.';

  for (let index = 0; index < source.length; index += 3900) {
    chunks.push(source.slice(index, index + 3900));
  }

  for (const chunk of chunks) {
    await telegramRequest('sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true
    });
  }
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await telegramRequest('getFile', { file_id: fileId });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) {
    throw new Error('Telegram did not return a file path for the voice message.');
  }

  const response = await fetch(telegramFileUrl(filePath));
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function normalizeCommandText(text) {
  const message = String(text || '').trim();

  if (message === '/start' || message === '/help') {
    return { directReply: helpText() };
  }

  if (message === '/status') {
    return { status: true };
  }

  if (message.startsWith('/ask')) {
    const question = message.replace(/^\/ask(@\w+)?\s*/i, '').trim();
    if (!question) return { directReply: 'اكتب سؤالك بعد الأمر /ask.' };
    return { aiQuestion: question };
  }

  if (message.startsWith('/')) {
    return { directReply: 'الأمر غير معروف. استخدم /help أو اكتب سؤالك مباشرة.' };
  }

  return { aiQuestion: message };
}

async function statusText() {
  try {
    const settings = await getConnectionSettings();
    if (!settings) {
      return [
        'حالة Teryaq',
        '',
        'الباكند: يعمل',
        'SQL: غير مضبوط',
        'لا توجد إعدادات اتصال محفوظة.'
      ].join('\n');
    }

    await executeReadonlyQuery('SELECT 1 AS ok');
    return [
      'حالة Teryaq',
      '',
      'الباكند: يعمل',
      'SQL: متصل',
      `السيرفر: ${settings.server}`,
      `قاعدة البيانات: ${settings.database}`
    ].join('\n');
  } catch (error) {
    return [
      'حالة Teryaq',
      '',
      'الباكند: يعمل',
      'SQL: غير متصل',
      `الخطأ: ${error.message || 'خطأ غير معروف'}`
    ].join('\n');
  }
}

async function handleAssistantQuestion(chatId, question) {
  const { context, expired } = getConversationContext(chatId);

  try {
    const result = await processAssistantMessage(question, {
      conversationContext: context,
      contextExpired: expired
    });

    logConversationState({
      intent: result.intent,
      contextUsed: Boolean(context),
      contextExpired: expired
    });

    setConversationContext(chatId, result.nextContext);
    await sendMessage(chatId, result.response);
  } catch (error) {
    console.error('[telegram] assistant error', {
      message: error.message
    });

    await sendMessage(
      chatId,
      [
        'تعذر تشغيل المساعد الذكي حالياً.',
        'تأكد من ضبط GEMINI_API_KEY وأن الاتصال بالإنترنت يعمل.',
        `الخطأ: ${error.message || 'خطأ غير معروف'}`
      ].join('\n')
    );
  }
}

async function handleVoiceMessage(chatId, voice) {
  if (!voice?.file_id) {
    await sendMessage(chatId, 'لم أستطع قراءة الرسالة الصوتية. أرسلها مرة أخرى.');
    return;
  }

  if (voice.file_size && Number(voice.file_size) > MAX_VOICE_BYTES) {
    await sendMessage(chatId, 'الرسالة الصوتية كبيرة جداً. أرسل رسالة أقصر من فضلك.');
    return;
  }

  try {
    await sendMessage(chatId, 'استلمت الصوت، سأحوله إلى نص وأراجع البيانات.');
    const audioBuffer = await downloadTelegramFile(voice.file_id);
    if (audioBuffer.length > MAX_VOICE_BYTES) {
      await sendMessage(chatId, 'الرسالة الصوتية كبيرة جداً. أرسل رسالة أقصر من فضلك.');
      return;
    }

    const transcript = await transcribeGeminiAudio({
      audioBuffer,
      mimeType: voice.mime_type || 'audio/ogg'
    });

    if (isDevelopment()) {
      console.info('[telegram] voice transcribed', {
        chatId: String(chatId),
        textLength: transcript.length
      });
    }

    await sendMessage(chatId, `سمعتك تقول: ${transcript}`);
    await handleAssistantQuestion(chatId, transcript);
  } catch (error) {
    console.error('[telegram] voice handling error', {
      message: error.message
    });
    await sendMessage(
      chatId,
      [
        'تعذر فهم الرسالة الصوتية حالياً.',
        'تأكد من أن GEMINI_API_KEY مضبوط وأن الصوت واضح، أو أرسل السؤال كتابة.',
        `الخطأ: ${error.message || 'خطأ غير معروف'}`
      ].join('\n')
    );
  }
}

async function handleMessage(message) {
  const chatId = message?.chat?.id;
  if (!chatId) return;

  if (!isAllowedChat(chatId)) {
    await sendMessage(chatId, 'غير مصرح لهذا الحساب.');
    return;
  }

  if (message.voice) {
    await handleVoiceMessage(chatId, message.voice);
    return;
  }

  const text = String(message.text || '').trim();
  if (!text) {
    await sendMessage(chatId, 'أرسل أمراً نصياً مثل /status أو اكتب سؤالك مباشرة.');
    return;
  }

  const normalized = normalizeCommandText(text);
  if (normalized.directReply) {
    await sendMessage(chatId, normalized.directReply);
    return;
  }

  if (normalized.status) {
    await sendMessage(chatId, await statusText());
    return;
  }

  if (normalized.aiQuestion) {
    await handleAssistantQuestion(chatId, normalized.aiQuestion);
  }
}

async function pollTelegram() {
  if (!botToken() || !botStarted) return;

  try {
    const response = await telegramRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 25,
      allowed_updates: ['message']
    });

    const updates = response.result || [];
    for (const update of updates) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id || 0);
      if (update.message) {
        await handleMessage(update.message);
      }
    }
  } catch (error) {
    console.error('[telegram] polling error', {
      message: error.message
    });
  } finally {
    if (botStarted) pollingTimer = setTimeout(pollTelegram, 1000);
  }
}

export function startTelegramBot() {
  if (botStarted) return false;
  if (!botToken()) {
    console.info('[telegram] TELEGRAM_BOT_TOKEN is not configured; bot disabled.');
    return false;
  }

  botStarted = true;
  getBotInfo()
    .then((botInfo) => {
      console.info('[telegram] bot polling enabled', {
        username: botInfo?.username || null,
        allowedChatIdsConfigured: allowedChatIds().size
      });
      pollTelegram();
    })
    .catch((error) => {
      botStarted = false;
      console.error('[telegram] bot disabled: invalid TELEGRAM_BOT_TOKEN or Telegram API error', {
        statusCode: error.statusCode || null,
        message: error.message
      });
    });

  return true;
}

export function stopTelegramBot() {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
  botStarted = false;
}
