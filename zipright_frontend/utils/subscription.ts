import { db } from '../firebase';
import { doc, getDoc, updateDoc, setDoc, increment } from 'firebase/firestore';

export type UserRole = 'user' | 'seller' | 'admin';

export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Basic',
    limits: { sizeRecs: 10, tryOns: 5 }
  },
  STARTER: {
    id: 'starter',
    name: 'Starter',
    limits: { sizeRecs: 25, tryOns: 15 }
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    limits: { sizeRecs: 100, tryOns: 50 }
  },
  ELITE: {
    id: 'elite',
    name: 'Elite',
    limits: { sizeRecs: 9999, tryOns: 9999 }
  }
};

export const getUserRole = (): UserRole => {
  return (localStorage.getItem('zipright_role') as UserRole) || 'user';
};

export const setUserRole = (role: UserRole) => {
  localStorage.setItem('zipright_role', role);
};

export const getSellerStatus = () => {
  return localStorage.getItem('zipright_seller_status') || 'none';
};

export const setSellerStatus = (status: string) => {
  localStorage.setItem('zipright_seller_status', status);
};

export const getUserPlan = () => {
  const planId = localStorage.getItem('zipright_plan') || 'free';
  return Object.values(PLANS).find(p => p.id === planId) || PLANS.FREE;
};

export const getUsage = () => {
  const usage = localStorage.getItem('zipright_usage');
  return usage ? JSON.parse(usage) : { sizeRecs: 0, tryOns: 0 };
};

export const incrementUsage = (type: 'sizeRecs' | 'tryOns') => {
  const usage = getUsage();
  usage[type] += 1;
  localStorage.setItem('zipright_usage', JSON.stringify(usage));
};

export const checkLimit = (type: 'sizeRecs' | 'tryOns') => {
  const plan = getUserPlan();
  const usage = getUsage();
  return usage[type] < plan.limits[type];
};

export const getFirestoreUserPlan = async (uid: string) => {
  const userDoc = await getDoc(doc(db, 'users', uid));
  if (userDoc.exists()) {
    const planId = userDoc.data().planId || 'free';
    return Object.values(PLANS).find(p => p.id === planId) || PLANS.FREE;
  }
  return PLANS.FREE;
};

export const checkFirestoreLimit = async (uid: string, type: 'sizeRecs' | 'tryOns') => {
  const userDoc = await getDoc(doc(db, 'users', uid));
  if (userDoc.exists()) {
    const userData = userDoc.data();
    const planId = userData.planId || 'free';
    const plan = Object.values(PLANS).find(p => p.id === planId) || PLANS.FREE;
    const usage = userData.usage?.[type] || 0;
    return usage < plan.limits[type];
  }
  return true;
};

export const incrementFirestoreUsage = async (uid: string, type: 'sizeRecs' | 'tryOns') => {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, {
    [`usage.${type}`]: increment(1)
  });
};
