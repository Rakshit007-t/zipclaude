import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { PublicProfile, searchUsers } from '../services/social';
import { Conversation, onConversations, unreadConversations } from '../services/messages';
import { Eyebrow, Wordmark, Badge, Button, EmptyState } from '../components/ui';

type Tab = 'circle' | 'chats' | 'inbox' | 'requests';

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
  category?: string;
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
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PublicProfile[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);

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

    // Chat list
    const convUnsub = onConversations(setConversations);

    // Complete the two-way friendship loop: when someone accepted MY request,
    // add them to my own friends list (I own that write) and mark it processed.
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'accepted_friend_requests'),
          where('originalFromUid', '==', user.uid),
          where('processed', '==', false),
        ));
        for (const d of snap.docs) {
          const a = d.data();
          if (!a.acceptedByUid) continue;
          await setDoc(doc(db, 'users', user.uid, 'friends', a.acceptedByUid), {
            uid: a.acceptedByUid,
            name: a.acceptedByName || 'Friend',
            email: a.acceptedByEmail || '',
            addedAt: new Date(),
          });
          await updateDoc(doc(db, 'accepted_friend_requests', d.id), { processed: true });
        }
      } catch {}
    })();

    return () => { friendsUnsub(); inboxUnsub(); reqUnsub(); convUnsub(); };
  }, []);

  const handleSearchUser = async () => {
    if (searchTerm.trim().length < 2) return;
    setIsSearching(true);
    try {
      const results = await searchUsers(searchTerm);
      setSearchResults(results);
      if (results.length === 0) showToast('No members found', 'error');
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
      setSearchResults(prev => prev.filter(r => r.uid !== toUser.uid));
    } catch {
      showToast('Could not send request', 'error');
    }
  };

  const handleAcceptRequest = async (req: FriendRequest) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      // Add sender to current user's friends. Doc ID = friend uid so
      // handleRemoveFriend's delete-by-uid actually finds the doc.
      await setDoc(doc(db, 'users', user.uid, 'friends', req.fromUid), {
        uid: req.fromUid,
        name: req.fromName,
        email: req.fromEmail,
        addedAt: new Date(),
      });

      // Tell the sender their request was accepted — their FriendsScreen
      // processes this on next visit and adds me to their own friends list.
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

  // Opening the inbox tab clears "new" state for everything visible — one batch,
  // one snapshot re-fire. (Keyboard/screen-reader safe: no click target needed.)
  useEffect(() => {
    if (activeTab !== 'inbox') return;
    const user = auth.currentUser;
    if (!user) return;
    const unseen = inboxItems.filter(i => !i.seen);
    if (unseen.length === 0) return;
    const batch = writeBatch(db);
    unseen.forEach(i => batch.update(doc(db, 'users', user.uid, 'friend_inbox', i.id), { seen: true }));
    batch.commit().catch(() => {});
  }, [activeTab, inboxItems]);

  const chatUnread = unreadConversations(conversations);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'circle', label: 'Circle' },
    { key: 'chats', label: 'Chats', count: chatUnread },
    { key: 'inbox', label: 'Inbox', count: unreadCount },
    { key: 'requests', label: 'Requests', count: requests.length },
  ];

  const me = auth.currentUser?.uid;

  const reactionTone = (active: boolean) =>
    active ? 'bg-ink border-ink text-ink-invert' : 'border-line text-ink-soft hover:border-line-strong';

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink pb-32">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-surface-0/90 backdrop-blur-xl border-b border-line px-6 pt-5 pb-0 pt-safe">
        <div className="flex items-end justify-between pb-4">
          <div>
            <Eyebrow className="mb-1.5">Your people</Eyebrow>
            <h1 className="font-display text-[28px] leading-none font-light">
              Style <em className="font-medium text-brand">circle.</em>
            </h1>
          </div>
          <Wordmark size="sm" className="opacity-40 pb-1" />
        </div>

        {/* Tabs — sliding underline */}
        <div className="flex gap-6" role="tablist">
          {tabs.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              className={`relative pb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${activeTab === t.key ? 'text-ink' : 'text-ink-faint'}`}
            >
              {t.label}
              {t.count ? <Badge variant={activeTab === t.key ? 'brand' : 'neutral'} size="sm">{t.count}</Badge> : null}
              {activeTab === t.key && (
                <motion.span layoutId="friends-tab-underline" className="absolute -bottom-px left-0 right-0 h-[2px] bg-ink" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pt-6">

        {/* ---- CIRCLE TAB ---- */}
        {activeTab === 'circle' && (
          <div>
            {/* Search members — name, @username, or email */}
            <div className="mb-7">
              <Eyebrow className="mb-3">Find people</Eyebrow>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); if (!e.target.value) setSearchResults([]); }}
                  onKeyDown={e => e.key === 'Enter' && handleSearchUser()}
                  placeholder="Name, @username, or email"
                  aria-label="Search members"
                  className="flex-1 bg-surface-1 border border-line rounded-full px-4 h-12 text-ink text-[14px] placeholder:text-ink-faint outline-none focus:border-ink transition-colors"
                />
                <button
                  onClick={handleSearchUser}
                  disabled={isSearching}
                  aria-label="Search"
                  className="bg-ink text-ink-invert h-12 w-12 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-[20px] ${isSearching ? 'animate-spin' : ''}`} aria-hidden="true">
                    {isSearching ? 'progress_activity' : 'search'}
                  </span>
                </button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mt-3 bg-surface-1 rounded-card border border-line divide-y divide-line overflow-hidden">
                  {searchResults.map(result => {
                    const alreadyFriend = friends.some(f => f.uid === result.uid);
                    return (
                      <div key={result.uid} className="flex items-center justify-between p-4">
                        <button
                          onClick={() => navigate(`/profile/${result.uid}`)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left active:opacity-70"
                          aria-label={`View @${result.username}'s profile`}
                        >
                          <div className="h-10 w-10 rounded-full border border-line flex items-center justify-center shrink-0 overflow-hidden">
                            {result.photoURL ? (
                              <img src={result.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="text-ink font-display font-medium">{result.displayName.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-ink font-semibold text-[14px] truncate">{result.displayName}</p>
                            <p className="text-ink-faint text-[12px] truncate">@{result.username}</p>
                          </div>
                        </button>
                        {alreadyFriend ? (
                          <Button size="sm" variant="outline" icon="chat_bubble" onClick={() => navigate(`/chat/${result.uid}`)}>Chat</Button>
                        ) : (
                          <Button size="sm" onClick={() => handleSendRequest({ uid: result.uid, name: result.displayName, email: '' })}>Add</Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Friends list */}
            {friends.length === 0 ? (
              <EmptyState icon="group" title="Your circle is empty" description="Search by name, @username, or email above to start sharing fits." />
            ) : (
              <div className="flex flex-col">
                <Eyebrow className="mb-3">{friends.length} in your circle</Eyebrow>
                {friends.map(friend => (
                  <div key={friend.uid} className="flex items-center gap-3 py-3.5 border-b border-line last:border-none">
                    <button
                      onClick={() => navigate(`/profile/${friend.uid}`)}
                      className="flex items-center gap-4 flex-1 min-w-0 text-left active:opacity-70"
                      aria-label={`View ${friend.name}'s profile`}
                    >
                      <div className="h-11 w-11 rounded-full border border-line flex items-center justify-center shrink-0">
                        <span className="text-ink font-display font-medium text-[16px]">{friend.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-ink font-medium text-[14px] truncate">{friend.name}</p>
                        <p className="text-ink-faint text-[12px] truncate">{friend.email}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => navigate(`/chat/${friend.uid}`)}
                      aria-label={`Message ${friend.name}`}
                      className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[17px]" aria-hidden="true">chat_bubble</span>
                    </button>
                    <button
                      onClick={() => handleRemoveFriend(friend.uid)}
                      aria-label={`Remove ${friend.name}`}
                      className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-faint active:scale-90 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[17px]" aria-hidden="true">person_remove</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- CHATS TAB ---- */}
        {activeTab === 'chats' && (
          <div>
            {conversations.length === 0 ? (
              <EmptyState
                icon="chat_bubble"
                title="No conversations yet"
                description="Message a friend from your circle — share fits, looks, and voice notes."
                action={<Button icon="group" onClick={() => setActiveTab('circle')}>Open your circle</Button>}
              />
            ) : (
              <div className="flex flex-col">
                {conversations.map(conv => {
                  const otherUid = conv.members.find(u => u !== me);
                  if (!otherUid) return null;
                  const info = conv.memberInfo?.[otherUid];
                  const lastAt = conv.lastMessage?.at?.toMillis?.();
                  const myRead = conv.lastRead?.[me || '']?.toMillis?.();
                  const unread = !!lastAt && conv.lastMessage?.from !== me && (!myRead || lastAt > myRead);
                  return (
                    <button
                      key={conv.id}
                      onClick={() => navigate(`/chat/${otherUid}`)}
                      className="flex items-center gap-4 py-3.5 border-b border-line last:border-none text-left active:opacity-70"
                    >
                      <div className="h-12 w-12 rounded-full border border-line flex items-center justify-center shrink-0 overflow-hidden">
                        {info?.photoURL ? (
                          <img src={info.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-ink font-display font-medium text-[17px]">{(info?.displayName || '?').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`text-[14px] truncate ${unread ? 'text-ink font-semibold' : 'text-ink font-medium'}`}>{info?.displayName || 'Member'}</p>
                          {lastAt ? (
                            <span className="text-ink-faint text-[10.5px] shrink-0">
                              {new Date(lastAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) === new Date().toLocaleDateString([], { day: 'numeric', month: 'short' })
                                ? new Date(lastAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                                : new Date(lastAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                            </span>
                          ) : null}
                        </div>
                        <p className={`text-[12.5px] truncate mt-0.5 ${unread ? 'text-ink font-medium' : 'text-ink-faint'}`}>
                          {conv.lastMessage?.from === me ? 'You: ' : ''}{conv.lastMessage?.text || 'Say hello'}
                        </p>
                      </div>
                      {unread && <span className="h-2.5 w-2.5 rounded-full bg-brand shrink-0" aria-label="Unread" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- INBOX TAB ---- */}
        {activeTab === 'inbox' && (
          <div>
            {inboxItems.length === 0 ? (
              <EmptyState icon="inbox" title="Nothing here yet" description="When friends send you fits, they'll appear here." />
            ) : (
              <div className="flex flex-col gap-4">
                {inboxItems.map(item => (
                  <div
                    key={item.id}
                    className={`rounded-card overflow-hidden border ${item.seen ? 'border-line' : 'border-brand/40'} bg-surface-1`}
                  >
                    {/* Product image */}
                    <div className="relative h-52 w-full">
                      <img src={item.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      {!item.seen && (
                        <div className="absolute top-3 left-3">
                          <Badge variant="brand" size="sm">New</Badge>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 p-4" style={{ background: 'linear-gradient(to top, rgba(15,12,8,0.85), transparent)' }}>
                        <p className="text-white/60 text-[9px] font-semibold uppercase tracking-[0.16em]">From {item.fromName}</p>
                        <p className="text-white font-display text-[18px] font-medium mt-0.5">{item.brand}</p>
                        <p className="text-white/75 text-[12px]">{item.title} · {item.price}</p>
                      </div>
                    </div>

                    {/* Reaction row */}
                    <div className="px-4 py-4">
                      <Eyebrow className="mb-3">Your take</Eyebrow>
                      <div className="grid grid-cols-3 gap-2.5">
                        <button onClick={() => handleReact(item.id, 'cop')} className={`py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] active:scale-95 border transition-[transform,border-color,background-color,color] ${reactionTone(item.reaction === 'cop')}`}>Cop it</button>
                        <button onClick={() => handleReact(item.id, 'maybe')} className={`py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] active:scale-95 border transition-[transform,border-color,background-color,color] ${reactionTone(item.reaction === 'maybe')}`}>Maybe</button>
                        <button onClick={() => handleReact(item.id, 'skip')} className={`py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] active:scale-95 border transition-[transform,border-color,background-color,color] ${reactionTone(item.reaction === 'skip')}`}>Skip</button>
                      </div>
                      {/* Check MY size button */}
                      <Button
                        variant="outline"
                        fullWidth
                        icon="straighten"
                        className="mt-3"
                        onClick={() => navigate('/add-product', { state: { prefill: { id: item.id, brand: item.brand, title: item.title, image: item.image, url: item.url, ...(item.category ? { category: item.category } : {}) } } })}
                      >
                        Check if this fits me
                      </Button>
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
              <EmptyState icon="person_add" title="No pending requests" description="Friend requests will show up here." />
            ) : (
              <div className="flex flex-col gap-3">
                {requests.map(req => (
                  <div key={req.id} className="bg-surface-1 rounded-card p-5 border border-line">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-11 w-11 rounded-full border border-line flex items-center justify-center shrink-0">
                        <span className="text-ink font-display font-medium text-[16px]">{req.fromName.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-ink font-semibold text-[14px] truncate">{req.fromName}</p>
                        <p className="text-ink-faint text-[12px] truncate">{req.fromEmail}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button fullWidth onClick={() => handleAcceptRequest(req)}>Accept</Button>
                      <Button variant="outline" onClick={() => handleDeclineRequest(req.id)}>Decline</Button>
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
