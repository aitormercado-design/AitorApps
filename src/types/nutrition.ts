export type NutritionalInfo = {
  foodName: string;
  totalWeight: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients: { name: string; amount: string; grams?: number; calories?: number; protein?: number; carbs?: number; fat?: number }[];
  confidence: "alta" | "media" | "baja";
  confidenceMessage: string;
  alternatives?: string[];
  isHealthy?: boolean;
  healthAnalysis?: string;
  recommendations?: string;
  semaforo?: "verde" | "amarillo" | "rojo";
  semaforoLabel?: string;
  densityAnalysis?: string;
  interpretation?: string;
  coachMessage?: string;
  actionableRecommendation?: string;
};

export interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type WeeklyMenu = any;

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
