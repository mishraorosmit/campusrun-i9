import React from 'react';
import { cn } from '../../lib/utils';
import { ToastNotification } from '../../types';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface ToastProps {
  toasts: ToastNotification[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 w-[calc(100%-32px)] max-w-[360px] pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const icons = {
            success: <CheckCircle2 className="w-4 h-4 text-[#2E7D32] shrink-0" />,
            warning: <AlertTriangle className="w-4 h-4 text-[#ED6C02] shrink-0" />,
            error: <AlertCircle className="w-4 h-4 text-[#D32F2F] shrink-0" />,
            info: <Info className="w-4 h-4 text-[#F16321] shrink-0" />,
          };

          const borderColors = {
            success: 'border-l-4 border-l-[#2E7D32] border-[#EADBC8]',
            warning: 'border-l-4 border-l-[#ED6C02] border-[#EADBC8]',
            error: 'border-l-4 border-l-[#D32F2F] border-[#EADBC8]',
            info: 'border-l-4 border-l-[#F16321] border-[#EADBC8]',
          };

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn(
                'pointer-events-auto bg-white text-[#1A1310] border-2 shadow-[3px_3px_0_#1A1310] p-3.5 flex items-start gap-3',
                borderColors[toast.type]
              )}
            >
              <div className="pt-0.5">{icons[toast.type]}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold font-display uppercase tracking-wider text-[#1A1310]">
                  {toast.title}
                </div>
                {toast.message && (
                  <p className="text-xs text-[#70625B] mt-0.5 leading-relaxed font-body">
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="p-1 text-[#70625B] hover:text-[#1A1310] transition-colors shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
