import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const BottomNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { label: 'Home', icon: 'home', path: '/home' },
    { label: 'Wardrobe', icon: 'wardrobe', path: '/wardrobe' },
    { label: 'Stylist', icon: 'auto_awesome', path: '/stylist' },
    { label: 'Profile', icon: 'person', path: '/settings' },
  ];

  const isActive = (path: string) => location.pathname === path;

  // Only show on protected routes
  const protectedRoutes = ['/home', '/wardrobe', '/stylist', '/settings', '/add-product', '/recommendation', '/avatar', '/profile-setup'];
  if (!protectedRoutes.includes(location.pathname)) return null;

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50 flex items-center justify-around border-t border-line px-2 pb-[env(safe-area-inset-bottom)] pt-2"
      style={{ 
        backgroundColor: 'rgba(17, 17, 17, 0.95)',
        backdropFilter: 'blur(10px)',
        height: 'calc(64px + env(safe-area-inset-bottom))'
      }}
    >
      {navItems.map((item) => (
        <button
          key={item.path}
          onClick={() => navigate(item.path)}
          className="flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform"
          style={{ 
            width: '48px', 
            height: '48px',
            color: isActive(item.path) ? '#6157FF' : '#F5F0E8'
          }}
        >
          <span 
            className="material-symbols-outlined"
            style={{ 
              fontSize: '24px',
              fontVariationSettings: isActive(item.path) ? "'FILL' 1" : "'FILL' 0"
            }}
          >
            {item.icon}
          </span>
          <span className="text-[12px] font-medium tracking-tight" style={{ fontFamily: 'DM Sans, sans-serif' }}>
            {item.label}
          </span>
        </button>
      ))}
    </nav>
  );
};

export default BottomNav;
