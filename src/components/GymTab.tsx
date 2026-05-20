import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity, AlertTriangle, Camera, CheckCircle2, ChevronDown,
  Clock, Dumbbell, Edit2, Loader2, Plus, RefreshCw, Trash2,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppBanner } from './AppBanner';
import { calculateMETCalories, ACTIVITY_OPTIONS } from '../utils/metCalculator';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from 'firebase/auth';

// ─── Types re-declared locally so the component is self-contained ─────────────

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
    manualWorkout?: ManualWorkoutEntry;
    workoutCalories?: number;
    workoutSessionFocus?: string;
  };
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
  medicalConditions: {
    diabetes: boolean;
    highCholesterol: boolean;
    hypertension: boolean;
    hypothyroidism: boolean;
    insulinResistance: boolean;
  };
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

// ─── Helpers (module-level, no closure dependencies) ─────────────────────────

function translateGymGoal(goal: string): string {
  const map: Record<string, string> = {
    muscle: 'Ganar Músculo',
    strength: 'Fuerza',
    cardio: 'Resistencia',
    fat_loss: 'Perder Grasa',
    flexibility: 'Flexibilidad',
    maintenance: 'Mantenimiento',
  };
  return map[goal] || goal;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface GymTabProps {
  // Core data
  profile: UserProfile;
  themeStyles: Record<string, string>;
  workoutPlan: string | null;
  habits: DailyHabits;
  todayStr: string;
  gymDayDone: { [dayLabel: string]: boolean };
  gymRoutineDates: { [key: string]: string };
  gymSubTab: 'manual' | 'plan';
  setGymSubTab: (v: 'manual' | 'plan') => void;
  planSubTab: 'info' | 'ejercicios' | 'tips';
  setPlanSubTab: (v: 'info' | 'ejercicios' | 'tips') => void;
  gymDay: string;
  setGymDay: (v: string) => void;
  gymInfoExpanded: boolean;
  setGymInfoExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  gymTipsExpanded: boolean;
  setGymTipsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  expandedExSection: string | null;
  setExpandedExSection: React.Dispatch<React.SetStateAction<string | null>>;
  isGeneratingWorkout: boolean;
  workoutProgressMsg: string;
  workoutNeedsRegeneration: boolean;
  isAIGenerating: boolean;
  workoutCooldown: { isActive: boolean; remaining: number; start: () => void };
  manualWorkoutActivity: string;
  setManualWorkoutActivity: (v: string) => void;
  manualWorkoutMinutes: string;
  setManualWorkoutMinutes: (v: string) => void;
  manualWorkoutIntensidad: 'suave' | 'moderada' | 'intensa';
  setManualWorkoutIntensidad: (v: 'suave' | 'moderada' | 'intensa') => void;
  manualWorkoutDate: string;
  setManualWorkoutDate: (v: string) => void;
  manualWorkoutCaloriesOverride: string;
  setManualWorkoutCaloriesOverride: (v: string) => void;
  editingWorkoutId: string | null;
  setEditingWorkoutId: (v: string | null) => void;
  manualFormExpanded: boolean;
  setManualFormExpanded: (v: boolean) => void;
  manualListExpanded: boolean;
  setManualListExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  user: User | null;
  setHabits: React.Dispatch<React.SetStateAction<DailyHabits>>;
  parsedWorkoutSections: {
    info: string;
    exercises: string;
    safety: string;
    parsedDays: Array<{ dayNumber: number; focus: string; fullText: string }>;
  };
  // Handlers passed from parent
  handleToggleGymDay: (dayLabel: string) => void;
  handleGymDayDateChange: (dayLabel: string, newDate: string) => void;
  handleToggleExercise: (id: string, impactDate: string) => void;
  handleGenerateWorkout: (customProfile?: UserProfile) => Promise<void>;
  showError: (msg: string) => void;
  showSuccess: (msg: string) => void;
  // Banner props
  showGymSetupBanner: boolean;
  onDismissGymSetupBanner: () => void;
  onOpenGymSetup: () => void;
  // Context hint
  gymTimeHint: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

const GymTab = React.memo(function GymTab({
  profile,
  themeStyles,
  workoutPlan,
  habits,
  todayStr,
  gymDayDone,
  gymRoutineDates,
  gymSubTab,
  setGymSubTab,
  gymDay,
  setGymDay,
  gymInfoExpanded,
  setGymInfoExpanded,
  gymTipsExpanded,
  setGymTipsExpanded,
  expandedExSection,
  setExpandedExSection,
  isGeneratingWorkout,
  workoutProgressMsg,
  workoutNeedsRegeneration,
  isAIGenerating,
  workoutCooldown,
  manualWorkoutActivity,
  setManualWorkoutActivity,
  manualWorkoutMinutes,
  setManualWorkoutMinutes,
  manualWorkoutIntensidad,
  setManualWorkoutIntensidad,
  manualWorkoutDate,
  setManualWorkoutDate,
  manualWorkoutCaloriesOverride,
  setManualWorkoutCaloriesOverride,
  editingWorkoutId,
  setEditingWorkoutId,
  manualFormExpanded,
  setManualFormExpanded,
  manualListExpanded,
  setManualListExpanded,
  user,
  setHabits,
  parsedWorkoutSections,
  handleToggleGymDay,
  handleGymDayDateChange,
  handleGenerateWorkout,
  showSuccess,
  showGymSetupBanner,
  onDismissGymSetupBanner,
  onOpenGymSetup,
  gymTimeHint,
}: GymTabProps) {
  return (
    <>
      {/* Setup banner (rendered outside the motion.div so it doesn't animate with the tab) */}
      {showGymSetupBanner && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <AppBanner
            variant="info"
            theme={profile.theme}
            icon={<span className="text-sm">ℹ️</span>}
            message="Configura tu entrenamiento para un plan personalizado"
            actions={
              <button
                onClick={onOpenGymSetup}
                className={`text-xs font-bold ${themeStyles.accent} shrink-0 hover:underline`}
              >
                Configurar rutina
              </button>
            }
            onDismiss={onDismissGymSetupBanner}
          />
        </motion.div>
      )}

      <motion.div
        key="gym"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="space-y-8 pb-24"
      >
        {/* Time-of-day gym hint */}
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
                { id: 'plan',   label: 'Plan',   icon: Activity },
              ].map((st) => (
                <button
                  key={st.id}
                  onClick={() => setGymSubTab(st.id as 'manual' | 'plan')}
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
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
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

                    {/* Compact Gym Header */}
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
                    {parsedWorkoutSections.info.trim() && (
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
                                <Markdown remarkPlugins={[remarkGfm]}>{parsedWorkoutSections.info}</Markdown>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Daily routines logic */}
                    {(() => {
                      const { parsedDays } = parsedWorkoutSections;

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
                          {/* Daily Tabs Selector */}
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
                                      table: ({ node, ...props }) => {
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
                                            <button
                                              onClick={() => setExpandedExSection(isOpen ? null : sectionTitle)}
                                              className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-colors ${isOpen ? '' : `hover:${themeStyles.iconBg}`}`}
                                            >
                                              <div className={`w-1 h-5 ${isDone ? themeStyles.accentBg : 'bg-zinc-500'} rounded-full shrink-0`} />
                                              <h5 className={`flex-1 text-xs font-bold uppercase tracking-widest text-left ${isDone ? themeStyles.accent : themeStyles.textMain}`}>{sectionTitle}</h5>
                                              <ChevronDown className={`w-3.5 h-3.5 ${themeStyles.textMuted} shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                            </button>
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
                                      thead: ({ node, ...props }) => <thead {...props} className={`${profile.theme === 'light' ? 'bg-slate-100' : 'bg-white/5'} border-b ${themeStyles.border}`} />,
                                      th: ({ node, ...props }) => <th {...props} className={`px-3 py-2.5 text-left text-xs font-bold uppercase tracking-widest ${themeStyles.textMuted} border-b ${themeStyles.border} first:${themeStyles.textMain} first:min-w-[100px]`} />,
                                      td: ({ node, ...props }) => <td {...props} className={`px-3 py-2.5 ${themeStyles.textMuted} border-b ${themeStyles.border} text-xs font-medium first:${themeStyles.textMain} first:font-bold`} />,
                                      a: ({ node, ...props }) => (
                                        <a {...props} className={`inline-flex items-center gap-2 ${themeStyles.accent} font-bold hover:${themeStyles.textMain} transition-colors`} target="_blank" rel="noopener noreferrer">
                                          {props.children}
                                          <Camera className="w-4 h-4 opacity-50" />
                                        </a>
                                      ),
                                    }}
                                  >
                                    {dayContent}
                                  </Markdown>
                                </div>
                              );
                            })()}

                            {/* RPE note */}
                            <p className={`pt-4 text-[10px] ${themeStyles.textMuted} text-center border-t ${themeStyles.border}`}>
                              RPE = escala de esfuerzo del 1 al 10
                            </p>
                          </motion.div>
                        </div>
                      );
                    })()}

                    {/* Tips del día — collapsible */}
                    {parsedWorkoutSections.safety.trim() && (
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
                                <Markdown remarkPlugins={[remarkGfm]}>{parsedWorkoutSections.safety}</Markdown>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                ) : (profile.gymMode === 'manual' || (profile.gymMode === 'both' && gymSubTab === 'manual')) ? (
                  <ManualWorkoutSection
                    profile={profile}
                    themeStyles={themeStyles}
                    habits={habits}
                    todayStr={todayStr}
                    manualWorkoutActivity={manualWorkoutActivity}
                    setManualWorkoutActivity={setManualWorkoutActivity}
                    manualWorkoutMinutes={manualWorkoutMinutes}
                    setManualWorkoutMinutes={setManualWorkoutMinutes}
                    manualWorkoutIntensidad={manualWorkoutIntensidad}
                    setManualWorkoutIntensidad={setManualWorkoutIntensidad}
                    manualWorkoutDate={manualWorkoutDate}
                    setManualWorkoutDate={setManualWorkoutDate}
                    manualWorkoutCaloriesOverride={manualWorkoutCaloriesOverride}
                    setManualWorkoutCaloriesOverride={setManualWorkoutCaloriesOverride}
                    editingWorkoutId={editingWorkoutId}
                    setEditingWorkoutId={setEditingWorkoutId}
                    manualFormExpanded={manualFormExpanded}
                    setManualFormExpanded={setManualFormExpanded}
                    manualListExpanded={manualListExpanded}
                    setManualListExpanded={setManualListExpanded}
                    user={user}
                    setHabits={setHabits}
                    showSuccess={showSuccess}
                  />
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
    </>
  );
});

