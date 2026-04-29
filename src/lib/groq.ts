import Groq from 'groq-sdk';

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

export { groq, MODEL, friendlyGroqError };
