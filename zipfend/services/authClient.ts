import { getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged as firebaseOnAuthStateChanged, type User } from 'firebase/auth';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
}

function getFirebaseAuth() {
  const apps = getApps();
  return apps.length > 0 ? getAuth(apps[0]) : null;
}
const CACHE_KEY = 'zipright_cached_appwrite_user';

function loadCachedAppwriteUser(): any {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistCachedAppwriteUser(u: any) {
  cachedAppwriteUser = u;
  if (typeof window === 'undefined') return;
  try {
    if (u) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(u));
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {}
}

let cachedAppwriteUser: any = loadCachedAppwriteUser();
const authListeners = new Set<(user: User | null) => void>();

function toSyntheticUser(u: any): User | null {
  if (!u) return null;
  return {
    uid: u.$id,
    email: u.email,
    displayName: u.name,
    photoURL: null,
    phoneNumber: u.phone || null,
    isAnonymous: false,
    emailVerified: Boolean(u.emailVerification),
    getIdToken: async () => (await authClient.getIdToken()) || '',
    reload: async () => { await authClient.notifyAuthChanged(); },
    providerData: [{ providerId: u.phone ? 'phone' : 'password' }],
  } as unknown as User;
}

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
      return toSyntheticUser(cachedAppwriteUser);
    }
    return getFirebaseAuth()?.currentUser || null;
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
    const fbUser = getFirebaseAuth()?.currentUser;
    if (!fbUser) return null;
    try {
      return await fbUser.getIdToken();
    } catch {
      return null;
    }
  },

  async notifyAuthChanged(): Promise<void> {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      try {
        const { getAppwriteUser } = await import('./appwrite');
        const u = await getAppwriteUser();
        persistCachedAppwriteUser(u);
        const synthUser = toSyntheticUser(u);
        authListeners.forEach((fn) => {
          try {
            fn(synthUser);
          } catch {}
        });
      } catch {
        persistCachedAppwriteUser(null);
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
      persistCachedAppwriteUser(null);
      await this.notifyAuthChanged();
      return;
    }
    const fb = getFirebaseAuth();
    return fb ? fb.signOut() : Promise.resolve();
  },

  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      authListeners.add(callback);
      // Immediately notify listener if we have a synchronously cached user
      if (cachedAppwriteUser) {
        try {
          callback(toSyntheticUser(cachedAppwriteUser));
        } catch {}
      }
      let active = true;
      (async () => {
        try {
          const { getAppwriteUser } = await import('./appwrite');
          const u = await getAppwriteUser();
          if (active) {
            persistCachedAppwriteUser(u);
            callback(toSyntheticUser(u));
          }
        } catch {
          if (active) {
            persistCachedAppwriteUser(null);
            callback(null);
          }
        }
      })();

      return () => {
        active = false;
        authListeners.delete(callback);
      };
    }

    const fb = getFirebaseAuth();
    return fb ? firebaseOnAuthStateChanged(fb, callback) : () => {};
  },
};

export default authClient;
