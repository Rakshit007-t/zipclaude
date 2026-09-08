import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Accessible Breadcrumb navigation with Schema.org BreadcrumbList microdata
 * Styled in the MAISON editorial luxury palette.
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className }) => {
  if (!items || items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center text-[12px] text-ink-faint py-2.5', className)}>
      <ol
        className="flex items-center flex-wrap gap-1.5 list-none m-0 p-0"
        itemScope
        itemType="https://schema.org/BreadcrumbList"
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li
              key={item.label + index}
              className="flex items-center gap-1.5"
              itemProp="itemListElement"
              itemScope
              itemType="https://schema.org/ListItem"
            >
              {item.href && !isLast ? (
                <Link
                  to={item.href}
                  className="text-ink-soft hover:text-ink transition-colors duration-150 underline-offset-4 hover:underline"
                  itemProp="item"
                >
                  <span itemProp="name">{item.label}</span>
                </Link>
              ) : (
                <span
                  className={cn(isLast ? 'text-ink font-medium' : 'text-ink-soft')}
                  aria-current={isLast ? 'page' : undefined}
                  itemProp="name"
                >
                  {item.label}
                </span>
              )}
              <meta itemProp="position" content={String(index + 1)} />

              {!isLast && (
                <span className="text-ink-faint/60 text-[10px] select-none" aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;
