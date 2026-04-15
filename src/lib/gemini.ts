import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
if (!apiKey) {
  console.error("CRITICAL: GEMINI_API_KEY is not defined in the environment.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

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
  console.log("analyzeFoodImage starting", { mimeType, contextLen: contextStr?.length });
  
  if (!apiKey) {
    console.error("API Key is missing in analyzeFoodImage");
    throw new Error("La clave de API de Gemini no está configurada. Si no puedes editar GEMINI_API_KEY, añade una nueva variable llamada VITE_GEMINI_API_KEY en los secretos.");
  }

  try {
    const prompt = contextStr 
      ? `Analiza detalladamente esta imagen de comida. Identifica el tamaño de la porción (peso total estimado en gramos), el método de preparación y los ingredientes visibles con sus cantidades estimadas. Estima su valor nutricional con la mayor precisión posible. Evalúa si es saludable y, basándote en este contexto: "${contextStr}", sugiere qué debería comer el resto del día. Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`
      : `Analiza detalladamente esta imagen de comida. Identifica el tamaño de la porción (peso total estimado en gramos), el método de preparación y los ingredientes visibles con sus cantidades estimadas. Estima su valor nutricional con la mayor precisión posible. Evalúa si es saludable y sugiere qué debería comer el resto del día. Calcula un NutriScore (A-E) basado en la densidad nutricional. Devuelve un objeto JSON.`;

    console.log("Sending request to Gemini...");
    
    const requestPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        systemInstruction: "Eres un experto nutricionista deportivo y un coach muy empático, positivo y motivador. Tu tarea es analizar imágenes de comida y estimar de forma precisa su contenido nutricional y peso. Evalúa la calidad nutricional asignando un NutriScore de A a E. Proporciona una interpretación rápida (ej. 'Comida equilibrada', 'Alta en grasas'). Escribe un mensaje de coach muy cercano, comprensivo y motivador (coachMessage) sin tecnicismos, enfocado en animar al usuario y no ser estricto ni condescendiente. Si el nombre del usuario está en el contexto, úsalo para dirigirte a él de forma personal. Da una recomendación accionable inmediata (actionableRecommendation) sobre qué hacer en la próxima comida. Evalúa tu nivel de confianza en la detección. Desglosa los ingredientes principales con sus gramos estimados. Sé consistente con las estimaciones de peso y calorías.",
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
                  amount: { type: Type.STRING, description: "Cantidad estimada (ej: '150g', '1 unidad', '20g')" }
                },
                required: ["name", "amount"]
              },
              description: "Lista de ingredientes principales detectados"
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

    const response = await Promise.race([requestPromise, timeoutPromise]) as any;

    console.log("Response received from Gemini");
    const text = response.text;
    if (!text) {
      console.error("Empty response from Gemini");
      throw new Error("No se recibió respuesta del modelo.");
    }

    console.log("Raw response text:", text);

    // Extract JSON from markdown or raw text
    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }
    
    try {
      const data = JSON.parse(cleanText) as NutritionalInfo;
      console.log("Parsed data:", data);
      return data;
    } catch (e) {
      console.error("Failed to parse JSON:", e, "Clean text:", cleanText);
      throw new Error("Error al procesar la respuesta del servidor.");
    }
  } catch (error: any) {
    console.error("Detailed error in analyzeFoodImage:", error);
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
      model: "gemini-3-flash-preview",
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
                  amount: { type: Type.STRING, description: "Cantidad estimada (ej: '150g', '1 unidad', '20g')" }
                },
                required: ["name", "amount"]
              },
              description: "Lista de ingredientes principales detectados"
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
      model: "gemini-3-flash-preview",
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
    
    // Extract JSON from markdown or raw text
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

export type WeeklyMenu = {
  days: {
    day: string;
    meals: {
      type: "Desayuno" | "Almuerzo" | "Cena" | "Snacks";
      description: string;
      calories?: number;
    }[];
  }[];
  recommendations: string;
};

