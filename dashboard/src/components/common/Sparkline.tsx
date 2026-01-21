import { useMemo } from 'react';
import { cn } from '../../utils';
import './Sparkline.css';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  strokeWidth?: number;
  showDots?: boolean;
  showArea?: boolean;
  className?: string;
  animated?: boolean;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = '#06b6d4',
  gradientFrom,
  gradientTo,
  strokeWidth = 2,
  showDots = false,
  showArea = true,
  className,
  animated = true,
}: SparklineProps) {
  const id = useMemo(() => `sparkline-${Math.random().toString(36).slice(2)}`, []);

  const { path, areaPath, points } = useMemo(() => {
    if (data.length < 2) {
      return { path: '', areaPath: '', points: [], min: 0, max: 0 };
    }

    const padding = 4;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;

    const pts = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - minVal) / range) * chartHeight;
      return { x, y, value };
    });

    // Create smooth curve using cardinal spline
    const linePath = pts
      .map((point, i) => {
        if (i === 0) return `M ${point.x} ${point.y}`;

        const prev = pts[i - 1];
        const curr = point;
        const next = pts[i + 1];
        const prevPrev = pts[i - 2];

        // Calculate control points for smooth curve
        const tension = 0.3;
        let cp1x, cp1y, cp2x, cp2y;

        if (prevPrev) {
          cp1x = prev.x + (curr.x - prevPrev.x) * tension;
          cp1y = prev.y + (curr.y - prevPrev.y) * tension;
        } else {
          cp1x = prev.x + (curr.x - prev.x) * tension;
          cp1y = prev.y;
        }

        if (next) {
          cp2x = curr.x - (next.x - prev.x) * tension;
          cp2y = curr.y - (next.y - prev.y) * tension;
        } else {
          cp2x = curr.x - (curr.x - prev.x) * tension;
          cp2y = curr.y;
        }

        return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
      })
      .join(' ');

    // Area path (close the shape)
    const aPath = `${linePath} L ${pts[pts.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`;

    return { path: linePath, areaPath: aPath, points: pts, _min: minVal, _max: maxVal };
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <div className={cn('sparkline-empty', className)} style={{ width, height }}>
        <span>—</span>
      </div>
    );
  }

  const gradientStart = gradientFrom || color;
  const gradientEnd = gradientTo || `${color}00`;

  return (
    <svg
      width={width}
      height={height}
      className={cn('sparkline', animated && 'sparkline-animated', className)}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <linearGradient id={`${id}-gradient`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={gradientStart} stopOpacity="0.4" />
          <stop offset="100%" stopColor={gradientEnd} stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Area fill */}
      {showArea && (
        <path
          d={areaPath}
          fill={`url(#${id}-gradient)`}
          className="sparkline-area"
        />
      )}

      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${id}-glow)`}
        className="sparkline-line"
      />

      {/* Dots */}
      {showDots &&
        points.map((point, i) => (
          <circle
            key={i}
            cx={point.x}
            cy={point.y}
            r={3}
            fill={color}
            className="sparkline-dot"
          />
        ))}

      {/* Last point indicator */}
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={4}
          fill={color}
          className="sparkline-endpoint"
        />
      )}
    </svg>
  );
}
