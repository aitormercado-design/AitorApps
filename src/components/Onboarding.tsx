import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';

interface OnboardingData {
  name: string;
  goal: 'lose' | 'maintain' | 'gain';
  weight: number;
  height: number;
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

interface StepperProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onDecrement: () => void;
  onIncrement: () => void;
  textMain: string;
  textMuted: string;
  border: string;
  btnCls: string;
}

function Stepper({ label, value, unit, min, max, step: _step, onDecrement, onIncrement, textMain, textMuted, border, btnCls }: StepperProps) {
  return (
    <div className={`border ${border} rounded-2xl p-4 flex items-center justify-between gap-4`}>
      <span className={`text-xs font-bold uppercase tracking-widest ${textMuted}`}>{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDecrement}
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${btnCls} transition-colors active:scale-95`}
        >
          <Minus className={`w-4 h-4 ${textMuted}`} />
        </button>
        <span className={`text-2xl font-display font-black tracking-tighter ${textMain} min-w-[4rem] text-center`}>
          {value}<span className={`text-sm font-bold ${textMuted} ml-1`}>{unit}</span>
        </span>
        <button
          type="button"
          onClick={onIncrement}
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${btnCls} transition-colors active:scale-95`}
        >
          <Plus className={`w-4 h-4 ${textMuted}`} />
        </button>
      </div>
    </div>
  );
}

export function Onboarding({ theme, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const dirRef = useRef(1);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<'lose' | 'maintain' | 'gain'>('maintain');
  const [weight, setWeight] = useState(75);
  const [height, setHeight] = useState(170);
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState(30);

  const isLight = theme === 'light';

  const bg         = isLight ? 'bg-slate-50'  : 'bg-[#09090b]';
  const textMain   = isLight ? 'text-zinc-950' : 'text-white';
  const textMuted  = isLight ? 'text-slate-500' : 'text-zinc-400';
  const accent     = isLight ? 'bg-emerald-500' : 'bg-lime-400';
  const accentTxt  = isLight ? 'text-white'     : 'text-zinc-950';
  const border     = isLight ? 'border-slate-200' : 'border-white/10';
  const btnCls     = isLight ? 'bg-slate-100 hover:bg-slate-200' : 'bg-zinc-800 hover:bg-zinc-700';
  const inputCls   = isLight
    ? 'bg-white border-slate-300 text-zinc-950 placeholder:text-slate-400 focus:border-emerald-500'
    : 'bg-zinc-800 border-white/10 text-white placeholder:text-zinc-500 focus:border-lime-400';
  const selectedCard = isLight
    ? 'border-emerald-500 bg-emerald-50 shadow-emerald-500/10'
    : 'border-lime-400/60 bg-lime-400/5 shadow-lime-400/10';
  const unselCard = isLight
    ? 'border-slate-200 bg-white hover:border-slate-300'
    : 'border-white/10 bg-zinc-900 hover:border-white/20';

  const goTo = (s: number) => {
    dirRef.current = s > step ? 1 : -1;
    setStep(s);
  };

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 48 }),
    center: { opacity: 1, x: 0 },
    exit:  (dir: number) => ({ opacity: 0, x: -dir * 48 }),
  };

  const handleComplete = () => {
    onComplete({ name: name.trim() || 'Usuario', goal, weight, height, gender, age });
  };

  return (
    <div className={`min-h-screen ${bg} flex flex-col items-center justify-center p-6`}>
      {/* Step indicator + back button row */}
      <div className="flex items-center gap-4 mb-10 w-full max-w-sm">
        <button
          type="button"
          onClick={() => goTo(step - 1)}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
            step > 1
              ? `${btnCls} ${textMuted}`
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex gap-2 flex-1 justify-center">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s <= step ? `${accent} w-8` : `${isLight ? 'bg-slate-200' : 'bg-zinc-800'} w-4`
              }`}
            />
          ))}
        </div>
        <div className="w-8" />
      </div>

      <div className="w-full max-w-sm overflow-hidden">
        <AnimatePresence mode="wait" custom={dirRef.current}>
          {/* ── PASO 1: Nombre ── */}
          {step === 1 && (
            <motion.div
              key="step1"
              custom={dirRef.current}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22 }}
              className="flex flex-col items-center text-center gap-8"
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
                  onKeyDown={e => e.key === 'Enter' && name.trim() && goTo(2)}
                  autoFocus
                  className={`w-full border rounded-2xl px-5 py-4 text-base font-medium focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all ${inputCls}`}
                />
              </div>
              <button
                type="button"
                onClick={() => goTo(2)}
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
              custom={dirRef.current}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22 }}
              className="flex flex-col gap-6"
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
                    type="button"
                    onClick={() => { setGoal(g.id); setTimeout(() => goTo(3), 180); }}
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
              custom={dirRef.current}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22 }}
              className="flex flex-col gap-4"
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
                      type="button"
                      onClick={() => setGender(g)}
                      className={`py-3 rounded-xl font-bold text-sm transition-all ${
                        gender === g
                          ? `${accent} ${accentTxt} shadow-md active:scale-95`
                          : `${btnCls} ${textMuted}`
                      }`}
                    >
                      {g === 'male' ? '♂ Hombre' : '♀ Mujer'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Altura */}
              <Stepper
                label="Altura"
                value={height}
                unit="cm"
                min={140}
                max={220}
                step={1}
                onDecrement={() => setHeight(h => Math.max(140, h - 1))}
                onIncrement={() => setHeight(h => Math.min(220, h + 1))}
                textMain={textMain}
                textMuted={textMuted}
                border={border}
                btnCls={btnCls}
              />

              {/* Peso */}
              <Stepper
                label="Peso actual"
                value={weight}
                unit="kg"
                min={40}
                max={150}
                step={0.5}
                onDecrement={() => setWeight(w => Math.max(40, parseFloat((w - 0.5).toFixed(1))))}
                onIncrement={() => setWeight(w => Math.min(150, parseFloat((w + 0.5).toFixed(1))))}
                textMain={textMain}
                textMuted={textMuted}
                border={border}
                btnCls={btnCls}
              />

              {/* Edad */}
              <Stepper
                label="Edad"
                value={age}
                unit="años"
                min={10}
                max={100}
                step={1}
                onDecrement={() => setAge(a => Math.max(10, a - 1))}
                onIncrement={() => setAge(a => Math.min(100, a + 1))}
                textMain={textMain}
                textMuted={textMuted}
                border={border}
                btnCls={btnCls}
              />

              <button
                type="button"
                onClick={handleComplete}
                className={`w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 ${accent} ${accentTxt} shadow-lg active:scale-95 transition-all mt-2`}
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
    </div>
  );
}