export async function generateWeeklyMenu(profileStr: string, preferencesStr: string): Promise<WeeklyMenu> {
  if (!apiKey) {
    throw new Error("La clave de API de Gemini no está configurada. Si no puedes editar GEMINI_API_KEY, añade una nueva variable llamada VITE_GEMINI_API_KEY en los secretos.");
  }

  try {
    const requestPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Genera un menú semanal personalizado basado en este perfil: ${profileStr}. Ten en cuenta estas preferencias y restricciones: ${preferencesStr}. Devuelve un objeto JSON estructurado.`,
      config: {
        systemInstruction: "Eres un experto nutricionista deportivo de élite. Tu tarea es diseñar un menú semanal de calidad premium, extremadamente detallado y profesional. Cada comida (Desayuno, Almuerzo, Cena, Snacks) debe tener una descripción exhaustiva que incluya ingredientes principales y el método de preparación sugerido. El objetivo es que el usuario sepa exactamente qué comer y cómo prepararlo. Si el perfil indica que hay una 'comida o cena libre' habilitada, debes incluirla en el día y tipo especificado. En esa ingesta libre, permite un exceso calórico (sin especificar calorías exactas, pero que sea una comida de disfrute) y compensa reduciendo ligeramente las calorías de las otras comidas de ese mismo día y del día anterior/posterior para que el balance semanal sea coherente con el objetivo del usuario. Si el nombre del usuario está en el perfil, úsalo en las recomendaciones para que sean personales. Devuelve un objeto JSON con la estructura: { days: [{ day: 'Lunes', meals: [{ type: 'Desayuno', description: '...', calories: 400 }] }], recommendations: '...' }. Asegúrate de incluir de Lunes a Domingo y que las recomendaciones sean consejos nutricionales avanzados basados en el perfil del usuario.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            days: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
                  meals: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        type: { type: Type.STRING, enum: ["Desayuno", "Almuerzo", "Cena", "Snacks"] },
                        description: { type: Type.STRING },
                        calories: { type: Type.NUMBER }
                      },
                      required: ["type", "description"]
                    }
                  }
                },
                required: ["day", "meals"]
              }
            },
            recommendations: { type: Type.STRING }
          },
          required: ["days", "recommendations"]
        }
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("La generación del menú está tardando demasiado. Por favor, inténtalo de nuevo.")), 60000);
    });

    const response = await Promise.race([requestPromise, timeoutPromise]) as any;
    
    const text = response.text;
    if (!text) throw new Error("No response from model");
    
    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }
    
    return JSON.parse(cleanText);
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

export async function generateShoppingList(menu: WeeklyMenu, supermarket: string = 'Mercadona'): Promise<ShoppingList> {
  if (!apiKey) {
    throw new Error("La clave de API de Gemini no está configurada. Si no puedes editar GEMINI_API_KEY, añade una nueva variable llamada VITE_GEMINI_API_KEY en los secretos.");
  }

  try {
    const requestPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Genera la lista de la compra para este menú semanal. Prioriza productos que se puedan encontrar en ${supermarket} (España).
      
      INSTRUCCIONES PARA CADA INGREDIENTE:
      1. Agrupa la cantidad total semanal necesaria.
      2. CÁLCULO DE UNIDADES: Compara la cantidad que necesitas con tamaños de envase estándar (especialmente los de ${supermarket}). Calcula cuántas unidades necesitas comprar para que CUBRA AL MENOS la cantidad necesaria.
      
      Menú:\n\n${JSON.stringify(menu)}`,
      config: {
        systemInstruction: `Eres un asistente de compras experto en supermercados españoles, especialmente ${supermarket}. Tu objetivo es crear una lista de la compra organizada por categorías.
        
        REGLAS CRÍTICAS:
        1. PRODUCTOS ${supermarket.toUpperCase()}: Intenta sugerir nombres de productos específicos de ${supermarket} o su marca blanca cuando sea posible.
        2. CANTIDADES: Asegúrate de calcular cuántos envases/unidades se necesitan basándote en los formatos habituales de ${supermarket}. En 'amount' indica la cantidad total a comprar (ej: "2 packs (6 uds)", "1 bote 500g").
        3. Procesa TODOS los ingredientes del menú.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  items: { 
                    type: Type.ARRAY, 
                    items: { 
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        amount: { type: Type.STRING }
                      },
                      required: ["name", "amount"]
                    } 
                  }
                },
                required: ["name", "items"]
              }
            }
          },
          required: ["categories"]
        }
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("La generación de la lista de la compra está tardando demasiado.")), 45000);
    });

    const response = await Promise.race([requestPromise, timeoutPromise]) as any;
    
    const text = response.text;
    if (!text) throw new Error("No response from model");

    let cleanText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    } else {
      cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    }

    return JSON.parse(cleanText);
  } catch (error: any) {
    console.error("Error generating shopping list:", error);
    throw new Error(error.message || "No se pudo generar la lista de la compra.");
  }
}

export async function generateWorkoutPlan(profileStr: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Genera una rutina de ejercicio semanal personalizada basada en este perfil: ${profileStr}. Devuelve la respuesta en formato Markdown.`,
      config: {
        systemInstruction: "Eres un experto entrenador personal y especialista en hipertrofia y fitness. Diseña una rutina de entrenamiento semanal detallada, enfocada en la ganancia muscular y adaptada a la edad y nivel del usuario. Incluye días de entrenamiento, ejercicios, series, repeticiones y tiempos de descanso. Usa formato Markdown con tablas o listas claras.",
      }
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
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
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
    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: `Eres el Coach de NutritivApp, un experto en nutrición y entrenamiento muy cercano, motivador y empático. 
Tu objetivo es ayudar al usuario a cumplir sus metas de forma saludable y positiva. 
Si el nombre del usuario aparece en el contexto, úsalo con frecuencia para dirigirte a él de forma personal.
Responde siempre de forma breve, humana y alentadora. No seas demasiado técnico a menos que te pregunten.

Contexto del usuario:
${contextStr}`,
      }
    });
    
    // Send previous history if any (excluding the last message which we'll send via sendMessage)
    // Actually, the easiest way is to just pass the history to the chat creation if supported, or just send the latest message.
    // Let's just send the whole conversation as history, and the last message as the new message.
    const history = messages.slice(0, -1);
    const lastMessage = messages[messages.length - 1].parts[0].text;
    
    const chatWithHistory = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: `Eres un entrenador personal y nutricionista experto, actuando como un coach muy empático, positivo y motivador 24/7 en una app.
Contexto del usuario:
${contextStr}

Responde de forma concisa, muy alentadora y directa a las preguntas o comentarios del usuario, sin ser estricto ni condescendiente.`,
      },
      history: history
    });

    const response = await chatWithHistory.sendMessage({ message: lastMessage });
    return response.text || "Lo siento, no pude procesar eso.";
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
      model: "gemini-flash-latest",
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
                  distance: { type: Type.NUMBER, description: "Distancia estimada en km" }
                },
                required: ["name", "rating", "address", "description", "specialty", "priceLevel", "distance"]
              }
            }
          },
          required: ["restaurants"]
        }
      }
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
