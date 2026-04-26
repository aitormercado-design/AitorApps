import { GoogleGenAI, Type } from "@google/genai";
import { calcularBMR } from '../utils/nutrition';

const ai = new GoogleGenAI({
  apiKey: (import.meta.env.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string) || '',
});

export type NutritionalInfo = {
  foodName: string;
  totalWeight: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients: { name: string; amount: string }[];
  confidence: "alta" | "media" | "baja";
  confidenceMessage: string;
  alternatives?: string[];
  isHealthy?: boolean;
  healthAnalysis?: string;
  recommendations?: string;
  nutriScore?: "A" | "B" | "C" | "D" | "E";
  densityAnalysis?: string;
  interpretation?: string;
  coachMessage?: string;
  actionableRecommendation?: string;
};

export async function analyzeFoodImage(base64Image: string, mimeType: string, contextStr?: string): Promise<NutritionalInfo> {
  try {
    const prompt = contextStr
      ? `Analiza detalladamente esta imagen de comida. Identifica el tamaño de la porción (peso total estimado en gramos), el método de preparación y los ingredientes visibles con sus cantidades estimadas. Estima su valor nutricional con la mayor precisión posible. Evalúa si es saludable y, basándote en este contexto: "${contextStr}", sugiere qué debería comer el resto del día. Calcula un NutriScore (A-E) basado en la densidad nutricional. Si el usuario tiene diabetes, presta especial atención al índice glucémico y balance de carbohidratos. Devuelve un objeto JSON.`
      : `Analiza detalladamente esta imagen de comida. Identifica el tamaño de la porción (peso total estimado en gramos), el método de preparación y los ingredientes visibles con sus cantidades estimadas. Estima su valor nutricional con la mayor precisión posible. Evalúa si es saludable y sugiere qué debería comer el resto del día. Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`;

    const apiPromise = ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType } },
          { text: prompt },
        ],
      },
      config: {
        systemInstruction: "Eres un experto nutricionista especializado en nutrición deportiva y gestión de patologías como la DIABETES. Actúa como un coach muy empático, positivo y motivador. Tu tarea es analizar imágenes de comida y estimar de forma precisa su contenido nutricional y peso. Evalúa la calidad nutricional asignando un NutriScore de A a E. Proporciona una interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas'). Escribe un mensaje de coach muy cercano, comprensivo y motivador (coachMessage) sin tecnicismos, enfocado en animar al usuario y no ser estricto ni condescendiente. Si el usuario es diabético, enfócate en la estabilidad de la glucosa sin ser alarmista. Si el nombre del usuario está en el contexto, úsalo para dirigirte a él de forma personal. Da una recomendación accionable inmediata (actionableRecommendation) sobre qué hacer en la próxima comida. Evalúa tu nivel de confianza en la detección. Desglosa los ingredientes principales con sus gramos estimados. Sé consistente con las estimaciones de peso y calorías.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foodName: { type: Type.STRING, description: "Nombre del plato o alimento en español" },
            totalWeight: { type: Type.NUMBER, description: "Peso total estimado del plato en gramos (g)" },
            calories: { type: Type.NUMBER, description: "Calorías totales estimadas (kcal)" },
            protein: { type: Type.NUMBER, description: "Proteínas estimadas en gramos" },
            carbs: { type: Type.NUMBER, description: "Carbohidratos estimados en gramos" },
            fat: { type: Type.NUMBER, description: "Grasas estimadas en gramos" },
            ingredients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Nombre del ingrediente" },
                  amount: { type: Type.STRING, description: "Cantidad estimada (ej: '150g', '1 unidad', '20g')" },
                },
                required: ["name", "amount"],
              },
              description: "Lista de ingredientes principales detectados",
            },
            confidence: { type: Type.STRING, enum: ["alta", "media", "baja"], description: "Nivel de confianza en la detección" },
            confidenceMessage: { type: Type.STRING, description: "Mensaje detallando por qué se tiene este nivel de confianza" },
            alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Posibles alimentos alternativos si la detección es incierta" },
            interpretation: { type: Type.STRING, description: "Interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas', 'Baja en proteína')" },
            coachMessage: { type: Type.STRING, description: "Mensaje humano, cercano y motivador del coach sobre esta comida, sin tecnicismos." },
            actionableRecommendation: { type: Type.STRING, description: "Recomendación inmediata y concreta (ej. 'Compensa con cena ligera', 'Añade proteína en la próxima comida')" },
            nutriScore: { type: Type.STRING, enum: ["A", "B", "C", "D", "E"], description: "Calificación nutricional de A a E" },
          },
          required: ["foodName", "totalWeight", "calories", "protein", "carbs", "fat", "ingredients", "confidence", "confidenceMessage", "interpretation", "coachMessage", "actionableRecommendation", "nutriScore"],
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("El análisis está tardando demasiado. Por favor, comprueba tu conexión a internet e inténtalo de nuevo.")), 25000);
    });

    const response = await Promise.race([apiPromise, timeoutPromise]);
    const text = response.text;
    if (!text) throw new Error("No se recibió respuesta del modelo.");

    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }

    return JSON.parse(cleanText) as NutritionalInfo;
  } catch (error: any) {
    console.error("Error in analyzeFoodImage:", error);
    const errorMessage = error.message || "Error desconocido";
    if (errorMessage.includes("API key not valid")) {
      throw new Error("La clave de API de Gemini no es válida. Por favor, revísala en los secretos.");
    }
    throw new Error(`Error al analizar la imagen: ${errorMessage}`);
  }
}

