import { useEffect, useRef, useCallback, useState } from 'react';
import { generateProactiveMessage, type ProactiveEvent, type CoachContext } from '../lib/groq';

interface UseProactiveCoachProps {
  meals: any[];
  habits: Record<string, any>;
  weights: any[];
  goals: { calories: number; protein: number; carbs: number; fat: number };
  profile: any;
  todayStr: string;
  generatedMenu?: any;
  workoutPlan?: string | null;
  isDataLoaded: boolean;
}

const COOLDOWN_MS = 30_000;

export function useProactiveCoach({
  meals,
  habits,
  weights,
  goals,
  profile,
  todayStr,
  generatedMenu,
  workoutPlan,
  isDataLoaded,
}: UseProactiveCoachProps) {
  const [proactiveMessage, setProactiveMessage] = useState<string | null>(null);
  const lastEventRef = useRef<number>(0);

  // Keep a stable ref to always-current context so triggerMessage has no deps
  const contextRef = useRef<CoachContext>({ meals, habits, weights, goals, profile, generatedMenu, workoutPlan });
  useEffect(() => {
    contextRef.current = { meals, habits, weights, goals, profile, generatedMenu, workoutPlan };
  });

  const triggerMessage = useCallback(async (event: ProactiveEvent) => {
    const now = Date.now();
    if (now - lastEventRef.current < COOLDOWN_MS) return;
    lastEventRef.current = now;
    try {
      const msg = await generateProactiveMessage(event, contextRef.current);
      if (msg) setProactiveMessage(msg);
    } catch {
      // Best-effort; never surface errors to the user
    }
  }, []);

  // Refs to track previous values
  const prevMealsCount = useRef(meals.length);
  const prevWorkoutDone = useRef(habits[todayStr]?.workoutDone);
  const prevWorkoutCalories = useRef(habits[todayStr]?.workoutCalories ?? 0);
  const prevWeightsCount = useRef(weights.length);
  const hasTriggeredDayStart = useRef(false);

  // Event: new meal registered today
  useEffect(() => {
    if (!isDataLoaded) {
      prevMealsCount.current = meals.length;
      return;
    }
    if (meals.length > prevMealsCount.current) {
      const newMeal = meals[0];
      const totalCalories = meals.reduce((s: number, m: any) => s + (m.calories ?? 0), 0);

      if (totalCalories >= goals.calories * 0.9 && totalCalories < goals.calories) {
        triggerMessage({ type: 'goal_90pct', data: { totalCalories, remaining: goals.calories - totalCalories } });
      } else if (totalCalories > goals.calories) {
        triggerMessage({ type: 'goal_exceeded', data: { excess: totalCalories - goals.calories } });
      } else {
        triggerMessage({ type: 'meal_added', data: { meal: newMeal, totalCalories, goals } });
      }
    }
    prevMealsCount.current = meals.length;
  }, [meals.length, isDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event: gym plan day marked done (workoutCalories increases)
  useEffect(() => {
    if (!isDataLoaded) {
      prevWorkoutCalories.current = habits[todayStr]?.workoutCalories ?? 0;
      return;
    }
    const current = habits[todayStr]?.workoutCalories ?? 0;
    if (current > 0 && current > prevWorkoutCalories.current) {
      triggerMessage({
        type: 'workout_done',
        data: {
          calories: current,
          focus: habits[todayStr]?.workoutSessionFocus,
        },
      });
    }
    prevWorkoutCalories.current = current;
  }, [habits[todayStr]?.workoutCalories, isDataLoaded, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event: legacy workoutDone toggle (handleToggleWorkout)
  useEffect(() => {
    if (!isDataLoaded) {
      prevWorkoutDone.current = habits[todayStr]?.workoutDone;
      return;
    }
    const current = habits[todayStr]?.workoutDone;
    if (current && !prevWorkoutDone.current) {
      triggerMessage({
        type: 'workout_done',
        data: {
          calories: habits[todayStr]?.workoutCalories,
          focus: habits[todayStr]?.workoutSessionFocus,
        },
      });
    }
    prevWorkoutDone.current = current;
  }, [habits[todayStr]?.workoutDone, isDataLoaded, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event: new weight entry
  useEffect(() => {
    if (!isDataLoaded) {
      prevWeightsCount.current = weights.length;
      return;
    }
    if (weights.length > prevWeightsCount.current) {
      const latest = weights[weights.length - 1];
      const previous = weights[weights.length - 2];
      triggerMessage({
        type: 'weight_updated',
        data: {
          current: latest.weight,
          previous: previous?.weight,
          diff: previous ? latest.weight - previous.weight : 0,
        },
      });
    }
    prevWeightsCount.current = weights.length;
  }, [weights.length, isDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event: day start — fires once per session after data is loaded, with a short delay
  useEffect(() => {
    if (!isDataLoaded || hasTriggeredDayStart.current) return;
    hasTriggeredDayStart.current = true;
    const timer = setTimeout(() => {
      triggerMessage({
        type: 'day_start',
        data: { todayStr, goalCalories: goals.calories },
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [isDataLoaded, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    proactiveMessage,
    clearMessage: () => setProactiveMessage(null),
  };
}
