import React, { useState } from 'react';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useToast } from '../contexts/ToastContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { AppBar, Badge, Button, EmptyState, Modal, Spinner } from '../components/ui';

interface FitProfileCardItem {
  id: string;
  name: string;
  height: number;
  weight: number;
  isDefault: boolean;
  gender?: string;
  brand?: string;
  size?: string;
}

const ManageProfiles: React.FC = () => {
  const { navigate, goBack } = useAppNavigation();
  const { showToast } = useToast();
  const { userProfile, deleteFitProfile, isHydrated } = useUserProfile();

  const [deleteTarget, setDeleteTarget] = useState<FitProfileCardItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Extract profiles from userProfile state
  const rawProfiles = Array.isArray(userProfile.fitProfiles) ? userProfile.fitProfiles : [];
  const profilesList: FitProfileCardItem[] = rawProfiles.length > 0
    ? rawProfiles.map((p, index) => ({
        id: String(p.id || p.profileId || `profile-${index}`),
        name: String(p.profileName || p.name || `Profile ${index + 1}`),
        height: Number(p.height || 0),
        weight: Number(p.weight || 0),
        isDefault: Boolean(p.isPrimary || index === 0 || p.id === userProfile.selectedProfileId),
        gender: String(p.gender || ''),
        brand: String(p.preferredBrand || p.brand || ''),
        size: String(p.usualSize || p.baseSize || ''),
      }))
    : userProfile.profileName || userProfile.height > 0
      ? [{
          id: userProfile.profileId || 'primary-1',
          name: userProfile.profileName || 'My Main Profile',
          height: userProfile.height,
          weight: userProfile.weight,
          isDefault: true,
          gender: userProfile.gender,
          brand: userProfile.preferredBrand,
          size: userProfile.baseSize || userProfile.usualSize,
        }]
      : [];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFitProfile(deleteTarget.id);
      showToast('Deleted', 'success');
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      showToast('Failed to delete profile.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (!isHydrated) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col relative pb-28">
      <AppBar title="Manage Profiles" onBack={() => goBack('/settings')} />

      <div className="flex-1 px-6 pt-6 overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="eyebrow">Fit Profiles</p>
            <h1 className="font-display text-[26px] font-medium leading-tight">Your fit <em className="font-medium">cards.</em></h1>
          </div>
          <Button
            size="sm"
            icon="add"
            onClick={() => navigate('/fit-profile', { state: { mode: 'add' } })}
          >
            New Profile
          </Button>
        </div>

        {profilesList.length === 0 ? (
          <div className="py-16 text-center">
            <EmptyState
              icon="straighten"
              title="No fit profiles found"
              description="Create a fit profile to receive precision size recommendations and virtual try-ons."
              action={
                <Button
                  icon="add"
                  onClick={() => navigate('/fit-profile', { state: { mode: 'add' } })}
                  className="mt-4"
                >
                  Create Fit Profile
                </Button>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {profilesList.map((card) => (
              <div
                key={card.id}
                className="p-5 rounded-card border border-line bg-surface-1 flex flex-col gap-4 relative overflow-hidden transition-all shadow-sm hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3.5">
                    {/* Avatar */}
                    <div className="h-12 w-12 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center text-brand font-display font-medium text-[20px] shrink-0">
                      {card.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-ink text-[16px]">{card.name}</h3>
                        {card.isDefault && <Badge variant="brand" size="sm">Default</Badge>}
                      </div>
                      <p className="text-[12.5px] text-ink-faint mt-0.5">
                        {card.gender ? `${card.gender} · ` : ''}{card.brand ? `Ref: ${card.brand}` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-surface-2 p-3 rounded-2xl border border-line text-center">
                  <div>
                    <span className="eyebrow !text-[8px] block">Height</span>
                    <span className="text-[13px] font-semibold text-ink leading-tight mt-0.5 block">
                      {card.height > 0 ? `${card.height} cm` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow !text-[8px] block">Weight</span>
                    <span className="text-[13px] font-semibold text-ink leading-tight mt-0.5 block">
                      {card.weight > 0 ? `${card.weight} kg` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow !text-[8px] block">Size</span>
                    <span className="text-[13px] font-semibold text-ink leading-tight mt-0.5 block">
                      {card.size || '-'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-line/60">
                  <Button
                    variant="outline"
                    size="sm"
                    icon="edit"
                    onClick={() => navigate('/fit-profile', { state: { mode: 'edit', memberId: card.id } })}
                  >
                    Edit
                  </Button>
                  {!card.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="delete"
                      className="!text-danger"
                      onClick={() => setDeleteTarget(card)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete fit profile?"
        description={deleteTarget ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.` : undefined}
        actions={
          <>
            <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" fullWidth loading={deleting} onClick={handleDelete}>Yes, delete</Button>
          </>
        }
      />
    </div>
  );
};

export default ManageProfiles;
