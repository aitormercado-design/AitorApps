import React from 'react';
import { motion } from 'motion/react';
import {
  Activity, ChefHat, Dumbbell, Home, Info, Minus, Pizza, Plus,
  Save, User as UserIcon, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProfileModalProps {
  themeStyles: Record<string, string>;
  profile: UserProfile;
  editProfile: UserProfile;
  setEditProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  editWeight: string;
  setEditWeight: React.Dispatch<React.SetStateAction<string>>;
  isWizardMode: boolean;
  profileWizardStep: 1 | 2 | 3;
  setProfileWizardStep: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
  profileModalTab: 'datos' | 'dieta' | 'entrenamiento';
  setProfileModalTab: React.Dispatch<React.SetStateAction<'datos' | 'dieta' | 'entrenamiento'>>;
  wizardMenuPicked: boolean | null;
  setWizardMenuPicked: React.Dispatch<React.SetStateAction<boolean | null>>;
  wizardGymPicked: boolean | null;
  setWizardGymPicked: React.Dispatch<React.SetStateAction<boolean | null>>;
  notificationsEnabled: boolean;
  requestNotificationPermission: () => Promise<void>;
  disableNotifications: () => void;
  handleSaveGoal: (e: React.FormEvent | null, closeAfter?: boolean) => void;
  setIsGoalModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ProfileModal = React.memo(function ProfileModal({
  themeStyles,
  profile,
  editProfile,
  setEditProfile,
  editWeight,
  setEditWeight,
  isWizardMode,
  profileWizardStep,
  setProfileWizardStep,
  profileModalTab,
  setProfileModalTab,
  wizardMenuPicked,
  setWizardMenuPicked,
  wizardGymPicked,
  setWizardGymPicked,
  notificationsEnabled,
  requestNotificationPermission,
  disableNotifications,
  handleSaveGoal,
  setIsGoalModalOpen,
}: ProfileModalProps) {
  return (
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

        {/* Wizard step dots */}
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

            {/* ── STEP 1 / Datos tab ── */}
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

            {/* ── STEP 2 / Dieta tab ── */}
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

            {/* ── STEP 3 / Entreno tab ── */}
            {((isWizardMode && profileWizardStep === 3) || (!isWizardMode && profileModalTab === 'entrenamiento')) && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="text-center pt-2 pb-1">
                  <Dumbbell className={`w-10 h-10 ${themeStyles.accent} mx-auto mb-3`} />
                  <h4 className={`text-base font-bold ${themeStyles.textMain} mb-1`}>¿Cómo quieres gestionar tu entrenamiento?</h4>
                  <p className={`text-xs ${themeStyles.textMuted} leading-relaxed`}>Ajustaremos tus calorías según tu actividad.</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {([
                    { mode: 'plan',   label: 'Generar rutina',  emoji: '🤖', desc: 'IA crea tu plan' },
                    { mode: 'manual', label: 'Registro manual', emoji: '📝', desc: 'Tú apuntas lo que haces' },
                    { mode: 'both',   label: 'Ambas',           emoji: '⚡', desc: 'Rutina + registro libre' },
                    { mode: null,     label: 'No por ahora',    emoji: '✕', desc: '' },
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
            <div className={`pt-3 mt-1 border-t ${themeStyles.border} space-y-2`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={`text-xs ${themeStyles.textMuted}`}>🔔 Recordatorios</span>
                  <p className={`text-[10px] ${themeStyles.textMuted} opacity-60`}>Solo mientras la app está abierta (9h, 14h, 21h)</p>
                </div>
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
            </div>
          )}

          {/* Navigation buttons */}
          <div className={`pt-4 mt-2 border-t ${themeStyles.border} flex gap-3 shrink-0`}>
            {!isWizardMode ? (
              <button
                type="submit"
                disabled={profileModalTab === 'datos' && (!editProfile.name.trim() || editProfile.age <= 0 || editProfile.height <= 0)}
                className={`flex-1 ${themeStyles.buttonPrimary} py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Save className="w-4 h-4" />
                Guardar
              </button>
            ) : (
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
  );
});

export default ProfileModal;
