export interface ProfileSuggestion {
  field: 'goal' | 'macroDistribution' | 'dietType' | 'gymGoal';
  suggestedValue: string;
  reason: string;
}

interface RelevantProfile {
  gymGoal?: string;
  goal?: string;
  macroDistribution?: string;
  dietType?: string;
  gymEnabled?: boolean;
}

export function getSuggestions(profile: RelevantProfile): ProfileSuggestion[] {
  const suggestions: ProfileSuggestion[] = [];

  if (profile.gymGoal === 'muscle' || profile.gymGoal === 'strength') {
    if (profile.goal !== 'gain') {
      suggestions.push({
        field: 'goal',
        suggestedValue: 'gain',
        reason: 'Para ganar músculo necesitas superávit calórico',
      });
    }
    if (!['high_protein', 'balanced'].includes(profile.macroDistribution ?? '')) {
      suggestions.push({
        field: 'macroDistribution',
        suggestedValue: 'high_protein',
        reason: 'Alta en proteína optimiza la ganancia muscular',
      });
    }
  }

  if (profile.gymGoal === 'fat_loss' || profile.gymGoal === 'cardio') {
    if (profile.goal !== 'lose') {
      suggestions.push({
        field: 'goal',
        suggestedValue: 'lose',
        reason: 'Para perder grasa necesitas déficit calórico',
      });
    }
    if (!['low_carb', 'balanced'].includes(profile.macroDistribution ?? '')) {
      suggestions.push({
        field: 'macroDistribution',
        suggestedValue: 'low_carb',
        reason: 'Baja en carbos favorece la pérdida de grasa',
      });
    }
  }

  if (profile.gymGoal === 'flexibility' || profile.gymGoal === 'maintenance') {
    if (profile.goal !== 'maintain') {
      suggestions.push({
        field: 'goal',
        suggestedValue: 'maintain',
        reason: 'Para mantenimiento el TDEE exacto es lo ideal',
      });
    }
  }

  if (profile.dietType === 'Keto' && profile.macroDistribution !== 'keto') {
    suggestions.push({
      field: 'macroDistribution',
      suggestedValue: 'keto',
      reason: 'La dieta keto requiere distribución alta en grasas',
    });
  }

  if (profile.dietType === 'Alta en Proteína' && profile.macroDistribution !== 'high_protein') {
    suggestions.push({
      field: 'macroDistribution',
      suggestedValue: 'high_protein',
      reason: 'Coherente con tu tipo de dieta',
    });
  }

  if (profile.dietType === 'Baja en Carbohidratos' && profile.macroDistribution !== 'low_carb') {
    suggestions.push({
      field: 'macroDistribution',
      suggestedValue: 'low_carb',
      reason: 'Coherente con tu tipo de dieta',
    });
  }

  if (profile.goal === 'lose' && !['low_carb', 'balanced'].includes(profile.macroDistribution ?? '')) {
    if (!suggestions.some(s => s.field === 'macroDistribution')) {
      suggestions.push({
        field: 'macroDistribution',
        suggestedValue: 'low_carb',
        reason: 'Optimiza la pérdida de grasa',
      });
    }
  }

  if (profile.goal === 'gain' && profile.macroDistribution === 'keto') {
    if (!suggestions.some(s => s.field === 'macroDistribution')) {
      suggestions.push({
        field: 'macroDistribution',
        suggestedValue: 'high_protein',
        reason: 'Keto dificulta ganar músculo',
      });
    }
  }

  return suggestions;
}
