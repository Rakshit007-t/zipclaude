import React, { useState } from 'react';
import CommunityFeed from './CommunityFeed';
import FriendsScreen from './FriendsScreen';

/**
 * The Friends dock tab is the social hub: The Salon feed is the front door,
 * and your circle / chats / inbox / requests live one tap away. Reuses both
 * screens as-is — the feed is never duplicated. /community still serves the
 * standalone Salon for deep links and the Home strip.
 */
const SocialHub: React.FC = () => {
  const [tab, setTab] = useState<'salon' | 'people'>('salon');
  return tab === 'salon'
    ? <CommunityFeed inHub onShowPeople={() => setTab('people')} />
    : <FriendsScreen inHub onShowSalon={() => setTab('salon')} />;
};

export default SocialHub;
