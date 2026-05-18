import Groq from 'groq-sdk';
import type { NutritionalInfo } from '../types/nutrition';

const GROQ_API_KEY = (import.meta.env.VITE_GROQ_API_KEY as string) || '';
const OPENROUTER_API_KEY = (import.meta.env.VITE_OPENROUTER_API_KEY as string) || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const groqVision = new Groq({
  apiKey: GROQ_API_KEY,
  dangerouslyAllowBrowser: true,
});

const SYSTEM_PROMPT = `Eres un sistema de análisis visual de alimentos.

TAREA: Identificar alimentos visibles y estimar cantidades.

REGLAS:
- No inventes alimentos no visibles
- Considera aceite/salsas ocultos si la comida está cocinada (5-15g)
- Sin consejos, sin recomendaciones, solo estimación

REFERENCIAS DE PORCIONES:
- Arroz/pasta cocidos: 150-250g plato normal
- Carne/pescado: 120-220g por ración
- Verduras: 100-200g
- Pan: 40-60g por rebanada

SALIDA: JSON estricto, sin texto adicional:
{
  "foods": [
    {
      "name": string,
      "grams": number,
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "confidence": "alta" | "media" | "baja"
    }
  ],
  "totalCalories": number,
  "globalConfidence": "alta" | "media" | "baja",
  "confidenceMessage": string,
  "notes": string
}`;

type UserGoal = 'lose' | 'maintain' | 'gain';

type VisionResponse = {
  foods: { name: string; grams: number; calories: number; protein: number; carbs: number; fat: number; confidence: 'alta' | 'media' | 'baja' }[];
  totalCalories: number;
  globalConfidence: 'alta' | 'media' | 'baja';
  confidenceMessage: string;
  notes: string;
};

type MedicalConditions = {
  diabetes?: boolean;
  highCholesterol?: boolean;
  hypertension?: boolean;
  hypothyroidism?: boolean;
  insulinResistance?: boolean;
};

function calculateSemaforo(calories: number, protein: number, goal: UserGoal): { semaforo: 'verde' | 'amarillo' | 'rojo'; semaforoLabel: string } {
  const umbrales = {
    lose:     { verde: 450, amarillo: 650 },
    maintain: { verde: 600, amarillo: 800 },
    gain:     { verde: 750, amarillo: 950 },
  };
  const { verde, amarillo } = umbrales[goal] ?? umbrales.maintain;

  let semaforo: 'verde' | 'amarillo' | 'rojo';
  if (calories <= verde) semaforo = 'verde';
  else if (calories <= amarillo) semaforo = 'amarillo';
  else semaforo = 'rojo';

  if (protein >= 20 && semaforo === 'rojo')    semaforo = 'amarillo';
  if (protein >= 20 && semaforo === 'amarillo') semaforo = 'verde';

  const labels = {
    verde:    'Comida equilibrada para tu objetivo',
    amarillo: 'Dentro del rango, vigila el total del día',
    rojo:     'Alto para tu objetivo, compensa en la siguiente comida',
  };

  return { semaforo, semaforoLabel: labels[semaforo] };
}

function toNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function parseJsonFromText(text: string, goal: UserGoal): NutritionalInfo {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON no encontrado en respuesta');
  const raw = JSON.parse(match[0]) as VisionResponse;

  const foods = Array.isArray(raw.foods) ? raw.foods : [];
  const totalWeight = foods.reduce((s, f) => s + toNum(f.grams), 0);
  const protein     = foods.reduce((s, f) => s + toNum(f.protein), 0);
  const carbs       = foods.reduce((s, f) => s + toNum(f.carbs), 0);
  const fat         = foods.reduce((s, f) => s + toNum(f.fat), 0);
  const calories    = toNum(raw.totalCalories) || Math.round(protein * 4 + carbs * 4 + fat * 9);
  const { semaforo, semaforoLabel } = calculateSemaforo(calories, Math.round(protein), goal);

  return {
    foodName: foods.map(f => f.name || 'Ingrediente').join(', ') || 'Comida',
    totalWeight: Math.round(totalWeight),
    calories,
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    ingredients: foods.map(f => ({ name: f.name || 'Ingrediente', amount: `${toNum(f.grams)}g` })),
    confidence: raw.globalConfidence ?? 'media',
    confidenceMessage: raw.confidenceMessage ?? '',
    interpretation: raw.notes ?? '',
    semaforo,
    semaforoLabel,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

async function callGroqVision(model: string, base64Image: string, mimeType: string, userPrompt: string, goal: UserGoal): Promise<NutritionalInfo> {
  const response = await groqVision.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: 'text', text: `${SYSTEM_PROMPT}\n\n${userPrompt}` },
        ] as any,
      },
    ],
    max_tokens: 1024,
    temperature: 0.1,
  });

  const text = response.choices[0]?.message?.content ?? '';
  if (!text) throw new Error('Sin respuesta del modelo de visión');
  return parseJsonFromText(text, goal);
}

