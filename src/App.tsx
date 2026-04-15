import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Camera, Activity, Flame, Beef, Wheat, Droplet, X, Loader2, Plus, Minus, Upload, AlertTriangle, Info, CheckCircle2, Scale, Zap, TrendingUp, Target, Dumbbell, Calendar, Utensils, Moon, ShoppingCart, ClipboardList, CheckSquare, MessageCircle, ChefHat, Send, Bot, Pencil, RefreshCw, Download, LogOut, Banana, User as UserIcon, Star, MapPin, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, ResponsiveContainer, YAxis, ComposedChart, Bar, Line, XAxis, Tooltip } from 'recharts';
import Markdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { analyzeFoodImage, analyzeFoodText, NutritionalInfo, generateWeeklyMenu, generateWorkoutPlan, generateShoppingList, generateFridgeRecipe, chatWithCoach, recalculateFoodMacros, WeeklyMenu, ShoppingList, findRestaurants, Restaurant } from './lib/gemini';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocFromServer } from 'firebase/firestore';
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
  activityLevel: number;
  dietType: string;
  allergies: string;
  dislikedFoods: string;
  goal: 'lose' | 'maintain' | 'gain';
  macroDistribution: 'balanced' | 'low_carb' | 'high_protein' | 'keto';
  favoriteSupermarket: string;
  freeMealEnabled: boolean;
  freeMealDay: string;
  freeMealType: 'comida' | 'cena';
};

