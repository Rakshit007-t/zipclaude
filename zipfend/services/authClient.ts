import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import app from '../firebase';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
}

const auth = getAuth(app);

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
