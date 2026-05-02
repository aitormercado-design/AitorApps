import type { NutritionalInfo } from '../types/nutrition';

const OPENROUTER_API_KEY = (import.meta.env.VITE_OPENROUTER_API_KEY as string) || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Primary: free tier. Fallback: cheap paid model when free tier is unavailable.
const VISION_MODELS = [
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'google/gemini-flash-1.5-8b',
];

async function callVisionModel(model: string, systemPrompt: string, userPrompt: string, base64Image: string, mimeType: string): Promise<NutritionalInfo> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 45000)
  );

  const fetchPromise = fetch(OPENROUTER_URL, {
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
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
      max_tokens: 2048,
    }),
  });

  const response = await Promise.race([fetchPromise, timeoutPromise]);

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`HTTP ${response.status}: respuesta no válida del servidor`);
  }

  if (!response.ok) {
    const errMsg = data?.error?.message ?? data?.error ?? `HTTP ${response.status}`;
    throw new Error(String(errMsg));
  }

  if (!data.choices?.[0]?.message?.content) {
    throw new Error('Sin respuesta del modelo de visión');
  }

  const text: string = data.choices[0].message.content;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON no encontrado en respuesta');

  return JSON.parse(match[0]) as NutritionalInfo;
}

function isRetryableError(msg: string): boolean {
  return (
    msg.includes('503') ||
    msg.includes('Service Unavailable') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('No endpoints') ||
    msg.includes('model') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND')
  );
}

export async function analyzeFoodImage(base64Image: string, mimeType: string, contextStr?: string): Promise<NutritionalInfo> {
  const systemPrompt = `Eres un experto nutricionista especializado en nutrición deportiva y gestión de la DIABETES. Actúa como un coach empático y motivador.
Analiza la imagen de comida proporcionada. Estima las cantidades visualmente basándote en el tamaño del plato, utensilios y referencias de escala. Evalúa la calidad nutricional (NutriScore A-E). Si el usuario es diabético, enfócate en la estabilidad de la glucosa. Si el nombre del usuario está en el contexto, úsalo. Desglosa los ingredientes principales con sus gramos estimados.
Si no puedes identificar el alimento con confianza, devuelve confidence: "baja" y explícalo en confidenceMessage.

Responde ÚNICAMENTE con JSON válido. Sin texto adicional. Sin markdown. Formato exacto:
{"foodName":"Arroz con pollo","totalWeight":350,"calories":450,"protein":38,"carbs":52,"fat":12,"ingredients":[{"name":"arroz","amount":"150g"},{"name":"pollo","amount":"150g"},{"name":"aceite","amount":"10g"}],"confidence":"alta","confidenceMessage":"Identificado con claridad","interpretation":"Plato equilibrado","coachMessage":"Buena elección","actionableRecommendation":"Añade verduras","nutriScore":"B"}`;

  const userPrompt = contextStr
    ? `Analiza esta imagen de comida. Contexto del usuario: "${contextStr}".`
    : 'Analiza esta imagen de comida.';

  let lastError: Error = new Error('No se pudo analizar la imagen. Inténtalo de nuevo.');

  for (const model of VISION_MODELS) {
    try {
      return await callVisionModel(model, systemPrompt, userPrompt, base64Image, mimeType);
    } catch (error: any) {
      console.error(`analyzeFoodImage [${model}]:`, error?.message ?? error);
      const msg: string = error?.message ?? '';

      if (msg.includes('timeout')) {
        throw new Error('El análisis está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo.');
      }
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
        throw new Error('Límite de análisis de fotos alcanzado. Espera un momento.');
      }
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('No auth') || msg.includes('invalid_api_key')) {
        throw new Error('Clave de API de OpenRouter no válida. Revisa la configuración.');
      }
      if (msg.includes('400') || msg.includes('Bad Request')) {
        throw new Error('Imagen no compatible. Prueba con una foto diferente.');
      }

      // Retryable with next model
      if (isRetryableError(msg)) {
        lastError = new Error('El modelo de visión no está disponible. Inténtalo de nuevo.');
        continue;
      }

      lastError = new Error('No se pudo analizar la imagen. Inténtalo de nuevo.');
    }
  }

  throw lastError;
}
