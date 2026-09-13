import React from 'react';
import { cn } from '../../lib/utils';
import { SpawnTier } from '../../types';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'neutral' | 'tier' | 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'active' | 'claimed' | 'timer' | 'outline' | 'dark';
  size?: 'xs' | 'sm' | 'md';
  tier?: SpawnTier;
  icon?: React.ReactNode;
  dot?: boolean;
}

export const Pill: React.FC<PillProps> = ({
  className,
  variant = 'default',
  size = 'sm',
  tier,
  icon,
  dot = false,
  children,
  ...props
}) => {
  const activeVariant = tier ? tier : variant;

  const variants = {
    default: 'bg-[#FBEEE1] text-[#1A1310] border border-[#EADBC8]',
    neutral: 'bg-[#FBEEE1] text-[#1A1310] border border-[#EADBC8]',
    tier: 'bg-[#FDE8D7] text-[#F16321] font-bold border border-[#FCD2B5]',
    tier1: 'bg-[#EADBC8] text-[#1A1310] font-medium border border-[#D5C4AE]',
    tier2: 'bg-[#FBEEE1] text-[#D44E11] font-semibold border border-[#F3DEC9]',
    tier3: 'bg-[#FDE8D7] text-[#F16321] font-bold border border-[#FCD2B5]',
    tier4: 'bg-[#1A1310] text-[#FBF6EE] font-bold border border-[#F16321]',
    active: 'bg-[#E8F5E9] text-[#2E7D32] font-semibold border border-[#C8E6C9]',
    claimed: 'bg-[#EFEBE9] text-[#70625B] font-medium border border-[#D7CCC8]',
    timer: 'bg-[#1A1310] text-[#FBF6EE] font-mono font-medium',
    outline: 'bg-transparent text-[#1A1310] border border-[#1A1310]',
    dark: 'bg-[#231B17] text-[#FAF4EB] border border-[#3D2D26]',
  };

  const sizes = {
    xs: 'px-2 py-0.5 text-[11px] gap-1 h-5 rounded-sm',
    sm: 'px-2.5 py-1 text-xs gap-1.5 h-6 rounded-sm',
    md: 'px-3 py-1.5 text-sm gap-2 h-8 rounded-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap select-none font-body transition-colors',
        variants[activeVariant],
        sizes[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            activeVariant === 'active' && 'bg-[#2E7D32] animate-pulse',
            activeVariant === 'tier4' && 'bg-[#F16321]',
            activeVariant === 'tier3' && 'bg-[#F16321]',
            activeVariant === 'tier2' && 'bg-[#D44E11]',
            activeVariant === 'tier1' && 'bg-[#70625B]',
            activeVariant === 'claimed' && 'bg-[#9B8C84]',
            activeVariant === 'timer' && 'bg-[#F16321] animate-pulse',
            activeVariant === 'default' && 'bg-[#70625B]'
          )}
        />
      )}
      {icon && <span className="inline-flex shrink-0 text-current">{icon}</span>}
      <span className="leading-none whitespace-nowrap">{children}</span>
    </span>
  );
};
