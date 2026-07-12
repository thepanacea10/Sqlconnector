import { GoogleGenAI } from '@google/genai';

let cachedClient = null;

function apiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function modelName() {
  return String(process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.5-flash').trim();
}

function getClient() {
  const key = apiKey();
  if (!key) {
    const error = new Error('GEMINI_API_KEY is not configured.');
    error.statusCode = 503;
    throw error;
  }
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey: key });
  return cachedClient;
}

export async function generateGeminiResponse({ systemInstruction, prompt }) {
  const client = getClient();
  try {
    const response = await client.models.generateContent({
      model: modelName(),
      contents: String(prompt || ''),
      config: {
        systemInstruction: String(systemInstruction || ''),
        temperature: 0.2
      }
    });

    const text = response.text;
    if (!text) {
      const error = new Error('Gemini returned an empty response.');
      error.statusCode = 502;
      throw error;
    }
    return text.trim();
  } catch (error) {
    const wrapped = new Error(`Gemini request failed: ${error.message || 'Unknown Gemini error'}`);
    wrapped.statusCode = error.statusCode || 502;
    throw wrapped;
  }
}

export async function transcribeGeminiAudio({ audioBuffer, mimeType }) {
  const client = getClient();
  const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || []);
  if (!buffer.length) {
    const error = new Error('Audio file is empty.');
    error.statusCode = 400;
    throw error;
  }

  try {
    const response = await client.models.generateContent({
      model: modelName(),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                'حوّل هذه الرسالة الصوتية إلى نص عربي واضح فقط.',
                'إذا كان الكلام باللهجة الليبية أو العربية العامية فاكتبه كما هو بمعنى واضح.',
                'لا تضف شرحاً ولا إجابة، فقط نص السؤال المنطوق.'
              ].join('\n')
            },
            {
              inlineData: {
                mimeType: String(mimeType || 'audio/ogg'),
                data: buffer.toString('base64')
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0
      }
    });

    const text = response.text;
    if (!text || !text.trim()) {
      const error = new Error('Gemini returned an empty transcription.');
      error.statusCode = 502;
      throw error;
    }
    return text.trim();
  } catch (error) {
    const wrapped = new Error(`Gemini transcription failed: ${error.message || 'Unknown Gemini error'}`);
    wrapped.statusCode = error.statusCode || 502;
    throw wrapped;
  }
}
