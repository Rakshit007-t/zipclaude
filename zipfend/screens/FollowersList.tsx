import React, { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import {
  follow, unfollow, listFollowers, listFollowing, onFollowing,
} from '../services/social';
import { AppBar, Button, EmptyState, Input, SegmentedControl, Spinner } from '../components/ui';

interface UserRowItem {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string | null;
}

const FollowersList: React.FC = () => {
  const { uid: paramUid } = useParams<{ uid: string }>();
  const location = useLocation();
  const { navigate, goBack } = useAppNavigation();
  const { showToast } = useToast();

  const currentUser = auth.currentUser;
  const targetUid = paramUid || currentUser?.uid;
  const isMe = !paramUid || paramUid === currentUser?.uid;

  const initialTab = location.pathname.endsWith('/following') ? 'following' : 'followers';
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<UserRowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [busySet, setBusySet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!targetUid) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const loadUsers = async () => {
      setLoading(true);
      try {
        const profiles = activeTab === 'following'
          ? await listFollowing(targetUid)
          : await listFollowers(targetUid);
        if (cancelled) return;
        setUsers(profiles);
      } catch (e) {
        console.error('[FollowersList] Load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadUsers();
    const unsub = onFollowing(setFollowingSet);
    return () => { cancelled = true; unsub(); };
  }, [targetUid, activeTab, isMe]);

  const handleFollowToggle = async (targetUser: UserRowItem) => {
    if (busySet.has(targetUser.uid)) return;
    setBusySet(prev => new Set(prev).add(targetUser.uid));

    const isFollowing = followingSet.has(targetUser.uid);
    try {
      if (isFollowing) {
        await unfollow(targetUser.uid);
      } else {
        await follow({
          uid: targetUser.uid,
          displayName: targetUser.displayName,
          username: targetUser.username,
          photoURL: targetUser.photoURL,
        });
      }
    } catch {
      showToast('Could not update follow status.', 'error');
    } finally {
      setBusySet(prev => {
        const next = new Set(prev);
        next.delete(targetUser.uid);
        return next;
      });
    }
  };

  const filteredUsers = users.filter(u =>
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen min-h-dvh bg-surface-1 text-ink pb-28">
      <AppBar title={activeTab === 'followers' ? 'Followers' : 'Following'} onBack={() => goBack(targetUid ? `/profile/${targetUid}` : '/profile')} />

      {/* Segmented Tab Bar */}
      <div className="px-4 pt-4 pb-2">
        <SegmentedControl
          aria-label="Followers or Following"
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as any)}
          options={[
            { value: 'followers', label: 'Followers' },
            { value: 'following', label: 'Following' },
          ]}
        />
      </div>

      {/* Live Search */}
      <div className="px-4 pt-2 pb-4">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint text-[18px]">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or @username..."
            className="w-full bg-surface-2 rounded-lg pl-10 pr-4 h-10 text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* User List */}
      <div className="px-4">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-ink-faint">
            <Spinner size={28} />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16">
            <EmptyState
              icon="group"
              title={searchQuery ? 'No members found' : activeTab === 'followers' ? 'No followers yet' : 'Not following anyone'}
              description={searchQuery ? `No members matched "${searchQuery}"` : activeTab === 'followers' ? 'When people follow this profile, they will show up here.' : 'Explore looks and members to build your style network.'}
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredUsers.map(userItem => {
              const isFollowing = followingSet.has(userItem.uid);
              const isBusy = busySet.has(userItem.uid);

              return (
                <div
                  key={userItem.uid}
                  className="flex items-center justify-between py-2.5 active:opacity-70 transition-opacity"
                >
                  <button
                    onClick={() => navigate(`/profile/${userItem.uid}`)}
                    className="flex items-center gap-3.5 min-w-0 flex-1 text-left"
                  >
                    <div className="h-12 w-12 rounded-full overflow-hidden border border-line bg-surface-2 shrink-0">
                      {userItem.photoURL ? (
                        <img src={userItem.photoURL} alt={userItem.displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="font-display text-[18px] font-medium text-ink flex items-center justify-center h-full">
                          {userItem.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[14.5px] text-ink truncate">{userItem.displayName}</p>
                      <p className="text-[12px] text-ink-faint truncate">@{userItem.username}</p>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {userItem.uid !== currentUser?.uid && (
                      <Button
                        size="sm"
                        variant={isFollowing ? 'outline' : 'primary'}
                        loading={isBusy}
                        onClick={() => handleFollowToggle(userItem)}
                      >
                        {isFollowing ? 'Following' : 'Follow'}
                      </Button>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FollowersList;
