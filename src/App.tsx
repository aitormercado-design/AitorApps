import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Camera, Activity, Flame, Beef, Wheat, Droplet, Droplets, PieChart, X, Loader2, Plus, Minus, Upload, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronUp, Zap, TrendingUp, Target, Dumbbell, Calendar, Utensils, Moon, Sun, ShoppingCart, ClipboardList, CheckSquare, ChefHat, Send, Bot, Pencil, RefreshCw, LogOut, User as UserIcon, Pizza, Save, Edit2, Trash2, Home, Sparkles, Clock, UtensilsCrossed, BarChart2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, ResponsiveContainer, YAxis, ComposedChart, Bar, Line, XAxis, Tooltip } from 'recharts';
import Markdown from 'react-markdown';
import { RulerPicker } from './components/RulerPicker';
import { AppBanner } from './components/AppBanner';
import { useCooldown } from './hooks/useCooldown';
import remarkGfm from 'remark-gfm';
import { analyzeFoodText, streamCompletion, generateWeeklyMenu, generateWorkoutPlan, generateShoppingList, generateWeeklyAnalysis } from './lib/groq';
import type { WeekDaySummary } from './lib/groq';
import { useProactiveCoach } from './hooks/useProactiveCoach';
import { analyzeFoodImage } from './lib/openrouter';
import type { NutritionalInfo, WeeklyMenu, ShoppingList } from './types/nutrition';
import { extractIngredients, calcularBMR, calculateStreak, calculateDailyCalories } from './utils/nutrition';
import { calculateMETCalories, ACTIVITY_OPTIONS } from './utils/metCalculator';
import { getSuggestions, type ProfileSuggestion } from './utils/profileSuggestions';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, deleteDoc, updateDoc, getDocFromServer, onSnapshot, deleteField, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { auth, db } from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type Meal = NutritionalInfo & {
  id: string;
  imageUrl: string;
  timestamp: number;
};

type MedicalConditions = {
  diabetes: boolean;
  highCholesterol: boolean;
  hypertension: boolean;
  hypothyroidism: boolean;
  insulinResistance: boolean;
};

type UserProfile = {
  name: string;
  age: number;
  height: number;
  gender: 'male' | 'female';
  dietType: string;
  allergies: string[];
  otherAllergies: string;
  diabetesType: 'none' | 'type1' | 'type2' | 'prediabetes';
  medicalConditions: MedicalConditions;
  dislikedFoods: string;
  goal: 'lose' | 'maintain' | 'gain';
  macroDistribution: 'balanced' | 'low_carb' | 'high_protein' | 'keto';
  freeMealEnabled: boolean;
  freeMealDay: string;
  freeMealType: 'comida' | 'cena';
  menuEnabled: boolean;
  gymEnabled: boolean;
  gymMode: 'plan' | 'manual' | 'both';
  workoutType: 'gym' | 'home';
  gymGoal: 'muscle' | 'strength' | 'cardio' | 'fat_loss' | 'flexibility' | 'maintenance';
  trainingDaysPerWeek: number;
  theme: 'light' | 'dark';
  weight: number;
};

type ManualWorkoutEntry = {
  id: string;
  activity: string;
  intensidad: 'suave' | 'moderada' | 'intensa';
  durationMinutes: number;
  caloriesBurned: number;
};

type DailyHabits = {
  [date: string]: {
    water: number;
    sleep: number;
    workoutDone?: boolean;
    workoutSessions?: number;
    completedExercises?: string[];
    manualWorkouts?: ManualWorkoutEntry[];
    manualWorkout?: ManualWorkoutEntry; // legacy — kept for backward compat read
    workoutCalories?: number;
    workoutSessionFocus?: string;
  };
};

function getManualWorkoutKcal(dayData: DailyHabits[string] | undefined): number {
  if (!dayData) return 0;
  if (dayData.manualWorkouts?.length) {
    return dayData.manualWorkouts.reduce((sum, w) => sum + (w.caloriesBurned ?? 0), 0);
  }
  if (dayData.manualWorkout) {
    return (dayData.manualWorkout as any).caloriesBurned ?? (dayData.manualWorkout as any).calories ?? 0;
  }
  return 0;
}

function getActivityFactor(gymDaysPerWeek: number): number {
  if (gymDaysPerWeek === 0) return 1.2;
  if (gymDaysPerWeek <= 2) return 1.375;
  if (gymDaysPerWeek <= 4) return 1.55;
  if (gymDaysPerWeek <= 6) return 1.725;
  return 1.9;
}

function getLocalDateStr(date: Date = new Date()): string {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
}

// Fitness expert calculation for calories burned per block
const calculateExpertCalories = (weight: number | null | undefined, goal: string | undefined, blockType: 'warm' | 'main' | 'cool'): number => {
  const w = weight || 70; // fallback to 70kg
  const factor = w / 70; // relative to 70kg person
  
  if (blockType === 'warm') {
    // Warmup: ~10 min mobility/light cardio (approx 5 kcal/min for 70kg)
    return Math.round(50 * factor);
  }
  if (blockType === 'cool') {
    // Cooldown: ~10 min static stretching/walking (approx 3.5 kcal/min for 70kg)
    return Math.round(35 * factor);
  }
  // Main block depends on goal
  let mins = 50; 
  let kcalPerMin = 6; 
  if (goal === 'cardio' || goal === 'fat_loss') {
    kcalPerMin = 8.5; // High intensity continuous
    mins = 45;
  } else if (goal === 'strength' || goal === 'muscle') {
    kcalPerMin = 5; // Heavy lifting, longer rests
    mins = 60;
  }
  return Math.round(kcalPerMin * mins * factor);
};

// Detect iOS / Safari: all browsers on iOS use WebKit and block popups from async handlers.
// Safari on macOS also has this restriction.
const isIOSorSafari = (): boolean => {
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua) && !/FxiOS/.test(ua);
  return isIOS || isSafari;
};

const DEFAULT_GOALS = {
  calories: 2500,
  protein: 180,
  carbs: 250,
  fat: 86,
};

const DEFAULT_PROFILE: UserProfile = {
  name: '',
  age: 0,
  height: 0,
  gender: 'male',
  dietType: 'Normal',
  allergies: [],
  otherAllergies: '',
  diabetesType: 'none',
  medicalConditions: { diabetes: false, highCholesterol: false, hypertension: false, hypothyroidism: false, insulinResistance: false },
  dislikedFoods: '',
  goal: 'maintain',
  macroDistribution: 'balanced',
  freeMealEnabled: false,
  freeMealDay: 'Sábado',
  freeMealType: 'cena',
  menuEnabled: false,
  gymEnabled: false,
  gymMode: 'plan' as const,
  workoutType: 'gym',
  gymGoal: 'muscle',
  trainingDaysPerWeek: 3,
  theme: 'light',
  weight: 0,
};

const SemaforoBadge = ({ semaforo, label }: { semaforo?: "verde" | "amarillo" | "rojo"; label?: string }) => {
  if (!semaforo) return null;
  const styles = {
    verde:    { dot: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]",  text: "text-emerald-500" },
    amarillo: { dot: "bg-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.5)]",   text: "text-yellow-400" },
    rojo:     { dot: "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]",      text: "text-red-500" },
  };
  const { dot, text } = styles[semaforo];
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
      {label && <span className={`text-[10px] font-bold uppercase tracking-wider ${text}`}>{label}</span>}
    </div>
  );
};

const ConfidenceBadge = ({ confidence, message }: { confidence?: "alta" | "media" | "baja"; message?: string }) => {
  if (!confidence) return null;
  const cfg = {
    alta:  { icon: "●●●", color: "text-emerald-500", label: "Análisis preciso" },
    media: { icon: "●●○", color: "text-yellow-400",  label: "Estimación aproximada" },
    baja:  { icon: "●○○", color: "text-red-400",     label: "Poca certeza" },
  };
  const { icon, color, label } = cfg[confidence];
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-mono font-bold tracking-widest ${color}`}>{icon}</span>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{message || label}</span>
    </div>
  );
};

const NumberInput = ({ value, onChange, label, step = 1, min = 0, max = 300, placeholder, theme }: any) => {
  const unitMatch = label.match(/\(([^)]+)\)/);
  const unit = unitMatch ? unitMatch[1] : '';
  const cleanLabel = label.replace(/\s*\([^)]+\)/, '');

  return (
    <div className={`space-y-2 p-3 rounded-xl border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-zinc-950 border-zinc-800'}`}>
      <div className="flex justify-between items-center">
        <label className={`block text-xs font-bold uppercase tracking-widest ${theme === 'light' ? 'text-slate-500' : 'text-zinc-500'}`}>{cleanLabel}</label>
        <div className="flex items-baseline gap-1">
          <input 
            type="number" 
            step={step}
            min={min}
            max={max}
            value={value === 0 ? '' : value}
            onChange={(e) => onChange(e.target.value)}
            className={`bg-transparent text-right text-lg font-display font-bold ${theme === 'light' ? 'text-emerald-500' : 'text-lime-400'} focus:outline-none w-16`}
            placeholder={placeholder}
          />
          {unit && <span className={`text-xs font-medium ${theme === 'light' ? 'text-slate-400' : 'text-zinc-600'}`}>{unit}</span>}
        </div>
      </div>
    </div>
  );
};

