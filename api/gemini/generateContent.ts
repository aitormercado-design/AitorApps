import { GoogleGenAI } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
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

  const { model, contents, config: geminiConfig } = req.body;
  const ai = new GoogleGenAI({ apiKey });

  console.log('[API] MODEL:', model);

  const generate = (m: string) =>
    ai.models.generateContent({ model: m, contents, config: geminiConfig });

  try {
    const geminiPromise = generate(model);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini tardó demasiado. Inténtalo de nuevo.')), 55000)
    );
    const response = await Promise.race([geminiPromise, timeoutPromise]);
    console.log('[API] RESPONSE LENGTH:', response.text?.length);
    console.log('[API] RESPONSE (primeros 500):', response.text?.substring(0, 500));
    return res.json({ text: response.text });
  } catch (error: any) {
    if (error.message?.includes('503') && model !== 'gemini-2.5-flash') {
      try {
        console.warn('[API] 503 overloaded, falling back to gemini-2.5-flash');
        const fallback = await generate('gemini-2.5-flash');
        return res.json({ text: fallback.text });
      } catch (e2: any) {
        return res.status(500).json({ error: e2.message });
      }
    }
    console.error('[API] ERROR:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
