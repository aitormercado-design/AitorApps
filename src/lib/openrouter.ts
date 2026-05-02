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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

async function callGroqVision(model: string, base64Image: string, mimeType: string, userPrompt: string): Promise<NutritionalInfo> {
  const response = await groqVision.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
          { type: 'text', text: `${SYSTEM_PROMPT}\n\n${userPrompt}` },
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

type Provider = { label: string; fn: () => Promise<NutritionalInfo> };

export async function analyzeFoodImage(base64Image: string, mimeType: string, contextStr?: string): Promise<NutritionalInfo> {
  const userPrompt = contextStr
    ? `Analiza esta imagen de comida. Contexto del usuario: "${contextStr}".`
    : 'Analiza esta imagen de comida.';

  const providers: Provider[] = [
    { label: 'Groq:llama-3.2-11b', fn: () => callGroqVision('llama-3.2-11b-vision-preview', base64Image, mimeType, userPrompt) },
    { label: 'Groq:llama-3.2-90b', fn: () => callGroqVision('llama-3.2-90b-vision-preview', base64Image, mimeType, userPrompt) },
    { label: 'OR:llama-free', fn: () => callOpenRouterVision('meta-llama/llama-3.2-11b-vision-instruct:free', base64Image, mimeType, userPrompt) },
    { label: 'OR:gemini-flash', fn: () => callOpenRouterVision('google/gemini-flash-1.5-8b', base64Image, mimeType, userPrompt) },
  ];

  const errors: string[] = [];

  for (const { label, fn } of providers) {
    try {
      return await withTimeout(fn(), 30000);
    } catch (error: any) {
      const msg: string = error?.message ?? '';
      console.error(`[vision][${label}] ${msg}`);
      errors.push(`${label}: ${msg}`);

      if (msg.includes('timeout')) {
        throw new Error('El análisis está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo.');
      }
      if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('Rate limit')) {
        throw new Error('Límite de análisis alcanzado. Espera un momento e inténtalo de nuevo.');
      }
      if (msg.includes('400') || msg.includes('Bad Request') || msg.includes('invalid_image')) {
        throw new Error('Imagen no compatible. Prueba con una foto más clara.');
      }
      // Auth, availability, model errors → try next provider
    }
  }

  // All providers failed — surface debug info in dev, generic in prod
  const debugInfo = errors.join(' | ');
  console.error('[vision] All providers failed:', debugInfo);
  throw new Error(`No se pudo analizar la imagen. [${debugInfo}]`);
}
