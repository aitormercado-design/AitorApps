import { X } from 'lucide-react';

interface AppBannerProps {
  variant: 'coach' | 'info' | 'warning' | 'error';
  theme: 'light' | 'dark';
  icon?: React.ReactNode;
  label?: string;
  title?: string;
  message: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function AppBanner({
  variant,
  theme,
  icon,
  label,
  title,
  message,
  actions,
  onDismiss,
  className = '',
}: AppBannerProps) {
  const isLight = theme === 'light';

  if (variant === 'coach') {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl shadow-xl ${
          isLight
            ? 'bg-gradient-to-br from-emerald-500 via-emerald-500 to-teal-600'
            : 'bg-zinc-900 border border-lime-400/30'
        } ${className}`}
      >
        {!isLight && <div className="absolute inset-y-0 left-0 w-1 bg-lime-400 rounded-l-2xl" />}
        <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full blur-3xl ${isLight ? 'bg-white/30' : 'bg-lime-400/15'}`} />
        <div className={`relative flex items-start gap-3 p-4 ${!isLight ? 'pl-5' : ''}`}>
          {icon && (
            <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isLight ? 'bg-white/20 shadow-sm' : 'bg-lime-400/10 border border-lime-400/30'}`}>
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {label && (
              <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${isLight ? 'text-white/70' : 'text-lime-400'}`}>
                {label}
              </span>
            )}
            <p className="text-sm font-semibold leading-snug mt-0.5 text-white">{message}</p>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className={`shrink-0 p-1 rounded-lg transition-colors mt-0.5 ${isLight ? 'text-white/60 hover:text-white hover:bg-white/15' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'info') {
    const borderColor = isLight ? 'border-slate-200' : 'border-white/8';
    const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
    const accentColor = isLight ? 'text-emerald-600' : 'text-lime-400';
    const mutedColor = isLight ? 'text-slate-500' : 'text-zinc-400';
    return (
      <div className={`rounded-2xl border ${borderColor} ${cardBg} p-3 flex items-center gap-3 ${className}`}>
        {icon && <div className={`shrink-0 ${accentColor}`}>{icon}</div>}
        <p className={`text-xs ${mutedColor} flex-1`}>{message}</p>
        {actions}
        {onDismiss && (
          <button onClick={onDismiss} className={`${mutedColor} hover:text-red-400 transition-colors shrink-0`}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (variant === 'warning') {
    const borderColor = isLight ? 'border-slate-200' : 'border-white/8';
    const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
    const accentColor = isLight ? 'text-emerald-600' : 'text-lime-400';
    const mutedColor = isLight ? 'text-slate-500' : 'text-zinc-400';
    const mainColor = isLight ? 'text-slate-800' : 'text-white';
    return (
      <div className={`rounded-2xl border ${borderColor} ${cardBg} p-4 ${className}`}>
        <div className="flex items-start gap-3 mb-3">
          {icon && <div className={`shrink-0 ${accentColor} mt-0.5`}>{icon}</div>}
          <div className="flex-1 min-w-0">
            {title && <p className={`text-xs font-bold ${mainColor} mb-0.5`}>{title}</p>}
            <p className={`text-xs ${mutedColor} leading-relaxed`}>{message}</p>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className={`shrink-0 ${mutedColor} hover:text-red-400 transition-colors`}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {actions && <div>{actions}</div>}
      </div>
    );
  }

  // error variant
  return (
    <div className={`rounded-2xl border border-red-500/40 ${isLight ? 'bg-red-50' : 'bg-red-500/5'} p-4 flex items-center gap-3 ${className}`}>
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
      </span>
      <div className="flex-1 min-w-0">
        {title && <p className="text-xs font-bold text-red-500 uppercase tracking-widest">{title}</p>}
        <p className={`text-xs mt-0.5 ${isLight ? 'text-red-700' : 'text-red-400/80'}`}>{message}</p>
      </div>
      {actions}
    </div>
  );
}
