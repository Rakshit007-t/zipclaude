import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyPageSEO } from '../services/seo';

/**
 * SEOManager component
 * Mounted inside Router to listen to pathname changes and update page title,
 * meta description, canonical link, and social tags reactively.
 */
export const SEOManager: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    applyPageSEO(location.pathname);
  }, [location.pathname]);

  return null;
};

export default SEOManager;
