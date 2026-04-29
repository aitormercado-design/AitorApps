// Test script — ejecutar con: VITE_GROQ_API_KEY=gsk_xxx node test-groq.mjs
import Groq from 'groq-sdk';

const apiKey = process.env.VITE_GROQ_API_KEY;
if (!apiKey) {
  console.error('Falta VITE_GROQ_API_KEY');
  process.exit(1);
}

const groq = new Groq({ apiKey });

const systemPrompt = `Eres un experto nutricionista deportivo y coach empático y motivador. Estima con precisión el contenido nutricional del alimento descrito.

Responde ÚNICAMENTE con JSON válido. Sin texto adicional. Sin markdown. El JSON debe seguir exactamente este formato:
{"foodName":"Arroz con pollo","totalWeight":350,"calories":450,"protein":38,"carbs":52,"fat":12,"ingredients":[{"name":"arroz","amount":"150g"},{"name":"pollo","amount":"150g"},{"name":"aceite","amount":"10g"}],"confidence":"alta","confidenceMessage":"Análisis completado","interpretation":"Plato equilibrado","coachMessage":"Buena elección","actionableRecommendation":"Añade verduras","nutriScore":"B"}`;

const completion = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Alimento: "100g de arroz con pollo".' },
  ],
  temperature: 0.7,
  max_tokens: 8192,
  response_format: { type: 'json_object' },
});

const text = completion.choices[0].message.content;
console.log('--- RESPUESTA RAW ---');
console.log(text);
console.log('\n--- PARSED ---');
const parsed = JSON.parse(text);
console.log(JSON.stringify(parsed, null, 2));
console.log('\n✓ foodName:', parsed.foodName);
console.log('✓ calories:', parsed.calories);
console.log('✓ protein:', parsed.protein, '/ carbs:', parsed.carbs, '/ fat:', parsed.fat);
console.log('✓ nutriScore:', parsed.nutriScore);
