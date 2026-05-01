import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Camera, Activity, Flame, Beef, Wheat, Droplet, Droplets, PieChart, X, Loader2, Plus, Minus, Upload, AlertTriangle, Info, CheckCircle2, ChevronDown, Scale, Zap, TrendingUp, Target, Dumbbell, Calendar, Utensils, Moon, Sun, ShoppingCart, ClipboardList, CheckSquare, MessageCircle, ChefHat, Send, Bot, Pencil, RefreshCw, LogOut, Banana, User as UserIcon, Pizza, Save, Edit2, Trash2, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, ResponsiveContainer, YAxis, ComposedChart, Bar, Line, XAxis, Tooltip } from 'recharts';
import Markdown from 'react-markdown';
import { useCooldown } from './hooks/useCooldown';
import remarkGfm from 'remark-gfm';
import { ExerciseDelta } from './components/ExerciseDelta';
import { analyzeFoodText, chatWithCoach, generateWeeklyMenu, generateWorkoutPlan, generateShoppingList } from './lib/groq';
import type { ChatMessage, CoachUserContext } from './lib/groq';
import { analyzeFoodImage } from './lib/openrouter';
import type { NutritionalInfo, WeeklyMenu, ShoppingList } from './types/nutrition';
import { extractIngredients, calcularBMR } from './utils/nutrition';
import { calculateMETCalories, ACTIVITY_OPTIONS } from './utils/metCalculator';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, deleteDoc, getDocFromServer, onSnapshot, deleteField } from 'firebase/firestore';
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

type WeightEntry = {
  id: string;
  weight: number;
  timestamp: number;
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
  dislikedFoods: string;
  goal: 'lose' | 'maintain' | 'gain';
  macroDistribution: 'balanced' | 'low_carb' | 'high_protein' | 'keto';
  freeMealEnabled: boolean;
  freeMealDay: string;
  freeMealType: 'comida' | 'cena';
  gymEnabled: boolean;
  workoutType: 'gym' | 'home';
  gymGoal: 'muscle' | 'strength' | 'cardio' | 'fat_loss' | 'flexibility' | 'maintenance';
  trainingDaysPerWeek: number;
  theme: 'light' | 'dark';
};

type DailyHabits = {
  [date: string]: {
    water: number;
    sleep: number;
    workoutDone?: boolean;
    workoutSessions?: number;
    completedExercises?: string[]; // IDs or names of exercise blocks completed
    manualWorkout?: { activity: string; intensidad: 'suave' | 'moderada' | 'intensa'; durationMinutes: number; caloriesBurned: number };
    workoutCalories?: number;
    workoutSessionFocus?: string;
  };
};

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

const DEFAULT_GOALS = {
  calories: 2500,
  protein: 180,
  carbs: 250,
  fat: 86,
};

