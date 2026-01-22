/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../utils';
import './AnimatedCounter.css';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  formatter?: (value: number) => string;
}

export function AnimatedCounter({
  value,
  duration = 1000,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
  formatter,
}: AnimatedCounterProps) {
  // Ensure incoming value is never negative
  const safeValue = Math.max(0, value);
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = Math.max(0, previousValue.current);
    const endValue = safeValue;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out-expo)
      const easeOutExpo = 1 - Math.pow(2, -10 * progress);
      // Ensure interpolated value is never negative
      const currentValue = Math.max(0, startValue + (endValue - startValue) * easeOutExpo);

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousValue.current = endValue;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [safeValue, duration]);

  // Final safety check - ensure displayed value is never negative
  const safeDisplayValue = Math.max(0, displayValue);
  const formattedValue = formatter ? formatter(safeDisplayValue) : safeDisplayValue.toFixed(decimals);

  return (
    <span className={cn('animated-counter', className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  );
}

// Compact number formatter (1.2K, 3.4M, etc.)
export function formatCompact(value: number): string {
  // Ensure value is never negative
  const safeValue = Math.max(0, value);
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(1)}K`;
  }
  return safeValue.toFixed(0);
}
