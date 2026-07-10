import React from 'react';
import { cn } from './cn';

/**
 * Editorial micro-label — uppercase, letterspaced, faint. The MAISON
 * signature for section openers: an eyebrow above a serif headline.
 */
const Eyebrow: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, children, ...rest }) => (
  <p className={cn('eyebrow', className)} {...rest}>
    {children}
  </p>
);

export default Eyebrow;
