import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { AppBar, Button, Eyebrow, Wordmark, Breadcrumbs, Divider } from '../components/ui';
import { useAppNavigation } from '../utils/useAppNavigation';

const QUICK_LINKS = [
  { icon: 'storefront', title: 'Marketplace', desc: 'Browse curated styles with true fit predictions', href: '/marketplace' },
  { icon: 'view_in_ar', title: 'Virtual Try-On', desc: 'Preview apparel on your own photo', href: '/fashion-studio' },
  { icon: 'help_outline', title: 'Atelier FAQs', desc: 'Answers about sizing, scans, and privacy', href: '/faqs' },
  { icon: 'info', title: 'About Us', desc: 'Our mission to eliminate sizing guesswork', href: '/about-us' },
];

const NotFound: React.FC = () => {
  const navigate = useNavigate();
  const { goBack } = useAppNavigation();

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar
        title="Page Not Found"
        headingTag="span"
        onBack={() => goBack('/home')}
      />

      <main className="flex-1 px-6 py-8 pb-28 max-w-xl mx-auto w-full">
        {/* Breadcrumb path */}
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'Error 404' },
          ]}
          className="mb-6"
        />

        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="pt-4"
        >
          <Eyebrow className="mb-3">Archive Disconnect · 404</Eyebrow>
          <h1 className="font-display text-[42px] leading-[1.05] font-light text-ink mb-4">
            Piece not <em className="font-medium text-brand">found.</em>
          </h1>
          <p className="text-ink-soft text-[15px] leading-relaxed max-w-[420px] mb-8">
            The garment silhouette, editorial drop, or route you requested does not exist in the atelier archive or has transitioned to another rack.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3 mb-10">
            <Button
              variant="accent"
              icon="home"
              onClick={() => navigate('/home')}
            >
              Return to Atelier
            </Button>
            <Button
              variant="outline"
              icon="storefront"
              onClick={() => navigate('/marketplace')}
            >
              Browse Marketplace
            </Button>
            <Button
              variant="ghost"
              icon="arrow_back"
              onClick={() => goBack('/home')}
            >
              Go Back
            </Button>
          </div>
        </motion.div>

        <Divider className="my-8" label="Explore the Atelier" />

        {/* Directory Links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_LINKS.map((link) => (
            <button
              key={link.title}
              type="button"
              onClick={() => navigate(link.href)}
              className="group flex items-start gap-4 p-4 rounded-card border border-line bg-surface-1 text-left transition-all hover:border-brand/40 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className="material-symbols-outlined text-brand text-[22px] mt-0.5 shrink-0 group-hover:scale-110 transition-transform" aria-hidden="true">
                {link.icon}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink group-hover:text-brand transition-colors">
                  {link.title}
                </p>
                <p className="text-[12px] text-ink-soft mt-0.5 line-clamp-2">
                  {link.desc}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer Brand Seal */}
        <div className="mt-14 pt-8 border-t border-line flex flex-col items-center text-center">
          <Wordmark size="sm" className="mb-2 opacity-80" />
          <p className="text-[11px] text-ink-faint">
            ZipRIGHT Technologies Private Limited · The Fit Atelier
          </p>
        </div>
      </main>
    </div>
  );
};

export default NotFound;
