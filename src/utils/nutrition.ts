import type { NutritionTargets } from '../types/nutrition';

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calculateStreak(
  meals: Array<{ timestamp: number }>,
  habits: Record<string, {
    workoutDone?: boolean;
    manualWorkout?: { activity?: string };
    manualWorkouts?: Array<{ activity?: string }>;
  }>
): number {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const date = toDateStr(new Date(Date.now() - i * 86400000));
    const hasMeals = meals.some(m => toDateStr(new Date(m.timestamp)) === date);
    const h = habits[date];
    // workoutDone: gym routine explicitly marked done
    // manualWorkouts (array) or legacy manualWorkout (singular): require a real activity string
    const hasWorkout = h?.workoutDone ||
      (h?.manualWorkouts?.length ?? 0) > 0 ||
      !!h?.manualWorkout?.activity;
    if (hasMeals || hasWorkout) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

export function calcularBMR(profile: any, currentWeight?: number): number {
  const weight = currentWeight || 70;
  let bmr = 10 * weight + 6.25 * profile.height - 5 * profile.age;
  bmr += profile.gender === 'male' ? 5 : -161;
  return bmr;
}

export function calculateDailyCalories(profile: any, currentWeight: number): NutritionTargets {
  const bmr = calcularBMR(profile, currentWeight);

  const activityFactor =
    profile.trainingDaysPerWeek === 0 ? 1.2  :
    profile.trainingDaysPerWeek <= 2  ? 1.375:
    profile.trainingDaysPerWeek <= 4  ? 1.55 :
    profile.trainingDaysPerWeek <= 6  ? 1.725: 1.9;

  const tdee = Math.round(bmr * activityFactor);

  const calories =
    profile.goal === 'lose' ? tdee - 400 :
    profile.goal === 'gain' ? tdee + 300 : tdee;

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
    const meals = day.meals ?? day.m ?? [];
    for (const meal of meals) {
      const ingredientStr = meal.ingredientes ?? meal.i ?? '';
      if (!ingredientStr) continue;
      const items = String(ingredientStr).split(',').map((i: string) => i.trim()).filter(Boolean);
      for (const item of items) {
        ingredients.push({ item });
      }
    }
  }
  return ingredients;
}
