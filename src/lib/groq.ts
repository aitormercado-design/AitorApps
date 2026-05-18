import Groq from 'groq-sdk';
import type { NutritionalInfo, ShoppingList, WeeklyMenu } from '../types/nutrition';
import { calculateDailyCalories } from '../utils/nutrition';

const groq = new Groq({
  apiKey: (import.meta.env.VITE_GROQ_API_KEY as string) || '',
  dangerouslyAllowBrowser: true,
});

const MODEL = 'llama-3.3-70b-versatile';
// Higher rate limits on free tier (30k TPM, 14.4k RPD vs 6k TPM, 30 RPD for 70b)
const FAST_MODEL = 'llama-3.1-8b-instant';

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const msg: string = error?.message ?? '';
      const isRateLimit = msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota');
      if (isRateLimit && attempt < 2) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 3000)); // 3s, 6s
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

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

export async function streamCompletion(prompt: string, onChunk: (text: string) => void): Promise<void> {
  try {
    const stream = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) onChunk(delta);
    }
  } catch (error: any) {
    throw friendlyGroqError(error, 'Error al procesar la solicitud. Inténtalo de nuevo.');
  }
}

const gymGoalLabels: Record<string, string> = {
  muscle: 'Ganar músculo',
  strength: 'Fuerza',
  cardio: 'Resistencia/Cardio',
  fat_loss: 'Pérdida de grasa',
  flexibility: 'Flexibilidad',
  maintenance: 'Mantenimiento',
};

const goalLabels: Record<string, string> = {
  lose: 'Perder grasa',
  maintain: 'Mantener peso',
  gain: 'Ganar músculo',
};


export interface ProactiveEvent {
  type: 'meal_added' | 'workout_done' | 'workout_exercise' | 'free_workout' | 'weight_updated' | 'day_start' | 'goal_90pct' | 'goal_exceeded' | 'streak_milestone' | 'monday_summary';
  data: Record<string, any>;
}

export interface CoachContext {
  profile: any;
  goals: { calories: number; protein: number; carbs: number; fat: number };
  meals: any[];
  habits: Record<string, any>;
  weights: any[];
  generatedMenu?: any;
  workoutPlan?: string | null;
  streak?: number;
}

