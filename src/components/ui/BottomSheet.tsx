import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: string;
  showHandle?: boolean;
  hasBackdrop?: boolean;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  headerAction,
  children,
  maxHeight = 'max-h-[85vh]',
  showHandle = true,
  hasBackdrop = true,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className={cn("fixed inset-0 z-[50] flex flex-col justify-end overflow-hidden", !hasBackdrop && "pointer-events-none")}>
          {/* Backdrop */}
          {hasBackdrop && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="absolute inset-0 bg-[#1A1310]/50 backdrop-blur-[2px]"
            />
          )}

          {/* Drawer / Sheet Panel */}
          <motion.div
            ref={sheetRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={cn(
              'relative z-10 w-full bg-[#F4EFE6] text-[#1A1310] rounded-t-lg border-t-[3px] border-[#1A1310] shadow-2xl flex flex-col overflow-hidden pointer-events-auto',
              maxHeight
            )}
          >
            {/* Grab Handle */}
            {showHandle && (
              <div className="w-full flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
                <div className="w-12 h-1 bg-[#1A1310]" />
              </div>
            )}

            {/* Header */}
            {(title || headerAction) && (
              <div className="px-4 pt-2 pb-3 border-b-2 border-[#1A1310] flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h3 className="text-base font-bold font-display tracking-tight text-[#1A1310] truncate">
                      {title}
                    </h3>
                  )}
                  {subtitle && (
                    <p className="text-xs text-[#70625B] font-body mt-0.5 truncate">
                      {subtitle}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {headerAction}
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 text-[#70625B] border-2 border-[#1A1310] hover:text-[#1A1310] hover:bg-[#FDE8D7] transition-colors"
                    aria-label="Close sheet"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 overscroll-contain">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
