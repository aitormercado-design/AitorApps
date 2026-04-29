import { useState, useCallback } from 'react';

export function useCooldown(seconds: number) {
  const [remaining, setRemaining] = useState(0);

  const start = useCallback(() => {
    setRemaining(seconds);
    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [seconds]);

  return { remaining, isActive: remaining > 0, start };
}
