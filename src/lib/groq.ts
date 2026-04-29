import Groq from 'groq-sdk';
import type { NutritionalInfo, ShoppingList, WeeklyMenu } from '../types/nutrition';
import { calculateDailyCalories } from '../utils/nutrition';

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

const BUDGET_SUPERMARKETS = new Set(['mercadona', 'lidl', 'carrefour', 'alcampo']);

export async function generateShoppingList(ingredients: any[], supermarket: string = 'Mercadona'): Promise<ShoppingList> {
  const ingredientLines = ingredients
    .filter(i => i.item)
    .map(i => i.day ? `${i.item} [${i.day}]` : i.item)
    .join('\n');

  const includeBudget = BUDGET_SUPERMARKETS.has(supermarket.toLowerCase());

  const systemPrompt = `Eres un asistente de compras experto. Organiza los ingredientes en secciones de supermercado y devuelve ÚNICAMENTE JSON válido. Sin texto adicional. Sin markdown.

Reglas:
- Consolida duplicados: mismo ingrediente varias veces = una sola entrada con cantidad total semanal
- Cantidades en unidades comerciales reales (no "137g" sino "1 paquete 150g" o "7 unidades")
- Omite secciones sin ítems
- Secciones en este orden exacto: "Frutas y verduras", "Carnes y pescados", "Lácteos y huevos", "Cereales y legumbres", "Frutos secos y semillas", "Proteína y suplementos", "Aceites y condimentos", "Otros"${includeBudget ? `\n- Incluye "presupuesto_estimado" con coste semanal aproximado para ${supermarket}` : '\n- NO incluyas "presupuesto_estimado"'}

Formato exacto:
{"secciones":[{"nombre":"Frutas y verduras","items":[{"nombre":"Plátano","cantidad":"7 unidades"}]},{"nombre":"Carnes y pescados","items":[{"nombre":"Pechuga de pollo","cantidad":"1kg"}]}]${includeBudget ? ',"presupuesto_estimado":"75-90€"' : ''}}`;

  const userPrompt = `Supermercado: ${supermarket} | Personas: 1 | Semana completa\n\nIngredientes del menú:\n${ingredientLines}`;

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

    return { categories, budget: parsed.presupuesto_estimado };
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

  const adjustedTargets = { ...targets };
  if (profile.diabetesType !== 'none' && adjustedTargets.carbs > 240) {
    const excessKcal = (adjustedTargets.carbs - 240) * 4;
    adjustedTargets.carbs = 240;
    adjustedTargets.fat = Math.round(adjustedTargets.fat + excessKcal / 9);
  }

  const userPrompt = `Genera el plan nutricional con estos datos:

PERFIL CALCULADO (no recalcules esto, úsalo tal cual):
- Calorías diarias objetivo: ${adjustedTargets.calories} kcal
- Proteína diaria: ${adjustedTargets.protein}g
- Carbohidratos diarios: ${adjustedTargets.carbs}g${profile.diabetesType !== 'none' ? ` (máximo absoluto — diabetes)` : ''}
- Grasa diaria: ${adjustedTargets.fat}g

DATOS DEL USUARIO:
- Edad: ${profile.age} | Sexo: ${profile.gender} | Peso: ${currentWeight}kg | Altura: ${profile.height}cm
- Objetivo: ${profile.goal}
- Días de gimnasio esta semana: ${profile.trainingDaysPerWeek} (distribúyelos a tu criterio)
- Condiciones médicas: ${profile.diabetesType !== 'none' ? `Diabetes tipo ${profile.diabetesType}` : 'Ninguna'}
- Alergias absolutas: ${allergiesStr}
- Alimentos que no le gustan: ${profile.dislikedFoods || 'Ninguno'}
- Supermercado de referencia: ${profile.favoriteSupermarket || 'Cualquiera'}

COMIDA LIBRE:
- Habilitada: ${profile.freeMealEnabled ? 'Sí' : 'No'}
- Día: ${profile.freeMealDay || ''}
- Tipo: ${profile.freeMealType || ''}`;

  const diabetesRule = profile.diabetesType !== 'none'
    ? `- RESTRICCIÓN ABSOLUTA DIABETES tipo ${profile.diabetesType}: NINGUNA comida individual puede superar 60g de carbohidratos. Este límite es INVIOLABLE. El total diario de ${adjustedTargets.carbs}g repartido en máximo 60g por ingesta. Alimentos de índice glucémico bajo.`
    : '';

  const freeMealRule = profile.freeMealEnabled
    ? `- Comida libre el ${profile.freeMealDay} en ${profile.freeMealType}: usa exactamente {"t":"${profile.freeMealType}","n":"COMIDA LIBRE","k":0,"p":0,"c":0,"g":0,"i":"libre"}. Distribución ese día: libre=50%, desayuno=18%, almuerzo=21%, merienda=11%.`
    : '';

  const systemPrompt = `Eres un sistema de planificación nutricional clínica.

Reglas nutricionales:
- Alergias: exclusión absoluta, sin excepciones.${diabetesRule ? '\n' + diabetesRule : ''}
- Calorías diarias: entre 97%-103% del objetivo. Macros con ±5% de tolerancia.
- Días de gimnasio: proteína +15%, carbohidratos reducidos equivalente.${freeMealRule ? '\n' + freeMealRule : ''}
- Genera exactamente 7 días en orden Lunes→Domingo, cada día con exactamente 4 comidas: Desayuno, Almuerzo, Merienda, Cena.
- Todos los valores numéricos son enteros sin decimales.

Estructura del JSON — usa EXACTAMENTE estas claves abreviadas:
- "d": array de 7 días
- Cada día: "n" (nombre), "k" (kcal), "p" (proteína g), "c" (carbs g), "g" (grasa g), "m" (array de comidas)
- Cada comida: "t" (tipo), "n" (nombre plato), "k" (kcal), "p" (proteína g), "c" (carbs g), "g" (grasa g), "i" (máx 4 ingredientes separados por coma, sin cantidades)`;

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

export async function generateWorkoutPlan(profileStr: string): Promise<string> {
  const data = JSON.parse(profileStr);
  const trainingDays: number = data.trainingDaysPerWeek || 3;
  const isHome = data.workoutType === 'home';
  const hasDiabetes = data.diabetesType && data.diabetesType !== 'none';

  const diabetesNotes = hasDiabetes
    ? `\n- El usuario tiene diabetes tipo ${data.diabetesType}: mantén intensidad moderada (RPE 5-7), NUNCA en ayunas, incluye una nota breve de monitorización de glucosa al inicio del plan.`
    : '';

  const systemPrompt = `Eres un entrenador personal experto en fisiología del ejercicio y rendimiento deportivo.

Perfil del usuario:
- Edad: ${data.age} años | Sexo: ${data.gender} | Peso: ${data.weight ?? data.currentWeight ?? 'N/A'}kg | Altura: ${data.height}cm
- Objetivo: ${data.gymGoal || data.goal || 'forma física general'}
- Ubicación: ${isHome ? 'Entrenamiento en casa (sin equipamiento, solo peso corporal y material doméstico)' : 'Gimnasio (pesas libres, máquinas, poleas)'}
- Días de entrenamiento por semana: ${trainingDays}${diabetesNotes}

Reglas:
- Ejercicios reales y específicos — nunca genéricos como "ejercicio de piernas"
- Series, repeticiones y RPE por cada ejercicio
- Progresión lógica entre días (no repitas el mismo grupo muscular consecutivo sin recuperación)
- Calentamiento específico al foco del día (no genérico)
- Vuelta a la calma en todos los días
- Si trainingDays < 7, añade un día de descanso activo al final (estiramientos / movilidad)
- ${isHome ? 'Solo ejercicios sin equipamiento o con silla/suelo/pared' : 'Aprovecha máquinas, poleas y peso libre del gimnasio'}

Formato de salida — usa EXACTAMENTE esta estructura markdown:

# DÍA 1 — [FOCO DE LA SESIÓN EN MAYÚSCULAS]
## Calentamiento
- Ejercicio: X series × Y reps (RPE Z)

## Bloque principal
- Ejercicio: X series × Y reps (RPE Z)

## Vuelta a la calma
- Ejercicio: X min / Y reps

---

# DÍA 2 — [FOCO]
...

Separa cada día con ---. No añadas introducción ni conclusión fuera de los días.`;

  const userPrompt = `Genera un plan de entrenamiento semanal completo con exactamente ${trainingDays} días de entrenamiento activo.`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    });

    return completion.choices[0].message.content || 'No se pudo generar la rutina.';
  } catch (error: any) {
    console.error('Error generating workout:', error);
    throw friendlyGroqError(error, 'No se pudo generar la rutina. Inténtalo de nuevo.');
  }
}