export async function analyzeFoodText(foodDescription: string, contextStr?: string): Promise<NutritionalInfo> {
  try {
    const prompt = contextStr 
      ? `Analiza este alimento o comida: "${foodDescription}". Ten en cuenta el contexto: "${contextStr}". Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`
      : `Analiza este alimento o comida: "${foodDescription}". Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: prompt,
      config: {
        systemInstruction: "Eres un experto nutricionista deportivo y un coach muy empático, positivo y motivador. Tu tarea es estimar de forma precisa el contenido nutricional del alimento descrito. Proporciona una interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas'). Escribe un mensaje de coach muy cercano, comprensivo y motivador (coachMessage) sin tecnicismos, enfocado en animar al usuario y no ser estricto ni condescendiente. Si el nombre del usuario está en el contexto, úsalo para dirigirte a él de forma personal. Da una recomendación accionable inmediata (actionableRecommendation) sobre qué hacer en la próxima comida, teniendo en cuenta el contexto proporcionado. Devuelve un objeto JSON estructurado.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foodName: { type: Type.STRING, description: "Nombre del plato o alimento en español" },
            totalWeight: { type: Type.NUMBER, description: "Peso total estimado del plato en gramos (g)" },
            calories: { type: Type.NUMBER, description: "Calorías totales estimadas (kcal)" },
            protein: { type: Type.NUMBER, description: "Proteínas estimadas en gramos" },
            carbs: { type: Type.NUMBER, description: "Carbohidratos estimados en gramos" },
            fat: { type: Type.NUMBER, description: "Grasas estimadas en gramos" },
            ingredients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Nombre del ingrediente" },
                  amount: { type: Type.STRING, description: "Cantidad estimada (ej: '150g', '1 unidad', '20g')" },
                },
                required: ["name", "amount"],
              },
              description: "Lista de ingredientes principales detectados",
            },
            confidence: { type: Type.STRING, enum: ["alta", "media", "baja"], description: "Nivel de confianza en la detección" },
            confidenceMessage: { type: Type.STRING, description: "Mensaje detallando por qué se tiene este nivel de confianza" },
            interpretation: { type: Type.STRING, description: "Interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas', 'Baja en proteína')" },
            coachMessage: { type: Type.STRING, description: "Mensaje humano, cercano y motivador del coach sobre esta comida, sin tecnicismos." },
            actionableRecommendation: { type: Type.STRING, description: "Recomendación inmediata y concreta (ej. 'Compensa con cena ligera', 'Añade proteína en la próxima comida')" },
            nutriScore: { type: Type.STRING, enum: ["A", "B", "C", "D", "E"], description: "Calificación nutricional de A a E" },
          },
          required: ["foodName", "totalWeight", "calories", "protein", "carbs", "fat", "ingredients", "confidence", "confidenceMessage", "interpretation", "coachMessage", "actionableRecommendation", "nutriScore"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No se recibió respuesta del modelo.");

    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }

    return JSON.parse(cleanText) as NutritionalInfo;
  } catch (error) {
    console.error("Error analyzing food text:", error);
    throw new Error("No se pudo analizar el texto. Inténtalo de nuevo.");
  }
}

export async function recalculateFoodMacros(foodDescription: string, contextStr?: string): Promise<Partial<NutritionalInfo>> {
  try {
    const prompt = contextStr 
      ? `Estima el valor nutricional de este alimento: "${foodDescription}". Ten en cuenta el contexto: "${contextStr}". Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`
      : `Estima el valor nutricional de este alimento: "${foodDescription}". Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "Eres un experto nutricionista deportivo y un coach muy empático, positivo y motivador. Tu tarea es estimar de forma precisa el contenido nutricional (calorías y macronutrientes) del alimento descrito. Es CRÍTICO que prestes especial atención al tamaño de las porciones descritas y a los métodos de preparación. Proporciona una interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas'). Escribe un mensaje de coach muy cercano, comprensivo y motivador (coachMessage) sin tecnicismos, enfocado en animar al usuario y no ser estricto ni condescendiente. Si el nombre del usuario está en el contexto, úsalo para dirigirte a él de forma personal. Da una recomendación accionable inmediata (actionableRecommendation) sobre qué hacer en la próxima comida, teniendo en cuenta el contexto.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            calories: { type: Type.NUMBER, description: "Calorías totales estimadas (kcal)" },
            protein: { type: Type.NUMBER, description: "Proteínas estimadas en gramos" },
            carbs: { type: Type.NUMBER, description: "Carbohidratos estimados en gramos" },
            fat: { type: Type.NUMBER, description: "Grasas estimadas en gramos" },
            interpretation: { type: Type.STRING, description: "Interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas', 'Baja en proteína')" },
            coachMessage: { type: Type.STRING, description: "Mensaje humano, cercano y motivador del coach sobre esta comida, sin tecnicismos." },
            actionableRecommendation: { type: Type.STRING, description: "Recomendación inmediata y concreta (ej. 'Compensa con cena ligera', 'Añade proteína en la próxima comida')" },
          },
          required: ["calories", "protein", "carbs", "fat", "interpretation", "coachMessage", "actionableRecommendation"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No se recibió respuesta del modelo.");

    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }

    return JSON.parse(cleanText);
  } catch (error: any) {
    console.error("Error recalculating macros:", error);
    const errorMessage = error.message || "Error desconocido";
    if (errorMessage.includes("API key not valid")) {
      throw new Error("La clave de API de Gemini no es válida. Por favor, revísala en los secretos.");
    }
    throw new Error(`Error al recalcular: ${errorMessage}`);
  }
}

export interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function calculateDailyCalories(profile: any, currentWeight: number): NutritionTargets {
  // Mifflin-St Jeor 
  const bmr = calcularBMR(profile, currentWeight);

  // Factor de actividad según días de gym
  const activityFactor =
    profile.trainingDaysPerWeek === 0 ? 1.2  :
    profile.trainingDaysPerWeek <= 2  ? 1.375:
    profile.trainingDaysPerWeek <= 4  ? 1.55 :
    profile.trainingDaysPerWeek <= 6  ? 1.725: 1.9;

  const tdee = Math.round(bmr * activityFactor);

  // Ajuste según objetivo
  const calories =
    profile.goal === 'lose'     ? tdee - 400 :
    profile.goal === 'gain'     ? tdee + 300 : tdee;

  // Macros por objetivo
  const proteinPct = profile.goal === 'gain' ? 0.30 : 0.25;
  const fatPct     = 0.25;
  const carbsPct   = 1 - proteinPct - fatPct;

  return {
    calories,
    protein: Math.round((calories * proteinPct) / 4),
    carbs:   Math.round((calories * carbsPct)   / 4),
    fat:     Math.round((calories * fatPct)      / 9),
  };
}

export function extractIngredients(menuData: any): any[] {
  const ingredients: any[] = [];
  const days = menuData?.days ?? [];

  for (const day of days) {
    const dayName = day.day ?? day.nombre ?? day.n ?? '';
    const meals = day.meals ?? day.m ?? [];

    for (const meal of meals) {
      const ingredientStr = meal.ingredientes ?? meal.i ?? '';
      if (!ingredientStr) continue;

      const items = String(ingredientStr).split(',').map((i: string) => i.trim()).filter(Boolean);
      for (const item of items) {
        ingredients.push({ item, day: dayName });
      }
    }
  }
  return ingredients;
}