async function callOpenRouterVision(model: string, base64Image: string, mimeType: string, userPrompt: string, goal: UserGoal): Promise<NutritionalInfo> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aitor-apps.vercel.app',
      'X-Title': 'KiloKalo',
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
  try { data = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  const text: string = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Sin respuesta del modelo de visión');
  return parseJsonFromText(text, goal);
}

type Provider = { label: string; fn: () => Promise<NutritionalInfo> };

export async function analyzeFoodImage(base64Image: string, mimeType: string, contextStr?: string, medicalConditions?: MedicalConditions, goal: UserGoal = 'maintain'): Promise<NutritionalInfo> {
  const medicalNotes: string[] = [];
  if (medicalConditions?.diabetes)          medicalNotes.push('El usuario tiene diabetes tipo 2. Incluye en "notes" observación breve sobre carga glucémica.');
  if (medicalConditions?.highCholesterol)   medicalNotes.push('El usuario tiene colesterol alto. Incluye en "notes" observación breve sobre grasas saturadas del plato.');
  if (medicalConditions?.hypertension)      medicalNotes.push('El usuario tiene hipertensión. Incluye en "notes" observación breve sobre contenido de sodio estimado.');
  if (medicalConditions?.hypothyroidism)    medicalNotes.push('El usuario tiene hipotiroidismo. Incluye en "notes" observación breve sobre alimentos bociógenos si los hay (brócoli, soja, col) y yodo.');
  if (medicalConditions?.insulinResistance) medicalNotes.push('El usuario tiene resistencia a la insulina. Incluye en "notes" observación breve sobre índice glucémico y carga de carbohidratos del plato.');
  const medicalStr = medicalNotes.length > 0 ? ' ' + medicalNotes.join(' ') : '';

  const userPrompt = contextStr
    ? `Analiza esta imagen de comida. Contexto del usuario: "${contextStr}".${medicalStr}`
    : `Analiza esta imagen de comida.${medicalStr}`;

  const providers: Provider[] = [
    { label: 'OR:gemini-2.0-flash', fn: () => callOpenRouterVision('google/gemini-2.0-flash', base64Image, mimeType, userPrompt, goal) },
    { label: 'OR:gemini-flash-1.5', fn: () => callOpenRouterVision('google/gemini-flash-1.5', base64Image, mimeType, userPrompt, goal) },
    { label: 'Groq:llama-4-maverick', fn: () => callGroqVision('meta-llama/llama-4-maverick-17b-128e-instruct', base64Image, mimeType, userPrompt, goal) },
    { label: 'Groq:llama-4-scout', fn: () => callGroqVision('meta-llama/llama-4-scout-17b-16e-instruct', base64Image, mimeType, userPrompt, goal) },
  ];

  const errors: string[] = [];
  for (const { label, fn } of providers) {
    try {
      return await withTimeout(fn(), 30000);
    } catch (error: any) {
      const msg: string = error?.message ?? '';
      console.error(`[vision][${label}] ${msg}`);
      errors.push(`${label}: ${msg}`);
      if (msg.includes('timeout')) throw new Error('El análisis está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo.');
      if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('Rate limit')) throw new Error('Límite de análisis alcanzado. Espera un momento e inténtalo de nuevo.');
    }
  }

  const debugInfo = errors.join(' | ');
  console.error('[vision] All providers failed:', debugInfo);
  throw new Error(`No se pudo analizar la imagen. [${debugInfo}]`);
}
