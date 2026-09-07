import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import app from '../firebase';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
}

const auth = getAuth(app);

export function requiresEmailVerification(user: User | null): boolean {
  if (!user || user.isAnonymous) return false;

  const providers = user.providerData.map(p => p.providerId);
  const isOAuthOrPhone = providers.some(p => p === 'google.com' || p === 'phone' || p === 'apple.com');
  if (isOAuthOrPhone) {
    return false;
  }

  const isPasswordUser = providers.includes('password') || Boolean(user.email && !user.phoneNumber);
  if (isPasswordUser) {
    return !user.emailVerified;
  }

  return false;
}

export const authClient = {
  get currentUser(): User | null {
    return auth.currentUser;
  },

  async getIdToken(): Promise<string | null> {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch {
      return null;
    }
  },

  onAuthStateChanged(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
  },
};

export default authClient;

