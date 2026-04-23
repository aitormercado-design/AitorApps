import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { calcularBMR } from '../utils/nutrition';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';

// Using the same themeStyles from App.tsx via props or defining them here if not easily exportable
// We can just rely on the design system classes provided in the instruction.

interface UserProfile {
  gymEnabled: boolean;
  trainingDaysPerWeek: number;
  goals?: {
    calories: number; // Mapping App.tsx goals.calories
  };
  age: number;
  height: number;
  gender: 'male' | 'female';
  theme: 'light' | 'dark';
}

interface ExerciseDeltaProps {
  profile: UserProfile;
  goals: {
    calories: number;
  };
  userId: string;
  date?: Date;
  realCalories: number;
  impliedCalories: number;
  themeStyles: any; // We can pass the themeStyles from App.tsx
}

interface DeltaState {
  impliedCalories: number;
  realCalories: number;
  delta: number;
  adjustedGoal: number;
  status: 'surplus' | 'deficit' | 'on-track';
}

export const ExerciseDelta: React.FC<ExerciseDeltaProps> = ({ profile, goals, userId, date = new Date(), realCalories, impliedCalories, themeStyles }) => {
  if (profile.trainingDaysPerWeek === 0 || !profile.gymEnabled) {
    return null;
  }

  const delta = realCalories - impliedCalories;
  let status: 'surplus' | 'deficit' | 'on-track' = 'on-track';
  if (delta > 0) status = 'surplus';
  else if (delta < 0) status = 'deficit';

  const adjustedGoal = goals.calories + delta;

  const getStatusMessage = () => {
    if (realCalories === 0) {
      return `No has registrado ejercicio hoy. El sistema asumía ${impliedCalories} kcal de actividad.`;
    }
    if (status === 'surplus') {
      return `Quemaste ${delta} kcal más de lo asumido. Tienes un margen extra real de calorías.`;
    } else if (status === 'deficit') {
      return `El sistema asumía ${Math.abs(delta)} kcal más de ejercicio. Tu balance real es algo menor de lo previsto.`;
    }
    return `El ejercicio de hoy coincide con lo que tu perfil estimaba.`;
  };

  const statusBg = status === 'deficit' ? 'bg-amber-500/10 text-amber-600' :
                   status === 'surplus' ? (profile.theme === 'light' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-lime-400/10 text-lime-400') :
                   'bg-zinc-500/10 text-zinc-500';

  return (
    <div className={`${themeStyles.bento} p-6 space-y-6 relative overflow-hidden transition-all duration-200 border-b-4 ${status === 'deficit' ? 'border-amber-500' : (status === 'surplus' ? (profile.theme === 'light' ? 'border-emerald-500' : 'border-lime-400') : (profile.theme === 'light' ? 'border-emerald-500' : themeStyles.accentBorder))} shadow-2xl`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${status === 'deficit' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
            <Flame className="w-3 h-3" />
          </div>
          <h4 className={`text-xs font-black ${themeStyles.textMain} uppercase tracking-widest`}>Balance calorías quemadas</h4>
        </div>
      </div>

      {/* BLOQUE 1 — Dos tarjetas lado a lado */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`p-4 rounded-2xl ${profile.theme === 'light' ? 'bg-slate-100' : 'bg-zinc-950/40'} border ${themeStyles.border} text-center`}>
          <div className={`text-[10px] font-bold ${themeStyles.textMuted} uppercase tracking-widest mb-1`}>Calculadas según perfil</div>
          <div className={`text-2xl font-mono font-black ${themeStyles.textMain}`}>{impliedCalories} <span className="text-xs font-sans opacity-40">kcal</span></div>
          <div className="text-[9px] opacity-60 mt-1">según tus días de gym</div>
        </div>
        <div className={`p-4 rounded-2xl border text-center ${status === 'deficit' ? (profile.theme === 'light' ? 'bg-amber-50 border-amber-200' : 'bg-amber-950/30 border-amber-900/50') : (status === 'surplus' ? (profile.theme === 'light' ? 'bg-emerald-50 border-emerald-200' : 'bg-lime-900/20 border-lime-400/30') : (profile.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-zinc-950/40 border-white/5'))}`}>
          <div className={`text-[10px] font-bold ${status === 'deficit' ? 'text-amber-600' : status === 'surplus' ? (profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400') : themeStyles.textMuted} uppercase tracking-widest mb-1`}>Ejercicio realizado hoy</div>
          <div className={`text-2xl font-mono font-black ${status === 'deficit' ? 'text-amber-500' : status === 'surplus' ? (profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400') : themeStyles.textMain}`}>{realCalories} <span className="text-xs font-sans opacity-40">kcal</span></div>
          <div className={`text-[9px] mt-1 ${status === 'deficit' ? 'text-amber-600/60' : status === 'surplus' ? 'opacity-70' : 'opacity-60'}`}>kcal verificadas</div>
        </div>
      </div>

      {/* BLOQUE 3 — Badge de estado + frase de insight */}
      <div className="flex flex-col items-center justify-center text-center gap-3 pt-4 border-t border-dashed border-zinc-500/20">
        <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${statusBg}`}>
          {status === 'surplus' && `+${delta} kcal extra`}
          {status === 'deficit' && `-${Math.abs(delta)} kcal menos`}
          {status === 'on-track' && `En línea con tu perfil`}
        </div>
        <p className={`text-xs ${themeStyles.textMuted} font-medium leading-relaxed max-w-[280px]`}>
          {getStatusMessage()}
        </p>
      </div>

      {/* BLOQUE 4 — Tarjeta de balance ajustado */}
      <div className={`mt-4 p-4 rounded-xl ${profile.theme === 'light' ? 'bg-slate-50' : 'bg-zinc-950/20'} border ${themeStyles.border} grid grid-cols-3 gap-2 devide-x divide-dashed ${profile.theme === 'light' ? 'divide-slate-200' : 'divide-zinc-800'}`}>
        <div className="text-center px-1">
          <div className={`text-[9px] font-bold ${themeStyles.textMuted} uppercase tracking-widest mb-1 leading-tight`}>Objetivo base</div>
          <div className={`text-sm font-mono font-black ${themeStyles.textMain}`}>{goals.calories} <span className="text-[9px] opacity-40">kcal</span></div>
        </div>
        <div className={`text-center px-1 border-l ${profile.theme === 'light' ? 'border-slate-200' : 'border-zinc-800 border-dashed'}`}>
          <div className={`text-[9px] font-bold ${themeStyles.textMuted} uppercase tracking-widest mb-1 leading-tight`}>
            {status === 'deficit' ? 'Déficit oculto' : 'Margen extra'}
          </div>
          <div className={`text-sm font-mono font-black ${status === 'deficit' ? 'text-amber-500' : status === 'surplus' ? (profile.theme === 'light' ? 'text-emerald-500' : 'text-lime-400') : themeStyles.textMain}`}>
            {status === 'deficit' ? Math.abs(delta) : status === 'surplus' ? `+${delta}` : '—'} <span className="text-[9px] opacity-40">kcal</span>
          </div>
        </div>
        <div className={`text-center px-1 border-l ${profile.theme === 'light' ? 'border-slate-200' : 'border-zinc-800 border-dashed'}`}>
          <div className={`text-[9px] font-bold ${themeStyles.textMuted} uppercase tracking-widest mb-1 leading-tight`}>Puedes llegar a</div>
          <div className={`text-sm font-mono font-black ${status === 'surplus' ? (profile.theme === 'light' ? 'text-emerald-600' : 'text-lime-400') : themeStyles.textMain}`}>{adjustedGoal} <span className="text-[9px] opacity-40">kcal</span></div>
        </div>
      </div>
    </div>
  );
};
