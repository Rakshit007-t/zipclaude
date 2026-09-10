/**
 * Local UI preferences only.
 *
 * Try-on access is deliberately not decided here: the backend owns the
 * Firestore transaction that applies the three free uses and wallet charge.
 */

export type UserRole = 'user' | 'seller' | 'admin';

export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Basic',
    limits: { sizeRecs: 10, profiles: 3 },
  },
  STARTER: {
    id: 'starter',
    name: 'Starter',
    limits: { sizeRecs: 25, profiles: 3 },
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    limits: { sizeRecs: 100, profiles: 5 },
  },
  ELITE: {
    id: 'elite',
    name: 'Elite',
    limits: { sizeRecs: 9999, profiles: 10 },
  },
};

/**
 * UI presentation hint only.
 * NEVER use client storage as proof of authorization. Real authorization is
 * enforced server-side via verified tokens and the /auth/access endpoint.
 */
export const getUserRole = (): UserRole =>
  (localStorage.getItem('zipright_role') as UserRole) || 'user';

export const setUserRole = (role: UserRole) => {
  localStorage.setItem('zipright_role', role);
};

export const getSellerStatus = () => localStorage.getItem('zipright_seller_status') || 'none';

export const setSellerStatus = (status: string) => {
  localStorage.setItem('zipright_seller_status', status);
};

export const getUserPlan = () => {
  const planId = localStorage.getItem('zipright_plan') || 'free';
  return Object.values(PLANS).find(plan => plan.id === planId) || PLANS.FREE;
};
