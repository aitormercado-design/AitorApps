const MET_VALUES: Record<string, { suave: number; moderada: number; intensa: number }> = {
  'Correr':            { suave: 7.0,  moderada: 9.0,  intensa: 12.0 },
  'Ciclismo':          { suave: 4.0,  moderada: 6.0,  intensa: 10.0 },
  'Natación':          { suave: 5.0,  moderada: 7.0,  intensa: 10.0 },
  'Caminar':           { suave: 2.5,  moderada: 3.5,  intensa: 4.5  },
  'Elíptica':          { suave: 4.0,  moderada: 6.0,  intensa: 8.0  },
  'Remo':              { suave: 4.0,  moderada: 6.0,  intensa: 8.5  },
  'Saltar a la comba': { suave: 8.0,  moderada: 10.0, intensa: 12.0 },
  'Yoga':              { suave: 2.0,  moderada: 3.0,  intensa: 4.0  },
  'Pilates':           { suave: 2.5,  moderada: 3.5,  intensa: 4.5  },
  'Estiramientos':     { suave: 1.5,  moderada: 2.0,  intensa: 2.5  },
  'Pesas/Musculación': { suave: 3.0,  moderada: 5.0,  intensa: 7.0  },
  'CrossFit':          { suave: 5.0,  moderada: 8.0,  intensa: 11.0 },
  'HIIT':              { suave: 6.0,  moderada: 9.0,  intensa: 12.0 },
  'Fútbol':            { suave: 5.0,  moderada: 7.0,  intensa: 9.0  },
  'Baloncesto':        { suave: 5.0,  moderada: 7.0,  intensa: 9.0  },
  'Tenis':             { suave: 5.0,  moderada: 7.0,  intensa: 8.5  },
  'Padel':             { suave: 5.0,  moderada: 7.0,  intensa: 8.5  },
  'Senderismo':        { suave: 4.0,  moderada: 6.0,  intensa: 7.5  },
  'Otro':              { suave: 3.0,  moderada: 5.0,  intensa: 7.0  },
};

export const ACTIVITY_OPTIONS = Object.keys(MET_VALUES);

export function calculateMETCalories(
  activity: string,
  intensidad: 'suave' | 'moderada' | 'intensa',
  durationMinutes: number,
  weightKg: number
): number {
  const met = MET_VALUES[activity]?.[intensidad] ?? 5.0;
  return Math.round(met * weightKg * (durationMinutes / 60));
}
