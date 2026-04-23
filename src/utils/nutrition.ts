export function calcularBMR(profile: any, currentWeight?: number): number {
  // If weight is not provided, use a default fallback (e.g., 70kg) or try to get it from somewhere else.
  // We prefer the weight passed in the arguments.
  const weight = currentWeight || 70;
  let bmr = 10 * weight + 6.25 * profile.height - 5 * profile.age;
  bmr += profile.gender === 'male' ? 5 : -161;
  return bmr;
}