// ─── Manual Workout Sub-section ───────────────────────────────────────────────

interface ManualWorkoutSectionProps {
  profile: UserProfile;
  themeStyles: Record<string, string>;
  habits: DailyHabits;
  todayStr: string;
  manualWorkoutActivity: string;
  setManualWorkoutActivity: (v: string) => void;
  manualWorkoutMinutes: string;
  setManualWorkoutMinutes: (v: string) => void;
  manualWorkoutIntensidad: 'suave' | 'moderada' | 'intensa';
  setManualWorkoutIntensidad: (v: 'suave' | 'moderada' | 'intensa') => void;
  manualWorkoutDate: string;
  setManualWorkoutDate: (v: string) => void;
  manualWorkoutCaloriesOverride: string;
  setManualWorkoutCaloriesOverride: (v: string) => void;
  editingWorkoutId: string | null;
  setEditingWorkoutId: (v: string | null) => void;
  manualFormExpanded: boolean;
  setManualFormExpanded: (v: boolean) => void;
  manualListExpanded: boolean;
  setManualListExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  user: User | null;
  setHabits: React.Dispatch<React.SetStateAction<DailyHabits>>;
  showSuccess: (msg: string) => void;
}

const ManualWorkoutSection = React.memo(function ManualWorkoutSection({
  profile,
  themeStyles,
  habits,
  todayStr,
  manualWorkoutActivity,
  setManualWorkoutActivity,
  manualWorkoutMinutes,
  setManualWorkoutMinutes,
  manualWorkoutIntensidad,
  setManualWorkoutIntensidad,
  manualWorkoutDate,
  setManualWorkoutDate,
  manualWorkoutCaloriesOverride,
  setManualWorkoutCaloriesOverride,
  editingWorkoutId,
  setEditingWorkoutId,
  manualFormExpanded,
  setManualFormExpanded,
  manualListExpanded,
  setManualListExpanded,
  user,
  setHabits,
  showSuccess,
}: ManualWorkoutSectionProps) {
  return (
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
                {/* Actividad | Duración */}
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
  );
});

export default GymTab;