export type WeeklyMenu = any;

export async function generateWeeklyMenu(profile: any, currentWeight: number): Promise<WeeklyMenu> {
  try {
    const targets = calculateDailyCalories(profile, currentWeight);
    const allergiesStr = Array.isArray(profile.allergies) && profile.allergies.length > 0
      ? profile.allergies.join(', ')
      : 'Ninguna';

    // Diabetes: cap carbs at 60g × 4 meals = 240g max, redistribute excess kcal to fat
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
      ? `- RESTRICCIÓN ABSOLUTA DIABETES tipo ${profile.diabetesType}: NINGUNA comida individual puede superar 60g de carbohidratos. Este límite es INVIOLABLE y prevalece sobre cualquier otro objetivo. El total diario de ${adjustedTargets.carbs}g debe repartirse en máximo 60g por ingesta. Elige alimentos de índice glucémico bajo.`
      : '';

    const freeMealRule = profile.freeMealEnabled
      ? `- Comida libre el ${profile.freeMealDay} en ${profile.freeMealType}: usa EXACTAMENTE {"t":"${profile.freeMealType}","n":"COMIDA LIBRE","k":0,"p":0,"c":0,"g":0,"i":"libre"} para esa ingesta. Distribución del día: Comida libre=50%, Desayuno=18%, Almuerzo=21%, Merienda=11% del total diario. Las 4 ingestas suman exactamente el 100% del objetivo calórico.`
      : '';

    const systemInstruction = `Eres un sistema de planificación nutricional clínica. Solo JSON puro, sin texto adicional.

Reglas:
- Alergias: exclusión absoluta.${diabetesRule ? '\n' + diabetesRule : ''}
- Calorías diarias: entre 97%-103% del objetivo. Macros con ±5% de tolerancia.
- Días de gimnasio: proteína +15%, carbohidratos reducidos equivalente.${freeMealRule ? '\n' + freeMealRule : ''}

OBLIGATORIO: USA EXACTAMENTE ESTAS CLAVES JSON: d, n, k, p, c, g, m, t, i
NUNCA uses claves largas como "nombre", "calorias", "meals", "proteinas". Solo las abreviadas.
- "d": array con exactamente 7 objetos en orden Lunes→Domingo
- "m": array con exactamente 4 elementos: Desayuno, Almuerzo, Merienda, Cena
- "i": máximo 4 ingredientes sin cantidades, separados por coma
- Todos los valores numéricos son enteros sin decimales. Genera los 7 días completos.

Ejemplo:
{"d":[{"n":"Lunes","k":2900,"p":252,"c":295,"g":81,"m":[{"t":"Desayuno","n":"Avena con whey","k":600,"p":45,"c":75,"g":18,"i":"avena,whey,leche"},{"t":"Almuerzo","n":"Pollo con arroz","k":750,"p":68,"c":80,"g":20,"i":"pollo,arroz,brócoli,aceite"},{"t":"Merienda","n":"Yogur con fruta","k":300,"p":20,"c":45,"g":8,"i":"yogur,plátano,nueces"},{"t":"Cena","n":"Salmón con verduras","k":650,"p":55,"c":40,"g":28,"i":"salmón,espinacas,patata,limón"}]}]}`;

    const apiPromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        thinkingConfig: { thinkingBudget: 1024 },
        maxOutputTokens: 32000,
        systemInstruction,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("El plan está tardando demasiado. Inténtalo de nuevo.")), 120000)
    );

    const response = await Promise.race([apiPromise, timeoutPromise]);
    const text = response.text;
    if (!text) throw new Error("Sin respuesta del modelo.");

    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      throw new Error("Error al procesar el plan. Inténtalo de nuevo.");
    }

    const legacyDays: any[] = [];

    if (Array.isArray(parsed?.d)) {
      // Formato compacto
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
      // Fallback: formato largo con claves en español o inglés
      const dayOrder = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
      const dayNamesEs: Record<string, string> = {
        monday:"Lunes", tuesday:"Martes", wednesday:"Miércoles",
        thursday:"Jueves", friday:"Viernes", saturday:"Sábado", sunday:"Domingo",
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
          type: meal.tipo ?? meal.type ?? meal.nombre ?? meal.t,
          description: meal.descripcion ?? meal.description ?? meal.nombre ?? meal.n,
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

    return {
      days: legacyDays,
      recommendations: "Disfruta de tu plan de comidas.",
    };
  } catch (error: any) {
    console.error("Error generating menu:", error);
    if (error.message?.includes("Quota exceeded") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Se ha superado el límite de uso de la IA. Espera unos minutos e inténtalo de nuevo.");
    }
    throw new Error(error.message || "No se pudo generar el menú. Inténtalo de nuevo.");
  }
}

