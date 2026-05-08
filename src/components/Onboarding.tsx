import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';

interface OnboardingData {
  name: string;
  goal: 'lose' | 'maintain' | 'gain';
  weight: number;
  gender: 'male' | 'female';
  age: number;
}

interface OnboardingProps {
  theme: 'light' | 'dark';
  onComplete: (data: OnboardingData) => void;
}

const GOALS = [
  { id: 'lose' as const,     Icon: TrendingDown, label: 'Perder grasa',   desc: 'Déficit calórico controlado' },
  { id: 'maintain' as const, Icon: Minus,         label: 'Mantener peso',  desc: 'Calorías de mantenimiento' },
  { id: 'gain' as const,     Icon: TrendingUp,    label: 'Ganar músculo',  desc: 'Superávit para crecer' },
];

export function Onboarding({ theme, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<'lose' | 'maintain' | 'gain'>('maintain');
  const [weight, setWeight] = useState(75);
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState(30);

  const isLight = theme === 'light';

  const bg       = isLight ? 'bg-slate-50'   : 'bg-[#09090b]';
  const card     = isLight ? 'bg-white border-slate-200 shadow-lg'          : 'bg-zinc-900 border-white/10 shadow-2xl';
  const textMain = isLight ? 'text-zinc-950'  : 'text-white';
  const textMuted= isLight ? 'text-slate-500' : 'text-zinc-400';
  const accent   = isLight ? 'bg-emerald-500' : 'bg-lime-400';
  const accentTxt= isLight ? 'text-white'     : 'text-zinc-950';
  const border   = isLight ? 'border-slate-200' : 'border-white/10';
  const inputCls = isLight
    ? 'bg-white border-slate-300 text-zinc-950 placeholder:text-slate-400 focus:border-emerald-500'
    : 'bg-zinc-800 border-white/10 text-white placeholder:text-zinc-500 focus:border-lime-400';
  const selectedCard = isLight
    ? 'border-emerald-500 bg-emerald-50 shadow-emerald-500/10'
    : 'border-lime-400/60 bg-lime-400/5 shadow-lime-400/10';
  const unselCard = isLight
    ? 'border-slate-200 bg-white hover:border-slate-300'
    : 'border-white/10 bg-zinc-900 hover:border-white/20';

  const handleComplete = () => {
    onComplete({ name: name.trim() || 'Usuario', goal, weight, gender, age });
  };

  return (
    <div className={`min-h-screen ${bg} flex flex-col items-center justify-center p-6`}>
      {/* Step indicator */}
      <div className="flex gap-2 mb-10">
        {[1, 2, 3].map(s => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s <= step ? `${accent} w-8` : `${isLight ? 'bg-slate-200' : 'bg-zinc-800'} w-4`
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── PASO 1: Nombre ── */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm flex flex-col items-center text-center gap-8"
          >
            <div className={`w-20 h-20 rounded-2xl shadow-xl overflow-hidden ${isLight ? 'bg-emerald-500' : 'bg-zinc-900'}`}>
              <img
                src={isLight ? '/favicon-light.png' : '/favicon-dark.png'}
                alt="KiloKalo"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className={`text-3xl font-display font-black tracking-tighter ${textMain} mb-2`}>
                Bienvenido a KiloKalo
              </h1>
              <p className={`text-sm ${textMuted}`}>Tu app de nutrición personalizada</p>
            </div>
            <div className="w-full">
              <input
                type="text"
                placeholder="¿Cómo te llamas?"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(2)}
                autoFocus
                className={`w-full border rounded-2xl px-5 py-4 text-base font-medium focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all ${inputCls}`}
              />
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className={`w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                name.trim()
                  ? `${accent} ${accentTxt} shadow-lg active:scale-95`
                  : `${isLight ? 'bg-slate-200 text-slate-400' : 'bg-zinc-800 text-zinc-600'} cursor-not-allowed`
              }`}
            >
              Empezar <ChevronRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* ── PASO 2: Objetivo ── */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm flex flex-col gap-6"
          >
            <div className="text-center">
              <h2 className={`text-2xl font-display font-black tracking-tighter ${textMain} mb-1`}>
                ¿Cuál es tu objetivo?
              </h2>
              <p className={`text-sm ${textMuted}`}>Elige el que mejor te describe</p>
            </div>
            <div className="flex flex-col gap-3">
              {GOALS.map(g => (
                <button
                  key={g.id}
                  onClick={() => { setGoal(g.id); setTimeout(() => setStep(3), 180); }}
                  className={`border rounded-2xl p-5 flex items-center gap-4 text-left transition-all shadow-sm ${
                    goal === g.id ? selectedCard : unselCard
                  }`}
                >
                  <g.Icon className={`w-6 h-6 shrink-0 ${isLight ? 'text-emerald-500' : 'text-lime-400'}`} />
                  <div>
                    <p className={`font-bold ${textMain}`}>{g.label}</p>
                    <p className={`text-xs ${textMuted} mt-0.5`}>{g.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── PASO 3: Datos mínimos ── */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm flex flex-col gap-6"
          >
            <div className="text-center">
              <h2 className={`text-2xl font-display font-black tracking-tighter ${textMain} mb-1`}>
                Últimos datos
              </h2>
              <p className={`text-sm ${textMuted}`}>Para calcular tus calorías</p>
            </div>

            {/* Sexo */}
            <div className={`border ${border} rounded-2xl p-4 flex flex-col gap-3`}>
              <span className={`text-xs font-bold uppercase tracking-widest ${textMuted}`}>Sexo</span>
              <div className="grid grid-cols-2 gap-2">
                {(['male', 'female'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={`py-3 rounded-xl font-bold text-sm transition-all ${
                      gender === g
                        ? `${accent} ${accentTxt} shadow-md active:scale-95`
                        : `${isLight ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`
                    }`}
                  >
                    {g === 'male' ? '♂ Hombre' : '♀ Mujer'}
                  </button>
                ))}
              </div>
            </div>

            {/* Peso */}
            <div className={`border ${border} rounded-2xl p-4 flex flex-col gap-3`}>
              <div className="flex justify-between items-center">
                <span className={`text-xs font-bold uppercase tracking-widest ${textMuted}`}>Peso actual</span>
                <span className={`text-2xl font-display font-black tracking-tighter ${textMain}`}>
                  {weight} <span className={`text-sm font-bold ${textMuted}`}>kg</span>
                </span>
              </div>
              <input
                type="range"
                min={40}
                max={150}
                step={0.5}
                value={weight}
                onChange={e => setWeight(parseFloat(e.target.value))}
                className="w-full accent-lime-400"
              />
              <div className={`flex justify-between text-xs ${textMuted} font-medium`}>
                <span>40 kg</span><span>150 kg</span>
              </div>
            </div>

            {/* Edad */}
            <div className={`border ${border} rounded-2xl p-4 flex items-center justify-between gap-4`}>
              <span className={`text-xs font-bold uppercase tracking-widest ${textMuted}`}>Edad</span>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setAge(a => Math.max(10, a - 1))}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${isLight ? 'bg-slate-100 hover:bg-slate-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors active:scale-95`}
                >
                  <Minus className={`w-4 h-4 ${textMuted}`} />
                </button>
                <span className={`text-2xl font-display font-black tracking-tighter ${textMain} w-10 text-center`}>
                  {age}
                </span>
                <button
                  onClick={() => setAge(a => Math.min(100, a + 1))}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${isLight ? 'bg-slate-100 hover:bg-slate-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors active:scale-95`}
                >
                  <Plus className={`w-4 h-4 ${textMuted}`} />
                </button>
              </div>
            </div>

            <button
              onClick={handleComplete}
              className={`w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 ${accent} ${accentTxt} shadow-lg active:scale-95 transition-all`}
            >
              Calcular mi plan
            </button>

            <p className={`text-xs text-center ${textMuted} opacity-60`}>
              Puedes completar el resto del perfil después
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