type DailyHabits = {
  [date: string]: { water: number; sleep: number };
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

const NumberInput = ({ value, onChange, label, step = 1, min = 0, max = 300, placeholder }: any) => {
  // Extract unit from label if present (e.g., "Peso (kg)" -> "kg")
  const unitMatch = label.match(/\(([^)]+)\)/);
  const unit = unitMatch ? unitMatch[1] : '';
  const cleanLabel = label.replace(/\s*\([^)]+\)/, '');

  return (
    <div className="space-y-2 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
      <div className="flex justify-between items-center">
        <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{cleanLabel}</label>
        <div className="flex items-baseline gap-1">
          <input 
            type="number" 
            step={step}
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-transparent text-right text-lg font-display font-bold text-lime-400 focus:outline-none w-16"
            placeholder={placeholder}
            style={{ MozAppearance: 'textfield' }}
          />
          {unit && <span className="text-zinc-600 text-[10px] font-medium">{unit}</span>}
        </div>
      </div>
      <div className="relative pt-1">
        <input 
          type="range" 
          min={min} 
          max={max} 
          step={step} 
          value={parseFloat(value) || min} 
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-lime-400 focus:outline-none"
        />
      </div>
    </div>
  );
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
    height: 170,
    gender: 'male',
    activityLevel: 1.55,
    dietType: 'Normal',
    allergies: '',
    dislikedFoods: '',
    goal: 'maintain',
    macroDistribution: 'balanced',
    favoriteSupermarket: 'Mercadona',
    freeMealEnabled: false,
    freeMealDay: 'Sábado',
    freeMealType: 'cena'
  });
  const [habits, setHabits] = useState<DailyHabits>({});

  const [activeTab, setActiveTab] = useState<'today' | 'week' | 'plan' | 'restaurants'>('today');
  const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<UserProfile>({
    name: '',
    age: 0,
    height: 170,
    gender: 'male',
    activityLevel: 1.55,
    dietType: 'Normal',
    allergies: '',
    dislikedFoods: '',
    goal: 'maintain',
    macroDistribution: 'balanced',
    favoriteSupermarket: 'Mercadona',
    freeMealEnabled: false,
    freeMealDay: 'Sábado',
    freeMealType: 'cena'
  });
  const [editWeight, setEditWeight] = useState('');

  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generatedMenu, setGeneratedMenu] = useState<WeeklyMenu | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingList | null>(null);
  const [isGeneratingMenu, setIsGeneratingMenu] = useState(false);
  const [isGeneratingShoppingList, setIsGeneratingShoppingList] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', parts: {text: string}[]}[]>([
    { role: 'model', parts: [{ text: '¡Hola! Soy tu entrenador y nutricionista personal. ¿En qué te puedo ayudar hoy?' }] }
  ]);
  const [currentChatMessage, setCurrentChatMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [isSearchingRestaurants, setIsSearchingRestaurants] = useState(false);
  const [restaurantLocation, setRestaurantLocation] = useState('');
  const [restaurantFilters, setRestaurantFilters] = useState({
    allergies: true,
    dietType: true,
    other: ''
  });
  const [restaurantSort, setRestaurantSort] = useState<'rating' | 'distance' | 'price'>('rating');
  const [restaurantSortOrder, setRestaurantSortOrder] = useState<'asc' | 'desc'>('desc');
  const [restaurantPage, setRestaurantPage] = useState(1);
  const [resultsLimit, setResultsLimit] = useState(15);
  const resultsPerPage = 5;

  const sortedRestaurants = useMemo(() => {
    return [...restaurants].sort((a, b) => {
      let comparison = 0;
      if (restaurantSort === 'rating') comparison = b.rating - a.rating;
      else if (restaurantSort === 'distance') comparison = (a.distance || 0) - (b.distance || 0);
      else if (restaurantSort === 'price') comparison = a.priceLevel - b.priceLevel;
      
      return restaurantSortOrder === 'desc' ? comparison : -comparison;
    });
  }, [restaurants, restaurantSort, restaurantSortOrder]);

  const displayedRestaurants = useMemo(() => {
    const start = (restaurantPage - 1) * resultsPerPage;
    return sortedRestaurants.slice(start, start + resultsPerPage);
  }, [sortedRestaurants, restaurantPage]);

  const handleNearMe = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude } = position.coords;
        const loc = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        setRestaurantLocation(loc);
        handleSearchRestaurants(undefined, loc);
      }, (error) => {
        setAppError("No se pudo obtener tu ubicación. Por favor, permítelo en tu navegador.");
      });
    } else {
      setAppError("Tu navegador no soporta geolocalización.");
    }
  };

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('unavailable'))) {
          console.error("Please check your Firebase configuration. The client is offline or the database is unavailable.");
          setAppError("Error de conexión con la base de datos. Por favor, recarga la página o comprueba tu conexión a internet.");
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
                allergies: data.profile.allergies || '',
                dislikedFoods: data.profile.dislikedFoods || '',
                favoriteSupermarket: data.profile.favoriteSupermarket || 'Mercadona',
                freeMealEnabled: data.profile.freeMealEnabled || false,
                freeMealDay: data.profile.freeMealDay || 'Sábado',
                freeMealType: data.profile.freeMealType || 'cena'
              };
              setProfile(loadedProfile);
            }
            if (data.goals) setGoals(data.goals);
            if (data.habits) setHabits(data.habits);
            if (data.generatedMenu) setGeneratedMenu(data.generatedMenu);
            if (data.shoppingList) setShoppingList(data.shoppingList);
            if (data.meals) setMeals(data.meals);
            if (data.weights) setWeights(data.weights);
            if (data.chatMessages) setChatMessages(data.chatMessages);
            if (data.checkedItems) setCheckedItems(data.checkedItems);
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
              allergies: parsed.allergies || '',
              dislikedFoods: parsed.dislikedFoods || '',
              favoriteSupermarket: parsed.favoriteSupermarket || 'Mercadona',
              freeMealEnabled: parsed.freeMealEnabled || false,
              freeMealDay: parsed.freeMealDay || 'Sábado',
              freeMealType: parsed.freeMealType || 'cena'
            });
          }
          if (savedGoals) setGoals(JSON.parse(savedGoals));
          if (savedHabits) setHabits(JSON.parse(savedHabits));
          if (savedMenu) setGeneratedMenu(JSON.parse(savedMenu));
          if (savedShoppingList) setShoppingList(JSON.parse(savedShoppingList));
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
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_meals', JSON.stringify(meals));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { meals }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [meals, user, isDataLoaded]);

  useEffect(() => {
    if (isDataLoaded) {
      localStorage.setItem('nutritivapp_weights', JSON.stringify(weights));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { weights }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
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
      if (user) {
        setDoc(doc(db, 'users', user.uid), { habits }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
      }
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

  useEffect(() => {
    if (isDataLoaded && shoppingList) {
      localStorage.setItem('nutritivapp_shopping_list', JSON.stringify(shoppingList));
      if (user) {
        setDoc(doc(db, 'users', user.uid), { shoppingList }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`));
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

  // Calculate today's totals
  const todaysMeals = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return meals.filter(m => m.timestamp >= todayStart.getTime());
  }, [meals]);

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
    const remainingCalories = goals.calories - totals.calories;
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
      message = "¡No pasa nada! Seguimos adelante";
      subMessage = "Un pequeño desvío es normal. Ajustamos en la próxima comida y listo.";
    } else if (remainingCalories > 500) {
      stateType = 'under';
      message = "¡Buen ritmo! Recuerda nutrirte bien";
      subMessage = "Aún tienes margen, aprovecha para darle a tu cuerpo la energía que necesita.";
    } else {
      stateType = 'good';
      message = "¡Excelente trabajo!";
      subMessage = "Vas por muy buen camino, mantén este ritmo.";
    }

    // Generate 3 recommendations based on state
    const recommendations = [
      {
        type: 'protein',
        title: 'Opción alta en proteína',
        description: remainingProtein > 30 ? 'Pollo a la plancha con ensalada o salmón al horno.' : 'Yogur griego o un batido de proteínas.',
        icon: '🥩'
      },
      {
        type: 'balanced',
        title: 'Opción equilibrada',
        description: 'Plato combinado: 50% verduras, 25% proteína, 25% carbohidratos complejos.',
        icon: '🥗'
      },
      {
        type: 'flexible',
        title: 'Opción flexible',
        description: remainingCalories > 300 ? 'Tienes margen para un capricho moderado (ej. un trozo de chocolate negro o un helado pequeño).' : 'Mejor opta por fruta fresca si te apetece algo dulce.',
        icon: '🍫'
      }
    ];

    return { message, subMessage, stateType, recommendations, remainingCalories };
  };

  const assistant = getAssistantState();

  // Calculate weekly totals
  const weeklyStats = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const end = d.getTime() + 86400000;
    const start = end - (7 * 86400000);
    
    const weekMeals = meals.filter(m => m.timestamp >= start && m.timestamp < end);
    
    return weekMeals.reduce(
      (acc, meal) => ({
        calories: acc.calories + meal.calories,
        protein: acc.protein + meal.protein,
        carbs: acc.carbs + meal.carbs,
        fat: acc.fat + meal.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [meals]);

  const weeklyGoals = useMemo(() => ({
    calories: goals.calories * 7,
    protein: goals.protein * 7,
    carbs: goals.carbs * 7,
    fat: goals.fat * 7,
  }), [goals]);

  // Calculate last 7 days trends
  const trendsData = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      const start = d.getTime();
      const end = start + 86400000;
      
      const dayMeals = meals.filter(m => m.timestamp >= start && m.timestamp < end);
      const dayCals = dayMeals.reduce((sum, m) => sum + m.calories, 0);
      
      const pastWeights = weights.filter(w => w.timestamp < end);
      const dayWeight = pastWeights.length > 0 ? pastWeights[pastWeights.length - 1].weight : null;
      
      return {
        name: d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
        calories: dayCals,
        weight: dayWeight,
        goal: goals.calories
      };
    });
  }, [meals, weights, goals]);

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

      setEditingMeal(newMeal);
    } catch (error) {
      console.error("Error in handleTextFoodSubmit:", error);
      setAppError(error instanceof Error ? error.message : "Error al analizar el texto");
    } finally {
      setIsAnalyzing(false);
      setIsCapturing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("handleFileChange triggered");
    const file = e.target.files?.[0];
    if (!file) {
      console.log("No file selected");
      return;
    }

    console.log("File selected:", file.name, file.type, file.size);
    setIsCapturing(true);
    setIsAnalyzing(true);
    setAppError(null);

    try {
      console.log("Compressing image...");
      const base64String = await compressImage(file);
      console.log("Image compressed, length:", base64String.length);
      setPreviewImage(base64String);

      // Extract base64 data and mime type
      const match = base64String.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (!match) {
        console.error("Invalid image format");
        throw new Error("Formato de imagen inválido");
      }
      
      const mimeType = match[1];
      const base64Data = match[2];

      console.log("Mime type:", mimeType);

      // Calculate remaining macros for context
      const remainingCalories = goals.calories - totals.calories;
      const remainingProtein = goals.protein - totals.protein;
      const remainingCarbs = goals.carbs - totals.carbs;
      const remainingFat = goals.fat - totals.fat;
      const contextStr = `Usuario: ${profile.name || 'Usuario'}. Faltan aprox: ${Math.round(remainingCalories)} kcal, ${Math.round(remainingProtein)}g proteína, ${Math.round(remainingCarbs)}g carbohidratos, ${Math.round(remainingFat)}g grasas para cumplir el objetivo del día. Dieta: ${profile.dietType}.`;

      console.log("Calling analyzeFoodImage...");
      const info = await analyzeFoodImage(base64Data, mimeType, contextStr);
      console.log("Analysis result received:", info);
      
      const newMeal: Meal = {
        id: Date.now().toString(),
        ...info,
        imageUrl: base64String,
        timestamp: Date.now(),
      };

      setEditingMeal(newMeal);
    } catch (error) {
      console.error("Error in handleFileChange:", error);
      setAppError(error instanceof Error ? error.message : "Error al analizar la imagen");
    } finally {
      console.log("Analysis process finished");
      setIsAnalyzing(false);
      setIsCapturing(false);
      setPreviewImage(null);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadMenuPDF = () => {
    if (!generatedMenu) return;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    
    const primaryColor = [163, 230, 53]; // lime-400
    const secondaryColor = [24, 24, 27]; // zinc-900
    const accentColor = [16, 185, 129]; // emerald-500
    const textColor = [40, 40, 40];
    const lightTextColor = [113, 113, 122]; // zinc-500

    const drawHeader = (title: string, subtitle: string, color: number[]) => {
      doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.rect(0, 0, pageWidth, 50, 'F');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(32);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text('Nutritiv', margin, 25);
      doc.setTextColor(255, 255, 255);
      doc.text('App', margin + 42, 25);
      
      doc.setFontSize(10);
      doc.setTextColor(161, 161, 170); // zinc-400
      doc.text(subtitle.toUpperCase(), margin, 38);
      
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setLineWidth(1.5);
      doc.line(margin, 42, margin + 60, 42);
    };

    const drawFooter = (pageNumber: number) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(161, 161, 170);
      doc.text(`NutritivApp Premium Plan - Página ${pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    };

    // PAGE 1: COVER & PROFILE
    drawHeader('NutritivApp', 'Plan Nutricional de Alto Rendimiento', primaryColor);
    drawFooter(1);
    
    let y = 65;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('Tu Perfil de Rendimiento', margin, y);
    y += 15;
    
    // Goal Cards
    const drawGoalCard = (label: string, value: string, x: number, y: number, w: number, h: number = 25) => {
      doc.setFillColor(248, 250, 252); // slate-50
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.roundedRect(x, y, w, h, 4, 4, 'FD');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.text(label.toUpperCase(), x + 6, y + 8);
      
      doc.setFontSize(14);
      doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.text(value, x + 6, y + 18);
    };

    const cardWidth = (contentWidth - 10) / 3;
    drawGoalCard('Calorías Diarias', `${goals.calories} kcal`, margin, y, cardWidth);
    drawGoalCard('Proteínas', `${goals.protein}g`, margin + cardWidth + 5, y, cardWidth);
    drawGoalCard('Carbohidratos', `${goals.carbs}g`, margin + (cardWidth + 5) * 2, y, cardWidth);
    y += 30;
    drawGoalCard('Grasas', `${goals.fat}g`, margin, y, cardWidth);
    drawGoalCard('Tipo de Dieta', profile.dietType || 'Equilibrada', margin + cardWidth + 5, y, cardWidth * 2 + 5);
    y += 40;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('Configuración Personalizada', margin, y);
    y += 12;

    const profileData = [
      ['Edad', `${profile.age} años`],
      ['Altura', `${profile.height} cm`],
      ['Peso Actual', `${weights.length > 0 ? weights[weights.length - 1].weight : '---'} kg`],
      ['Actividad', `${profile.activityLevel}x`],
      ['Alergias', profile.allergies || 'Ninguna'],
      ['No deseados', profile.dislikedFoods || 'Ninguno']
    ];

    autoTable(doc, {
      startY: y,
      head: [],
      body: profileData,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: lightTextColor as [number, number, number], cellWidth: 40 },
        1: { textColor: textColor as [number, number, number] }
      },
      margin: { left: margin }
    });

    y = (doc as any).lastAutoTable.finalY + 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('Recomendaciones del Coach', margin, y);
    y += 10;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    const recommendations = doc.splitTextToSize(generatedMenu.recommendations, contentWidth);
    doc.text(recommendations, margin, y);

    // PAGE 2+: WEEKLY MENU
    let pageNum = 2;
    generatedMenu.days.forEach((dayData) => {
      doc.addPage();
      drawHeader('NutritivApp', `Menú Detallado: ${dayData.day}`, primaryColor);
      drawFooter(pageNum++);
      
      y = 65;
      
      const tableData = dayData.meals.map(meal => [
        meal.type.toUpperCase(),
        meal.description,
        meal.calories ? `${meal.calories} kcal` : '---'
      ]);

      const dayTotalCals = dayData.meals.reduce((sum, m) => sum + (m.calories || 0), 0);

      autoTable(doc, {
        startY: y,
        head: [['COMIDA', 'DESCRIPCIÓN DETALLADA', 'CALORÍAS']],
        body: tableData,
        theme: 'grid',
        headStyles: {
          fillColor: secondaryColor as [number, number, number],
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: 'bold',
          halign: 'center'
        },
        styles: {
          fontSize: 10,
          cellPadding: 6,
          valign: 'middle',
          lineColor: [230, 230, 230],
          lineWidth: 0.1
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 30, halign: 'center', textColor: primaryColor as [number, number, number] },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 30, halign: 'center', fontStyle: 'bold' }
        },
        alternateRowStyles: {
          fillColor: [252, 252, 252]
        },
        margin: { left: margin, right: margin },
        didDrawPage: (data: any) => {
          y = data.cursor.y;
        }
      });

      y = (doc as any).lastAutoTable.finalY + 10;
      
      // Day Summary Box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y, contentWidth, 15, 2, 2, 'FD');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.text(`TOTAL CALORÍAS ${dayData.day.toUpperCase()}:`, margin + 5, y + 9.5);
      
      doc.setFontSize(12);
      doc.setTextColor(primaryColor[0] - 40, primaryColor[1] - 40, primaryColor[2] - 40);
      doc.text(`${dayTotalCals} kcal`, pageWidth - margin - 5, y + 9.5, { align: 'right' });
    });

    doc.save(`NutritivApp_Plan_Premium_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const downloadShoppingListHTML = () => {
    if (!shoppingList) return;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lista de la Compra - NutritivApp</title>
    <style>
        :root { --lime: #a3e635; --zinc-950: #09090b; --zinc-900: #18181b; --zinc-800: #27272a; }
        body { font-family: system-ui, -apple-system, sans-serif; background: var(--zinc-950); color: white; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        h1 { font-size: 24px; font-weight: 900; letter-spacing: -1px; margin-bottom: 5px; }
        .subtitle { color: #71717a; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
        .supermarket { color: var(--lime); font-size: 14px; font-weight: 800; text-transform: uppercase; margin-bottom: 30px; border-bottom: 1px solid rgba(163, 230, 53, 0.2); padding-bottom: 10px; }
        .category { margin-bottom: 25px; }
        .category-title { color: #71717a; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .category-title::before { content: ''; width: 4px; height: 4px; background: var(--lime); border-radius: 50%; }
        .item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s; }
        .checkbox { width: 20px; height: 20px; border: 1px solid #3f3f46; border-radius: 6px; background: #18181b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .item.checked { opacity: 0.5; border-color: rgba(163, 230, 53, 0.2); background: rgba(163, 230, 53, 0.02); }
        .item.checked .checkbox { background: var(--lime); border-color: var(--lime); }
        .item.checked .checkbox::after { content: '✓'; color: #09090b; font-size: 12px; font-weight: bold; }
        .item.checked .name { text-decoration: line-through; color: #71717a; }
        .name { font-size: 14px; font-weight: 500; flex: 1; }
        .amount { color: var(--lime); font-size: 10px; font-weight: 800; text-transform: uppercase; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Nutritiv<span style="color: var(--lime)">App</span></h1>
        <div class="subtitle">Lista de la Compra Interactiva</div>
        <div class="supermarket">Supermercado: ${profile.favoriteSupermarket}</div>
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

  const downloadShoppingListPDF = () => {
    if (!shoppingList) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    
    const primaryColor = [163, 230, 53]; // lime-400
    const secondaryColor = [24, 24, 27]; // zinc-900
    const accentColor = [16, 185, 129]; // emerald-500
    const textColor = [40, 40, 40];
    const lightTextColor = [113, 113, 122]; // zinc-500

    const drawHeader = (title: string, subtitle: string, color: number[]) => {
      doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.rect(0, 0, pageWidth, 50, 'F');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(32);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text('Nutritiv', margin, 25);
      doc.setTextColor(255, 255, 255);
      doc.text('App', margin + 42, 25);
      
      doc.setFontSize(10);
      doc.setTextColor(161, 161, 170); // zinc-400
      doc.text(subtitle.toUpperCase(), margin, 38);
      
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setLineWidth(1.5);
      doc.line(margin, 42, margin + 60, 42);
    };

    const drawFooter = (pageNumber: number) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(161, 161, 170);
      doc.text(`NutritivApp Premium Plan - Página ${pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    };

    let pageNum = 1;
    drawHeader('NutritivApp', `Lista de la Compra - ${profile.favoriteSupermarket}`, accentColor);
    drawFooter(pageNum++);
    let y = 65;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('Ingredientes Necesarios', margin, y);
    y += 10;

    const shoppingData: any[] = [];
    let totalPrice = 0;

    shoppingList.categories.forEach(cat => {
      shoppingData.push([{ 
        content: cat.name.toUpperCase(), 
        colSpan: 1, 
        styles: { 
          fillColor: [241, 245, 249], 
          fontStyle: 'bold', 
          textColor: accentColor,
          fontSize: 12,
          cellPadding: 5
        } 
      }]);
      
      cat.items.forEach(item => {
        shoppingData.push([
          { content: `[ ] ${item.name} (${item.amount})` }
        ]);
      });
    });

    autoTable(doc, {
      startY: y,
      head: [['ARTÍCULO']],
      body: shoppingData,
      theme: 'plain',
      styles: {
        fontSize: 10,
        cellPadding: 4,
        textColor: textColor as [number, number, number]
      },
      headStyles: {
        fillColor: accentColor as [number, number, number],
        textColor: [255, 255, 255],
        fontSize: 11,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { cellWidth: contentWidth }
      },
      margin: { left: margin, right: margin }
    });

    doc.save(`NutritivApp_Compra_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleRecalculateMacros = async () => {
    if (!editingMeal || !editingMeal.foodName) return;
    setIsRecalculating(true);
    try {
      const remainingCalories = goals.calories - totals.calories;
      const remainingProtein = goals.protein - totals.protein;
      const remainingCarbs = goals.carbs - totals.carbs;
      const remainingFat = goals.fat - totals.fat;
      
      let foodDescription = editingMeal.foodName;
      if (editingMeal.ingredients && editingMeal.ingredients.length > 0) {
        const ingredientsList = editingMeal.ingredients.map(i => `${i.name}: ${i.amount}`).join(', ');
        foodDescription = `${editingMeal.foodName} (Ingredientes: ${ingredientsList})`;
      }

      const contextStr = `Usuario: ${profile.name || 'Usuario'}. Faltan aprox: ${Math.round(remainingCalories)} kcal, ${Math.round(remainingProtein)}g proteína, ${Math.round(remainingCarbs)}g carbohidratos, ${Math.round(remainingFat)}g grasas. Dieta: ${profile.dietType}.`;

      const newMacros = await recalculateFoodMacros(foodDescription, contextStr);
      setEditingMeal({
        ...editingMeal,
        ...newMacros
      });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Error al recalcular macros. Inténtalo de nuevo.");
    } finally {
      setIsRecalculating(false);
    }
  };

  const removeMeal = (id: string) => {
    setMeals((prev) => prev.filter((m) => m.id !== id));
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
      setIsWeightModalOpen(false);
      setNewWeight('');
    }
  };

  const handleGenerateMenu = async (customProfile?: UserProfile, customGoals?: typeof goals) => {
    const activeProfile = customProfile || profile;
    const activeGoals = customGoals || goals;
    if (activeProfile.age === 0) return;
    setIsGeneratingMenu(true);
    setShoppingList(null);
    setAppError(null);
    try {
      const freeMealStr = activeProfile.freeMealEnabled 
        ? `Comida/Cena libre: Habilitada para el ${activeProfile.freeMealDay} (${activeProfile.freeMealType}).` 
        : 'Comida/Cena libre: Deshabilitada.';
      
      const profileStr = `Nombre/Alias: ${activeProfile.name || 'Usuario'}, Edad: ${activeProfile.age}, Peso: ${weights.length > 0 ? weights[weights.length - 1].weight : 'No especificado'}kg, Altura: ${activeProfile.height}cm, Género: ${activeProfile.gender}, Nivel de actividad: ${activeProfile.activityLevel}, Objetivo: ${activeProfile.goal}, Distribución de macros: ${activeProfile.macroDistribution}, Calorías objetivo: ${activeGoals.calories}kcal (${activeGoals.protein}g Proteína, ${activeGoals.carbs}g Carbohidratos, ${activeGoals.fat}g Grasas), Supermercado favorito: ${activeProfile.favoriteSupermarket}. ${freeMealStr}`;
      const preferencesStr = `Tipo de dieta: ${activeProfile.dietType || 'Normal'}. Alergias: ${activeProfile.allergies || 'Ninguna'}. Alimentos no deseados: ${activeProfile.dislikedFoods || 'Ninguno'}.`;
      
      const menu = await generateWeeklyMenu(profileStr, preferencesStr);
      setGeneratedMenu(menu);
      
      // Automatically generate shopping list as well
      setIsGeneratingShoppingList(true);
      try {
        const list = await generateShoppingList(menu, activeProfile.favoriteSupermarket);
        setShoppingList(list);
      } catch (err) {
        console.error("Error generating initial shopping list:", err);
      } finally {
        setIsGeneratingShoppingList(false);
      }
      
    } catch (error: any) {
      console.error("Error generating menu:", error);
      setAppError(error.message || "Error al generar el plan. Inténtalo de nuevo.");
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
      const list = await generateShoppingList(generatedMenu, profile.favoriteSupermarket);
      setShoppingList(list);
    } catch (error) {
      console.error("Error generating shopping list:", error);
      setAppError("Error al generar la lista de la compra. Inténtalo de nuevo.");
    } finally {
      setIsGeneratingShoppingList(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentChatMessage.trim()) return;

    const newUserMessage = currentChatMessage;
    const newMessages = [...chatMessages, { role: 'user' as const, parts: [{ text: newUserMessage }] }];
    setChatMessages(newMessages);
    setCurrentChatMessage('');
    setIsChatLoading(true);

    try {
      const contextStr = `Usuario: ${profile.name || 'Usuario'}.
- Edad: ${profile.age}, Peso: ${weights.length > 0 ? weights[weights.length - 1].weight : 'N/A'}kg, Altura: ${profile.height}cm, Género: ${profile.gender}
- Dieta: ${profile.dietType}, Alergias: ${profile.allergies || 'Ninguna'}, No le gusta: ${profile.dislikedFoods || 'Nada'}
- Calorías objetivo: ${goals.calories} kcal (P: ${goals.protein}g, C: ${goals.carbs}g, G: ${goals.fat}g)
- Consumido hoy: ${Math.round(totals.calories)} kcal (P: ${Math.round(totals.protein)}g, C: ${Math.round(totals.carbs)}g, G: ${Math.round(totals.fat)}g)
- Menú semanal actual: ${generatedMenu ? 'Sí, generado' : 'No generado'}`;

      const responseText = await chatWithCoach(newMessages, contextStr);
      setChatMessages(prev => [...prev, { role: 'model', parts: [{ text: responseText }] }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'model', parts: [{ text: "Hubo un error de conexión. Inténtalo de nuevo." }] }]);
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
    }

    setProfile(editProfile);

    // Calculate BMR (Mifflin-St Jeor)
    let bmr = 10 * weightVal + 6.25 * editProfile.height - 5 * editProfile.age;
    bmr += editProfile.gender === 'male' ? 5 : -161;

    // Calculate TDEE
    const tdee = bmr * editProfile.activityLevel;

    // Adjust calories based on goal
    let targetCalories = Math.round(tdee);
    if (editProfile.goal === 'lose') {
      targetCalories -= 500; // 500 kcal deficit
    } else if (editProfile.goal === 'gain') {
      targetCalories += 300; // 300 kcal surplus
    }

    // Adjust macros based on distribution
    let proteinRatio = 0.3;
    let carbsRatio = 0.4;
    let fatRatio = 0.3;

    switch (editProfile.macroDistribution) {
      case 'low_carb':
        proteinRatio = 0.4;
        carbsRatio = 0.2;
        fatRatio = 0.4;
        break;
      case 'high_protein':
        proteinRatio = 0.4;
        carbsRatio = 0.3;
        fatRatio = 0.3;
        break;
      case 'keto':
        proteinRatio = 0.25;
        carbsRatio = 0.05;
        fatRatio = 0.7;
        break;
      case 'balanced':
      default:
        proteinRatio = 0.3;
        carbsRatio = 0.4;
        fatRatio = 0.3;
        break;
    }

    const newGoals = {
      calories: targetCalories,
      protein: Math.round((targetCalories * proteinRatio) / 4),
      carbs: Math.round((targetCalories * carbsRatio) / 4),
      fat: Math.round((targetCalories * fatRatio) / 9),
    };

    setGoals(newGoals);
    
    setIsGoalModalOpen(false);

    // Auto-regenerate menu and shopping list on profile update
    handleGenerateMenu(editProfile, newGoals);
  };

  const updateHabit = (type: 'water' | 'sleep', value: number) => {
    const todayStr = new Date().toISOString().split('T')[0];
    setHabits(prev => ({
      ...prev,
      [todayStr]: {
        ...(prev[todayStr] || { water: 0, sleep: 0 }),
        [type]: value
      }
    }));
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

  const todayStr = new Date().toISOString().split('T')[0];
  const todayHabits = habits[todayStr] || { water: 0, sleep: 0 };

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

  const handleSearchRestaurants = async (e?: React.FormEvent, overrideLocation?: string) => {
    if (e) e.preventDefault();
    setIsSearchingRestaurants(true);
    setAppError(null);
    try {
      const location = overrideLocation || restaurantLocation || 'mi ciudad';
      const prefs = [
        restaurantFilters.dietType ? `Dieta: ${profile.dietType}` : '',
        restaurantFilters.allergies ? `Alergias: ${profile.allergies}` : '',
        restaurantFilters.other ? `Otros filtros: ${restaurantFilters.other}` : ''
      ].filter(Boolean).join(', ');
      
      const results = await findRestaurants(location, prefs);
      setRestaurants(results);
      setRestaurantPage(1);
      setResultsLimit(15);
    } catch (error: any) {
      setAppError(error.message);
    } finally {
      setIsSearchingRestaurants(false);
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
        activityLevel: 1.55,
        dietType: 'Normal',
        allergies: '',
        dislikedFoods: '',
        goal: 'maintain',
        macroDistribution: 'balanced',
        favoriteSupermarket: 'Mercadona',
        freeMealEnabled: false,
        freeMealDay: 'Sábado',
        freeMealType: 'cena'
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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-lime-400 animate-spin" />
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
          <div className="w-16 h-16 bg-lime-400 rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg shadow-lime-400/20">
            <Banana className="w-10 h-10 text-zinc-950" />
          </div>
          <h1 className="text-3xl font-display font-black tracking-tighter text-white mb-8 text-center">
            {isRegistering ? 'Regístrate para empezar' : 'Inicia sesión en NutritivApp'}
          </h1>
          
          <div className="space-y-3 mb-8">
            <button
              onClick={handleGoogleLogin}
              className="w-full bg-transparent border border-zinc-500 text-white font-bold py-3 px-6 rounded-full flex items-center justify-center gap-3 hover:border-lime-400 hover:text-lime-400 transition-all"
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
              <div className="p-3 rounded-lg bg-lime-500/10 border border-lime-500/20 flex items-start gap-2 text-lime-400 text-sm">
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
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-lime-400/50 transition-all placeholder:text-zinc-500"
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
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-lime-400/50 transition-all placeholder:text-zinc-500"
                placeholder="Contraseña"
              />
            </div>

            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full bg-lime-400 text-zinc-950 font-bold py-3.5 px-6 rounded-full flex items-center justify-center gap-2 hover:bg-lime-500 hover:scale-105 transition-all disabled:opacity-50 mt-8 uppercase tracking-wider text-sm"
            >
              {isAuthenticating ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isRegistering ? 'Registrarse' : 'Iniciar sesión'}
            </button>
            
            <div className="text-center mt-8 space-y-4">
              {!isRegistering && (
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  className="text-sm text-lime-400 font-bold hover:underline transition-all block mx-auto"
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
                  className="text-white font-bold hover:text-lime-400 hover:underline transition-all"
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
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950 text-zinc-50 pb-24 font-sans selection:bg-lime-500/30">
      {/* Header */}
      <header className="pt-12 pb-6 px-6 sticky top-0 bg-zinc-950/60 backdrop-blur-2xl z-50 border-b border-white/5">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col"
          >
            <h1 className="text-2xl font-display font-black tracking-tighter text-white flex items-center gap-2">
              <Banana className="w-6 h-6 text-lime-400 fill-lime-400/20" />
              Nutritiv<span className="text-lime-400">App</span>
            </h1>
            <p className="text-zinc-400 text-xs font-semibold tracking-widest uppercase mt-0.5">Rendimiento Diario</p>
          </motion.div>
          <div className="flex items-center gap-3">
            <motion.button 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => { 
                setEditProfile({
                  ...profile,
                  allergies: profile.allergies || '',
                  dislikedFoods: profile.dislikedFoods || ''
                });
                const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight.toString() : '';
                setEditWeight(latestWeight);
                setIsGoalModalOpen(true); 
              }}
              className={`relative h-10 px-3 rounded-xl flex items-center justify-center gap-2 transition-all ${
                profile.age === 0 
                  ? 'bg-lime-400 shadow-[0_0_20px_rgba(163,230,53,0.4)] hover:bg-lime-500' 
                  : 'bg-gradient-to-br from-lime-400/20 to-lime-400/5 border border-lime-400/20 shadow-[0_0_15px_rgba(163,230,53,0.15)] hover:scale-105 active:scale-95'
              }`}
            >
              <UserIcon className={`w-5 h-5 ${profile.age === 0 ? 'text-zinc-950' : 'text-lime-400'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider hidden sm:block ${profile.age === 0 ? 'text-zinc-950' : 'text-lime-400'}`}>
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
        <div className="flex bg-zinc-900/50 p-1 rounded-2xl border border-white/5">
          <button 
            onClick={() => setActiveTab('today')}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${activeTab === 'today' ? 'bg-lime-400 text-zinc-950 shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Hoy
          </button>
          <button 
            onClick={() => setActiveTab('week')}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${activeTab === 'week' ? 'bg-lime-400 text-zinc-950 shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Semana
          </button>
          <button 
            onClick={() => setActiveTab('plan')}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${activeTab === 'plan' ? 'bg-lime-400 text-zinc-950 shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Plan
          </button>
          {profile.freeMealEnabled && (
            <button 
              onClick={() => setActiveTab('restaurants')}
              className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${activeTab === 'restaurants' ? 'bg-lime-400 text-zinc-950 shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Libre
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
              className="space-y-8 pb-32"
            >
              {isStagnant && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-amber-500 font-bold text-sm mb-1">Estancamiento Detectado</h4>
                    <p className="text-zinc-400 text-xs mb-3">Tu peso no ha variado significativamente en las últimas 2 semanas. ¿Quieres ajustar tus calorías objetivo?</p>
                    <button 
                      onClick={() => {
                        setEditProfile({
                          ...profile,
                          allergies: profile.allergies || '',
                          dislikedFoods: profile.dislikedFoods || ''
                        });
                        const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight.toString() : '';
                        setEditWeight(latestWeight);
                        setIsGoalModalOpen(true);
                      }}
                      className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                    >
                      Ajustar Objetivos
                    </button>
                  </div>
                </div>
              )}

              {/* Assistant Header */}
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 relative overflow-hidden">
                {/* Background glow based on state */}
                <div className={`absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl ${
                  assistant.stateType === 'good' || assistant.stateType === 'start' ? 'bg-lime-400/10' :
                  assistant.stateType === 'over' ? 'bg-rose-400/10' :
                  'bg-amber-400/10'
                }`}></div>
                
                <div className="relative z-10 text-center">
                  <h2 className="text-6xl font-display font-black text-white mb-2 tracking-tighter">
                    {Math.round(assistant.remainingCalories)}
                  </h2>
                  <p className="text-zinc-400 font-medium uppercase tracking-widest text-xs mb-6">{profile.name || 'Usuario'}, Kcal Restantes</p>
                  
                  <div className={`inline-block backdrop-blur-md border rounded-2xl px-6 py-4 ${
                    assistant.stateType === 'good' || assistant.stateType === 'start' ? 'bg-lime-500/10 border-lime-500/20' :
                    assistant.stateType === 'over' ? 'bg-rose-500/10 border-rose-500/20' :
                    'bg-amber-500/10 border-amber-500/20'
                  }`}>
                    <h3 className={`text-xl font-bold mb-1 ${
                      assistant.stateType === 'good' || assistant.stateType === 'start' ? 'text-lime-400' :
                      assistant.stateType === 'over' ? 'text-rose-400' :
                      'text-amber-400'
                    }`}>
                      {assistant.message}
                    </h3>
                    <p className="text-sm text-zinc-300">{assistant.subMessage}</p>
                  </div>
                </div>
              </div>

              {/* Próximo paso */}
              {meals.length > 0 && (meals[0].actionableRecommendation || meals[0].recommendations) && (
                <div>
                  <h3 className="text-lg font-display font-bold text-white tracking-tight uppercase mb-4">Próximo paso</h3>
                  <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-4 flex items-start gap-4">
                    <div className="text-3xl bg-blue-500/10 text-blue-400 p-3 rounded-xl border border-blue-500/20 flex items-center justify-center w-14 h-14 shrink-0">
                      <Info className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-blue-400 text-sm mb-1">Sugerencia del Coach</h4>
                      <p className="text-xs text-zinc-300 leading-relaxed">{meals[0].actionableRecommendation?.replace(new RegExp(`${profile.name}`, 'gi'), '').replace(/^[,.\s]+|[,.\s]+$/g, '') || meals[0].recommendations?.replace(new RegExp(`${profile.name}`, 'gi'), '').replace(/^[,.\s]+|[,.\s]+$/g, '')}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Primary Food Entry */}
              <div className="bg-zinc-900/80 border border-white/10 rounded-3xl p-5 shadow-xl">
                <h3 className="text-lg font-display font-bold text-white tracking-tight uppercase mb-4">Añadir Comida</h3>
                
                {/* Text Input */}
                <div className="relative mb-4">
                  <input
                    type="text"
                    placeholder="Ej: He comido arroz con pollo..."
                    className="w-full bg-zinc-950 border border-white/10 rounded-2xl pl-4 pr-14 py-4 text-white placeholder:text-zinc-500 focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 transition-all text-base"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleTextFoodSubmit(e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                  <button 
                    className="absolute right-2 top-2 bottom-2 bg-lime-400 text-zinc-950 px-4 rounded-xl hover:bg-lime-300 transition-colors flex items-center justify-center"
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="Ej: He comido arroz con pollo..."]') as HTMLInputElement;
                      if (input && input.value) {
                        handleTextFoodSubmit(input.value);
                        input.value = '';
                      }
                    }}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>

                {/* Quick Buttons */}
                <div className="grid grid-cols-3 gap-2 mb-4 hidden">
                  <button 
                    onClick={() => handleTextFoodSubmit("Comida ligera")} 
                    className="flex flex-col items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 p-3 rounded-2xl transition-colors border border-white/5"
                  >
                    <span className="text-xl">🥗</span>
                    <span className="text-xs font-medium">Ligera</span>
                  </button>
                  <button 
                    onClick={() => handleTextFoodSubmit("Comida normal")} 
                    className="flex flex-col items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 p-3 rounded-2xl transition-colors border border-white/5"
                  >
                    <span className="text-xl">🍽️</span>
                    <span className="text-xs font-medium">Normal</span>
                  </button>
                  <button 
                    onClick={() => handleTextFoodSubmit("Comida fuerte")} 
                    className="flex flex-col items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 p-3 rounded-2xl transition-colors border border-white/5"
                  >
                    <span className="text-xl">🥩</span>
                    <span className="text-xs font-medium">Fuerte</span>
                  </button>
                </div>

                {/* Camera Option */}
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-950 text-zinc-400 hover:text-white p-4 rounded-2xl transition-colors border border-white/5"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-sm font-medium">Escanear con cámara (Opcional)</span>
                </button>
              </div>

        {/* Meal List */}
        <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-display font-bold text-white tracking-tight uppercase">Comidas de hoy</h2>
                  <span className="text-[10px] font-bold bg-lime-400/10 text-lime-400 px-2.5 py-1 rounded-full border border-lime-400/20 uppercase tracking-wider">
                    {todaysMeals.length} {todaysMeals.length === 1 ? 'registro' : 'registros'}
                  </span>
                </div>
                
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {todaysMeals.length === 0 ? (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-12 bg-zinc-900/30 rounded-[2rem] border border-white/5 border-dashed"
                      >
                        <p className="text-zinc-500 font-medium">Aún no has registrado comidas hoy.</p>
                        <p className="text-zinc-600 text-sm mt-1">Toca el botón para empezar.</p>
                      </motion.div>
                    ) : (
                      todaysMeals.map((meal) => (
                        <motion.div
                          key={meal.id}
                          layout
                          initial={{ opacity: 0, y: 20, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                          whileHover={{ scale: 1.01, backgroundColor: "rgba(39, 39, 42, 0.8)" }}
                          className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 group transition-colors shadow-lg"
                        >
                          <div className="flex gap-4 items-start">
                            <div className="w-16 h-16 rounded-xl overflow-hidden bg-zinc-800 shrink-0 relative mt-1 ring-1 ring-white/10">
                              <img src={meal.imageUrl} alt={meal.foodName} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/20"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="font-semibold text-zinc-100 truncate">{meal.foodName}</h3>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setEditingMeal(meal)}
                                    className="p-1.5 -mt-1.5 text-zinc-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-full transition-colors"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => removeMeal(meal.id)}
                                    className="p-1.5 -mt-1.5 -mr-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-full transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-3 mt-1 text-xs font-medium">
                                <span className="text-lime-400">{Math.round(meal.calories)} kcal</span>
                                {meal.totalWeight && (
                                  <>
                                    <span className="text-zinc-500">•</span>
                                    <span className="text-zinc-400">{meal.totalWeight}g</span>
                                  </>
                                )}
                                <span className="text-zinc-500">•</span>
                                <NutriScoreBadge score={meal.nutriScore} />
                              </div>
                              
                              <div className="flex items-center gap-3 mt-1 text-[10px] font-medium">
                                <span className="text-blue-400">P: {Math.round(meal.protein)}g</span>
                                <span className="text-amber-400">H: {Math.round(meal.carbs)}g</span>
                                <span className="text-rose-400">G: {Math.round(meal.fat)}g</span>
                              </div>

                              {/* Confidence Badge */}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {meal.isHealthy !== undefined && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${meal.isHealthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                                    {meal.isHealthy ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                    {meal.isHealthy ? 'Saludable' : 'Moderación'}
                                  </span>
                                )}
                                {meal.confidence === 'alta' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium border border-emerald-500/20">
                                    <CheckCircle2 className="w-3 h-3" /> Confianza Alta
                                  </span>
                                )}
                                {meal.confidence === 'media' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-medium border border-amber-500/20">
                                    <Info className="w-3 h-3" /> Confianza Media
                                  </span>
                                )}
                                {meal.confidence === 'baja' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 text-[10px] font-medium border border-rose-500/20">
                                    <AlertTriangle className="w-3 h-3" /> Confianza Baja
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Coach Analysis */}
                          <div className="mt-1 pt-3 border-t border-zinc-800/50 text-xs space-y-2">
                            {(meal.interpretation || meal.isHealthy !== undefined) && (
                              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/50 text-zinc-300">
                                <Activity className="w-3 h-3 text-lime-400" />
                                {meal.interpretation || (meal.isHealthy ? 'Equilibrado' : 'A tener en cuenta')}
                              </div>
                            )}
                            {(meal.coachMessage || meal.healthAnalysis) && (
                              <p className="text-zinc-400 leading-relaxed">
                                <span className="font-semibold text-lime-400">Coach:</span> {meal.coachMessage || meal.healthAnalysis}
                              </p>
                            )}

                            {(meal.confidence === 'media' || meal.confidence === 'baja') && (
                              <>
                                <p className="text-zinc-400 leading-relaxed">
                                  <span className="font-semibold text-zinc-300">Nota de la IA:</span> {meal.confidenceMessage}
                                </p>
                                {meal.alternatives && meal.alternatives.length > 0 && (
                                  <div className="mt-1">
                                    <span className="font-semibold text-zinc-300">Otras posibilidades: </span>
                                    <span className="text-zinc-400">{meal.alternatives.join(', ')}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </section>
            </motion.div>
          )}
          {activeTab === 'week' && (
            <motion.div
              key="week"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 pb-8"
            >
              {/* Coach Weekly Advice */}
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-6 flex items-start gap-4">
                <div className="p-3 bg-indigo-500/20 rounded-2xl">
                  <Bot className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-indigo-400 font-bold text-lg mb-1">Consejo del Coach</h3>
                  <p className="text-zinc-300 text-sm leading-relaxed">
                    {weeklyStats.calories > weeklyGoals.calories 
                      ? "Esta semana has superado ligeramente tu objetivo calórico. No te preocupes, mantén la constancia y prioriza proteínas en tus próximas comidas para equilibrar."
                      : "Vas por muy buen camino esta semana. Tu adherencia al plan es excelente. Sigue así para ver resultados consistentes en tu composición corporal."}
                  </p>
                </div>
              </div>

              {/* Trends Panel */}
              <section>
                <div className="bg-gradient-to-b from-zinc-900/80 to-zinc-900/30 rounded-[2rem] p-6 border border-white/5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-lime-400/5 rounded-full blur-3xl"></div>
                  <div className="flex items-center gap-3 mb-6 relative z-10">
                    <div className="p-2 bg-lime-400/10 rounded-xl border border-lime-400/20">
                      <TrendingUp className="w-5 h-5 text-lime-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-display font-bold text-white tracking-tight uppercase">Historial de Calorías</h2>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Consumo vs Objetivo</p>
                    </div>
                  </div>

                  <div className="h-48 w-full -ml-4 relative z-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trendsData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                        <XAxis 
                          dataKey="name" 
                          stroke="#52525b" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          tick={{ fill: '#71717a', fontWeight: 600 }}
                          dy={10}
                        />
                        <YAxis yAxisId="cal" orientation="left" hide domain={[0, 'dataMax + 500']} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '16px', color: '#fff' }}
                          itemStyle={{ fontSize: '12px', fontWeight: 600 }}
                          labelStyle={{ color: '#a1a1aa', marginBottom: '4px', fontSize: '10px', fontWeight: 700 }}
                          cursor={{ fill: '#27272a', opacity: 0.4 }}
                        />
                        <Bar 
                          yAxisId="cal" 
                          dataKey="calories" 
                          fill="#a3e635" 
                          radius={[6, 6, 6, 6]} 
                          barSize={12} 
                          name="Consumidas" 
                        />
                        <Line 
                          yAxisId="cal" 
                          type="monotone" 
                          dataKey="goal" 
                          stroke="#818cf8" 
                          strokeWidth={2} 
                          strokeDasharray="5 5"
                          dot={false}
                          name="Objetivo" 
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="mt-4 flex items-center justify-center gap-6 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm bg-lime-400"></div>
                      <span>Consumidas</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-indigo-400 border-t border-dashed border-indigo-400"></div>
                      <span>Objetivo</span>
                    </div>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
          {activeTab === 'plan' && (
            <motion.div
              key="plan"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 pb-32"
            >
              {profile.age === 0 ? (
                <div className="bg-zinc-900/80 rounded-[2rem] p-8 border border-white/5 text-center">
                  <UserIcon className="w-12 h-12 text-lime-400 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-display font-bold text-white mb-2">Configura tu Perfil</h3>
                  <p className="text-zinc-400 text-sm mb-6">Introduce tu edad, peso y altura en la configuración para calcular tus macros y recibir un plan personalizado.</p>
                  <button 
                    onClick={() => { 
                      setEditProfile({
                        ...profile,
                        allergies: profile.allergies || '',
                        dislikedFoods: profile.dislikedFoods || ''
                      });
                      const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight.toString() : '';
                      setEditWeight(latestWeight);
                      setIsGoalModalOpen(true); 
                    }}
                    className="bg-lime-400 text-zinc-950 px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-sm"
                  >
                    Configurar ahora
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-gradient-to-br from-lime-400/10 to-zinc-900/80 rounded-[2rem] p-6 border border-lime-400/20">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Utensils className="w-6 h-6 text-lime-400" />
                        <h2 className="text-xl font-display font-bold text-white uppercase tracking-tight">Plan Nutricional</h2>
                      </div>
                    </div>
                    {generatedMenu ? (
                      <div className="space-y-6">
                        {isGeneratingMenu ? (
                          <div className="bg-zinc-950/30 rounded-2xl border border-white/5 p-12 text-center">
                            <div className="relative w-20 h-20 mx-auto mb-6">
                              <motion.div
                                className="absolute inset-0 rounded-2xl bg-lime-400/20"
                                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.2, 0.5] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <Utensils className="w-8 h-8 text-lime-400" />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-white font-bold">Diseñando el plan de {profile.name || 'Usuario'}...</p>
                              <motion.div 
                                className="text-zinc-500 text-xs font-mono h-4"
                                animate={{ opacity: [0, 1, 0] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                              >
                                {'> Calculando macros óptimos...'}
                              </motion.div>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-zinc-950/30 rounded-2xl border border-white/5 p-6 text-center">
                            <CheckCircle2 className="w-12 h-12 text-lime-400 mx-auto mb-3 opacity-50" />
                            <p className="text-zinc-300 font-bold mb-2">¡Plan de {profile.name || 'Usuario'} listo!</p>
                            <p className="text-zinc-500 text-xs mb-6 px-4">Tu plan nutricional personalizado y la lista de la compra optimizada ya están disponibles.</p>
                            
                            <div className="grid grid-cols-2 gap-3">
                              <button 
                                type="button"
                                onClick={downloadMenuPDF}
                                className="flex flex-col items-center gap-2 bg-lime-400/10 hover:bg-lime-400/20 text-lime-400 p-4 rounded-2xl border border-lime-400/20 transition-all group"
                              >
                                <Download className="w-6 h-6 group-hover:scale-110 transition-transform" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Descargar Plan</span>
                              </button>
                              <button 
                                onClick={() => handleGenerateMenu()}
                                disabled={isGeneratingMenu}
                                className="flex flex-col items-center gap-2 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 p-4 rounded-2xl border border-white/5 transition-all group disabled:opacity-50"
                              >
                                {isGeneratingMenu ? <Loader2 className="w-6 h-6 animate-spin" /> : <RefreshCw className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" />}
                                <span className="text-[10px] font-bold uppercase tracking-widest">Regenerar Plan</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Unified Shopping List Section */}
                        <div className="bg-zinc-900/50 rounded-3xl p-6 border border-white/5 space-y-6">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                              <ShoppingCart className="w-6 h-6 text-emerald-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold text-white">Lista de la Compra</h2>
                                {generatedMenu && (
                                  <button
                                    onClick={handleGenerateShoppingList}
                                    disabled={isGeneratingShoppingList}
                                    className="p-2 rounded-xl bg-zinc-800/50 text-zinc-400 hover:text-lime-400 transition-colors disabled:opacity-50"
                                    title="Regenerar lista de la compra"
                                  >
                                    <RefreshCw className={`w-4 h-4 ${isGeneratingShoppingList ? 'animate-spin' : ''}`} />
                                  </button>
                                )}
                              </div>
                              <p className="text-zinc-400 text-sm">Lista de ingredientes necesarios</p>
                            </div>
                          </div>

                          {!shoppingList || isGeneratingShoppingList ? (
                            <div className="text-center py-12">
                              <div className="relative w-20 h-20 mx-auto mb-6">
                                <motion.div
                                  className="absolute inset-0 rounded-2xl bg-lime-400/20"
                                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.2, 0.5] }}
                                  transition={{ repeat: Infinity, duration: 2 }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <ShoppingCart className="w-8 h-8 text-lime-400" />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <p className="text-white font-bold">
                                  {isGeneratingShoppingList ? 'Analizando tu menú...' : 'Cargando lista...'}
                                </p>
                                <motion.div 
                                  className="text-zinc-500 text-xs font-mono h-4"
                                  animate={{ opacity: [0, 1, 0] }}
                                  transition={{ repeat: Infinity, duration: 1.5 }}
                                >
                                  {isGeneratingShoppingList ? `> Buscando productos en ${profile.favoriteSupermarket}...` : '> Preparando pasillos...'}
                                </motion.div>
                              </div>
                            </div>
                          ) : shoppingList.categories.length === 0 ? (
                            <div className="text-center py-8 bg-zinc-950/50 rounded-2xl border border-white/5">
                              <Info className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                              <p className="text-zinc-400 text-sm">No se han podido detectar ingredientes.</p>
                              <p className="text-zinc-600 text-[10px] mt-1">Intenta generar el menú de nuevo.</p>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-center">
                                <p className="text-emerald-400 text-sm font-medium mb-1">¡Lista generada con éxito!</p>
                                <p className="text-zinc-400 text-xs mb-4">La lista se ha generado orientada a tu supermercado favorito: <span className="text-lime-400 font-bold">{profile.favoriteSupermarket}</span>.</p>
                                
                                <div className="grid grid-cols-2 gap-3">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      downloadShoppingListHTML();
                                    }}
                                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-lime-400 text-zinc-950 hover:bg-lime-300 transition-colors font-bold text-[10px] uppercase tracking-widest"
                                  >
                                    <CheckSquare className="w-4 h-4" />
                                    Lista Web
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      downloadShoppingListPDF();
                                    }}
                                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-zinc-800 text-white hover:bg-zinc-700 transition-colors font-bold text-[10px] uppercase tracking-widest"
                                  >
                                    <Download className="w-4 h-4" />
                                    PDF
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-zinc-500 text-sm mb-4">Genera tu menú semanal y lista de la compra adaptados a tus preferencias.</p>
                        <button 
                          onClick={() => handleGenerateMenu()}
                          disabled={isGeneratingMenu}
                          className="bg-lime-400 text-zinc-950 px-6 py-2 rounded-xl font-bold uppercase tracking-wider text-xs"
                        >
                          {isGeneratingMenu ? 'Generando...' : 'Generar Plan'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'restaurants' && (
            <motion.div
              key="restaurants"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 pb-32"
            >
              {/* Encouragement Card */}
              <div className="bg-gradient-to-br from-lime-400/20 to-lime-400/5 border border-lime-400/20 rounded-3xl p-6 relative overflow-hidden">
                <div className="absolute -top-12 -right-12 w-32 h-32 bg-lime-400/20 rounded-full blur-3xl animate-pulse"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-lime-400/20 rounded-xl border border-lime-400/30">
                      <Star className="w-6 h-6 text-lime-400" />
                    </div>
                    <h2 className="text-xl font-display font-black text-white uppercase tracking-tight">¡Tu comida libre, {profile.name || 'campeón'}!</h2>
                  </div>
                  <p className="text-zinc-300 text-sm leading-relaxed">
                    Disfruta de tu momento. He buscado los mejores sitios que se adaptan a tus preferencias para que tu comida libre sea espectacular.
                  </p>
                </div>
              </div>

              {/* Search Section */}
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-6">
                <form onSubmit={handleSearchRestaurants} className="space-y-4 max-w-xl mx-auto">
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input 
                      type="text"
                      value={restaurantLocation}
                      onChange={(e) => setRestaurantLocation(e.target.value)}
                      placeholder="Indica tu ubicación (ej: Madrid, Chueca...)"
                      className="w-full bg-zinc-950 border border-white/10 rounded-2xl pl-12 pr-12 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-lime-400 transition-all"
                    />
                    <button
                      type="button"
                      onClick={handleNearMe}
                      disabled={isSearchingRestaurants}
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 bg-lime-400/10 hover:bg-lime-400/20 text-lime-400 rounded-lg border border-lime-400/20 disabled:opacity-30 transition-all group"
                      title="Cerca de mí"
                    >
                      <Target className={`w-4 h-4 ${isSearchingRestaurants ? 'animate-pulse' : ''}`} />
                      <span className="text-[9px] font-black uppercase tracking-widest hidden xs:block">Cerca de mí</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-white/5">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Dieta ({profile.dietType})</span>
                      <button 
                        type="button"
                        onClick={() => setRestaurantFilters({...restaurantFilters, dietType: !restaurantFilters.dietType})}
                        className={`w-10 h-2.5 rounded-full transition-colors relative ${restaurantFilters.dietType ? 'bg-lime-400' : 'bg-zinc-700'}`}
                      >
                        <div className={`absolute -top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${restaurantFilters.dietType ? 'left-6' : 'left-0'}`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-white/5">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Alergias ({profile.allergies || 'No'})</span>
                      <button 
                        type="button"
                        onClick={() => setRestaurantFilters({...restaurantFilters, allergies: !restaurantFilters.allergies})}
                        className={`w-10 h-2.5 rounded-full transition-colors relative ${restaurantFilters.allergies ? 'bg-lime-400' : 'bg-zinc-700'}`}
                      >
                        <div className={`absolute -top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${restaurantFilters.allergies ? 'left-6' : 'left-0'}`} />
                      </button>
                    </div>
                  </div>
                  <input 
                    type="text"
                    value={restaurantFilters.other}
                    onChange={(e) => setRestaurantFilters({...restaurantFilters, other: e.target.value})}
                    placeholder="Otros filtros (ej: terraza, barato, romántico...)"
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-lime-400 transition-all"
                  />

                  <button 
                    type="submit"
                    disabled={isSearchingRestaurants}
                    className="w-full bg-lime-400 hover:bg-lime-300 disabled:opacity-50 text-zinc-950 font-black uppercase tracking-widest py-3 rounded-2xl transition-all shadow-lg shadow-lime-400/20 flex items-center justify-center gap-2 text-xs"
                  >
                    {isSearchingRestaurants ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                    {isSearchingRestaurants ? 'Buscando...' : 'Buscar Restaurantes'}
                  </button>
                </form>
              </div>

              {/* Sorting Section */}
              {restaurants.length > 0 && (
                <div className="space-y-3 px-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ordenar resultados por:</span>
                    <button
                      onClick={() => setRestaurantSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                      className="flex items-center gap-1.5 text-[10px] font-bold text-lime-400 uppercase tracking-widest hover:text-lime-300 transition-colors"
                    >
                      {restaurantSortOrder === 'desc' ? (
                        <>Descendente <TrendingUp className="w-3 h-3 rotate-180" /></>
                      ) : (
                        <>Ascendente <TrendingUp className="w-3 h-3" /></>
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setRestaurantSort('rating')}
                      className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${restaurantSort === 'rating' ? 'bg-lime-400 text-zinc-950 border-lime-400' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:border-white/20'}`}
                    >
                      Valoración
                    </button>
                    <button
                      onClick={() => setRestaurantSort('distance')}
                      className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${restaurantSort === 'distance' ? 'bg-lime-400 text-zinc-950 border-lime-400' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:border-white/20'}`}
                    >
                      Distancia
                    </button>
                    <button
                      onClick={() => setRestaurantSort('price')}
                      className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${restaurantSort === 'price' ? 'bg-lime-400 text-zinc-950 border-lime-400' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:border-white/20'}`}
                    >
                      Precio
                    </button>
                  </div>
                </div>
              )}

              {/* Results */}
              <div className="space-y-4">
                {isSearchingRestaurants ? (
                  <div className="bg-zinc-950/30 rounded-[2.5rem] border border-white/5 p-12 text-center">
                    <div className="relative w-20 h-20 mx-auto mb-6">
                      <motion.div
                        className="absolute inset-0 rounded-2xl bg-lime-400/20"
                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.2, 0.5] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <MapPin className="w-8 h-8 text-lime-400" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-white font-bold">Buscando los mejores sitios...</p>
                      <motion.div 
                        className="text-zinc-500 text-xs font-mono h-4"
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      >
                        {`> Consultando guía gastronómica...`}
                      </motion.div>
                    </div>
                  </div>
                ) : (
                  <>
                    {restaurants.length > 0 && (
                      <div className="flex items-center justify-between px-2">
                        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Resultados encontrados</h3>
                        <span className="text-[10px] font-bold bg-lime-400/10 text-lime-400 px-2 py-1 rounded-full border border-lime-400/20">{restaurants.length} locales</span>
                      </div>
                    )}

                    <div className="space-y-4">
                      {displayedRestaurants.map((res, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="bg-zinc-900/50 border border-white/5 rounded-3xl p-5 hover:bg-zinc-800/50 transition-colors group"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="text-lg font-bold text-white group-hover:text-lime-400 transition-colors">{res.name}</h4>
                            <div className="flex items-center gap-1 bg-amber-400/10 text-amber-400 px-2 py-1 rounded-lg border border-amber-400/20">
                              <Star className="w-3 h-3 fill-current" />
                              <span className="text-xs font-black">{res.rating}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-zinc-500 text-xs mb-3">
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate max-w-[150px]">{res.address}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />
                              <span>{res.distance?.toFixed(1)} km</span>
                            </div>
                            <div className="flex items-center gap-0.5 text-amber-400 font-bold">
                              {Array.from({ length: res.priceLevel }).map((_, i) => (
                                <span key={i}>€</span>
                              ))}
                              <span className="text-zinc-700">
                                {Array.from({ length: 4 - res.priceLevel }).map((_, i) => (
                                  <span key={i}>€</span>
                                ))}
                              </span>
                            </div>
                          </div>
                          <p className="text-zinc-400 text-sm mb-4 leading-relaxed italic">"{res.description}"</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold bg-zinc-800 text-zinc-400 px-3 py-1.5 rounded-full uppercase tracking-widest border border-white/5">
                              {res.specialty}
                            </span>
                            <button 
                              onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(res.name + ' ' + res.address)}`, '_blank')}
                              className="text-lime-400 hover:text-lime-300 text-xs font-bold flex items-center gap-1 transition-colors"
                            >
                              Ver en Maps
                              <TrendingUp className="w-3 h-3 rotate-45" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {restaurants.length > 0 && (
                      <div className="flex flex-col items-center gap-6 py-8">
                        {/* Pagination Controls */}
                        <div className="flex items-center gap-2">
                          {Array.from({ length: Math.ceil(Math.min(resultsLimit, restaurants.length) / resultsPerPage) }).map((_, i) => (
                            <button
                              key={i}
                              onClick={() => setRestaurantPage(i + 1)}
                              className={`w-8 h-8 rounded-xl text-xs font-bold transition-all border ${restaurantPage === i + 1 ? 'bg-lime-400 text-zinc-950 border-lime-400 shadow-lg shadow-lime-400/20' : 'bg-zinc-900 text-zinc-500 border-white/5 hover:border-white/20'}`}
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>

                        {/* Load More Button */}
                        {restaurantPage === 3 && restaurants.length > resultsLimit && (
                          <button
                            onClick={() => setResultsLimit(prev => prev + 15)}
                            className="bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-bold uppercase tracking-widest px-6 py-3 rounded-2xl border border-white/10 transition-all flex items-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Cargar más resultados
                          </button>
                        )}
                      </div>
                    )}

                    {!isSearchingRestaurants && restaurants.length === 0 && (
                      <div className="text-center py-12 bg-zinc-900/20 rounded-3xl border border-white/5 border-dashed">
                        <Bot className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                        <p className="text-zinc-500 text-sm">Indica una ubicación y pulsa buscar para encontrar sitios increíbles.</p>
                      </div>
                    )}
                  </>
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
            className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6"
          >
            <div className="w-full max-w-sm space-y-8 flex flex-col items-center">
              <div className="relative w-64 h-64 rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-center">
                {previewImage ? (
                  <>
                    <img src={previewImage} alt="Preview" className="w-full h-full object-cover opacity-50" />
                    {/* Scanning animation */}
                    <motion.div
                      className="absolute inset-0 border-t-2 border-lime-400 bg-gradient-to-b from-lime-400/20 to-transparent"
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
                      <Bot className="w-16 h-16 text-lime-400" />
                    </motion.div>
                  </div>
                )}
              </div>
              
              <div className="text-center space-y-2">
                <div className="flex items-center justify-center gap-3 text-lime-400">
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
            className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-display font-bold text-white">Registrar Peso</h3>
                <button onClick={() => setIsWeightModalOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
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
                />
                <button 
                  type="submit"
                  disabled={!newWeight}
                  className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
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
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-6 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-lime-400/10 rounded-xl border border-lime-400/20">
                    <UserIcon className="w-6 h-6 text-lime-400" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-white uppercase">Configuración de Perfil</h3>
                </div>
                <button onClick={() => setIsGoalModalOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <form onSubmit={handleSaveGoal} className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar pb-24">
                <div className="bg-zinc-950 p-4 rounded-2xl border border-white/5 space-y-3">
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Nombre / Alias</label>
                  <input 
                    type="text" 
                    value={editProfile.name}
                    onChange={(e) => setEditProfile({...editProfile, name: e.target.value})}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors"
                    placeholder="¿Cómo quieres que te llame?"
                  />
                </div>

                <div className="bg-lime-400/5 border border-lime-400/20 rounded-xl p-3">
                  <div className="flex gap-2">
                    <Info className="w-4 h-4 text-lime-400 shrink-0" />
                    <p className="text-zinc-400 text-[10px] leading-relaxed">
                      Calculamos automáticamente tus calorías y macros según tu objetivo y distribución seleccionada.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <NumberInput
                    label="Peso (kg)"
                    value={editWeight}
                    onChange={setEditWeight}
                    step={0.1}
                    min={30}
                    max={300}
                    placeholder="75.5"
                  />
                  <NumberInput
                    label="Altura (cm)"
                    value={editProfile.height || ''}
                    onChange={(val: string) => setEditProfile({...editProfile, height: parseInt(val) || 0})}
                    step={1}
                    min={100}
                    max={250}
                    placeholder="175"
                  />
                  <NumberInput
                    label="Edad"
                    value={editProfile.age || ''}
                    onChange={(val: string) => setEditProfile({...editProfile, age: parseInt(val) || 0})}
                    step={1}
                    min={12}
                    max={120}
                    placeholder="42"
                  />
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Género</label>
                    <select 
                      value={editProfile.gender}
                      onChange={(e) => setEditProfile({...editProfile, gender: e.target.value as 'male' | 'female'})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors appearance-none"
                    >
                      <option value="male">Hombre</option>
                      <option value="female">Mujer</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Nivel de Actividad</label>
                  <select 
                    value={editProfile.activityLevel}
                    onChange={(e) => setEditProfile({...editProfile, activityLevel: parseFloat(e.target.value)})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors appearance-none"
                  >
                    <option value={1.2}>Sedentario</option>
                    <option value={1.375}>Ligero (1-3 días/sem)</option>
                    <option value={1.55}>Moderado (3-5 días/sem)</option>
                    <option value={1.725}>Intenso (6-7 días/sem)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Objetivo</label>
                  <select 
                    value={editProfile.goal}
                    onChange={(e) => setEditProfile({...editProfile, goal: e.target.value as any})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors appearance-none"
                  >
                    <option value="lose">Perder Peso (-500 kcal)</option>
                    <option value="maintain">Mantener Peso</option>
                    <option value="gain">Ganar Músculo (+300 kcal)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Macros</label>
                  <select 
                    value={editProfile.macroDistribution}
                    onChange={(e) => setEditProfile({...editProfile, macroDistribution: e.target.value as any})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors appearance-none"
                  >
                    <option value="balanced">Equilibrada (30/40/30)</option>
                    <option value="low_carb">Baja en Carbohidratos (40/20/40)</option>
                    <option value="high_protein">Alta en Proteínas (40/30/30)</option>
                    <option value="keto">Cetogénica (25/5/70)</option>
                  </select>
                </div>
                
                <div className="space-y-3 pt-3 border-t border-zinc-800">
                  <h4 className="text-[10px] font-bold text-white uppercase tracking-wider">Preferencias de Alimentación</h4>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Tipo de Dieta</label>
                      <select 
                        value={editProfile.dietType}
                        onChange={(e) => setEditProfile({...editProfile, dietType: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors appearance-none"
                      >
                        <option value="Normal">Normal (Omnívora)</option>
                        <option value="Vegetariana">Vegetariana</option>
                        <option value="Vegana">Vegana</option>
                        <option value="Pescetariana">Pescetariana</option>
                        <option value="Keto">Keto</option>
                        <option value="Paleo">Paleo</option>
                      </select>
                    </div>
                    <div className="mt-3">
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Supermercado Favorito</label>
                      <select 
                        value={editProfile.favoriteSupermarket}
                        onChange={(e) => setEditProfile({...editProfile, favoriteSupermarket: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors appearance-none"
                      >
                        <option value="Mercadona">Mercadona</option>
                        <option value="Carrefour">Carrefour</option>
                        <option value="Aldi">Aldi</option>
                        <option value="Lidl">Lidl</option>
                        <option value="Alcampo">Alcampo</option>
                        <option value="Eroski">Eroski</option>
                      </select>
                    </div>

                    <div className="mt-3 p-3 bg-zinc-900 rounded-xl border border-white/5 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-white uppercase tracking-widest">Comida/Cena Libre Semanal</label>
                        <button 
                          type="button"
                          onClick={() => setEditProfile({...editProfile, freeMealEnabled: !editProfile.freeMealEnabled})}
                          className={`w-10 h-2.5 rounded-full transition-colors relative ${editProfile.freeMealEnabled ? 'bg-lime-400' : 'bg-zinc-700'}`}
                        >
                          <div className={`absolute -top-1 w-4.5 h-4.5 rounded-full bg-white shadow-sm transition-all ${editProfile.freeMealEnabled ? 'left-5.5' : 'left-0'}`} />
                        </button>
                      </div>
                      
                      {editProfile.freeMealEnabled && (
                        <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2">
                          <div>
                            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Día</label>
                            <select 
                              value={editProfile.freeMealDay}
                              onChange={(e) => setEditProfile({...editProfile, freeMealDay: e.target.value})}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
                            >
                              {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(day => (
                                <option key={day} value={day}>{day}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Tipo</label>
                            <select 
                              value={editProfile.freeMealType}
                              onChange={(e) => setEditProfile({...editProfile, freeMealType: e.target.value as any})}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
                            >
                              <option value="comida">Comida</option>
                              <option value="cena">Cena</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Alergias</label>
                        <input 
                          type="text" 
                          value={editProfile.allergies}
                          onChange={(e) => setEditProfile({...editProfile, allergies: e.target.value})}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors"
                          placeholder="Gluten..."
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">A Evitar</label>
                        <input 
                          type="text" 
                          value={editProfile.dislikedFoods}
                          onChange={(e) => setEditProfile({...editProfile, dislikedFoods: e.target.value})}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500 transition-colors"
                          placeholder="Brócoli..."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800">
                  <button 
                    type="submit"
                    disabled={!editWeight || !editProfile.age || !editProfile.height}
                    className="w-full bg-lime-400 hover:bg-lime-300 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 font-black uppercase tracking-widest py-4 rounded-xl transition-all shadow-lg shadow-lime-400/10"
                  >
                    Calcular y Guardar
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
                      <Markdown>
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

            <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex gap-2">
              <input
                type="text"
                value={currentChatMessage}
                onChange={(e) => setCurrentChatMessage(e.target.value)}
                placeholder="Pregúntame lo que quieras..."
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button 
                type="submit"
                disabled={!currentChatMessage.trim() || isChatLoading}
                className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white p-2 rounded-xl transition-colors shrink-0 flex items-center justify-center w-10 h-10"
              >
                <Send className="w-4 h-4" />
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
                  const existingIndex = meals.findIndex(m => m.id === editingMeal.id);
                  if (existingIndex >= 0) {
                    setMeals(prev => {
                      const copy = [...prev];
                      copy[existingIndex] = editingMeal;
                      return copy;
                    });
                  } else {
                    setMeals(prev => [editingMeal, ...prev]);
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
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-lime-400 transition-colors" 
                      required 
                    />
                    
                    {/* Interpretación Automática */}
                    {(editingMeal.interpretation || editingMeal.isHealthy !== undefined) && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/10 text-xs font-medium text-zinc-300 w-fit">
                        <Activity className="w-3.5 h-3.5 text-lime-400" />
                        {editingMeal.interpretation || (editingMeal.isHealthy ? 'Comida equilibrada' : 'A tener en cuenta')}
                      </div>
                    )}
                    
                    {/* Ingredients Breakdown */}
                    {editingMeal.ingredients && editingMeal.ingredients.length > 0 && (
                      <div className="bg-zinc-950/50 rounded-2xl p-4 border border-white/5">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-3">Desglose de Ingredientes</span>
                        <div className="space-y-2">
                          {editingMeal.ingredients.map((ing, idx) => (
                            <div key={idx} className="flex justify-between items-center text-xs gap-3">
                              <span className="text-zinc-300 flex-1 truncate">{ing.name}</span>
                              <input
                                type="text"
                                value={ing.amount}
                                onChange={(e) => {
                                  const newIngredients = [...editingMeal.ingredients!];
                                  newIngredients[idx] = { ...ing, amount: e.target.value };
                                  setEditingMeal({ ...editingMeal, ingredients: newIngredients });
                                }}
                                className="w-24 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-right text-lime-400 font-mono font-bold focus:outline-none focus:border-lime-400 transition-colors"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 mt-4">
                      <button
                        type="button"
                        onClick={handleRecalculateMacros}
                        disabled={isRecalculating || !editingMeal.foodName}
                        className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white p-3 rounded-xl transition-colors border border-white/5 flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        {isRecalculating ? <Loader2 className="w-4 h-4 animate-spin text-lime-400" /> : <RefreshCw className="w-4 h-4 text-lime-400" />}
                        Recalcular Calorías y Macros
                      </button>
                      <p className="text-[10px] text-zinc-500 text-center px-4">
                        Si modificas el nombre de la comida o los gramos de los ingredientes, pulsa este botón para recalcular los datos nutricionales.
                      </p>
                    </div>


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



                {/* Read-Only Macros */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-900/50 p-3 rounded-xl border border-white/5">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Calorías</span>
                    <span className="text-lg font-display font-bold text-lime-400">{editingMeal.calories} <span className="text-xs text-zinc-500">kcal</span></span>
                  </div>
                  <div className="bg-zinc-900/50 p-3 rounded-xl border border-white/5">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Proteínas</span>
                    <span className="text-lg font-display font-bold text-blue-400">{editingMeal.protein} <span className="text-xs text-zinc-500">g</span></span>
                  </div>
                  <div className="bg-zinc-900/50 p-3 rounded-xl border border-white/5">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Carbohidratos</span>
                    <span className="text-lg font-display font-bold text-amber-400">{editingMeal.carbs} <span className="text-xs text-zinc-500">g</span></span>
                  </div>
                  <div className="bg-zinc-900/50 p-3 rounded-xl border border-white/5">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Grasas</span>
                    <span className="text-lg font-display font-bold text-rose-400">{editingMeal.fat} <span className="text-xs text-zinc-500">g</span></span>
                  </div>
                </div>

                {(editingMeal.coachMessage || editingMeal.healthAnalysis) && (
                  <div className="mt-6 space-y-3">
                    {/* Mensaje del Coach */}
                    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 flex items-start gap-3">
                      <div className="p-2 rounded-xl shrink-0 bg-lime-500/10 text-lime-400">
                        <Bot className="w-5 h-5" />
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed pt-0.5">
                        {editingMeal.coachMessage || editingMeal.healthAnalysis}
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-4">
                  <button type="submit" className="w-full bg-lime-400 text-zinc-950 font-bold uppercase tracking-wider py-4 rounded-xl hover:bg-lime-300 transition-colors">
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
        {appError && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 left-4 right-4 z-[60] flex justify-center pointer-events-none"
          >
            <div className="bg-rose-500 text-white px-6 py-4 rounded-2xl shadow-2xl font-medium text-sm flex items-center gap-3 pointer-events-auto max-w-md w-full border border-rose-400/50">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="flex-1">{appError}</p>
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