export async function generateProactiveMessage(event: ProactiveEvent, context: CoachContext): Promise<string> {
  const { profile, goals } = context;
  const dayName = new Date().toLocaleDateString('es-ES', { weekday: 'long' });

  const hour = new Date().getHours();
  const timeOfDay =
    hour < 10 ? 'mañana_temprano' :
    hour < 12 ? 'media_mañana' :
    hour < 15 ? 'mediodia' :
    hour < 18 ? 'tarde' :
    hour < 21 ? 'tarde_noche' :
    'noche';

  const goalLabels: Record<string, string> = {
    lose: 'perder grasa (déficit calórico, énfasis en proteínas)',
    maintain: 'mantener peso (equilibrio calórico)',
    gain: 'ganar músculo (superávit calórico, énfasis en carbohidratos)',
  };
  const goalLabel = goalLabels[profile.goal] ?? 'equilibrio calórico';

  const eventPrompts: Record<ProactiveEvent['type'], string> = {
    day_start: `Es ${dayName}. Di a ${profile.name || 'usuario'} su objetivo de hoy en una sola frase: ${goals.calories}kcal.`,
    meal_added: `El usuario acaba de registrar: ${event.data.meal?.foodName} (${Math.round(event.data.meal?.calories ?? 0)}kcal). Lleva ${Math.round(event.data.totalCalories)}kcal de ${goals.calories}kcal objetivo. Comenta brevemente y dile qué le queda.`,
    workout_done: `El usuario acaba de completar su rutina de ${event.data.focus ?? 'entrenamiento'} quemando ${event.data.calories ?? 0}kcal. Felicítale y dale un consejo de recuperación.`,
    workout_exercise: `El usuario ha completado un ejercicio de su rutina. Anímale brevemente.`,
    free_workout: `El usuario ha registrado un entrenamiento libre: ${event.data.activity ?? 'ejercicio'} durante ${event.data.durationMinutes ?? '?'} minutos quemando ${Math.round(event.data.calories ?? 0)}kcal. Felicítale brevemente.`,
    weight_updated: `El usuario ha registrado su peso. Peso actual: ${event.data.current}kg. ${event.data.previous ? `Cambio: ${event.data.diff > 0 ? '+' : ''}${Number(event.data.diff).toFixed(1)}kg` : 'Es su primer registro de peso.'}. Comenta la tendencia de forma motivadora.`,
    goal_90pct: `El usuario está al 90% de su objetivo calórico. Le quedan ${Math.round(event.data.remaining ?? 0)}kcal. Avísale y sugiere qué puede comer con lo que le queda.`,
    goal_exceeded: `El usuario ha superado su objetivo calórico en ${Math.round(event.data.excess ?? 0)}kcal. Mensaje tranquilizador, sin dramatizar, con consejo práctico para el resto del día.`,
    streak_milestone: `El usuario lleva ${event.data.streak} días consecutivos registrando. Felicítale en una frase corta.`,
    monday_summary: `Es lunes. La semana pasada el usuario tuvo ${event.data.daysOnTarget ?? 0}/7 días en objetivo calórico y completó ${event.data.workouts ?? 0} entrenamientos. Haz un resumen motivador en 2 frases máximo y da un objetivo concreto para esta semana.`,
  };

  const activeConditions = profile.medicalConditions
    ? Object.entries(profile.medicalConditions as Record<string, boolean>)
        .filter(([_, v]) => v)
        .map(([k]) => ({ diabetes: 'diabetes', highCholesterol: 'colesterol alto', hypertension: 'hipertensión', hypothyroidism: 'hipotiroidismo', insulinResistance: 'resistencia a la insulina' }[k] ?? k))
        .join(', ')
    : (profile.diabetesType && profile.diabetesType !== 'none' ? `diabetes tipo ${profile.diabetesType}` : '');

  const conditionsNote = activeConditions ? `\n- Condiciones médicas del usuario: ${activeConditions}. Adáptate a ellas en tus consejos.` : '';

  const isShortEvent = event.type === 'day_start' || event.type === 'streak_milestone';
  const streakNote = context.streak && context.streak > 1 ? `\n- Racha actual: ${context.streak} días consecutivos` : '';

  const timeNote = `\nSon las ${hour}:00h (${timeOfDay}). Ten en cuenta la hora: no sugieras desayuno si son las 15h, no hables de entrenar si son las 22h, no hables de cenar si son las 9h.`;
  const nameNote = `\nUsa el nombre del usuario (${profile.name || 'amigo'}) de forma ocasional — solo cuando refuerce la personalización, no en cada frase.`;
  const goalNote = `\nSu objetivo es ${goalLabel}. Alinea todos tus consejos con ese objetivo.`;

  const systemPrompt = isShortEvent
    ? `Eres el coach de ${profile.name || 'usuario'}. Una sola frase. En español. Sin anglicismos. Directo al objetivo.${conditionsNote}${streakNote}${timeNote}${goalNote}`
    : `Eres el coach personal de ${profile.name || 'usuario'}. Conoces su perfil y su plan de la semana. Responde en máximo 2 frases. Tono directo y motivador. NUNCA uses saludos largos ni despedidas. Solo el mensaje esencial.${conditionsNote}${streakNote}${timeNote}${nameNote}${goalNote}
CRÍTICO: Máximo 2 frases cortas. Sin saludos como "Excelente trabajo" o "Enhorabuena". Empieza directamente con el dato o la acción. Ejemplo correcto: "533kcal quemadas — gran sesión. Toma proteína en la próxima hora para recuperar." Ejemplo incorrecto: "Excelente trabajo Aitor, has quemado 533kcal..."`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: eventPrompts[event.type] },
      ],
      temperature: 0.8,
      max_tokens: isShortEvent ? 50 : 60,
    });
    return completion.choices[0].message.content ?? '';
  } catch {
    return '';
  }
}

type UserGoal = 'lose' | 'maintain' | 'gain';

type MedicalConditions = {
  diabetes?: boolean;
  highCholesterol?: boolean;
  hypertension?: boolean;
  hypothyroidism?: boolean;
  insulinResistance?: boolean;
};

