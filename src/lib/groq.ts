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
  type: 'meal_added' | 'workout_done' | 'workout_exercise' | 'free_workout' | 'weight_updated' | 'day_start' | 'goal_90pct' | 'goal_exceeded';
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
}

export async function generateProactiveMessage(event: ProactiveEvent, context: CoachContext): Promise<string> {
  const { profile, goals } = context;
  const dayName = new Date().toLocaleDateString('es-ES', { weekday: 'long' });

  const eventPrompts: Record<ProactiveEvent['type'], string> = {
    day_start: `El usuario acaba de abrir la app. Es ${dayName}. Salúdale con su nombre (${profile.name || 'usuario'}), dile qué tiene hoy (objetivo: ${goals.calories}kcal) y una motivación breve.`,
    meal_added: `El usuario acaba de registrar: ${event.data.meal?.foodName} (${Math.round(event.data.meal?.calories ?? 0)}kcal). Lleva ${Math.round(event.data.totalCalories)}kcal de ${goals.calories}kcal objetivo. Comenta brevemente y dile qué le queda.`,
    workout_done: `El usuario acaba de completar su rutina de ${event.data.focus ?? 'entrenamiento'} quemando ${event.data.calories ?? 0}kcal. Felicítale y dale un consejo de recuperación.`,
    workout_exercise: `El usuario ha completado un ejercicio de su rutina. Anímale brevemente.`,
    free_workout: `El usuario ha registrado un entrenamiento libre: ${event.data.activity ?? 'ejercicio'} durante ${event.data.durationMinutes ?? '?'} minutos quemando ${Math.round(event.data.calories ?? 0)}kcal. Felicítale brevemente.`,
    weight_updated: `El usuario ha registrado su peso. Peso actual: ${event.data.current}kg. ${event.data.previous ? `Cambio: ${event.data.diff > 0 ? '+' : ''}${Number(event.data.diff).toFixed(1)}kg` : 'Es su primer registro de peso.'}. Comenta la tendencia de forma motivadora.`,
    goal_90pct: `El usuario está al 90% de su objetivo calórico. Le quedan ${Math.round(event.data.remaining ?? 0)}kcal. Avísale y sugiere qué puede comer con lo que le queda.`,
    goal_exceeded: `El usuario ha superado su objetivo calórico en ${Math.round(event.data.excess ?? 0)}kcal. Mensaje tranquilizador, sin dramatizar, con consejo práctico para el resto del día.`,
  };

  const systemPrompt = `Eres el coach personal de ${profile.name || 'usuario'}. Conoces su perfil y su plan de la semana. Responde en máximo 2 frases. Tono directo y motivador. NUNCA uses saludos largos ni despedidas. Solo el mensaje esencial.`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: eventPrompts[event.type] },
      ],
      temperature: 0.8,
      max_tokens: 150,
    });
    return completion.choices[0].message.content ?? '';
  } catch {
    return '';
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

  const adjustedTargets = { ...targets };
  if (profile.diabetesType !== 'none' && adjustedTargets.carbs > 240) {
    const excessKcal = (adjustedTargets.carbs - 240) * 4;
    adjustedTargets.carbs = 240;
    adjustedTargets.fat = Math.round(adjustedTargets.fat + excessKcal / 9);
  }

  const userPrompt = `Genera el menú semanal con estos datos:

PERFIL CALCULADO (no recalcules esto, úsalo tal cual):
- Calorías diarias objetivo: ${adjustedTargets.calories} kcal
- Proteína diaria: ${adjustedTargets.protein}g
- Carbohidratos diarios: ${adjustedTargets.carbs}g${profile.diabetesType !== 'none' ? ` (máximo absoluto — diabetes)` : ''}
- Grasa diaria: ${adjustedTargets.fat}g

DATOS DEL USUARIO:
- Edad: ${profile.age} | Sexo: ${profile.gender} | Peso: ${currentWeight}kg | Altura: ${profile.height}cm
- Objetivo: ${profile.goal === 'lose' ? 'Perder grasa' : profile.goal === 'gain' ? 'Ganar músculo' : 'Mantener peso'}
- Tipo de dieta: ${profile.dietType || 'Normal'}
- Días de gimnasio esta semana: ${profile.trainingDaysPerWeek} (distribúyelos a tu criterio)
- Condiciones médicas: ${profile.diabetesType !== 'none' ? `Diabetes tipo ${profile.diabetesType}` : 'Ninguna'}
- Alergias absolutas: ${allergiesStr}
- Alimentos que no le gustan: ${profile.dislikedFoods || 'Ninguno'}


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
- Objetivo de entrenamiento: ${data.gymGoal || 'forma física general'}
- Ubicación: ${isHome ? 'Entrenamiento en casa (sin equipamiento, solo peso corporal y material doméstico)' : 'Gimnasio (pesas libres, máquinas, poleas)'}
- Días de entrenamiento por semana: ${trainingDays}${diabetesNotes}

Reglas:
- Ejercicios reales y específicos — nunca genéricos como "ejercicio de piernas"
- Progresión lógica entre días (no repitas el mismo grupo muscular consecutivo sin recuperación)
- Calentamiento específico al foco del día (no genérico)
- Vuelta a la calma en todos los días
- ${isHome ? 'Solo ejercicios sin equipamiento o con silla/suelo/pared' : 'Aprovecha máquinas, poleas y peso libre del gimnasio'}
- Cada sección de cada día lleva sus ejercicios en una tabla markdown de 3 columnas
- El nombre de cada ejercicio debe ser un enlace de YouTube: [Nombre](https://www.youtube.com/results?search_query=Nombre+ejercicio+tutorial)

Formato de salida — usa EXACTAMENTE estos encabezados de sección (## INFO, ## EJERCICIOS, ## TIPS):

## INFO
Descripción general de la rutina: objetivo, duración estimada por sesión y equipamiento necesario.

## EJERCICIOS

# DÍA 1 — [FOCO EN MAYÚSCULAS]

### Calentamiento
| Ejercicio | Trabajo | RPE |
|-----------|---------|-----|
| [Nombre ejercicio](https://www.youtube.com/results?search_query=Nombre+ejercicio+tutorial) | 2 × 10 reps | 4 |

### Bloque principal
| Ejercicio | Trabajo | RPE |
|-----------|---------|-----|
| [Nombre ejercicio](https://www.youtube.com/results?search_query=Nombre+ejercicio+tutorial) | 4 × 8-10 | 8 |

### Vuelta a la calma
| Ejercicio | Duración |
|-----------|----------|
| [Estiramiento](https://www.youtube.com/results?search_query=Estiramiento+tutorial) | 30 seg |

---

# DÍA 2 — [FOCO]
...

## TIPS
Consejos de nutrición peri-entreno, recuperación, progresión semanal y notas del coach.`;

  const userPrompt = `Genera un plan de entrenamiento semanal completo con EXACTAMENTE ${trainingDays} días de entrenamiento activo, numerados DÍA 1 hasta DÍA ${trainingDays}. NO añadas días de descanso activo numerados — si quieres incluir consejos de descanso o movilidad, inclúyelos dentro de la sección ## TIPS, no como un DÍA extra.`;

  try {
    const completion = await withRateLimitRetry(() =>
      groq.chat.completions.create({
        model: FAST_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
      })
    );
    return completion.choices[0].message.content || 'No se pudo generar la rutina.';
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
