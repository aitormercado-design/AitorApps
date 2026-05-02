import Groq from 'groq-sdk';
import type { NutritionalInfo } from '../types/nutrition';

const GROQ_API_KEY = (import.meta.env.VITE_GROQ_API_KEY as string) || '';
const OPENROUTER_API_KEY = (import.meta.env.VITE_OPENROUTER_API_KEY as string) || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const groqVision = new Groq({
  apiKey: GROQ_API_KEY,
  dangerouslyAllowBrowser: true,
});

const SYSTEM_PROMPT = `Eres un experto nutricionista especializado en nutrición deportiva y gestión de la DIABETES. Actúa como un coach empático y motivador.
Analiza la imagen de comida proporcionada. Estima las cantidades visualmente basándote en el tamaño del plato, utensilios y referencias de escala. Evalúa la calidad nutricional (NutriScore A-E). Si el usuario es diabético, enfócate en la estabilidad de la glucosa. Si el nombre del usuario está en el contexto, úsalo. Desglosa los ingredientes principales con sus gramos estimados.
Si no puedes identificar el alimento con confianza, devuelve confidence: "baja" y explícalo en confidenceMessage.

Responde ÚNICAMENTE con JSON válido. Sin texto adicional. Sin markdown. Formato exacto:
{"foodName":"Arroz con pollo","totalWeight":350,"calories":450,"protein":38,"carbs":52,"fat":12,"ingredients":[{"name":"arroz","amount":"150g"},{"name":"pollo","amount":"150g"},{"name":"aceite","amount":"10g"}],"confidence":"alta","confidenceMessage":"Identificado con claridad","interpretation":"Plato equilibrado","coachMessage":"Buena elección","actionableRecommendation":"Añade verduras","nutriScore":"B"}`;

function parseJsonFromText(text: string): NutritionalInfo {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON no encontrado en respuesta');
  return JSON.parse(match[0]) as NutritionalInfo;
}

async function callGroqVision(base64Image: string, mimeType: string, userPrompt: string): Promise<NutritionalInfo> {
  const response = await groqVision.chat.completions.create({
    model: 'meta-llama/llama-3.2-11b-vision-preview',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
          { type: 'text', text: userPrompt },
        ] as any,
      },
    ],
    max_tokens: 1024,
    temperature: 0.1,
  });

  const text = response.choices[0]?.message?.content ?? '';
  if (!text) throw new Error('Sin respuesta del modelo de visión');
  return parseJsonFromText(text);
}

async function callOpenRouterVision(model: string, base64Image: string, mimeType: string, userPrompt: string): Promise<NutritionalInfo> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aitor-apps.vercel.app',
      'X-Title': 'NutritivApp',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }

  const text: string = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Sin respuesta del modelo de visión');
  return parseJsonFromText(text);
}

function isRetryableError(msg: string): boolean {
  return (
    msg.includes('503') ||
    msg.includes('Service Unavailable') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('No endpoints') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('model_not_found') ||
    msg.includes('decommissioned')
  );
}

export async function analyzeFoodImage(base64Image: string, mimeType: string, contextStr?: string): Promise<NutritionalInfo> {
  const userPrompt = contextStr
    ? `Analiza esta imagen de comida. Contexto del usuario: "${contextStr}".`
    : 'Analiza esta imagen de comida.';

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 50000)
  );

  // Attempt order: Groq (primary), OpenRouter free, OpenRouter paid fallback
  const attempts: Array<() => Promise<NutritionalInfo>> = [
    () => callGroqVision(base64Image, mimeType, userPrompt),
    () => callOpenRouterVision('meta-llama/llama-3.2-11b-vision-instruct:free', base64Image, mimeType, userPrompt),
    () => callOpenRouterVision('google/gemini-flash-1.5-8b', base64Image, mimeType, userPrompt),
  ];

  let lastError: Error = new Error('No se pudo analizar la imagen. Inténtalo de nuevo.');

  for (const attempt of attempts) {
    try {
      return await Promise.race([attempt(), timeoutPromise]);
    } catch (error: any) {
      const msg: string = error?.message ?? '';
      console.error('analyzeFoodImage error:', msg);

      if (msg.includes('timeout')) {
        throw new Error('El análisis está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo.');
      }
      if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('Rate limit')) {
        throw new Error('Límite de análisis alcanzado. Espera un momento e inténtalo de nuevo.');
      }
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('No auth') || msg.includes('invalid_api_key') || msg.includes('No API key')) {
        // Auth error on this provider — try next
        lastError = new Error('No se pudo analizar la imagen. Inténtalo de nuevo.');
        continue;
      }
      if (msg.includes('400') || msg.includes('Bad Request') || msg.includes('invalid_image')) {
        throw new Error('Imagen no compatible. Prueba con una foto más clara.');
      }

      if (isRetryableError(msg)) {
        lastError = new Error('No se pudo analizar la imagen. Inténtalo de nuevo.');
        continue;
      }

      // JSON parse errors or unexpected — try next provider
      lastError = new Error('No se pudo analizar la imagen. Inténtalo de nuevo.');
    }
  }

  throw lastError;
}
