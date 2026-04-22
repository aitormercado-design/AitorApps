import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));

  // Initialize Gemini
  const getApiKey = () => {
    const keys = [
      process.env.GEMINI_API_KEY, 
      process.env.VITE_GEMINI_API_KEY, 
      process.env.NEXT_PUBLIC_GEMINI_API_KEY
    ];
    // Find the first key that exists and doesn't look like a placeholder
    const validKey = keys.find(k => k && k.trim().length > 0 && !k.includes('MY_GEMINI'));
    return (validKey || '').trim();
  };
  
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("WARNING: Neither GEMINI_API_KEY nor VITE_GEMINI_API_KEY are defined in the environment.");
  } else {
    console.log("Gemini API Key found, length:", apiKey.length);
  }
  
  const ai = new GoogleGenAI({ apiKey: apiKey });

  // API Routes
  app.post('/api/gemini/generateContent', async (req, res) => {
    try {
      const { model, contents, config } = req.body;
      const currentKey = getApiKey();
      
      // Use the potentially updated key or the initial one
      const client = currentKey === apiKey ? ai : new GoogleGenAI({ apiKey: currentKey });
      
      try {
        const response = await client.models.generateContent({
          model,
          contents,
          config
        });
        res.json({ text: response.text });
      } catch (innerError: any) {
        if (innerError.message && innerError.message.includes('503') && model !== 'gemini-2.5-flash') {
          console.warn(`Model ${model} overloaded. Falling back to gemini-2.5-flash.`);
          const fallbackResponse = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents,
            config
          });
          res.json({ text: fallbackResponse.text });
        } else {
          throw innerError;
        }
      }
    } catch (error: any) {
      const currentKey = getApiKey();
      console.error('Gemini error details:', {
        message: error.message,
        keyLength: currentKey.length,
        hasKey: !!currentKey,
        status: error.status
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/gemini/chat', async (req, res) => {
    try {
      const { model, config, history, message } = req.body;
      const currentKey = getApiKey();
      const client = currentKey === apiKey ? ai : new GoogleGenAI({ apiKey: currentKey });
      
      const doChat = async (targetModel: string) => {
        const chat = client.chats.create({
          model: targetModel,
          config,
          history
        });
        return await chat.sendMessage({ message });
      };

      try {
        const response = await doChat(model);
        res.json({ text: response.text });
      } catch (innerError: any) {
         if (innerError.message && innerError.message.includes('503') && model !== 'gemini-2.5-flash') {
          console.warn(`Model ${model} overloaded. Falling back to gemini-2.5-flash.`);
          const fallbackResponse = await doChat('gemini-2.5-flash');
          res.json({ text: fallbackResponse.text });
        } else {
          throw innerError;
        }
      }
    } catch (error: any) {
      const currentKey = getApiKey();
      console.error('Gemini chat error details:', {
        message: error.message,
        keyLength: currentKey.length,
        hasKey: !!currentKey,
        status: error.status
      });
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
