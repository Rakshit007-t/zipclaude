/**
 * Unified Notification & Push Client for ZipRIGHT Frontend.
 *
 * Supports Web Push, in-app notifications, and Appwrite/Firebase streams.
 */
import { dataClient, isAppwrite } from './dataClient';
import { Query } from './appwrite';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type?: string;
  read: boolean;
  createdAt: string;
}

export const notificationClient = {
  /**
   * Request browser push/notification permissions.
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch {
      return 'denied';
    }
  },

  /**
   * Helper to convert base64 URL-safe VAPID key to Uint8Array for PushManager.
   */
  urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  },

  /**
   * Subscribe to Web Push notifications using VAPID key and PushManager.
   */
  async subscribeWebPush(vapidPublicKey?: string): Promise<PushSubscription | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return null;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const key = vapidPublicKey || (import.meta.env ? import.meta.env.VITE_VAPID_PUBLIC_KEY : '');
        if (!key) return null;
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(key),
        });
      }
      return sub;
    } catch (err) {
      console.warn('Web push subscription failed:', err);
      return null;
    }
  },


  /**
   * Show a local browser notification if permitted.
   */
  showNotification(title: string, options?: NotificationOptions): boolean {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          ...options,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  },

  /**
   * Subscribe to the live notification stream for the currently authenticated user.
   */
  subscribeUserNotifications(
    userId: string,
    callback: (notifications: AppNotification[]) => void
  ): () => void {
    if (!userId) {
      callback([]);
      return () => {};
    }

    if (isAppwrite) {
      const queries = [Query.equal('userId', userId), Query.orderDesc('createdAt'), Query.limit(25)];
      return dataClient.subscribeCollection('notifications', queries, (docs) => {
        const mapped: AppNotification[] = docs.map((d: any) => ({
          id: d.$id || d.id,
          userId: d.userId || userId,
          title: d.title || 'ZipRIGHT Notification',
          body: d.body || '',
          type: d.type || 'info',
          read: Boolean(d.read),
          createdAt: d.createdAt || d.$createdAt || new Date().toISOString(),
        }));
        callback(mapped);
      });
    }

    // Firebase fallback
    return dataClient.subscribeCollection('notifications', [], (docs) => {
      const filtered = docs
        .filter((d: any) => d.userId === userId || d.recipient_uid === userId)
        .map((d: any) => ({
          id: d.id,
          userId: d.userId || userId,
          title: d.title || 'ZipRIGHT Notification',
          body: d.body || '',
          type: d.type || 'info',
          read: Boolean(d.read),
          createdAt: d.createdAt || new Date().toISOString(),
        }));
      callback(filtered);
    });
  },

  /**
   * Mark a notification as read.
   */
  async markAsRead(notificationId: string): Promise<void> {
    await dataClient.updateDoc('notifications', notificationId, { read: true });
  },
};

export default notificationClient;
