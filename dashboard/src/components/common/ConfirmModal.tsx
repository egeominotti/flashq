import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { AlertTriangle, Trash2, RefreshCw, X } from 'lucide-react';
import { Button } from '@tremor/react';
import './ConfirmModal.css';

type ConfirmVariant = 'danger' | 'warning' | 'info';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  isLoading?: boolean;
}

const variantConfig: Record<
  ConfirmVariant,
  { icon: typeof AlertTriangle; color: string; buttonColor: 'rose' | 'amber' | 'blue' }
> = {
  danger: { icon: Trash2, color: 'text-rose-500', buttonColor: 'rose' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', buttonColor: 'amber' },
  info: { icon: RefreshCw, color: 'text-blue-500', buttonColor: 'blue' },
};

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmModalProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="confirm-modal-container" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="confirm-modal-backdrop" />
        </Transition.Child>

        <div className="confirm-modal-wrapper">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="confirm-modal-panel">
              <button className="confirm-modal-close" onClick={onClose}>
                <X size={18} />
              </button>

              <div className="confirm-modal-content">
                <div className={`confirm-modal-icon ${config.color}`}>
                  <Icon size={24} />
                </div>

                <Dialog.Title as="h3" className="confirm-modal-title">
                  {title}
                </Dialog.Title>

                <p className="confirm-modal-message">{message}</p>

                <div className="confirm-modal-actions">
                  <Button variant="secondary" onClick={onClose} disabled={isLoading}>
                    {cancelText}
                  </Button>
                  <Button color={config.buttonColor} onClick={onConfirm} loading={isLoading}>
                    {confirmText}
                  </Button>
                </div>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
