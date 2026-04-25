import { GoogleGenAI } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const getApiKey = () => {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.VITE_GEMINI_API_KEY,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY,
  ];
  const valid = keys.find(k => k && k.trim().length > 0 && !k.includes('MY_GEMINI'));
  return (valid || '').trim();
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { model, config: geminiConfig, history, message } = req.body;
  const ai = new GoogleGenAI({ apiKey });

  const doChat = (m: string) => {
    const chat = ai.chats.create({ model: m, config: geminiConfig, history });
    return chat.sendMessage({ message });
  };

  try {
    const chatPromise = doChat(model);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini tardó demasiado. Inténtalo de nuevo.')), 55000)
    );
    const response = await Promise.race([chatPromise, timeoutPromise]);
    return res.json({ text: response.text });
  } catch (error: any) {
    if (error.message?.includes('503') && model !== 'gemini-2.5-flash') {
      try {
        const fallback = await doChat('gemini-2.5-flash');
        return res.json({ text: fallback.text });
      } catch (e2: any) {
        return res.status(500).json({ error: e2.message });
      }
    }
    console.error('[API] Chat error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