export type ShoppingItem = {
  name: string;
  amount: string;
};

export type ShoppingList = {
  categories: {
    name: string;
    items: ShoppingItem[];
  }[];
  budget?: string;
};

export async function generateShoppingList(ingredients: any[], supermarket: string = 'Mercadona'): Promise<ShoppingList> {
  try {
    const ingredientLines = ingredients
      .filter(i => i.item)
      .map(i => i.day ? `${i.item} [${i.day}]` : i.item)
      .join('\n');

    const userPrompt = `Supermercado: ${supermarket} | Personas: 1 | Semana completa

Ingredientes del menú (con día de uso):
${ingredientLines}`;

    const systemInstruction = `Eres un organizador de compras para supermercado. Solo JSON puro, sin texto adicional.

Consolida los ingredientes por nombre, agrúpalos en secciones del supermercado y estima cantidades comerciales reales.

Secciones obligatorias (en este orden): "Frutas y verduras", "Carnes y pescados", "Lácteos y huevos", "Cereales y legumbres", "Otros y condimentos"

Reglas:
- Consolida duplicados: mismo ingrediente en distintos días = una entrada con todos los días en "dias"
- Cantidades en unidades comerciales (no "137g" sino "1 paquete 150g" o "7 unidades")
- Omite secciones sin items
- Estima presupuesto total aproximado para ${supermarket}

Ejemplo de estructura:
{"secciones":[{"nombre":"Frutas y verduras","items":[{"nombre":"Plátano","cantidad":"7 unidades","dias":["Lunes","Martes","Miércoles"]}]},{"nombre":"Carnes y pescados","items":[{"nombre":"Pechuga de pollo","cantidad":"1kg (2 pechugas)","dias":["Martes","Jueves","Sábado"]}]}],"presupuesto_estimado":"75-90€"}`;

    const apiPromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        thinkingConfig: { thinkingBudget: 512 },
        maxOutputTokens: 8192,
        systemInstruction,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("La generación de la lista de la compra está tardando demasiado.")), 90000);
    });

    const response = await Promise.race([apiPromise, timeoutPromise]);
    const text = response.text;
    if (!text) throw new Error("No response from model");

    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }

    const parsed = JSON.parse(cleanText);

    const categories = (parsed.secciones ?? [])
      .map((sec: any) => ({
        name: sec.nombre,
        items: (sec.items ?? []).map((it: any) => ({
          name: it.nombre,
          amount: `${it.cantidad}${it.dias?.length ? ' · ' + it.dias.join(', ') : ''}`,
        })),
      }))
      .filter((cat: any) => cat.items.length > 0);

    return { categories, budget: parsed.presupuesto_estimado };
  } catch (error: any) {
    console.error("Error generating shopping list:", error);
    throw new Error(error.message || "No se pudo generar la lista de la compra.");
  }
}

