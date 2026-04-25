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
  const allIngredients: any[] = [];

  // New format: menuData.days[].meals[].ingredientes (string "Avena 80g · Plátano 1ud")
  if (Array.isArray(menuData?.days)) {
    for (const day of menuData.days) {
      if (Array.isArray(day.meals)) {
        for (const meal of day.meals) {
          if (meal.ingredientes) {
            meal.ingredientes.split(/\s*·\s*|\s*,\s*/).forEach((item: string) => {
              if (item.trim()) allIngredients.push({ item: item.trim() });
            });
          }
        }
      }
    }
    return allIngredients;
  }

  // Legacy format: menuData.weeklyPlan[day].meals (object with meal-type keys)
  if (!menuData?.weeklyPlan) return allIngredients;
  for (const dayKey of Object.keys(menuData.weeklyPlan)) {
    const day = menuData.weeklyPlan[dayKey];
    if (day?.meals) {
      for (const mealKey of Object.keys(day.meals)) {
        const meal = day.meals[mealKey];
        if (meal && Array.isArray(meal.ingredients)) {
          allIngredients.push(...meal.ingredients);
        }
      }
    }
  }
  return allIngredients;
}

export type WeeklyMenu = any;

export async function generateWeeklyMenu(profile: any, currentWeight: number): Promise<WeeklyMenu> {
  try {
    const targets = calculateDailyCalories(profile, currentWeight);
    const allergiesStr = Array.isArray(profile.allergies) && profile.allergies.length > 0 ? profile.allergies.join(', ') : 'Ninguna';
    
    const userPrompt = `Genera un menú semanal completo con estos datos:

PERFIL CALCULADO (no recalcules esto, úsalo tal cual):
- Calorías diarias objetivo: ${targets.calories} kcal
- Proteína diaria: ${targets.protein}g
- Carbohidratos diarios: ${targets.carbs}g
- Grasa diaria: ${targets.fat}g

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

    const mealItem = {
      type: Type.OBJECT,
      properties: {
        nombre:        { type: Type.STRING },
        descripcion:   { type: Type.STRING },
        calorias:      { type: Type.NUMBER },
        proteinas:     { type: Type.NUMBER },
        carbohidratos: { type: Type.NUMBER },
        grasas:        { type: Type.NUMBER },
        ingredientes:  { type: Type.STRING },
      },
      required: ['nombre', 'calorias', 'proteinas', 'carbohidratos', 'grasas', 'ingredientes'],
    };
    const daySchema = {
      type: Type.OBJECT,
      properties: {
        nombre:        { type: Type.STRING },
        calorias:      { type: Type.NUMBER },
        proteinas:     { type: Type.NUMBER },
        carbohidratos: { type: Type.NUMBER },
        grasas:        { type: Type.NUMBER },
        meals:         { type: Type.ARRAY, items: mealItem },
      },
      required: ['nombre', 'calorias', 'proteinas', 'carbohidratos', 'grasas', 'meals'],
    };

    const apiPromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        maxOutputTokens: 8192,
        systemInstruction: `Eres un sistema de planificación nutricional clínica.
Tu única función es generar planes de alimentación semanales estructurados en JSON válido, sin texto adicional, sin explicaciones, sin markdown. Solo JSON. Si no puedes cumplir alguna restricción, indícalo dentro del JSON en el campo "warnings", nunca fuera de él.

Reglas no negociables:
- Respetar estrictamente las alergias declaradas. Una alergia es una exclusión absoluta, no una preferencia.
- Si el usuario tiene diabetes, ninguna comida supera 60g de carbohidratos por ingesta. Los índices glucémicos altos están prohibidos.
- El total calórico diario debe estar entre el 97% y el 103% del objetivo indicado. No hay margen más amplio.
- Los macros (proteína, carbohidratos, grasa) deben respetar los porcentajes indicados con ±5% de tolerancia.
- En días de gimnasio, la ingesta de proteína aumenta un 15% respecto a días de descanso, compensando con una reducción equivalente en carbohidratos.
- Si hay una comida libre declarada, el exceso calórico máximo permitido es de 400 kcal sobre el objetivo diario. El resto de ingestas de ese día se reducen proporcionalmente para absorber ese exceso.

IMPORTANTE PARA FORMATO: "meals" de cada día es un ARRAY. Cada elemento tiene:
- "nombre": nombre de la ingesta ("Desayuno", "Media mañana", "Almuerzo", "Merienda" o "Cena")
- "descripcion": nombre del plato (ej: "Pechuga de pollo con arroz y brócoli")
- "calorias", "proteinas", "carbohidratos", "grasas": números
- "ingredientes": string con ingredientes y cantidades separados por " · " (ej: "Pechuga 150g · Arroz 80g · Brócoli 100g")
Cada objeto de día incluye: "nombre" (día en español, ej: "Lunes"), "calorias", "proteinas", "carbohidratos", "grasas" (totales del día).`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            weeklyPlan: {
              type: Type.OBJECT,
              properties: {
                monday: daySchema, tuesday: daySchema, wednesday: daySchema,
                thursday: daySchema, friday: daySchema, saturday: daySchema, sunday: daySchema,
              },
            },
            nutritionistNotes: { type: Type.STRING },
            warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["weeklyPlan"],
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("La generación del menú está tardando demasiado. Por favor, inténtalo de nuevo.")), 120000);
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

    // Map to legacy format for UI compatibility
    const legacyDays: any[] = [];
    const dayNames: Record<string, string> = {
      monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles",
      thursday: "Jueves", friday: "Viernes", saturday: "Sábado", sunday: "Domingo"
    };

    const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

    if (parsed.weeklyPlan) {
      dayOrder.forEach(dayKey => {
        const dayData = parsed.weeklyPlan[dayKey];
        if (dayData) {
          const mealList: any[] = [];
          if (Array.isArray(dayData.meals)) {
            for (const meal of dayData.meals) {
              mealList.push({
                type: meal.nombre,
                description: meal.descripcion || meal.nombre,
                calories: meal.calorias,
                proteinas: meal.proteinas,
                carbohidratos: meal.carbohidratos,
                grasas: meal.grasas,
                ingredientes: meal.ingredientes,
              });
            }
          }
          legacyDays.push({
            day: dayData.nombre || dayNames[dayKey] || dayKey,
            calorias: dayData.calorias,
            proteinas: dayData.proteinas,
            carbohidratos: dayData.carbohidratos,
            grasas: dayData.grasas,
            meals: mealList,
          });
        }
      });
    }

    parsed.days = legacyDays;
    parsed.recommendations = parsed.nutritionistNotes || "Disfruta de tu plan de comidas.";

    return parsed;
  } catch (error: any) {
    console.error("Error generating menu:", error);
    if (error.message?.includes("Quota exceeded")) {
      throw new Error("Se ha superado el límite de uso diario de la IA. Por favor, inténtalo mañana.");
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
};

export async function generateShoppingList(ingredients: any[], supermarket: string = 'Mercadona'): Promise<ShoppingList> {
  try {
    const userPrompt = `Supermercado de referencia: ${supermarket}
Número de personas: 1
Presupuesto semanal aproximado: null

Lista de ingredientes extraída del menú semanal:
${JSON.stringify(ingredients, null, 2)}`;

    const apiPromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction: `Eres un sistema de organización de compras para supermercado.
Tu única función es recibir una lista de ingredientes en bruto y devolver un JSON organizado, consolidado y listo para comprar.
Solo JSON. Sin texto adicional. Sin explicaciones.

Reglas:
- Consolida duplicados: si el menú usa pechuga de pollo el lunes y el jueves, aparece una sola vez con la cantidad total sumada.
- Redondea cantidades a unidades comerciales reales: no "137g de arroz" sino "200g de arroz (1 bolsa pequeña)".
- Agrupa por sección del supermercado indicado.
- Si un ingrediente puede comprarse ya preparado para ahorrar tiempo (caldo de pollo, tomate triturado) indícalo en el campo "tip".
- Marca con "essential: true" los ingredientes que aparecen en 3 o más días — son los que nunca deben faltar.
- Estima el coste aproximado por sección si el supermercado es Mercadona, Lidl, Carrefour o Alcampo. Si es otro, omite el coste.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            shoppingList: { type: Type.OBJECT },
            summary: {
              type: Type.OBJECT,
              properties: {
                totalItems: { type: Type.NUMBER },
                estimatedTotalCost: { type: Type.NUMBER },
                budgetFeedback: { type: Type.STRING },
                quickWins: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
          },
          required: ["shoppingList"],
        },
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
    
    // Transform the new prompt format into the format expected by the UI
    const categories: any[] = [];
    if (parsed && parsed.shoppingList) {
      for (const [key, section] of Object.entries(parsed.shoppingList) as any) {
        if (section && Array.isArray(section.items) && section.items.length > 0) {
          categories.push({
            name: key,
            items: section.items.map((it: any) => ({
              name: it.name,
              amount: it.totalAmount + (it.commercialUnit ? ` (${it.commercialUnit})` : '') + (it.essential ? ' ⭐' : '')
            }))
          });
        }
      }
    }

    return { categories };
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

export async function generateFridgeRecipe(base64Image: string, mimeType: string, contextStr: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType } },
          { text: `Basado en los ingredientes de esta imagen y mi contexto actual (${contextStr}), genera una receta paso a paso que se ajuste a mis macros restantes.` },
        ],
      },
      config: {
        systemInstruction: "Actúa como un chef experto en nutrición deportiva. Inventa una receta paso a paso utilizando PRINCIPALMENTE los ingredientes de la foto (puedes asumir básicos como sal, aceite, especias) que se ajuste lo mejor posible a los macros restantes del usuario. Devuelve la receta en formato Markdown, incluyendo el título, ingredientes, pasos y una estimación de los macros de la receta.",
      },
    });
    return response.text || "No se pudo generar la receta.";
  } catch (error) {
    console.error("Error generating fridge recipe:", error);
    throw new Error("No se pudo generar la receta. Inténtalo de nuevo.");
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

export type Restaurant = {
  name: string;
  rating: number;
  address: string;
  description: string;
  specialty: string;
  priceLevel: 1 | 2 | 3 | 4; // 1: $, 2: $$, 3: $$$, 4: $$$$
  distance?: number; // in km
};

export async function findRestaurants(location: string, preferences: string): Promise<Restaurant[]> {
  try {
    const prompt = `Busca los mejores restaurantes en ${location} que cumplan con estas preferencias dietéticas: ${preferences}. 
    Devuelve una lista extensa de al menos 15-20 restaurantes reales con su nombre, puntuación estimada (1-5), dirección, una breve descripción de por qué encaja con el usuario, su especialidad, nivel de precio (1-4) y una estimación de distancia en km desde el centro de la ubicación indicada.
    Devuelve un objeto JSON con la estructura: { restaurants: [{ name: string, rating: number, address: string, description: string, specialty: string, priceLevel: number, distance: number }] }.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "Eres un experto buscador de restaurantes y crítico gastronómico especializado en dietas especiales (vegana, sin gluten, keto, etc.). Tu objetivo es encontrar lugares reales y de alta calidad que se ajusten perfectamente a las necesidades del usuario. Sé muy específico con las direcciones y por qué recomiendas cada lugar. Estima el nivel de precio (1-4) y la distancia aproximada (0.1 a 10.0 km).",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            restaurants: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  rating: { type: Type.NUMBER },
                  address: { type: Type.STRING },
                  description: { type: Type.STRING },
                  specialty: { type: Type.STRING },
                  priceLevel: { type: Type.NUMBER, description: "1: $, 2: $$, 3: $$$, 4: $$$$" },
                  distance: { type: Type.NUMBER, description: "Distancia estimada en km" },
                },
                required: ["name", "rating", "address", "description", "specialty", "priceLevel", "distance"],
              },
            },
          },
          required: ["restaurants"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from model");
    
    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }
    
    const data = JSON.parse(cleanText);
    return data.restaurants;
  } catch (error: any) {
    console.error("Error finding restaurants:", error);
    const errorMessage = error.message || "Error desconocido";
    if (errorMessage.includes("API key not valid")) {
      throw new Error("La clave de API de Gemini no es válida. Por favor, revísala en los secretos.");
    }
    throw new Error(`Error al buscar restaurantes: ${errorMessage}`);
  }
}