const translateGymGoal = (goal: string) => {
  const map: Record<string, string> = {
    muscle: 'Ganar Músculo',
    strength: 'Fuerza',
    cardio: 'Resistencia',
    fat_loss: 'Perder Grasa',
    flexibility: 'Flexibilidad',
    maintenance: 'Mantenimiento'
  };
  return map[goal] || goal;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  // Auth Form State
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const [meals, setMeals] = useState<Meal[]>([]);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    age: 0,
    height: 0,
    gender: 'male',
    dietType: 'Normal',
    allergies: [],
    otherAllergies: '',
    diabetesType: 'none',
    medicalConditions: { diabetes: false, highCholesterol: false, hypertension: false, hypothyroidism: false, insulinResistance: false },
    dislikedFoods: '',
    goal: 'maintain',
    macroDistribution: 'balanced',

    freeMealEnabled: false,
    freeMealDay: 'Sábado',
    freeMealType: 'cena',
    menuEnabled: false,
    gymEnabled: false,
    gymMode: 'plan' as const,
    workoutType: 'gym',
    gymGoal: 'muscle',
    trainingDaysPerWeek: 3,
    theme: 'light',
    weight: 0,
  });
  const [habits, setHabits] = useState<DailyHabits>({});
  const [workoutPlan, setWorkoutPlan] = useState<string | null>(null);
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState(false);
  const [workoutProgressMsg, setWorkoutProgressMsg] = useState('');

  type AppSection = 'hoy' | 'menu' | 'gym' | 'semana' | 'perfil';
  const [activeSection, setActiveSection] = useState<AppSection>('hoy');
  // Tracks when a new nav section was first unlocked (timestamp), per user — shown as pulsing badge for 24h
  const [sectionUnlockedAt, setSectionUnlockedAt] = useState<Record<string, number>>({});
  const [mealsSubTab, setMealsSubTab] = useState<'daily' | 'plan' | 'shopping'>('daily');
  const getTodayDayIndex = () => (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6
  const [menuSelectedDay, setMenuSelectedDay] = useState<number>(getTodayDayIndex);
  const [expandedMeal, setExpandedMeal] = useState<number>(0);
  const [evolutionPeriod, setEvolutionPeriod] = useState<'today' | 'weekly' | 'monthly' | 'quarterly' | 'semiannually' | 'annually'>('today');
  const [gymSubTab, setGymSubTab] = useState<'manual' | 'plan'>('plan');
  const [planSubTab, setPlanSubTab] = useState<'info' | 'ejercicios' | 'tips'>('ejercicios');
  const [macrosExpanded, setMacrosExpanded] = useState(true);
  const [expandedExSection, setExpandedExSection] = useState<string | null>('Parte Principal');
  const [gymInfoExpanded, setGymInfoExpanded] = useState(false);
  const [gymTipsExpanded, setGymTipsExpanded] = useState(false);
  const [miDiaExpanded, setMiDiaExpanded] = useState(() => {
    const saved = localStorage.getItem('kilokalo_mi_dia_expanded');
    return saved !== null ? saved === 'true' : true;
  });
  const [registrosExpanded, setRegistrosExpanded] = useState(true);
  const registrosInitialized = useRef(false);
  const [manualWorkoutActivity, setManualWorkoutActivity] = useState<string>('Correr');
  const [manualWorkoutIntensidad, setManualWorkoutIntensidad] = useState<'suave'|'moderada'|'intensa'>('moderada');
  const [manualWorkoutMinutes, setManualWorkoutMinutes] = useState('45');
  const [manualWorkoutCaloriesOverride, setManualWorkoutCaloriesOverride] = useState<string>('');
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [manualFormExpanded, setManualFormExpanded] = useState(true);
  const [manualListExpanded, setManualListExpanded] = useState(true);
  const manualFormInitialized = useRef(false);
  const [todayStr, setTodayStr] = useState(() => getLocalDateStr());
  const [manualWorkoutDate, setManualWorkoutDate] = useState(todayStr);
  const [gymDay, setGymDay] = useState<string>('Día 1');
  const [gymRoutineDates, setGymRoutineDates] = useState<{[key: string]: string}>({});
  const [gymDayDone, setGymDayDone] = useState<{[dayLabel: string]: boolean}>({});

  useEffect(() => {
    if (profile.theme === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    }
  }, [profile.theme]);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = getLocalDateStr();
      if (current !== todayStr) {
        setTodayStr(current);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [todayStr]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeSection]);

  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [profileWizardStep, setProfileWizardStep] = useState<1 | 2 | 3>(1);
  const [isWizardMode, setIsWizardMode] = useState(false);
  const [wizardMenuPicked, setWizardMenuPicked] = useState<boolean | null>(null);
  const [wizardGymPicked, setWizardGymPicked] = useState<boolean | null>(null);
  const [profileTab, setProfileTab] = useState<'user' | 'diet' | 'exercise'>('user');
  const [profileModalTab, setProfileModalTab] = useState<'datos' | 'dieta' | 'entrenamiento'>('datos');
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [dismissedPrompts, setDismissedPrompts] = useState<string[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('notificationsEnabled') === 'true');
  const [notificationPermAsked, setNotificationPermAsked] = useState(() => localStorage.getItem('notificationPermAsked') === 'true');
  const [optionalBannerRemindAfter, setOptionalBannerRemindAfter] = useState<number>(0);
  const [dietGymBannerRemindAfter, setDietGymBannerRemindAfter] = useState<number>(0);

  const [appliedSuggestionKey, setAppliedSuggestionKey] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState<UserProfile>({
    name: '',
    age: 0,
    height: 0,
    gender: 'male',
    dietType: 'Normal',
    allergies: [],
    otherAllergies: '',
    diabetesType: 'none',
    medicalConditions: { diabetes: false, highCholesterol: false, hypertension: false, hypothyroidism: false, insulinResistance: false },
    dislikedFoods: '',
    goal: 'maintain',
    macroDistribution: 'balanced',

    freeMealEnabled: false,
    freeMealDay: 'Sábado',
    freeMealType: 'cena',
    menuEnabled: false,
    gymEnabled: false,
    gymMode: 'plan' as const,
    workoutType: 'gym',
    gymGoal: 'muscle',
    trainingDaysPerWeek: 3,
    theme: 'light',
    weight: 0,
  });
  const [editWeight, setEditWeight] = useState('');

  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [portionMultiplier, setPortionMultiplier] = useState(1);
  const [ingredientGrams, setIngredientGrams] = useState<number[]>([]);
  const baseIngredientGramsRef = React.useRef<number[]>([]);
  const [mealEditMode, setMealEditMode] = useState<'create' | 'edit'>('create');
  const [originalAnalyzedName, setOriginalAnalyzedName] = useState<string | null>(null);
  const [isRecalculatingMacros, setIsRecalculatingMacros] = useState(false);
  const [macrosJustUpdated, setMacrosJustUpdated] = useState(false);
  const [macrosManuallyEdited, setMacrosManuallyEdited] = useState(false);
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Pre-populate wizard picks when modal opens: null for new users, from profile for returning users
  useEffect(() => {
    if (isGoalModalOpen) {
      if (profile.name) {
        setIsWizardMode(false);
        setWizardMenuPicked(profile.menuEnabled ? true : false);
        setWizardGymPicked(profile.gymEnabled ? true : false);
        // profileModalTab is set by the caller (openProfile), don't reset here
      } else {
        setIsWizardMode(true);
        setWizardMenuPicked(null);
        setWizardGymPicked(null);
        setProfileModalTab('datos');
      }
    }
  }, [isGoalModalOpen]);

  // Auto-open profile modal the first time a user logs in (no name saved yet)
  const hasAutoOpenedProfileRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded || !user || profile.name || hasAutoOpenedProfileRef.current) return;
    hasAutoOpenedProfileRef.current = true;
    setEditProfile({ ...profile, allergies: [], dislikedFoods: '' });
    setEditWeight('');
    setProfileTab('user');
    setProfileWizardStep(1);
    setIsWizardMode(true);
    setIsGoalModalOpen(true);
  }, [isDataLoaded, user, profile.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const menuCooldown          = useCooldown(60);
  const workoutCooldown       = useCooldown(60);
  const shoppingCooldown      = useCooldown(30);
  const textFoodCooldown      = useCooldown(8);
  const imageFoodCooldown     = useCooldown(8);
  const weeklyAnalysisCooldown = useCooldown(60);
  const mealsListenerRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuTabsRef = useRef<HTMLDivElement>(null);

  const [generatedMenu, setGeneratedMenu] = useState<WeeklyMenu | null>(null);
  const [isGeneratingMenu, setIsGeneratingMenu] = useState(false);
  const [progressMsgIdx, setProgressMsgIdx] = useState(0);
  const [shoppingList, setShoppingList] = useState<ShoppingList | null>(null);
  const [isGeneratingShoppingList, setIsGeneratingShoppingList] = useState(false);
  const [appError, setAppError] = useState<{ message: string; timestamp: number } | null>(null);
  const [appSuccess, setAppSuccess] = useState<string | null>(null);
  const [expandedWeekDay, setExpandedWeekDay] = useState<string | null>(null);
  const [weeklyAnalysis, setWeeklyAnalysis] = useState<string>('');
  const [weeklyAnalysisLoading, setWeeklyAnalysisLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [menuNeedsRegeneration, setMenuNeedsRegeneration] = useState<boolean>(
    () => localStorage.getItem('menuNeedsRegen') === 'true'
  );
  const [workoutNeedsRegeneration, setWorkoutNeedsRegeneration] = useState<boolean>(
    () => localStorage.getItem('workoutNeedsRegen') === 'true'
  );
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const showError = (message: string) => setAppError({ message, timestamp: Date.now() });
  const showSuccess = (message: string) => { setAppSuccess(message); setTimeout(() => setAppSuccess(null), 3000); };

  const activeSuggestionsForField = (field: ProfileSuggestion['field']) =>
    getSuggestions(editProfile).filter(
      s => s.field === field && !dismissedSuggestions.includes(`${s.field}:${s.suggestedValue}`)
    );

  const applySuggestion = (s: ProfileSuggestion) => {
    const key = `${s.field}:${s.suggestedValue}`;
    setEditProfile(prev => ({ ...prev, [s.field]: s.suggestedValue }));
    setAppliedSuggestionKey(key);
    setTimeout(() => setAppliedSuggestionKey(prev => prev === key ? null : prev), 1500);
  };

  const dismissSuggestion = (s: ProfileSuggestion) => {
    setDismissedSuggestions(prev => [...prev, `${s.field}:${s.suggestedValue}`]);
  };

  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});


  // Handle Google sign-in redirect result (iOS/Safari flow)
  useEffect(() => {
    getRedirectResult(auth).catch((error: any) => {
      if (error?.code && error.code !== 'auth/no-current-user' && error.code !== 'auth/null-user') {
        setAuthError("Error al iniciar sesión con Google.");
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('unavailable'))) {
          console.error("Please check your Firebase configuration. The client is offline or the database is unavailable.");
          showError("Error de conexión con la base de datos. Por favor, recarga la página o comprueba tu conexión a internet.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setIsDataLoaded(false); // block save effects during any auth transition
      setUser(currentUser);

      // Reset all user-specific state before loading the new user's data.
      // Without this, fields missing from Firestore keep the previous user's values,
      // and the persistence effects would then write that stale data into the new user's document.
      hasAutoOpenedProfileRef.current = false; // allow wizard to re-open for new first-time users
      setMeals([]);
      setGoals(DEFAULT_GOALS);
      setProfile({ ...DEFAULT_PROFILE });
      setGeneratedMenu(null);
      setShoppingList(null);
      setWorkoutPlan(null);
      setCheckedItems({});
      setHabits({});
      setMenuNeedsRegeneration(false);
      setWorkoutNeedsRegeneration(false);
      setDismissedPrompts([]);
      setDietGymBannerRemindAfter(0);

      if (currentUser) {
        // Load user-specific banner dismiss state from localStorage
        const uid = currentUser.uid;
        try {
          const dismissed = JSON.parse(localStorage.getItem(`kilokalo_dismissed_prompts_${uid}`) ?? '[]');
          setDismissedPrompts(dismissed);
        } catch {}
        const dietRemind = localStorage.getItem(`kilokalo_diet_gym_banner_remind_${uid}`);
        setDietGymBannerRemindAfter(dietRemind ? parseInt(dietRemind) : 0);
        try {
          const badges = JSON.parse(localStorage.getItem(`kilokalo_section_badges_${uid}`) ?? '{}');
          setSectionUnlockedAt(badges);
        } catch { setSectionUnlockedAt({}); }

        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.profile) {
              const _diabetesType = data.profile.diabetesType || 'none';
              const loadedProfile = {
                ...data.profile,
                name: data.profile.name || '',
                allergies: Array.isArray(data.profile.allergies) ? data.profile.allergies : [],
                otherAllergies: data.profile.otherAllergies || '',
                diabetesType: _diabetesType,
                medicalConditions: data.profile.medicalConditions || {
                  diabetes: _diabetesType !== 'none',
                  highCholesterol: false,
                  hypertension: false,
                  hypothyroidism: false,
                  insulinResistance: false,
                },
                dislikedFoods: data.profile.dislikedFoods || '',
                freeMealEnabled: data.profile.freeMealEnabled || false,
                freeMealDay: data.profile.freeMealDay || 'Sábado',
                freeMealType: data.profile.freeMealType || 'cena',
                menuEnabled: data.profile.menuEnabled ?? false,
                gymEnabled: data.profile.gymEnabled || false,
                gymMode: data.profile.gymMode || 'plan',
                gymGoal: data.profile.gymGoal || 'muscle',
                trainingDaysPerWeek: data.profile.trainingDaysPerWeek || 3
              };
              setProfile(loadedProfile);
              // One-time migration: delete legacy favoriteSupermarket field
              if (data.profile.favoriteSupermarket !== undefined) {
                updateDoc(doc(db, 'users', currentUser.uid), { 'profile.favoriteSupermarket': deleteField() }).catch(console.error);
              }
            }
            if (data.goals) setGoals(data.goals);
            if (data.generatedMenu) setGeneratedMenu(data.generatedMenu);
            if (data.shoppingList) setShoppingList(data.shoppingList);
            if (data.workoutPlan) setWorkoutPlan(data.workoutPlan);
            if (data.checkedItems) setCheckedItems(data.checkedItems);
            if (data.gymRoutineDates) setGymRoutineDates(data.gymRoutineDates);
            if (data.gymDayDone) setGymDayDone(data.gymDayDone);
            
            // Load subcollections — meals via real-time listener ordered server-side
            if (mealsListenerRef.current) mealsListenerRef.current();
            const mealsQ = query(
              collection(db, 'users', currentUser.uid, 'meals'),
              orderBy('timestamp', 'desc')
            );
            mealsListenerRef.current = onSnapshot(
              mealsQ,
              (snap) => {
                const loadedMeals = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Meal[];
                setMeals(loadedMeals);
              },
              (err) => handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}/meals`)
            );

            try {
              const habitsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'habits'));
              const loadedHabits: DailyHabits = {};
              habitsSnap.forEach(doc => { loadedHabits[doc.id] = doc.data() as any; });
              setHabits(loadedHabits);
            } catch (err) {
              handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}/habits`);
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        // Load from localStorage if not logged in
        try {
          const savedProfile = localStorage.getItem('nutritivapp_profile');
          const savedGoals = localStorage.getItem('nutritivapp_goals');
          const savedHabits = localStorage.getItem('nutritivapp_habits');
          const savedMenu = localStorage.getItem('nutritivapp_generated_menu');
          const savedShoppingList = localStorage.getItem('nutritivapp_shopping_list');
          const savedMeals = localStorage.getItem('nutritivapp_meals');
          const savedChecked = localStorage.getItem('nutritivapp_checked_items');

          if (savedProfile) {
            const parsed = JSON.parse(savedProfile);
            const _parsedDiabetesType = parsed.diabetesType || 'none';
            setProfile({
              ...parsed,
              name: parsed.name || '',
              allergies: Array.isArray(parsed.allergies) ? parsed.allergies : [],
              otherAllergies: parsed.otherAllergies || '',
              diabetesType: _parsedDiabetesType,
              medicalConditions: parsed.medicalConditions || {
                diabetes: _parsedDiabetesType !== 'none',
                highCholesterol: false,
                hypertension: false,
                hypothyroidism: false,
                insulinResistance: false,
              },
              dislikedFoods: parsed.dislikedFoods || '',
              freeMealEnabled: parsed.freeMealEnabled || false,
              freeMealDay: parsed.freeMealDay || 'Sábado',
              freeMealType: parsed.freeMealType || 'cena',
              gymEnabled: parsed.gymEnabled || parsed.fitnessEnabled || false,
              gymMode: parsed.gymMode || 'plan',
              gymGoal: parsed.gymGoal || parsed.fitnessGoal || 'maintenance',
              trainingDaysPerWeek: parsed.trainingDaysPerWeek || 3,
              theme: parsed.theme || 'dark'
            });
          }
          if (savedGoals) setGoals(JSON.parse(savedGoals));
          if (savedHabits) setHabits(JSON.parse(savedHabits));
          if (savedMenu) setGeneratedMenu(JSON.parse(savedMenu));
          if (savedShoppingList) setShoppingList(JSON.parse(savedShoppingList));
          if (localStorage.getItem('nutritivapp_workout_plan')) setWorkoutPlan(localStorage.getItem('nutritivapp_workout_plan'));
          if (savedMeals) setMeals(JSON.parse(savedMeals));
          if (savedChecked) setCheckedItems(JSON.parse(savedChecked));
        } catch (e) {
          console.error("Error loading from localStorage:", e);
        }
      }
      setIsDataLoaded(true);
      setIsAuthReady(true);
    });
    return () => {
      unsubscribe();
      if (mealsListenerRef.current) mealsListenerRef.current();
    };
  }, []);

  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_meals', JSON.stringify(meals));
    }
  }, [meals, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_goals', JSON.stringify(goals));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { goals }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [goals, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_profile', JSON.stringify(profile));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { profile }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [profile, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_habits', JSON.stringify(habits));
    }
  }, [habits, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded && generatedMenu) {
      localStorage.setItem('nutritivapp_generated_menu', JSON.stringify(generatedMenu));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { generatedMenu }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [generatedMenu, user, isDataLoaded]);

  const PROGRESS_MSGS = [
    '> Calculando macros óptimos...',
    '> Diseñando desayunos y almuerzos...',
    '> Ajustando días de gimnasio...',
    '> Equilibrando proteínas y carbohidratos...',
    '> Revisando alergias y restricciones...',
    '> Optimizando el menú completo...',
  ];
  useEffect(() => {
    if (!isGeneratingMenu) return;
    const id = setInterval(() => {
      setProgressMsgIdx(i => (i + 1) % PROGRESS_MSGS.length);
    }, 5000);
    return () => clearInterval(id);
  }, [isGeneratingMenu]);

  useEffect(() => {
    if (isDataLoaded) {
      if (shoppingList) {
        localStorage.setItem('nutritivapp_shopping_list', JSON.stringify(shoppingList));
        if (user) {
          setDoc(doc(db, 'users', user.uid), { shoppingList }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
        }
      } else {
        localStorage.removeItem('nutritivapp_shopping_list');
        if (user) {
          // Setting the field to null or deleting the field using updateDoc and deleteField
          setDoc(doc(db, 'users', user.uid), { shoppingList: null }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
        }
      }
    }
  }, [shoppingList, user, isDataLoaded]);


  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_checked_items', JSON.stringify(checkedItems));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { checkedItems }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [checkedItems, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded && workoutPlan) {
      localStorage.setItem('nutritivapp_workout_plan', workoutPlan);
      if (user) {
        setDoc(doc(db, 'users', user.uid), { workoutPlan }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [workoutPlan, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded && user && Object.keys(gymRoutineDates).length > 0) {
      setDoc(doc(db, 'users', user.uid), { gymRoutineDates }, { merge: true }).catch(console.error);
    }
  }, [gymRoutineDates, user, isDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDataLoaded && user) {
      setDoc(doc(db, 'users', user.uid), { gymDayDone }, { merge: true }).catch(console.error);
    }
  }, [gymDayDone, user, isDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // When Firestore data finishes loading, always recalculate goals from the current user's
  // profile. This prevents stale or missing Firestore goals (e.g. DEFAULT_GOALS = 2500) from
  // showing a different value than what the profile actually dictates.
  useEffect(() => {
    if (!isDataLoaded || profile.age === 0 || profile.height === 0) return;
    const latestWeight = profile.weight > 0 ? profile.weight : 70;
    updateGoalsForProfile(profile, latestWeight);
  }, [isDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist regen flags to localStorage
  useEffect(() => {
    if (menuNeedsRegeneration) localStorage.setItem('menuNeedsRegen', 'true');
    else localStorage.removeItem('menuNeedsRegen');
  }, [menuNeedsRegeneration]);

  useEffect(() => {
    if (workoutNeedsRegeneration) localStorage.setItem('workoutNeedsRegen', 'true');
    else localStorage.removeItem('workoutNeedsRegen');
  }, [workoutNeedsRegeneration]);

  // Badge: record when gym/menu sections first unlock so we can show a pulsing dot for 24h
  useEffect(() => {
    if (!isDataLoaded || !user) return;
    const now = Date.now();
    let changed = false;
    const next = { ...sectionUnlockedAt };
    if (profile.gymEnabled && !next['gym']) { next['gym'] = now; changed = true; }
    if (profile.menuEnabled && !next['menu']) { next['menu'] = now; changed = true; }
    if (changed) {
      setSectionUnlockedAt(next);
      localStorage.setItem(`kilokalo_section_badges_${user.uid}`, JSON.stringify(next));
    }
  }, [profile.gymEnabled, profile.menuEnabled, isDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect to 'hoy' if current section is no longer available
  useEffect(() => {
    if (activeSection === 'gym' && !profile.gymEnabled) setActiveSection('hoy');
    if (activeSection === 'menu' && !profile.menuEnabled) setActiveSection('hoy');
  }, [profile.gymEnabled, profile.goal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss error toast: 10s for rate-limit, 6s for everything else
  useEffect(() => {
    if (!appError) return;
    const delay = appError.message.includes('Límite de consultas') ? 10000 : 6000;
    const timer = setTimeout(() => setAppError(null), delay);
    return () => clearTimeout(timer);
  }, [appError]);

  // Clear stale errors when PWA returns to foreground
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && appError && Date.now() - appError.timestamp > 30000) {
        setAppError(null);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [appError]);

  // Scheduled notifications: 9h, 14h, 21h — fires while app is open
  useEffect(() => {
    if (!notificationsEnabled || !isDataLoaded || !('Notification' in window) || Notification.permission !== 'granted') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = new Date();

    const showNotif = async (body: string) => {
      const opts: NotificationOptions = { body, icon: '/favicon.png' };
      // iOS Safari (16.4+ PWA) requires showNotification via SW; desktop/Android accept both
      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          reg.showNotification('KiloKalo', opts);
          return;
        } catch {
          // fall through to Notification constructor
        }
      }
      new Notification('KiloKalo', opts);
    };

    const schedule = (hour: number, buildMsg: () => { body: string } | null) => {
      const target = new Date(now);
      target.setHours(hour, 0, 0, 0);
      const ms = target.getTime() - now.getTime();
      if (ms < 0) return; // already past today
      timers.push(setTimeout(() => {
        const notif = buildMsg();
        if (notif) showNotif(notif.body);
      }, ms));
    };

    const mealsCount = todaysMeals.length;
    const consumed = Math.round(todaysMeals.reduce((s, m) => s + m.calories, 0));
    const remaining = Math.max(0, Math.round(goals.calories) - consumed);

    schedule(9, () => mealsCount === 0 ? { body: 'Buenos días — recuerda registrar el desayuno para empezar bien el día' } : null);
    schedule(14, () => mealsCount < 2 ? { body: '¿Ya registraste el almuerzo?' } : null);
    schedule(21, () => ({
      body: remaining > 0
        ? `Llevas ${consumed} kcal hoy. Te quedan ${remaining} kcal`
        : `Llevas ${consumed} kcal hoy. Objetivo cumplido 🎯`,
    }));

    return () => timers.forEach(clearTimeout);
  }, [notificationsEnabled, isDataLoaded, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps


  // When generatedMenu loads or changes, set the active tab to today's day
  useEffect(() => {
    if (!generatedMenu?.days?.length) return;
    const todayNorm = new Date()
      .toLocaleDateString('es-ES', { weekday: 'long' })
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const idx = generatedMenu.days.findIndex((d: any) =>
      (d.day || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(todayNorm.slice(0, 3))
    );
    setMenuSelectedDay(idx >= 0 ? idx : Math.min(getTodayDayIndex(), generatedMenu.days.length - 1));
  }, [generatedMenu]);


  // Calculate today's totals
  const todaysMeals = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return meals.filter(m => m.timestamp >= todayStart.getTime());
  }, [meals, todayStr]);

  // Snap menu selected day to today's weekday when menu loads
  useEffect(() => {
    if (!generatedMenu?.days?.length) return;
    const todayName = new Date().toLocaleDateString('es-ES', { weekday: 'long' }).toLowerCase();
    const idx = generatedMenu.days.findIndex((d: any) => d.day?.toLowerCase() === todayName);
    if (idx >= 0) setMenuSelectedDay(idx);
  }, [generatedMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse registros on first load if no meals yet today
  useEffect(() => {
    if (isDataLoaded && !registrosInitialized.current) {
      registrosInitialized.current = true;
      setRegistrosExpanded(todaysMeals.length > 0);
    }
  }, [isDataLoaded, todaysMeals.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse manual form on first data load if workouts already exist
  useEffect(() => {
    if (isDataLoaded && !manualFormInitialized.current) {
      manualFormInitialized.current = true;
      const todayData = habits[todayStr];
      const existingWorkouts: ManualWorkoutEntry[] = todayData?.manualWorkouts?.length
        ? todayData.manualWorkouts
        : todayData?.manualWorkout ? [todayData.manualWorkout as ManualWorkoutEntry] : [];
      if (existingWorkouts.length > 0) setManualFormExpanded(false);
    }
  }, [isDataLoaded, habits, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set expandedMeal to next meal by current hour when day changes or menu loads
  useEffect(() => {
    const h = new Date().getHours();
    const nextMealIdx =
      h < 10 ? 0 : // desayuno
      h < 14 ? 1 : // almuerzo
      h < 18 ? 2 : // merienda
      3;           // cena
    setExpandedMeal(nextMealIdx);
  }, [menuSelectedDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise per-ingredient grams when a different meal is opened
  useEffect(() => {
    if (editingMeal?.ingredients?.length) {
      const base = editingMeal.ingredients.map(ing => ing.grams ?? parseInt(ing.amount) ?? 0);
      baseIngredientGramsRef.current = base;
      setIngredientGrams(base.map(g => Math.round(g * portionMultiplier)));
    } else {
      baseIngredientGramsRef.current = [];
      setIngredientGrams([]);
    }
  }, [editingMeal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When portion multiplier changes, scale all ingredients from their base
  useEffect(() => {
    if (baseIngredientGramsRef.current.length > 0) {
      setIngredientGrams(baseIngredientGramsRef.current.map(g => Math.round(g * portionMultiplier)));
    }
  }, [portionMultiplier]);

  const totals = todaysMeals.reduce(
    (acc, meal) => ({
      calories: acc.calories + (Number(meal.calories) || 0),
      protein:  acc.protein  + (Number(meal.protein)  || 0),
      carbs:    acc.carbs    + (Number(meal.carbs)    || 0),
      fat:      acc.fat      + (Number(meal.fat)      || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  // Compute macros live from per-ingredient grams (when model provided per-ingredient data)
  const ingredientComputedMacros = useMemo(() => {
    if (!editingMeal?.ingredients?.length || !ingredientGrams.length) return null;
    const hasData = editingMeal.ingredients.some(ing => (ing.calories ?? 0) > 0);
    if (!hasData) return null;
    return editingMeal.ingredients.reduce((acc, ing, i) => {
      const base = ing.grams ?? 0;
      const ratio = base > 0 ? (ingredientGrams[i] ?? 0) / base : 0;
      return {
        calories: acc.calories + (Number(ing.calories) || 0) * ratio,
        protein:  acc.protein  + (Number(ing.protein)  || 0) * ratio,
        carbs:    acc.carbs    + (Number(ing.carbs)     || 0) * ratio,
        fat:      acc.fat      + (Number(ing.fat)       || 0) * ratio,
      };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }, [editingMeal, ingredientGrams]);

  const getAssistantState = () => {
    const todayHabits = habits[todayStr] || { water: 0, sleep: 0 };
    const latestWeight = profile.weight > 0 ? profile.weight : 70;
    
    // Estimate burned calories from workout per section
    let burnedCalories = 0;
    const completed = (todayHabits.completedExercises || []).filter(e => e && e.trim() !== "");
    
    if (todayHabits.workoutDone) {
      burnedCalories += todayHabits.workoutCalories ??
        calculateExpertCalories(latestWeight, profile.gymGoal, 'warm') +
        calculateExpertCalories(latestWeight, profile.gymGoal, 'main') +
        calculateExpertCalories(latestWeight, profile.gymGoal, 'cool');
    } else if (workoutPlan && completed.length > 0) {
      const getSectionOfTable = (tableId: string) => {
        if (!tableId.includes('-')) return null;
        const parts = tableId.split('-');
        const offset = parseInt(parts[1]) || 0;
        const textBefore = workoutPlan.substring(0, offset).toLowerCase();
        const warmPos = textBefore.lastIndexOf('calentamiento');
        const mainPos = Math.max(textBefore.lastIndexOf('ejercicios'), textBefore.lastIndexOf('rutina'), textBefore.lastIndexOf('fuerza'));
        const coolPos = textBefore.lastIndexOf('vuelta a la calma');
        if (coolPos > mainPos && coolPos > warmPos) return 'cool';
        if (mainPos > warmPos) return 'main';
        if (warmPos !== -1) return 'warm';
        return null;
      };
      const sectionsDone = new Set(completed.map(id => getSectionOfTable(id)).filter(Boolean));
      if (sectionsDone.has('main')) burnedCalories += calculateExpertCalories(latestWeight, profile.gymGoal, 'main');
      if (sectionsDone.has('warm')) burnedCalories += calculateExpertCalories(latestWeight, profile.gymGoal, 'warm');
      if (sectionsDone.has('cool')) burnedCalories += calculateExpertCalories(latestWeight, profile.gymGoal, 'cool');
    }
    if (profile.gymEnabled) {
      burnedCalories += getManualWorkoutKcal(todayHabits);
    }

    const consumedCalories = totals.calories;
    const totalTarget = goals.calories + burnedCalories;
    const remainingCalories = totalTarget - consumedCalories;
    const stateType: 'over' | 'good' = remainingCalories < -100 ? 'over' : 'good';

    return {
      stateType,
      remainingCalories,
      burnedCalories,
      totalTarget,
      consumedCalories,
    };
  };

  const assistant = getAssistantState();

  const streak = useMemo(() => calculateStreak(meals, habits), [meals, habits]);

  // Monday summary data — compute previous week stats (only on Mondays)
  const mondayData = useMemo(() => {
    if (!isDataLoaded || new Date().getDay() !== 1) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
    let daysOnTarget = 0;
    let workouts = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(thisMonday);
      day.setDate(thisMonday.getDate() - 7 + i);
      const dateStr = getLocalDateStr(day);
      const dayMeals = meals.filter(m => getLocalDateStr(new Date(m.timestamp)) === dateStr);
      const cal = dayMeals.reduce((s, m) => s + m.calories, 0);
      const pct = goals.calories > 0 ? cal / goals.calories : 0;
      if (cal > 0 && pct >= 0.85 && pct <= 1.1) daysOnTarget++;
      if (habits[dateStr]?.workoutDone) workouts++;
    }
    return { daysOnTarget, workouts };
  }, [isDataLoaded, meals, habits, goals.calories]); // eslint-disable-line react-hooks/exhaustive-deps

  const { proactiveMessage, clearMessage } = useProactiveCoach({
    meals: todaysMeals,
    habits,
    weights: [],
    goals: { ...goals, calories: assistant.totalTarget },
    profile,
    todayStr,
    generatedMenu: generatedMenu ?? undefined,
    workoutPlan,
    isDataLoaded,
    streak,
    mondayData,
  });

  useEffect(() => {
    if (!proactiveMessage) return;
    const timer = setTimeout(clearMessage, 8000);
    return () => clearTimeout(timer);
  }, [proactiveMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const themeStyles = useMemo(() => {
    const isLight = profile.theme === 'light';
    return {
      mainBg: isLight ? 'bg-white' : 'bg-black',
      headerBg: isLight ? 'bg-white/95' : 'bg-black/90',
      card: isLight ? 'bg-white border-slate-100 shadow-xl shadow-slate-100/50 opacity-100' : 'bg-zinc-950/40 backdrop-blur-md border-white/5 shadow-2xl',
      glass: isLight ? 'bg-white backdrop-blur-2xl border-white/20 shadow-2xl shadow-slate-100/50' : 'bg-zinc-950/80 backdrop-blur-xl border-white/5 shadow-2xl',
      bento: isLight ? 'bg-white border-slate-100 shadow-xl shadow-slate-100/50 p-5 rounded-2xl' : 'bg-[#050505] border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] p-5 rounded-2xl',
      input: isLight ? 'bg-slate-50 border-slate-300 text-zinc-950 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-emerald-500/20' : 'bg-black border-white/10 text-white placeholder:text-zinc-600 focus:border-lime-400 focus:ring-lime-400/20 shadow-inner',
      textMain: isLight ? 'text-zinc-950' : 'text-white',
      textMuted: isLight ? 'text-slate-500' : 'text-zinc-400',
      accent: isLight ? 'text-emerald-600' : 'text-lime-400',
      accentBg: isLight ? 'bg-emerald-500' : 'bg-lime-400',
      accentBorder: isLight ? 'border-emerald-200' : 'border-lime-400/20',
      accentMuted: isLight ? 'bg-emerald-50' : 'bg-lime-400/10',
      iconBg: isLight ? 'bg-slate-50' : 'bg-[#0a0a0a]',
      border: isLight ? 'border-slate-200' : 'border-white/10',
      buttonPrimary: isLight ? 'bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white shadow-lg shadow-emerald-500/20 transition-transform' : 'bg-lime-400 hover:bg-lime-500 active:scale-95 text-black shadow-[0_0_20px_rgba(163,230,53,0.3)] transition-transform',
      buttonSecondary: isLight ? 'bg-white border-slate-200 text-zinc-900 hover:bg-slate-50' : 'bg-black border-white/20 text-zinc-200 hover:bg-white/5 hover:border-white/30',
      macroProtein: isLight ? 'text-blue-600' : 'text-blue-400',
      macroCarbs: isLight ? 'text-amber-600' : 'text-amber-400',
      macroFat: isLight ? 'text-rose-600' : 'text-rose-400',
      macroProteinBg: isLight ? 'bg-blue-500' : 'bg-blue-400',
      macroCarbsBg: isLight ? 'bg-amber-500' : 'bg-amber-400',
      macroFatBg: isLight ? 'bg-rose-500' : 'bg-rose-400',
      tabActiveText: isLight ? 'text-white' : 'text-zinc-950',
      tabActiveShadow: '[box-shadow:var(--shadow-tab)]',
    };
  }, [profile.theme]);

  // Profile completeness (0–100) — based on saved profile

  // Time-of-day context — recomputed on each render (cheap)
  const currentHour = new Date().getHours();
  const mealTimeHint =
    currentHour < 6 ? '¿Último registro del día?' :
    currentHour < 10 ? '¿Qué desayunaste hoy?' :
    currentHour < 12 ? '¿Algo a media mañana?' :
    currentHour < 15 ? 'Hora del almuerzo — ¿qué comiste?' :
    currentHour < 18 ? '¿Merienda o post-entreno?' :
    currentHour < 21 ? 'Registra la cena cuando estés listo' :
    '¿Último registro del día?';

  const gymTimeHint =
    currentHour < 10 ? 'Entreno matutino — el mejor momento para activarse.' :
    currentHour < 12 ? 'Buena hora para entrenar.' :
    currentHour < 15 ? 'Entreno al mediodía — recuerda hidratarte bien.' :
    currentHour < 18 ? 'Hora pico de rendimiento — aprovéchala.' :
    currentHour < 21 ? 'Entreno vespertino — termina antes de las 21h para dormir bien.' :
    'Tarde para entreno intenso — mejor movilidad o estiramientos.';

  const menuTimeHint =
    currentHour < 6 ? 'Planifica tu desayuno de hoy' :
    currentHour < 10 ? 'Planifica tu desayuno de hoy' :
    currentHour < 12 ? '¿Sigues el menú de esta mañana?' :
    currentHour < 14 ? 'Hora del almuerzo — aquí tienes tu menú' :
    currentHour < 17 ? 'Merienda según tu plan' :
    currentHour < 21 ? 'Revisa la cena de hoy' :
    'Mañana empieza con buen pie';

  const dismissPrompt = (id: string) => {
    const updated = [...dismissedPrompts, id];
    setDismissedPrompts(updated);
    if (user?.uid) {
      localStorage.setItem(`kilokalo_dismissed_prompts_${user.uid}`, JSON.stringify(updated));
    }
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window) || Notification.permission === 'denied') return;
    localStorage.setItem('notificationPermAsked', 'true');
    setNotificationPermAsked(true);
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setNotificationsEnabled(true);
      localStorage.setItem('notificationsEnabled', 'true');
    }
  };

  const disableNotifications = () => {
    setNotificationsEnabled(false);
    localStorage.removeItem('notificationsEnabled');
  };

  // Calculate weekly totals
  const weeklyStats = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const end = d.getTime() + 86400000;
    const start = end - (7 * 86400000);
    
    const weekMeals = meals.filter(m => m.timestamp >= start && m.timestamp < end);
    
    // Sum meals
    const totals = weekMeals.reduce(
      (acc, meal) => ({
        calories: acc.calories + (Number(meal.calories) || 0),
        protein:  acc.protein  + (Number(meal.protein)  || 0),
        carbs:    acc.carbs    + (Number(meal.carbs)    || 0),
        fat:      acc.fat      + (Number(meal.fat)      || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    // Sum burned calories from gym
    let burnedCalories = 0;
    if (profile.gymEnabled) {
      for (let i = 0; i < 7; i++) {
        const day = new Date(start + i * 86400000);
        const dayStr = getLocalDateStr(day);
        const dayHabits = habits[dayStr];
        const completed = (dayHabits?.completedExercises || []).filter(Boolean);
        const latestWeight = profile.weight > 0 ? profile.weight : 70;

        if (dayHabits?.workoutDone) {
          burnedCalories += dayHabits.workoutCalories ??
            calculateExpertCalories(latestWeight, profile.gymGoal, 'warm') +
            calculateExpertCalories(latestWeight, profile.gymGoal, 'main') +
            calculateExpertCalories(latestWeight, profile.gymGoal, 'cool');
        } else if (workoutPlan && completed.length > 0) {
          const getSectionOfTable = (tableId: string) => {
            if (!tableId.includes('-')) return null;
            const parts = tableId.split('-');
            const offset = parts.length >= 2 ? (parseInt(parts[1]) || 0) : 0;
            const textBefore = workoutPlan.substring(0, offset).toLowerCase();
            const warmPos = textBefore.lastIndexOf('calentamiento');
            const mainPos = Math.max(textBefore.lastIndexOf('ejercicios'), textBefore.lastIndexOf('rutina'), textBefore.lastIndexOf('fuerza'));
            const coolPos = textBefore.lastIndexOf('vuelta a la calma');
            if (coolPos > mainPos && coolPos > warmPos) return 'cool';
            if (mainPos > warmPos) return 'main';
            if (warmPos !== -1) return 'warm';
            return null;
          };
          const sectionsDone = new Set(completed.map(id => getSectionOfTable(id)).filter(Boolean));
          if (sectionsDone.has('main')) burnedCalories += calculateExpertCalories(latestWeight, profile.gymGoal, 'main');
          if (sectionsDone.has('warm')) burnedCalories += calculateExpertCalories(latestWeight, profile.gymGoal, 'warm');
          if (sectionsDone.has('cool')) burnedCalories += calculateExpertCalories(latestWeight, profile.gymGoal, 'cool');
        }
        burnedCalories += getManualWorkoutKcal(dayHabits);
      }
    }

    return { ...totals, burnedCalories };
  }, [meals, habits, workoutPlan, profile.gymEnabled]);

  const weeklyGoals = useMemo(() => {
    const gymDays = Math.min(7, Math.max(0, profile.trainingDaysPerWeek));
    const latestWeight = profile.weight > 0 ? profile.weight : 70;
    const bmrValue = calcularBMR(profile, latestWeight);
    const sedentaryTDEE = bmrValue * 1.2;
    const activeTDEE = bmrValue * getActivityFactor(gymDays);
    const weeklyImpliedBurned = Math.round(activeTDEE - sedentaryTDEE);
    
    const weeklyDelta = profile.gymEnabled ? (weeklyStats.burnedCalories - weeklyImpliedBurned) : 0;
    
    return {
      calories: (goals.calories * 7) + weeklyDelta,
      protein: goals.protein * 7,
      carbs: goals.carbs * 7,
      fat: goals.fat * 7,
    };
  }, [goals, weeklyStats, profile]);

  // Build per-day data for the semaphore weekly view
  const weekDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay(); // 0=Sunday
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset + weekOffset * 7);

    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const plannedDateSet = new Set(Object.values(gymRoutineDates));

    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dateStr = getLocalDateStr(day);
      const isFuture = day > today;
      const isToday = dateStr === todayStr;

      const dayMeals = meals.filter(m => getLocalDateStr(new Date(m.timestamp)) === dateStr);
      const caloriesConsumed = dayMeals.reduce((sum, m) => sum + m.calories, 0);
      const caloriesGoal = goals.calories;
      const caloriesPct = caloriesGoal > 0 ? caloriesConsumed / caloriesGoal : 0;

      const dayHabits = habits[dateStr];
      const hadWorkoutPlanned = profile.gymEnabled && plannedDateSet.has(dateStr);
      const workoutDone = dayHabits?.workoutDone ?? false;
      const workoutCalories =
        dayHabits?.workoutCalories ??
        getManualWorkoutKcal(dayHabits);

      let status: 'green' | 'yellow' | 'red' | 'future' | 'empty';
      if (isFuture) {
        status = 'future';
      } else if (caloriesConsumed === 0 && !workoutDone) {
        status = 'empty';
      } else if (caloriesPct < 0.7 || caloriesPct > 1.3) {
        status = 'red';
      } else if (
        (caloriesPct >= 0.7 && caloriesPct < 0.85) ||
        (caloriesPct > 1.1 && caloriesPct <= 1.3) ||
        (hadWorkoutPlanned && !workoutDone)
      ) {
        status = 'yellow';
      } else {
        status = 'green';
      }

      return {
        date: dateStr,
        dayName: dayNames[i],
        dayShort: dayNames[i].substring(0, 3).toUpperCase(),
        isToday,
        isFuture,
        caloriesConsumed,
        caloriesGoal,
        caloriesPct,
        hadWorkoutPlanned,
        workoutDone,
        workoutCalories,
        status,
        dayMeals,
      };
    });
  }, [meals, habits, goals.calories, gymRoutineDates, profile.gymEnabled, todayStr, weekOffset]);

  // Calculate trends based on period
  const trendsData = useMemo(() => {
    const periodDays = {
      'today': 1,
      'weekly': 7,
      'monthly': 30,
      'quarterly': 90,
      'semiannually': 180,
      'annually': 365
    };
    const length = periodDays[evolutionPeriod];

    const gymDays = Math.min(7, Math.max(0, profile.trainingDaysPerWeek));
    const latestWeightForBMR = profile.weight > 0 ? profile.weight : 70;
    const bmrValue = calcularBMR(profile, latestWeightForBMR);
    const sedentaryTDEE = bmrValue * 1.2;
    const activeTDEE = bmrValue * getActivityFactor(gymDays);
    const dailyImplied = Math.round((activeTDEE - sedentaryTDEE) / 7);

    return Array.from({ length }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (length - 1 - i));
      d.setHours(0, 0, 0, 0);
      const dayStr = getLocalDateStr(d);
      const start = d.getTime();
      const end = start + 86400000;
      
      const dayMeals = meals.filter(m => m.timestamp >= start && m.timestamp < end);
      const dayCals = dayMeals.reduce((sum, m) => sum + m.calories, 0);

      const currentWeight = profile.weight > 0 ? profile.weight : 70;

      // Calculate burned for this specific day with independent sections
      let dayBurned = 0;
      if (profile.gymEnabled) {
        const dayHabits = habits[dayStr];
        const completed = (dayHabits?.completedExercises || []).filter(Boolean);
        if (dayHabits?.workoutDone) {
          dayBurned += dayHabits.workoutCalories ??
            calculateExpertCalories(currentWeight, profile.gymGoal, 'warm') +
            calculateExpertCalories(currentWeight, profile.gymGoal, 'main') +
            calculateExpertCalories(currentWeight, profile.gymGoal, 'cool');
        } else if (workoutPlan && completed.length > 0) {
          const getSectionOfTable = (tableId: string) => {
            if (!tableId.includes('-')) return null;
            const parts = tableId.split('-');
            const offset = parseInt(parts[1]) || 0;
            const textBefore = workoutPlan.substring(0, offset).toLowerCase();
            const warmPos = textBefore.lastIndexOf('calentamiento');
            const mainPos = Math.max(textBefore.lastIndexOf('ejercicios'), textBefore.lastIndexOf('rutina'), textBefore.lastIndexOf('fuerza'));
            const coolPos = textBefore.lastIndexOf('vuelta a la calma');
            if (coolPos > mainPos && coolPos > warmPos) return 'cool';
            if (mainPos > warmPos) return 'main';
            if (warmPos !== -1) return 'warm';
            return null;
          };
          const sectionsDone = new Set(completed.map(id => getSectionOfTable(id)).filter(Boolean) as string[]);
          if (sectionsDone.has('main')) dayBurned += calculateExpertCalories(currentWeight, profile.gymGoal, 'main');
          if (sectionsDone.has('warm')) dayBurned += calculateExpertCalories(currentWeight, profile.gymGoal, 'warm');
          if (sectionsDone.has('cool')) dayBurned += calculateExpertCalories(currentWeight, profile.gymGoal, 'cool');
        }
        dayBurned += getManualWorkoutKcal(dayHabits);
      }
      
      const formatLabel = () => {
        if (evolutionPeriod === 'weekly') return d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
        if (evolutionPeriod === 'monthly') return d.getDate().toString();
        if (evolutionPeriod === 'quarterly' || evolutionPeriod === 'semiannually') {
          if (d.getDate() % 5 === 0) return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'narrow' });
          return '';
        }
        if (evolutionPeriod === 'annually') {
          if (d.getDate() === 1) return d.toLocaleDateString('es-ES', { month: 'short' });
          return '';
        }
        return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'numeric' });
      }

      const dayDelta = profile.gymEnabled ? (dayBurned - dailyImplied) : 0;

      return {
        name: formatLabel(),
        calories: dayCals,
        burned: dayBurned,
        goal: goals.calories + dayDelta
      };
    });
  }, [meals, goals, habits, profile, workoutPlan, evolutionPeriod]);

  const compressImage = (file: File, maxWidth = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("Image compression timed out")), 15000);
      
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          clearTimeout(timeoutId);
          try {
            const canvas = document.createElement('canvas');
            const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = (error) => {
          clearTimeout(timeoutId);
          reject(new Error("Error loading image for compression"));
        };
      };
      reader.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(new Error("Error reading file"));
      };
    });
  };

  const handleTextFoodSubmit = async (text: string) => {
    if (!text.trim()) return;
    
    setIsCapturing(true);
    setIsAnalyzing(true);
    setAppError(null);

    try {
      const remainingCalories = goals.calories - totals.calories;
      const remainingProtein = goals.protein - totals.protein;
      const remainingCarbs = goals.carbs - totals.carbs;
      const remainingFat = goals.fat - totals.fat;
      const contextStr = `Usuario: ${profile.name || 'Usuario'}. Faltan aprox: ${Math.round(remainingCalories)} kcal, ${Math.round(remainingProtein)}g proteína, ${Math.round(remainingCarbs)}g carbohidratos, ${Math.round(remainingFat)}g grasas para cumplir el objetivo del día. Dieta: ${profile.dietType}.`;

      const info = await analyzeFoodText(text, contextStr, profile.medicalConditions, profile.goal);
      
      const newMeal: Meal = {
        id: Date.now().toString(),
        ...info,
        imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(info.foodName)}&background=27272a&color=a3e635&size=200`,
        timestamp: Date.now(),
      };

      setMealEditMode('create');
      setPortionMultiplier(1);
      setOriginalAnalyzedName(newMeal.foodName);
      setMacrosManuallyEdited(false);
      setMacrosJustUpdated(false);
      setEditingMeal(newMeal);
    } catch (error) {
      console.error("Error in handleTextFoodSubmit:", error);
      showError(error instanceof Error ? error.message : "Error al analizar el texto");
    } finally {
      setIsAnalyzing(false);
      setIsCapturing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCapturing(true);
    setIsAnalyzing(true);
    setAppError(null);

    try {
      const base64String = await compressImage(file, 640);
      setPreviewImage(base64String);

      const match = base64String.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (!match) throw new Error("Formato de imagen inválido");

      const mimeType = match[1];
      const base64Data = match[2];

      const remainingCalories = goals.calories - totals.calories;
      const remainingProtein = goals.protein - totals.protein;
      const remainingCarbs = goals.carbs - totals.carbs;
      const remainingFat = goals.fat - totals.fat;
      const contextStr = `Usuario: ${profile.name || 'Usuario'}. Faltan aprox: ${Math.round(remainingCalories)} kcal, ${Math.round(remainingProtein)}g proteína, ${Math.round(remainingCarbs)}g carbohidratos, ${Math.round(remainingFat)}g grasas para cumplir el objetivo del día. Dieta: ${profile.dietType}.`;

      const info = await analyzeFoodImage(base64Data, mimeType, contextStr, profile.medicalConditions, profile.goal);

      const newMeal: Meal = {
        id: Date.now().toString(),
        ...info,
        imageUrl: base64String,
        timestamp: Date.now(),
      };

      setMealEditMode('create');
      setPortionMultiplier(1);
      setOriginalAnalyzedName(newMeal.foodName);
      setMacrosManuallyEdited(false);
      setMacrosJustUpdated(false);
      setEditingMeal(newMeal);
    } catch (error) {
      console.error("Error in handleFileChange:", error);
      showError(error instanceof Error ? error.message : "Error al analizar la imagen");
    } finally {
      setIsAnalyzing(false);
      setIsCapturing(false);
      setPreviewImage(null);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRecalculateMacros = async (name: string, meal: Meal) => {
    if (isRecalculatingMacros || !name.trim()) return;
    setIsRecalculatingMacros(true);
    try {
      const remainingCalories = goals.calories - totals.calories;
      const remainingProtein = goals.protein - totals.protein;
      const contextStr = `Usuario: ${profile.name || 'Usuario'}. Faltan aprox: ${Math.round(remainingCalories)} kcal, ${Math.round(remainingProtein)}g proteína. Dieta: ${profile.dietType}.`;
      const info = await analyzeFoodText(name.trim(), contextStr, profile.medicalConditions, profile.goal as 'lose' | 'maintain' | 'gain');
      setEditingMeal({
        ...meal,
        foodName: name,
        calories: info.calories,
        protein: info.protein,
        carbs: info.carbs,
        fat: info.fat,
        totalWeight: info.totalWeight,
        ingredients: info.ingredients,
        interpretation: info.interpretation,
        coachMessage: info.coachMessage,
        semaforo: info.semaforo,
        semaforoLabel: info.semaforoLabel,
        confidence: info.confidence,
        confidenceMessage: info.confidenceMessage,
      });
      // Reset ingredient gram controls to the new analysis
      const newBase = info.ingredients.map(ing => ing.grams ?? 0);
      baseIngredientGramsRef.current = newBase;
      setPortionMultiplier(1);
      setIngredientGrams(newBase);
      setMacrosJustUpdated(true);
      setTimeout(() => setMacrosJustUpdated(false), 2500);
    } catch {
      // Silent fail — keep existing values
    } finally {
      setIsRecalculatingMacros(false);
    }
  };

  const handleFoodNameChange = (e: React.ChangeEvent<HTMLInputElement>, meal: Meal) => {
    const newName = e.target.value;
    setEditingMeal({ ...meal, foodName: newName });
    if (macrosManuallyEdited) return;
    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
    const trimmed = newName.trim();
    if (trimmed.length > 2 && trimmed !== originalAnalyzedName?.trim()) {
      recalcTimerRef.current = setTimeout(() => {
        setEditingMeal(prev => {
          if (prev) handleRecalculateMacros(prev.foodName, prev);
          return prev;
        });
      }, 2000);
    }
  };

  const downloadShoppingListHTML = () => {
    if (!shoppingList) return;

    const isDark = profile.theme !== 'light';
    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lista de la Compra - KiloKalo</title>
    <style>
        :root {
          --accent: ${isDark ? '#a3e635' : '#16a34a'};
          --bg: ${isDark ? '#09090b' : '#f8fafc'};
          --surface: ${isDark ? '#18181b' : '#ffffff'};
          --border: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'};
          --text: ${isDark ? '#ffffff' : '#0f172a'};
          --muted: ${isDark ? '#71717a' : '#64748b'};
          --checkbox-bg: ${isDark ? '#18181b' : '#f1f5f9'};
          --checkbox-border: ${isDark ? '#3f3f46' : '#cbd5e1'};
        }
        body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        h1 { font-size: 24px; font-weight: 900; letter-spacing: -1px; margin-bottom: 5px; }
        .subtitle { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }

        .category { margin-bottom: 25px; }
        .category-title { color: var(--muted); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .category-title::before { content: ''; width: 4px; height: 4px; background: var(--accent); border-radius: 50%; }
        .item { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s; }
        .checkbox { width: 20px; height: 20px; border: 1px solid var(--checkbox-border); border-radius: 6px; background: var(--checkbox-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .item.checked { opacity: 0.5; }
        .item.checked .checkbox { background: var(--accent); border-color: var(--accent); }
        .item.checked .checkbox::after { content: '✓'; color: ${isDark ? '#09090b' : '#fff'}; font-size: 12px; font-weight: bold; }
        .item.checked .name { text-decoration: line-through; color: var(--muted); }
        .name { font-size: 14px; font-weight: 500; flex: 1; }
        .amount { color: var(--accent); font-size: 10px; font-weight: 800; text-transform: uppercase; }
    </style>
</head>
<body>
    <div class="container">
        <h1>KiloKalo</h1>
        <div class="subtitle">Lista de la Compra Interactiva</div>
        ${shoppingList.categories.map(cat => `
            <div class="category">
                <div class="category-title">${cat.name}</div>
                ${cat.items.map(item => `
                    <div class="item" onclick="this.classList.toggle('checked')">
                        <div class="checkbox"></div>
                        <div class="name">${item.name}</div>
                        <div class="amount">${item.amount}</div>
                    </div>
                `).join('')}
            </div>
        `).join('')}
    </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lista-compra-kilokalo.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const removeMeal = (id: string) => {
    setMeals((prev) => prev.filter((m) => m.id !== id));
    if (user) {
      deleteDoc(doc(db, 'users', user.uid, 'meals', id)).catch(err => console.error(err));
    }
  };

  const openMealForEdit = (meal: Meal) => {
    setMealEditMode('edit');
    setPortionMultiplier(1);
    setOriginalAnalyzedName(meal.foodName);
    setMacrosManuallyEdited(false);
    setMacrosJustUpdated(false);
    setEditingMeal(meal);
  };

  const updateGoalsForProfile = (prof: UserProfile, currentWeight: number) => {
    // Use same base formula as groq.ts so summary and menu targets agree
    const base = calculateDailyCalories(prof, currentWeight);
    let { calories, protein, carbs, fat } = base;

    // Apply macroDistribution overrides when not using default split
    if (prof.macroDistribution && prof.macroDistribution !== 'balanced') {
      let proteinRatio = 0.3, carbsRatio = 0.4, fatRatio = 0.3;
      switch (prof.macroDistribution) {
        case 'low_carb': proteinRatio = 0.4; carbsRatio = 0.2; fatRatio = 0.4; break;
        case 'high_protein': proteinRatio = 0.4; carbsRatio = 0.3; fatRatio = 0.3; break;
        case 'keto': proteinRatio = 0.25; carbsRatio = 0.05; fatRatio = 0.7; break;
      }
      protein = Math.round((calories * proteinRatio) / 4);
      carbs = Math.round((calories * carbsRatio) / 4);
      fat = Math.round((calories * fatRatio) / 9);
    }

    // Apply same diabetes carb cap as groq.ts (~50g × 3 meals = 150g/day)
    const hasDiabetes = prof.medicalConditions?.diabetes || (prof.diabetesType && prof.diabetesType !== 'none');
    if (hasDiabetes && carbs > 150) {
      const excessKcal = (carbs - 150) * 4;
      carbs = 150;
      fat = Math.round(fat + excessKcal / 9);
    }

    const newGoals = { calories, protein, carbs, fat };
    setGoals(newGoals);
    return newGoals;
  };

  const handleGenerateMenu = async (customProfile?: UserProfile, customGoals?: typeof goals, customWeight?: number) => {
    const raw = customProfile || profile;
    // Fill in defaults so the AI prompt always has valid values
    const activeProfile: UserProfile = {
      ...raw,
      age: raw.age || 30,
      height: raw.height || 170,
      gender: raw.gender || 'male',
      dietType: raw.dietType || 'Normal',
      macroDistribution: raw.macroDistribution || 'balanced',
    };
    if (!activeProfile.name) { showError('Añade tu nombre en el perfil antes de generar el menú.'); return; }
    if (isAIGenerating) { showError('Ya hay una generación en curso. Espera a que termine.'); return; }
    setIsAIGenerating(true);
    setIsGeneratingMenu(true);
    setProgressMsgIdx(0);
    setGeneratedMenu(null);
    setShoppingList(null);
    setAppError(null);
    setMenuSelectedDay(getTodayDayIndex());
    setExpandedMeal(0);
    if (menuTabsRef.current) menuTabsRef.current.scrollLeft = 0;
    try {
      const currentWeight = customWeight || (profile.weight > 0 ? profile.weight : 70);
      const menu = await generateWeeklyMenu(activeProfile, currentWeight);
      setGeneratedMenu(menu);
      setMenuNeedsRegeneration(false);
      setSectionUnlockedAt(prev => {
        const next = { ...prev, menu: 0 };
        if (user?.uid) localStorage.setItem(`kilokalo_section_badges_${user.uid}`, JSON.stringify(next));
        return next;
      });
    } catch (error: any) {
      showError(error.message || 'Error al generar el plan. Inténtalo de nuevo.');
    } finally {
      setIsGeneratingMenu(false);
      setIsAIGenerating(false);
    }
  };

  const handleWeeklyAnalysis = async () => {
    if (weeklyAnalysisCooldown.isActive || weeklyAnalysisLoading) return;
    if (isAIGenerating) { showError('Ya hay una generación en curso. Espera a que termine.'); return; }
    setIsAIGenerating(true);
    setWeeklyAnalysisLoading(true);
    setWeeklyAnalysis('');
    try {
      const summaries: WeekDaySummary[] = weekDays.map(d => ({
        date: d.date,
        dayName: d.dayName,
        status: d.status,
        caloriesConsumed: d.caloriesConsumed,
        caloriesGoal: d.caloriesGoal,
        workoutDone: d.workoutDone,
        hadWorkoutPlanned: d.hadWorkoutPlanned,
        workoutCalories: d.workoutCalories,
      }));
      const result = await generateWeeklyAnalysis(
        profile.name,
        summaries,
        goals.calories,
        profile.trainingDaysPerWeek
      );
      setWeeklyAnalysis(result);
      weeklyAnalysisCooldown.start();
    } catch (e: any) {
      setWeeklyAnalysis(e.message || 'Error al generar el análisis.');
    } finally {
      setWeeklyAnalysisLoading(false);
      setIsAIGenerating(false);
    }
  };

  const toggleCheckedItem = (itemName: string) => {
    setCheckedItems(prev => ({
      ...prev,
      [itemName]: !prev[itemName]
    }));
  };

  const handleGenerateShoppingList = async () => {
    if (!generatedMenu) return;
    if (isAIGenerating) { showError('Ya hay una generación en curso. Espera a que termine.'); return; }
    setIsAIGenerating(true);
    setIsGeneratingShoppingList(true);
    setShoppingList(null);
    setAppError(null);
    try {
      const ingredients = extractIngredients(generatedMenu);
      const list = await generateShoppingList(ingredients);
      setShoppingList(list);
    } catch (error) {
      console.error("Error generating shopping list:", error);
      showError("Error al generar la lista de la compra. Inténtalo de nuevo.");
    } finally {
      setIsGeneratingShoppingList(false);
      setIsAIGenerating(false);
    }
  };


  const handleSaveGoal = (e: React.FormEvent | null, closeAfter = true) => {
    e?.preventDefault();
    // Use editWeight if valid, otherwise fall back to profile.weight
    const weightVal = editWeight.trim()
      ? parseFloat(editWeight)
      : profile.weight > 0 ? profile.weight : NaN;
    if (!editProfile.name.trim() || isNaN(weightVal) || weightVal <= 0 || editProfile.age <= 0 || editProfile.height <= 0) return;

    const hasFullData = true; // all required fields validated above

    // Always ensure defaults so the AI never gets undefined fields
    const profileToSave: UserProfile = {
      ...editProfile,
      name: editProfile.name.trim(),
      dietType: editProfile.dietType || 'Normal',
      macroDistribution: editProfile.macroDistribution || 'balanced',
      weight: weightVal,
    };

    // Compare key fields to decide on regeneration
    const dietChanged =
      editProfile.dietType !== profile.dietType ||
      editProfile.goal !== profile.goal ||
      editProfile.diabetesType !== profile.diabetesType ||
      JSON.stringify(editProfile.medicalConditions) !== JSON.stringify(profile.medicalConditions) ||
      editProfile.dislikedFoods !== profile.dislikedFoods ||
      JSON.stringify(editProfile.allergies) !== JSON.stringify(profile.allergies) ||
      editProfile.macroDistribution !== profile.macroDistribution;

    const gymChanged =
      editProfile.gymGoal !== profile.gymGoal ||
      editProfile.workoutType !== profile.workoutType ||
      editProfile.gymEnabled !== profile.gymEnabled ||
      editProfile.trainingDaysPerWeek !== profile.trainingDaysPerWeek;

    setProfile(profileToSave);
    updateGoalsForProfile(profileToSave, weightVal);
    if (dietChanged && generatedMenu) setMenuNeedsRegeneration(true);
    if (editProfile.gymEnabled && gymChanged && workoutPlan) setWorkoutNeedsRegeneration(true);

    if (closeAfter) setIsGoalModalOpen(false);
  };

  const getSessionCalories = () => {
    const currentWeight = profile.weight > 0 ? profile.weight : 70;
    return (
      calculateExpertCalories(currentWeight, profile.gymGoal, 'warm') +
      calculateExpertCalories(currentWeight, profile.gymGoal, 'main') +
      calculateExpertCalories(currentWeight, profile.gymGoal, 'cool')
    );
  };

  // Recompute and save habits calories for a calendar date based on current gymDayDone state.
  const syncHabitsForDate = (
    date: string,
    doneState: {[key: string]: boolean},
    dates: {[key: string]: string},
    prevHabits: DailyHabits
  ): DailyHabits[string] => {
    const sessionCals = getSessionCalories();
    const doneDaysOnDate = Object.entries(doneState).filter(([lbl, done]) => done && dates[lbl] === date).length;
    return {
      ...(prevHabits[date] || { water: 0, sleep: 0 }),
      workoutDone: doneDaysOnDate > 0,
      workoutCalories: doneDaysOnDate * sessionCals,
      workoutSessionFocus: doneDaysOnDate > 0 ? translateGymGoal(profile.gymGoal) : '',
    };
  };

  const handleToggleGymDay = (dayLabel: string) => {
    const date = gymRoutineDates[dayLabel];
    if (!date) return;
    const newDoneState = { ...gymDayDone, [dayLabel]: !(gymDayDone[dayLabel] ?? false) };
    setGymDayDone(newDoneState);
    setHabits(prev => {
      const updated = syncHabitsForDate(date, newDoneState, gymRoutineDates, prev);
      if (user) setDoc(doc(db, 'users', user.uid, 'habits', date), updated).catch(console.error);
      return { ...prev, [date]: updated };
    });
  };

  const handleGymDayDateChange = (dayLabel: string, newDate: string) => {
    const oldDate = gymRoutineDates[dayLabel];
    const newDates = { ...gymRoutineDates, [dayLabel]: newDate };
    setGymRoutineDates(newDates);
    if (!gymDayDone[dayLabel]) return;
    // Day was done — move its calories from oldDate to newDate
    setHabits(prev => {
      const sessionCals = getSessionCalories();
      const next = { ...prev };
      // Recompute old date (this day no longer counted there)
      const doneDaysOld = Object.entries(gymDayDone).filter(([lbl, done]) => done && newDates[lbl] === oldDate).length;
      next[oldDate] = {
        ...(next[oldDate] || { water: 0, sleep: 0 }),
        workoutDone: doneDaysOld > 0,
        workoutCalories: doneDaysOld * sessionCals,
        workoutSessionFocus: doneDaysOld > 0 ? translateGymGoal(profile.gymGoal) : '',
      };
      // Recompute new date (this day now counted there)
      const doneDaysNew = Object.entries(gymDayDone).filter(([lbl, done]) => done && newDates[lbl] === newDate).length;
      next[newDate] = {
        ...(next[newDate] || { water: 0, sleep: 0 }),
        workoutDone: doneDaysNew > 0,
        workoutCalories: doneDaysNew * sessionCals,
        workoutSessionFocus: doneDaysNew > 0 ? translateGymGoal(profile.gymGoal) : '',
      };
      if (user) {
        setDoc(doc(db, 'users', user.uid, 'habits', oldDate), next[oldDate]).catch(console.error);
        setDoc(doc(db, 'users', user.uid, 'habits', newDate), next[newDate]).catch(console.error);
      }
      return next;
    });
  };

  const handleToggleExercise = async (id: string, impactDate: string) => {
    const currentCompleted = habits[impactDate]?.completedExercises || [];
    const isDone = currentCompleted.includes(id);
    
    const newCompleted = isDone 
      ? currentCompleted.filter(cid => cid !== id)
      : [...currentCompleted, id];

    const newHabits = {
      ...habits,
      [impactDate]: {
        ...(habits[impactDate] || { water: 0, sleep: 0 }),
        completedExercises: newCompleted,
      }
    };
    
    setHabits(newHabits);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'habits', impactDate), newHabits[impactDate]);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/habits/${impactDate}`);
      }
    }
  };

  const handleToggleWorkout = async () => {
    const dateStr = getLocalDateStr();
    const newHabits = {
      ...habits,
      [dateStr]: {
        ...(habits[dateStr] || { water: 0, sleep: 0 }),
        workoutDone: !habits[dateStr]?.workoutDone
      }
    };
    setHabits(newHabits);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'habits', dateStr), newHabits[dateStr]);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/habits/${dateStr}`);
      }
    }
  };

  const handleGenerateWorkout = async (customProfile?: UserProfile) => {
    const targetProfile = customProfile || profile;
    const days = targetProfile.trainingDaysPerWeek || 3;
    if (isAIGenerating) { showError('Ya hay una generación en curso. Espera a que termine.'); return; }

    // Set dates eagerly so inputs never show empty
    const base = new Date(todayStr + 'T12:00:00');
    const newDates: {[key: string]: string} = {};
    for (let i = 1; i <= days; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + (i - 1) * 2);
      newDates[`Día ${i}`] = getLocalDateStr(d);
    }
    setGymRoutineDates(newDates);
    setGymDayDone({});

    setIsAIGenerating(true);
    setIsGeneratingWorkout(true);
    setWorkoutProgressMsg('Iniciando generación...');
    try {
      const profileStr = JSON.stringify({
        ...targetProfile,
        diabetes: targetProfile.diabetesType,
        currentWeight: targetProfile.weight > 0 ? targetProfile.weight : 'Desconocido'
      });
      const plan = await generateWorkoutPlan(profileStr, (step) => setWorkoutProgressMsg(step));
      setWorkoutPlan(plan);
      setWorkoutNeedsRegeneration(false);
      setSectionUnlockedAt(prev => {
        const next = { ...prev, gym: 0 };
        if (user?.uid) localStorage.setItem(`kilokalo_section_badges_${user.uid}`, JSON.stringify(next));
        return next;
      });
    } catch (error: any) {
      console.error("Error generating workout:", error);
      showError(error?.message || "Error al generar tu rutina de entrenamiento.");
    } finally {
      setIsGeneratingWorkout(false);
      setIsAIGenerating(false);
      setWorkoutProgressMsg('');
    }
  };

  const updateHabit = (type: 'water' | 'sleep', value: number) => {
    const dateStr = getLocalDateStr();
    const newHabits = {
      ...habits,
      [dateStr]: {
        ...(habits[dateStr] || { water: 0, sleep: 0 }),
        [type]: value
      }
    };
    setHabits(newHabits);
    if (user) {
      setDoc(doc(db, 'users', user.uid, 'habits', dateStr), newHabits[dateStr]).catch(console.error);
    }
  };

  const todayHabits = habits[todayStr] || { water: 0, sleep: 0 };

  const handleRegenerateWorkoutTable = async (tableContent: string) => {
    if (!workoutPlan) return;
    setIsGeneratingWorkout(true);
    try {
      const prompt = `Eres un experto entrenador personal. 
Tengo este plan de entrenamiento actual:
---
${workoutPlan}
---

Quiero que me des una ALTERNATIVA para esta tabla de ejercicios específica, optimizada para mi objetivo de ${translateGymGoal(profile.gymGoal)} para una persona de ${profile.age} años:

---
${tableContent}
---

Devuélveme SOLO la nueva tabla en formato Markdown, similar a la anterior pero con ejercicios diferentes o variaciones que mantengan el estímulo. NO incluyas ninguna explicación, solo la tabla Markdown.`;

      let result = '';
      await streamCompletion(prompt, (chunk) => { result += chunk; });
      if (result) {
        setWorkoutPlan(prev => prev ? prev.replace(tableContent, result) : result);
      }
    } catch (error) {
      console.error("Error regenerating table:", error);
      showError("Error al regenerar los ejercicios.");
    } finally {
      setIsGeneratingWorkout(false);
    }
  };

  const getWorkoutSection = (text: string | null, section: 'info' | 'exercises' | 'safety') => {
    if (!text) return '';
    const plan = text.replace(/\r\n/g, '\n');
    const markerMap = { info: '## INFO', exercises: '## EJERCICIOS', safety: '## TIPS' };
    const nextMap = { info: '## EJERCICIOS', exercises: '## TIPS', safety: '' };
    const marker = markerMap[section];
    const next = nextMap[section];
    const startIdx = plan.indexOf(marker);
    if (startIdx === -1) {
      return section === 'info' ? plan : `Sección no disponible. Prueba a regenerar.`;
    }
    const contentStart = plan.indexOf('\n', startIdx) + 1;
    const endIdx = next ? plan.indexOf(next, contentStart) : -1;
    return (endIdx === -1 ? plan.slice(contentStart) : plan.slice(contentStart, endIdx)).trim();
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (error: any) {
      console.error("Auth error:", error);
      // Translate common Firebase auth errors
      let errorMessage = "Error de autenticación";
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        errorMessage = "Email o contraseña incorrectos";
      } else if (error.code === 'auth/email-already-in-use') {
        errorMessage = "El email ya está registrado. Si usaste Google anteriormente, intenta iniciar sesión o restablecer la contraseña.";
      } else if (error.code === 'auth/weak-password') {
        errorMessage = "La contraseña debe tener al menos 6 caracteres";
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "El formato del email no es válido";
      }
      setAuthError(errorMessage);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      if (isIOSorSafari()) {
        // Popup sign-in is blocked by Safari/iOS WebKit — use redirect flow instead
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (error: any) {
      console.error("Error signing in with Google:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setAuthError("Has cerrado la ventana de inicio de sesión.");
      } else if (error.code === 'auth/unauthorized-domain') {
        setAuthError("Dominio no autorizado. Añade esta URL en la consola de Firebase.");
      } else {
        setAuthError("Error al iniciar sesión con Google.");
      }
    }
  };

  const handlePasswordReset = async () => {
    if (!authEmail) {
      setAuthError("Por favor, introduce tu email para restablecer la contraseña.");
      return;
    }
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, authEmail);
      setResetEmailSent(true);
      setTimeout(() => setResetEmailSent(false), 5000);
    } catch (error: any) {
      console.error("Password reset error:", error);
      if (error.code === 'auth/user-not-found') {
        setAuthError("No hay ninguna cuenta registrada con este email.");
      } else if (error.code === 'auth/invalid-email') {
        setAuthError("El formato del email no es válido.");
      } else {
        setAuthError("Error al enviar el email de recuperación.");
      }
    }
  };


  const handleLogout = async () => {
    // Block persistence effects BEFORE resetting state — prevents overwriting
    // Firestore with empty state while user is still set in React state
    setIsDataLoaded(false);
    try {
      await signOut(auth);
      // Clear localStorage on logout
      localStorage.removeItem('nutritivapp_meals');
      localStorage.removeItem('nutritivapp_goals');
      localStorage.removeItem('nutritivapp_profile');
      localStorage.removeItem('nutritivapp_habits');
      localStorage.removeItem('nutritivapp_generated_menu');
      localStorage.removeItem('nutritivapp_shopping_list');

      // Reset state on logout
      setMeals([]);
      setGoals(DEFAULT_GOALS);
      setProfile({ ...DEFAULT_PROFILE });
      setHabits({});
      setGeneratedMenu(null);
      setShoppingList(null);
      setWorkoutPlan(null);
      setCheckedItems({});
      setMenuNeedsRegeneration(false);
      setWorkoutNeedsRegeneration(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className={`min-h-screen ${themeStyles.mainBg} flex items-center justify-center`}>
        <Loader2 className={`w-8 h-8 ${themeStyles.accent} animate-spin`} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-6 ${profile.theme === 'light' ? 'bg-gradient-to-b from-slate-100 to-slate-50' : 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950'}`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`max-w-md w-full backdrop-blur-xl rounded-2xl p-8 text-center ${profile.theme === 'light' ? 'bg-white border border-slate-200 shadow-2xl' : 'bg-zinc-900/50 border border-white/10'}`}
        >
          <div className="flex items-center justify-center mx-auto mb-8">
            <img src="/favicon-dark.png" alt="KiloKalo" className="w-16 h-16 rounded-2xl shadow-lg" />
          </div>
          <h1 className={`text-3xl font-display font-black tracking-tighter mb-8 text-center ${themeStyles.textMain}`}>
            {isRegistering ? 'Regístrate para empezar' : 'Inicia sesión en KiloKalo'}
          </h1>
          
          <div className="space-y-3 mb-8">
            <button
              onClick={handleGoogleLogin}
              className={`w-full bg-transparent border font-bold py-3 px-6 rounded-full flex items-center justify-center gap-3 transition-all ${themeStyles.border} ${themeStyles.textMain} hover:${themeStyles.accentBorder} hover:${themeStyles.accent}`}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continuar con Google
            </button>
          </div>

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className={`w-full border-t ${themeStyles.border}`}></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className={`px-4 ${themeStyles.textMuted} ${profile.theme === 'light' ? 'bg-white' : 'bg-zinc-950'}`}>o</span>
            </div>
          </div>
          
          <form onSubmit={handleEmailAuth} className="space-y-5 text-left">
            {authError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{authError}</p>
              </div>
            )}

            {resetEmailSent && (
              <div className={`p-3 rounded-lg ${themeStyles.accentMuted} border ${themeStyles.accentBorder} flex items-start gap-2 ${themeStyles.accent} text-sm`}>
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Se ha enviado un email para restablecer tu contraseña.</p>
              </div>
            )}
            
            <div>
              <label className={`block text-sm font-bold mb-2 ${themeStyles.textMain}`}>Dirección de correo electrónico</label>
              <input 
                type="email" 
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
                className={`w-full rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-current transition-all ${themeStyles.input}`}
                placeholder="Correo electrónico"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className={`block text-sm font-bold ${themeStyles.textMain}`}>Contraseña</label>
              </div>
              <input 
                type="password" 
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                minLength={6}
                className={`w-full rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-current transition-all ${themeStyles.input}`}
                placeholder="Contraseña"
              />
            </div>

            <button
              type="submit"
              disabled={isAuthenticating}
              className={`w-full ${themeStyles.buttonPrimary} py-3.5 px-6 rounded-full flex items-center justify-center gap-2 transition-all disabled:opacity-50 mt-8 uppercase tracking-wider text-sm font-bold`}
            >
              {isAuthenticating ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isRegistering ? 'Registrarse' : 'Iniciar sesión'}
            </button>
            
            <div className="text-center mt-8 space-y-4">
              {!isRegistering && (
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  className={`text-sm ${themeStyles.accent} font-bold hover:underline transition-all block mx-auto`}
                >
                  ¿Has olvidado tu contraseña?
                </button>
              )}
              
              <div className={`pt-8 border-t ${themeStyles.border}`}>
                <p className={`text-sm mb-4 ${themeStyles.textMuted}`}>
                  {isRegistering ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta?'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistering(!isRegistering);
                    setAuthError(null);
                  }}
                  className={`font-bold hover:underline transition-all ${themeStyles.textMain} hover:${themeStyles.accent}`}
                >
                  {isRegistering ? 'Inicia sesión aquí' : 'Regístrate en KiloKalo'}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-500 ${themeStyles.mainBg} pb-24 font-sans selection:${themeStyles.accentMuted}`}>
      {/* Header */}
      <header className={`pb-4 px-6 sticky top-0 backdrop-blur-2xl z-40 border-b ${themeStyles.headerBg} ${profile.theme === 'light' ? 'border-slate-200' : 'border-white/5'}`} style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex flex-col">
            <h1 className={`text-2xl font-display font-black tracking-tighter ${themeStyles.textMain} flex items-center gap-2`}>
              <img src={profile.theme === 'dark' ? '/favicon-dark.png' : '/favicon-light.png'} alt="KiloKalo" className="w-8 h-8 rounded-lg" />
              KiloKalo
            </h1>
            <p className={`${themeStyles.textMuted} text-[10px] font-bold tracking-wide uppercase mt-0.5`}>COME · ENTRENA · EQUILIBRA</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProfile({ ...profile, theme: profile.theme === 'light' ? 'dark' : 'light' })}
              className={`h-10 w-10 rounded-xl ${themeStyles.iconBg} border ${themeStyles.border} flex items-center justify-center`}
            >
              {profile.theme === 'light' ? <Moon className={`w-4 h-4 ${themeStyles.textMain}`} /> : <Sun className={`w-4 h-4 ${themeStyles.textMain}`} />}
            </button>
            <button
              onClick={handleLogout}
              className={`h-10 w-10 rounded-xl ${themeStyles.iconBg} border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Global Profile Warning */}
      {profile.age === 0 && (
        <div className="max-w-md mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-red-400 font-bold text-sm mb-1">Perfil incompleto</h3>
              <p className="text-red-400/80 text-xs">
                Para calcular tus macros y generar planes personalizados, necesitas configurar tu perfil. Toca el botón resaltado arriba a la derecha.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="px-6 pt-6 max-w-md mx-auto space-y-8">
        {/* Proactive Coach Banner */}
        <AnimatePresence>
          {proactiveMessage && (
            <motion.div
              key="proactive-banner"
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <AppBanner
                variant="coach"
                theme={profile.theme}
                label="Tu coach"
                message={proactiveMessage}
                icon={<img src={profile.theme === 'dark' ? '/favicon-dark.png' : '/favicon-light.png'} alt="Coach" className="w-5 h-5 rounded-lg" />}
                onDismiss={clearMessage}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Priority banner — only the highest-priority active banner is shown */}
        {activeSection === 'hoy' && !!profile.name && (() => {
          const openProfile = (step: 1 | 2 | 3 = 1) => {
            setEditProfile({ ...profile, allergies: Array.isArray(profile.allergies) ? profile.allergies : [], dislikedFoods: profile.dislikedFoods || '' });
            setEditWeight(profile.weight > 0 ? profile.weight.toString() : '');
            setDismissedSuggestions([]);
            setProfileModalTab(step === 2 ? 'dieta' : step === 3 ? 'entrenamiento' : 'datos');
            setProfileWizardStep(step);
            setIsGoalModalOpen(true);
          };

          // P1: height missing
          if (profile.height === 0 && !dismissedPrompts.includes('add_height')) {
            return (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                <AppBanner
                  variant="info"
                  theme={profile.theme}
                  icon={<Info className="w-4 h-4" />}
                  message="Añade tu altura para que tus objetivos de calorías sean precisos"
                  actions={
                    <button onClick={() => openProfile(1)} className={`text-xs font-bold ${themeStyles.accent} shrink-0 hover:underline`}>Añadir datos</button>
                  }
                  onDismiss={() => dismissPrompt('add_height')}
                />
              </motion.div>
            );
          }

          // P2: features not configured
          if (profile.height > 0 && (!profile.menuEnabled || !profile.gymEnabled) &&
              !dismissedPrompts.includes('setup_features_v2') && Date.now() > dietGymBannerRemindAfter) {
            return (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                <AppBanner
                  variant="warning"
                  theme={profile.theme}
                  icon={<Sparkles className="w-4 h-4" />}
                  title="Configura tu experiencia"
                  message="Activa los módulos que quieras: planes de comidas y/o seguimiento de entrenamiento."
                  actions={
                    <>
                      <div className="flex flex-wrap gap-2 mb-2.5">
                        {!profile.menuEnabled && (
                          <button onClick={() => openProfile(2)} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} transition-all`}>Menú semanal</button>
                        )}
                        {!profile.gymEnabled && (
                          <button onClick={() => openProfile(3)} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} transition-all`}>Entrenamiento</button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { const after = Date.now() + 24 * 60 * 60 * 1000; setDietGymBannerRemindAfter(after); if (user?.uid) { localStorage.setItem(`kilokalo_diet_gym_banner_remind_${user.uid}`, String(after)); } }}
                          className={`flex-1 py-1.5 rounded-xl text-xs font-bold border ${themeStyles.border} ${themeStyles.textMuted}`}
                        >Recordar mañana</button>
                        <button onClick={() => dismissPrompt('setup_features_v2')} className={`flex-1 py-1.5 rounded-xl text-xs font-bold ${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'}`}>No avisar más</button>
                      </div>
                    </>
                  }
                />
              </motion.div>
            );
          }

          // P3: notification permission
          if (profile.age > 0 && 'Notification' in window && Notification.permission !== 'denied' &&
              !notificationsEnabled && !notificationPermAsked && !dismissedPrompts.includes('notifications_ask')) {
            return (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                <AppBanner
                  variant="info"
                  theme={profile.theme}
                  icon={<span className="text-sm">🔔</span>}
                  message="¿Activar recordatorios? KiloKalo te avisará para registrar tus comidas y entrenamientos."
                  actions={
                    <button onClick={requestNotificationPermission} className={`shrink-0 text-xs font-bold ${themeStyles.accent} hover:underline`}>Activar</button>
                  }
                  onDismiss={() => dismissPrompt('notifications_ask')}
                />
              </motion.div>
            );
          }

          return null;
        })()}

          <AnimatePresence mode="wait">
          {activeSection === 'hoy' && (
            <motion.div key="hoy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 pb-24">
              {/* Welcome screen for users without a profile yet */}
              {(!profile.name || profile.age === 0) ? (
                <div className={`${themeStyles.bento} p-8 flex flex-col items-center text-center gap-5`}>
                  <img src={profile.theme === 'dark' ? '/favicon-dark.png' : '/favicon-light.png'} alt="KiloKalo" className="w-16 h-16 rounded-2xl" />
                  <div>
                    <h2 className={`text-xl font-display font-black ${themeStyles.textMain} mb-2`}>Bienvenido a KiloKalo</h2>
                    <p className={`text-sm ${themeStyles.textMuted} leading-relaxed`}>Completa tu perfil para ver tu balance calórico personalizado y empezar a registrar tus comidas.</p>
                  </div>
                  <button
                    onClick={() => { setEditProfile({ ...profile, allergies: [], dislikedFoods: '' }); setEditWeight(''); setDismissedSuggestions([]); setProfileWizardStep(1); setProfileModalTab('datos'); setIsGoalModalOpen(true); }}
                    className={`px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider ${themeStyles.buttonPrimary}`}
                  >
                    Ir al perfil →
                  </button>
                </div>
              ) : (
              <div className="flex flex-col gap-4">
                <div className="space-y-6">
                    <div className="space-y-6">
                      {/* 1. Calories Summary Card */}
                        {(() => {
                          const consumed = Math.round(assistant.consumedCalories);
                          const burned = Math.round(assistant.burnedCalories);
                          const target = Math.round(goals.calories);
                          const remaining = Math.round(assistant.remainingCalories);
                          const isOver = remaining < 0;
                          const progressPct = target > 0 ? Math.min(100, (consumed / target) * 100) : 0;
                          const accentCls = isOver ? 'text-amber-500' : (profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400');
                          const barCls = isOver ? 'bg-amber-500' : (profile.theme === 'light' ? 'bg-emerald-500' : 'bg-lime-400');
                          return (
                        <div className={`${themeStyles.bento} p-5 relative overflow-hidden border-b-4 ${isOver ? 'border-amber-500' : (profile.theme === 'light' ? 'border-emerald-500' : themeStyles.accentBorder)} shadow-2xl`}>
                          <div className={`absolute top-0 right-0 w-64 h-64 ${profile.theme === 'light' ? 'bg-emerald-500/5' : 'bg-lime-400/5'} rounded-full blur-3xl`} />
                          <div className="relative z-10">
                            {/* Title row */}
                            <div className="flex items-center justify-between mb-4">
                              <span className={`text-xs font-bold ${themeStyles.accent} uppercase tracking-[0.25em]`}>Margen de hoy</span>
                              {streak > 1 && (
                                <span className={`text-xs font-bold ${accentCls}`}>
                                  🔥 {streak} {streak === 1 ? 'día' : 'días'}
                                </span>
                              )}
                            </div>
                            {/* Big number */}
                            <div className="flex flex-col items-center gap-0.5 mb-5">
                              <span className={`text-6xl font-display font-black tracking-tighter ${accentCls}`}>
                                {Math.abs(remaining).toLocaleString('es-ES')}
                              </span>
                              <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>
                                {isOver ? 'kcal superadas' : 'kcal restantes'}
                              </span>
                            </div>
                            {/* Progress bar */}
                            <div className={`h-2 ${profile.theme === 'light' ? 'bg-slate-100' : 'bg-zinc-900'} rounded-full overflow-hidden mb-2`}>
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${progressPct}%` }}
                                className={`h-full rounded-full ${barCls}`}
                              />
                            </div>
                            {/* Stats line */}
                            <div className="flex items-center justify-between">
                              <p className={`text-xs ${themeStyles.textMuted}`}>
                                {burned > 0
                                  ? <>{consumed.toLocaleString('es-ES')} consumidas · <span className={profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400'}>+{burned} quemadas</span></>
                                  : <>{consumed.toLocaleString('es-ES')} consumidas de {target.toLocaleString('es-ES')} objetivo</>
                                }
                              </p>
                              <span className={`text-xs font-bold ${accentCls}`}>{Math.round(progressPct)}%</span>
                            </div>
                          </div>
                        </div>
                          );
                        })()}

                        {/* 2. Distribution (Macros) — only when goals are set */}
                        {goals.calories > 0 && (() => {
                          const getMacroBar = (consumed: number, target: number) => {
                            const pct = target > 0 ? consumed / target : 0;
                            if (pct >= 1.0) return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
                            if (pct >= 0.75) return 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]';
                            return profile.theme === 'light' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-lime-400 shadow-[0_0_15px_rgba(163,230,53,0.6)]';
                          };
                          const getMacroLabel = (consumed: number, target: number) => {
                            const pct = target > 0 ? consumed / target : 0;
                            if (pct >= 1.0) return 'text-red-500';
                            if (pct >= 0.75) return 'text-orange-500';
                            return themeStyles.accent;
                          };
                          const macros = [
                            { name: 'Proteínas', consumed: Math.round(totals.protein), target: goals.protein },
                            { name: 'Hidratos', consumed: Math.round(totals.carbs), target: goals.carbs },
                            { name: 'Grasas', consumed: Math.round(totals.fat), target: goals.fat },
                          ];
                          return (
                            <div className={`${themeStyles.bento} overflow-hidden`}>
                              <button
                                onClick={() => setMacrosExpanded(v => !v)}
                                className="w-full flex items-center justify-between gap-2 p-4"
                              >
                                <div className="flex items-center gap-2">
                                  <PieChart className={`w-4 h-4 ${themeStyles.accent} shrink-0`} />
                                  <span className={`text-xs font-bold ${themeStyles.textMain} uppercase tracking-widest`}>Macros</span>
                                </div>
                                {!macrosExpanded && (
                                  <span className={`text-xs font-bold ${themeStyles.textMuted} flex-1 text-right pr-2`}>
                                    P {Math.round(totals.protein)}g · H {Math.round(totals.carbs)}g · G {Math.round(totals.fat)}g
                                  </span>
                                )}
                                <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${macrosExpanded ? 'rotate-180' : ''}`} />
                              </button>
                              <AnimatePresence initial={false}>
                                {macrosExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                    className="overflow-hidden"
                                  >
                                    <div className="px-4 pb-4 space-y-4">
                                      {macros.map(({ name, consumed, target }) => {
                                        const pct = target > 0 ? consumed / target : 0;
                                        const barClass = getMacroBar(consumed, target);
                                        const labelClass = getMacroLabel(consumed, target);
                                        return (
                                          <div key={name} className="space-y-1.5 text-xs font-bold">
                                            <div className="flex justify-between items-baseline">
                                              <span className={labelClass}>{name}</span>
                                              <div className="flex items-baseline gap-1">
                                                <span className={`text-sm font-black ${labelClass}`}>{consumed}g</span>
                                                <span className={`${themeStyles.textMuted} opacity-60`}>/ {target}g</span>
                                                {pct >= 1.0 && <span className="text-red-500 font-black text-xs ml-1">+{consumed - target}g</span>}
                                              </div>
                                            </div>
                                            <div className={`h-3 ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-900'} rounded-full border ${themeStyles.border} overflow-hidden shadow-inner`}>
                                              <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${Math.min(100, pct * 100)}%` }}
                                                className={`h-full ${barClass} rounded-full`}
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* ── DAILY MEAL ENTRY & LIST (HOY section) ── */}
                    <div className="space-y-8">
                    {/* Compact food entry row */}
                    <div className={`${themeStyles.bento} p-3`}>
                      <p className={`text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-[0.18em] px-1 pb-2`}>
                        Escribe lo que comiste · o haz una foto 📷
                      </p>
                      <div className="flex items-center gap-2">
                        {/* Camera button */}
                        <button
                          disabled={imageFoodCooldown.isActive}
                          onClick={() => {
                            if (imageFoodCooldown.isActive) return;
                            imageFoodCooldown.start();
                            setAppError(null);
                            fileInputRef.current?.click();
                          }}
                          className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${themeStyles.iconBg} border ${themeStyles.border} transition-all disabled:opacity-50`}
                          title="Escanear comida"
                        >
                          {imageFoodCooldown.isActive
                            ? <span className="text-xs font-mono font-bold">{imageFoodCooldown.remaining}s</span>
                            : <Camera className={`w-5 h-5 ${themeStyles.accent}`} />}
                        </button>
                        {/* Text input with send button */}
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            placeholder={mealTimeHint}
                            className={`w-full ${themeStyles.input} rounded-xl pl-4 pr-12 py-3 text-sm transition-all`}
                            onFocus={() => setAppError(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !textFoodCooldown.isActive) {
                                textFoodCooldown.start();
                                handleTextFoodSubmit(e.currentTarget.value);
                                e.currentTarget.value = '';
                              }
                            }}
                          />
                          <button
                            disabled={textFoodCooldown.isActive}
                            className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 ${themeStyles.buttonPrimary} rounded-lg flex items-center justify-center transition-colors disabled:opacity-50`}
                            onClick={() => {
                              if (textFoodCooldown.isActive) return;
                              const input = document.querySelector(`input[placeholder="${mealTimeHint}"]`) as HTMLInputElement;
                              if (input && input.value) {
                                textFoodCooldown.start();
                                handleTextFoodSubmit(input.value);
                                input.value = '';
                              }
                            }}
                          >
                            {textFoodCooldown.isActive
                              ? <span className="text-[10px] font-mono font-bold">{textFoodCooldown.remaining}s</span>
                              : <Send className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* ── BLOQUE 4: REGISTROS DE HOY (collapsible) ── */}
                    <div className={`${themeStyles.bento} overflow-hidden`}>
                      <button
                        onClick={() => setRegistrosExpanded(v => !v)}
                        className="w-full flex items-center gap-2 px-4 py-3"
                      >
                        <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${registrosExpanded ? 'rotate-180' : ''}`} />
                        <span className={`text-xs font-black uppercase tracking-[0.2em] ${themeStyles.textMain} flex-1 text-left`}>Registros de hoy</span>
                        {registrosExpanded ? (
                          <span className={`text-xs font-bold ${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} px-2.5 py-0.5 rounded-full`}>
                            {todaysMeals.length}
                          </span>
                        ) : (
                          <span className={`text-xs font-bold ${themeStyles.textMuted}`}>
                            {todaysMeals.length > 0
                              ? `${todaysMeals.length} registros · ${Math.round(totals.calories).toLocaleString('es-ES')} kcal`
                              : 'Sin registros'}
                          </span>
                        )}
                      </button>
                      <AnimatePresence initial={false}>
                        {registrosExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 space-y-3">
                              {todaysMeals.length === 0 ? (
                                <div className={`text-center py-10 ${themeStyles.iconBg} rounded-2xl border ${themeStyles.border} border-dashed`}>
                                  <Utensils className={`w-7 h-7 ${themeStyles.textMuted} mx-auto mb-2 opacity-20`} />
                                  <p className={`${themeStyles.textMuted} font-bold uppercase tracking-widest text-xs`}>No hay registros hoy</p>
                                  <p className={`${themeStyles.textMuted} text-xs mt-1 opacity-60`}>Usa el buscador o la cámara para empezar</p>
                                </div>
                              ) : (
                                <AnimatePresence mode="popLayout">
                                  {todaysMeals.map((meal, index) => (
                                    <motion.div
                                      key={meal.id} layout
                                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                                      transition={{ duration: 0.2, delay: index * 0.05 }}
                                      className={`${themeStyles.card} rounded-2xl p-4 flex gap-4 group transition-all`}
                                    >
                                      <div className={`w-16 h-16 rounded-2xl overflow-hidden ${themeStyles.iconBg} shrink-0 shadow-xl border ${themeStyles.border}`}>
                                        <img src={meal.imageUrl} alt={meal.foodName} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between mb-1">
                                          <h3 className={`font-bold ${themeStyles.textMain} truncate text-base tracking-tight`}>{meal.foodName}</h3>
                                          <div className="flex items-center gap-0.5 shrink-0 ml-2">
                                            <button onClick={() => openMealForEdit(meal)} className={`${themeStyles.textMuted} hover:text-sky-400 p-1 rounded-lg hover:bg-sky-500/10 transition-all`} title="Editar">
                                              <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => removeMeal(meal.id)} className={`${themeStyles.textMuted} hover:text-rose-500 p-1 rounded-lg hover:bg-rose-500/10 transition-all`} title="Borrar">
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                                          <span className={`${themeStyles.accent} font-bold text-xs tracking-tight`}>{Math.round(meal.calories)} Kcal</span>
                                          <div className={`flex items-center gap-3 text-xs font-bold uppercase ${themeStyles.textMuted} tracking-wider`}>
                                            <span className={themeStyles.textMain}>P:{Math.round(meal.protein)}g</span>
                                            <span className={themeStyles.textMain}>H:{Math.round(meal.carbs)}g</span>
                                            <span className={themeStyles.textMain}>G:{Math.round(meal.fat)}g</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <SemaforoBadge semaforo={meal.semaforo} label={meal.semaforoLabel} />
                                          {meal.isHealthy && (
                                            <span className={`px-2 py-0.5 rounded-full ${themeStyles.accentMuted} ${themeStyles.accent} text-xs font-bold uppercase tracking-widest border ${themeStyles.accentBorder}`}>Saludable</span>
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>
                                  ))}
                                </AnimatePresence>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* ── BLOQUE 5: MI DÍA (collapsible) ── */}
                    {(() => {
                      const todayName = new Date().toLocaleDateString('es-ES', { weekday: 'long' }).toLowerCase();
                      const todayDay = generatedMenu?.days?.find((d: any) => d.day?.toLowerCase() === todayName);
                      const nextMealType = currentHour < 10 ? 'desayuno' : currentHour < 12 ? 'almuerzo' : currentHour < 17 ? 'merienda' : 'cena';
                      const plannedMeal = profile.menuEnabled && todayDay?.meals?.length
                        ? (todayDay.meals.find((m: any) => m.type?.toLowerCase().includes(nextMealType) && m.description !== 'COMIDA LIBRE') ?? todayDay.meals.find((m: any) => m.description !== 'COMIDA LIBRE'))
                        : null;
                      const hasMealCard = !!plannedMeal;

                      const dayHeaders = [...(workoutPlan || '').matchAll(/^# DÍA (\d+)\s*[—–-]\s*([^\n]+)/gim)].map(m => ({ label: `Día ${m[1]}`, focus: m[2].trim() }));
                      const todayGymEntry = profile.gymEnabled && workoutPlan && dayHeaders.length > 0
                        ? (dayHeaders.find(d => gymRoutineDates[d.label] === todayStr) ?? dayHeaders.find(d => d.label === gymDay) ?? dayHeaders[0])
                        : null;
                      const workoutDoneToday = todayGymEntry ? !!gymDayDone[todayGymEntry.label] : false;
                      const hasGymCard = !!todayGymEntry;

                      if (!hasMealCard && !hasGymCard) return null;

                      const mealLabel = nextMealType.charAt(0).toUpperCase() + nextMealType.slice(1);
                      const allDone = (!hasGymCard || workoutDoneToday) && !hasMealCard;
                      let summaryText = '';
                      if (allDone) {
                        summaryText = '✓ Todo completado hoy 🎯';
                      } else if (hasGymCard && hasMealCard) {
                        summaryText = workoutDoneToday
                          ? `✓ Entreno completado · ${mealLabel} pendiente`
                          : `${mealLabel} pendiente · Entreno pendiente`;
                      } else if (hasGymCard) {
                        summaryText = workoutDoneToday ? '✓ Entreno completado' : 'Entreno pendiente';
                      } else {
                        summaryText = `${mealLabel} pendiente`;
                      }

                      return (
                        <div className={`${themeStyles.bento} overflow-hidden`}>
                          <button
                            onClick={() => { const next = !miDiaExpanded; setMiDiaExpanded(next); localStorage.setItem('kilokalo_mi_dia_expanded', String(next)); }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-left"
                          >
                            <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${miDiaExpanded ? 'rotate-180' : ''}`} />
                            <span className={`text-xs font-black uppercase tracking-[0.2em] ${themeStyles.textMain} flex-1`}>Mi día</span>
                          </button>

                          {!miDiaExpanded && (
                            <div className="px-4 pb-3 -mt-1">
                              <p className={`text-[10px] ${themeStyles.textMuted} pl-6`}>{summaryText}</p>
                            </div>
                          )}

                          <AnimatePresence initial={false}>
                            {miDiaExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: 'easeInOut' }}
                                className="overflow-hidden"
                              >
                                <div className="px-4 pb-4 space-y-3">
                                  {hasMealCard && (
                                    <div className={`rounded-2xl border p-4 ${profile.theme === 'light' ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-lime-400/6 border-lime-400/20'}`}>
                                      <div className="flex items-center gap-2 mb-3">
                                        <UtensilsCrossed className={`w-4 h-4 ${themeStyles.accent} shrink-0`} />
                                        <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${themeStyles.accent}`}>Sugerencia del Menú</p>
                                      </div>
                                      <div className="mb-3">
                                        <p className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest mb-0.5`}>{plannedMeal!.type}</p>
                                        <p className={`text-sm font-semibold ${themeStyles.textMain} leading-snug`}>{plannedMeal!.description}</p>
                                        <p className={`text-xs ${themeStyles.textMuted} mt-0.5`}>{plannedMeal!.calories ?? '—'} kcal</p>
                                      </div>
                                      <button
                                        onClick={() => {
                                          const menuMeal = {
                                            id: Date.now().toString(),
                                            foodName: plannedMeal!.description ?? 'Comida del menú',
                                            calories: plannedMeal!.calories ?? 0,
                                            protein: plannedMeal!.proteinas ?? 0,
                                            carbs: plannedMeal!.carbohidratos ?? 0,
                                            fat: plannedMeal!.grasas ?? 0,
                                            timestamp: Date.now(),
                                            imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(plannedMeal!.description ?? 'Comida')}&background=27272a&color=a3e635&size=200`,
                                          };
                                          setMealEditMode('create');
                                          setPortionMultiplier(1);
                                          setOriginalAnalyzedName(menuMeal.foodName);
                                          setMacrosManuallyEdited(false);
                                          setMacrosJustUpdated(false);
                                          setEditingMeal(menuMeal);
                                        }}
                                        className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider ${themeStyles.buttonPrimary}`}
                                      >
                                        Registrar →
                                      </button>
                                    </div>
                                  )}
                                  {hasGymCard && (
                                    <button
                                      onClick={() => { setActiveSection('gym'); setGymSubTab('plan'); setPlanSubTab('ejercicios'); setGymDay(todayGymEntry!.label); }}
                                      className={`w-full text-left rounded-2xl border p-4 transition-all ${workoutDoneToday
                                        ? `${profile.theme === 'light' ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-lime-400/6 border-lime-400/20'}`
                                        : `${themeStyles.iconBg} ${themeStyles.border}`
                                      }`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${workoutDoneToday ? `${themeStyles.accentMuted} ${themeStyles.accentBorder}` : `${themeStyles.iconBg} ${themeStyles.border}`}`}>
                                          {workoutDoneToday
                                            ? <CheckCircle2 className={`w-4 h-4 ${themeStyles.accent}`} />
                                            : <Dumbbell className={`w-4 h-4 ${themeStyles.textMuted}`} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${workoutDoneToday ? themeStyles.accent : themeStyles.textMuted} mb-0.5`}>
                                            {workoutDoneToday ? 'Entrenamiento completado' : 'Entrenamiento de hoy'}
                                          </p>
                                          <p className={`text-sm font-bold ${themeStyles.textMain} truncate`}>{todayGymEntry!.focus}</p>
                                          <p className={`text-xs ${themeStyles.textMuted}`}>{todayGymEntry!.label}</p>
                                        </div>
                                        <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} shrink-0 -rotate-90`} />
                                      </div>
                                    </button>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })()}
                    </div>
                </div>
              )} {/* end profile-complete else */}
            </motion.div>
          )}

          {/* ── SEMANA SECTION ── */}
          {activeSection === 'semana' && (
            <motion.div
              key="semana"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 pb-24"
            >
              {/* ── COMPARATIVA VS SEMANA ANTERIOR ── */}
              {weekOffset === 0 && (() => {
                // Compute previous week stats
                const prevStats = (weekDays as any[]).map(day => {
                  const prevDate = new Date(day.date + 'T12:00:00');
                  prevDate.setDate(prevDate.getDate() - 7);
                  const dateStr = getLocalDateStr(prevDate);
                  const dayMeals = meals.filter((m: any) => getLocalDateStr(new Date(m.timestamp)) === dateStr);
                  const cal = dayMeals.reduce((s: number, m: any) => s + m.calories, 0);
                  const pct = goals.calories > 0 ? cal / goals.calories : 0;
                  const dayHabits = habits[dateStr];
                  const workoutDone = dayHabits?.workoutDone ?? false;
                  const hasData = cal > 0 || workoutDone;
                  const onTarget = hasData && pct >= 0.85 && pct <= 1.1;
                  return { cal, onTarget, workoutDone, hasData };
                });

                const prevDaysWithData = prevStats.filter((d: any) => d.hasData).length;
                if (prevDaysWithData < 2) {
                  return (
                    <div className={`${themeStyles.bento} p-4`}>
                      <p className={`text-xs font-bold ${themeStyles.accent} uppercase tracking-[0.2em] mb-1`}>VS semana anterior</p>
                      <p className={`text-xs ${themeStyles.textMuted}`}>Primera semana — ¡buen comienzo!</p>
                    </div>
                  );
                }

                const currentDays = (weekDays as any[]).filter(d => !d.isFuture);
                const currOnTarget = currentDays.filter(d => d.status === 'green').length;
                const currTotal = currentDays.length;
                const currAvgCal = currTotal > 0
                  ? Math.round(currentDays.filter(d => d.caloriesConsumed > 0).reduce((s: number, d: any) => s + d.caloriesConsumed, 0) / Math.max(1, currentDays.filter(d => d.caloriesConsumed > 0).length))
                  : 0;
                const currWorkouts = currentDays.filter(d => d.workoutDone).length;

                const prevOnTarget = prevStats.filter((d: any) => d.onTarget).length;
                const prevAvgCal = Math.round(prevStats.filter((d: any) => d.hasData && d.cal > 0).reduce((s: number, d: any) => s + d.cal, 0) / Math.max(1, prevStats.filter((d: any) => d.hasData && d.cal > 0).length));
                const prevWorkouts = prevStats.filter((d: any) => d.workoutDone).length;

                const onTargetDiff = currOnTarget - prevOnTarget;
                const calDiff = currAvgCal - prevAvgCal;
                const workoutDiff = currWorkouts - prevWorkouts;

                const arrow = (diff: number, invert = false) => {
                  if (diff === 0) return { sym: '=', cls: themeStyles.textMuted };
                  const improve = invert ? diff < 0 : diff > 0;
                  return improve
                    ? { sym: `↑ +${diff > 0 ? diff : -diff}`, cls: profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400' }
                    : { sym: `↓ ${diff > 0 ? `+${diff}` : diff}`, cls: 'text-red-500' };
                };

                const targetArrow = arrow(onTargetDiff);
                const calArrow = arrow(calDiff, true); // less calories = better if losing, neutral otherwise
                const workoutArrow = arrow(workoutDiff);

                const rows = [
                  { label: 'Días en objetivo', curr: `${currOnTarget}/${currTotal}`, prev: `${prevOnTarget}/7`, ar: targetArrow },
                  { label: 'Kcal promedio', curr: currAvgCal > 0 ? currAvgCal.toLocaleString('es-ES') : '—', prev: prevAvgCal > 0 ? prevAvgCal.toLocaleString('es-ES') : '—', ar: { sym: calDiff === 0 ? '=' : (calDiff > 0 ? `+${calDiff}` : `${calDiff}`), cls: calDiff === 0 ? themeStyles.textMuted : themeStyles.textMuted } },
                  ...(profile.gymEnabled ? [{ label: 'Entrenamientos', curr: `${currWorkouts}`, prev: `${prevWorkouts}`, ar: workoutArrow }] : []),
                ];

                return (
                  <div className={`${themeStyles.bento} p-4`}>
                    <p className={`text-xs font-bold ${themeStyles.accent} uppercase tracking-[0.2em] mb-3`}>VS semana anterior</p>
                    <div className="space-y-2">
                      {rows.map(row => (
                        <div key={row.label} className="flex items-center justify-between">
                          <span className={`text-xs ${themeStyles.textMuted}`}>{row.label}</span>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-bold ${themeStyles.textMain}`}>{row.curr}</span>
                            <span className={`text-xs font-bold ${row.ar.cls}`}>{row.ar.sym}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── SEMAPHORE WEEKLY VIEW ── */}
              <div className="space-y-4">

                {/* Grid card */}
                <div className={`${themeStyles.bento} p-4 space-y-5`}>
                  {/* Header with week navigation */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => { setWeekOffset(w => w - 1); setExpandedWeekDay(null); setWeeklyAnalysis(''); }}
                      className={`p-2.5 rounded-xl ${profile.theme === 'light' ? 'hover:bg-slate-100' : 'hover:bg-white/10'} transition-all`}
                    >
                      <ChevronDown className={`w-5 h-5 ${themeStyles.textMuted} rotate-90`} />
                    </button>

                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>
                        {weekOffset === 0 ? 'Esta semana' : weekOffset === -1 ? 'Semana pasada' : `Hace ${Math.abs(weekOffset)} semanas`}
                      </span>
                      {weekDays.length === 7 && (
                        <span className={`text-xs font-bold ${themeStyles.accent} uppercase tracking-widest opacity-70`}>
                          {(() => {
                            const fmt = (d: string) =>
                              new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).toUpperCase();
                            return `${fmt(weekDays[0].date)} — ${fmt(weekDays[6].date)}`;
                          })()}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => { if (weekOffset < 0) { setWeekOffset(w => w + 1); setExpandedWeekDay(null); setWeeklyAnalysis(''); } }}
                      disabled={weekOffset === 0}
                      className={`p-2.5 rounded-xl transition-all ${weekOffset === 0 ? 'opacity-20 cursor-not-allowed' : `${profile.theme === 'light' ? 'hover:bg-slate-100' : 'hover:bg-white/10'}`}`}
                    >
                      <ChevronDown className={`w-5 h-5 ${themeStyles.textMuted} -rotate-90`} />
                    </button>
                  </div>

                  {/* 7-day row */}
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {(weekDays as any[]).map((day) => {
                      const isExpanded = expandedWeekDay === day.date;
                      const accentDot   = profile.theme === 'light' ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-lime-400 shadow-lime-400/30';
                      const accentRing  = profile.theme === 'light' ? 'ring-emerald-500/20' : 'ring-lime-400/20';
                      const dotCfg: Record<string, string> = {
                        green:  accentDot,
                        yellow: 'bg-amber-500 shadow-amber-500/30',
                        red:    'bg-red-500 shadow-red-500/30',
                        empty:  profile.theme === 'light' ? 'bg-zinc-400' : 'bg-zinc-700',
                        future: '',
                      };
                      const ringCfg: Record<string, string> = {
                        green:  accentRing,
                        yellow: 'ring-amber-500/20',
                        red:    'ring-red-500/20',
                        empty:  'ring-zinc-500/10',
                        future: '',
                      };

                      return (
                        <div key={day.date} className="flex-1 min-w-[2.75rem]">
                          <button
                            onClick={() => { if (!day.isFuture) setExpandedWeekDay(isExpanded ? null : day.date); }}
                            disabled={day.isFuture}
                            className={`w-full flex flex-col items-center gap-1 py-3 px-0.5 rounded-2xl transition-all
                              ${day.isToday ? `ring-2 ${ringCfg[day.status]} ${profile.theme === 'light' ? 'bg-slate-50' : 'bg-white/5'}` : ''}
                              ${!day.isFuture ? `cursor-pointer ${profile.theme === 'light' ? 'hover:bg-slate-50' : 'hover:bg-white/5'}` : 'cursor-default opacity-40'}
                              ${isExpanded ? (profile.theme === 'light' ? 'bg-slate-100' : 'bg-white/[0.06]') : ''}
                            `}
                          >
                            <span className={`text-xs font-bold uppercase tracking-wider ${day.isToday ? themeStyles.accent : themeStyles.textMuted}`}>
                              {day.dayShort}
                            </span>
                            <span className={`text-xs font-bold ${themeStyles.textMuted}`}>
                              {new Date(day.date + 'T12:00:00').getDate()}
                            </span>

                            {/* Semaphore dot */}
                            {day.isFuture ? (
                              <div className={`w-8 h-8 rounded-full border-2 border-dashed ${profile.theme === 'light' ? 'border-slate-300' : 'border-zinc-700'} flex items-center justify-center`}>
                                <span className={`text-xs font-bold ${themeStyles.textMuted}`}>—</span>
                              </div>
                            ) : (
                              <div className={`w-8 h-8 rounded-full ${dotCfg[day.status]} shadow-lg ring-4 ${ringCfg[day.status]} flex items-center justify-center`}>
                                {day.status === 'green'  && <CheckCircle2 className={`w-4 h-4 ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'}`} />}
                                {day.status === 'yellow' && <AlertTriangle className="w-3.5 h-3.5 text-white" />}
                                {(day.status === 'red' || day.status === 'empty') && <X className="w-3.5 h-3.5 text-white" />}
                              </div>
                            )}

                            {/* kcal + workout badge */}
                            <div className="flex flex-col items-center gap-0.5 min-h-[2.5rem] justify-center">
                              {!day.isFuture && day.caloriesConsumed > 0 ? (
                                <span className={`text-xs font-bold leading-none text-center ${themeStyles.textMain}`}>
                                  {Math.round(day.caloriesConsumed)}<br/>
                                  <span className={`${themeStyles.textMuted} font-normal`}>kcal</span>
                                </span>
                              ) : !day.isFuture ? (
                                <span className={`text-xs font-bold ${themeStyles.textMuted} text-center leading-tight`}>Sin<br/>datos</span>
                              ) : null}
                              {day.workoutDone && !day.isFuture && (
                                <Dumbbell className={`w-2.5 h-2.5 ${themeStyles.accent}`} />
                              )}
                            </div>

                            {/* Chevron toggle */}
                            {!day.isFuture && (
                              isExpanded
                                ? <ChevronUp className={`w-3 h-3 ${themeStyles.textMuted}`} />
                                : <ChevronDown className={`w-3 h-3 ${themeStyles.textMuted} opacity-30`} />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Expanded day detail */}
                  <AnimatePresence>
                    {expandedWeekDay && (() => {
                      const day = (weekDays as any[]).find(d => d.date === expandedWeekDay);
                      if (!day) return null;
                      const pct = Math.round(day.caloriesPct * 100);
                      const statusLabel: Record<string, string> = { green: 'Bien', yellow: 'Atención', red: 'Mal', empty: 'Sin datos', future: '' };
                      const statusColor: Record<string, string> = {
                        green:  profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400',
                        yellow: 'text-amber-500',
                        red:    'text-red-500',
                        empty:  themeStyles.textMuted,
                        future: '',
                      };
                      const barColor: Record<string, string> = {
                        green:  profile.theme === 'light' ? 'bg-emerald-500' : 'bg-lime-400',
                        yellow: 'bg-amber-500',
                        red:    'bg-red-500',
                        empty:  profile.theme === 'light' ? 'bg-zinc-400' : 'bg-zinc-700',
                        future: '',
                      };

                      return (
                        <motion.div
                          key={expandedWeekDay}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className={`rounded-2xl border ${themeStyles.border} ${profile.theme === 'light' ? 'bg-slate-50' : 'bg-white/[0.03]'} p-5 space-y-4`}>

                            {/* Day title + status */}
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-bold ${themeStyles.textMain} uppercase tracking-widest`}>
                                {day.dayName} {new Date(day.date + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }).toUpperCase()}
                              </span>
                              <span className={`text-xs font-bold uppercase tracking-widest ${statusColor[day.status]}`}>
                                {statusLabel[day.status]}
                              </span>
                            </div>

                            {/* Calorie progress bar */}
                            <div className="space-y-1.5">
                              <div className="flex justify-between items-end">
                                <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Calorías</span>
                                <span className={`text-xs font-bold ${themeStyles.textMain}`}>
                                  {Math.round(day.caloriesConsumed).toLocaleString('es-ES')} / {day.caloriesGoal.toLocaleString('es-ES')} kcal
                                  <span className={` ml-1 ${statusColor[day.status]}`}>({pct}%)</span>
                                </span>
                              </div>
                              <div className={`h-3 ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-900'} rounded-full overflow-hidden border ${themeStyles.border}`}>
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.min(100, pct)}%` }}
                                  transition={{ duration: 0.5, ease: 'easeOut' }}
                                  className={`h-full rounded-full ${barColor[day.status]}`}
                                />
                              </div>
                            </div>

                            {/* Meals list */}
                            {day.dayMeals.length > 0 ? (
                              <div className="space-y-1">
                                <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>
                                  Comidas registradas: {day.dayMeals.length}
                                </span>
                                <div className="mt-1 space-y-1">
                                  {day.dayMeals.map((m: any) => (
                                    <div key={m.id} className="flex justify-between items-center gap-2">
                                      <span className={`text-xs ${themeStyles.textMain} truncate`}>• {m.foodName}</span>
                                      <span className={`text-xs font-bold ${themeStyles.textMuted} shrink-0`}>{Math.round(m.calories)} kcal</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className={`text-xs ${themeStyles.textMuted}`}>No hay comidas registradas este día.</p>
                            )}

                            {/* Workout row */}
                            {profile.gymEnabled && (
                              <div className={`flex items-center gap-2 pt-2 border-t ${themeStyles.border}`}>
                                <Dumbbell className={`w-3.5 h-3.5 shrink-0 ${day.workoutDone ? (profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400') : themeStyles.textMuted}`} />
                                <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Entrenamiento:</span>
                                <span className={`text-xs font-bold ${day.workoutDone ? (profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400') : 'text-red-500'}`}>
                                  {day.workoutDone
                                    ? `✓ Completado — ${Math.round(day.workoutCalories)} kcal quemadas`
                                    : day.hadWorkoutPlanned
                                      ? '✗ No completado'
                                      : '— Sin entrenamiento'}
                                </span>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })()}
                  </AnimatePresence>
                </div>

                {/* AI Analysis card */}
                <div className={`${themeStyles.bento} p-4 space-y-4`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 ${themeStyles.accentBg} rounded-xl shadow-lg`}>
                      <Bot className={`w-4 h-4 ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'}`} />
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${themeStyles.textMain} uppercase tracking-widest`}>Análisis IA</p>
                      <p className={`text-xs ${themeStyles.textMuted} uppercase tracking-widest`}>Tu coach personal</p>
                    </div>
                  </div>

                  {weeklyAnalysis && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`rounded-2xl p-5 ${profile.theme === 'light' ? 'bg-emerald-50 border border-emerald-100' : 'bg-lime-400/5 border border-lime-400/10'}`}
                    >
                      <p className={`text-sm leading-relaxed ${themeStyles.textMain} whitespace-pre-line`}>{weeklyAnalysis}</p>
                    </motion.div>
                  )}

                  <button
                    onClick={handleWeeklyAnalysis}
                    disabled={weeklyAnalysisLoading || weeklyAnalysisCooldown.isActive}
                    className={`w-full py-4 px-6 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                      weeklyAnalysisLoading || weeklyAnalysisCooldown.isActive
                        ? `${profile.theme === 'light' ? 'bg-slate-100 text-slate-400' : 'bg-zinc-900 text-zinc-600'} cursor-not-allowed`
                        : themeStyles.buttonPrimary
                    }`}
                  >
                    {weeklyAnalysisLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Analizando...</>
                    ) : weeklyAnalysisCooldown.isActive ? (
                      <><Loader2 className="w-3.5 h-3.5" />Disponible en {weeklyAnalysisCooldown.remaining}s</>
                    ) : (
                      <><Sparkles className="w-4 h-4" />Analizar mi semana con IA</>
                    )}
                  </button>
                </div>
              </div>

              <section>
                  <div className={`${themeStyles.bento} p-5 relative overflow-hidden`}>
                    <div className={`absolute top-0 right-0 w-64 h-64 ${profile.theme === 'light' ? 'bg-emerald-500/5' : '${themeStyles.accentMuted}'} rounded-full blur-3xl`}></div>

                    <div className="flex items-center gap-4 mb-10 relative z-10">
                      <div className={`p-3 ${themeStyles.accentBg} rounded-2xl shadow-lg`}>
                        <TrendingUp className={`w-6 h-6 ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'}`} />
                      </div>
                      <div>
                        <h2 className={`text-xl font-display font-black ${themeStyles.textMain} tracking-tight uppercase`}>Análisis Histórico</h2>
                        <p className={`text-xs font-bold ${themeStyles.accent} uppercase tracking-widest opacity-60`}>Seguimiento de Calorías</p>
                      </div>
                    </div>

                    <div className="h-72 w-full -ml-4 relative z-10">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trendsData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <XAxis
                            dataKey="name"
                            stroke={profile.theme === 'light' ? '#94a3b8' : '#52525b'}
                            fontSize={8}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: profile.theme === 'light' ? '#64748b' : '#71717a', fontWeight: 800 }}
                            dy={10}
                            interval={evolutionPeriod === 'monthly' ? 4 : Math.floor(trendsData.length / 8)}
                          />
                          <YAxis yAxisId="cal" orientation="left" hide domain={[0, 'auto']} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: profile.theme === 'light' ? '#ffffff' : '#18181b',
                              borderColor: profile.theme === 'light' ? '#e2e8f0' : 'rgba(163, 230, 53, 0.2)',
                              borderRadius: '20px',
                              color: profile.theme === 'light' ? '#0f172a' : '#fff',
                              fontSize: '11px',
                              boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
                            }}
                            itemStyle={{ fontSize: '11px', fontWeight: 700, padding: '2px 0' }}
                            labelStyle={{ color: profile.theme === 'light' ? '#10b981' : '#a3e635', marginBottom: '6px', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}
                            cursor={{ fill: profile.theme === 'light' ? '#10b981' : '#a3e635', opacity: 0.05 }}
                          />
                          <Bar
                            yAxisId="cal"
                            dataKey="calories"
                            fill={profile.theme === 'light' ? '#10b981' : '#a3e635'}
                            radius={[2, 2, 0, 0]}
                            barSize={evolutionPeriod === 'monthly' ? 12 : 4}
                            name="Ingeridas"
                          />
                          <Line
                            yAxisId="cal"
                            type="monotone"
                            dataKey="goal"
                            stroke="#818cf8"
                            strokeWidth={2}
                            strokeDasharray="6 6"
                            dot={false}
                            name="Puedes llegar a"
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    <div className={`mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-xs font-bold uppercase tracking-widest ${themeStyles.textMuted} border-t ${themeStyles.border} pt-8`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-sm ${themeStyles.accentBg} shadow-sm`}></div>
                        <span className={themeStyles.textMain}>Ingeridas</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-0.5 bg-indigo-400 border-t border-dashed border-indigo-400"></div>
                        <span className={themeStyles.textMain}>Puedes llegar a</span>
                      </div>
                    </div>
                  </div>
                </section>
            </motion.div>
          )}

          {/* ── MENU SECTION ── */}
          {activeSection === 'menu' && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6 pb-24"
            >
              {/* Plan section — always visible */}
              <div className="space-y-6">
                {(!profile.dietType || profile.dietType === '') && !dismissedPrompts.includes('add_diet_type') && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                    <AppBanner
                      variant="info"
                      theme={profile.theme}
                      icon={<Info className="w-4 h-4" />}
                      message="Dieta configurada como Normal. ¿Sigues algún régimen especial? El menú se adaptará"
                      actions={
                        <button onClick={() => { setProfileWizardStep(2); setProfileModalTab('dieta'); setEditProfile({ ...profile, allergies: Array.isArray(profile.allergies) ? profile.allergies : [], dislikedFoods: profile.dislikedFoods || '' }); setEditWeight(profile.weight > 0 ? profile.weight.toString() : ''); setDismissedSuggestions([]); setIsGoalModalOpen(true); }} className={`text-xs font-bold ${themeStyles.accent} shrink-0 hover:underline`}>Indicar dieta</button>
                      }
                      onDismiss={() => dismissPrompt('add_diet_type')}
                    />
                  </motion.div>
                )}

                {/* Invalidation banner */}
                {menuNeedsRegeneration && generatedMenu && profile.age !== 0 && (
                  <AppBanner
                    variant="error"
                    theme={profile.theme}
                    title="Tu perfil ha cambiado"
                    message="El menú puede no reflejar tus nuevos datos."
                    actions={
                      <button
                        disabled={isAIGenerating || menuCooldown.isActive || isGeneratingMenu}
                        onClick={() => { menuCooldown.start(); handleGenerateMenu(profile, goals, profile.weight > 0 ? profile.weight : 70); }}
                        className="shrink-0 px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isGeneratingMenu ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Regenerar ahora'}
                      </button>
                    }
                  />
                )}

              {profile.age === 0 ? (
                <div className={`${themeStyles.bento} text-center`}>
                  <UserIcon className={`w-12 h-12 ${themeStyles.accent} mx-auto mb-4 opacity-50`} />
                  <h3 className={`text-xl font-display font-bold ${themeStyles.textMain} mb-2`}>Configura tu Perfil</h3>
                  <p className={`${themeStyles.textMuted} text-sm mb-6`}>Introduce tu edad, peso y altura en la configuración para calcular tus macros y recibir un plan personalizado.</p>
                  <button 
                    onClick={() => { 
                      setEditProfile({
                        ...profile,
                        allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
                        dislikedFoods: profile.dislikedFoods || ''
                      });
                      setEditWeight(profile.weight > 0 ? profile.weight.toString() : '');
                      setDismissedSuggestions([]);
                      setProfileModalTab('dieta');
                setIsGoalModalOpen(true);
                    }}
                    className={themeStyles.buttonPrimary + " px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-sm"}
                  >
                    Configurar ahora
                  </button>
                </div>
              ) : (
                <>
                  <div className={`${themeStyles.bento}`}>
                    {isGeneratingMenu ? (
                      <div className={`${themeStyles.card} p-12 text-center`}>
                        <div className="relative w-20 h-20 mx-auto mb-6">
                          <motion.div
                            className={`absolute inset-0 rounded-2xl ${themeStyles.accentMuted}`}
                            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.2, 0.5] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Utensils className={`w-8 h-8 ${themeStyles.accent}`} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className={`${themeStyles.textMain} font-bold`}>Diseñando el plan de {profile.name || 'Usuario'}...</p>
                          <AnimatePresence mode="wait">
                            <motion.p
                              key={progressMsgIdx}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.4 }}
                              className={`${themeStyles.textMuted} text-xs font-mono`}
                            >
                              {PROGRESS_MSGS[progressMsgIdx]}
                            </motion.p>
                          </AnimatePresence>
                        </div>
                      </div>
                    ) : generatedMenu ? (
                      <div className="space-y-4">
                        {/* Compact header */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Utensils className={`w-4 h-4 ${themeStyles.accent} shrink-0`} />
                            <span className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-widest flex-1 min-w-0 truncate`}>
                              Menú Semanal · {generatedMenu.days?.length || 0} días
                            </span>
                            <button
                              disabled={isAIGenerating || menuCooldown.isActive || isGeneratingMenu}
                              onClick={() => { menuCooldown.start(); handleGenerateMenu(profile, goals, profile.weight > 0 ? profile.weight : 70); }}
                              className={`shrink-0 p-1.5 rounded-lg ${themeStyles.iconBg} border ${themeStyles.border} ${themeStyles.textMuted} transition-all disabled:opacity-50`}
                              title={menuCooldown.isActive ? `Espera ${menuCooldown.remaining}s` : 'Regenerar menú'}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${menuCooldown.isActive ? 'animate-spin' : ''}`} />
                            </button>
                          </div>
                          <p className={`text-xs ${themeStyles.textMuted} font-semibold pl-6`}>
                            {profile.goal === 'lose' ? 'Perder grasa' : profile.goal === 'gain' ? 'Ganar músculo' : 'Mantenimiento'}
                          </p>
                          <p className={`text-xs ${themeStyles.textMuted} flex items-center gap-1.5 pl-6`}>
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            {menuTimeHint}
                          </p>
                        </div>

                        {/* Day tabs */}
                        <div ref={menuTabsRef} className="flex overflow-x-auto gap-2 pb-1 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                          {generatedMenu.days.map((day: any, dIdx: number) => {
                            const hasFreeDay = (day.meals || []).some((m: any) => m.description === 'COMIDA LIBRE');
                            return (
                              <button
                                key={dIdx}
                                onClick={() => { setMenuSelectedDay(dIdx); setExpandedMeal(0); }}
                                className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs uppercase font-bold tracking-widest transition-all ${
                                  menuSelectedDay === dIdx
                                    ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md`
                                    : `border ${themeStyles.accentBorder} ${themeStyles.accent} ${themeStyles.iconBg}`
                                }`}
                              >
                                {(day.day || `Día ${dIdx + 1}`).slice(0, 3).toUpperCase()}{hasFreeDay ? ' 🍕' : ''}
                              </button>
                            );
                          })}
                        </div>

                        {/* Selected day */}
                        {generatedMenu.days[menuSelectedDay] && (() => {
                          const selDay = generatedMenu.days[menuSelectedDay];
                          const selMeals = selDay.meals || [];
                          const sumKcal = selMeals.reduce((s: number, m: any) => s + (m.calories ?? 0), 0);
                          const sumProt = selMeals.reduce((s: number, m: any) => s + (m.proteinas ?? 0), 0);
                          const sumCarbs = selMeals.reduce((s: number, m: any) => s + (m.carbohidratos ?? 0), 0);
                          const sumFat = selMeals.reduce((s: number, m: any) => s + (m.grasas ?? 0), 0);
                          const dispKcal = sumKcal > 0 ? sumKcal : (selDay.calorias ?? '—');
                          const dispProt = sumProt > 0 ? sumProt : (selDay.proteinas ?? '—');
                          const dispCarbs = sumCarbs > 0 ? sumCarbs : (selDay.carbohidratos ?? '—');
                          const dispFat = sumFat > 0 ? sumFat : (selDay.grasas ?? '—');
                          return (
                          <div className={`${themeStyles.card} rounded-2xl overflow-hidden border ${themeStyles.border}`}>
                            {/* Day summary — single line */}
                            <div className={`px-5 py-4 border-b ${themeStyles.border}`}>
                              <p className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-[0.2em] mb-1`}>
                                {selDay.day}
                              </p>
                              <p className={`text-xs ${themeStyles.textMuted} font-bold`}>
                                {typeof dispKcal === 'number' ? dispKcal.toLocaleString('es-ES') : dispKcal} kcal · Proteína:{dispProt}g · Hidratos:{dispCarbs}g · Grasas:{dispFat}g
                              </p>
                            </div>

                            {/* Meal accordion */}
                            <div>
                              {(generatedMenu.days[menuSelectedDay].meals?.length ?? 0) > 0 ? (
                                generatedMenu.days[menuSelectedDay].meals.map((meal: any, mIdx: number) => (
                                  <div key={mIdx} className={`border-b ${themeStyles.border} last:border-b-0`}>
                                    {meal.description === 'COMIDA LIBRE' ? (
                                      <div className="px-5 py-4 bg-emerald-500/10 flex items-center gap-3">
                                        <span className="text-2xl">🍕</span>
                                        <div>
                                          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{meal.type || 'Comida'} · COMIDA LIBRE</p>
                                          <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">¡Disfrútala sin culpa!</p>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => setExpandedMeal(expandedMeal === mIdx ? -1 : mIdx)}
                                          className={`w-full px-5 py-4 flex items-center justify-between text-left transition-colors ${expandedMeal === mIdx ? themeStyles.iconBg : ''}`}
                                        >
                                          <span className={`text-xs font-bold ${themeStyles.textMain} uppercase tracking-wider`}>
                                            {meal.type || '—'}
                                          </span>
                                          <div className="flex items-center gap-3 shrink-0">
                                            <span className={`text-xs font-bold ${themeStyles.accent}`}>{meal.calories ?? '—'} kcal</span>
                                            <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} transition-transform duration-200 ${expandedMeal === mIdx ? 'rotate-0' : '-rotate-90'}`} />
                                          </div>
                                        </button>
                                        {expandedMeal === mIdx && (
                                          <div className={`px-5 pb-5 space-y-2 ${themeStyles.iconBg}`}>
                                            {meal.description && (
                                              <p className={`text-sm font-semibold ${themeStyles.textMain}`}>{meal.description}</p>
                                            )}
                                            {meal.ingredientes && (
                                              <p className={`text-xs ${themeStyles.textMuted} leading-relaxed`}>{meal.ingredientes}</p>
                                            )}
                                            {(meal.proteinas != null || meal.carbohidratos != null || meal.grasas != null) && (
                                              <div className="flex gap-3 pt-1 flex-wrap">
                                                <span className={`text-xs font-bold ${themeStyles.accent}`}>Proteína {meal.proteinas ?? '—'}g</span>
                                                <span className={`text-xs ${themeStyles.textMuted}`}>·</span>
                                                <span className={`text-xs font-bold ${themeStyles.accent}`}>Hidratos {meal.carbohidratos ?? '—'}g</span>
                                                <span className={`text-xs ${themeStyles.textMuted}`}>·</span>
                                                <span className={`text-xs font-bold ${themeStyles.accent}`}>Grasas {meal.grasas ?? '—'}g</span>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                ))
                              ) : (
                                <div className={`px-5 py-8 text-center ${themeStyles.textMuted} text-xs`}>Sin datos</div>
                              )}
                            </div>
                          </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`${themeStyles.iconBg} rounded-2xl border ${themeStyles.border} border-dashed p-8 space-y-5 text-center`}>
                        <div className={`w-14 h-14 mx-auto rounded-2xl ${themeStyles.accentMuted} border ${themeStyles.accentBorder} flex items-center justify-center`}>
                          <ChefHat className={`w-7 h-7 ${themeStyles.accent}`} />
                        </div>
                        <div className="space-y-1.5">
                          <p className={`${themeStyles.textMain} font-bold text-sm`}>Sin menú esta semana</p>
                          <p className={`${themeStyles.textMuted} text-xs leading-relaxed max-w-xs mx-auto`}>
                            Genera un plan adaptado a tus {Math.round(goals.calories)} kcal diarias.
                            Cuanto más completo sea tu perfil, más preciso será el menú.
                          </p>
                        </div>
                        <button
                          disabled={isAIGenerating || menuCooldown.isActive || isGeneratingMenu}
                          onClick={() => { menuCooldown.start(); handleGenerateMenu(profile, goals, profile.weight > 0 ? profile.weight : 70); }}
                          className={`${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} font-bold uppercase tracking-widest px-8 py-3 rounded-xl transition-all shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 text-sm`}
                        >
                          {menuCooldown.isActive ? `Espera ${menuCooldown.remaining}s` : 'Generar menú semanal'}
                        </button>
                        <p className={`text-xs ${themeStyles.textMuted} opacity-50`}>
                          Completa altura, tipo de dieta o preferencias en tu perfil para mayor precisión
                        </p>
                      </motion.div>
                    )}
                  </div>
                </>
              )}
              </div>

              {/* Shopping List section — always visible below plan */}
              {generatedMenu && (
              <div className="space-y-6">
                 {/* Unified Shopping List Section */}
                 <div className={`${themeStyles.card} rounded-2xl p-5 md:p-6 space-y-6`}>
                   <div className="flex items-center gap-4">
                     <div className={`w-12 h-12 rounded-2xl ${themeStyles.accentMuted} border ${themeStyles.accentBorder} flex items-center justify-center`}>
                       <ShoppingCart className={`w-6 h-6 ${themeStyles.accent}`} />
                     </div>
                     <div className="flex-1">
                       <div className="flex items-center justify-between">
                         <h2 className={`text-xl font-bold ${themeStyles.textMain}`}>Lista de la Compra</h2>
                         {generatedMenu && (
                           <button
                             onClick={() => { shoppingCooldown.start(); handleGenerateShoppingList(); }}
                             disabled={shoppingCooldown.isActive || isGeneratingShoppingList}
                             className={`p-2 rounded-xl transition-colors disabled:opacity-50 ${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.textMain}`}
                             title="Regenerar lista de la compra"
                           >
                             {shoppingCooldown.isActive
                               ? <span className="text-xs font-mono font-bold w-4 text-center block">{shoppingCooldown.remaining}s</span>
                               : <RefreshCw className={`w-4 h-4 ${isGeneratingShoppingList ? 'animate-spin' : ''}`} />}
                           </button>
                         )}
                       </div>
                       <p className={`${themeStyles.textMuted} text-sm`}>Lista de ingredientes necesarios</p>
                     </div>
                   </div>

                   {isGeneratingShoppingList ? (
                     <div className="text-center py-12">
                       <div className="relative w-20 h-20 mx-auto mb-6">
                         <motion.div
                           className={`absolute inset-0 rounded-2xl ${themeStyles.accentMuted}`}
                           animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.2, 0.5] }}
                           transition={{ repeat: Infinity, duration: 2 }}
                         />
                         <div className="absolute inset-0 flex items-center justify-center">
                           <ShoppingCart className={`w-8 h-8 ${themeStyles.accent}`} />
                         </div>
                       </div>
                       <div className="space-y-2">
                         <p className={`${themeStyles.textMain} font-bold`}>
                           Analizando tu menú...
                         </p>
                         <motion.div 
                           className={`${themeStyles.textMuted} text-xs font-mono h-4`}
                           animate={{ opacity: [0, 1, 0] }}
                           transition={{ repeat: Infinity, duration: 1.5 }}
                         >
                           {`> Generando lista de la compra...`}
                         </motion.div>
                       </div>
                     </div>
                   ) : !shoppingList ? (
                     <div className={`text-center py-8 ${themeStyles.iconBg} rounded-2xl border ${themeStyles.border}`}>
                       <ShoppingCart className={`w-8 h-8 ${themeStyles.textMuted} mx-auto mb-4`} />
                       <p className={`${themeStyles.textMain} font-bold mb-2`}>Sin Lista de la Compra</p>
                       <p className={`${themeStyles.textMuted} text-xs uppercase font-bold tracking-widest px-4 mb-6`}>
                         Extrae los ingredientes del menú y genera tu lista de la compra semanal
                       </p>
                       <button
                         onClick={() => { shoppingCooldown.start(); handleGenerateShoppingList(); }}
                         disabled={!generatedMenu || shoppingCooldown.isActive}
                         className={`${themeStyles.buttonPrimary} px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-xs mx-auto flex items-center gap-2 disabled:opacity-50`}
                       >
                         <ShoppingCart className="w-4 h-4" />
                         {shoppingCooldown.isActive ? `Espera ${shoppingCooldown.remaining}s` : 'Generar Lista'}
                       </button>
                     </div>
                   ) : shoppingList.categories.length === 0 ? (
                     <div className={`text-center py-8 ${themeStyles.iconBg} rounded-2xl border ${themeStyles.border}`}>
                       <Info className={`w-8 h-8 ${themeStyles.textMuted} mx-auto mb-2`} />
                       <p className={`${themeStyles.textMuted} text-sm`}>No se han podido detectar ingredientes.</p>
                       <p className={`${themeStyles.textMuted} text-xs mt-1 opacity-80`}>Intenta generar el menú de nuevo.</p>
                     </div>
                   ) : (
                     <div className="space-y-6">
                       <div className={`${themeStyles.accentMuted} border ${themeStyles.accentBorder} rounded-2xl p-6 text-center`}>
                         <p className={`${themeStyles.accent} text-sm font-bold mb-1 uppercase tracking-widest`}>¡Lista generada con éxito!</p>
                         <p className={`${themeStyles.textMuted} text-xs mb-6`}>Lista de ingredientes para toda la semana. Puedes marcar los productos mientras compras.</p>
                         
                         <div className="space-y-4">
                           <p className={`${themeStyles.textMuted} text-xs uppercase font-bold tracking-widest text-center`}>
                             Puedes ir marcando los productos mientras compras
                           </p>
                           <div className="flex flex-col gap-3">
                             <button
                               type="button"
                               onClick={(e) => {
                                 e.preventDefault();
                                 downloadShoppingListHTML();
                               }}
                               className={`w-full flex items-center justify-center gap-2 p-4 rounded-xl ${themeStyles.buttonPrimary} font-bold text-xs uppercase tracking-widest`}
                             >
                               <CheckSquare className="w-4 h-4" />
                               Ver Lista
                             </button>
                           </div>
                         </div>
                       </div>
                     </div>
                   )}
                 </div>
                 </div>
              )}
            </motion.div>
          )}

          {/* ── GYM SECTION ── */}
          {activeSection === 'gym' && !profile.gymEnabled && !dismissedPrompts.includes('add_gym_goal') && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
              <AppBanner
                variant="info"
                theme={profile.theme}
                icon={<Info className="w-4 h-4" />}
                message="Configura tu entrenamiento para un plan personalizado"
                actions={
                  <button onClick={() => { setProfileWizardStep(3); setProfileModalTab('entrenamiento'); setEditProfile({ ...profile, allergies: Array.isArray(profile.allergies) ? profile.allergies : [], dislikedFoods: profile.dislikedFoods || '' }); setEditWeight(profile.weight > 0 ? profile.weight.toString() : ''); setDismissedSuggestions([]); setIsGoalModalOpen(true); }} className={`text-xs font-bold ${themeStyles.accent} shrink-0 hover:underline`}>Configurar rutina</button>
                }
                onDismiss={() => dismissPrompt('add_gym_goal')}
              />
            </motion.div>
          )}

          {activeSection === 'gym' && (
            <motion.div
              key="gym"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 pb-24"
            >
              {/* Time-of-day gym hint — plain text, no card */}
              <p className={`text-xs ${themeStyles.textMuted} flex items-center gap-1.5`}>
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {gymTimeHint}
              </p>

              {/* Workout Content */}
              <div className="space-y-6">
                {/* Subtab switcher — only when both modes are active */}
                {profile.gymMode === 'both' && workoutPlan && !isGeneratingWorkout && (
                  <div className={`grid grid-cols-2 gap-1.5 ${themeStyles.iconBg} p-1 rounded-xl border ${themeStyles.border} w-full`}>
                    {[
                      { id: 'manual', label: 'Manual', icon: Plus },
                      { id: 'plan', label: 'Plan', icon: Activity }
                    ].map((st) => (
                      <button
                        key={st.id}
                        onClick={() => setGymSubTab(st.id as any)}
                        className={`py-3 text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${
                          gymSubTab === st.id
                            ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md`
                            : `${themeStyles.textMuted} hover:text-current`
                        }`}
                      >
                        <st.icon className="w-4 h-4" />
                        {st.label}
                        {st.id === 'plan' && workoutNeedsRegeneration && (
                          <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {isGeneratingWorkout ? (
                  <div className={`${themeStyles.bento} p-16 text-center border ${themeStyles.border}`}>
                    <div className="relative w-24 h-24 mx-auto mb-8">
                      <motion.div
                        className={`absolute inset-0 rounded-2xl ${themeStyles.accentMuted}`}
                        animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.2, 0.6] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Dumbbell className={`w-10 h-10 ${themeStyles.accent}`} />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <p className={`text-xl ${themeStyles.textMain} font-bold tracking-tight`}>Tu experto AI está diseñando la rutina...</p>
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={workoutProgressMsg}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className={`${themeStyles.textMuted} text-xs font-mono uppercase tracking-[0.2em]`}
                        >
                          {`> ${workoutProgressMsg || `Programando microciclo de ${profile.trainingDaysPerWeek || 3} días...`}`}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>
                ) : ((workoutPlan && workoutPlan.length > 50) || profile.gymMode === 'manual') ? (
                  <>
                    <motion.div
                      key={gymSubTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    {(profile.gymMode === 'plan' || (profile.gymMode === 'both' && gymSubTab === 'plan')) ? (
                      <div className="space-y-6">
                        {/* Invalidation banner */}
                        {workoutNeedsRegeneration && (
                          <AppBanner
                            variant="error"
                            theme={profile.theme}
                            title={workoutPlan ? 'Tu perfil ha cambiado' : 'Rutina pendiente de generar'}
                            message={workoutPlan ? 'La rutina puede no reflejar tus nuevos datos.' : 'Genera tu rutina personalizada con el perfil actual.'}
                            actions={
                              <button
                                disabled={isAIGenerating || isGeneratingWorkout || workoutCooldown.isActive}
                                onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                                className="shrink-0 px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isGeneratingWorkout ? <Loader2 className="w-3 h-3 animate-spin" /> : workoutPlan ? 'Regenerar ahora' : 'Generar ahora'}
                              </button>
                            }
                          />
                        )}

                        {/* Compact Gym Header — single line */}
                        <div className="flex items-center gap-2">
                          <Dumbbell className={`w-4 h-4 ${themeStyles.accent} shrink-0`} />
                          <span className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-widest flex-1 min-w-0 truncate`}>
                            Tu Rutina · {profile.trainingDaysPerWeek}d · {translateGymGoal(profile.gymGoal)}
                          </span>
                          <button
                            onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                            disabled={isAIGenerating || isGeneratingWorkout || workoutCooldown.isActive}
                            className={`shrink-0 p-1.5 rounded-lg ${themeStyles.iconBg} border ${themeStyles.border} ${themeStyles.textMuted} transition-all disabled:opacity-40`}
                            title={workoutCooldown.isActive ? `${workoutCooldown.remaining}s` : 'Regenerar'}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingWorkout || workoutCooldown.isActive ? 'animate-spin' : ''}`} />
                          </button>
                        </div>

                        {/* Info del programa — collapsible */}
                        {getWorkoutSection(workoutPlan, 'info').trim() && (
                          <div className={`${themeStyles.bento} overflow-hidden`}>
                            <button
                              onClick={() => setGymInfoExpanded(v => !v)}
                              className="w-full flex items-center gap-2 px-4 py-3 text-left"
                            >
                              <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${gymInfoExpanded ? 'rotate-180' : ''}`} />
                              <span className={`text-xs font-black uppercase tracking-[0.2em] ${themeStyles.textMain} flex-1`}>Info del programa</span>
                            </button>
                            <AnimatePresence initial={false}>
                              {gymInfoExpanded && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                  <div className={`px-4 pb-4 prose max-w-none text-left ${profile.theme === 'light' ? 'prose-slate prose-h2:text-emerald-500 prose-h3:text-emerald-600' : 'prose-invert prose-zinc prose-h2:text-lime-400 prose-h3:text-lime-300'} prose-headings:font-display prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter prose-h2:text-xl prose-h3:text-sm prose-strong:font-black prose-p:text-sm prose-p:leading-relaxed prose-li:text-sm`}>
                                    <Markdown remarkPlugins={[remarkGfm]}>{getWorkoutSection(workoutPlan, 'info')}</Markdown>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {/* Daily routines logic — always shown */}
                        {(() => {
                          const ejerciciosContent = getWorkoutSection(workoutPlan, 'exercises');
                          const parsedDays = ejerciciosContent
                            .split(/\n(?=# DÍA \d+)/i)
                            .filter(chunk => /^# DÍA \d+/i.test(chunk.trim()))
                            .map(chunk => {
                              const trimmed = chunk.trim();
                              const firstLine = trimmed.split('\n')[0];
                              const dayNum = parseInt(firstLine.match(/\d+/)?.[0] ?? '1');
                              const focus = firstLine.replace(/^# DÍA \d+\s*[—–-]\s*/i, '').trim();
                              return { dayNumber: dayNum, focus, fullText: trimmed };
                            });

                          if (parsedDays.length === 0) {
                            return (
                              <div className={`${themeStyles.bento} p-10 text-center space-y-4 border ${themeStyles.border}`}>
                                <div className={`w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto border ${themeStyles.border}`}>
                                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                                </div>
                                <h4 className={`text-sm font-bold uppercase tracking-widest ${themeStyles.textMain}`}>Plan no procesable</h4>
                                <p className={`text-xs ${themeStyles.textMuted} max-w-xs mx-auto leading-relaxed font-medium`}>
                                  El plan generado no sigue el formato esperado. Intenta regenerarlo.
                                </p>
                                <button
                                  onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                                  disabled={workoutCooldown.isActive}
                                  className={`mt-4 px-8 py-3 rounded-xl ${themeStyles.accentBg} text-zinc-950 text-xs font-bold uppercase tracking-widest shadow-lg disabled:opacity-50`}
                                >
                                  {workoutCooldown.isActive ? `Espera ${workoutCooldown.remaining}s` : 'Reintentar Generación'}
                                </button>
                              </div>
                            );
                          }

                          const activeDay = parsedDays.find(d => `Día ${d.dayNumber}` === gymDay) || parsedDays[0];
                          const dayLabel = `Día ${activeDay.dayNumber}`;
                          const currentDayDate = gymRoutineDates[dayLabel] || todayStr;

                          return (
                            <div className="space-y-6">
                              {/* Daily Tabs Selector — sticky below nav */}
                              <div className={`sticky top-[62px] z-10 -mx-6 px-6 pt-2 pb-3 ${profile.theme === 'light' ? 'bg-slate-50/95' : 'bg-zinc-950/95'} backdrop-blur-xl border-b ${themeStyles.border}`}>
                              <div className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth max-w-md mx-auto">
                                {parsedDays.map((d) => (
                                  <button
                                    key={d.dayNumber}
                                    onClick={() => setGymDay(`Día ${d.dayNumber}`)}
                                    className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap min-w-[80px] border-solid ${
                                      gymDay === `Día ${d.dayNumber}`
                                        ? `${themeStyles.buttonPrimary} scale-105`
                                        : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted}`
                                    }`}
                                  >
                                    {`Día ${d.dayNumber}`}
                                  </button>
                                ))}
                              </div>
                              </div>

                              {/* Day Detail Content */}
                              <motion.div
                                key={gymDay}
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`${themeStyles.bento} p-4 md:p-5 shadow-2xl space-y-8 relative overflow-hidden`}
                              >
                                <div className={`absolute top-0 right-0 w-32 h-32 ${themeStyles.accentMuted} opacity-20 rounded-full blur-2xl mr-[-10%] mt-[-10%]`} />

                                <div className="relative z-10 space-y-6">
                                  <div className="flex flex-col gap-1">
                                    <div className={`flex items-center gap-1.5 text-xs font-bold ${themeStyles.accent} uppercase tracking-[0.2em] mb-1`}>
                                      <Activity className="w-3 h-3" />
                                      <span>Bloque de entrenamiento</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className={`w-1 h-5 ${themeStyles.accentBg} rounded-full`} />
                                      <div className={`flex items-center gap-2 ${themeStyles.textMain} font-display font-black text-lg uppercase tracking-tighter`}>
                                        <span className={themeStyles.accent}>{dayLabel}</span>
                                        <span className="opacity-20">/</span>
                                        <div className="relative inline-block border-b-2 border-dotted border-current opacity-70 hover:opacity-100 transition-opacity">
                                          <input
                                            type="date"
                                            value={gymRoutineDates[dayLabel] || todayStr}
                                            onChange={(e) => handleGymDayDateChange(dayLabel, e.target.value)}
                                            className="bg-transparent text-current border-none focus:ring-0 p-0 cursor-pointer appearance-none text-sm font-black"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleToggleGymDay(dayLabel)}
                                      className={`mt-2 flex items-center gap-2 px-6 py-3 rounded-xl border font-bold uppercase tracking-widest text-xs transition-all w-full md:w-auto justify-center ${
                                        gymDayDone[dayLabel]
                                          ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} border-transparent shadow-lg`
                                          : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.accent}`
                                      }`}
                                    >
                                      <CheckCircle2 className="w-4 h-4" />
                                      {gymDayDone[dayLabel] ? 'Rutina Completada' : 'Marcar Rutina como Hecha'}
                                    </button>
                                  </div>

                                  <div className="space-y-1 text-left">
                                    <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-[0.2em] pl-1`}>Foco de la sesión</span>
                                    <h4 className={`text-sm font-display font-black ${themeStyles.textMain} uppercase tracking-tight`}>{activeDay.focus}</h4>
                                  </div>

                                  <div className={`h-px w-full ${themeStyles.border} shadow-sm`} />
                                </div>

                                {(() => {
                                  const dayContent = activeDay.fullText.split('\n').slice(1).join('\n').trim();
                                  return (
                                <div className={`prose ${profile.theme === 'light' ? 'prose-slate' : 'prose-invert'} max-w-none
                                  prose-headings:font-display prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter
                                  prose-h1:hidden prose-h3:hidden
                                  prose-strong:${themeStyles.accent} prose-strong:font-black
                                  prose-p:text-sm prose-p:leading-relaxed text-left
                                  prose-li:text-sm prose-li:my-1
                                `}>
                                  <Markdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      h3: () => null,
                                      h4: () => null,
                                      table: ({node, ...props}) => {
                                        const tableContent = node?.position ? dayContent.substring(node.position.start.offset, node.position.end.offset) : '';
                                        const tableId = `table-${node?.position?.start.offset || 0}`;

                                        const textBeforeTable = dayContent.substring(0, node?.position?.start.offset || 0);
                                        const allH3 = [...textBeforeTable.matchAll(/###?\s*([^\n]+)/g)];
                                        const lastH3 = allH3.pop();
                                        const boldMatch = textBeforeTable.match(/\*\*([^\*]+)\*\*\s*\n\s*$/);
                                        const sectionTitleRaw = lastH3 ? lastH3[1].trim() : boldMatch ? boldMatch[1].trim() : 'Ejercicios';
                                        let sectionTitle = sectionTitleRaw;
                                        if (sectionTitleRaw.toLowerCase().includes('calentamiento')) sectionTitle = 'Calentamiento';
                                        else if (sectionTitleRaw.toLowerCase().includes('principal')) sectionTitle = 'Parte Principal';
                                        else if (sectionTitleRaw.toLowerCase().includes('calma')) sectionTitle = 'Vuelta a la calma';

                                        const isTableCompleted = habits[currentDayDate]?.completedExercises?.includes(tableId);

                                        const isOpen = expandedExSection === sectionTitle;
                                        const isDone = isTableCompleted || gymDayDone[dayLabel];

                                        return (
                                          <div className="my-4 relative">
                                            {/* Accordion header */}
                                            <button
                                              onClick={() => setExpandedExSection(isOpen ? null : sectionTitle)}
                                              className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-colors ${isOpen ? '' : `hover:${themeStyles.iconBg}`}`}
                                            >
                                              <div className={`w-1 h-5 ${isDone ? themeStyles.accentBg : 'bg-zinc-500'} rounded-full shrink-0`} />
                                              <h5 className={`flex-1 text-xs font-bold uppercase tracking-widest text-left ${isDone ? themeStyles.accent : themeStyles.textMain}`}>{sectionTitle}</h5>
                                              <ChevronDown className={`w-3.5 h-3.5 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                            </button>

                                            {/* Accordion body */}
                                            <AnimatePresence initial={false}>
                                              {isOpen && (
                                                <motion.div
                                                  initial={{ height: 0, opacity: 0 }}
                                                  animate={{ height: 'auto', opacity: 1 }}
                                                  exit={{ height: 0, opacity: 0 }}
                                                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                                                  className="overflow-hidden"
                                                >
                                                  <div className={`overflow-x-auto rounded-2xl border ${themeStyles.border} ${profile.theme === 'light' ? 'bg-slate-50 shadow-inner' : 'bg-zinc-950/30'} shadow-sm mt-2 ${gymDayDone[dayLabel] ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                                                    <table {...props} className="w-full text-left border-collapse" />
                                                  </div>
                                                </motion.div>
                                              )}
                                            </AnimatePresence>
                                          </div>
                                        );
                                      },
                                      thead: ({node, ...props}) => <thead {...props} className={`${profile.theme === 'light' ? 'bg-slate-100' : 'bg-white/5'} border-b ${themeStyles.border}`} />,
                                      th: ({node, ...props}) => <th {...props} className={`px-3 py-2.5 text-left text-xs font-bold uppercase tracking-widest ${themeStyles.textMuted} border-b ${themeStyles.border} first:${themeStyles.textMain} first:min-w-[100px]`} />,
                                      td: ({node, ...props}) => <td {...props} className={`px-3 py-2.5 ${themeStyles.textMuted} border-b ${themeStyles.border} text-xs font-medium first:${themeStyles.textMain} first:font-bold`} />,
                                      a: ({node, ...props}) => (
                                        <a {...props} className={`inline-flex items-center gap-2 ${themeStyles.accent} font-bold hover:${themeStyles.textMain} transition-colors`} target="_blank" rel="noopener noreferrer">
                                          {props.children}
                                          <Camera className="w-4 h-4 opacity-50" />
                                        </a>
                                      )
                                    }}
                                  >
                                    {dayContent}
                                  </Markdown>
                                </div>
                                  );
                                })()}

                                {/* RPE inline note */}
                                <p className={`pt-4 text-[10px] ${themeStyles.textMuted} text-center border-t ${themeStyles.border}`}>
                                  RPE = escala de esfuerzo del 1 al 10
                                </p>
                              </motion.div>
                            </div>

                          );
                        })()}

                        {/* Tips del día — collapsible, outside day IIFE */}
                        {workoutPlan && getWorkoutSection(workoutPlan, 'safety').trim() && (
                          <div className={`${themeStyles.bento} overflow-hidden`}>
                            <button
                              onClick={() => setGymTipsExpanded(v => !v)}
                              className="w-full flex items-center gap-2 px-4 py-3 text-left"
                            >
                              <ChevronDown className={`w-4 h-4 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${gymTipsExpanded ? 'rotate-180' : ''}`} />
                              <span className={`text-xs font-black uppercase tracking-[0.2em] ${themeStyles.textMain} flex-1`}>💡 Tips del día</span>
                            </button>
                            <AnimatePresence initial={false}>
                              {gymTipsExpanded && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                  <div className={`px-4 pb-4 prose max-w-none text-left ${profile.theme === 'light' ? 'prose-slate prose-h2:text-emerald-500 prose-h3:text-emerald-600' : 'prose-invert prose-zinc prose-h2:text-lime-400 prose-h3:text-lime-300'} prose-headings:font-display prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter prose-h2:text-xl prose-h3:text-sm prose-strong:font-black prose-p:text-sm prose-p:leading-relaxed prose-li:text-sm`}>
                                    <Markdown remarkPlugins={[remarkGfm]}>{getWorkoutSection(workoutPlan, 'safety')}</Markdown>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                      </div>
                    ) : (profile.gymMode === 'manual' || (profile.gymMode === 'both' && gymSubTab === 'manual')) ? (
                      <div className="space-y-3">
                        {/* Compact header */}
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-widest flex-1 min-w-0`}>
                            💪 Entrenamiento Libre
                          </span>
                          {!manualFormExpanded && (
                            <button
                              onClick={() => { setManualFormExpanded(true); setEditingWorkoutId(null); setManualWorkoutMinutes('45'); setManualWorkoutCaloriesOverride(''); }}
                              className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg ${themeStyles.iconBg} border ${themeStyles.border} text-xs font-bold ${themeStyles.accent} uppercase tracking-widest transition-all`}
                            >
                              <Plus className="w-3 h-3" /> Añadir
                            </button>
                          )}
                        </div>

                        {/* Form — collapsible */}
                        <AnimatePresence initial={false}>
                          {manualFormExpanded && (() => {
                            const weightKg = profile.weight > 0 ? profile.weight : 70;
                            const mins = parseFloat(manualWorkoutMinutes) || 0;
                            const metKcal = mins > 0 ? calculateMETCalories(manualWorkoutActivity, manualWorkoutIntensidad, mins, weightKg) : 0;
                            const finalKcal = manualWorkoutCaloriesOverride !== '' ? (parseInt(manualWorkoutCaloriesOverride) || 0) : metKcal;

                            const handleSave = (e: React.FormEvent) => {
                              e.preventDefault();
                              if (mins <= 0) return;
                              const entry: ManualWorkoutEntry = {
                                id: editingWorkoutId ?? String(Date.now()),
                                activity: manualWorkoutActivity,
                                intensidad: manualWorkoutIntensidad,
                                durationMinutes: mins,
                                caloriesBurned: finalKcal,
                              };
                              const prevDay = habits[manualWorkoutDate] || { water: 0, sleep: 0 };
                              const prevList: ManualWorkoutEntry[] = prevDay.manualWorkouts
                                ? [...prevDay.manualWorkouts]
                                : prevDay.manualWorkout ? [prevDay.manualWorkout as ManualWorkoutEntry] : [];
                              const updatedList = editingWorkoutId
                                ? prevList.map(w => w.id === editingWorkoutId ? entry : w)
                                : [...prevList, entry];
                              const updatedDay = { ...prevDay, manualWorkouts: updatedList };
                              delete (updatedDay as any).manualWorkout;
                              const newHabits = { ...habits, [manualWorkoutDate]: updatedDay };
                              setHabits(newHabits);
                              if (user) setDoc(doc(db, 'users', user.uid, 'habits', manualWorkoutDate), updatedDay).catch(console.error);
                              setManualWorkoutMinutes('45');
                              setManualWorkoutCaloriesOverride('');
                              setEditingWorkoutId(null);
                              setManualFormExpanded(false);
                              showSuccess(`${manualWorkoutActivity} guardado — ${finalKcal} kcal`);
                            };

                            return (
                              <motion.div
                                key="manual-form"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <form onSubmit={handleSave} className={`${themeStyles.bento} space-y-4`}>
                                  {/* Fecha */}
                                  <div className="space-y-1.5">
                                    <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Fecha</label>
                                    <input type="date" value={manualWorkoutDate} onChange={e => setManualWorkoutDate(e.target.value)}
                                      className={`w-full ${themeStyles.iconBg} rounded-xl px-4 py-2.5 text-sm focus:outline-none border ${themeStyles.border}`} required />
                                  </div>
                                  {/* Actividad | Duración — 2-col grid */}
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                      <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Actividad</label>
                                      <select value={manualWorkoutActivity} onChange={e => { setManualWorkoutActivity(e.target.value); setManualWorkoutCaloriesOverride(''); }}
                                        className={`w-full ${themeStyles.iconBg} rounded-xl px-3 py-2.5 text-xs focus:outline-none border ${themeStyles.border} cursor-pointer`}>
                                        {ACTIVITY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Duración (min)</label>
                                      <div className="relative">
                                        <input type="number" placeholder="45" min="5" max="300" value={manualWorkoutMinutes}
                                          onChange={e => { setManualWorkoutMinutes(e.target.value); setManualWorkoutCaloriesOverride(''); }}
                                          className={`w-full ${themeStyles.iconBg} rounded-xl px-3 py-2.5 pr-10 text-xs focus:outline-none border ${themeStyles.border}`} required />
                                        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold ${themeStyles.textMuted} pointer-events-none`}>min</span>
                                      </div>
                                    </div>
                                  </div>
                                  {/* Intensidad */}
                                  <div className="space-y-1.5">
                                    <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Intensidad</label>
                                    <div className={`grid grid-cols-3 gap-2 ${themeStyles.iconBg} p-1 rounded-2xl border ${themeStyles.border}`}>
                                      {(['suave', 'moderada', 'intensa'] as const).map(level => (
                                        <button key={level} type="button"
                                          onClick={() => { setManualWorkoutIntensidad(level); setManualWorkoutCaloriesOverride(''); }}
                                          className={`py-2 text-xs font-bold uppercase tracking-widest rounded-xl transition-all ${manualWorkoutIntensidad === level ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}>
                                          {level}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  {/* Calorías */}
                                  {mins > 0 && (
                                    <div className={`${themeStyles.iconBg} border ${themeStyles.accentBorder} rounded-2xl p-4 space-y-2`}>
                                      <div className="flex items-center justify-between">
                                        <p className={`text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-[0.2em]`}>Calorías</p>
                                        {manualWorkoutCaloriesOverride !== '' && (
                                          <button type="button" onClick={() => setManualWorkoutCaloriesOverride('')}
                                            className={`text-xs ${themeStyles.textMuted} underline`}>Restaurar estimación</button>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <input
                                          type="number" min="0" max="3000"
                                          value={manualWorkoutCaloriesOverride !== '' ? manualWorkoutCaloriesOverride : metKcal}
                                          onChange={e => setManualWorkoutCaloriesOverride(e.target.value)}
                                          className={`flex-1 bg-transparent text-3xl font-display font-black ${themeStyles.accent} focus:outline-none w-0 text-right`}
                                        />
                                        <span className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider`}>kcal</span>
                                      </div>
                                      <p className={`text-xs ${themeStyles.textMuted} opacity-60`}>
                                        {manualWorkoutCaloriesOverride !== '' ? 'Valor editado manualmente' : `Estimación MET · ${weightKg} kg`}
                                      </p>
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <button type="submit" disabled={!manualWorkoutMinutes || mins <= 0}
                                      className={`${themeStyles.buttonPrimary} flex-1 py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}>
                                      <Plus className="w-3.5 h-3.5" />
                                      {editingWorkoutId ? 'Actualizar' : 'Guardar'}
                                    </button>
                                    <button type="button"
                                      onClick={() => { setManualFormExpanded(false); setEditingWorkoutId(null); setManualWorkoutMinutes('45'); setManualWorkoutCaloriesOverride(''); }}
                                      className={`py-2.5 px-4 rounded-xl text-xs font-bold ${themeStyles.textMuted} border ${themeStyles.border} uppercase tracking-widest transition-all`}>
                                      Cancelar
                                    </button>
                                  </div>
                                </form>
                              </motion.div>
                            );
                          })()}
                        </AnimatePresence>

                        {/* Workout list — collapsible */}
                        {(() => {
                          const todayData = habits[todayStr];
                          const list: ManualWorkoutEntry[] = todayData?.manualWorkouts?.length
                            ? todayData.manualWorkouts
                            : todayData?.manualWorkout ? [todayData.manualWorkout as ManualWorkoutEntry] : [];
                          if (!list.length) return null;
                          const totalKcal = list.reduce((s, w) => s + (w.caloriesBurned ?? 0), 0);
                          return (
                            <div className={`${themeStyles.bento} overflow-hidden`}>
                              <button
                                onClick={() => setManualListExpanded(v => !v)}
                                className="w-full flex items-center gap-2 px-4 py-3 text-left"
                              >
                                <ChevronDown className={`w-3.5 h-3.5 ${themeStyles.textMuted} transition-transform duration-200 shrink-0 ${manualListExpanded ? 'rotate-0' : '-rotate-90'}`} />
                                <span className={`text-xs font-bold ${themeStyles.textMain} uppercase tracking-widest flex-1`}>
                                  Hoy · {list.length} {list.length === 1 ? 'entrenamiento' : 'entrenamientos'} · +{totalKcal} kcal
                                </span>
                              </button>
                              <AnimatePresence initial={false}>
                                {manualListExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className={`px-4 pb-4 space-y-2 border-t ${themeStyles.border}`}>
                                      {list.map((w, idx) => (
                                        <div key={w.id ?? idx} className={`flex items-center gap-2 py-2.5 border-b ${themeStyles.border} last:border-b-0`}>
                                          <span className={`text-xs font-bold ${themeStyles.textMain} flex-1 min-w-0 truncate`}>
                                            {w.activity} · {w.durationMinutes ?? '?'} min · {w.intensidad ?? ''}
                                          </span>
                                          <span className={`text-xs font-bold ${themeStyles.accent} shrink-0`}>+{w.caloriesBurned ?? 0} kcal</span>
                                          <button
                                            onClick={() => {
                                              setEditingWorkoutId(w.id ?? null);
                                              setManualWorkoutActivity(w.activity);
                                              setManualWorkoutIntensidad(w.intensidad ?? 'moderada');
                                              setManualWorkoutMinutes(String(w.durationMinutes ?? 45));
                                              setManualWorkoutCaloriesOverride(String(w.caloriesBurned ?? ''));
                                              setManualWorkoutDate(todayStr);
                                              setManualFormExpanded(true);
                                            }}
                                            className={`shrink-0 p-1.5 rounded-lg ${themeStyles.iconBg} border ${themeStyles.border} ${themeStyles.textMuted} transition-all`}
                                            title="Editar"
                                          >
                                            <Edit2 className="w-3 h-3" />
                                          </button>
                                          <button
                                            onClick={() => {
                                              const prevDay = habits[todayStr] || { water: 0, sleep: 0 };
                                              const prevList: ManualWorkoutEntry[] = prevDay.manualWorkouts
                                                ? [...prevDay.manualWorkouts]
                                                : prevDay.manualWorkout ? [prevDay.manualWorkout as ManualWorkoutEntry] : [];
                                              const updatedList = prevList.filter((_, i) => i !== idx);
                                              const updatedDay = { ...prevDay, manualWorkouts: updatedList };
                                              delete (updatedDay as any).manualWorkout;
                                              const newHabits = { ...habits, [todayStr]: updatedDay };
                                              setHabits(newHabits);
                                              if (user) setDoc(doc(db, 'users', user.uid, 'habits', todayStr), updatedDay).catch(console.error);
                                            }}
                                            className={`shrink-0 p-1.5 rounded-lg ${themeStyles.iconBg} border ${themeStyles.border} ${themeStyles.textMuted} hover:text-rose-500 transition-all`}
                                            title="Eliminar"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                      {!manualFormExpanded && (
                                        <button
                                          onClick={() => { setManualFormExpanded(true); setEditingWorkoutId(null); setManualWorkoutMinutes('45'); setManualWorkoutCaloriesOverride(''); }}
                                          className={`w-full mt-1 py-2 rounded-xl text-xs font-bold ${themeStyles.accent} border ${themeStyles.accentBorder} uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all`}
                                        >
                                          <Plus className="w-3 h-3" /> Añadir otro
                                        </button>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                  </motion.div>
                  </>
                ) : (
                  <div className={`${themeStyles.iconBg} rounded-2xl border ${themeStyles.border} border-dashed p-16 text-center`}>
                    <div className={`w-20 h-20 ${themeStyles.card} rounded-2xl flex items-center justify-center mx-auto mb-8 border ${themeStyles.border}`}>
                      <Dumbbell className={`w-10 h-10 ${themeStyles.textMuted} opacity-40`} />
                    </div>
                    <h3 className={`text-2xl font-display font-black ${themeStyles.textMain} uppercase tracking-tight mb-3`}>No tienes un plan activo</h3>
                    <p className={`${themeStyles.textMuted} text-sm mb-8 max-w-xs mx-auto leading-relaxed`}>Genera tu primera rutina personalizada basada en tu perfil anatómico y objetivos deportivos.</p>
                    <button
                      onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                      disabled={workoutCooldown.isActive}
                      className={`${themeStyles.accentBg} text-zinc-950 font-bold uppercase tracking-widest px-10 py-5 rounded-2xl transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100`}
                    >
                      {workoutCooldown.isActive ? `Espera ${workoutCooldown.remaining}s` : 'Generar Rutina'}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Analyzing Overlay */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-zinc-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6"
          >
            <div className="w-full max-w-sm space-y-8 flex flex-col items-center">
              <div className={`relative w-64 h-64 rounded-2xl overflow-hidden shadow-2xl border ${themeStyles.border} ${themeStyles.iconBg} flex items-center justify-center`}>
                {previewImage ? (
                  <>
                    <img src={previewImage} alt="Preview" className="w-full h-full object-cover opacity-50" />
                    {/* Scanning animation */}
                    <motion.div
                      className={`absolute inset-0 border-t-2 ${themeStyles.accentBorder} ${themeStyles.accentMuted}`}
                      animate={{ y: ["-100%", "100%"] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                    >
                      <Bot className={`w-16 h-16 ${themeStyles.accent}`} />
                    </motion.div>
                  </div>
                )}
              </div>
              
              <div className="text-center space-y-2">
                <div className={`flex items-center justify-center gap-3 ${themeStyles.accent}`}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-display font-bold text-lg">Analizando con IA...</span>
                </div>
                <p className="text-zinc-400 text-sm font-medium">Calculando calorías y macronutrientes</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Goal Modal — wizard (new users) or tabs (returning users) */}
      <AnimatePresence>
        {isGoalModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isWizardMode ? () => setIsGoalModalOpen(false) : undefined}
            className="fixed inset-0 z-[70] bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className={`${themeStyles.card} border ${themeStyles.border} rounded-2xl p-5 w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl`}
            >
              {/* Header */}
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`p-2 ${themeStyles.accentMuted} rounded-xl border ${themeStyles.accentBorder}`}>
                    <UserIcon className={`w-5 h-5 ${themeStyles.accent}`} />
                  </div>
                  <div>
                    <h3 className={`text-lg font-display font-bold ${themeStyles.textMain} uppercase tracking-tight leading-none`}>
                      {!isWizardMode ? 'Editar Perfil' : '¡Bienvenido!'}
                    </h3>
                    {isWizardMode && (
                      <p className={`text-xs ${themeStyles.textMuted} mt-0.5`}>
                        {profileWizardStep === 1 ? 'Paso 1 — Datos personales' : profileWizardStep === 2 ? 'Paso 2 — Menú semanal' : 'Paso 3 — Entrenamiento'}
                      </p>
                    )}
                  </div>
                </div>
                {!isWizardMode && (
                  <button onClick={() => setIsGoalModalOpen(false)} className={`${themeStyles.textMuted} hover:text-red-500 transition-colors p-1`}>
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Wizard step dots (new users only) */}
              {isWizardMode && (
                <div className="flex justify-center items-center gap-2 mb-5 shrink-0">
                  {([1, 2, 3] as const).map(s => (
                    <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === profileWizardStep ? `w-8 ${themeStyles.accentBg}` : s < profileWizardStep ? `w-2 ${themeStyles.accentBg} opacity-40` : `w-2 ${profile.theme === 'light' ? 'bg-slate-300' : 'bg-zinc-700'}`}`} />
                  ))}
                </div>
              )}

              {/* Tab bar (returning users only) */}
              {!isWizardMode && (
                <div className={`flex gap-1 p-1 rounded-xl mb-4 shrink-0 ${profile.theme === 'light' ? 'bg-slate-100' : 'bg-zinc-900'}`}>
                  {(['datos', 'dieta', 'entrenamiento'] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setProfileModalTab(tab)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${profileModalTab === tab ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-sm` : `${themeStyles.textMuted} hover:opacity-80`}`}
                    >
                      {tab === 'datos' ? 'Datos' : tab === 'dieta' ? 'Dieta' : 'Entreno'}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSaveGoal} className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4 text-left">

                  {/* ── STEP 1 / Datos tab: Personal data ── */}
                  {((isWizardMode && profileWizardStep === 1) || (!isWizardMode && profileModalTab === 'datos')) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                      <div className={`${themeStyles.iconBg} p-4 rounded-2xl border ${themeStyles.border} space-y-2`}>
                        <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Nombre</label>
                        <input
                          type="text"
                          value={editProfile.name}
                          onChange={(e) => setEditProfile({...editProfile, name: e.target.value})}
                          className={`w-full ${themeStyles.input} rounded-xl px-4 py-3 text-base font-bold focus:outline-none transition-all`}
                          placeholder="Tu nombre..."
                          autoComplete="given-name"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {/* Edad */}
                        <div className={`${themeStyles.iconBg} border ${themeStyles.border} rounded-2xl p-3 flex flex-col items-center gap-2`}>
                          <p className={`text-[10px] font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Edad</p>
                          <input
                            type="number"
                            value={editProfile.age || ''}
                            onChange={e => setEditProfile({...editProfile, age: parseInt(e.target.value) || 0})}
                            onBlur={() => { if (editProfile.age > 0) setEditProfile(p => ({...p, age: Math.max(15, Math.min(100, p.age))})); }}
                            placeholder="—"
                            min={15} max={100}
                            className={`w-full text-center text-2xl font-black bg-transparent border-none focus:outline-none ${themeStyles.accent} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          />
                          <div className="flex items-center gap-2 w-full justify-center">
                            <button type="button" onClick={() => setEditProfile(p => ({...p, age: Math.max(15, p.age - 1)}))}
                              className={`w-8 h-8 rounded-xl border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted} transition-colors`}>
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className={`text-[10px] font-medium ${themeStyles.textMuted}`}>años</span>
                            <button type="button" onClick={() => setEditProfile(p => ({...p, age: Math.min(100, p.age + 1)}))}
                              className={`w-8 h-8 rounded-xl border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted} transition-colors`}>
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Altura */}
                        <div className={`${themeStyles.iconBg} border ${themeStyles.border} rounded-2xl p-3 flex flex-col items-center gap-2`}>
                          <p className={`text-[10px] font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Altura</p>
                          <input
                            type="number"
                            value={editProfile.height || ''}
                            onChange={e => setEditProfile({...editProfile, height: parseInt(e.target.value) || 0})}
                            onBlur={() => { if (editProfile.height > 0) setEditProfile(p => ({...p, height: Math.max(120, Math.min(230, p.height))})); }}
                            placeholder="—"
                            min={120} max={230}
                            className={`w-full text-center text-2xl font-black bg-transparent border-none focus:outline-none ${themeStyles.accent} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          />
                          <div className="flex items-center gap-2 w-full justify-center">
                            <button type="button" onClick={() => setEditProfile(p => ({...p, height: Math.max(120, p.height - 1)}))}
                              className={`w-8 h-8 rounded-xl border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted} transition-colors`}>
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className={`text-[10px] font-medium ${themeStyles.textMuted}`}>cm</span>
                            <button type="button" onClick={() => setEditProfile(p => ({...p, height: Math.min(230, p.height + 1)}))}
                              className={`w-8 h-8 rounded-xl border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted} transition-colors`}>
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Peso */}
                        <div className={`${themeStyles.iconBg} border ${themeStyles.border} rounded-2xl p-3 flex flex-col items-center gap-2`}>
                          <p className={`text-[10px] font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Peso</p>
                          <input
                            type="number"
                            value={editWeight}
                            onChange={e => setEditWeight(e.target.value)}
                            onBlur={() => {
                              const v = parseFloat(editWeight);
                              if (!isNaN(v)) setEditWeight(Math.max(40, Math.min(200, v)).toFixed(1));
                            }}
                            placeholder="—"
                            min={40} max={200} step={0.1}
                            className={`w-full text-center text-2xl font-black bg-transparent border-none focus:outline-none ${themeStyles.accent} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          />
                          <div className="flex items-center gap-2 w-full justify-center">
                            <button type="button" onClick={() => setEditWeight(v => String(Math.max(40, parseFloat(v || '70') - 0.5).toFixed(1)))}
                              className={`w-8 h-8 rounded-xl border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted} transition-colors`}>
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className={`text-[10px] font-medium ${themeStyles.textMuted}`}>kg</span>
                            <button type="button" onClick={() => setEditWeight(v => String(Math.min(200, parseFloat(v || '70') + 0.5).toFixed(1)))}
                              className={`w-8 h-8 rounded-xl border ${themeStyles.border} flex items-center justify-center ${themeStyles.textMuted} transition-colors`}>
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className={`block text-xs font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Género</label>
                        <select
                          value={editProfile.gender}
                          onChange={(e) => setEditProfile({...editProfile, gender: e.target.value as 'male' | 'female'})}
                          className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-colors appearance-none`}
                        >
                          <option value="male">Hombre</option>
                          <option value="female">Mujer</option>
                        </select>
                      </div>

                      <div className={`${profile.theme === 'light' ? 'bg-rose-50/80 border-rose-200' : 'bg-rose-500/5 border-rose-500/10'} p-4 rounded-2xl border space-y-3`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className={`w-3.5 h-3.5 ${profile.theme === 'light' ? 'text-rose-500' : 'text-rose-400'}`} />
                          <span className={`text-xs font-bold uppercase tracking-widest ${profile.theme === 'light' ? 'text-rose-700' : 'text-rose-300/70'}`}>Condiciones Médicas</span>
                        </div>
                        {([
                          { key: 'diabetes' as const, label: 'Diabetes', note: 'Máx. 150g carbos/día (~50g por ingesta)' },
                          { key: 'highCholesterol' as const, label: 'Colesterol alto', note: 'Reducimos grasas saturadas' },
                          { key: 'hypertension' as const, label: 'Hipertensión', note: 'Limitamos sodio y procesados' },
                          { key: 'hypothyroidism' as const, label: 'Hipotiroidismo', note: 'Moderamos soja y crucíferas' },
                          { key: 'insulinResistance' as const, label: 'Resistencia a la insulina', note: 'Priorizamos bajo IG' },
                        ]).map(({ key, label, note }) => (
                          <div key={key} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-medium ${themeStyles.textMain}`}>{label}</span>
                              <button type="button"
                                onClick={() => setEditProfile(p => ({
                                  ...p,
                                  medicalConditions: { ...p.medicalConditions, [key]: !p.medicalConditions[key] },
                                  ...(key === 'diabetes' ? { diabetesType: !p.medicalConditions.diabetes ? 'type2' : 'none' } : {})
                                }))}
                                className={`w-10 h-3 rounded-full transition-colors relative ${editProfile.medicalConditions[key] ? 'bg-rose-500' : (profile.theme === 'light' ? 'bg-slate-300' : 'bg-zinc-700')}`}
                              >
                                <div className={`absolute -top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all ${editProfile.medicalConditions[key] ? 'left-6' : 'left-0'}`} />
                              </button>
                            </div>
                            {editProfile.medicalConditions[key] && (
                              <div className="animate-in fade-in slide-in-from-top-1 space-y-1.5">
                                <p className={`text-xs ${profile.theme === 'light' ? 'text-rose-600' : 'text-rose-400'}`}>{note}</p>
                                {key === 'diabetes' && (
                                  <select
                                    value={editProfile.diabetesType}
                                    onChange={(e) => setEditProfile({ ...editProfile, diabetesType: e.target.value as any })}
                                    className={`w-full ${profile.theme === 'light' ? 'bg-white border-rose-200 text-rose-900 focus:border-rose-400' : 'bg-zinc-900 border-zinc-800 text-white focus:border-rose-500/50'} border rounded-xl px-3 py-2 text-xs focus:outline-none transition-colors appearance-none`}
                                  >
                                    <option value="type1">Diabetes Tipo 1</option>
                                    <option value="type2">Diabetes Tipo 2</option>
                                    <option value="prediabetes">Pre-diabetes</option>
                                  </select>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="flex gap-2 pt-1 border-t border-dashed border-rose-200/50">
                          <Info className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-zinc-500 leading-tight">No sustituye el consejo médico profesional.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 2 / Dieta tab: Weekly menu ── */}
                  {((isWizardMode && profileWizardStep === 2) || (!isWizardMode && profileModalTab === 'dieta')) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="text-center pt-2 pb-1">
                        <ChefHat className={`w-10 h-10 ${themeStyles.accent} mx-auto mb-3`} />
                        <h4 className={`text-base font-bold ${themeStyles.textMain} mb-1`}>¿Quieres un menú semanal?</h4>
                        <p className={`text-xs ${themeStyles.textMuted} leading-relaxed`}>Generaremos un plan de comidas personalizado según tu perfil.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => { setWizardMenuPicked(true); setEditProfile(p => ({...p, menuEnabled: true})); }}
                          className={`py-5 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-2 ${(!isWizardMode ? editProfile.menuEnabled : wizardMenuPicked === true) ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md` : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:opacity-80`}`}
                        >
                          <span className={`text-2xl ${(!isWizardMode ? editProfile.menuEnabled : wizardMenuPicked === true) ? '' : 'opacity-30'}`}>✓</span>
                          <span className="text-xs font-bold uppercase tracking-widest">Sí, quiero mi menú</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setWizardMenuPicked(false); setEditProfile(p => ({...p, menuEnabled: false})); }}
                          className={`py-5 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-2 ${(!isWizardMode ? !editProfile.menuEnabled : wizardMenuPicked === false) ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md` : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:opacity-80`}`}
                        >
                          <span className={`text-2xl ${(!isWizardMode ? !editProfile.menuEnabled : wizardMenuPicked === false) ? '' : 'opacity-30'}`}>✕</span>
                          <span className="text-xs font-bold uppercase tracking-widest">No por ahora</span>
                        </button>
                      </div>

                      {(!isWizardMode ? editProfile.menuEnabled : wizardMenuPicked === true) && (
                        <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-4 duration-300">
                          <div className={`w-full h-px ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-800'}`} />

                          <div className="space-y-1.5">
                            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Objetivo nutricional</label>
                            <select
                              value={editProfile.goal}
                              onChange={(e) => setEditProfile({...editProfile, goal: e.target.value as any})}
                              className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-all appearance-none`}
                            >
                              <option value="lose">Perder grasa (−400 kcal/día)</option>
                              <option value="maintain">Mantener peso (TDEE exacto)</option>
                              <option value="gain">Ganar músculo (+300 kcal/día)</option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Tipo de Dieta</label>
                            <select
                              value={editProfile.dietType}
                              onChange={(e) => setEditProfile({...editProfile, dietType: e.target.value})}
                              className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-all appearance-none`}
                            >
                              <option value="Normal">Normal</option>
                              <option value="Vegetariana">Vegetariana</option>
                              <option value="Vegana">Vegana</option>
                              <option value="Pescetariana">Pescetariana</option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Distribución Macros</label>
                            <select
                              value={editProfile.macroDistribution}
                              onChange={(e) => setEditProfile({...editProfile, macroDistribution: e.target.value as any})}
                              className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-xs focus:outline-none transition-colors appearance-none`}
                            >
                              <option value="balanced">Equilibrada</option>
                              <option value="low_carb">Baja en Carbohidratos</option>
                              <option value="high_protein">Alta en Proteína</option>
                              <option value="keto">Keto</option>
                            </select>
                          </div>

                          <div className="space-y-3">
                            <label className={`block text-xs font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Alergias e Intolerancias</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {['Gluten', 'Lactosa', 'Frutos Secos', 'Marisco', 'Huevo', 'Otros'].map(id => (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => {
                                    const lid = id.toLowerCase().replace(' ', '_');
                                    const exists = editProfile.allergies.includes(lid);
                                    setEditProfile({
                                      ...editProfile,
                                      allergies: exists ? editProfile.allergies.filter(a => a !== lid) : [...editProfile.allergies, lid]
                                    });
                                  }}
                                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all ${
                                    editProfile.allergies.includes(id.toLowerCase().replace(' ', '_'))
                                      ? `${themeStyles.accentMuted} ${themeStyles.accentBorder} ${themeStyles.accent}`
                                      : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted}`
                                  }`}
                                >
                                  <div className={`w-3 h-3 rounded-sm border ${editProfile.allergies.includes(id.toLowerCase().replace(' ', '_')) ? `${themeStyles.accentBg} ${themeStyles.accentBorder}` : (profile.theme === 'light' ? 'border-slate-300' : 'border-zinc-700')}`} />
                                  {id}
                                </button>
                              ))}
                            </div>
                            {editProfile.allergies.includes('otros') && (
                              <input
                                type="text"
                                value={editProfile.otherAllergies}
                                onChange={(e) => setEditProfile({...editProfile, otherAllergies: e.target.value})}
                                className={`w-full ${themeStyles.input} rounded-xl px-3 py-2 text-xs focus:outline-none transition-colors animate-in fade-in`}
                                placeholder="Especifica (ej. Melocotón, Fresas...)"
                              />
                            )}
                          </div>

                          <div className={`p-4 rounded-2xl border space-y-3 ${profile.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-zinc-950 border-white/5'}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Pizza className="w-3.5 h-3.5 text-amber-400" />
                                <label className={`text-xs font-bold uppercase tracking-widest ${profile.theme === 'light' ? 'text-slate-700' : 'text-zinc-200'}`}>Momento Libre Semanal</label>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditProfile({...editProfile, freeMealEnabled: !editProfile.freeMealEnabled})}
                                className={`w-10 h-3 rounded-full transition-colors relative ${editProfile.freeMealEnabled ? themeStyles.accentBg : (profile.theme === 'light' ? 'bg-slate-300' : 'bg-zinc-700')}`}
                              >
                                <div className={`absolute -top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all ${editProfile.freeMealEnabled ? 'left-6' : 'left-0'}`} />
                              </button>
                            </div>
                            {editProfile.freeMealEnabled && (
                              <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2">
                                <select
                                  value={editProfile.freeMealDay}
                                  onChange={(e) => setEditProfile({...editProfile, freeMealDay: e.target.value})}
                                  className={`${themeStyles.input} rounded-xl px-3 py-2 text-xs focus:outline-none appearance-none`}
                                >
                                  {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(d => <option key={d}>{d}</option>)}
                                </select>
                                <select
                                  value={editProfile.freeMealType}
                                  onChange={(e) => setEditProfile({...editProfile, freeMealType: e.target.value as any})}
                                  className={`${themeStyles.input} rounded-xl px-3 py-2 text-xs focus:outline-none appearance-none`}
                                >
                                  <option value="comida">Comida</option>
                                  <option value="cena">Cena</option>
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── STEP 3 / Entreno tab: Training ── */}
                  {((isWizardMode && profileWizardStep === 3) || (!isWizardMode && profileModalTab === 'entrenamiento')) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="text-center pt-2 pb-1">
                        <Dumbbell className={`w-10 h-10 ${themeStyles.accent} mx-auto mb-3`} />
                        <h4 className={`text-base font-bold ${themeStyles.textMain} mb-1`}>¿Cómo quieres gestionar tu entrenamiento?</h4>
                        <p className={`text-xs ${themeStyles.textMuted} leading-relaxed`}>Ajustaremos tus calorías según tu actividad.</p>
                      </div>

                      {/* 4 options */}
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { mode: 'plan', label: 'Generar rutina', emoji: '🤖', desc: 'IA crea tu plan' },
                          { mode: 'manual', label: 'Registro manual', emoji: '📝', desc: 'Tú apuntas lo que haces' },
                          { mode: 'both', label: 'Ambas', emoji: '⚡', desc: 'Rutina + registro libre' },
                          { mode: null, label: 'No por ahora', emoji: '✕', desc: '' },
                        ] as const).map(({ mode, label, emoji, desc }) => {
                          const isSelected = mode === null
                            ? (!isWizardMode ? !editProfile.gymEnabled : wizardGymPicked === false)
                            : (editProfile.gymEnabled && editProfile.gymMode === mode && (isWizardMode ? wizardGymPicked === true : true));
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => {
                                if (mode === null) {
                                  setWizardGymPicked(false);
                                  setEditProfile(p => ({ ...p, gymEnabled: false }));
                                } else {
                                  setWizardGymPicked(true);
                                  setEditProfile(p => ({ ...p, gymEnabled: true, gymMode: mode }));
                                }
                              }}
                              className={`py-4 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-1.5 ${
                                isSelected
                                  ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md`
                                  : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:opacity-80`
                              }`}
                            >
                              <span className={`text-xl ${isSelected ? '' : 'opacity-40'}`}>{emoji}</span>
                              <span className="text-xs font-bold uppercase tracking-widest leading-tight">{label}</span>
                              {desc && <span className={`text-[10px] ${isSelected ? 'opacity-80' : 'opacity-50'} leading-tight`}>{desc}</span>}
                            </button>
                          );
                        })}
                      </div>

                      {/* Frecuencia semanal y TDEE — siempre visible cuando gym está activo */}
                      {(!isWizardMode ? editProfile.gymEnabled : wizardGymPicked === true) && (
                        <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-4 duration-300">
                          <div className={`w-full h-px ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-800'}`} />

                          <div className="space-y-1.5">
                            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Frecuencia Semanal</label>
                            <div className={`${profile.theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950 border-zinc-800'} border rounded-2xl p-4 space-y-3`}>
                              <div className="flex justify-between items-baseline">
                                <span className={`text-xl font-black ${themeStyles.accent}`}>{editProfile.trainingDaysPerWeek} <span className={`text-xs ${themeStyles.textMuted} uppercase font-bold`}>días</span></span>
                              </div>
                              <input
                                type="range"
                                min="1" max="7" step="1"
                                value={editProfile.trainingDaysPerWeek}
                                onChange={(e) => setEditProfile({...editProfile, trainingDaysPerWeek: parseInt(e.target.value)})}
                                className={`w-full ${profile.theme === 'light' ? 'accent-emerald-500' : 'accent-lime-400'} h-2 rounded-lg appearance-none cursor-pointer`}
                              />
                              <div className="flex justify-between text-xs font-bold text-zinc-500 uppercase">
                                <span>1</span><span>7</span>
                              </div>
                            </div>
                          </div>

                          <div className={`flex gap-2 p-3 ${themeStyles.iconBg} border ${themeStyles.border} rounded-xl`}>
                            <Info className={`w-3.5 h-3.5 ${themeStyles.accent} shrink-0 mt-0.5`} />
                            <p className={`text-xs ${themeStyles.textMuted} italic leading-relaxed`}>El sistema ajustará tu TDEE según los días de entreno para que la dieta sea más precisa.</p>
                          </div>
                        </div>
                      )}

                      {/* Formulario de plan solo si gymMode incluye rutina */}
                      {(!isWizardMode ? editProfile.gymEnabled && (editProfile.gymMode === 'plan' || editProfile.gymMode === 'both') : wizardGymPicked === true && (editProfile.gymMode === 'plan' || editProfile.gymMode === 'both')) && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                          <div className={`w-full h-px ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-800'}`} />

                          <div className="space-y-1.5">
                            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Ubicación</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setEditProfile({...editProfile, workoutType: 'gym'})}
                                className={`py-4 rounded-xl text-center border transition-all ${editProfile.workoutType === 'gym' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md` : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted}`}`}
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <Dumbbell className="w-5 h-5" />
                                  <span className="text-xs uppercase tracking-widest font-bold">Gimnasio</span>
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditProfile({...editProfile, workoutType: 'home'})}
                                className={`py-4 rounded-xl text-center border transition-all ${editProfile.workoutType === 'home' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md` : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted}`}`}
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <Home className="w-5 h-5" />
                                  <span className="text-xs uppercase tracking-widest font-bold">En Casa</span>
                                </div>
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Objetivo de entrenamiento</label>
                            <select
                              value={editProfile.gymGoal}
                              onChange={(e) => setEditProfile({...editProfile, gymGoal: e.target.value as any})}
                              className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-all appearance-none`}
                            >
                              <option value="muscle">Ganar Músculo</option>
                              <option value="strength">Fuerza</option>
                              <option value="cardio">Resistencia (Cardio)</option>
                              <option value="fat_loss">Pérdida de Grasa</option>
                              <option value="flexibility">Flexibilidad</option>
                              <option value="maintenance">Mantenimiento</option>
                            </select>
                          </div>

                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notification preference (tab mode only) */}
                {!isWizardMode && 'Notification' in window && Notification.permission !== 'denied' && (
                  <div className={`pt-3 mt-1 border-t ${themeStyles.border} flex items-center justify-between`}>
                    <span className={`text-xs ${themeStyles.textMuted}`}>🔔 Recordatorios</span>
                    {notificationsEnabled ? (
                      <button onClick={disableNotifications} className="text-xs font-bold text-red-400 hover:text-red-500">
                        Desactivar
                      </button>
                    ) : (
                      <button onClick={requestNotificationPermission} className={`text-xs font-bold ${themeStyles.accent} hover:underline`}>
                        Activar
                      </button>
                    )}
                  </div>
                )}

                {/* Navigation buttons */}
                <div className={`pt-4 mt-2 border-t ${themeStyles.border} flex gap-3 shrink-0`}>
                  {!isWizardMode ? (
                    /* Tab mode: single Guardar button per tab */
                    <button
                      type="submit"
                      disabled={profileModalTab === 'datos' && (!editProfile.name.trim() || editProfile.age <= 0 || editProfile.height <= 0)}
                      className={`flex-1 ${themeStyles.buttonPrimary} py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <Save className="w-4 h-4" />
                      Guardar
                    </button>
                  ) : (
                    /* Wizard mode: Volver + Continuar/Guardar */
                    <>
                      {profileWizardStep > 1 && (
                        <button
                          type="button"
                          onClick={() => setProfileWizardStep(s => (s - 1) as 1 | 2 | 3)}
                          className={`flex-1 py-3 rounded-xl border ${themeStyles.border} ${themeStyles.textMuted} text-xs font-bold uppercase tracking-widest transition-colors`}
                        >
                          ← Volver
                        </button>
                      )}
                      {profileWizardStep < 3 ? (
                        <button
                          type="button"
                          disabled={
                            (profileWizardStep === 1 && (!editProfile.name.trim() || !editWeight || parseFloat(editWeight) <= 0 || editProfile.age <= 0 || editProfile.height <= 0)) ||
                            (profileWizardStep === 2 && wizardMenuPicked === null)
                          }
                          onClick={() => {
                            if (profileWizardStep === 1) {
                              handleSaveGoal(null, false);
                              setProfileWizardStep(2);
                            } else {
                              setProfileWizardStep(3);
                            }
                          }}
                          className={`flex-1 ${themeStyles.buttonPrimary} py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          Continuar →
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={wizardGymPicked === null}
                          className={`flex-1 ${themeStyles.buttonPrimary} py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <Save className="w-4 h-4" />
                          Guardar
                        </button>
                      )}
                    </>
                  )}
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Edit Meal Modal */}
      <AnimatePresence>
        {editingMeal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`${themeStyles.card} border ${themeStyles.border} rounded-2xl p-5 w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]`}
            >
              <div className={`flex justify-between items-center mb-6 sticky top-0 z-10 pb-2 border-b ${themeStyles.border}`} style={{background: "inherit"}}>
                <h3 className={`text-xl font-display font-bold ${themeStyles.textMain}`}>
                  {mealEditMode === 'edit' ? 'Editar Comida' : 'Revisar Análisis'}
                </h3>
                <button onClick={() => setEditingMeal(null)} className="text-zinc-500 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="w-full h-40 rounded-2xl overflow-hidden mb-6 relative shrink-0">
                <img src={editingMeal.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent"></div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const baseMacros = ingredientComputedMacros ?? {
                    calories: (Number(editingMeal.calories) || 0) * portionMultiplier,
                    protein:  (Number(editingMeal.protein)  || 0) * portionMultiplier,
                    carbs:    (Number(editingMeal.carbs)    || 0) * portionMultiplier,
                    fat:      (Number(editingMeal.fat)      || 0) * portionMultiplier,
                  };
                  const updatedIngredients = editingMeal.ingredients?.map((ing, i) => ({
                    ...ing,
                    grams: ingredientGrams[i] ?? ing.grams ?? parseInt(ing.amount) ?? 0,
                    amount: `${ingredientGrams[i] ?? ing.grams ?? parseInt(ing.amount) ?? 0}g`,
                  }));
                  const mealToSave: Meal = {
                    ...editingMeal,
                    calories: Math.round(baseMacros.calories),
                    protein:  Math.round(baseMacros.protein),
                    carbs:    Math.round(baseMacros.carbs),
                    fat:      Math.round(baseMacros.fat),
                    ...(updatedIngredients && { ingredients: updatedIngredients }),
                  };
                  const existingIndex = meals.findIndex(m => m.id === editingMeal.id);
                  if (existingIndex >= 0) {
                    setMeals(prev => {
                      const copy = [...prev];
                      copy[existingIndex] = mealToSave;
                      return copy;
                    });
                  } else {
                    setMeals(prev => [mealToSave, ...prev]);
                  }
                  if (user) {
                    const payload = mealEditMode === 'edit'
                      ? { ...mealToSave, editedAt: serverTimestamp() }
                      : mealToSave;
                    setDoc(doc(db, 'users', user.uid, 'meals', mealToSave.id), payload, { merge: true }).catch(console.error);
                  }
                  setEditingMeal(null);
                }}
                className="space-y-4 pb-24"
              >
                {/* Food Name & Ingredients (Configurable Parameters) */}
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Nombre de la comida</label>
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={editingMeal.foodName}
                      onChange={(e) => handleFoodNameChange(e, editingMeal)}
                      onBlur={() => {
                        if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
                        const trimmed = editingMeal.foodName.trim();
                        if (!macrosManuallyEdited && trimmed.length > 2 && trimmed !== originalAnalyzedName?.trim()) {
                          handleRecalculateMacros(editingMeal.foodName, editingMeal);
                        }
                      }}
                      className={`w-full ${themeStyles.input} rounded-xl px-4 py-3 focus:outline-none transition-colors`}
                      required
                    />

                    {/* Recalc button / manual override notice */}
                    {macrosManuallyEdited ? (
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <span>Macros editados manualmente —</span>
                        <button
                          type="button"
                          onClick={() => handleRecalculateMacros(editingMeal.foodName, editingMeal)}
                          className={`${themeStyles.accent} font-semibold hover:underline`}
                        >
                          Recalcular con IA
                        </button>
                      </div>
                    ) : editingMeal.foodName.trim() !== originalAnalyzedName?.trim() && editingMeal.foodName.trim().length > 2 && !isRecalculatingMacros ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
                          handleRecalculateMacros(editingMeal.foodName, editingMeal);
                        }}
                        className={`self-start flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${themeStyles.accentMuted} ${themeStyles.accent} border border-current/20 transition-opacity`}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Recalcular con nuevo nombre
                      </button>
                    ) : null}

                    {/* Interpretation badge */}
                    {(editingMeal.interpretation || editingMeal.isHealthy !== undefined) && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/10 text-xs font-medium text-zinc-300 w-fit">
                        <Activity className={`w-3.5 h-3.5 ${themeStyles.accent}`} />
                        {editingMeal.interpretation || (editingMeal.isHealthy ? 'Comida equilibrada' : 'A tener en cuenta')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Macro Percentages */}
                <div className="pb-2">
                  <div className="flex justify-between text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
                    <span>Distribución de Macros</span>
                  </div>
                  <div className={`h-2 w-full ${themeStyles.iconBg} rounded-full overflow-hidden flex`}>
                    {(() => {
                      const total = editingMeal.protein + editingMeal.carbs + editingMeal.fat;
                      if (total === 0) return <div className="w-full bg-zinc-800" />;
                      const pPct = (editingMeal.protein / total) * 100;
                      const cPct = (editingMeal.carbs / total) * 100;
                      const fPct = (editingMeal.fat / total) * 100;
                      return (
                        <>
                          <div style={{ width: `${pPct}%` }} className={`${themeStyles.macroProteinBg} h-full`} title={`Proteínas: ${Math.round(pPct)}%`} />
                          <div style={{ width: `${cPct}%` }} className={`${themeStyles.macroCarbsBg} h-full`} title={`Carbohidratos: ${Math.round(cPct)}%`} />
                          <div style={{ width: `${fPct}%` }} className={`${themeStyles.macroFatBg} h-full`} title={`Grasas: ${Math.round(fPct)}%`} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between text-xs font-medium text-zinc-400 mt-2">
                    <span className={`${themeStyles.macroProtein}`}>Prot: {Math.round((editingMeal.protein / (editingMeal.protein + editingMeal.carbs + editingMeal.fat || 1)) * 100)}%</span>
                    <span className={`${themeStyles.macroCarbs}`}>Carbs: {Math.round((editingMeal.carbs / (editingMeal.protein + editingMeal.carbs + editingMeal.fat || 1)) * 100)}%</span>
                    <span className={`${themeStyles.macroFat}`}>Grasas: {Math.round((editingMeal.fat / (editingMeal.protein + editingMeal.carbs + editingMeal.fat || 1)) * 100)}%</span>
                  </div>
                </div>

                {/* Valoración calórica */}
                {editingMeal.semaforo && (
                  <div className={`${themeStyles.iconBg} rounded-2xl p-3 border ${themeStyles.border} space-y-1.5`}>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Valoración calórica</span>
                    <SemaforoBadge semaforo={editingMeal.semaforo} label={editingMeal.semaforoLabel} />
                    <p className={`text-[10px] ${themeStyles.textMuted}`}>
                      {Math.round(ingredientComputedMacros?.calories ?? editingMeal.calories)} kcal · verde = dentro del objetivo, amarillo = límite, rojo = excede
                    </p>
                  </div>
                )}

                {/* Precisión del análisis */}
                {editingMeal.confidence && (
                  <div className={`${themeStyles.iconBg} rounded-2xl p-3 border ${themeStyles.border} space-y-1.5`}>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Precisión del análisis</span>
                    <ConfidenceBadge confidence={editingMeal.confidence} message={undefined} />
                    {editingMeal.confidenceMessage && (
                      <p className={`text-[10px] ${themeStyles.textMuted} leading-relaxed`}>{editingMeal.confidenceMessage}</p>
                    )}
                  </div>
                )}

                {/* Ingredients with per-ingredient controls */}
                {editingMeal.ingredients && editingMeal.ingredients.length > 0 && (
                  <div className={`${themeStyles.iconBg} rounded-2xl p-4 border ${themeStyles.border}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Ingredientes</span>
                      <div className="flex gap-1">
                        {([0.5, 1, 1.5, 2] as const).map(m => (
                          <button key={m} type="button" onClick={() => setPortionMultiplier(m)}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors ${portionMultiplier === m ? `${themeStyles.accentBg} text-zinc-950 border-transparent` : `${themeStyles.iconBg} ${themeStyles.textMuted} ${themeStyles.border} hover:border-current`}`}>
                            {m === 0.5 ? '½x' : m === 1.5 ? '1½x' : `${m}x`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {editingMeal.ingredients.map((ing, i) => (
                        <div key={i} className={`flex items-center gap-2 py-2 ${i < editingMeal.ingredients!.length - 1 ? `border-b ${themeStyles.border}` : ''}`}>
                          <span className={`text-sm flex-1 ${themeStyles.textMain} capitalize`}>{ing.name}</span>
                          <button type="button"
                            onClick={() => setIngredientGrams(prev => { const n = [...prev]; n[i] = Math.max(0, (n[i] ?? 0) - 5); return n; })}
                            className={`w-7 h-7 rounded-lg text-base font-bold flex items-center justify-center ${themeStyles.iconBg} border ${themeStyles.border} ${themeStyles.textMuted} hover:text-white transition-colors`}>−</button>
                          <span className={`w-12 text-center text-sm font-bold tabular-nums ${themeStyles.accent}`}>{ingredientGrams[i] ?? 0}g</span>
                          <button type="button"
                            onClick={() => setIngredientGrams(prev => { const n = [...prev]; n[i] = (n[i] ?? 0) + 5; return n; })}
                            className={`w-7 h-7 rounded-lg text-base font-bold flex items-center justify-center ${themeStyles.iconBg} border ${themeStyles.border} ${themeStyles.textMuted} hover:text-white transition-colors`}>+</button>
                        </div>
                      ))}
                    </div>
                    {!ingredientComputedMacros && (
                      <p className={`text-[10px] ${themeStyles.textMuted} mt-2 opacity-60`}>Registra una nueva comida para obtener recálculo automático de macros por ingrediente</p>
                    )}
                  </div>
                )}

                {/* Read-Only Macros */}
                <div className="relative">
                  {isRecalculatingMacros && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl">
                      <div className="flex items-center gap-2 bg-zinc-900/90 px-3 py-2 rounded-xl border border-white/10">
                        <Loader2 className={`w-4 h-4 animate-spin ${themeStyles.accent}`} />
                        <span className={`text-xs font-semibold ${themeStyles.accent}`}>Recalculando…</span>
                      </div>
                    </div>
                  )}
                  {(() => {
                    const m = ingredientComputedMacros ?? {
                      calories: editingMeal.calories * portionMultiplier,
                      protein:  editingMeal.protein  * portionMultiplier,
                      carbs:    editingMeal.carbs    * portionMultiplier,
                      fat:      editingMeal.fat      * portionMultiplier,
                    };
                    return (
                      <div className={`grid grid-cols-2 gap-3 transition-opacity duration-200 ${isRecalculatingMacros ? 'opacity-30' : 'opacity-100'}`}>
                        <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                          <span className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Calorías</span>
                          <span className={`text-lg font-display font-bold ${themeStyles.accent}`}>{Math.round(m.calories)} <span className="text-xs text-zinc-500">kcal</span></span>
                        </div>
                        <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                          <span className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Proteínas</span>
                          <span className={`text-lg font-display font-bold ${themeStyles.macroProtein}`}>{Math.round(m.protein)} <span className="text-xs text-zinc-500">g</span></span>
                        </div>
                        <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                          <span className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Carbohidratos</span>
                          <span className={`text-lg font-display font-bold ${themeStyles.macroCarbs}`}>{Math.round(m.carbs)} <span className="text-xs text-zinc-500">g</span></span>
                        </div>
                        <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                          <span className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Grasas</span>
                          <span className={`text-lg font-display font-bold ${themeStyles.macroFat}`}>{Math.round(m.fat)} <span className="text-xs text-zinc-500">g</span></span>
                        </div>
                      </div>
                    );
                  })()}
                  <AnimatePresence>
                    {macrosJustUpdated && (
                      <motion.div
                        key="macros-updated"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className={`flex items-center gap-1.5 mt-2 text-xs font-semibold ${themeStyles.accent}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Macros actualizados
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {(editingMeal.coachMessage || editingMeal.healthAnalysis) && (
                  <div className="mt-6 space-y-3">
                    {/* Mensaje del Coach */}
                    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 flex items-start gap-3">
                      <div className={`p-2 rounded-xl shrink-0 ${themeStyles.accentMuted} ${themeStyles.accent}`}>
                        <Bot className="w-5 h-5" />
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed pt-0.5">
                        {editingMeal.coachMessage || editingMeal.healthAnalysis}
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-4 flex flex-col gap-2">
                  <button type="submit" className={`w-full ${themeStyles.accentBg} text-zinc-950 font-bold uppercase tracking-wider py-4 rounded-xl transition-colors`}>
                    {mealEditMode === 'edit' ? 'Actualizar' : 'Guardar Registro'}
                  </button>
                  {mealEditMode === 'edit' && (
                    <button
                      type="button"
                      onClick={() => {
                        removeMeal(editingMeal.id);
                        setEditingMeal(null);
                      }}
                      className="w-full bg-red-500/10 text-red-400 border border-red-500/20 font-bold uppercase tracking-wider py-3 rounded-xl hover:bg-red-500/20 transition-colors text-sm"
                    >
                      Borrar registro
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {appSuccess && (
          <motion.div
            key="success-toast"
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 left-4 right-4 z-[60] flex justify-center pointer-events-none"
          >
            <div className="bg-emerald-500 text-white px-6 py-4 rounded-2xl shadow-2xl font-medium text-sm flex items-center gap-3 pointer-events-auto max-w-md w-full border border-emerald-400/50">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <p className="flex-1">{appSuccess}</p>
            </div>
          </motion.div>
        )}
        {appError && (
          <motion.div
            key="error-toast"
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 left-4 right-4 z-[60] flex justify-center pointer-events-none"
          >
            <div className="bg-red-500 text-white px-6 py-4 rounded-2xl shadow-2xl font-medium text-sm flex items-center gap-3 pointer-events-auto max-w-md w-full border border-red-400/50">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="flex-1">{appError.message}</p>
              <button
                onClick={() => setAppError(null)}
                className="p-1 hover:bg-red-600 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      <nav className={`fixed bottom-0 left-0 right-0 z-50 h-16 border-t ${
        profile.theme === 'light' ? 'bg-white border-slate-200' : 'bg-zinc-950 border-white/8'
      }`}>
        <div className="max-w-md mx-auto h-full flex items-center justify-around px-2">
          {([
            { id: 'hoy',    label: 'Hoy',    Icon: Home,            visible: true },
            { id: 'menu',   label: 'Menú',   Icon: UtensilsCrossed, visible: profile.menuEnabled === true },
            { id: 'gym',    label: 'Gym',    Icon: Dumbbell,        visible: !!profile.gymEnabled },
            { id: 'semana', label: 'Semana', Icon: BarChart2,        visible: true },
            { id: 'perfil', label: 'Perfil', Icon: UserIcon,         visible: true },
          ] as const).filter(t => t.visible).map(({ id, label, Icon }) => {
            const isActive = activeSection === id;
            const accentColor = profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400';
            const mutedColor = profile.theme === 'light' ? 'text-slate-400' : 'text-zinc-500';
            const unlockedAt = sectionUnlockedAt[id] ?? 0;
            const showBadge = unlockedAt > 0 && Date.now() - unlockedAt < 24 * 60 * 60 * 1000 && !isActive;
            return (
              <button
                key={id}
                onClick={() => {
                  if (id === 'perfil') {
                    setEditProfile({ ...profile, allergies: Array.isArray(profile.allergies) ? profile.allergies : [], dislikedFoods: profile.dislikedFoods || '' });
                    setEditWeight(profile.weight > 0 ? profile.weight.toString() : '');
                    setDismissedSuggestions([]);
                    setProfileWizardStep(1);
                    setProfileModalTab('datos');
                    setIsGoalModalOpen(true);
                  } else if (id === 'semana') {
                    setEvolutionPeriod('weekly');
                    setWeekOffset(0);
                    setExpandedWeekDay(null);
                    setWeeklyAnalysis('');
                    setActiveSection(id as AppSection);
                  } else {
                    setActiveSection(id as AppSection);
                  }
                }}
                className="relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full"
              >
                <Icon className={`w-5 h-5 ${isActive ? accentColor : mutedColor}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? accentColor : mutedColor}`}>{label}</span>
                {showBadge && (
                  <span className="absolute top-2 right-1/4 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${profile.theme === 'light' ? 'bg-emerald-500' : 'bg-lime-400'}`} />
                  </span>
                )}
                {!showBadge && id === 'menu' && menuNeedsRegeneration && (
                  <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full bg-amber-500" />
                )}
                {!showBadge && id === 'gym' && workoutNeedsRegeneration && (
                  <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full bg-amber-500" />
                )}
                {id === 'perfil' && !profile.name && (
                  <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function MacroCard({ icon, label, current, goal, color, bgGradient, borderColor, unit }: { icon: React.ReactNode, label: string, current: number, goal: number, color: string, bgGradient: string, borderColor: string, unit: string }) {
  const percentage = Math.min((current / goal) * 100, 100);
  
  return (
    <motion.div 
      whileHover={{ y: -2, scale: 1.02 }}
      className={`bento-item flex flex-col shadow-lg ${borderColor}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 bg-zinc-950/50 rounded-lg border border-white/5">
          {icon}
        </div>
        <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{label}</span>
      </div>
      
      <div className="mt-auto">
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-2xl font-display font-black text-white tracking-tighter">{Math.round(current)}</span>
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">/ {goal}{unit}</span>
        </div>
        
        <div className="h-1.5 w-full bg-zinc-950/50 rounded-full overflow-hidden border border-white/5">
          <motion.div
            className={`h-full ${color} shadow-[0_0_10px_currentColor]`}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>
    </motion.div>
  );
}

