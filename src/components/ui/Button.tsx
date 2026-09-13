import React from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'dark' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loading = false,
      disabled,
      children,
      leftIcon,
      rightIcon,
      fullWidth = false,
      ...props
    },
    ref
  ) => {
    const isButtonLoading = isLoading || loading;
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 cursor-pointer select-none font-body';

    const variants = {
      primary:
        'bg-[#F16321] text-white hover:bg-[#D44E11] active:bg-[#B33E09] shadow-[3px_3px_0_#1A1310] font-semibold tracking-wide',
      secondary:
        'bg-[#FDE8D7] text-[#1A1310] hover:bg-[#F3DEC9] border-2 border-[#1A1310] active:bg-[#EADBC8] font-medium',
      dark:
        'bg-[#1A1310] text-white hover:bg-[#2E231E] active:bg-[#3D2F28] shadow-[3px_3px_0_#F16321] font-medium',
      outline:
        'bg-white border-2 border-[#1A1310] text-[#1A1310] hover:bg-[#FDE8D7] active:bg-[#F3DEC9] font-medium',
      ghost:
        'bg-transparent text-[#1A1310] hover:bg-[#FDE8D7] active:bg-[#F3DEC9]',
      danger:
        'bg-[#D32F2F] text-white hover:bg-[#B71C1C] active:bg-[#9A0007] shadow-[3px_3px_0_#1A1310] font-semibold',
    };

    const sizes = {
      sm: 'h-9 px-3 text-xs gap-1.5 rounded-sm',
      md: 'h-11 px-5 text-sm gap-2 min-h-[44px] rounded-sm',
      lg: 'h-13 px-6 text-base gap-2.5 min-h-[48px] rounded-sm',
      icon: 'h-11 w-11 p-0 min-h-[44px] min-w-[44px] rounded-sm',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isButtonLoading}
        className={cn(
          baseStyles,
          variants[variant],
          sizes[size],
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {isButtonLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-current" />
        ) : (
          <>
            {leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
            <span className="truncate">{children}</span>
            {rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
