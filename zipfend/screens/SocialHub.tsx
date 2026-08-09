import React, { useState } from 'react';
import CommunityFeed from './CommunityFeed';
import FriendsScreen from './FriendsScreen';

/**
 * The Friends dock tab is the social hub: the people hub is the front door,
 * so friends and chats are immediately available; The Salon stays one tab away. Reuses both
 * screens as-is — the feed is never duplicated. /community still serves the
 * standalone Salon for deep links and the Home strip.
 */
const SocialHub: React.FC = () => {
  const [tab, setTab] = useState<'salon' | 'people'>('people');
  return tab === 'salon'
    ? <CommunityFeed inHub onShowPeople={() => setTab('people')} />
    : <FriendsScreen inHub onShowSalon={() => setTab('salon')} />;
};

export default SocialHub;
