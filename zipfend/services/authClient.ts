import { getAuth, onAuthStateChanged as firebaseOnAuthStateChanged, type User } from 'firebase/auth';
import app from '../firebase';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
}

const auth = getAuth(app);
let cachedAppwriteUser: any = null;
const authListeners = new Set<(user: User | null) => void>();

export function requiresEmailVerification(user: User | null): boolean {
  if (!user || user.isAnonymous) return false;

  const providers = user.providerData?.map(p => p.providerId) || [];
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
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite' && cachedAppwriteUser) {
      return {
        uid: cachedAppwriteUser.$id,
        email: cachedAppwriteUser.email,
        displayName: cachedAppwriteUser.name,
        photoURL: null,
        phoneNumber: cachedAppwriteUser.phone || null,
        isAnonymous: false,
        emailVerified: Boolean(cachedAppwriteUser.emailVerification),
        getIdToken: async () => (await authClient.getIdToken()) || '',
        providerData: [{ providerId: cachedAppwriteUser.phone ? 'phone' : 'password' }],
      } as unknown as User;
    }
    return auth.currentUser;
  },

  async getIdToken(): Promise<string | null> {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      try {
        const { getAppwriteBackendToken } = await import('./appwrite');
        return await getAppwriteBackendToken();
      } catch {
        return null;
      }
    }
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch {
      return null;
    }
  },

  async notifyAuthChanged(): Promise<void> {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      try {
        const { getAppwriteUser } = await import('./appwrite');
        const u = await getAppwriteUser();
        cachedAppwriteUser = u;
        const synthUser = u
          ? ({
              uid: u.$id,
              email: u.email,
              displayName: u.name,
              photoURL: null,
              phoneNumber: u.phone || null,
              isAnonymous: false,
              emailVerified: Boolean(u.emailVerification),
              getIdToken: async () => (await authClient.getIdToken()) || '',
              providerData: [{ providerId: u.phone ? 'phone' : 'password' }],
            } as unknown as User)
          : null;
        authListeners.forEach((fn) => {
          try {
            fn(synthUser);
          } catch {}
        });
      } catch {
        authListeners.forEach((fn) => {
          try {
            fn(null);
          } catch {}
        });
      }
    }
  },

  async signOut(): Promise<void> {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      try {
        const { appwriteAccount } = await import('./appwrite');
        await appwriteAccount.deleteSession('current');
      } catch {}
      cachedAppwriteUser = null;
      await this.notifyAuthChanged();
      return;
    }
    return auth.signOut();
  },

  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      authListeners.add(callback);
      let active = true;
      (async () => {
        try {
          const { getAppwriteUser } = await import('./appwrite');
          const u = await getAppwriteUser();
          if (active) {
            cachedAppwriteUser = u;
            if (u) {
              const syntheticUser = {
                uid: u.$id,
                email: u.email,
                displayName: u.name,
                photoURL: null,
                phoneNumber: u.phone || null,
                isAnonymous: false,
                emailVerified: Boolean(u.emailVerification),
                getIdToken: async () => (await authClient.getIdToken()) || '',
                providerData: [{ providerId: u.phone ? 'phone' : 'password' }],
              } as unknown as User;
              callback(syntheticUser);
            } else {
              callback(null);
            }
          }
        } catch {
          if (active) callback(null);
        }
      })();

      return () => {
        active = false;
        authListeners.delete(callback);
      };
    }

    return firebaseOnAuthStateChanged(auth, callback);
  },
};

export default authClient;
