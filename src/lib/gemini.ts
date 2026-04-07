import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
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
};

export async function analyzeFoodImage(base64Image: string, mimeType: string, contextStr?: string): Promise<NutritionalInfo> {
  console.log("analyzeFoodImage starting", { mimeType, contextLen: contextStr?.length });
  
  if (!apiKey) {
    console.error("API Key is missing in analyzeFoodImage");
    throw new Error("La clave de API de Gemini no está configurada. Por favor, añádela en los secretos.");
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
        systemInstruction: "Eres un experto nutricionista deportivo de élite. Tu tarea es analizar imágenes de comida y estimar de forma precisa su contenido nutricional y peso. Evalúa la calidad nutricional asignando un NutriScore de A (excelente densidad de nutrientes) a E (pobre, altamente procesado). Proporciona un análisis de densidad (densityAnalysis) explicando la puntuación. Evalúa si el alimento es saludable (isHealthy) y da un breve análisis (healthAnalysis). Además, debes dar recomendaciones (recommendations) sobre qué comer el resto del día para equilibrar la dieta. Evalúa tu nivel de confianza en la detección (alta, media, baja). Desglosa los ingredientes principales con sus gramos estimados.",
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
            isHealthy: { type: Type.BOOLEAN, description: "¿Es este alimento generalmente considerado saludable?" },
            healthAnalysis: { type: Type.STRING, description: "Breve análisis de por qué es o no saludable y su impacto." },
            recommendations: { type: Type.STRING, description: "Sugerencias de qué comer el resto del día para equilibrar los macros, basado en el contexto." },
            nutriScore: { type: Type.STRING, enum: ["A", "B", "C", "D", "E"], description: "Calificación nutricional de A a E" },
            densityAnalysis: { type: Type.STRING, description: "Explicación detallada de la densidad nutricional y el NutriScore asignado" },
          },
          required: ["foodName", "totalWeight", "calories", "protein", "carbs", "fat", "ingredients", "confidence", "confidenceMessage", "isHealthy", "healthAnalysis", "recommendations", "nutriScore", "densityAnalysis"],
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
  } catch (error) {
    console.error("Detailed error in analyzeFoodImage:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    throw new Error("No se pudo analizar la imagen. Inténtalo de nuevo.");
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
        systemInstruction: "Eres un experto nutricionista deportivo. Tu tarea es estimar de forma precisa el contenido nutricional (calorías y macronutrientes) del alimento descrito en texto. Es CRÍTICO que prestes especial atención al tamaño de las porciones descritas (si es una porción pequeña, ajusta los valores a la baja) y a los métodos de preparación (aceite añadido, salsas, frituras, etc.). Evalúa si es saludable (isHealthy) y da un breve análisis (healthAnalysis). Además, da recomendaciones (recommendations) sobre qué comer el resto del día para equilibrar la dieta, teniendo en cuenta el contexto proporcionado.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            calories: { type: Type.NUMBER, description: "Calorías totales estimadas (kcal)" },
            protein: { type: Type.NUMBER, description: "Proteínas estimadas en gramos" },
            carbs: { type: Type.NUMBER, description: "Carbohidratos estimados en gramos" },
            fat: { type: Type.NUMBER, description: "Grasas estimadas en gramos" },
            isHealthy: { type: Type.BOOLEAN, description: "¿Es este alimento generalmente considerado saludable?" },
            healthAnalysis: { type: Type.STRING, description: "Breve análisis de por qué es o no saludable y su impacto." },
            recommendations: { type: Type.STRING, description: "Sugerencias de qué comer el resto del día para equilibrar los macros, basado en el contexto." },
          },
          required: ["calories", "protein", "carbs", "fat", "isHealthy", "healthAnalysis", "recommendations"],
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
  } catch (error) {
    console.error("Error recalculating macros:", error);
    throw new Error("No se pudo recalcular. Inténtalo de nuevo.");
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
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Genera un menú semanal personalizado basado en este perfil: ${profileStr}. Ten en cuenta estas preferencias y restricciones: ${preferencesStr}. Devuelve un objeto JSON estructurado.`,
      config: {
        systemInstruction: "Eres un experto nutricionista deportivo de élite. Tu tarea es diseñar un menú semanal de calidad premium, extremadamente detallado y profesional. Cada comida (Desayuno, Almuerzo, Cena, Snacks) debe tener una descripción exhaustiva que incluya ingredientes principales y el método de preparación sugerido (ej. 'Pechuga de pollo a la plancha con 150g de arroz integral y brócoli al vapor con un toque de aceite de oliva'). El objetivo es que el usuario sepa exactamente qué comer y cómo prepararlo. Devuelve un objeto JSON con la estructura: { days: [{ day: 'Lunes', meals: [{ type: 'Desayuno', description: '...', calories: 400 }] }], recommendations: '...' }. Asegúrate de incluir de Lunes a Domingo y que las recomendaciones sean consejos nutricionales avanzados basados en el perfil del usuario.",
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
  } catch (error) {
    console.error("Error generating menu:", error);
    throw new Error("No se pudo generar el menú. Inténtalo de nuevo.");
  }
}

export type ShoppingItem = {
  name: string;
  mercadonaProduct: string;
  price: number;
  cheaperAlternative?: string;
  cheaperPrice?: number;
  url?: string;
};

export type ShoppingList = {
  categories: {
    name: string;
    items: ShoppingItem[];
  }[];
};

export async function generateShoppingList(menu: WeeklyMenu): Promise<ShoppingList> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Basado en el siguiente menú semanal, genera una lista de la compra organizada por categorías. Para cada ingrediente, sugiere un producto específico de Mercadona (Hacendado, Bosque Verde, Deliplus, etc. si aplica), su precio estimado en euros, y si existe, una alternativa más barata con su precio estimado. También incluye una URL de búsqueda en Google para el producto (ej. https://www.google.com/search?q=mercadona+nombre_producto). Menú:\n\n${JSON.stringify(menu)}`,
      config: {
        systemInstruction: "Eres un asistente de compras experto en supermercados españoles, especialmente Mercadona. Extrae los ingredientes del menú y agrúpalos por categorías. Para cada ingrediente proporciona el nombre genérico, el nombre del producto en Mercadona, un precio estimado realista, opcionalmente una alternativa más barata con su precio, y una URL de búsqueda en Google para encontrar el producto.",
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
                        mercadonaProduct: { type: Type.STRING },
                        price: { type: Type.NUMBER },
                        cheaperAlternative: { type: Type.STRING },
                        cheaperPrice: { type: Type.NUMBER },
                        url: { type: Type.STRING }
                      },
                      required: ["name", "mercadonaProduct", "price", "url"]
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
  } catch (error) {
    console.error("Error generating shopping list:", error);
    throw new Error("No se pudo generar la lista de la compra.");
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
        systemInstruction: `Eres un entrenador personal y nutricionista experto de élite, actuando como asistente 24/7 en una app.
Contexto del usuario:
${contextStr}

Responde de forma concisa, motivadora y directa a las preguntas o comentarios del usuario.`,
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
        systemInstruction: `Eres un entrenador personal y nutricionista experto de élite, actuando como asistente 24/7 en una app.
Contexto del usuario:
${contextStr}

Responde de forma concisa, motivadora y directa a las preguntas o comentarios del usuario.`,
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
