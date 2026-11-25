import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarRange,
  Check,
  CloudRain,
  Copy,
  Flame,
  FolderKanban,
  Home,
  Lock,
  Plus,
  Sparkles,
  Undo2,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import type { DashboardData } from '../types';

interface Props {
  data: DashboardData;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onCreateTask: () => void;
  onCreateHabit: () => void;
  onOpenSettingsTab: (tab: 'general' | 'members' | 'reminders' | 'sheets') => void;
}

const TOTAL_STEPS = 5;

export function OnboardingModal({
  data,
  onClose,
  onRefresh,
  onToast,
  onCreateTask,
  onCreateHabit,
  onOpenSettingsTab,
}: Props) {
  const [step, setStep] = useState(0);
  const [installingPack, setInstallingPack] = useState(false);
  const [packInstalled, setPackInstalled] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const activeInvite = useMemo(() => {
    const now = Date.now();
    return data.invites.find(
      (inv) => !inv.usedBy && (!inv.expiresAt || new Date(inv.expiresAt).getTime() > now),
    );
  }, [data.invites]);

  const inviteUrl = activeInvite
    ? `${window.location.origin}/?invite=${encodeURIComponent(activeInvite.code)}`
    : '';

  async function handleInstallStarterPack() {
    setInstallingPack(true);
    try {
      const res = await api.installStarterPack();
      await onRefresh();
      setPackInstalled(true);
      onToast(
        res.createdCount > 0
          ? `Added ${res.createdCount} starter tasks & categories!`
          : 'Starter tasks are already in your household.',
      );
    } catch (err: any) {
      onToast(err.message || 'Could not add starter tasks.');
    } finally {
      setInstallingPack(false);
    }
  }

  async function handleCopyOrCreateInvite() {
    if (inviteUrl) {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setCopiedInvite(true);
        onToast('Copied household invite link!');
        setTimeout(() => setCopiedInvite(false), 2400);
      } catch {
        onToast(`Invite code: ${activeInvite?.code}`);
      }
      return;
    }
    setCreatingInvite(true);
    try {
      const res = await api.createInvite({ role: 'member' });
      await onRefresh();
      try {
        await navigator.clipboard.writeText(res.inviteUrl);
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 2400);
      } catch {
        // ignore clipboard error
      }
      onToast(`Created & copied invite link (${res.invite.code})!`);
    } catch (err: any) {
      onToast(err.message || 'Could not create invite link.');
    } finally {
      setCreatingInvite(false);
    }
  }

  const firstName = data.user.name.split(' ')[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card onboarding-modal" onClick={(e) => e.stopPropagation()}>
        {/* Top Progress Header */}
        <div className="onboarding-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="onboarding-badge">
              <Sparkles size={13} /> Quick Tour · Step {step + 1} of {TOTAL_STEPS}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Skip tour">
            <X size={17} />
          </button>
        </div>

        <div className="onboarding-dots" role="tablist" aria-label="Walkthrough steps">
          {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
            <button
              key={idx}
              type="button"
              className={`onboarding-dot ${idx === step ? 'active' : idx < step ? 'done' : ''}`}
              onClick={() => setStep(idx)}
              aria-label={`Go to step ${idx + 1}`}
            />
          ))}
        </div>

        {/* Step 1: Welcome + Starter Pack */}
        {step === 0 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-hero">
              <Home size={24} />
            </div>
            <h2>
              Welcome to Home Hub, {firstName}!
            </h2>
            <p className="onboarding-lead">
              <strong>{data.household.name}</strong> is ready. Here is how Home Hub keeps home life calm and organized without getting in your way:
            </p>

            <div className="onboarding-feature-grid">
              <div className="onboarding-feature-card">
                <Users size={18} style={{ color: 'var(--primary)' }} />
                <strong>Shared Household</strong>
                <span>Chores, bills, and seasonal upkeep everyone can see, claim, or rotate.</span>
              </div>
              <div className="onboarding-feature-card">
                <Lock size={18} style={{ color: 'var(--private)' }} />
                <strong>Private Personal Space</strong>
                <span>Personal errands &amp; daily habits visible only to you.</span>
              </div>
              <div className="onboarding-feature-card">
                <FolderKanban size={18} style={{ color: 'var(--info)' }} />
                <strong>Multi-Step Projects</strong>
                <span>Break big one-off goals into ordered steps with a Lead &amp; Target Date.</span>
              </div>
            </div>

            {data.tasks.length < 3 && (
              <div className="onboarding-callout">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    Want a quick head start?
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    Add 5 common starter items (Dishes, Trash, Vacuum, Monthly Bills, plus a Private Evening Habit) that you can edit or delete anytime.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={installingPack || packInstalled}
                  onClick={handleInstallStarterPack}
                >
                  {packInstalled ? (
                    <>
                      <Check size={14} /> Added!
                    </>
                  ) : installingPack ? (
                    'Adding...'
                  ) : (
                    <>
                      <Plus size={14} /> Add Starter Pack
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Daily Cockpit, Habits, Click-to-Update & Undo */}
        {step === 1 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-hero">
              <Zap size={24} />
            </div>
            <h2>Your Daily Cockpit</h2>
            <p className="onboarding-lead">
              Everything you need for today lives on one screen—no digging through menus.
            </p>

            <div className="onboarding-tips-list">
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon"><Zap size={16} /></span>
                <div>
                  <strong>Quick-Capture Bar ("Hey, I did this")</strong>
                  <p>Log an unplanned chore immediately as an Ad-Hoc record, or toss a rough idea into Inbox to fill details later.</p>
                </div>
              </div>
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon habit"><Flame size={16} /></span>
                <div>
                  <strong>Daily Habits Strip</strong>
                  <p>Personal routines (like skincare or stretching) stay separate from your to-do list, auto-skip if missed, and show your 7-day consistency &amp; streak.</p>
                </div>
              </div>
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon info"><Sparkles size={16} /></span>
                <div>
                  <strong>Click Any Task for Details &amp; Status</strong>
                  <p>Click any task title to see notes &amp; sub-tasks and switch status between <em>Not Started</em>, <em>Started</em>, <em>On Hold</em>, <em>Gated</em>, or <em>Completed</em>.</p>
                </div>
              </div>
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon"><Undo2 size={16} /></span>
                <div>
                  <strong>Instant Undo (⌘Z / Ctrl+Z)</strong>
                  <p>Clicked the wrong button or deleted something by accident? Hit <strong>Undo</strong> in the toast banner or sidebar—up to 25 steps back.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Horizons, Projects & Tasks Tree */}
        {step === 2 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-hero">
              <CalendarRange size={24} />
            </div>
            <h2>Plan Ahead Without Stress</h2>
            <p className="onboarding-lead">
              Home Hub handles both strict due dates and flexible "anytime this month or season" windows.
            </p>

            <div className="onboarding-tips-list">
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon"><CalendarRange size={16} /></span>
                <div>
                  <strong>Horizons Planner</strong>
                  <p>Switch between Weekly, Monthly, Quarterly, Seasonal &amp; Weather, and Yearly views—in List or Grid layout.</p>
                </div>
              </div>
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon info"><FolderKanban size={16} /></span>
                <div>
                  <strong>Projects with Drag-and-Drop Steps</strong>
                  <p>Assign a Project Lead, set a Target Date, and drag tasks to reorder or nest sub-tasks. Tasks inherit the project's category by default.</p>
                </div>
              </div>
              <div className="onboarding-tip">
                <span className="onboarding-tip-icon"><CloudRain size={16} /></span>
                <div>
                  <strong>Weather-Smart Alerts</strong>
                  <p>Tie outdoor chores (like covering patio furniture or winterizing faucets) to rain, freeze, snow, or heat forecasts.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Invite Household Members */}
        {step === 3 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-hero">
              <UserPlus size={24} />
            </div>
            <h2>Invite Your Household</h2>
            <p className="onboarding-lead">
              Partners, roommates, and kids each get their own sign-in—and their own private personal space.
            </p>

            <div className="onboarding-callout" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    Shareable Household Invite Link
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {activeInvite
                      ? `Active code: ${activeInvite.code} — anyone with this link can join ${data.household.name}.`
                      : 'Generate an invite link to text or email to your household.'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={creatingInvite}
                  onClick={handleCopyOrCreateInvite}
                >
                  {copiedInvite ? (
                    <>
                      <Check size={14} /> Copied!
                    </>
                  ) : inviteUrl ? (
                    <>
                      <Copy size={14} /> Copy Invite Link
                    </>
                  ) : creatingInvite ? (
                    'Creating...'
                  ) : (
                    <>
                      <Plus size={14} /> Generate Invite Link
                    </>
                  )}
                </button>
              </div>
              {inviteUrl && (
                <div className="onboarding-link-preview">{inviteUrl}</div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, fontSize: '0.84rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span>Have kids without email addresses? You can also add members directly.</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onClose();
                  onOpenSettingsTab('members');
                }}
              >
                Manage Members
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Optional Extras & Ready */}
        {step === 4 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-hero">
              <Bell size={24} />
            </div>
            <h2>You’re All Set!</h2>
            <p className="onboarding-lead">
              A few optional settings you can turn on anytime under <strong>Settings &amp; Sheets</strong>:
            </p>

            <div className="onboarding-feature-grid">
              <div className="onboarding-feature-card">
                <CloudRain size={18} style={{ color: 'var(--info)' }} />
                <strong>Local Weather</strong>
                <span>Set your city &amp; coordinates for live 10-day outdoor alerts.</span>
              </div>
              <div className="onboarding-feature-card">
                <Bell size={18} style={{ color: 'var(--primary)' }} />
                <strong>Daily Digests</strong>
                <span>Get morning summaries via Email, free ntfy.sh push, or chat webhook.</span>
              </div>
              <div className="onboarding-feature-card">
                <Sparkles size={18} style={{ color: 'var(--accent)' }} />
                <strong>Opt-in Fairness</strong>
                <span>Effort weights &amp; workload balancing are off by default—toggle on per user.</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onClose();
                  onCreateTask();
                }}
              >
                <Plus size={14} /> Create First Task
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onClose();
                  onCreateHabit();
                }}
              >
                <Flame size={14} /> Add First Habit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  onClose();
                  onOpenSettingsTab('general');
                }}
              >
                Configure Weather &amp; Preferences
              </button>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="onboarding-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Skip Tour
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft size={15} /> Back
              </button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Start Using Home Hub <Check size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
