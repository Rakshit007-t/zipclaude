import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { getAccessStatus } from '../../services/ziprightApi';
import { ScreenFallback } from '../ui';

type RequiredRole = 'admin' | 'seller';

interface ProtectedRouteProps {
  user: User | null;
  children: React.ReactElement;
}

const RoleProtectedRoute: React.FC<ProtectedRouteProps & { requiredRole: RequiredRole }> = ({
  user,
  children,
  requiredRole,
}) => {
  const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>('checking');

  useEffect(() => {
    let cancelled = false;
    if (!user || user.isAnonymous) {
      setAccess('denied');
      return;
    }

    setAccess('checking');
    void getAccessStatus()
      .then(status => {
        if (cancelled) return;
        const permitted = requiredRole === 'admin' ? status.is_admin : status.is_seller;
        setAccess(permitted ? 'allowed' : 'denied');
      })
      .catch(() => {
        if (!cancelled) setAccess('denied');
      });

    return () => {
      cancelled = true;
    };
  }, [requiredRole, user]);

  if (access === 'checking') {
    return <ScreenFallback />;
  }

  return access === 'allowed' ? children : <Navigate to="/home" replace />;
};

export const ProtectedAdminRoute: React.FC<ProtectedRouteProps> = props => (
  <RoleProtectedRoute {...props} requiredRole="admin" />
);

export const ProtectedSellerRoute: React.FC<ProtectedRouteProps> = props => (
  <RoleProtectedRoute {...props} requiredRole="seller" />
);
