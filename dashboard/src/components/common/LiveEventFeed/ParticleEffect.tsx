import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../utils';

interface ParticleEffectProps {
  active: boolean;
  type: 'pushed' | 'completed' | 'failed';
}

export function ParticleEffect({ active, type }: ParticleEffectProps) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const newParticles = Array.from({ length: 5 }, () => ({
      id: idRef.current++,
      x: Math.random() * 100,
      y: Math.random() * 100,
    }));

    setParticles((prev) => [...prev, ...newParticles].slice(-20));

    const timer = setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 1000);

    return () => clearTimeout(timer);
  }, [active]);

  const colorClass =
    type === 'pushed'
      ? 'particle-cyan'
      : type === 'completed'
        ? 'particle-emerald'
        : 'particle-rose';

  return (
    <div className="particle-container">
      {particles.map((p) => (
        <div
          key={p.id}
          className={cn('particle', colorClass)}
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        />
      ))}
    </div>
  );
}