const NutriScoreBadge = ({ score }: { score?: "A" | "B" | "C" | "D" | "E" }) => {
  if (!score) return null;
  const colors = {
    A: "bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]",
    B: "bg-lime-500 text-white shadow-[0_0_15px_rgba(132,204,22,0.4)]",
    C: "bg-yellow-500 text-white shadow-[0_0_15px_rgba(234,179,8,0.4)]",
    D: "bg-orange-500 text-white shadow-[0_0_15px_rgba(249,115,22,0.4)]",
    E: "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]",
  };
  return (
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg ${colors[score]}`}>
      {score}
    </div>
  );
};

const RulerPicker = ({ value, onChange, min, max, step, unit, label, theme }: any) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isInternalUpdate = useRef(false);

  const range = max - min;
  const steps = range / step;

  // Sync scroll position when value changes from OUTSIDE
  useEffect(() => {
    if (scrollRef.current && !isInternalUpdate.current) {
      const percentage = (value - min) / range;
      const targetScroll = percentage * (scrollRef.current.scrollWidth - scrollRef.current.clientWidth);
      scrollRef.current.scrollLeft = targetScroll;
    }
    isInternalUpdate.current = false;
  }, [value, min, max, range]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const scrollPos = scrollRef.current.scrollLeft;
      const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
      
      // Prevent division by zero
      if (maxScroll <= 0) return;

      const percentage = Math.max(0, Math.min(1, scrollPos / maxScroll));
      const newValue = min + percentage * range;
      const steppedValue = Math.round(newValue / step) * step;
      const formattedValue = steppedValue.toFixed(step < 1 ? 1 : 0);
      
      if (formattedValue !== String(value)) {
        isInternalUpdate.current = true;
        onChange(formattedValue);
      }
    }
  };

  const onMouseDown = () => setIsDragging(true);
  const stopDragging = () => setIsDragging(false);

  return (
    <div className={`space-y-2 p-4 rounded-3xl border shadow-inner ${theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/5'}`}>
      <div className="flex justify-between items-end px-1">
        <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'light' ? 'text-slate-500' : 'text-zinc-500'}`}>{label}</label>
        <div className="flex items-baseline gap-1">
          <input
            type="number"
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                onChange('0');
                return;
              }
              const numVal = parseFloat(val);
              if (!isNaN(numVal)) {
                onChange(val);
              }
            }}
            className={`text-2xl font-display font-black bg-transparent border-none focus:outline-none w-20 text-right appearance-none ${theme === 'light' ? 'text-emerald-500' : 'text-lime-400'}`}
            style={{ MozAppearance: 'textfield' }}
          />
          <span className={`text-[10px] font-bold uppercase ${theme === 'light' ? 'text-slate-400' : 'text-zinc-600'}`}>{unit}</span>
        </div>
      </div>
      
      <div className={`relative h-14 flex items-center rounded-2xl overflow-hidden border ${theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-zinc-900/50 border-white/5'}`}>
        <div className={`absolute left-1/2 top-0 bottom-0 w-0.5 z-10 ${theme === 'light' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-lime-400 shadow-[0_0_10px_rgba(163,230,53,0.5)]'}`} />
        
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          onMouseDown={onMouseDown}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
          className="w-full h-full overflow-x-auto no-scrollbar cursor-grab active:cursor-grabbing flex items-end pb-2 px-[50%]"
          style={{ scrollSnapType: 'x proximity' }}
        >
          <div className="flex items-end gap-2 h-8 min-w-max">
            {Array.from({ length: steps + 1 }).map((_, i) => {
              const val = min + i * step;
              const isMajor = i % 10 === 0;
              const isMid = i % 5 === 0;
              return (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div 
                    className={`rounded-full transition-colors ${
                      isMajor ? `h-6 w-0.5 ${theme === 'light' ? 'bg-slate-400' : 'bg-zinc-500'}` : 
                      isMid ? `h-4 w-0.5 ${theme === 'light' ? 'bg-slate-300' : 'bg-zinc-700'}` : `h-2 w-0.5 ${theme === 'light' ? 'bg-slate-200' : 'bg-zinc-800'}`
                    }`}
                  />
                  {isMajor && (
                    <span className={`text-[8px] font-bold tabular-nums ${theme === 'light' ? 'text-slate-400' : 'text-zinc-600'}`}>{val}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
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
        <label className={`block text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-slate-500' : 'text-zinc-500'}`}>{cleanLabel}</label>
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
          {unit && <span className={`text-[10px] font-medium ${theme === 'light' ? 'text-slate-400' : 'text-zinc-600'}`}>{unit}</span>}
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
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    age: 0,
    height: 0,
    gender: 'male',
    dietType: '',
    allergies: [],
    otherAllergies: '',
    diabetesType: 'none',
    dislikedFoods: '',
    goal: 'maintain',
    macroDistribution: 'balanced',

    freeMealEnabled: false,
    freeMealDay: 'Sábado',
    freeMealType: 'cena',
    gymEnabled: false,
    workoutType: 'gym',
    gymGoal: 'muscle',
    trainingDaysPerWeek: 3,
    theme: 'light'
  });
  const [habits, setHabits] = useState<DailyHabits>({});
  const [workoutPlan, setWorkoutPlan] = useState<string | null>(null);
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState(false);

  const [activeTab, setActiveTab] = useState<'today' | 'gym' | 'meals'>('today');
  const [mealsSubTab, setMealsSubTab] = useState<'daily' | 'plan' | 'shopping'>('daily');
  const [menuSelectedDay, setMenuSelectedDay] = useState<number>(0);
  const [expandedMeal, setExpandedMeal] = useState<number>(0);
  const [evolutionPeriod, setEvolutionPeriod] = useState<'today' | 'weekly' | 'monthly' | 'quarterly' | 'semiannually' | 'annually'>('today');
  const [gymSubTab, setGymSubTab] = useState<'manual' | 'plan'>('plan');
  const [planSubTab, setPlanSubTab] = useState<'info' | 'ejercicios' | 'tips'>('ejercicios');
  const [manualWorkoutActivity, setManualWorkoutActivity] = useState<string>('Correr');
  const [manualWorkoutIntensidad, setManualWorkoutIntensidad] = useState<'suave'|'moderada'|'intensa'>('moderada');
  const [manualWorkoutMinutes, setManualWorkoutMinutes] = useState('45');
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

  const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'user' | 'diet' | 'exercise'>('user');
  const [editProfile, setEditProfile] = useState<UserProfile>({
    name: '',
    age: 0,
    height: 0,
    gender: 'male',
    dietType: '',
    allergies: [],
    otherAllergies: '',
    diabetesType: 'none',
    dislikedFoods: '',
    goal: 'maintain',
    macroDistribution: 'balanced',

    freeMealEnabled: false,
    freeMealDay: 'Sábado',
    freeMealType: 'cena',
    gymEnabled: false,
    workoutType: 'gym',
    gymGoal: 'muscle',
    trainingDaysPerWeek: 3,
    theme: 'light'
  });
  const [editWeight, setEditWeight] = useState('');

  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [portionMultiplier, setPortionMultiplier] = useState(1);

  const menuCooldown     = useCooldown(60);
  const workoutCooldown  = useCooldown(60);
  const shoppingCooldown = useCooldown(30);
  const textFoodCooldown = useCooldown(8);
  const imageFoodCooldown = useCooldown(8);
  const chatCooldown     = useCooldown(3);
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
  const showError = (message: string) => setAppError({ message, timestamp: Date.now() });
  const showSuccess = (message: string) => { setAppSuccess(message); setTimeout(() => setAppSuccess(null), 3000); };

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', parts: {text: string}[]}[]>([
    { role: 'model', parts: [{ text: '¡Hola! Soy tu entrenador y nutricionista personal. ¿En qué te puedo ayudar hoy?' }] }
  ]);
  const [currentChatMessage, setCurrentChatMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});


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
      setUser(currentUser);
      if (currentUser) {
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.profile) {
              const loadedProfile = {
                ...data.profile,
                name: data.profile.name || '',
                allergies: Array.isArray(data.profile.allergies) ? data.profile.allergies : [],
                otherAllergies: data.profile.otherAllergies || '',
                diabetesType: data.profile.diabetesType || 'none',
                dislikedFoods: data.profile.dislikedFoods || '',
                freeMealEnabled: data.profile.freeMealEnabled || false,
                freeMealDay: data.profile.freeMealDay || 'Sábado',
                freeMealType: data.profile.freeMealType || 'cena',
                gymEnabled: data.profile.gymEnabled || false,
                gymGoal: data.profile.gymGoal || 'muscle',
                trainingDaysPerWeek: data.profile.trainingDaysPerWeek || 3
              };
              setProfile(loadedProfile);
              // One-time migration: delete legacy favoriteSupermarket field
              if (data.profile.favoriteSupermarket !== undefined) {
                import('firebase/firestore').then(({ updateDoc }) => {
                  updateDoc(doc(db, 'users', currentUser.uid), { 'profile.favoriteSupermarket': deleteField() }).catch(console.error);
                });
              }
            }
            if (data.goals) setGoals(data.goals);
            if (data.generatedMenu) setGeneratedMenu(data.generatedMenu);
            if (data.shoppingList) setShoppingList(data.shoppingList);
            if (data.workoutPlan) setWorkoutPlan(data.workoutPlan);
            if (data.chatMessages) setChatMessages(data.chatMessages);
            if (data.checkedItems) setCheckedItems(data.checkedItems);
            
            // Load subcollections — meals via real-time listener
            if (mealsListenerRef.current) mealsListenerRef.current();
            mealsListenerRef.current = onSnapshot(
              collection(db, 'users', currentUser.uid, 'meals'),
              (snap) => {
                const loadedMeals: Meal[] = [];
                snap.forEach(d => loadedMeals.push(d.data() as Meal));
                setMeals(loadedMeals.sort((a, b) => b.timestamp - a.timestamp));
              },
              (err) => handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}/meals`)
            );

            try {
              const weightsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'weights'));
              const loadedWeights: WeightEntry[] = [];
              weightsSnap.forEach(doc => loadedWeights.push(doc.data() as WeightEntry));
              setWeights(loadedWeights.sort((a, b) => a.timestamp - b.timestamp));
            } catch (err) {
              handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}/weights`);
            }

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
          const savedWeights = localStorage.getItem('nutritivapp_weights');
          const savedChat = localStorage.getItem('nutritivapp_chat');
          const savedChecked = localStorage.getItem('nutritivapp_checked_items');

          if (savedProfile) {
            const parsed = JSON.parse(savedProfile);
            setProfile({
              ...parsed,
              name: parsed.name || '',
              allergies: Array.isArray(parsed.allergies) ? parsed.allergies : [],
              otherAllergies: parsed.otherAllergies || '',
              diabetesType: parsed.diabetesType || 'none',
              dislikedFoods: parsed.dislikedFoods || '',
              freeMealEnabled: parsed.freeMealEnabled || false,
              freeMealDay: parsed.freeMealDay || 'Sábado',
              freeMealType: parsed.freeMealType || 'cena',
              gymEnabled: parsed.gymEnabled || parsed.fitnessEnabled || false,
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
          if (savedWeights) setWeights(JSON.parse(savedWeights));
          if (savedChat) setChatMessages(JSON.parse(savedChat));
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
      localStorage.setItem('nutritivapp_weights', JSON.stringify(weights));
    }
  }, [weights, user, isDataLoaded]);

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
      localStorage.setItem('nutritivapp_chat', JSON.stringify(chatMessages));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { chatMessages }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [chatMessages, user, isDataLoaded]);

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

  useEffect(() => {
    if (!workoutPlan) return;
    // Only fill in keys that don't exist yet (handleGenerateWorkout sets them eagerly;
    // this covers the app-load case when workoutPlan is restored from Firestore)
    setGymRoutineDates(prev => {
      const next = { ...prev };
      const base = new Date(todayStr + 'T12:00:00');
      for (let i = 1; i <= (profile.trainingDaysPerWeek || 3); i++) {
        const key = `Día ${i}`;
        if (!next[key]) {
          const d = new Date(base);
          d.setDate(base.getDate() + (i - 1) * 2);
          next[key] = getLocalDateStr(d);
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutPlan]);

  // Calculate today's totals
  const todaysMeals = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return meals.filter(m => m.timestamp >= todayStart.getTime());
  }, [meals, todayStr]);

  const totals = todaysMeals.reduce(
    (acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein: acc.protein + meal.protein,
      carbs: acc.carbs + meal.carbs,
      fat: acc.fat + meal.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const getAssistantState = () => {
    const todayHabits = habits[todayStr] || { water: 0, sleep: 0 };
    const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight : 70;
    
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
    if (profile.gymEnabled && todayHabits.manualWorkout) {
      burnedCalories += (todayHabits.manualWorkout.caloriesBurned ?? (todayHabits.manualWorkout as any).calories ?? 0);
    }

    const gymDays = Math.min(7, Math.max(0, profile.trainingDaysPerWeek));
    const bmrValue = calcularBMR(profile, latestWeight);
    const sedentaryTDEE = bmrValue * 1.2;
    const activeTDEE = bmrValue * getActivityFactor(gymDays);
    const impliedCalories = Math.round((activeTDEE - sedentaryTDEE) / 7);

    // Calculate delta based on real vs implied activity
    const delta = (profile.gymEnabled && profile.trainingDaysPerWeek > 0) ? (burnedCalories - impliedCalories) : 0;
    const adjustedGoal = goals.calories + delta;

    const totalTarget = adjustedGoal;
    const consumedCalories = totals.calories;
    const remainingCalories = totalTarget - consumedCalories;
    const remainingProtein = goals.protein - totals.protein;
    
    let message = "";
    let subMessage = "";
    let stateType: 'good' | 'over' | 'under' | 'start' = 'good';

    if (totals.calories === 0) {
      stateType = 'start';
      message = "¡Buenos días!";
      subMessage = "Vamos a por tus objetivos de hoy con energía.";
    } else if (remainingCalories < -100) {
      stateType = 'over';
      message = "Límite superado";
      subMessage = "Un pequeño desvío es normal. Ajustamos en la próxima comida.";
    } else if (consumedCalories > goals.calories) {
      stateType = 'under'; // Reusing 'under' for 'within extra buffer'
      message = "¡Buen ritmo!";
      subMessage = "Estás usando el margen extra del ejercicio.";
    } else if (remainingCalories > 500) {
      stateType = 'under';
      message = "¡Buen ritmo!";
      subMessage = "Aún tienes margen para una comida completa.";
    } else {
      stateType = 'good';
      message = "¡Excelente ritmo!";
      subMessage = "Estás respetando tus macros perfectamente.";
    }

    // Add recommendation if today's meals have one
    const latestTodayMeal = todaysMeals[todaysMeals.length - 1]; // Use last meal for most recent advice
    const recommendation = latestTodayMeal ? (latestTodayMeal.actionableRecommendation || latestTodayMeal.recommendations) : null;
    
    if (recommendation) {
      const cleanRec = recommendation
        .replace(new RegExp(`${profile.name}`, 'gi'), '')
        .replace(/^(sugerencia|consejo|recomendación|tip|coach|sugerencia del coach)[:\s-]*/i, '')
        .replace(/^[,.\s]+|[,.\s]+$/g, '');
      subMessage = cleanRec; // Prioritize coach suggestion as per user request
    } else if (totals.calories > 0) {
      // Fallback encouraging message
      subMessage = "¡Sigue así, vas por muy buen camino!";
    }

    return { 
      message, 
      subMessage, 
      stateType, 
      remainingCalories, 
      burnedCalories: profile.gymEnabled ? burnedCalories : 0,
      impliedCalories: profile.gymEnabled ? impliedCalories : 0,
      totalTarget,
      baseTarget: goals.calories,
      consumedCalories
    };
  };

  const assistant = getAssistantState();

  const themeStyles = useMemo(() => {
    const isLight = profile.theme === 'light';
    return {
      mainBg: isLight ? 'bg-white' : 'bg-black',
      headerBg: isLight ? 'bg-white/95' : 'bg-black/90 font-black',
      card: isLight ? 'bg-white border-slate-100 shadow-xl shadow-slate-100/50 opacity-100' : 'bg-zinc-950/40 backdrop-blur-md border-white/5 shadow-2xl',
      glass: isLight ? 'bg-white backdrop-blur-2xl border-white/20 shadow-2xl shadow-slate-100/50' : 'bg-zinc-950/80 backdrop-blur-xl border-white/5 shadow-2xl',
      bento: isLight ? 'bg-white border-slate-100 shadow-xl shadow-slate-100/50 p-6 rounded-[2.5rem]' : 'bg-[#050505] border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] p-6 rounded-[2.5rem]',
      input: isLight ? 'bg-slate-50 border-slate-300 text-zinc-950 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-emerald-500/20' : 'bg-black border-white/10 text-white placeholder:text-zinc-600 focus:border-lime-400 focus:ring-lime-400/20 shadow-inner',
      textMain: isLight ? 'text-zinc-950' : 'text-white',
      textMuted: isLight ? 'text-slate-500' : 'text-zinc-400',
      accent: isLight ? 'text-emerald-600' : 'text-lime-400',
      accentBg: isLight ? 'bg-emerald-500' : 'bg-lime-400',
      accentBorder: isLight ? 'border-emerald-200' : 'border-lime-400/20',
      accentMuted: isLight ? 'bg-emerald-50' : 'bg-lime-400/10',
      iconBg: isLight ? 'bg-slate-50' : 'bg-[#0a0a0a]',
      border: isLight ? 'border-slate-200' : 'border-white/10',
      buttonPrimary: isLight ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-lime-400 hover:bg-lime-500 text-black shadow-[0_0_20px_rgba(163,230,53,0.3)]',
      buttonSecondary: isLight ? 'bg-white border-slate-200 text-zinc-900 hover:bg-slate-50' : 'bg-black border-white/20 text-zinc-200 hover:bg-white/5 hover:border-white/30',
    };
  }, [profile.theme]);

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
        calories: acc.calories + meal.calories,
        protein: acc.protein + meal.protein,
        carbs: acc.carbs + meal.carbs,
        fat: acc.fat + meal.fat,
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
        const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight : 70;
        
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
        if (dayHabits?.manualWorkout) {
          burnedCalories += (dayHabits.manualWorkout.caloriesBurned ?? (dayHabits.manualWorkout as any).calories ?? 0);
        }
      }
    }

    return { ...totals, burnedCalories };
  }, [meals, habits, workoutPlan, profile.gymEnabled]);

  const weeklyGoals = useMemo(() => {
    const gymDays = Math.min(7, Math.max(0, profile.trainingDaysPerWeek));
    const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight : 70;
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
  }, [goals, weeklyStats, profile, weights]);

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
    const latestWeightForBMR = weights.length > 0 ? weights[weights.length - 1].weight : 70;
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
      
      const pastWeights = weights.filter(w => w.timestamp < end);
      const dayWeight = pastWeights.length > 0 ? pastWeights[pastWeights.length - 1].weight : null;

      // Calculate burned for this specific day with independent sections
      let dayBurned = 0;
      if (profile.gymEnabled) {
        const dayHabits = habits[dayStr];
        const completed = (dayHabits?.completedExercises || []).filter(Boolean);
        if (dayHabits?.workoutDone) {
          dayBurned += dayHabits.workoutCalories ??
            calculateExpertCalories(dayWeight, profile.gymGoal, 'warm') +
            calculateExpertCalories(dayWeight, profile.gymGoal, 'main') +
            calculateExpertCalories(dayWeight, profile.gymGoal, 'cool');
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
          if (sectionsDone.has('main')) dayBurned += calculateExpertCalories(dayWeight, profile.gymGoal, 'main');
          if (sectionsDone.has('warm')) dayBurned += calculateExpertCalories(dayWeight, profile.gymGoal, 'warm');
          if (sectionsDone.has('cool')) dayBurned += calculateExpertCalories(dayWeight, profile.gymGoal, 'cool');
        }
        if (dayHabits?.manualWorkout) {
          dayBurned += (dayHabits.manualWorkout.caloriesBurned ?? (dayHabits.manualWorkout as any).calories ?? 0);
        }
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
        weight: dayWeight,
        goal: goals.calories + dayDelta
      };
    });
  }, [meals, weights, goals, habits, profile, workoutPlan, evolutionPeriod]);

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

      const info = await analyzeFoodText(text, contextStr);
      
      const newMeal: Meal = {
        id: Date.now().toString(),
        ...info,
        imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(info.foodName)}&background=27272a&color=a3e635&size=200`,
        timestamp: Date.now(),
      };

      setPortionMultiplier(1);
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
      const base64String = await compressImage(file);
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

      const info = await analyzeFoodImage(base64Data, mimeType, contextStr);

      const newMeal: Meal = {
        id: Date.now().toString(),
        ...info,
        imageUrl: base64String,
        timestamp: Date.now(),
      };

      setPortionMultiplier(1);
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

  const downloadShoppingListHTML = () => {
    if (!shoppingList) return;

    const isDark = profile.theme !== 'light';
    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lista de la Compra - NutritivApp</title>
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
        <h1>Nutritiv<span style="color: var(--lime)">App</span></h1>
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
    a.download = `lista-compra-nutritivapp.html`;
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

  const updateGoalsForProfile = (prof: UserProfile, currentWeight: number) => {
    let bmr = calcularBMR(prof, currentWeight);

    const derivedActivityLevel = getActivityFactor(prof.trainingDaysPerWeek);

    const tdee = bmr * derivedActivityLevel;

    let targetCalories = Math.round(tdee);
    if (prof.goal === 'lose') targetCalories -= 400;
    else if (prof.goal === 'gain') targetCalories += 300;

    let proteinRatio = 0.3, carbsRatio = 0.4, fatRatio = 0.3;
    switch (prof.macroDistribution) {
      case 'low_carb': proteinRatio = 0.4; carbsRatio = 0.2; fatRatio = 0.4; break;
      case 'high_protein': proteinRatio = 0.4; carbsRatio = 0.3; fatRatio = 0.3; break;
      case 'keto': proteinRatio = 0.25; carbsRatio = 0.05; fatRatio = 0.7; break;
    }

    const newGoals = {
      calories: targetCalories,
      protein: Math.round((targetCalories * proteinRatio) / 4),
      carbs: Math.round((targetCalories * carbsRatio) / 4),
      fat: Math.round((targetCalories * fatRatio) / 9),
    };
    
    setGoals(newGoals);
    return newGoals;
  };

  const handleAddWeight = (e: React.FormEvent) => {
    e.preventDefault();
    const weightVal = parseFloat(newWeight);
    if (!isNaN(weightVal) && weightVal > 0) {
      const newEntry: WeightEntry = {
        id: Date.now().toString(),
        weight: weightVal,
        timestamp: Date.now(),
      };
      setWeights(prev => [...prev, newEntry].sort((a, b) => a.timestamp - b.timestamp));
      if (user) {
        setDoc(doc(db, 'users', user.uid, 'weights', newEntry.id), newEntry).catch(console.error);
      }
      setIsWeightModalOpen(false);
      setNewWeight('');
      
      if (profile.age > 0 && profile.height > 0) {
        const newGoals = updateGoalsForProfile(profile, weightVal);
        handleGenerateMenu(profile, newGoals, weightVal);
      }
    }
  };

  const handleGenerateMenu = async (customProfile?: UserProfile, customGoals?: typeof goals, customWeight?: number) => {
    const activeProfile = customProfile || profile;
    if (activeProfile.age === 0) return;
    setIsGeneratingMenu(true);
    setProgressMsgIdx(0);
    setGeneratedMenu(null);
    setShoppingList(null);
    setAppError(null);
    setMenuSelectedDay(0);
    setExpandedMeal(0);
    if (menuTabsRef.current) menuTabsRef.current.scrollLeft = 0;
    try {
      const currentWeight = customWeight || (weights.length > 0 ? weights[weights.length - 1].weight : 70);
      const menu = await generateWeeklyMenu(activeProfile, currentWeight);
      setGeneratedMenu(menu);
    } catch (error: any) {
      showError(error.message || 'Error al generar el plan. Inténtalo de nuevo.');
    } finally {
      setIsGeneratingMenu(false);
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
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentChatMessage.trim()) return;

    const newUserMessage = currentChatMessage;
    const newMessages = [...chatMessages, { role: 'user' as const, parts: [{ text: newUserMessage }] }];
    setChatMessages([...newMessages, { role: 'model' as const, parts: [{ text: '' }] }]);
    setCurrentChatMessage('');
    setIsChatLoading(true);

    try {
      const conversationHistory: ChatMessage[] = newMessages.map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.parts.map(p => p.text).join(''),
      }));

      const currentWeight = weights.length > 0 ? weights[weights.length - 1].weight : 70;
      const userContext: CoachUserContext = {
        profile: { ...profile, currentWeight },
        goals,
        mealsToday: todaysMeals,
        caloriesConsumedToday: totals.calories,
      };

      await chatWithCoach(conversationHistory, userContext, (chunk) => {
        setChatMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'model') {
            updated[updated.length - 1] = { ...last, parts: [{ text: last.parts[0].text + chunk }] };
          }
          return updated;
        });
      });
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'model' && last.parts[0].text === '') {
          updated[updated.length - 1] = { role: 'model', parts: [{ text: 'Hubo un error de conexión. Inténtalo de nuevo.' }] };
          return updated;
        }
        return [...prev, { role: 'model', parts: [{ text: 'Hubo un error de conexión. Inténtalo de nuevo.' }] }];
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const weightVal = parseFloat(editWeight);
    
    if (isNaN(weightVal) || weightVal <= 0 || editProfile.age <= 0 || editProfile.height <= 0) {
      return;
    }

    // Save weight if it's new
    const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight : null;
    if (weightVal !== latestWeight) {
      const newEntry: WeightEntry = {
        id: Date.now().toString(),
        weight: weightVal,
        timestamp: Date.now(),
      };
      setWeights(prev => [...prev, newEntry].sort((a, b) => a.timestamp - b.timestamp));
      if (user) {
        setDoc(doc(db, 'users', user.uid, 'weights', newEntry.id), newEntry).catch(console.error);
      }
    }

    // Compare key fields to decide on regeneration
    const dietChanged = 
      editProfile.dietType !== profile.dietType || 
      editProfile.goal !== profile.goal || 
      editProfile.diabetesType !== profile.diabetesType ||
      editProfile.dislikedFoods !== profile.dislikedFoods ||
      JSON.stringify(editProfile.allergies) !== JSON.stringify(profile.allergies) ||
      editProfile.macroDistribution !== profile.macroDistribution;

    const gymChanged = 
      editProfile.gymGoal !== profile.gymGoal || 
      editProfile.workoutType !== profile.workoutType ||
      editProfile.gymEnabled !== profile.gymEnabled ||
      editProfile.diabetesType !== profile.diabetesType ||
      editProfile.trainingDaysPerWeek !== profile.trainingDaysPerWeek ||
      editProfile.age !== profile.age ||
      editProfile.height !== profile.height ||
      weightVal !== latestWeight;

    setProfile(editProfile);
    
    const newGoals = updateGoalsForProfile(editProfile, weightVal);

    // Auto-regenerate menu if diet relevant fields changed
    if (dietChanged) {
      handleGenerateMenu(editProfile, newGoals, weightVal);
    }

    // Auto-regenerate workout plan if gym relevant fields changed
    if (editProfile.gymEnabled && (gymChanged || !workoutPlan)) {
      handleGenerateWorkout(editProfile);
    }

    setIsGoalModalOpen(false);
  };

  const getSessionCalories = () => {
    const currentWeight = weights.length > 0 ? weights[weights.length - 1].weight : 70;
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

    setIsGeneratingWorkout(true);
    try {
      const profileStr = JSON.stringify({
        ...targetProfile,
        diabetes: targetProfile.diabetesType,
        currentWeight: weights.length > 0 ? weights[weights.length - 1].weight : 'Desconocido'
      });
      const plan = await generateWorkoutPlan(profileStr);
      setWorkoutPlan(plan);
    } catch (error: any) {
      console.error("Error generating workout:", error);
      showError(error?.message || "Error al generar tu rutina de entrenamiento.");
    } finally {
      setIsGeneratingWorkout(false);
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

  const isStagnant = useMemo(() => {
    if (weights.length < 3) return false;
    const latest = weights[weights.length - 1];
    const twoWeeksAgo = latest.timestamp - 14 * 24 * 60 * 60 * 1000;
    const recentWeights = weights.filter(w => w.timestamp >= twoWeeksAgo);
    if (recentWeights.length >= 3) {
      const max = Math.max(...recentWeights.map(w => w.weight));
      const min = Math.min(...recentWeights.map(w => w.weight));
      if (max - min <= 0.5) return true;
    }
    return false;
  }, [weights]);

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
      const currentWeight = weights.length > 0 ? weights[weights.length - 1].weight : 70;
      await chatWithCoach(
        [{ role: 'user', content: prompt }],
        { profile: { ...profile, currentWeight }, goals, mealsToday: todaysMeals, caloriesConsumedToday: totals.calories },
        (chunk) => { result += chunk; }
      );
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
      await signInWithPopup(auth, provider);
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
    try {
      await signOut(auth);
      // Clear localStorage on logout
      localStorage.removeItem('nutritivapp_meals');
      localStorage.removeItem('nutritivapp_weights');
      localStorage.removeItem('nutritivapp_goals');
      localStorage.removeItem('nutritivapp_profile');
      localStorage.removeItem('nutritivapp_habits');
      localStorage.removeItem('nutritivapp_generated_menu');
      localStorage.removeItem('nutritivapp_shopping_list');
      localStorage.removeItem('nutritivapp_chat');

      // Reset state on logout
      setMeals([]);
      setWeights([]);
      setGoals(DEFAULT_GOALS);
      setProfile({
        name: '',
        age: 0,
        height: 170,
        gender: 'male',
        dietType: 'Normal',
        allergies: [],
        otherAllergies: '',
        diabetesType: 'none',
        dislikedFoods: '',
        goal: 'maintain',
        macroDistribution: 'balanced',
        freeMealEnabled: false,
        freeMealDay: 'Sábado',
        freeMealType: 'cena',
        gymEnabled: false,
        workoutType: 'gym',
        gymGoal: 'maintenance',
        trainingDaysPerWeek: 3,
        theme: 'light'
      });
      setHabits({});
      setGeneratedMenu(null);
      setShoppingList(null);
      setChatMessages([
        { role: 'model', parts: [{ text: '¡Hola! Soy tu entrenador y nutricionista personal. ¿En qué te puedo ayudar hoy?' }] }
      ]);
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
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 text-center"
        >
          <div className={`w-16 h-16 ${themeStyles.accentBg} rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg`}>
            <Banana className="w-10 h-10 text-zinc-950" />
          </div>
          <h1 className="text-3xl font-display font-black tracking-tighter text-white mb-8 text-center">
            {isRegistering ? 'Regístrate para empezar' : 'Inicia sesión en NutritivApp'}
          </h1>
          
          <div className="space-y-3 mb-8">
            <button
              onClick={handleGoogleLogin}
              className={`w-full bg-transparent border border-zinc-500 text-white font-bold py-3 px-6 rounded-full flex items-center justify-center gap-3 hover:${themeStyles.accentBorder} hover:${themeStyles.accent} transition-all`}
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
              <div className="w-full border-t border-zinc-800"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-zinc-950 px-4 text-zinc-400">o</span>
            </div>
          </div>
          
          <form onSubmit={handleEmailAuth} className="space-y-5 text-left">
            {authError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-rose-400 text-sm">
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
              <label className="block text-sm font-bold text-white mb-2">Dirección de correo electrónico</label>
              <input 
                type="email" 
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
                className={`w-full bg-zinc-900 border border-zinc-700 rounded-md px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-current transition-all placeholder:text-zinc-500 ${themeStyles.accent}`}
                placeholder="Correo electrónico"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-white">Contraseña</label>
              </div>
              <input 
                type="password" 
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                minLength={6}
                className={`w-full bg-zinc-900 border border-zinc-700 rounded-md px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-current transition-all placeholder:text-zinc-500 ${themeStyles.accent}`}
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
              
              <div className="pt-8 border-t border-zinc-800">
                <p className="text-zinc-400 text-sm mb-4">
                  {isRegistering ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta?'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistering(!isRegistering);
                    setAuthError(null);
                  }}
                  className={`text-white font-bold hover:${themeStyles.accent} hover:underline transition-all`}
                >
                  {isRegistering ? 'Inicia sesión aquí' : 'Regístrate en NutritivApp'}
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
      <header className={`pt-12 pb-6 px-6 sticky top-0 backdrop-blur-2xl z-50 border-b ${themeStyles.headerBg} ${profile.theme === 'light' ? 'border-slate-200' : 'border-white/5'}`}>
        <div className="flex items-center justify-between max-w-md mx-auto">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col"
          >
            <h1 className={`text-2xl font-display font-black tracking-tighter ${themeStyles.textMain} flex items-center gap-2`}>
              <Banana className={`w-6 h-6 ${themeStyles.accent} fill-current/20`} />
              Nutritiv<span className={themeStyles.accent}>App</span>
            </h1>
            <p className={`${themeStyles.textMuted} text-[10px] font-bold tracking-[0.2em] uppercase mt-0.5`}>Coach de Rendimiento</p>
          </motion.div>
          <div className="flex items-center gap-3">
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => {
                const newTheme = profile.theme === 'light' ? 'dark' : 'light';
                setProfile({ ...profile, theme: newTheme });
              }}
              className={`h-10 w-10 rounded-xl ${themeStyles.iconBg} border ${themeStyles.border} shadow-sm hover:opacity-80 flex items-center justify-center transition-colors`}
              title="Cambiar tema"
            >
              {profile.theme === 'light' ? <Moon className={`w-4 h-4 ${themeStyles.textMain}`} /> : <Sun className={`w-4 h-4 ${themeStyles.textMain}`} />}
            </motion.button>
            <motion.button 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => { 
                setEditProfile({
                  ...profile,
                  allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
                  dislikedFoods: profile.dislikedFoods || ''
                });
                const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight.toString() : '';
                setEditWeight(latestWeight);
                setIsGoalModalOpen(true); 
              }}
              className={`relative h-10 px-3 rounded-xl flex items-center justify-center gap-2 transition-all ${
                profile.age === 0 
                  ? (profile.theme === 'light' ? 'bg-emerald-500 shadow-emerald-500/20 shadow-lg' : 'bg-lime-400 shadow-[0_0_20px_rgba(163,230,53,0.4)] shadow-lg')
                  : `${themeStyles.iconBg} border ${themeStyles.border} shadow-sm hover:${themeStyles.iconBg}`
              }`}
            >
              <UserIcon className={`w-5 h-5 ${profile.age === 0 ? 'text-zinc-950' : themeStyles.accent}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider hidden sm:block ${profile.age === 0 ? 'text-zinc-950' : themeStyles.accent}`}>
                Perfil
              </span>
              {profile.age === 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                </span>
              )}
            </motion.button>
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleLogout}
              className="h-10 w-10 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </header>

      {/* Global Profile Warning */}
      {profile.age === 0 && (
        <div className="max-w-md mx-auto px-6 pt-4">
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-rose-400 font-bold text-sm mb-1">Perfil incompleto</h3>
              <p className="text-rose-400/80 text-xs">
                Para calcular tus macros y generar planes personalizados, necesitas configurar tu perfil. Toca el botón resaltado arriba a la derecha.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="px-6 pt-6 max-w-md mx-auto space-y-8">
        {/* Tabs */}
        <div className={`flex flex-nowrap overflow-x-auto hide-scrollbar ${profile.theme === 'light' ? 'bg-slate-200/50' : 'bg-zinc-950/80'} backdrop-blur-md p-1.5 rounded-2xl border ${profile.theme === 'light' ? 'border-slate-300/50' : 'border-white/5'} mb-8 shadow-2xl gap-1`}>
          <button 
            onClick={() => setActiveTab('today')}
            className={`flex-1 shrink-0 px-4 py-2.5 text-[10px] flex items-center justify-center gap-1.5 font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${activeTab === 'today' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white shadow-emerald-500/20' : 'text-zinc-950 shadow-lime-400/20'} shadow-lg` : `${themeStyles.textMuted} hover:text-current`}`}
          >
            <Activity className="w-3.5 h-3.5" />
            Resumen
          </button>
          <button 
            onClick={() => setActiveTab('meals')}
            className={`flex-[1.2] shrink-0 px-4 py-2.5 text-[10px] flex items-center justify-center gap-1.5 font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${activeTab === 'meals' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white shadow-emerald-500/20' : 'text-zinc-950 shadow-lime-400/20'} shadow-lg` : `${themeStyles.textMuted} hover:text-current`}`}
          >
            <Utensils className="w-3.5 h-3.5" />
            Consumir Calorías
          </button>
          {profile.gymEnabled && (
            <button 
              onClick={() => setActiveTab('gym')}
              className={`flex-[1.2] shrink-0 px-4 py-2.5 text-[10px] flex items-center justify-center gap-1.5 font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${activeTab === 'gym' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white shadow-emerald-500/20' : 'text-zinc-950 shadow-lime-400/20'} shadow-lg` : `${themeStyles.textMuted} hover:text-current`}`}
            >
              <Flame className="w-3.5 h-3.5" />
              Quemar Calorías
            </button>
          )}
        </div>

          <AnimatePresence mode="wait">
          {activeTab === 'today' && (
            <motion.div
              key="today"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6 pb-32"
            >
              <div className="flex flex-col gap-4">
                {/* Period Selector Dropdown */}
                <div className="relative w-full">
                  <select 
                    value={evolutionPeriod}
                    onChange={(e) => setEvolutionPeriod(e.target.value as any)}
                    className={`w-full ${themeStyles.card} rounded-2xl px-5 py-4 text-xs font-black uppercase tracking-widest ${themeStyles.textMain} shadow-xl focus:outline-none focus:${themeStyles.accentBorder} appearance-none cursor-pointer transition-all ${profile.theme === 'light' ? 'hover:bg-slate-50' : 'hover:bg-zinc-800'}`}
                  >
                    <option value="today" className={profile.theme === 'light' ? 'text-slate-900 bg-white' : 'text-white bg-zinc-900'}>Hoy</option>
                    <option value="weekly" className={profile.theme === 'light' ? 'text-slate-900 bg-white' : 'text-white bg-zinc-900'}>Semanal</option>
                    <option value="monthly" className={profile.theme === 'light' ? 'text-slate-900 bg-white' : 'text-white bg-zinc-900'}>Mensual</option>
                    <option value="quarterly" className={profile.theme === 'light' ? 'text-slate-900 bg-white' : 'text-white bg-zinc-900'}>Trimestral</option>
                    <option value="semiannually" className={profile.theme === 'light' ? 'text-slate-900 bg-white' : 'text-white bg-zinc-900'}>Semestral</option>
                    <option value="annually" className={profile.theme === 'light' ? 'text-slate-900 bg-white' : 'text-white bg-zinc-900'}>Anual</option>
                  </select>
                  <ChevronDown className={`absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 ${themeStyles.accent} pointer-events-none`} />
                </div>

                {evolutionPeriod === 'today' ? (
                  <div className="space-y-6">
                    <div className="space-y-6">
                      {/* 1. Assistant Header (Calories) - Reordered Top */}
                        <div className={`${themeStyles.bento} p-8 relative overflow-hidden group border-b-4 ${assistant.stateType === 'over' ? 'border-amber-500' : (profile.theme === 'light' ? 'border-emerald-500' : themeStyles.accentBorder)} shadow-2xl`}>
                          <div className={`absolute top-0 right-0 w-64 h-64 ${profile.theme === 'light' ? 'bg-emerald-500/5' : '${themeStyles.accentMuted}'} rounded-full blur-3xl`} />
                          <div className="relative z-10">
                            <div className="flex flex-col md:flex-row gap-8 items-start md:items-center justify-between">
                               <div className="space-y-4 max-w-xl text-center md:text-left">
                                  <div className="flex items-center justify-center md:justify-start gap-2.5">
                                    <div className={`p-2 ${themeStyles.accentBg} rounded-xl shadow-lg`}>
                                      <Bot className={`w-4 h-4 ${profile.theme === 'light' ? 'text-white' : 'text-zinc-900'}`} />
                                    </div>
                                    <span className={`text-[10px] font-black ${themeStyles.accent} uppercase tracking-[0.25em]`}>Coach NutritivApp</span>
                                  </div>
                                  <h3 className={`text-4xl md:text-5xl font-display font-black tracking-tighter leading-none ${themeStyles.textMain}`}>
                                    {assistant.message}
                                  </h3>
                                  <p className={`text-sm ${themeStyles.textMuted} font-medium leading-relaxed italic max-w-md`}>
                                    "{assistant.subMessage}"
                                  </p>
                               </div>
                               
                               <div className="flex flex-col items-center md:items-end gap-2 group-hover:scale-105 transition-transform">
                                  <span className={`text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest`}>Margen de hoy</span>
                                  <span className={`text-6xl font-display font-black tracking-tighter ${
                                    assistant.remainingCalories < 0 ? 'text-amber-500' : 
                                    (assistant.burnedCalories > assistant.impliedCalories) 
                                      ? (profile.theme === 'light' ? 'text-emerald-500' : 'text-lime-400')
                                      : (profile.theme === 'light' ? 'text-emerald-600' : themeStyles.accent)
                                  }`}>
                                    {Math.round(assistant.remainingCalories)}
                                  </span>
                                  <span className={`text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest`}>kcal restantes</span>
                               </div>
                            </div>

                            {/* Visual Progress Bar */}
                            <div className="mt-10 space-y-3">
                               <div className="flex justify-between items-end">
                                  <div className="flex items-center gap-3">
                                    <div className="flex flex-col">
                                      <span className={`text-[9px] font-black ${themeStyles.textMuted} uppercase tracking-widest`}>Consumido</span>
                                      <span className={`text-xl font-black ${themeStyles.textMain}`}>{Math.round(assistant.consumedCalories)} <span className="text-[10px] opacity-40">kcal</span></span>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <span className={`text-[9px] font-black ${themeStyles.textMuted} uppercase tracking-widest`}>Puedes llegar a</span>
                                    <span className={`text-xl font-black ${
                                      (assistant.burnedCalories > assistant.impliedCalories)
                                        ? (profile.theme === 'light' ? 'text-emerald-500' : 'text-lime-400')
                                        : themeStyles.textMain
                                    }`}>
                                      {Math.round(assistant.totalTarget)} 
                                      <span className="text-[10px] ml-1 opacity-40">kcal</span>
                                    </span>
                                  </div>
                               </div>
                               <div className={`h-4 ${profile.theme === 'light' ? 'bg-slate-100' : 'bg-zinc-900'} rounded-full overflow-hidden border ${themeStyles.border} shadow-inner p-1 relative`}>
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, (assistant.consumedCalories / assistant.totalTarget) * 100)}%` }}
                                    className={`h-full rounded-full relative z-10 ${
                                       assistant.remainingCalories < 0 ? 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]' :
                                       assistant.consumedCalories > 0 ? (profile.theme === 'light' ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-lime-400 shadow-[0_0_20px_rgba(163,230,53,0.6)]') :
                                       ''
                                    }`}
                                  />
                               </div>
                            </div>
                          </div>
                        </div>

                        {/* 2. Exercise Delta - Moved here */}
                        {user && (
                          <ExerciseDelta 
                            profile={profile} 
                            goals={goals} 
                            userId={user.uid} 
                            realCalories={assistant.burnedCalories}
                            impliedCalories={assistant.impliedCalories}
                            themeStyles={themeStyles} 
                          />
                        )}

                        {/* 3. Distribution (Macros) */}
                        <div className={`${themeStyles.bento} p-6 space-y-6 relative overflow-hidden`}>
                           <div className="flex items-center justify-between">
                             <h4 className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-widest`}>Distribución de Macros</h4>
                             <PieChart className={`w-4 h-4 ${themeStyles.textMuted}`} />
                           </div>
                           <div className="space-y-5">
                             {/* Protein */}
                             <div className="space-y-1.5 text-xs font-black">
                               <div className="flex justify-between uppercase tracking-tighter">
                                 <span className={themeStyles.accent}>Proteínas</span>
                                 <span className={themeStyles.textMuted}>{Math.round(totals.protein)}<span className="opacity-40"> / {goals.protein}g</span></span>
                               </div>
                               <div className={`h-3 ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-900'} rounded-full border ${themeStyles.border} overflow-hidden shadow-inner`}>
                                 <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, (totals.protein / goals.protein) * 100)}%` }} className={`h-full ${profile.theme === 'light' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-lime-400 shadow-[0_0_15px_rgba(163,230,53,0.6)]'} rounded-full font-black`} />
                               </div>
                             </div>
                             {/* Carbs */}
                             <div className="space-y-1.5 text-xs font-black">
                               <div className="flex justify-between uppercase tracking-tighter">
                                 <span className={themeStyles.accent}>Hidratos</span>
                                 <span className={themeStyles.textMuted}>{Math.round(totals.carbs)}<span className="opacity-40"> / {goals.carbs}g</span></span>
                               </div>
                               <div className={`h-3 ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-900'} rounded-full border ${themeStyles.border} overflow-hidden shadow-inner`}>
                                 <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, (totals.carbs / goals.carbs) * 100)}%` }} className={`h-full ${profile.theme === 'light' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-lime-400 shadow-[0_0_15px_rgba(163,230,53,0.6)]'} rounded-full font-black`} />
                               </div>
                             </div>
                             {/* Fats */}
                             <div className="space-y-1.5 text-xs font-black">
                               <div className="flex justify-between uppercase tracking-tighter">
                                 <span className={themeStyles.accent}>Grasas</span>
                                 <span className={themeStyles.textMuted}>{Math.round(totals.fat)}<span className="opacity-40"> / {goals.fat}g</span></span>
                               </div>
                               <div className={`h-3 ${profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-900'} rounded-full border ${themeStyles.border} overflow-hidden shadow-inner`}>
                                 <motion.div 
                                   initial={{ width: 0 }} 
                                   animate={{ width: `${Math.min(100, (totals.fat / goals.fat) * 100)}%` }} 
                                   className={`h-full ${profile.theme === 'light' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-lime-400 shadow-[0_0_15px_rgba(163,230,53,0.6)]'} rounded-full font-black`} 
                                 />
                               </div>
                             </div>
                           </div>
                        </div>
                      </div>
                    </div>
            ) : (
              <section>
                  <div className={`${themeStyles.bento} p-8 relative overflow-hidden`}>
                    <div className={`absolute top-0 right-0 w-64 h-64 ${profile.theme === 'light' ? 'bg-emerald-500/5' : '${themeStyles.accentMuted}'} rounded-full blur-3xl`}></div>
                    
                    <div className="flex items-center gap-4 mb-10 relative z-10">
                      <div className={`p-3 ${themeStyles.accentBg} rounded-2xl shadow-lg`}>
                        <TrendingUp className={`w-6 h-6 ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'}`} />
                      </div>
                      <div>
                        <h2 className={`text-xl font-display font-black ${themeStyles.textMain} tracking-tight uppercase`}>Análisis Histórico</h2>
                        <p className={`text-[10px] font-black ${themeStyles.accent} uppercase tracking-widest opacity-60`}>Seguimiento de Calorías</p>
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
                            interval={evolutionPeriod === 'weekly' ? 0 : evolutionPeriod === 'monthly' ? 4 : Math.floor(trendsData.length / 8)}
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
                            barSize={evolutionPeriod === 'weekly' ? 24 : evolutionPeriod === 'monthly' ? 12 : 4} 
                            name="Consumidas" 
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
                    
                    <div className={`mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[10px] font-black uppercase tracking-widest ${themeStyles.textMuted} border-t ${themeStyles.border} pt-8`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-sm ${themeStyles.accentBg} shadow-sm`}></div>
                        <span className={themeStyles.textMain}>Consumidas</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-0.5 bg-indigo-400 border-t border-dashed border-indigo-400"></div>
                        <span className={themeStyles.textMain}>Puedes llegar a</span>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </motion.div>
        )}
          {activeTab === 'meals' && (
            <motion.div
              key="meals"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6 pb-32"
            >
              {/* Meals Sub Tabs */}
              <div className={`grid ${generatedMenu ? 'grid-cols-3' : 'grid-cols-2'} ${themeStyles.iconBg} p-1 rounded-2xl border ${themeStyles.border} shadow-lg mb-6`}>
                <button
                  onClick={() => setMealsSubTab('daily')}
                  className={`py-3 text-[10px] flex items-center justify-center gap-1.5 font-black uppercase tracking-widest rounded-xl transition-all ${mealsSubTab === 'daily' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                >
                  <Utensils className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Comidas del día</span>
                  <span className="sm:hidden">Hoy</span>
                </button>
                <button
                  onClick={() => setMealsSubTab('plan')}
                  className={`py-3 text-[10px] flex items-center justify-center gap-1.5 font-black uppercase tracking-widest rounded-xl transition-all ${mealsSubTab === 'plan' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  Plan
                </button>
                {generatedMenu && (
                  <button
                    onClick={() => setMealsSubTab('shopping')}
                    className={`py-3 text-[10px] flex items-center justify-center gap-1.5 font-black uppercase tracking-widest rounded-xl transition-all ${mealsSubTab === 'shopping' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Compra
                  </button>
                )}
              </div>

              {mealsSubTab === 'daily' ? (
                <div className="space-y-8">
                {/* Primary Food Entry */}
                <div className={`${themeStyles.bento} p-6 relative overflow-hidden`}>
                  <div className={`absolute top-0 right-0 w-32 h-32 ${profile.theme === 'light' ? 'bg-emerald-500/5' : '${themeStyles.accentMuted}'} rounded-full blur-2xl`}></div>
                  <h3 className={`text-lg font-display font-bold ${themeStyles.textMain} tracking-tight uppercase mb-4 relative z-10 flex items-center gap-2`}>
                    <Plus className={`w-5 h-5 ${themeStyles.accent}`} />
                    Añadir Comida
                  </h3>
                  <div className="relative mb-4 z-10">
                    <input
                      type="text"
                      placeholder="Ej: He comido arroz con pollo..."
                      className={`w-full ${themeStyles.input} rounded-2xl pl-5 pr-14 py-5 transition-all text-base shadow-inner`}
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
                      className={`absolute right-2.5 top-2.5 bottom-2.5 ${themeStyles.buttonPrimary} px-5 rounded-xl transition-colors flex items-center justify-center shadow-lg disabled:opacity-50`}
                      onClick={() => {
                        if (textFoodCooldown.isActive) return;
                        const input = document.querySelector('input[placeholder="Ej: He comido arroz con pollo..."]') as HTMLInputElement;
                        if (input && input.value) {
                          textFoodCooldown.start();
                          handleTextFoodSubmit(input.value);
                          input.value = '';
                        }
                      }}
                    >
                      {textFoodCooldown.isActive
                        ? <span className="text-xs font-mono font-bold">{textFoodCooldown.remaining}s</span>
                        : <Send className="w-5 h-5" />}
                    </button>
                  </div>
                  <button
                    disabled={imageFoodCooldown.isActive}
                    onClick={() => {
                      if (imageFoodCooldown.isActive) return;
                      imageFoodCooldown.start();
                      setAppError(null);
                      fileInputRef.current?.click();
                    }}
                    className={`w-full flex items-center justify-center gap-3 ${themeStyles.buttonSecondary} p-5 rounded-2xl transition-all border group relative z-10 disabled:opacity-50`}
                  >
                    <Camera className={`w-5 h-5 ${themeStyles.accent} group-hover:scale-110 transition-transform`} />
                    <span className="text-sm font-black uppercase tracking-widest">
                      {imageFoodCooldown.isActive ? `Espera ${imageFoodCooldown.remaining}s` : 'Escanear comida'}
                    </span>
                  </button>
                </div>

                {/* Meal List */}
                <section>
                  <div className="flex items-center justify-between mb-6 px-2">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 ${themeStyles.accentMuted} rounded-xl border ${themeStyles.accentBorder}`}>
                        <Utensils className={`w-5 h-5 ${themeStyles.accent}`} />
                      </div>
                      <h2 className={`text-lg font-display font-bold ${themeStyles.textMain} tracking-tight uppercase`}>Registros de hoy</h2>
                    </div>
                    <span className={`text-[10px] font-black ${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} px-3 py-1 rounded-full shadow-lg uppercase tracking-widest`}>
                      {todaysMeals.length} ítems
                    </span>
                  </div>
                  
                  <div className="space-y-4">
                    <AnimatePresence mode="popLayout">
                      {todaysMeals.length === 0 ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`text-center py-16 ${themeStyles.iconBg} rounded-[2.5rem] border ${themeStyles.border} border-dashed`}>
                          <Utensils className={`w-8 h-8 ${themeStyles.textMuted} mx-auto mb-3 opacity-20`} />
                          <p className={`${themeStyles.textMuted} font-bold uppercase tracking-widest text-xs`}>No hay registros hoy</p>
                          <p className={`${themeStyles.textMuted} text-[10px] mt-1 opacity-60`}>Usa el buscador o la cámara para empezar</p>
                        </motion.div>
                      ) : (
                        todaysMeals.map((meal) => (
                          <motion.div
                            key={meal.id} layout
                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                            className={`${themeStyles.card} rounded-3xl p-5 flex gap-5 group transition-all`}
                          >
                            <div className={`w-16 h-16 rounded-2xl overflow-hidden ${themeStyles.iconBg} shrink-0 shadow-xl border ${themeStyles.border}`}>
                              <img src={meal.imageUrl} alt={meal.foodName} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between mb-1">
                                <h3 className={`font-bold ${themeStyles.textMain} truncate text-base tracking-tight`}>{meal.foodName}</h3>
                                <button onClick={() => removeMeal(meal.id)} className={`${themeStyles.textMuted} hover:text-rose-500 p-1 rounded-lg hover:bg-rose-500/10 transition-all`}>
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                                <span className={`${themeStyles.accent} font-black text-xs tracking-tight`}>{Math.round(meal.calories)} Kcal</span>
                                <div className={`flex items-center gap-3 text-[10px] font-black uppercase ${themeStyles.textMuted} tracking-wider`}>
                                  <span className={themeStyles.textMain}>P:{Math.round(meal.protein)}g</span>
                                  <span className={themeStyles.textMain}>H:{Math.round(meal.carbs)}g</span>
                                  <span className={themeStyles.textMain}>G:{Math.round(meal.fat)}g</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <NutriScoreBadge score={meal.nutriScore} />
                                {meal.isHealthy && (
                                  <span className={`px-2 py-0.5 rounded-full ${themeStyles.accentMuted} ${themeStyles.accent} text-[9px] font-black uppercase tracking-widest border ${themeStyles.accentBorder}`}>Saludable</span>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </section>
              </div>
              ) : mealsSubTab === 'plan' ? (
                <div className="space-y-6">
                <p className={`${themeStyles.textMain} text-sm font-medium mb-4`}>
                    Esta es una propuesta de menú semanal para ayudarte a cumplir con tus objetivos de calorías y macronutrientes.
                </p>
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
                      const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight.toString() : '';
                      setEditWeight(latestWeight);
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
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Utensils className={`w-6 h-6 ${themeStyles.accent}`} />
                        <h2 className={`text-xl font-display font-bold ${themeStyles.textMain} uppercase tracking-tight`}>Menú Semanal</h2>
                      </div>
                    </div>
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
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-widest`}>
                              Plan de {profile.name || 'Usuario'}
                            </p>
                            <p className={`text-[10px] ${themeStyles.textMuted} mt-0.5`}>
                              {generatedMenu.days?.length || 0} días · {profile.goal === 'lose' ? 'Perder grasa' : profile.goal === 'gain' ? 'Ganar músculo' : 'Mantenimiento'}
                            </p>
                          </div>
                          <button
                            disabled={menuCooldown.isActive || isGeneratingMenu}
                            onClick={() => { menuCooldown.start(); handleGenerateMenu(profile, goals, weights.length > 0 ? weights[weights.length - 1].weight : 70); }}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border ${themeStyles.border} ${themeStyles.iconBg} ${themeStyles.textMuted} text-[9px] font-black uppercase tracking-widest hover:${themeStyles.textMain} transition-all disabled:opacity-50`}
                          >
                            <RefreshCw className="w-3 h-3" />
                            {menuCooldown.isActive ? `Espera ${menuCooldown.remaining}s` : 'Regenerar'}
                          </button>
                        </div>

                        {/* Day tabs */}
                        <div ref={menuTabsRef} className="flex overflow-x-auto gap-2 pb-1 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                          {generatedMenu.days.map((day: any, dIdx: number) => (
                            <button
                              key={dIdx}
                              onClick={() => { setMenuSelectedDay(dIdx); setExpandedMeal(0); }}
                              className={`flex-shrink-0 px-4 py-2 rounded-xl text-[10px] uppercase font-black tracking-widest transition-all ${
                                menuSelectedDay === dIdx
                                  ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md`
                                  : `border ${themeStyles.accentBorder} ${themeStyles.accent} ${themeStyles.iconBg}`
                              }`}
                            >
                              {(day.day || `Día ${dIdx + 1}`).slice(0, 3)}
                            </button>
                          ))}
                        </div>

                        {/* Selected day */}
                        {generatedMenu.days[menuSelectedDay] && (
                          <div className={`${themeStyles.card} rounded-2xl overflow-hidden border ${themeStyles.border}`}>
                            {/* Day summary pills */}
                            <div className={`px-5 py-4 border-b ${themeStyles.border}`}>
                              <p className={`text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-[0.2em] mb-3`}>
                                {generatedMenu.days[menuSelectedDay].day}
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                {[
                                  { label: '', value: `${generatedMenu.days[menuSelectedDay].calorias ?? '—'} kcal` },
                                  { label: 'P', value: `${generatedMenu.days[menuSelectedDay].proteinas ?? '—'}g` },
                                  { label: 'C', value: `${generatedMenu.days[menuSelectedDay].carbohidratos ?? '—'}g` },
                                  { label: 'G', value: `${generatedMenu.days[menuSelectedDay].grasas ?? '—'}g` },
                                ].map(pill => (
                                  <span key={pill.label || 'kcal'} className={`${themeStyles.accentMuted} ${themeStyles.accent} text-[10px] font-black px-3 py-1 rounded-full border ${themeStyles.accentBorder}`}>
                                    {pill.label ? `${pill.label}:` : ''}{pill.value}
                                  </span>
                                ))}
                              </div>
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
                                          <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{meal.type || 'Comida'} · COMIDA LIBRE</p>
                                          <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">¡Disfrútala sin culpa!</p>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => setExpandedMeal(expandedMeal === mIdx ? -1 : mIdx)}
                                          className={`w-full px-5 py-4 flex items-center justify-between text-left transition-colors ${expandedMeal === mIdx ? themeStyles.iconBg : ''}`}
                                        >
                                          <span className={`text-[11px] font-black ${themeStyles.textMain} uppercase tracking-wider`}>
                                            {meal.type || '—'}
                                          </span>
                                          <div className="flex items-center gap-3 shrink-0">
                                            <span className={`text-[11px] font-black ${themeStyles.accent}`}>{meal.calories ?? '—'} kcal</span>
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
                                              <div className="flex gap-4 pt-1">
                                                <span className={`text-[10px] font-bold ${themeStyles.accent}`}>P:{meal.proteinas ?? '—'}g</span>
                                                <span className={`text-[10px] font-bold ${themeStyles.accent}`}>C:{meal.carbohidratos ?? '—'}g</span>
                                                <span className={`text-[10px] font-bold ${themeStyles.accent}`}>G:{meal.grasas ?? '—'}g</span>
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
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <p className={`${themeStyles.textMuted} text-center py-8`}>Genera tu menú semanal y lista de la compra adaptados a tus preferencias.</p>
                        <button
                          disabled={menuCooldown.isActive || isGeneratingMenu}
                          onClick={() => { menuCooldown.start(); handleGenerateMenu(profile, goals, weights.length > 0 ? weights[weights.length - 1].weight : 70); }}
                          className={`${themeStyles.buttonPrimary} px-6 py-2 rounded-xl font-bold uppercase tracking-wider text-xs disabled:opacity-50`}
                        >
                          {menuCooldown.isActive ? `Espera ${menuCooldown.remaining}s` : isGeneratingMenu ? 'Generando...' : 'Generar Plan'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              </div>
              ) : mealsSubTab === 'shopping' ? (
                 <div className="space-y-6">
                 {/* Unified Shopping List Section */}
                 <div className={`${themeStyles.card} rounded-3xl p-6 md:p-8 space-y-6`}>
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
                       <p className={`${themeStyles.textMuted} text-[10px] uppercase font-bold tracking-widest px-4 mb-6`}>
                         Extrae los ingredientes del menú y genera tu lista de la compra semanal
                       </p>
                       <button
                         onClick={() => { shoppingCooldown.start(); handleGenerateShoppingList(); }}
                         disabled={!generatedMenu || shoppingCooldown.isActive}
                         className={`${themeStyles.buttonPrimary} px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-[10px] mx-auto flex items-center gap-2 disabled:opacity-50`}
                       >
                         <ShoppingCart className="w-4 h-4" />
                         {shoppingCooldown.isActive ? `Espera ${shoppingCooldown.remaining}s` : 'Generar Lista'}
                       </button>
                     </div>
                   ) : shoppingList.categories.length === 0 ? (
                     <div className={`text-center py-8 ${themeStyles.iconBg} rounded-2xl border ${themeStyles.border}`}>
                       <Info className={`w-8 h-8 ${themeStyles.textMuted} mx-auto mb-2`} />
                       <p className={`${themeStyles.textMuted} text-sm`}>No se han podido detectar ingredientes.</p>
                       <p className={`${themeStyles.textMuted} text-[10px] mt-1 opacity-80`}>Intenta generar el menú de nuevo.</p>
                     </div>
                   ) : (
                     <div className="space-y-6">
                       <div className={`${themeStyles.accentMuted} border ${themeStyles.accentBorder} rounded-2xl p-6 text-center`}>
                         <p className={`${themeStyles.accent} text-sm font-bold mb-1 uppercase tracking-widest`}>¡Lista generada con éxito!</p>
                         <p className={`${themeStyles.textMuted} text-xs mb-6`}>Lista de ingredientes para toda la semana. Puedes marcar los productos mientras compras.</p>
                         
                         <div className="space-y-4">
                           <p className={`${themeStyles.textMuted} text-[10px] uppercase font-bold tracking-widest text-center`}>
                             Puedes ir marcando los productos mientras compras
                           </p>
                           <div className="flex flex-col gap-3">
                             <button
                               type="button"
                               onClick={(e) => {
                                 e.preventDefault();
                                 downloadShoppingListHTML();
                               }}
                               className={`w-full flex items-center justify-center gap-2 p-4 rounded-xl ${themeStyles.buttonPrimary} font-bold text-[10px] uppercase tracking-widest`}
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
              ) : null}
            </motion.div>
          )}

          {activeTab === 'gym' && profile.gymEnabled && (
            <motion.div
              key="gym"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 pb-32"
            >
              {/* Workout Content */}
              <div className="space-y-6">
                {/* General Coach Message */}
                <div className={`${themeStyles.card} p-5 rounded-[2rem] border-l-4 ${profile.theme === 'light' ? 'border-emerald-500' : themeStyles.accentBorder}`}>
                  <div className="flex gap-4">
                    <div className={`w-12 h-12 rounded-2xl ${themeStyles.iconBg} border ${themeStyles.border} flex items-center justify-center shrink-0`}>
                      <Bot className={`w-6 h-6 ${themeStyles.accent}`} />
                    </div>
                    <div className="text-left">
                      <span className={`text-[10px] font-black ${themeStyles.accent} uppercase tracking-widest`}>AI Coach Gym</span>
                      <p className={`${themeStyles.textMain} text-sm font-medium mt-1 leading-relaxed`}>
                        {habits[todayStr]?.completedExercises && habits[todayStr].completedExercises.length >= 3 
                          ? "¡Rutina casi fulminada! Has hecho un trabajo excelente." 
                          : (habits[todayStr]?.completedExercises && habits[todayStr].completedExercises.length > 0)
                          ? "¡Genial, sigue así! Ya has completado parte de tu rutina, a terminarla campeón."
                          : "El momento es ahora. Ponte las zapatillas y revisa tu rutina."}
                      </p>
                    </div>
                  </div>
                </div>

                {workoutPlan && !isGeneratingWorkout && (
                  <div className="flex flex-col gap-4">
                    <div className={`grid grid-cols-2 gap-1.5 ${themeStyles.iconBg} p-1 rounded-xl border ${themeStyles.border} w-full`}>
                      {[
                        { id: 'manual', label: 'Manual', icon: Plus },
                        { id: 'plan', label: 'Plan', icon: Activity }
                      ].map((st) => (
                        <button
                          key={st.id}
                          onClick={() => setGymSubTab(st.id as any)}
                          className={`py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${
                            gymSubTab === st.id 
                              ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` 
                              : `${themeStyles.textMuted} hover:text-current`
                          }`}
                        >
                          <st.icon className="w-4 h-4" />
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isGeneratingWorkout ? (
                  <div className={`${themeStyles.bento} p-16 text-center border ${themeStyles.border}`}>
                    <div className="relative w-24 h-24 mx-auto mb-8">
                      <motion.div
                        className={`absolute inset-0 rounded-3xl ${themeStyles.accentMuted}`}
                        animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.2, 0.6] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Dumbbell className={`w-10 h-10 ${themeStyles.accent}`} />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <p className={`text-xl ${themeStyles.textMain} font-bold tracking-tight`}>Tu experto AI está diseñando la rutina...</p>
                      <motion.div 
                        className={`${themeStyles.textMuted} text-xs font-mono h-4 uppercase tracking-[0.2em]`}
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      >
                        {`> Programando microciclo de ${profile.trainingDaysPerWeek || 3} días...`}
                      </motion.div>
                    </div>
                  </div>
                ) : (workoutPlan && workoutPlan.length > 50) ? (
                  <>
                    <motion.div
                      key={gymSubTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    {gymSubTab === 'plan' ? (
                      <div className="space-y-6">
                        {/* Premium Gym Header */}
                        <div className={`${themeStyles.bento} p-8 relative overflow-hidden`}>
                          <div className={`absolute top-0 right-0 w-64 h-64 ${profile.theme === 'light' ? 'bg-emerald-500/5' : '${themeStyles.accentMuted}'} rounded-full blur-3xl`}></div>
                          
                          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6 text-left">
                            <div className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl ${themeStyles.accentMuted} flex items-center justify-center border ${themeStyles.accentBorder}`}>
                                  <Dumbbell className={`w-5 h-5 ${themeStyles.accent}`} />
                                </div>
                                <div>
                                  <h2 className={`text-xl font-display font-black ${themeStyles.textMain} uppercase tracking-tight leading-tight`}>Tu Rutina</h2>
                                  <p className={`${themeStyles.textMuted} text-[9px] font-bold uppercase tracking-widest mt-1`}>
                                    {profile.trainingDaysPerWeek} Días • {translateGymGoal(profile.gymGoal)}
                                  </p>
                                </div>
                              </div>
                              <p className={`${themeStyles.textMuted} text-xs max-w-sm leading-relaxed`}>
                                Rutina profesional para <span className={`${themeStyles.textMain} font-bold`}>{profile.age} años</span> y objetivo de <span className={`${themeStyles.accent} font-bold`}>{translateGymGoal(profile.gymGoal).toLowerCase()}</span>. Esta rutina está diseñada para realizarse <span className={`${themeStyles.textMain} font-bold`}>{profile.workoutType === 'home' ? 'en casa' : 'en el gimnasio'}</span>.
                              </p>
                            </div>
                            <button
                              onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                              disabled={isGeneratingWorkout || workoutCooldown.isActive}
                              className={`shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.accent} disabled:opacity-40`}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingWorkout ? 'animate-spin' : ''}`} />
                              {workoutCooldown.isActive ? `${workoutCooldown.remaining}s` : 'Regenerar'}
                            </button>
                          </div>
                        </div>

                        {/* Subtabs for Plan */}
                        <div className={`grid grid-flow-col auto-cols-fr ${themeStyles.iconBg} p-1 rounded-2xl border ${themeStyles.border} shadow-lg mb-6`}>
                          <button
                            onClick={() => setPlanSubTab('info')}
                            className={`py-3 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${planSubTab === 'info' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                          >
                            <Info className="w-3.5 h-3.5" />
                            Info
                          </button>
                          <button
                            onClick={() => setPlanSubTab('ejercicios')}
                            className={`py-3 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${planSubTab === 'ejercicios' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                          >
                            <Dumbbell className="w-3.5 h-3.5" />
                            Ejercicios
                          </button>
                          <button
                            onClick={() => setPlanSubTab('tips')}
                            className={`py-3 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${planSubTab === 'tips' ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                          >
                            <Zap className="w-3.5 h-3.5" />
                            Tips
                          </button>
                        </div>

                        {/* Info / Intro Section */}
                        {planSubTab === 'info' && (
                        <motion.div initial={{opacity:0}} animate={{opacity:1}} layout className="space-y-6">
                          <div className={`${themeStyles.card} rounded-[2.5rem] p-8 md:p-10 shadow-2xl relative overflow-hidden text-left border ${themeStyles.border}`}>
                            <div className={`prose ${profile.theme === 'light' ? 'prose-slate' : 'prose-invert prose-zinc'} max-w-none
                              prose-headings:font-display prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter
                              prose-h2:text-2xl prose-h2:${themeStyles.accent} prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-4 prose-h2:mb-6
                              prose-strong:text-orange-500 prose-strong:font-black
                              prose-p:text-zinc-700 dark:prose-p:text-zinc-400 prose-p:leading-relaxed prose-p:text-sm prose-p:font-medium
                              prose-li:text-zinc-800 dark:prose-li:text-zinc-300 prose-li:my-1 prose-li:text-sm prose-li:font-medium
                            `}>
                              <Markdown remarkPlugins={[remarkGfm]}>
                                {getWorkoutSection(workoutPlan, 'info')}
                              </Markdown>
                            </div>
                          </div>
                        </motion.div>
                        )}

                        {/* Daily routines logic */}
                        {planSubTab === 'ejercicios' && (() => {
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
                                <h4 className={`text-sm font-black uppercase tracking-widest ${themeStyles.textMain}`}>Plan no procesable</h4>
                                <p className={`text-xs ${themeStyles.textMuted} max-w-xs mx-auto leading-relaxed font-medium`}>
                                  El plan generado no sigue el formato esperado. Intenta regenerarlo.
                                </p>
                                <button
                                  onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                                  disabled={workoutCooldown.isActive}
                                  className={`mt-4 px-8 py-3 rounded-xl ${themeStyles.accentBg} text-zinc-950 text-[10px] font-black uppercase tracking-widest shadow-lg disabled:opacity-50`}
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
                              {/* Daily Tabs Selector */}
                              <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar px-1 scroll-smooth">
                                {parsedDays.map((d) => (
                                  <button
                                    key={d.dayNumber}
                                    onClick={() => setGymDay(`Día ${d.dayNumber}`)}
                                    className={`px-6 py-3 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap min-w-[100px] border-solid ${
                                      gymDay === `Día ${d.dayNumber}`
                                        ? `${themeStyles.buttonPrimary} scale-105`
                                        : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.textMain}`
                                    }`}
                                  >
                                    {`Día ${d.dayNumber}`}
                                  </button>
                                ))}
                              </div>

                              {/* Day Detail Content */}
                              <motion.div
                                key={gymDay}
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`${themeStyles.bento} p-6 md:p-8 shadow-2xl space-y-8 relative overflow-hidden`}
                              >
                                <div className={`absolute top-0 right-0 w-32 h-32 ${themeStyles.accentMuted} opacity-20 rounded-full blur-2xl mr-[-10%] mt-[-10%]`} />

                                <div className="relative z-10 space-y-6">
                                  <div className="flex flex-col gap-1">
                                    <div className={`flex items-center gap-1.5 text-[8px] font-black ${themeStyles.accent} uppercase tracking-[0.2em] mb-1`}>
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
                                      className={`mt-2 flex items-center gap-2 px-6 py-3 rounded-xl border font-black uppercase tracking-widest text-[10px] transition-all w-full md:w-auto justify-center ${
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
                                    <span className={`text-[8px] font-black ${themeStyles.textMuted} uppercase tracking-[0.2em] pl-1`}>Foco de la sesión</span>
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

                                        return (
                                          <div className="my-8 relative group">
                                            <div className="flex items-center gap-3 px-2 mb-4">
                                              <div className={`w-1 h-5 ${isTableCompleted || gymDayDone[dayLabel] ? themeStyles.accentBg : 'bg-zinc-500'} rounded-full`} />
                                              <h5 className={`text-[11px] font-black uppercase tracking-widest ${isTableCompleted || gymDayDone[dayLabel] ? themeStyles.accent : themeStyles.textMain}`}>{sectionTitle}</h5>
                                            </div>

                                            <div className={`overflow-x-auto rounded-[2.5rem] border ${themeStyles.border} ${profile.theme === 'light' ? 'bg-slate-50 shadow-inner' : 'bg-zinc-950/30'} shadow-sm ${gymDayDone[dayLabel] ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                                              <table {...props} className="w-full text-left border-collapse" />
                                            </div>
                                          </div>
                                        );
                                      },
                                      thead: ({node, ...props}) => <thead {...props} className={`${profile.theme === 'light' ? 'bg-slate-100' : 'bg-white/5'} border-b ${themeStyles.border}`} />,
                                      th: ({node, ...props}) => <th {...props} className={`px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest ${themeStyles.textMuted} border-b ${themeStyles.border} first:${themeStyles.textMain} first:min-w-[100px]`} />,
                                      td: ({node, ...props}) => <td {...props} className={`px-3 py-2.5 ${themeStyles.textMuted} border-b ${themeStyles.border} text-[11px] font-medium first:${themeStyles.textMain} first:font-bold`} />,
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

                                {/* Summary Technical legend */}
                                <div className={`pt-6 flex flex-wrap gap-3 justify-center border-t ${themeStyles.border}`}>
                                  {[
                                    { lab: 'RPE', desc: 'Esfuerzo' },
                                    { lab: 'Series', desc: 'Bloques' },
                                    { lab: 'Descanso', desc: 'Tiempo' }
                                  ].map((item, idx) => (
                                    <div key={idx} className={`flex items-center gap-1.5 px-3 py-1.5 ${themeStyles.iconBg} rounded-xl border ${themeStyles.border} shadow-sm`}>
                                      <span className={`text-[8px] font-black ${themeStyles.accent} uppercase`}>{item.lab}:</span>
                                      <span className={`text-[8px] ${themeStyles.textMuted} font-bold uppercase tracking-tighter`}>{item.desc}</span>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            </div>
                          );
                        })()}

                        {/* Safety / Tips Section */}
                        {planSubTab === 'tips' && (
                        <motion.div initial={{opacity:0}} animate={{opacity:1}} layout className="space-y-6">
                          <div className={`${themeStyles.card} rounded-[2.5rem] p-8 md:p-10 shadow-2xl relative overflow-hidden text-left border ${themeStyles.border}`}>
                            <div className={`prose ${profile.theme === 'light' ? 'prose-slate' : 'prose-invert prose-zinc'} max-w-none
                              prose-headings:font-display prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter
                              prose-h2:text-2xl prose-h2:${themeStyles.accent} prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-4 prose-h2:mb-6
                              prose-strong:text-orange-500 prose-strong:font-black
                              prose-p:text-zinc-700 dark:prose-p:text-zinc-400 prose-p:leading-relaxed prose-p:text-sm prose-p:font-medium
                              prose-li:text-zinc-800 dark:prose-li:text-zinc-300 prose-li:my-1 prose-li:text-sm prose-li:font-medium
                            `}>
                              <Markdown remarkPlugins={[remarkGfm]}>
                                {getWorkoutSection(workoutPlan, 'safety')}
                              </Markdown>
                            </div>
                          </div>
                        </motion.div>
                        )}

                      </div>
                    ) : gymSubTab === 'manual' ? (
                      <div className={`${themeStyles.card} rounded-[2.5rem] p-8 md:p-10 shadow-2xl relative overflow-hidden text-left border ${themeStyles.border} space-y-6`}>
                        <div className="space-y-4 mb-6">
                          <h2 className={`text-2xl font-display font-black ${themeStyles.textMain} uppercase tracking-tighter`}>Entrenamiento Libre</h2>
                          <p className={`${themeStyles.textMuted} text-xs font-medium`}>Registra cualquier actividad física extra. Las calorías se calculan automáticamente con valores MET según tu peso.</p>
                        </div>
                        
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          const mins = parseFloat(manualWorkoutMinutes) || 0;
                          if (mins <= 0) return;
                          const weightKg = weights.length > 0 ? weights[weights.length - 1].weight : 70;
                          const kcal = calculateMETCalories(manualWorkoutActivity, manualWorkoutIntensidad, mins, weightKg);
                          const newHabits = {
                            ...habits,
                            [manualWorkoutDate]: {
                              ...(habits[manualWorkoutDate] || { water: 0, sleep: 0 }),
                              manualWorkout: {
                                activity: manualWorkoutActivity,
                                intensidad: manualWorkoutIntensidad,
                                durationMinutes: mins,
                                caloriesBurned: kcal,
                              }
                            }
                          };
                          setHabits(newHabits);
                          if (user) {
                            setDoc(doc(db, 'users', user.uid, 'habits', manualWorkoutDate), newHabits[manualWorkoutDate]).catch(console.error);
                          }
                          setManualWorkoutMinutes('45');
                          showSuccess(`${manualWorkoutActivity} guardado — ${kcal} kcal`);
                        }} className="space-y-6">

                          {/* 1. Fecha */}
                          <div className="space-y-2">
                            <label className={`block text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Fecha</label>
                            <input
                              type="date"
                              value={manualWorkoutDate}
                              onChange={e => setManualWorkoutDate(e.target.value)}
                              className={`w-full ${themeStyles.iconBg} rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:${themeStyles.accentBorder} transition-all border ${themeStyles.border}`}
                              required
                            />
                          </div>

                          {/* 2. Tipo de actividad */}
                          <div className="space-y-2">
                            <label className={`block text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Tipo de actividad</label>
                            <select
                              value={manualWorkoutActivity}
                              onChange={e => setManualWorkoutActivity(e.target.value)}
                              className={`w-full ${themeStyles.iconBg} rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:${themeStyles.accentBorder} transition-all border ${themeStyles.border} cursor-pointer`}
                            >
                              {ACTIVITY_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </div>

                          {/* 3. Duración */}
                          <div className="space-y-2">
                            <label className={`block text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Duración</label>
                            <div className="relative">
                              <input
                                type="number"
                                placeholder="45"
                                min="5" max="300"
                                value={manualWorkoutMinutes}
                                onChange={e => setManualWorkoutMinutes(e.target.value)}
                                className={`w-full ${themeStyles.iconBg} rounded-xl px-4 py-3 pr-14 text-sm focus:outline-none focus:ring-1 focus:${themeStyles.accentBorder} transition-all border ${themeStyles.border}`}
                                required
                              />
                              <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold ${themeStyles.textMuted} uppercase tracking-tighter pointer-events-none`}>min</span>
                            </div>
                          </div>

                          {/* 4. Intensidad */}
                          <div className="space-y-2">
                            <label className={`block text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Intensidad</label>
                            <div className={`grid grid-cols-3 gap-2 ${themeStyles.iconBg} p-1 rounded-2xl border ${themeStyles.border}`}>
                              {(['suave', 'moderada', 'intensa'] as const).map(level => (
                                <button
                                  key={level}
                                  type="button"
                                  onClick={() => setManualWorkoutIntensidad(level)}
                                  className={`py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${manualWorkoutIntensidad === level ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` : `${themeStyles.textMuted} hover:text-current`}`}
                                >
                                  {level}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 5. Kcal calculadas (solo lectura) */}
                          {(() => {
                            const mins = parseFloat(manualWorkoutMinutes) || 0;
                            const weightKg = weights.length > 0 ? weights[weights.length - 1].weight : 70;
                            const kcal = mins > 0 ? calculateMETCalories(manualWorkoutActivity, manualWorkoutIntensidad, mins, weightKg) : 0;
                            return kcal > 0 ? (
                              <div className={`${themeStyles.iconBg} border ${themeStyles.accentBorder} rounded-2xl p-5 text-center space-y-1`}>
                                <p className={`text-[9px] font-black ${themeStyles.textMuted} uppercase tracking-[0.2em]`}>Calorías estimadas</p>
                                <p className={`text-4xl font-display font-black ${themeStyles.accent}`}>{kcal}</p>
                                <p className={`text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-wider`}>kcal · basado en tu peso ({weightKg} kg)</p>
                              </div>
                            ) : null;
                          })()}

                          <button
                            type="submit"
                            disabled={!manualWorkoutMinutes || parseFloat(manualWorkoutMinutes) <= 0}
                            className={`${themeStyles.buttonPrimary} w-full md:w-auto md:min-w-[250px] mx-auto py-3 px-6 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <Plus className="w-4 h-4" />
                            Guardar Entrenamiento
                          </button>
                        </form>
                        
                        {habits[todayStr]?.manualWorkout && (
                          <div className={`${themeStyles.card} rounded-[2rem] p-6 border ${themeStyles.border} relative overflow-hidden group shadow-xl mt-6`}>
                             <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                   <div className={`p-2.5 ${themeStyles.accentMuted} rounded-xl shadow-inner border ${themeStyles.accentBorder}`}>
                                      <Activity className={`w-4 h-4 ${themeStyles.accent}`} />
                                   </div>
                                   <div>
                                      <span className={`text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest`}>Ejercicio Extra</span>
                                      <h4 className={`text-sm font-bold ${themeStyles.textMain} mt-1`}>{habits[todayStr].manualWorkout.activity} · {habits[todayStr].manualWorkout.durationMinutes ?? '?'} min · {habits[todayStr].manualWorkout.intensidad ?? ''}</h4>
                                   </div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                   <span className={`text-xl font-display font-black ${themeStyles.accent}`}>+{habits[todayStr].manualWorkout.caloriesBurned ?? (habits[todayStr].manualWorkout as any).calories ?? 0}</span>
                                   <span className={`text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest block`}>kcal</span>
                                </div>
                             </div>
                             <div className="flex items-center gap-2 pt-4 border-t border-dashed border-zinc-500/20">
                                <button
                                  onClick={() => {
                                    const w = habits[todayStr].manualWorkout;
                                    if (w) {
                                      setManualWorkoutActivity(w.activity);
                                      setManualWorkoutIntensidad(w.intensidad ?? 'moderada');
                                      setManualWorkoutMinutes(String(w.durationMinutes ?? 45));
                                      setManualWorkoutDate(todayStr);
                                    }
                                  }}
                                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border ${themeStyles.border} ${themeStyles.iconBg} text-[10px] font-black uppercase tracking-widest ${themeStyles.textMuted} hover:${themeStyles.accent} transition-all`}
                                >
                                   <Edit2 className="w-3.5 h-3.5" />
                                   Editar
                                </button>
                                <button 
                                  onClick={() => {
                                    const newHabits = { ...habits };
                                    if (newHabits[todayStr]) {
                                      delete newHabits[todayStr].manualWorkout;
                                      setHabits(newHabits);
                                      if (user) setDoc(doc(db, 'users', user.uid, 'habits', todayStr), newHabits[todayStr]).catch(console.error);
                                    }
                                  }}
                                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border ${themeStyles.border} ${themeStyles.iconBg} text-[10px] font-black uppercase tracking-widest ${themeStyles.textMuted} hover:text-rose-500 transition-all`}
                                >
                                   <Trash2 className="w-3.5 h-3.5" />
                                   Eliminar
                                </button>
                             </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </motion.div>
                  </>
                ) : (
                  <div className="bg-zinc-950/30 rounded-[3rem] border border-white/5 p-20 text-center">
                    <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-white/5">
                      <Dumbbell className="w-10 h-10 text-zinc-700" />
                    </div>
                    <h3 className="text-2xl font-display font-black text-white uppercase tracking-tight mb-3">No tienes un plan activo</h3>
                    <p className="text-zinc-500 text-sm mb-8 max-w-xs mx-auto leading-relaxed">Genera tu primera rutina personalizada basada en tu perfil anatómico y objetivos deportivos.</p>
                    <button
                      onClick={() => { workoutCooldown.start(); handleGenerateWorkout(); }}
                      disabled={workoutCooldown.isActive}
                      className={`${themeStyles.accentBg} text-zinc-950 font-black uppercase tracking-widest px-10 py-5 rounded-2xl transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100`}
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
            className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6"
          >
            <div className="w-full max-w-sm space-y-8 flex flex-col items-center">
              <div className="relative w-64 h-64 rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-center">
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

      {/* Weight Modal */}
      <AnimatePresence>
        {isWeightModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-50 flex items-center justify-center p-6 ${profile.theme === 'light' ? 'bg-slate-900/60' : 'bg-zinc-950/90'} backdrop-blur-sm`}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`rounded-3xl p-6 w-full max-w-sm ${themeStyles.card} ${themeStyles.border} shadow-2xl`}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className={`text-xl font-display font-bold ${themeStyles.textMain}`}>Registrar Peso</h3>
                <button onClick={() => setIsWeightModalOpen(false)} className={`${themeStyles.textMuted} hover:${themeStyles.accent} transition-colors`}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleAddWeight} className="space-y-4 pb-12">
                <NumberInput
                  label="Peso (kg)"
                  value={newWeight}
                  onChange={setNewWeight}
                  step={0.1}
                  min={30}
                  max={300}
                  placeholder="Ej. 75.5"
                  theme={profile.theme}
                />
                <button 
                  type="submit"
                  disabled={!newWeight}
                  className={`w-full ${themeStyles.buttonPrimary} font-semibold py-3 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Guardar
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Goal Modal */}
      <AnimatePresence>
        {isGoalModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`${themeStyles.card} border ${themeStyles.border} rounded-3xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 ${profile.theme === 'light' ? 'bg-emerald-500/5' : '${themeStyles.accentMuted}'} rounded-full blur-2xl pointer-events-none`}></div>
              
              <div className="flex justify-between items-center mb-6 shrink-0 relative z-10">
                <div className="flex items-center gap-3">
                  <div className={`p-2 ${themeStyles.accentMuted} rounded-xl border ${themeStyles.accentBorder}`}>
                    <UserIcon className={`w-6 h-6 ${themeStyles.accent}`} />
                  </div>
                  <h3 className={`text-xl font-display font-bold ${themeStyles.textMain} uppercase tracking-tight`}>Configuración de Perfil</h3>
                </div>
                <button onClick={() => setIsGoalModalOpen(false)} className={`${themeStyles.textMuted} hover:text-rose-500 transition-colors`}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className={`flex flex-nowrap overflow-x-auto hide-scrollbar sm:flex-wrap gap-1.5 mb-6 shrink-0 px-1 relative z-10 ${profile.theme === 'light' ? 'bg-slate-100' : 'bg-zinc-950'} p-1.5 rounded-xl`}>
                {[
                  { id: 'user', label: 'Personal', icon: UserIcon },
                  { id: 'diet', label: 'Dieta', icon: ChefHat },
                  { id: 'exercise', label: 'Entrenamiento', icon: Dumbbell }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setProfileTab(tab.id as any)}
                    className={`flex-1 shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[9px] whitespace-nowrap font-black uppercase tracking-wider transition-all ${
                      profileTab === tab.id 
                        ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white' : 'text-zinc-950'} shadow-md` 
                        : `${themeStyles.textMuted} hover:text-current`
                    }`}
                  >
                    <tab.icon className="w-3.5 h-3.5 shrink-0" />
                    {tab.label}
                  </button>
                ))}
              </div>
              
              <form onSubmit={handleSaveGoal} className="flex-1 overflow-y-auto pr-2 space-y-5 custom-scrollbar pb-10 text-left relative z-10">
                {profileTab === 'user' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className={`${themeStyles.iconBg} p-6 rounded-3xl border ${themeStyles.border} space-y-4 shadow-sm`}>
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 space-y-2">
                          <label className={`block text-[10px] font-black ${themeStyles.textMuted} uppercase tracking-widest pl-1`}>Nombre completo</label>
                          <input 
                            type="text" 
                            value={editProfile.name}
                            onChange={(e) => setEditProfile({...editProfile, name: e.target.value})}
                            className={`w-full ${themeStyles.input} rounded-xl px-4 py-4 text-sm font-bold focus:outline-none transition-all shadow-inner`}
                            placeholder="Tu nombre..."
                          />
                        </div>
                      </div>

                      {/* Tema configurado en cabecera */}
                    </div>
                      <div className="space-y-4">
                        <RulerPicker
                          label="Edad"
                          theme={profile.theme}
                          value={editProfile.age}
                          onChange={(val: string) => setEditProfile({...editProfile, age: parseInt(val) || 0})}
                          min={15}
                          max={100}
                          step={1}
                          unit="Años"
                        />
                      </div>

                      <div className="space-y-4">
                        <RulerPicker
                          label="Altura"
                          theme={profile.theme}
                          value={editProfile.height}
                          onChange={(val: string) => setEditProfile({...editProfile, height: parseInt(val) || 0})}
                          min={120}
                          max={230}
                          step={1}
                          unit="cm"
                        />
                      </div>

                      <div className="space-y-4">
                        <RulerPicker
                          label="Peso Actual"
                          theme={profile.theme}
                          value={editWeight}
                          onChange={setEditWeight}
                          min={40}
                          max={200}
                          step={0.1}
                          unit="kg"
                        />
                      </div>
                      <div className="space-y-1.5 px-2">
                        <label className={`block text-[10px] font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Género</label>
                        <select 
                          value={editProfile.gender}
                          onChange={(e) => setEditProfile({...editProfile, gender: e.target.value as 'male' | 'female'})}
                          className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-colors appearance-none shadow-sm`}
                        >
                          <option value="male">Hombre</option>
                          <option value="female">Mujer</option>
                        </select>
                      </div>

                    <div className={`${profile.theme === 'light' ? 'bg-indigo-50/80 border-indigo-200' : 'bg-indigo-500/5 border-indigo-500/10'} p-4 rounded-2xl border space-y-4`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className={`w-3.5 h-3.5 ${profile.theme === 'light' ? 'text-indigo-500' : 'text-indigo-400'}`} />
                          <label className={`block text-[10px] font-bold uppercase tracking-widest ${profile.theme === 'light' ? 'text-indigo-700' : 'text-indigo-200/60'}`}>¿Tienes Diabetes?</label>
                        </div>
                        <button 
                          type="button"
                          onClick={() => setEditProfile({
                            ...editProfile, 
                            diabetesType: editProfile.diabetesType !== 'none' ? 'none' : 'type2'
                          })}
                          className={`w-10 h-3 rounded-full transition-colors relative ${editProfile.diabetesType !== 'none' ? 'bg-indigo-500' : (profile.theme === 'light' ? 'bg-slate-300' : 'bg-zinc-700')}`}
                        >
                          <div className={`absolute -top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all ${editProfile.diabetesType !== 'none' ? 'left-6' : 'left-0'}`} />
                        </button>
                      </div>

                      {editProfile.diabetesType !== 'none' && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                          <label className={`block text-[10px] font-bold uppercase tracking-widest ${profile.theme === 'light' ? 'text-indigo-900/60' : 'text-indigo-200/40'}`}>Tipo de Diabetes</label>
                          <select 
                            value={editProfile.diabetesType}
                            onChange={(e) => setEditProfile({...editProfile, diabetesType: e.target.value as any})}
                            className={`w-full ${profile.theme === 'light' ? 'bg-white border-indigo-200 text-indigo-900 focus:border-indigo-400' : 'bg-zinc-900 border-zinc-800 text-white focus:border-indigo-500/50'} rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-colors appearance-none shadow-sm`}
                          >
                            <option value="type1">Diabetes Tipo 1</option>
                            <option value="type2">Diabetes Tipo 2</option>
                            <option value="prediabetes">Pre-diabetes</option>
                          </select>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Info className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                        <p className="text-[9px] text-zinc-500 leading-tight">Esta información es vital para ajustar el índice glucémico de las comidas y la intensidad del ejercicio.</p>
                      </div>
                    </div>
                  </div>
                )}

                {profileTab === 'diet' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest text-left`}>Tipo de Dieta</label>
                        <select 
                          value={editProfile.dietType}
                          onChange={(e) => setEditProfile({...editProfile, dietType: e.target.value})}
                          className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all appearance-none`}
                        >
                          <option value="Normal">Normal</option>
                          <option value="Vegetariana">Vegetariana</option>
                          <option value="Vegana">Vegana</option>
                          <option value="Pescetariana">Pescetariana</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest text-left`}>Objetivo nutricional</label>
                        <select
                          value={editProfile.goal}
                          onChange={(e) => setEditProfile({...editProfile, goal: e.target.value as any})}
                          className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all appearance-none`}
                        >
                          <option value="lose">Perder grasa (−400 kcal/día)</option>
                          <option value="maintain">Mantener peso (TDEE exacto)</option>
                          <option value="gain">Ganar músculo (+300 kcal/día)</option>
                        </select>
                        {editProfile.gymEnabled && (
                          (editProfile.gymGoal === 'fat_loss' && editProfile.goal === 'gain') ||
                          (editProfile.gymGoal === 'muscle' && editProfile.goal === 'lose')
                        ) && (
                          <p className={`text-[10px] font-medium ${profile.theme === 'light' ? 'text-amber-600' : 'text-amber-400'} leading-snug pt-1`}>
                            ⚠️ Tu objetivo de entrenamiento ({translateGymGoal(editProfile.gymGoal)}) no coincide con tu objetivo nutricional ({editProfile.goal === 'lose' ? 'Perder grasa' : 'Ganar músculo'}). ¿Es correcto?
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className={`block text-[10px] font-bold uppercase tracking-widest ${themeStyles.textMuted}`}>Alergias e Intolerancias</label>
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
                                allergies: exists 
                                  ? editProfile.allergies.filter(a => a !== lid)
                                  : [...editProfile.allergies, lid]
                              });
                            }}
                            className={`flex items-center gap-2 p-2.5 rounded-xl border text-[10px] font-bold transition-all ${
                              editProfile.allergies.includes(id.toLowerCase().replace(' ', '_'))
                                ? `${themeStyles.accentMuted} ${themeStyles.accentBorder} ${themeStyles.accent}`
                                : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.accentBorder}`
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

                    <div className="space-y-4 mt-2">
                      <div className="space-y-1.5">
                        <label className={`block text-[10px] font-bold uppercase tracking-widest text-left ${themeStyles.textMuted}`}>Distribución Macros</label>
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
                        {(['keto', 'low_carb'] as const).includes(editProfile.macroDistribution) && editProfile.goal === 'gain' && (
                          <p className={`text-[10px] font-medium ${profile.theme === 'light' ? 'text-amber-600' : 'text-amber-400'} leading-snug pt-1`}>
                            ⚠️ Una distribución {editProfile.macroDistribution === 'keto' ? 'keto' : 'baja en carbos'} con objetivo de ganar músculo puede dificultar el rendimiento. Considera &quot;Alta en proteína&quot; para este objetivo.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className={`p-4 rounded-2xl border space-y-4 shadow-inner ${profile.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-zinc-950 border-white/5'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Pizza className="w-3.5 h-3.5 text-amber-400" />
                          <label className={`text-[10px] font-bold uppercase tracking-widest ${profile.theme === 'light' ? 'text-slate-700' : 'text-zinc-200'}`}>Momento Libre Semanal</label>
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
                            className={`bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:${themeStyles.accentBorder}/50`}
                          >
                            {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(d => <option key={d}>{d}</option>)}
                          </select>
                          <select 
                            value={editProfile.freeMealType}
                            onChange={(e) => setEditProfile({...editProfile, freeMealType: e.target.value as any})}
                            className={`bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:${themeStyles.accentBorder}/50`}
                          >
                            <option value="comida">Comida</option>
                            <option value="cena">Cena</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {profileTab === 'exercise' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className={`${themeStyles.iconBg} rounded-2xl border ${themeStyles.border} p-5 space-y-4 shadow-sm`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Dumbbell className={`w-4 h-4 ${themeStyles.accent}`} />
                          <label className={`text-[10px] font-black ${themeStyles.textMain} uppercase tracking-widest`}>Plan de Entrenamiento (Act. Física)</label>
                        </div>
                        <button 
                          type="button"
                          onClick={() => setEditProfile({...editProfile, gymEnabled: !editProfile.gymEnabled})}
                          className={`w-10 h-3 rounded-full transition-colors relative ${editProfile.gymEnabled ? themeStyles.accentBg : (profile.theme === 'light' ? 'bg-slate-200' : 'bg-zinc-800')}`}
                        >
                          <div className={`absolute -top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all ${editProfile.gymEnabled ? 'left-6' : 'left-0'}`} />
                        </button>
                      </div>

                      {editProfile.gymEnabled ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                          <div className="space-y-1.5 text-left">
                            <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Ubicación</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setEditProfile({...editProfile, workoutType: 'gym'})}
                                className={`py-4 rounded-xl text-center border transition-all ${
                                  editProfile.workoutType === 'gym' 
                                    ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md` 
                                    : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.textMain}`
                                }`}
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <Dumbbell className="w-5 h-5" />
                                  <span className="text-[10px] uppercase tracking-widest font-black">Gimnasio</span>
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditProfile({...editProfile, workoutType: 'home'})}
                                className={`py-4 rounded-xl text-center border transition-all ${
                                  editProfile.workoutType === 'home' 
                                    ? `${themeStyles.accentBg} ${profile.theme === 'light' ? 'text-white border-emerald-500' : 'text-zinc-950 border-lime-400'} font-bold shadow-md` 
                                    : `${themeStyles.iconBg} ${themeStyles.border} ${themeStyles.textMuted} hover:${themeStyles.textMain}`
                                }`}
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <Home className="w-5 h-5" />
                                  <span className="text-[10px] uppercase tracking-widest font-black">En Casa</span>
                                </div>
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5 text-left">
                            <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Objetivo</label>
                            <select 
                              value={editProfile.gymGoal}
                              onChange={(e) => setEditProfile({...editProfile, gymGoal: e.target.value as any})}
                              className={`w-full ${themeStyles.input} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all appearance-none`}
                            >
                              <option value="muscle">Ganar Músculo</option>
                              <option value="strength">Fuerza</option>
                              <option value="cardio">Resistencia (Cardio)</option>
                              <option value="fat_loss">Pérdida de Grasa</option>
                              <option value="flexibility">Flexibilidad</option>
                              <option value="maintenance">Mantenimiento</option>
                            </select>
                          </div>
                          
                          <div className="space-y-1.5 text-left">
                            <label className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest`}>Frecuencia Semanal</label>
                            <div className={`${profile.theme === 'light' ? 'bg-slate-50' : 'bg-zinc-950'} border ${themeStyles.border} rounded-2xl p-4 space-y-4`}>
                              <div className="flex justify-between items-baseline">
                                <span className={`text-xl font-black ${themeStyles.accent}`}>{editProfile.trainingDaysPerWeek} <span className={`text-[10px] ${themeStyles.textMuted} uppercase font-bold tracking-tighter`}>días</span></span>
                                <span className={`text-[8px] font-bold ${themeStyles.textMuted} uppercase tracking-widest opacity-50`}>Intensidad Sugerida</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="7" 
                                step="1"
                                value={editProfile.trainingDaysPerWeek}
                                onChange={(e) => setEditProfile({...editProfile, trainingDaysPerWeek: parseInt(e.target.value)})}
                                className={`w-full ${profile.theme === 'light' ? 'accent-emerald-500 bg-slate-200' : 'accent-lime-400 bg-zinc-800'} h-2 rounded-lg appearance-none cursor-pointer`}
                              />
                              <div className="flex justify-between text-[8px] font-bold text-zinc-500 uppercase">
                                <span>0</span>
                                <span>7</span>
                              </div>
                            </div>
                          </div>

                          <div className={`flex gap-2 p-3 ${themeStyles.iconBg} border ${themeStyles.border} rounded-xl`}>
                            <Info className={`w-3.5 h-3.5 ${themeStyles.accent} shrink-0 mt-0.5`} />
                            <p className={`text-[9px] ${themeStyles.textMuted} italic leading-relaxed`}>
                              El sistema ajustará tu gasto calórico (TDEE) basándose en estos días de entreno para que tu dieta sea 100% efectiva.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="py-8 text-center px-4">
                          <p className={`text-[10px] ${themeStyles.textMuted} font-medium uppercase tracking-widest leading-loose opacity-60`}>
                            Activa el plan AI para obtener rutinas profesionales diseñadas para tu edad y nivel.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-zinc-800 shrink-0">
                  {(!editWeight || !editProfile.name || !editProfile.age || !editProfile.height) && profileTab !== 'user' && (
                    <p className="text-[10px] text-rose-500 text-center font-bold mb-3 uppercase tracking-widest bg-rose-500/10 py-2 rounded-xl">Falta información en pestaña Personal</p>
                  )}
                  <button 
                    type="submit"
                    disabled={!editWeight || !editProfile.name || !editProfile.age || !editProfile.height}
                    className={`${themeStyles.buttonPrimary} w-full md:w-auto md:min-w-[250px] mx-auto py-3 px-6 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Save className="w-4 h-4" />
                    Actualizar Perfil
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chatbot FAB */}
      <button
        onClick={() => setIsChatOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-500 hover:bg-indigo-400 text-white rounded-full shadow-[0_0_20px_rgba(99,102,241,0.4)] flex items-center justify-center transition-transform hover:scale-110 active:scale-95 z-40"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* Chatbot Modal */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed inset-x-4 bottom-24 top-24 md:inset-auto md:bottom-24 md:right-6 md:w-96 md:h-[600px] bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30">
                  <Bot className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Coach NutritivApp</h3>
                  <p className="text-zinc-500 text-[10px] uppercase tracking-widest">En línea 24/7</p>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-zinc-500 hover:text-white transition-colors p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${msg.role === 'user' ? 'bg-indigo-500 text-white rounded-br-sm' : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'}`}>
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-snug prose-p:m-0 prose-ul:m-0 prose-li:m-0">
                      <Markdown remarkPlugins={[remarkGfm]}>
                        {msg.parts[0].text}
                      </Markdown>
                    </div>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800 text-zinc-400 rounded-2xl rounded-bl-sm p-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Escribiendo...</span>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={(e) => { chatCooldown.start(); handleSendMessage(e); }} className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex gap-2">
              <input
                type="text"
                value={currentChatMessage}
                onChange={(e) => setCurrentChatMessage(e.target.value)}
                placeholder="Pregúntame lo que quieras..."
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                type="submit"
                disabled={!currentChatMessage.trim() || isChatLoading || chatCooldown.isActive}
                className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white p-2 rounded-xl transition-colors shrink-0 flex items-center justify-center w-10 h-10"
              >
                {chatCooldown.isActive
                  ? <span className="text-xs font-mono font-bold">{chatCooldown.remaining}</span>
                  : <Send className="w-4 h-4" />}
              </button>
            </form>
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
            className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6 sticky top-0 bg-zinc-900 z-10 pb-2 border-b border-white/5">
                <h3 className="text-xl font-display font-bold text-white">Revisar Análisis</h3>
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
                  const mealToSave: Meal = {
                    ...editingMeal,
                    calories: Math.round(editingMeal.calories * portionMultiplier),
                    protein: Math.round(editingMeal.protein * portionMultiplier),
                    carbs: Math.round(editingMeal.carbs * portionMultiplier),
                    fat: Math.round(editingMeal.fat * portionMultiplier),
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
                    setDoc(doc(db, 'users', user.uid, 'meals', mealToSave.id), mealToSave).catch(console.error);
                  }
                  setEditingMeal(null);
                }}
                className="space-y-4 pb-32"
              >
                {/* Food Name & Ingredients (Configurable Parameters) */}
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Nombre de la comida</label>
                  <div className="flex flex-col gap-4">
                    <input 
                      type="text" 
                      value={editingMeal.foodName} 
                      onChange={(e) => setEditingMeal({...editingMeal, foodName: e.target.value})}
                      className={`w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:${themeStyles.accentBorder} transition-colors`} 
                      required 
                    />
                    
                    {/* Interpretación Automática */}
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
                  <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                    <span>Distribución de Macros</span>
                  </div>
                  <div className="h-2 w-full bg-zinc-950 rounded-full overflow-hidden flex">
                    {(() => {
                      const total = editingMeal.protein + editingMeal.carbs + editingMeal.fat;
                      if (total === 0) return <div className="w-full bg-zinc-800" />;
                      const pPct = (editingMeal.protein / total) * 100;
                      const cPct = (editingMeal.carbs / total) * 100;
                      const fPct = (editingMeal.fat / total) * 100;
                      return (
                        <>
                          <div style={{ width: `${pPct}%` }} className="bg-blue-400 h-full" title={`Proteínas: ${Math.round(pPct)}%`} />
                          <div style={{ width: `${cPct}%` }} className="bg-amber-400 h-full" title={`Carbohidratos: ${Math.round(cPct)}%`} />
                          <div style={{ width: `${fPct}%` }} className="bg-rose-400 h-full" title={`Grasas: ${Math.round(fPct)}%`} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between text-[10px] font-medium text-zinc-400 mt-2">
                    <span className="text-blue-400">Prot: {Math.round((editingMeal.protein / (editingMeal.protein + editingMeal.carbs + editingMeal.fat || 1)) * 100)}%</span>
                    <span className="text-amber-400">Carbs: {Math.round((editingMeal.carbs / (editingMeal.protein + editingMeal.carbs + editingMeal.fat || 1)) * 100)}%</span>
                    <span className="text-rose-400">Grasas: {Math.round((editingMeal.fat / (editingMeal.protein + editingMeal.carbs + editingMeal.fat || 1)) * 100)}%</span>
                  </div>
                </div>

                {/* NutriScore & Density Analysis */}
                {editingMeal.nutriScore && (
                  <div className="bg-zinc-950 rounded-2xl p-4 border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Calidad Nutricional</span>
                      <div className="flex items-center gap-3">
                        {editingMeal.totalWeight && (
                          <span className="text-[10px] font-bold text-zinc-400 bg-zinc-900 px-2 py-1 rounded border border-white/5">
                            {editingMeal.totalWeight}g ESTIMADOS
                          </span>
                        )}
                        <NutriScoreBadge score={editingMeal.nutriScore} />
                      </div>
                    </div>
                    {editingMeal.densityAnalysis && (
                      <p className="text-xs text-zinc-400 leading-relaxed italic">
                        "{editingMeal.densityAnalysis}"
                      </p>
                    )}
                  </div>
                )}



                {/* Portion Multiplier */}
                <div className="bg-zinc-950 rounded-2xl p-4 border border-white/5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-3">Tamaño de la porción</span>
                  <div className="grid grid-cols-4 gap-2">
                    {([0.5, 1, 1.5, 2] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPortionMultiplier(m)}
                        className={`py-2 rounded-xl text-sm font-bold transition-colors border ${
                          portionMultiplier === m
                            ? `${themeStyles.accentBg} text-zinc-950 border-transparent`
                            : 'bg-zinc-900 text-zinc-400 border-white/10 hover:bg-zinc-800'
                        }`}
                      >
                        {m === 0.5 ? '½x' : m === 1.5 ? '1½x' : `${m}x`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Read-Only Macros */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                    <span className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Calorías</span>
                    <span className={`text-lg font-display font-bold ${themeStyles.accent}`}>{Math.round(editingMeal.calories * portionMultiplier)} <span className="text-xs text-zinc-500">kcal</span></span>
                  </div>
                  <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                    <span className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Proteínas</span>
                    <span className="text-lg font-display font-bold text-blue-400">{Math.round(editingMeal.protein * portionMultiplier)} <span className="text-xs text-zinc-500">g</span></span>
                  </div>
                  <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                    <span className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Carbohidratos</span>
                    <span className="text-lg font-display font-bold text-amber-400">{Math.round(editingMeal.carbs * portionMultiplier)} <span className="text-xs text-zinc-500">g</span></span>
                  </div>
                  <div className={`${themeStyles.iconBg} p-3 rounded-xl border ${themeStyles.border}`}>
                    <span className={`block text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-1`}>Grasas</span>
                    <span className="text-lg font-display font-bold text-rose-400">{Math.round(editingMeal.fat * portionMultiplier)} <span className="text-xs text-zinc-500">g</span></span>
                  </div>
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

                <div className="pt-4">
                  <button type="submit" className={`w-full ${themeStyles.accentBg} text-zinc-950 font-bold uppercase tracking-wider py-4 rounded-xl hover:${themeStyles.accentBg} transition-colors`}>
                    Guardar Registro
                  </button>
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
            <div className="bg-rose-500 text-white px-6 py-4 rounded-2xl shadow-2xl font-medium text-sm flex items-center gap-3 pointer-events-auto max-w-md w-full border border-rose-400/50">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="flex-1">{appError.message}</p>
              <button
                onClick={() => setAppError(null)}
                className="p-1 hover:bg-rose-600 rounded-lg transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{label}</span>
      </div>
      
      <div className="mt-auto">
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-2xl font-display font-black text-white tracking-tighter">{Math.round(current)}</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">/ {goal}{unit}</span>
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