export async function generateWorkoutPlan(profileStr: string): Promise<string> {
  try {
    const data = JSON.parse(profileStr);
    const trainingDays = data.trainingDaysPerWeek || 3;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Genera una rutina de entrenamiento semanal personalizada para este perfil: ${profileStr}.
      TIPO DE ENTRENAMIENTO: ${data.workoutType === 'home' ? 'En casa sin equipamiento (entrenamiento con peso corporal)' : 'En el Gimnasio (GYM) usando pesas y máquinas'}.
      REQUISITOS OBLIGATORIOS:
      1. Genera exactamente ${trainingDays} días de entrenamiento DIFERENTES.
      2. Usa encabezados ## PRESENTACIÓN, ## PLANIFICACIÓN, ## EJERCICIOS y ## SEGURIDAD.
      3. DENTRO de la sección ## EJERCICIOS, cada día DEBE empezar con un encabezado ### (ej: ### Día 1: Piernas). Es vital que cada día tenga su propio encabezado ### y siga el formato "Día X: Nombre".
      4. Para cada uno de los ${trainingDays} días, genera 3 TABLAS con sus respectivos títulos: Calentamiento, Ejercicios y Vuelta a la calma.
      5. Las tablas deben tener: | Ejercicio | Series | Reps | RPE | Descanso |.
      Devuelve la respuesta en formato Markdown estructurado.`,
      config: {
        systemInstruction: `Eres un experto entrenador personal de alto rendimiento.
        Diseña una rutina semanal completa con exactamente el número de días indicados (${trainingDays} días).
        Si el usuario entrena EN CASA, recomienda ejercicios eficaces de calistenia, peso corporal, o movilidad que no requieran equipamiento más allá de material doméstico.
        Si el usuario entrena en el GIMNASIO, recomienda ejercicios con máquinas, poleas, y peso libre.
        Asegúrate de enfatizar la técnica correcta para la ubicación seleccionada.
        Estructura el contenido con secciones claras usando ## y subsecciones por día usando ###.
        Es fundamental que todos los días de entrenamiento estén incluidos bajo la sección ## EJERCICIOS.
        Añade enlaces de imagen en los nombres de ejercicio: [Nombre](https://www.google.com/search?q=gym+exercise+Nombre&tbm=isch).`,
      },
    });
    return response.text || "No se pudo generar la rutina.";
  } catch (error) {
    console.error("Error generating workout:", error);
    throw new Error("No se pudo generar la rutina. Inténtalo de nuevo.");
  }
}

export async function chatWithCoach(messages: {role: 'user' | 'model', parts: {text: string}[]}[], contextStr: string): Promise<string> {
  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: messages,
      config: {
        systemInstruction: `Eres un auténtico experto en fitness, fisiología del ejercicio y nutrición clínica (diabetes). Actúas como un coach motivador 24/7.
Contexto del usuario:
${contextStr}

Instrucciones:
1. Sé extremadamente motivador y profesional. Demuestra autoridad en fitness.
2. Si el usuario tiene diabetes, ofrece consejos para estabilizar la glucosa (ej: orden de ingestión de alimentos, ejercicio ligero post-prandial).
3. Personaliza tus respuestas basándote en su objetivo (fuerza, cardio, etc.).
4. Responde de forma concisa, alentadora y directa, sin ser condescendiente.`,
      },
    });

    let result = '';
    for await (const chunk of stream) {
      result += chunk.text ?? '';
    }
    return result || "Lo siento, no pude procesar eso.";
  } catch (error) {
    console.error("Error in coach chat:", error);
    throw new Error("Hubo un error de conexión. Inténtalo de nuevo.");
  }
}
