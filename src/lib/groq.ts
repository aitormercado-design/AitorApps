import Groq from 'groq-sdk';
import type { NutritionalInfo } from '../types/nutrition';

const groq = new Groq({
  apiKey: (import.meta.env.VITE_GROQ_API_KEY as string) || '',
  dangerouslyAllowBrowser: true,
});

const MODEL = 'llama-3.3-70b-versatile';

function friendlyGroqError(error: any, fallback: string): Error {
  const msg: string = error?.message ?? '';
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota')) {
    return new Error('Límite de consultas alcanzado. Espera un momento e inténtalo de nuevo.');
  }
  if (msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('Unauthorized')) {
    return new Error('Clave de API de Groq no válida. Revisa la configuración.');
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded')) {
    return new Error('El servicio no está disponible ahora. Inténtalo en unos segundos.');
  }
  if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
    return new Error('La consulta tardó demasiado. Inténtalo de nuevo.');
  }
  return new Error(fallback);
}

export type CoachUserContext = {
  profile: any;
  goals: { calories: number; protein: number; carbs: number; fat: number };
  mealsToday: any[];
  caloriesConsumedToday: number;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export async function chatWithCoach(
  conversationHistory: ChatMessage[],
  userContext: CoachUserContext,
  onChunk: (text: string) => void
): Promise<void> {
  const { profile, goals, mealsToday, caloriesConsumedToday } = userContext;
  const currentWeight = profile.currentWeight ?? profile.weight ?? 'N/A';
  const consumedProtein  = mealsToday.reduce((s: number, m: any) => s + (m.protein  ?? 0), 0);
  const consumedCarbs    = mealsToday.reduce((s: number, m: any) => s + (m.carbs    ?? 0), 0);
  const consumedFat      = mealsToday.reduce((s: number, m: any) => s + (m.fat      ?? 0), 0);

  const systemPrompt = `Eres un auténtico experto en fitness, fisiología del ejercicio y nutrición clínica (diabetes). Actúas como un coach motivador 24/7.

Contexto del usuario:
- Nombre: ${profile.name || 'Usuario'}
- Edad: ${profile.age}, Peso: ${currentWeight}kg, Altura: ${profile.height}cm, Género: ${profile.gender}
- Objetivo: ${profile.goal}, Días de gym: ${profile.trainingDaysPerWeek}/semana
- Dieta: ${profile.dietType || 'Sin restricción'}, Alergias: ${profile.allergies || 'Ninguna'}${profile.diabetesType && profile.diabetesType !== 'none' ? `\n- Diabetes tipo ${profile.diabetesType} — prioriza estabilidad glucémica` : ''}
- Calorías objetivo: ${goals.calories} kcal (P: ${goals.protein}g, C: ${goals.carbs}g, G: ${goals.fat}g)
- Consumido hoy: ${Math.round(caloriesConsumedToday)} kcal (P: ${Math.round(consumedProtein)}g, C: ${Math.round(consumedCarbs)}g, G: ${Math.round(consumedFat)}g)
- Faltan: ${Math.round(goals.calories - caloriesConsumedToday)} kcal para el objetivo de hoy

Instrucciones:
1. Sé extremadamente motivador y profesional. Demuestra autoridad en fitness.
2. Si el usuario tiene diabetes, ofrece consejos para estabilizar la glucosa (orden de ingestión, ejercicio ligero post-prandial).
3. Personaliza las respuestas basándote en su objetivo y datos reales de hoy.
4. Responde de forma concisa, alentadora y directa, sin ser condescendiente.`;

  try {
    const stream = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
      ],
      temperature: 0.8,
      max_tokens: 1024,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) onChunk(delta);
    }
  } catch (error: any) {
    console.error('Error in coach chat:', error);
    throw friendlyGroqError(error, 'Hubo un error de conexión. Inténtalo de nuevo.');
  }
}

export async function analyzeFoodText(foodDescription: string, contextStr?: string): Promise<NutritionalInfo> {
  const systemPrompt = `Eres un experto nutricionista deportivo y coach empático y motivador. Estima con precisión el contenido nutricional del alimento descrito. Si el nombre del usuario está en el contexto, úsalo para dirigirte a él.

Responde ÚNICAMENTE con JSON válido. Sin texto adicional. Sin markdown. El JSON debe seguir exactamente este formato:
{"foodName":"Arroz con pollo","totalWeight":350,"calories":450,"protein":38,"carbs":52,"fat":12,"ingredients":[{"name":"arroz","amount":"150g"},{"name":"pollo","amount":"150g"},{"name":"aceite","amount":"10g"}],"confidence":"alta","confidenceMessage":"Análisis completado","interpretation":"Plato equilibrado","coachMessage":"Buena elección","actionableRecommendation":"Añade verduras","nutriScore":"B"}`;

  const userPrompt = contextStr
    ? `Alimento: "${foodDescription}". Contexto del usuario: "${contextStr}".`
    : `Alimento: "${foodDescription}".`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0].message.content;
    if (!text) throw new Error('No se recibió respuesta del modelo.');

    return JSON.parse(text) as NutritionalInfo;
  } catch (error: any) {
    console.error('Error analyzing food text:', error);
    throw friendlyGroqError(error, 'No se pudo analizar el texto. Inténtalo de nuevo.');
  }
}