type FoodTextResponse = {
  foods: { name: string; grams: number; calories: number; protein: number; carbs: number; fat: number; confidence: 'alta' | 'media' | 'baja' }[];
  totalCalories: number;
  globalConfidence: 'alta' | 'media' | 'baja';
  confidenceMessage: string;
  notes: string;
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

function parseFoodTextResponse(raw: FoodTextResponse, goal: UserGoal): NutritionalInfo {
  const foods = Array.isArray(raw.foods) ? raw.foods : [];
  const protein     = foods.reduce((s, f) => s + toNum(f.protein), 0);
  const carbs       = foods.reduce((s, f) => s + toNum(f.carbs), 0);
  const fat         = foods.reduce((s, f) => s + toNum(f.fat), 0);
  const totalWeight = foods.reduce((s, f) => s + toNum(f.grams), 0);
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

const TEXT_SYSTEM_PROMPT = `Eres un sistema de análisis visual de alimentos.

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
  "foods": [{"name": string, "grams": number, "calories": number, "protein": number, "carbs": number, "fat": number, "confidence": "alta"|"media"|"baja"}],
  "totalCalories": number,
  "globalConfidence": "alta"|"media"|"baja",
  "confidenceMessage": string,
  "notes": string
}`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = (import.meta.env.VITE_OPENROUTER_API_KEY as string) || '';

async function callGroqText(model: string, userPrompt: string, goal: UserGoal): Promise<NutritionalInfo> {
  const completion = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: TEXT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });
  const text = completion.choices[0].message.content;
  if (!text) throw new Error('Sin respuesta del modelo.');
  return parseFoodTextResponse(JSON.parse(text) as FoodTextResponse, goal);
}

async function callOpenRouterText(model: string, userPrompt: string, goal: UserGoal): Promise<NutritionalInfo> {
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
        { role: 'system', content: TEXT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    }),
  });
  let data: any;
  try { data = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  const text: string = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Sin respuesta del modelo.');
  return parseFoodTextResponse(JSON.parse(text) as FoodTextResponse, goal);
}

export async function analyzeFoodText(foodDescription: string, contextStr?: string, medicalConditions?: MedicalConditions, goal: UserGoal = 'maintain'): Promise<NutritionalInfo> {
  const medicalNotes: string[] = [];
  if (medicalConditions?.diabetes)          medicalNotes.push('El usuario tiene diabetes tipo 2. Incluye en "notes" observación breve sobre carga glucémica.');
  if (medicalConditions?.highCholesterol)   medicalNotes.push('El usuario tiene colesterol alto. Incluye en "notes" observación breve sobre grasas saturadas del plato.');
  if (medicalConditions?.hypertension)      medicalNotes.push('El usuario tiene hipertensión. Incluye en "notes" observación breve sobre contenido de sodio estimado.');
  if (medicalConditions?.hypothyroidism)    medicalNotes.push('El usuario tiene hipotiroidismo. Incluye en "notes" observación breve sobre alimentos bociógenos si los hay (brócoli, soja, col) y yodo.');
  if (medicalConditions?.insulinResistance) medicalNotes.push('El usuario tiene resistencia a la insulina. Incluye en "notes" observación breve sobre índice glucémico y carga de carbohidratos del plato.');
  const medicalStr = medicalNotes.length > 0 ? ' ' + medicalNotes.join(' ') : '';

  const userPrompt = contextStr
    ? `Alimento: "${foodDescription}". Contexto del usuario: "${contextStr}".${medicalStr}`
    : `Alimento: "${foodDescription}".${medicalStr}`;

  const providers = [
    { label: 'Groq:llama-3.3-70b', fn: () => callGroqText(MODEL,       userPrompt, goal) },
    { label: 'Groq:llama-3.1-8b',  fn: () => callGroqText(FAST_MODEL,  userPrompt, goal) },
    { label: 'OR:gemini-2.0-flash', fn: () => callOpenRouterText('google/gemini-2.0-flash', userPrompt, goal) },
    { label: 'OR:gemini-flash-1.5', fn: () => callOpenRouterText('google/gemini-flash-1.5', userPrompt, goal) },
  ];

  const errors: string[] = [];
  for (const { label, fn } of providers) {
    try {
      return await fn();
    } catch (error: any) {
      const msg: string = error?.message ?? '';
      console.error(`[food-text][${label}] ${msg}`);
      errors.push(`${label}: ${msg}`);
    }
  }

  throw new Error(`No se pudo analizar el alimento. [${errors.join(' | ')}]`);
}

