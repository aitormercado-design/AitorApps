import React, { useEffect, useRef, useState } from 'react';

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
  const [isDragging, setIsDragging] = useState(false);
  const isInternalUpdate = useRef(false);

  const range = max - min;
  const steps = range / step;

  useEffect(() => {
    if (scrollRef.current && !isInternalUpdate.current) {
      const percentage = (Number(value) - min) / range;
      const targetScroll = percentage * (scrollRef.current.scrollWidth - scrollRef.current.clientWidth);
      scrollRef.current.scrollLeft = targetScroll;
    }
    isInternalUpdate.current = false;
  }, [value, min, max, range]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const scrollPos = scrollRef.current.scrollLeft;
      const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
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
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') { onChange('0'); return; }
              const numVal = parseFloat(val);
              if (!isNaN(numVal)) onChange(val);
            }}
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
                  <div className={`rounded-full transition-colors ${
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
