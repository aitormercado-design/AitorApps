import React, { useEffect, useRef } from 'react';

interface RulerPickerProps {
  value: string | number;
  onChange: (val: string) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  label: string;
  theme: 'light' | 'dark';
}

export const RulerPicker = ({ value, onChange, min, max, step, unit, label, theme }: RulerPickerProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false); // ruler is driving value
  const isTypingRef = useRef(false);    // user is typing in the input

  const range = max - min;
  const steps = Math.round(range / step);

  // Sync scroll position from value — but only when the ruler isn't already driving
  // and the user isn't mid-type (to avoid fighting with keyboard input)
  useEffect(() => {
    if (isScrollingRef.current || isTypingRef.current) return;
    if (!scrollRef.current) return;
    const numVal = Number(value);
    if (isNaN(numVal)) return;
    const clamped = Math.max(min, Math.min(max, numVal));
    const percentage = (clamped - min) / range;
    const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
    scrollRef.current.scrollLeft = percentage * maxScroll;
  }, [value, min, max, range]);

  const handleScroll = () => {
    if (isTypingRef.current || !scrollRef.current) return;
    const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
    if (maxScroll <= 0) return;
    const percentage = Math.max(0, Math.min(1, scrollRef.current.scrollLeft / maxScroll));
    const newValue = min + percentage * range;
    const steppedValue = Math.round(newValue / step) * step;
    const formatted = steppedValue.toFixed(step < 1 ? 1 : 0);
    if (formatted !== String(value)) {
      isScrollingRef.current = true;
      onChange(formatted);
      // Let the next frame clear the flag so the useEffect doesn't re-scroll
      requestAnimationFrame(() => { isScrollingRef.current = false; });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isTypingRef.current = true;
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      onChange(String(min)); // propagate min while clearing
      return;
    }
    const numVal = parseFloat(raw);
    if (!isNaN(numVal)) onChange(raw);
  };

  const handleInputBlur = () => {
    isTypingRef.current = false;
    // Clamp and step the committed value
    const numVal = parseFloat(String(value));
    const clamped = isNaN(numVal) ? min : Math.max(min, Math.min(max, numVal));
    const stepped = Math.round(clamped / step) * step;
    const formatted = stepped.toFixed(step < 1 ? 1 : 0);
    if (formatted !== String(value)) onChange(formatted);
    // Now sync the ruler
    if (scrollRef.current) {
      const pct = (stepped - min) / range;
      const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = pct * maxScroll;
    }
  };

  return (
    <div className={`space-y-2 p-4 rounded-2xl border shadow-inner ${theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/5'}`}>
      <div className="flex justify-between items-end px-1">
        <label className={`text-xs font-bold uppercase tracking-widest ${theme === 'light' ? 'text-slate-500' : 'text-zinc-500'}`}>{label}</label>
        <div className="flex items-baseline gap-1">
          <input
            type="number"
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            className={`text-2xl font-display font-black bg-transparent border-none focus:outline-none w-20 text-right appearance-none ${theme === 'light' ? 'text-emerald-500' : 'text-lime-400'}`}
            style={{ MozAppearance: 'textfield' } as React.CSSProperties}
          />
          <span className={`text-xs font-bold uppercase ${theme === 'light' ? 'text-slate-400' : 'text-zinc-600'}`}>{unit}</span>
        </div>
      </div>

      <div className={`relative h-14 flex items-center rounded-2xl overflow-hidden border ${theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-zinc-900/50 border-white/5'}`}>
        <div className={`absolute left-1/2 top-0 bottom-0 w-0.5 z-10 ${theme === 'light' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-lime-400 shadow-[0_0_10px_rgba(163,230,53,0.5)]'}`} />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
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
                  <div className={`rounded-full ${
                    isMajor ? `h-6 w-0.5 ${theme === 'light' ? 'bg-slate-400' : 'bg-zinc-500'}` :
                    isMid   ? `h-4 w-0.5 ${theme === 'light' ? 'bg-slate-300' : 'bg-zinc-700'}` :
                               `h-2 w-0.5 ${theme === 'light' ? 'bg-slate-200' : 'bg-zinc-800'}`
                  }`} />
                  {isMajor && (
                    <span className={`text-xs font-bold tabular-nums ${theme === 'light' ? 'text-slate-400' : 'text-zinc-600'}`}>{val}</span>
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
