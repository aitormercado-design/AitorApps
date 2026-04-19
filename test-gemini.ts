import { GoogleGenAI } from '@google/genai';
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});
async function run() {
  try {
    const response = await ai.models.generateContent({ model: "gemini-3-flash-preview", contents: "hello" });
    console.log("Success:", response.text);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