export async function generateShoppingList(ingredients: any[]): Promise<ShoppingList> {
  const ingredientLines = ingredients
    .filter(i => i.item)
    .map(i => i.day ? `${i.item} [${i.day}]` : i.item)
    .join('\n');

  const systemPrompt = `Eres un asistente de compras experto. Organiza los ingredientes en secciones y devuelve ÚNICAMENTE JSON válido. Sin texto adicional. Sin markdown.

Reglas:
- Consolida duplicados: mismo ingrediente varias veces = una sola entrada con cantidad total semanal
- Cantidades en unidades comerciales reales (no "137g" sino "1 paquete 150g" o "7 unidades")
- Omite secciones sin ítems
- Secciones en este orden exacto: "Frutas y verduras", "Carnes y pescados", "Lácteos y huevos", "Cereales y legumbres", "Frutos secos y semillas", "Proteína y suplementos", "Aceites y condimentos", "Otros"

Formato exacto:
{"secciones":[{"nombre":"Frutas y verduras","items":[{"nombre":"Plátano","cantidad":"7 unidades"}]},{"nombre":"Carnes y pescados","items":[{"nombre":"Pechuga de pollo","cantidad":"1kg"}]}]}`;

  const userPrompt = `Personas: 1 | Semana completa\n\nIngredientes del menú:\n${ingredientLines}`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0].message.content;
    if (!text) throw new Error('No se recibió respuesta del modelo.');

    const parsed = JSON.parse(text);
    const categories = (parsed.secciones ?? [])
      .map((sec: any) => ({
        name: sec.nombre,
        items: (sec.items ?? []).map((it: any) => ({
          name: it.nombre,
          amount: it.cantidad ?? '',
        })),
      }))
      .filter((cat: any) => cat.items.length > 0);

    return { categories };
  } catch (error: any) {
    console.error('Error generating shopping list:', error);
    throw friendlyGroqError(error, 'No se pudo generar la lista de la compra. Inténtalo de nuevo.');
  }
}

