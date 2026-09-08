import { useNavigate, useLocation } from 'react-router-dom';
import { useCallback } from 'react';

interface NavigationOptions {
  replace?: boolean;
  state?: Record<string, unknown>;
}

const PARENT_ROUTE_MAP: Record<string, string> = {
  '/profile/edit': '/profile',
  '/rewards': '/profile',
  '/profile/followers': '/profile',
  '/profile/following': '/profile',
  '/settings': '/profile',
  '/manage-profiles': '/settings',
  '/fit-profile': '/manage-profiles',
  '/smart-fit-scan': '/fit-profile',
  '/recent-scans': '/fit-profile',
  '/fashion-studio': '/home',
  '/tryon-studio': '/fashion-studio',
  '/live-tryon': '/fashion-studio',
  '/ai-studio': '/fashion-studio',
  '/avatar-intro': '/home',
  '/avatar-view': '/avatar-intro',
  '/wishlist': '/marketplace',
  '/cart': '/marketplace',
  '/gift-look': '/marketplace',
  '/gift-inbox': '/marketplace',
  '/community': '/home',
  '/create-look': '/community',
  '/friends': '/home',
  '/stylist': '/home',
  '/seller/add-product': '/seller/dashboard',
  '/seller/catalog': '/seller/dashboard',
  '/seller/dashboard': '/settings',
  '/seller/integration': '/seller/dashboard',
  '/brand/management': '/settings',
  '/faqs': '/settings',
  '/about-us': '/settings',
  '/terms-of-use': '/settings',
  '/privacy-policy': '/settings',
  '/privacy-center': '/settings',
  '/cookie-policy': '/settings',
  '/refund-policy': '/settings',
  '/404': '/home',
};

/**
 * Deterministic Navigation Hook
 * Guarantees 1-step back navigation to parent screens without relying on unpredictable browser history.
 */
export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname;
  const navState = (location.state as Record<string, unknown> | null) || {};

  /**
   * Deterministic goBack:
   * 1. Checks explicit `location.state.returnTo`
   * 2. Checks parent route map for exact path match
   * 3. Checks prefix route match
   * 4. Fallbacks to `/home`
   */
  const goBack = useCallback((defaultFallback?: string) => {
    if (typeof navState.returnTo === 'string' && navState.returnTo) {
      navigate(navState.returnTo, { replace: true });
      return;
    }

    if (defaultFallback) {
      navigate(defaultFallback, { replace: true });
      return;
    }

    if (PARENT_ROUTE_MAP[currentPath]) {
      navigate(PARENT_ROUTE_MAP[currentPath], { replace: true });
      return;
    }

    // Prefix matching for dynamic routes (e.g. /profile/:uid -> /friends or /home)
    if (currentPath.startsWith('/profile/')) {
      navigate('/profile', { replace: true });
      return;
    }
    if (currentPath.startsWith('/chat/')) {
      navigate('/friends', { replace: true });
      return;
    }
    if (currentPath.startsWith('/seller/edit-product/')) {
      navigate('/seller/catalog', { replace: true });
      return;
    }
    if (currentPath.startsWith('/brand/')) {
      navigate('/marketplace', { replace: true });
      return;
    }

    navigate('/home', { replace: true });
  }, [currentPath, navState, navigate]);

  const goTo = useCallback((path: string, options?: NavigationOptions) => {
    navigate(path, {
      replace: options?.replace,
      state: { returnTo: currentPath, ...options?.state },
    });
  }, [currentPath, navigate]);

  return {
    navigate: goTo,
    goBack,
    currentPath,
  };
}
