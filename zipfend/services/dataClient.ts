/**
 * Unified Data Client for ZipRIGHT Frontend.
 *
 * Transparently bridges Firestore and Appwrite Databases.
 * Configured via VITE_AUTH_PROVIDER=appwrite|firebase.
 */
import {
  doc,
  getDoc as firebaseGetDoc,
  setDoc as firebaseSetDoc,
  updateDoc as firebaseUpdateDoc,
  deleteDoc as firebaseDeleteDoc,
  onSnapshot as firebaseOnSnapshot,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp as firebaseServerTimestamp,
  deleteField as firebaseDeleteField,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { appwriteDatabases, APPWRITE_DATABASE_ID, client } from './appwrite';

export const isAppwrite =
  import.meta.env.VITE_AUTH_PROVIDER === 'appwrite' ||
  import.meta.env.VITE_BACKEND_PROVIDER === 'appwrite';

export interface UnifiedDocumentSnapshot<T = any> {
  id: string;
  exists: () => boolean;
  data: () => T | undefined;
}

function normalizeDocData(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const copy: any = { ...data };
  // Appwrite adds metadata fields starting with $
  if (copy.$id && !copy.uid && !copy.id) {
    copy.id = copy.$id;
  }
  return copy;
}

function sanitizeForAppwrite(data: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    // Handle deleteField sentinel
    if (v && typeof v === 'object' && v._methodName === 'deleteField') {
      continue;
    }
    // Handle serverTimestamp sentinel
    if (v && typeof v === 'object' && typeof v.toMillis === 'function') {
      sanitized[k] = new Date(v.toMillis()).toISOString();
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export const dataClient = {
  isAppwrite,

  async getDoc(collectionName: string, docId: string): Promise<UnifiedDocumentSnapshot> {
    if (isAppwrite) {
      try {
        const doc = await appwriteDatabases.getDocument(APPWRITE_DATABASE_ID, collectionName, docId);
        return {
          id: docId,
          exists: () => true,
          data: () => normalizeDocData(doc),
        };
      } catch (err: any) {
        if (err?.code === 404 || err?.response?.code === 404) {
          return {
            id: docId,
            exists: () => false,
            data: () => undefined,
          };
        }
        throw err;
      }
    }

    const snap = await firebaseGetDoc(doc(db, collectionName, docId));
    return {
      id: snap.id,
      exists: () => snap.exists(),
      data: () => snap.data(),
    };
  },

  async setDoc(
    collectionName: string,
    docId: string,
    data: Record<string, any>,
    options?: { merge?: boolean }
  ): Promise<void> {
    if (isAppwrite) {
      let payload = sanitizeForAppwrite(data);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Try update first
          await appwriteDatabases.updateDocument(APPWRITE_DATABASE_ID, collectionName, docId, payload);
          return;
        } catch (err: any) {
          const msg = String(err?.message || err?.response?.message || '');
          if (err?.code === 404 || err?.response?.code === 404) {
            try {
              // Document does not exist yet; create it
              await appwriteDatabases.createDocument(APPWRITE_DATABASE_ID, collectionName, docId, payload);
              return;
            } catch (createErr: any) {
              const createMsg = String(createErr?.message || createErr?.response?.message || '');
              const match = createMsg.match(/Unknown attribute:\s*"?([^"'\s]+)"?/i);
              if (match && match[1] && match[1] in payload) {
                delete payload[match[1]];
                continue;
              }
              throw createErr;
            }
          }
          const match = msg.match(/Unknown attribute:\s*"?([^"'\s]+)"?/i);
          if (match && match[1] && match[1] in payload) {
            delete payload[match[1]];
            continue;
          }
          throw err;
        }
      }
      return;
    }

    await firebaseSetDoc(doc(db, collectionName, docId), data, options);
  },

  async updateDoc(
    collectionName: string,
    docId: string,
    data: Record<string, any>
  ): Promise<void> {
    if (isAppwrite) {
      const sanitized = sanitizeForAppwrite(data);
      await appwriteDatabases.updateDocument(APPWRITE_DATABASE_ID, collectionName, docId, sanitized);
      return;
    }

    await firebaseUpdateDoc(doc(db, collectionName, docId), data);
  },

  async deleteDoc(collectionName: string, docId: string): Promise<void> {
    if (isAppwrite) {
      try {
        await appwriteDatabases.deleteDocument(APPWRITE_DATABASE_ID, collectionName, docId);
      } catch (err: any) {
        if (err?.code !== 404) throw err;
      }
      return;
    }

    await firebaseDeleteDoc(doc(db, collectionName, docId));
  },

  onSnapshot(
    collectionName: string,
    docId: string,
    onNext: (snap: UnifiedDocumentSnapshot) => void,
    onError?: (err: any) => void
  ): () => void {
    if (isAppwrite) {
      let active = true;

      const fetchDoc = async () => {
        try {
          const doc = await appwriteDatabases.getDocument(APPWRITE_DATABASE_ID, collectionName, docId);
          if (active) {
            onNext({
              id: docId,
              exists: () => true,
              data: () => normalizeDocData(doc),
            });
          }
        } catch (err: any) {
          if (active) {
            if (err?.code === 404 || err?.response?.code === 404) {
              onNext({
                id: docId,
                exists: () => false,
                data: () => undefined,
              });
            } else if (onError) {
              onError(err);
            }
          }
        }
      };

      // Initial read
      fetchDoc();

      // Appwrite Realtime WebSocket subscription with polling fallback
      let ws: WebSocket | null = null;
      try {
        const wsUrl = new URL(client.endpoint.replace(/^http/, 'ws') + '/realtime');
        wsUrl.searchParams.append('project', client.project);
        wsUrl.searchParams.append(
          'channels[]',
          `databases.${APPWRITE_DATABASE_ID}.collections.${collectionName}.documents.${docId}`
        );

        ws = new WebSocket(wsUrl.toString());
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.payload && active) {
              onNext({
                id: docId,
                exists: () => true,
                data: () => normalizeDocData(message.payload),
              });
            }
          } catch {
            // Ignore parse errors
          }
        };
        ws.onerror = () => {
          // Silently fall back to polling
        };
      } catch {
        // Fall back to polling
      }

      // Background safety poll every 10 seconds
      const pollTimer = setInterval(() => {
        if (active) fetchDoc();
      }, 10000);

      return () => {
        active = false;
        clearInterval(pollTimer);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };
    }

    // Firebase fallback
    const unsub = firebaseOnSnapshot(
      doc(db, collectionName, docId),
      (snap) => {
        onNext({
          id: snap.id,
          exists: () => snap.exists(),
          data: () => snap.data(),
        });
      },
      onError
    );
    return unsub;
  },

  subscribeCollection(
    collectionName: string,
    queries: string[] = [],
    onNext: (docs: any[]) => void,
    onError?: (err: any) => void
  ): () => void {
    if (isAppwrite) {
      let active = true;

      const fetchList = async () => {
        try {
          const res = await appwriteDatabases.listDocuments(APPWRITE_DATABASE_ID, collectionName, queries);
          if (active) {
            onNext(res.documents.map(normalizeDocData));
          }
        } catch (err: any) {
          if (active && onError) onError(err);
        }
      };

      fetchList();

      const pollTimer = setInterval(() => {
        if (active) fetchList();
      }, 10000);

      return () => {
        active = false;
        clearInterval(pollTimer);
      };
    }

    // Firebase mode fallback
    const colRef = collection(db, collectionName);
    const unsub = firebaseOnSnapshot(
      colRef,
      (snap) => {
        onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      onError
    );
    return unsub;
  },

  serverTimestamp() {
    if (isAppwrite) {
      const now = Date.now();
      return {
        toMillis: () => now,
        toDate: () => new Date(now),
        toISOString: () => new Date(now).toISOString(),
      };
    }
    return firebaseServerTimestamp();
  },

  deleteField() {
    if (isAppwrite) {
      return { _methodName: 'deleteField' };
    }
    return firebaseDeleteField();
  },
};

export default dataClient;