export async function generateWeeklyMenu(profile: any, currentWeight: number): Promise<WeeklyMenu> {
  const targets = calculateDailyCalories(profile, currentWeight);
  const allergiesStr = Array.isArray(profile.allergies) && profile.allergies.length > 0
    ? profile.allergies.join(', ')
    : 'Ninguna';

  // Resolve medical conditions — support both new medicalConditions object and legacy diabetesType
  const conditions = profile.medicalConditions ?? {
    diabetes: profile.diabetesType && profile.diabetesType !== 'none',
    highCholesterol: false,
    hypertension: false,
    hypothyroidism: false,
    insulinResistance: false,
  };
  const hasDiabetes = conditions.diabetes || (profile.diabetesType && profile.diabetesType !== 'none');

  const adjustedTargets = { ...targets };
  if (hasDiabetes && adjustedTargets.carbs > 150) {
    const excessKcal = (adjustedTargets.carbs - 150) * 4;
    adjustedTargets.carbs = 150;
    adjustedTargets.fat = Math.round(adjustedTargets.fat + excessKcal / 9);
  }

  // Build medical rules
  const medicalRules: string[] = [];
  if (hasDiabetes) {
    medicalRules.push(
      `DIABETES${profile.diabetesType && profile.diabetesType !== 'none' ? ` tipo ${profile.diabetesType}` : ''}: Total diario exactamente ${adjustedTargets.carbs}g carbohidratos. ` +
      `Distribuye uniformemente entre las 4 comidas (~${Math.round(adjustedTargets.carbs / 4)}g por comida). ` +
      'Prohibido: azúcar, arroz blanco, pan blanco, patata, zumos. Priorizar bajo índice glucémico.'
    );
  }
  if (conditions.highCholesterol) {
    medicalRules.push(
      'COLESTEROL ALTO: Eliminar grasas saturadas y trans. ' +
      'Prohibido: mantequilla, embutidos, fritos, lácteos enteros. Máximo 2 huevos por semana. ' +
      'Priorizar omega-3, fibra soluble, esteroles vegetales.'
    );
  }
  if (conditions.hypertension) {
    medicalRules.push(
      'HIPERTENSIÓN: Dieta baja en sodio (<2g/día). ' +
      'Prohibido: sal añadida, embutidos, conservas, snacks salados, quesos curados. ' +
      'Priorizar potasio (plátano, patata, legumbres), magnesio y calcio.'
    );
  }
  if (conditions.hypothyroidism) {
    medicalRules.push(
      'HIPOTIROIDISMO: Moderar soja y derivados. ' +
      'Moderar crucíferas crudas (brócoli, coliflor, col) — cocinadas son aceptables. ' +
      'Priorizar yodo (pescado, marisco, lácteos) y selenio (nueces de Brasil, atún).'
    );
  }
  if (conditions.insulinResistance) {
    medicalRules.push(
      'RESISTENCIA A LA INSULINA: Priorizar alimentos de bajo índice glucémico. ' +
      'Evitar carbohidratos refinados y azúcares simples. ' +
      'Distribuir carbohidratos uniformemente en todas las comidas. ' +
      'Combinar siempre carbos con proteína o grasa para reducir picos glucémicos.'
    );
  }

  const activeConditionsStr = [
    hasDiabetes ? `Diabetes${profile.diabetesType && profile.diabetesType !== 'none' ? ` tipo ${profile.diabetesType}` : ''}` : '',
    conditions.highCholesterol ? 'Colesterol alto' : '',
    conditions.hypertension ? 'Hipertensión' : '',
    conditions.hypothyroidism ? 'Hipotiroidismo' : '',
    conditions.insulinResistance ? 'Resistencia a la insulina' : '',
  ].filter(Boolean).join(', ') || 'Ninguna';

  const userPrompt = `Genera el menú semanal con estos datos:

PERFIL CALCULADO (no recalcules esto, úsalo tal cual):
- Calorías diarias objetivo: ${adjustedTargets.calories} kcal
- Proteína diaria: ${adjustedTargets.protein}g
- Carbohidratos diarios: ${adjustedTargets.carbs}g${hasDiabetes ? ` (máximo absoluto — diabetes)` : ''}
- Grasa diaria: ${adjustedTargets.fat}g

DATOS DEL USUARIO:
- Edad: ${profile.age} | Sexo: ${profile.gender} | Peso: ${currentWeight}kg | Altura: ${profile.height}cm
- Objetivo: ${profile.goal === 'lose' ? 'Perder grasa' : profile.goal === 'gain' ? 'Ganar músculo' : 'Mantener peso'}
- Tipo de dieta: ${profile.dietType || 'Normal'}
- Días de gimnasio esta semana: ${profile.trainingDaysPerWeek} (distribúyelos a tu criterio)
- Condiciones médicas: ${activeConditionsStr}
- Alergias absolutas: ${allergiesStr}
- Alimentos que no le gustan: ${profile.dislikedFoods || 'Ninguno'}


COMIDA LIBRE:
- Habilitada: ${profile.freeMealEnabled ? 'Sí' : 'No'}
- Día: ${profile.freeMealDay || ''}
- Tipo: ${profile.freeMealType || ''}`;

  const diabetesRule = hasDiabetes
    ? `- DIABETES: El total diario de carbohidratos ES ${adjustedTargets.carbs}g. Distribuye ~${Math.round(adjustedTargets.carbs / 4)}g en cada una de las 4 comidas. Alimentos de bajo índice glucémico.`
    : '';

  const freeMealRule = profile.freeMealEnabled
    ? `- Comida libre el ${profile.freeMealDay} en ${profile.freeMealType}: usa exactamente {"t":"${profile.freeMealType}","n":"COMIDA LIBRE","k":0,"p":0,"c":0,"g":0,"i":"libre"}. Distribución ese día: libre=50%, desayuno=18%, almuerzo=21%, merienda=11%.`
    : '';

  const medicalRestrictionsBlock = medicalRules.length > 0
    ? '\n\nRESTRICCIONES MÉDICAS OBLIGATORIAS (prioridad máxima, no negociables):\n' + medicalRules.join('\n')
    : '';

  const systemPrompt = `Eres un sistema de planificación nutricional clínica.

Reglas nutricionales:
- Alergias: exclusión absoluta, sin excepciones.${diabetesRule ? '\n' + diabetesRule : ''}
- Tipo de dieta — respetar estrictamente:
  Normal: sin restricciones
  Vegetariana: sin carne ni pescado; sí lácteos y huevos
  Vegana: sin ningún producto animal (carne, pescado, lácteos, huevos, miel)
  Pescetariana: sin carne; sí pescado, marisco, lácteos y huevos
  Keto: máximo 5% carbohidratos, 70% grasas saludables
  Baja en carbohidratos: máximo 20% carbos
  Alta en proteína: mínimo 40% proteína
- Calorías diarias: entre 97%-103% del objetivo. Macros con ±5% de tolerancia.
- Días de gimnasio: proteína +15%, carbohidratos reducidos equivalente.${freeMealRule ? '\n' + freeMealRule : ''}
- Genera exactamente 7 días en orden Lunes→Domingo, cada día con exactamente 4 comidas: Desayuno, Almuerzo, Merienda, Cena.
- Todos los valores numéricos son enteros sin decimales.

VARIEDAD OBLIGATORIA:
- Ningún plato puede repetirse en la misma semana.
- Ningún ingrediente proteico principal (pollo, salmón, atún, ternera, huevo, cerdo, pavo) puede aparecer más de 2 veces en la semana en el mismo tipo de comida.
- Alterna métodos de cocción: plancha, horno, vapor, crudo, salteado, cocido.
- Incluye al menos 3 países de origen culinario diferentes durante la semana (mediterráneo, asiático, mexicano, etc.).
- Varía las fuentes de carbohidratos: arroz, pasta, patata, quinoa, pan, legumbres — no repetir más de 2 veces.
- El desayuno debe ser diferente cada día — nunca repetir el mismo desayuno.

Estructura del JSON — usa EXACTAMENTE estas claves abreviadas:
- "d": array de 7 días
- Cada día: "n" (nombre), "k" (kcal), "p" (proteína g), "c" (carbs g), "g" (grasa g), "m" (array de comidas)
- Cada comida: "t" (tipo), "n" (nombre plato), "k" (kcal), "p" (proteína g), "c" (carbs g), "g" (grasa g), "i" (máx 4 ingredientes CON cantidad en gramos o unidades comerciales, separados por coma. Formato: 'ingrediente Xg' o 'ingrediente Xud'. Ejemplo: 'avena 80g, whey 30g, leche 200ml, plátano 1ud')${medicalRestrictionsBlock}`;

  try {
    const completion = await Promise.race([
      groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('El plan está tardando demasiado. Inténtalo de nuevo.')), 120000)
      ),
    ]);

    const text = completion.choices[0].message.content;
    if (!text) throw new Error('Sin respuesta del modelo.');

    const parsed = JSON.parse(text);
    const legacyDays: any[] = [];

    if (Array.isArray(parsed?.d)) {
      for (const day of parsed.d) {
        const mealList = Array.isArray(day.m) ? day.m.map((meal: any) => ({
          type: meal.t,
          description: meal.n,
          calories: meal.k,
          proteinas: meal.p,
          carbohidratos: meal.c,
          grasas: meal.g,
          ingredientes: meal.i,
        })) : [];
        legacyDays.push({
          day: day.n,
          calorias: day.k,
          proteinas: day.p,
          carbohidratos: day.c,
          grasas: day.g,
          meals: mealList,
        });
      }
    } else if (parsed?.weeklyPlan || Array.isArray(parsed?.days)) {
      const dayOrder = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      const dayNamesEs: Record<string, string> = {
        monday:'Lunes', tuesday:'Martes', wednesday:'Miércoles',
        thursday:'Jueves', friday:'Viernes', saturday:'Sábado', sunday:'Domingo',
      };
      const source = parsed.weeklyPlan ?? {};
      const daysArray: any[] = Array.isArray(parsed.days) ? parsed.days : [];

      for (const key of dayOrder) {
        const day = source[key] ?? daysArray.find(
          (d: any) => d.nombre?.toLowerCase() === dayNamesEs[key].toLowerCase()
                   || d.day?.toLowerCase() === dayNamesEs[key].toLowerCase()
        );
        if (!day) continue;
        const meals = day.meals ?? day.m ?? [];
        const mealList = meals.map((meal: any) => ({
          type: meal.tipo ?? meal.type ?? meal.t,
          description: meal.descripcion ?? meal.description ?? meal.n,
          calories: meal.calorias ?? meal.calories ?? meal.k,
          proteinas: meal.proteinas ?? meal.p,
          carbohidratos: meal.carbohidratos ?? meal.c,
          grasas: meal.grasas ?? meal.g,
          ingredientes: meal.ingredientes ?? meal.i,
        }));
        legacyDays.push({
          day: day.nombre ?? day.day ?? dayNamesEs[key],
          calorias: day.calorias ?? day.calories ?? day.k,
          proteinas: day.proteinas ?? day.p,
          carbohidratos: day.carbohidratos ?? day.c,
          grasas: day.grasas ?? day.g,
          meals: mealList,
        });
      }
    }

    return { days: legacyDays, recommendations: 'Disfruta de tu plan de comidas.' };
  } catch (error: any) {
    console.error('Error generating menu:', error);
    throw friendlyGroqError(error, 'No se pudo generar el menú. Inténtalo de nuevo.');
  }
}

