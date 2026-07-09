import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';

type Tab = 'circle' | 'inbox' | 'requests';

interface Friend {
  uid: string;
  name: string;
  email: string;
}

interface InboxItem {
  id: string;
  fromUid: string;
  fromName: string;
  brand: string;
  title: string;
  price: string;
  image: string;
  url: string;
  sentAt: any;
  seen: boolean;
  reaction?: 'cop' | 'skip' | 'maybe';
}

interface FriendRequest {
  id: string;
  fromUid: string;
  fromName: string;
  fromEmail: string;
  sentAt: any;
}

const FriendsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('circle');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{ uid: string; name: string; email: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    // Friends listener
    const friendsUnsub = onSnapshot(collection(db, 'users', user.uid, 'friends'), snap => {
      setFriends(snap.docs.map(d => ({ uid: d.id, ...d.data() } as Friend)));
    });

    // Inbox listener
    const inboxUnsub = onSnapshot(
      query(collection(db, 'users', user.uid, 'friend_inbox')),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as InboxItem));
        items.sort((a, b) => (b.sentAt?.toMillis?.() || 0) - (a.sentAt?.toMillis?.() || 0));
        setInboxItems(items);
        setUnreadCount(items.filter(i => !i.seen).length);
      }
    );

    // Requests listener
    const reqUnsub = onSnapshot(
      query(collection(db, 'friend_requests'), where('toUid', '==', user.uid)),
      snap => {
        setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest)));
      }
    );

    return () => { friendsUnsub(); inboxUnsub(); reqUnsub(); };
  }, []);

  const handleSearchUser = async () => {
    if (!searchEmail.trim()) return;
    setIsSearching(true);
    setSearchResult(null);
    try {
      const q = query(collection(db, 'users'), where('email', '==', searchEmail.trim().toLowerCase()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        setSearchResult({ uid: d.id, name: d.data().displayName || d.data().email, email: d.data().email });
      } else {
        showToast('No user found with that email', 'error');
      }
    } catch {
      showToast('Search failed. Try again.', 'error');
    }
    setIsSearching(false);
  };

  const handleSendRequest = async (toUser: { uid: string; name: string; email: string }) => {
    const user = auth.currentUser;
    if (!user) return;
    if (toUser.uid === user.uid) { showToast("That's you!", 'error'); return; }
    const alreadyFriend = friends.some(f => f.uid === toUser.uid);
    if (alreadyFriend) { showToast('Already in your circle', 'error'); return; }
    try {
      await addDoc(collection(db, 'friend_requests'), {
        fromUid: user.uid,
        fromName: user.displayName || user.email || 'Someone',
        fromEmail: user.email || '',
        toUid: toUser.uid,
        sentAt: new Date(),
      });
      showToast('Friend request sent ✦', 'success');
      setSearchResult(null);
      setSearchEmail('');
    } catch {
      showToast('Could not send request', 'error');
    }
  };

  const handleAcceptRequest = async (req: FriendRequest) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      // Add sender to current user's friends (allowed — current user owns this)
      await addDoc(collection(db, 'users', user.uid, 'friends'), {
        uid: req.fromUid,
        name: req.fromName,
        email: req.fromEmail,
        addedAt: new Date(),
      });

      // Write a cross_friend_add document — the sender will be added
      // to their own friends list via a Cloud Function or next login.
      // For now, write to a shared accepted_friend_requests collection
      // which has permissive write rules for authenticated users.
      await addDoc(collection(db, 'accepted_friend_requests'), {
        acceptedByUid: user.uid,
        acceptedByName: user.displayName || user.email || 'Your friend',
        acceptedByEmail: user.email || '',
        originalFromUid: req.fromUid,
        acceptedAt: new Date(),
        processed: false,
      });

      // Delete the original request
      await deleteDoc(doc(db, 'friend_requests', req.id));
      showToast(`${req.fromName} added to your circle ✦`, 'success');
    } catch (error) {
      console.error('Accept friend error:', error);
      showToast('Could not accept request', 'error');
    }
  };

  const handleDeclineRequest = async (reqId: string) => {
    try {
      await deleteDoc(doc(db, 'friend_requests', reqId));
    } catch {}
  };

  const handleRemoveFriend = async (friendUid: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      // Find and delete the friend doc (uid is the doc ID)
      await deleteDoc(doc(db, 'users', user.uid, 'friends', friendUid));
      showToast('Removed from circle', 'success');
    } catch {
      showToast('Could not remove', 'error');
    }
  };

  const handleReact = async (itemId: string, reaction: 'cop' | 'skip' | 'maybe') => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'friend_inbox', itemId), {
        reaction,
        seen: true,
      });
    } catch {}
  };

  const markSeen = async (itemId: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'friend_inbox', itemId), { seen: true });
    } catch {}
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'circle', label: 'Circle', icon: 'group' },
    { key: 'inbox', label: 'Inbox', icon: 'inbox' },
    { key: 'requests', label: 'Requests', icon: 'person_add' },
  ];

  return (
    <div className="min-h-dvh bg-surface-0 text-ink pb-32 font-body">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-surface-0/90 backdrop-blur-xl border-b border-line px-6 py-5">
        <div className="flex items-center justify-between">
          <h1 className="text-ink font-bold text-xl tracking-tight">
            Style <span className="text-[#6157FF]">Circle</span>
          </h1>
          {unreadCount > 0 && (
            <div className="bg-[#FF4D6D] rounded-full px-3 py-1 flex items-center gap-1">
              <span className="text-ink text-[12px] font-bold">{unreadCount} new</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar pb-1 -mx-6 px-6">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold active:scale-95 transition-colors ${
                activeTab === t.key
                  ? 'bg-[#6157FF] text-ink'
                  : 'bg-surface-2 text-ink-soft'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]"
                style={{ fontVariationSettings: activeTab === t.key ? "'FILL' 1" : "'FILL' 0" }}>
                {t.icon}
              </span>
              {t.label}
              {t.key === 'requests' && requests.length > 0 && (
                <span className="bg-[#FF4D6D] rounded-full h-4 w-4 flex items-center justify-center text-[12px] text-ink font-bold">
                  {requests.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-5">

        {/* ---- CIRCLE TAB ---- */}
        {activeTab === 'circle' && (
          <div>
            {/* Search to add */}
            <div className="mb-6">
              <p className="text-ink-soft text-[12px] font-bold mb-3">Add by email</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={searchEmail}
                  onChange={e => setSearchEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchUser()}
                  placeholder="friend@email.com"
                  className="flex-1 bg-surface-2 border border-line rounded-xl px-4 py-3 text-ink text-sm placeholder:text-ink-faint outline-none focus:border-[#6157FF]/50"
                />
                <button
                  onClick={handleSearchUser}
                  disabled={isSearching}
                  className="bg-[#6157FF] px-4 py-3 rounded-xl active:scale-95"
                >
                  <span className="material-symbols-outlined text-ink text-[20px]">
                    {isSearching ? 'hourglass_empty' : 'search'}
                  </span>
                </button>
              </div>

              {/* Search result */}
              {searchResult && (
                <div className="mt-3 flex items-center justify-between bg-surface-2 rounded-2xl p-4 border border-line">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-[#6157FF]/20 flex items-center justify-center">
                      <span className="text-[#6157FF] font-bold">{searchResult.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-ink font-bold text-sm">{searchResult.name}</p>
                      <p className="text-ink-soft text-xs">{searchResult.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendRequest(searchResult)}
                    className="bg-[#6157FF] text-ink px-4 py-2 rounded-full text-xs font-bold active:scale-95"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {/* Friends list */}
            {friends.length === 0 ? (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-ink-faint text-7xl block mb-4">group</span>
                <p className="text-ink-soft text-sm">Your circle is empty</p>
                <p className="text-ink-faint text-xs mt-1">Add friends by email above</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-ink-soft text-[12px] font-bold mb-1">
                  {friends.length} in your circle
                </p>
                {friends.map(friend => (
                  <div key={friend.uid} className="flex items-center gap-4 bg-surface-2 rounded-2xl p-4 border border-line">
                    <div className="h-11 w-11 rounded-full bg-[#6157FF]/20 flex items-center justify-center shrink-0">
                      <span className="text-[#6157FF] font-bold text-base">{friend.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-ink font-bold text-sm truncate">{friend.name}</p>
                      <p className="text-ink-faint text-xs truncate">{friend.email}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveFriend(friend.uid)}
                      className="p-2 rounded-full bg-surface-2 active:scale-90"
                    >
                      <span className="material-symbols-outlined text-ink-faint text-[18px]">person_remove</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- INBOX TAB ---- */}
        {activeTab === 'inbox' && (
          <div>
            {inboxItems.length === 0 ? (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-ink-faint text-7xl block mb-4">inbox</span>
                <p className="text-ink-soft text-sm">Nothing here yet</p>
                <p className="text-ink-faint text-xs mt-1">When friends send you fits, they'll appear here</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {inboxItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => markSeen(item.id)}
                    className={`rounded-2xl overflow-hidden border ${item.seen ? 'border-line bg-white/3' : 'border-[#6157FF]/20 bg-[#6157FF]/5'}`}
                  >
                    {/* Product image */}
                    <div className="relative h-48 w-full">
                      <img src={item.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      {!item.seen && (
                        <div className="absolute top-3 left-3 bg-[#FF4D6D] rounded-full px-2 py-0.5">
                          <span className="text-ink text-[11px] font-bold">NEW</span>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                        <p className="text-[#6157FF] text-[12px] font-bold">From {item.fromName}</p>
                        <p className="text-ink font-bold text-base">{item.brand}</p>
                        <p className="text-ink-soft text-xs">{item.title} · {item.price}</p>
                      </div>
                    </div>

                    {/* Reaction row */}
                    <div className="px-4 py-4">
                      <p className="text-ink-faint text-[12px] font-bold mb-3">Your take</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleReact(item.id, 'cop')}
                          className={`flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 border ${
                            item.reaction === 'cop'
                              ? 'bg-[#22c55e] border-[#22c55e] text-ink'
                              : 'bg-surface-2 border-line text-ink-soft'
                          }`}
                        >
                          ✅ Cop it
                        </button>
                        <button
                          onClick={() => handleReact(item.id, 'maybe')}
                          className={`flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 border ${
                            item.reaction === 'maybe'
                              ? 'bg-[#6157FF] border-[#6157FF] text-ink'
                              : 'bg-surface-2 border-line text-ink-soft'
                          }`}
                        >
                          🤔 Maybe
                        </button>
                        <button
                          onClick={() => handleReact(item.id, 'skip')}
                          className={`flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 border ${
                            item.reaction === 'skip'
                              ? 'bg-[#FF4D6D] border-[#FF4D6D] text-ink'
                              : 'bg-surface-2 border-line text-ink-soft'
                          }`}
                        >
                          ❌ Skip
                        </button>
                      </div>
                      {/* Check MY size button */}
                      <button
                        onClick={() => navigate('/add-product', { state: { prefill: { id: item.id, brand: item.brand, title: item.title, image: item.image, url: item.url, category: 'Tops' } } })}
                        className="mt-3 w-full py-3 rounded-xl bg-surface-2 border border-line text-ink-soft text-xs font-bold active:scale-95 flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[#6157FF] text-[16px]">straighten</span>
                        Check if this fits me
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- REQUESTS TAB ---- */}
        {activeTab === 'requests' && (
          <div>
            {requests.length === 0 ? (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-ink-faint text-7xl block mb-4">person_add</span>
                <p className="text-ink-soft text-sm">No pending requests</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {requests.map(req => (
                  <div key={req.id} className="bg-surface-2 rounded-2xl p-4 border border-line">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-11 w-11 rounded-full bg-[#6157FF]/20 flex items-center justify-center shrink-0">
                        <span className="text-[#6157FF] font-bold text-base">{req.fromName.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="text-ink font-bold text-sm">{req.fromName}</p>
                        <p className="text-ink-faint text-xs">{req.fromEmail}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleAcceptRequest(req)}
                        className="flex-1 bg-[#6157FF] text-ink py-2.5 rounded-xl text-xs font-bold active:scale-95"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeclineRequest(req.id)}
                        className="px-5 py-2.5 rounded-xl bg-surface-2 border border-line text-ink-soft text-xs font-bold active:scale-95"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default FriendsScreen;
