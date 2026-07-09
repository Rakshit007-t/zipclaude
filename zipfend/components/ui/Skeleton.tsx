import React from 'react';
import { cn } from './cn';

interface SkeletonProps {
  className?: string;
  /** Circle instead of rounded rect (avatars). */
  circle?: boolean;
}

/**
 * Loading placeholder with shimmer. Size it with width/height classes:
 * <Skeleton className="h-4 w-32" />
 */
export const Skeleton: React.FC<SkeletonProps> = ({ className, circle }) => (
  <div
    aria-hidden="true"
    className={cn(
      'relative overflow-hidden bg-surface-2 skeleton-shimmer',
      circle ? 'rounded-full' : 'rounded-lg',
      className,
    )}
  />
);

/** Paragraph placeholder — n shimmering lines, last one shorter. */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({ lines = 3, className }) => (
  <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
    ))}
  </div>
);

export default Skeleton;