export async function generateWorkoutPlan(
  profileStr: string,
  onProgress?: (step: string) => void
): Promise<string> {
  const data = JSON.parse(profileStr);
  const trainingDays: number = data.trainingDaysPerWeek || 3;
  const isHome = data.workoutType === 'home';
  const hasDiabetes = data.diabetesType && data.diabetesType !== 'none';

  const diabetesNotes = hasDiabetes
    ? `\n- El usuario tiene diabetes tipo ${data.diabetesType}: mantén intensidad moderada (RPE 5-7), NUNCA en ayunas, incluye una nota breve de monitorización de glucosa al inicio del plan.`
    : '';

  const baseSystem = `Eres un entrenador personal experto en fisiología del ejercicio y rendimiento deportivo.

Perfil del usuario:
- Edad: ${data.age} años | Sexo: ${data.gender} | Peso: ${data.weight ?? data.currentWeight ?? 'N/A'}kg | Altura: ${data.height}cm
- Objetivo de entrenamiento: ${data.gymGoal || 'forma física general'}
- Ubicación: ${isHome ? 'Entrenamiento en casa (sin equipamiento, solo peso corporal y material doméstico)' : 'Gimnasio (pesas libres, máquinas, poleas)'}
- Días de entrenamiento por semana: ${trainingDays}${diabetesNotes}

Reglas:
- Ejercicios reales y específicos — nunca genéricos como "ejercicio de piernas"
- Progresión lógica entre días (no repitas el mismo grupo muscular consecutivo sin recuperación)
- Calentamiento específico al foco del día (no genérico)
- Vuelta a la calma en todos los días
- ${isHome ? 'Solo ejercicios sin equipamiento o con silla/suelo/pared' : 'Aprovecha máquinas, poleas y peso libre del gimnasio'}
- Cada sección lleva sus ejercicios en una tabla markdown de 3 columnas
- El nombre de cada ejercicio debe ser un enlace de YouTube: [Nombre](https://www.youtube.com/results?search_query=Nombre+ejercicio+tutorial)`;

  const dayFormat = `# DÍA N — [FOCO EN MAYÚSCULAS]

### Calentamiento
| Ejercicio | Trabajo | RPE |
|-----------|---------|-----|
| [Nombre](https://www.youtube.com/results?search_query=Nombre+tutorial) | 2 × 10 reps | 4 |

### Bloque principal
| Ejercicio | Trabajo | RPE |
|-----------|---------|-----|
| [Nombre](https://www.youtube.com/results?search_query=Nombre+tutorial) | 4 × 8-10 | 8 |

### Vuelta a la calma
| Ejercicio | Duración |
|-----------|----------|
| [Estiramiento](https://www.youtube.com/results?search_query=Estiramiento+tutorial) | 30 seg |

---`;

  try {
    const parts: string[] = [];
    // Track what each day covered (focus + key muscles) to pass as context
    const daySummaries: string[] = [];

    // ── STEP 1: INFO block ──────────────────────────────────────────────────
    onProgress?.('Analizando perfil...');
    const infoCompletion = await withRateLimitRetry(() =>
      groq.chat.completions.create({
        model: FAST_MODEL,
        messages: [
          { role: 'system', content: baseSystem },
          {
            role: 'user',
            content: `Genera ÚNICAMENTE la sección ## INFO del plan de ${trainingDays} días. Una descripción breve: objetivo, duración estimada por sesión y equipamiento necesario. Máximo 4 líneas. Empieza exactamente con "## INFO".`,
          },
        ],
        temperature: 0.5,
        max_tokens: 300,
      })
    );
    parts.push(infoCompletion.choices[0].message.content?.trim() ?? '## INFO\nPlan de entrenamiento personalizado.');

    parts.push('\n\n## EJERCICIOS\n');

    // ── STEP 2: One call per day ────────────────────────────────────────────
    for (let day = 1; day <= trainingDays; day++) {
      onProgress?.(`Generando Día ${day} de ${trainingDays}...`);

      const contextNote = daySummaries.length > 0
        ? `Días ya generados (NO repetir los mismos grupos musculares principales):\n${daySummaries.join('\n')}\n\n`
        : '';

      const dayCompletion = await withRateLimitRetry(() =>
        groq.chat.completions.create({
          model: FAST_MODEL,
          messages: [
            { role: 'system', content: baseSystem },
            {
              role: 'user',
              content: `${contextNote}Genera ÚNICAMENTE el DÍA ${day} del plan con este formato exacto:\n\n${dayFormat.replace('N', String(day))}\n\nIncluye calentamiento (3-4 ejercicios), bloque principal (5-7 ejercicios) y vuelta a la calma (3-4 estiramientos). Empieza directamente con "# DÍA ${day}".`,
            },
          ],
          temperature: 0.7,
          max_tokens: 1800,
        })
      );

      const dayContent = dayCompletion.choices[0].message.content?.trim() ?? '';
      parts.push(dayContent);

      // Extract focus line for context to next days
      const focusMatch = dayContent.match(/# DÍA \d+ — (.+)/);
      if (focusMatch) daySummaries.push(`- DÍA ${day}: ${focusMatch[1]}`);
    }

    // ── STEP 3: TIPS block ──────────────────────────────────────────────────
    onProgress?.('Añadiendo consejos del coach...');
    const tipsCompletion = await withRateLimitRetry(() =>
      groq.chat.completions.create({
        model: FAST_MODEL,
        messages: [
          { role: 'system', content: baseSystem },
          {
            role: 'user',
            content: `El plan tiene estos días: ${daySummaries.join(', ')}.\n\nGenera ÚNICAMENTE la sección ## TIPS: consejos de nutrición peri-entreno, recuperación, progresión semanal y notas del coach. Empieza exactamente con "## TIPS".`,
          },
        ],
        temperature: 0.6,
        max_tokens: 600,
      })
    );
    parts.push('\n\n' + (tipsCompletion.choices[0].message.content?.trim() ?? '## TIPS\nRecupera bien entre sesiones.'));

    return parts.join('\n\n');
  } catch (error: any) {
    console.error('Error generating workout:', error);
    throw friendlyGroqError(error, 'No se pudo generar la rutina. Inténtalo de nuevo.');
  }
}

export async function recalculateFoodMacros(foodDescription: string, contextStr?: string): Promise<Partial<NutritionalInfo>> {
  const systemPrompt = `Eres un experto nutricionista deportivo y coach empático y motivador. Estima con precisión el contenido nutricional del alimento descrito. Presta especial atención al tamaño de la porción y al método de preparación. Si el nombre del usuario está en el contexto, úsalo.

Responde ÚNICAMENTE con JSON válido con exactamente estos campos:
{"calories": number, "protein": number, "carbs": number, "fat": number, "interpretation": string, "coachMessage": string, "actionableRecommendation": string}`;

  const userPrompt = contextStr
    ? `Estima el valor nutricional de: "${foodDescription}". Contexto: "${contextStr}".`
    : `Estima el valor nutricional de: "${foodDescription}".`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0].message.content;
    if (!text) throw new Error('No se recibió respuesta del modelo.');
    return JSON.parse(text);
  } catch (error: any) {
    console.error('Error recalculating macros:', error);
    throw friendlyGroqError(error, 'No se pudo recalcular. Inténtalo de nuevo.');
  }
}

