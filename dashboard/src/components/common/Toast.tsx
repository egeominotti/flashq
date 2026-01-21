import { useToast } from '../../hooks';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '../../utils';
import './Toast.css';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const icons: Record<ToastType, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast: Toast) => {
        const Icon = icons[toast.type];
        return (
          <div key={toast.id} className={cn('toast', `toast-${toast.type}`)}>
            <Icon className="toast-icon" size={18} />
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => removeToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