export interface WeekDaySummary {
  date: string;
  dayName: string;
  status: 'green' | 'yellow' | 'red' | 'future' | 'empty';
  caloriesConsumed: number;
  caloriesGoal: number;
  workoutDone: boolean;
  hadWorkoutPlanned: boolean;
  workoutCalories: number;
}

export async function generateWeeklyAnalysis(
  userName: string,
  days: WeekDaySummary[],
  caloriesGoal: number,
  gymDaysPerWeek: number
): Promise<string> {
  const pastDays = days.filter(d => d.status !== 'future');

  const dayLines = pastDays
    .map(d => {
      const pct = d.caloriesGoal > 0 ? Math.round((d.caloriesConsumed / d.caloriesGoal) * 100) : 0;
      const workout = d.hadWorkoutPlanned
        ? (d.workoutDone ? `entreno completado (${d.workoutCalories}kcal)` : 'entreno NO completado')
        : (d.workoutDone ? `entreno libre (${d.workoutCalories}kcal)` : 'sin entreno');
      return `- ${d.dayName}: ${Math.round(d.caloriesConsumed)}kcal (${pct}% objetivo), ${workout} [${d.status}]`;
    })
    .join('\n');

  const systemPrompt = `Eres el coach personal de ${userName || 'el usuario'}. Hablas en español, SIEMPRE en segunda persona (tú/te/tu/has/tienes). NUNCA uses tercera persona ni el nombre del usuario como sujeto. NUNCA uses saludos ni despedidas. Sé directo, motivador y específico.`;

  const userPrompt = `Analiza esta semana:

${dayLines}

Objetivo diario: ${caloriesGoal}kcal. Días de gym planificados: ${gymDaysPerWeek}.

Responde con exactamente 4 frases numeradas dirigiéndote directamente al usuario (usa "has", "tienes", "te"):
1. Valoración general de la semana (usa datos concretos)
2. Lo que has hecho bien (específico, menciona días o números)
3. Lo que puedes mejorar (accionable y concreto)
4. Un consejo para la próxima semana`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: 350,
    });
    return completion.choices[0].message.content ?? '';
  } catch (error: any) {
    throw friendlyGroqError(error, 'No se pudo generar el análisis. Inténtalo de nuevo.');
  }
}
