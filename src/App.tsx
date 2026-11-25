import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarRange,
  FolderKanban,
  FolderTree,
  HelpCircle,
  History,
  Home,
  LogOut,
  Redo2,
  RotateCcw,
  Settings,
  Sparkles,
  Undo2,
  Zap,
} from 'lucide-react';
import { api } from './api';
import {
  isLocalDemoMode,
  resetLocalDemoState,
  setLocalDemoMode,
  switchLocalDemoMember,
} from './demoEngine';
import { ActivityLogView } from './components/ActivityLogView';
import { AdHocEditModal } from './components/AdHocEditModal';
import { AuthScreen } from './components/AuthScreen';
import { CockpitView } from './components/CockpitView';
import { HorizonsView } from './components/HorizonsView';
import { OnboardingModal } from './components/OnboardingModal';
import { ProjectsView } from './components/ProjectsView';
import { SettingsView } from './components/SettingsView';
import type { ActiveStatus } from './components/StatusNotePopover';
import { TaskDetailModal, type DetailTarget } from './components/TaskDetailModal';
import { TaskModal } from './components/TaskModal';
import { TasksTreeView } from './components/TasksTreeView';
import type { DashboardData, DemoMember, StorageStatus, Task, TaskInstance } from './types';

type ViewKey = 'cockpit' | 'horizons' | 'projects' | 'tasks' | 'activity' | 'settings';

let trackedInitialPageView = false;

export default function App() {
  const [booting, setBooting] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [demoMembers, setDemoMembers] = useState<DemoMember[]>([]);
  const [registrationCodeRequired, setRegistrationCodeRequired] = useState(false);
  const [publicStorage, setPublicStorage] = useState<StorageStatus | null>(null);
  const [initialInviteCode, setInitialInviteCode] = useState<string | undefined>(undefined);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [localDemo, setLocalDemo] = useState(() => isLocalDemoMode());

  const [view, setView] = useState<ViewKey>('cockpit');
  const [settingsSubTab, setSettingsSubTab] = useState<
    'general' | 'members' | 'reminders' | 'sheets' | 'agent_api' | 'fairness' | 'site_admin'
  >('general');
  const [busy, setBusy] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingAdHoc, setEditingAdHoc] = useState<TaskInstance | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | undefined>(undefined);
  const [defaultProjectId, setDefaultProjectId] = useState<string | undefined>(undefined);
  const [defaultParentTaskId, setDefaultParentTaskId] = useState<string | undefined>(undefined);
  const [defaultIsHabit, setDefaultIsHabit] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    kind: 'normal' | 'undid' | 'redid' | 'info';
  } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const showToast = useCallback(
    (message: string, kind: 'normal' | 'undid' | 'redid' | 'info' = 'normal') =>
      setToast({ message, kind }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const ms = toast.kind === 'info' ? 3600 : 6000;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast]);

  const loadDashboard = useCallback(async () => {
    const data = await api.dashboard();
    setDashboard(data);
    setPublicStorage(data.storage.shared);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoBusy) return;
    setUndoBusy(true);
    try {
      const res = await api.undo();
      await loadDashboard();
      showToast(`Undid: ${res.restoredLabel}`, 'undid');
    } catch (err: any) {
      showToast(err.message || 'Nothing to undo.', 'info');
    } finally {
      setUndoBusy(false);
    }
  }, [undoBusy, loadDashboard, showToast]);

  const handleRedo = useCallback(async () => {
    if (undoBusy) return;
    setUndoBusy(true);
    try {
      const res = await api.redo();
      await loadDashboard();
      showToast(`Redid: ${res.restoredLabel}`, 'redid');
    } catch (err: any) {
      showToast(err.message || 'Nothing to redo.', 'info');
    } finally {
      setUndoBusy(false);
    }
  }, [undoBusy, loadDashboard, showToast]);

  // Global Cmd+Z / Ctrl+Z (Undo) and Cmd+Shift+Z / Ctrl+Y (Redo) outside text fields
  useEffect(() => {
    if (!dashboard) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (dashboard?.undo?.canUndo) {
          e.preventDefault();
          handleUndo();
        }
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
        if (dashboard?.undo?.canRedo) {
          e.preventDefault();
          handleRedo();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dashboard, handleUndo, handleRedo]);

  useEffect(() => {
    async function init() {
      try {
        if (!trackedInitialPageView) {
          trackedInitialPageView = true;
          void api.trackVisit('page_view');
        }
        const params = new URLSearchParams(window.location.search);
        const magic = params.get('magic');
        const invite = params.get('invite');
        const wantsDemo = params.get('demo') === '1' || params.get('demo') === 'true';
        if (invite) setInitialInviteCode(invite);
        if (wantsDemo || isLocalDemoMode()) {
          if (wantsDemo) void api.trackVisit('demo_launch');
          setLocalDemoMode(true);
          setLocalDemo(true);
          await loadDashboard();
          return;
        }
        if (magic) {
          try {
            await api.verifyMagicLink(magic);
            window.history.replaceState({}, '', window.location.pathname);
            showToast('Signed in via magic link!');
          } catch (err: any) {
            showToast(err.message || 'Magic link invalid.');
          }
        }
        const me = await api.me();
        setDemoMembers(me.demoMembers || []);
        setRegistrationCodeRequired(Boolean(me.registrationCodeRequired));
        setPublicStorage(me.storage);
        if (me.user) await loadDashboard();
      } catch (err: any) {
        showToast(err.message || 'Could not reach Home Hub server.');
      } finally {
        setBooting(false);
      }
    }
    init();
  }, [loadDashboard, showToast]);

  async function handleAuthenticated(opts?: { isNewUser?: boolean }) {
    window.history.replaceState({}, '', window.location.pathname);
    setInitialInviteCode(undefined);
    await loadDashboard();
    if (opts?.isNewUser) {
      setOnboardingOpen(true);
    }
  }

  function closeOnboarding() {
    setOnboardingOpen(false);
    if (dashboard?.user?.id) {
      try {
        window.localStorage.setItem(`homehub_onboarded_${dashboard.user.id}`, '1');
      } catch {
        // ignore
      }
    }
  }

  async function handleStartBrowserDemo() {
    void api.trackVisit('demo_launch');
    setLocalDemoMode(true);
    setLocalDemo(true);
    await loadDashboard();
    showToast('Entered Interactive Demo — all changes stay locally in your browser.', 'info');
  }

  async function handleExitBrowserDemo() {
    setLocalDemoMode(false);
    setLocalDemo(false);
    setDashboard(null);
    setOnboardingOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has('demo')) {
      params.delete('demo');
      const next = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    }
    const me = await api.me();
    setDemoMembers(me.demoMembers || []);
    setRegistrationCodeRequired(Boolean(me.registrationCodeRequired));
    setPublicStorage(me.storage);
  }

  async function handleResetBrowserDemo() {
    resetLocalDemoState();
    await loadDashboard();
    showToast('Reset demo household back to sample data.', 'info');
  }

  async function handleSwitchBrowserDemoMember(memberId: string) {
    switchLocalDemoMember(memberId);
    await loadDashboard();
    const picked = dashboard?.members.find((m) => m.id === memberId);
    if (picked) showToast(`Now viewing demo as ${picked.name}.`, 'info');
  }

  async function handleLogout() {
    if (localDemo) {
      await handleExitBrowserDemo();
      return;
    }
    await api.logout();
    setDashboard(null);
    setOnboardingOpen(false);
    const me = await api.me();
    setDemoMembers(me.demoMembers || []);
    setRegistrationCodeRequired(Boolean(me.registrationCodeRequired));
    setPublicStorage(me.storage);
  }

  async function handleQuickLog(
    text: string,
    mode: 'complete_now' | 'add_inbox',
    visibility: 'household' | 'private',
  ) {
    await api.quickLog({ text, mode, visibility });
    await loadDashboard();
    showToast(
      mode === 'complete_now'
        ? `Logged "${text}" as done! You can fill details later.`
        : `Captured "${text}" in Inbox (Needs Details).`,
    );
  }

  async function handleLogAdHoc(payload: {
    title: string;
    categoryId?: string;
    visibility: 'household' | 'private';
    date?: string;
    notes?: string;
  }) {
    const res = await api.logAdHoc(payload);
    await loadDashboard();
    showToast(`Recorded "${res.instance.taskTitle}" (${res.instance.dueDate}).`);
  }

  async function handleQuickCompleteFavorite(taskId: string) {
    setBusy(true);
    try {
      const res = await api.quickCompleteTask(taskId);
      await loadDashboard();
      showToast(`Completed "${res.instance.taskTitle}"!`);
    } catch (err: any) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTask(
    payload: Partial<Omit<Task, 'eligibleMemberIds'>> & {
      eligibleMemberIds?: string[];
      firstDueDate?: string;
    },
  ) {
    if (editingTask) {
      await api.updateTask(editingTask.id, payload);
      showToast(`Updated "${payload.title}"`);
    } else {
      const res = await api.createTask(payload);
      showToast(`Created "${res.task.title}"`);
    }
    await loadDashboard();
  }

  async function handleCompleteInstance(id: string, completed?: boolean) {
    try {
      const res = await api.completeInstance(id, completed);
      await loadDashboard();
      if (res.instance.status === 'completed') {
        showToast(
          res.nextInstance
            ? `Done! Next cycle scheduled for ${res.nextInstance.dueDate}.`
            : `Completed "${res.instance.taskTitle}"!`,
        );
      }
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleClaimInstance(id: string, unclaim = false) {
    try {
      const res = await api.claimInstance(id, unclaim);
      await loadDashboard();
      showToast(unclaim ? 'Set back to Anyone.' : `Claimed "${res.instance.taskTitle}"!`);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleSkipInstance(id: string) {
    try {
      await api.skipInstance(id);
      await loadDashboard();
      showToast('Skipped this occurrence.');
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleDeferInstance(id: string, payload: { days?: number; untilDate?: string }) {
    try {
      const res = await api.deferInstance(id, payload);
      await loadDashboard();
      showToast(`Deferred "${res.instance.taskTitle}" to ${res.instance.dueDate}.`);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleUpdateInstanceStatus(
    id: string,
    payload: { status: ActiveStatus; notes: string; dueDate?: string },
  ) {
    try {
      const res = await api.updateInstance(id, payload);
      await loadDashboard();
      const label =
        payload.status === 'started'
          ? 'Started'
          : payload.status === 'on_hold'
            ? 'On Hold'
            : payload.status === 'gated'
              ? 'Gated'
              : 'Not Started';
      showToast(`Updated "${res.instance.taskTitle}" (${label}).`);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleReassign(id: string, assigneeId: string) {
    try {
      await api.updateInstance(id, { assigneeId });
      await loadDashboard();
      showToast(assigneeId ? 'Updated assignee.' : 'Assigned to Anyone.');
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleDeleteInstance(id: string) {
    await api.deleteInstance(id);
    await loadDashboard();
    showToast('Removed occurrence.');
  }

  async function handleGenerateSchedule() {
    setBusy(true);
    try {
      const res = await api.generateSchedule(14);
      await loadDashboard();
      showToast(
        res.createdCount > 0
          ? `Scheduled ${res.createdCount} upcoming task(s)!`
          : 'Next 14 days are already up to date.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (booting) {
    return (
      <div className="auth-page">
        <div className="card" style={{ padding: '28px 36px', textAlign: 'center' }}>
          <h2 style={{ marginBottom: 6 }}>Home Hub</h2>
          <p style={{ color: 'var(--text-muted)' }}>Loading your federated sheets...</p>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <>
        <AuthScreen
          initialInviteCode={initialInviteCode}
          demoMembers={demoMembers}
          registrationCodeRequired={registrationCodeRequired}
          storage={publicStorage}
          onAuthenticated={handleAuthenticated}
          onStartBrowserDemo={handleStartBrowserDemo}
        />
        {toast && <div className="toast">{toast.message}</div>}
      </>
    );
  }

  const isEligibleForUser = (inst: TaskInstance) => {
    if (inst.visibility === 'private') return inst.ownerId === dashboard.user.id;
    if (inst.assigneeId) return inst.assigneeId === dashboard.user.id;
    if (!inst.eligibleMemberIds) return true;
    return inst.eligibleMemberIds.split(',').includes(dashboard.user.id);
  };

  const myOverdueCount = dashboard.instances.filter(
    (i) =>
      (i.status === 'pending' || i.status === 'started') &&
      (i.windowEndDate || i.dueDate) < dashboard.todayStr &&
      isEligibleForUser(i),
  ).length;

  const urgentWeatherCount = dashboard.weather.alerts.filter((a) => a.urgency === 'urgent').length;
  const urgentCount = urgentWeatherCount + myOverdueCount;
  const urgentTooltipParts: string[] = [];
  if (urgentWeatherCount > 0) {
    urgentTooltipParts.push(`${urgentWeatherCount} urgent weather alert${urgentWeatherCount === 1 ? '' : 's'}`);
  }
  if (myOverdueCount > 0) {
    urgentTooltipParts.push(`${myOverdueCount} overdue task${myOverdueCount === 1 ? '' : 's'}`);
  }
  const urgentTooltip = urgentTooltipParts.join(' · ');

  const activeProjectCount = dashboard.projects.filter((p) => p.status !== 'completed').length;
  const unreadNotifs = dashboard.notifications.filter(
    (n) => n.memberId === dashboard.user.id && !n.readAt,
  ).length;

  const navItems: Array<{
    key: ViewKey;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    badge?: number;
    badgeTone?: 'accent' | 'subtle';
    badgeTitle?: string;
  }> = [
    {
      key: 'cockpit',
      label: 'Daily Cockpit',
      shortLabel: 'Cockpit',
      icon: <Zap size={18} />,
      badge: urgentCount || undefined,
      badgeTone: 'accent',
      badgeTitle: urgentTooltip || undefined,
    },
    {
      key: 'horizons',
      label: 'Horizons',
      shortLabel: 'Horizons',
      icon: <CalendarRange size={18} />,
    },
    {
      key: 'projects',
      label: 'Projects',
      shortLabel: 'Projects',
      icon: <FolderKanban size={18} />,
      badge: activeProjectCount || undefined,
      badgeTone: 'subtle',
      badgeTitle: activeProjectCount ? `${activeProjectCount} active project${activeProjectCount === 1 ? '' : 's'}` : undefined,
    },
    {
      key: 'tasks',
      label: 'Tasks Tree',
      shortLabel: 'Tasks',
      icon: <FolderTree size={18} />,
      badge: dashboard.tasks.length || undefined,
      badgeTone: 'subtle',
      badgeTitle: dashboard.tasks.length ? `${dashboard.tasks.length} total task${dashboard.tasks.length === 1 ? '' : 's'}` : undefined,
    },
    {
      key: 'activity',
      label: 'Activity Log',
      shortLabel: 'Log',
      icon: <History size={18} />,
    },
    {
      key: 'settings',
      label: 'Settings & Sheets',
      shortLabel: 'Settings',
      icon: <Settings size={18} />,
      badge: unreadNotifs || undefined,
      badgeTone: 'accent',
      badgeTitle: unreadNotifs ? `${unreadNotifs} unread reminder${unreadNotifs === 1 ? '' : 's'}` : undefined,
    },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Home size={20} />
          </div>
          <div>
            <div className="brand-title">Home Hub</div>
            <div className="brand-sub">{dashboard.household.name}</div>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${view === item.key ? 'active' : ''}`}
              onClick={() => {
                if (item.key === 'settings') {
                  setSettingsSubTab(unreadNotifs > 0 ? 'reminders' : 'general');
                }
                setView(item.key);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`nav-badge ${item.badgeTone === 'subtle' ? 'subtle' : ''}`}
                  title={item.badgeTitle}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="undo-bar">
            <button
              type="button"
              className="undo-bar-btn"
              disabled={undoBusy || !dashboard.undo?.canUndo}
              onClick={handleUndo}
              title={
                dashboard.undo?.canUndo
                  ? `Undo: ${dashboard.undo.lastActionLabel} (⌘Z)`
                  : 'Nothing to undo (⌘Z)'
              }
            >
              <Undo2 size={14} />
              <span>Undo</span>
              {dashboard.undo && dashboard.undo.undoCount > 1 && (
                <span className="undo-count">{dashboard.undo.undoCount}</span>
              )}
            </button>
            <button
              type="button"
              className="undo-bar-btn redo"
              disabled={undoBusy || !dashboard.undo?.canRedo}
              onClick={handleRedo}
              title={
                dashboard.undo?.canRedo
                  ? `Redo: ${dashboard.undo.redoActionLabel} (⇧⌘Z)`
                  : 'Nothing to redo (⇧⌘Z)'
              }
              aria-label="Redo"
            >
              <Redo2 size={14} />
            </button>
            <button
              type="button"
              className="undo-bar-btn redo"
              onClick={() => setOnboardingOpen(true)}
              title="Open 1-minute Quick Tour"
              aria-label="Quick Tour"
            >
              <HelpCircle size={14} />
            </button>
          </div>

          <button
            type="button"
            className="sheet-pill"
            onClick={() => {
              setSettingsSubTab('sheets');
              setView('settings');
            }}
          >
            <span className={`status-dot ${dashboard.storage.shared.connected ? 'connected' : 'local'}`} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {localDemo
                ? 'Browser Sandbox Demo'
                : dashboard.storage.shared.mode === 'postgres'
                  ? 'PostgreSQL Connected'
                  : dashboard.storage.shared.connected
                    ? 'Sheets Connected'
                    : 'Federated Local Mirror'}
            </span>
          </button>

          <div className="user-chip">
            <span className="avatar" style={{ background: dashboard.user.avatarColor }}>
              {dashboard.user.name.charAt(0)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {dashboard.user.name}
              </div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                {dashboard.user.memberGroup} &middot; {dashboard.user.role}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={handleLogout} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        {localDemo && (
          <div className="demo-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Sparkles size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <strong>Interactive Demo</strong>
              <span style={{ color: 'var(--text-muted)' }}>
                Changes stay locally in your browser—no account needed.
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Viewing as:
                <select
                  className="inline-select"
                  value={dashboard.user.id}
                  onChange={(e) => handleSwitchBrowserDemoMember(e.target.value)}
                >
                  {dashboard.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name.split(' ')[0]} ({m.memberGroup})
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetBrowserDemo}>
                <RotateCcw size={13} /> Reset Demo
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleExitBrowserDemo}>
                Exit to Sign In
              </button>
            </div>
          </div>
        )}

        {view === 'cockpit' && (
          <CockpitView
            data={dashboard}
            busy={busy}
            onQuickLog={handleQuickLog}
            onLogAdHoc={handleLogAdHoc}
            onQuickCompleteFavorite={handleQuickCompleteFavorite}
            onCompleteInstance={handleCompleteInstance}
            onClaimInstance={handleClaimInstance}
            onSkipInstance={handleSkipInstance}
            onDeferInstance={handleDeferInstance}
            onUpdateInstanceStatus={handleUpdateInstanceStatus}
            onAddTask={() => {
              setEditingTask(null);
              setDefaultCategoryId(undefined);
              setDefaultProjectId(undefined);
              setDefaultParentTaskId(undefined);
              setDefaultIsHabit(false);
              setTaskModalOpen(true);
            }}
            onAddHabit={() => {
              setEditingTask(null);
              setDefaultCategoryId(undefined);
              setDefaultProjectId(undefined);
              setDefaultParentTaskId(undefined);
              setDefaultIsHabit(true);
              setTaskModalOpen(true);
            }}
            onEditTask={(t) => {
              setEditingTask(t);
              setDefaultCategoryId(undefined);
              setDefaultIsHabit(false);
              setTaskModalOpen(true);
            }}
            onEditAdHoc={(inst) => setEditingAdHoc(inst)}
            onOpenDetail={(target) => setDetailTarget(target)}
            onCategoryCreated={loadDashboard}
            onOpenProjects={() => setView('projects')}
          />
        )}

        {view === 'horizons' && (
          <HorizonsView
            data={dashboard}
            busy={busy}
            onGenerateSchedule={handleGenerateSchedule}
            onAddTask={() => {
              setEditingTask(null);
              setDefaultCategoryId(undefined);
              setDefaultProjectId(undefined);
              setDefaultParentTaskId(undefined);
              setTaskModalOpen(true);
            }}
            onEditTask={(t) => {
              setEditingTask(t);
              setDefaultCategoryId(undefined);
              setDefaultProjectId(undefined);
              setDefaultParentTaskId(undefined);
              setTaskModalOpen(true);
            }}
            onEditAdHoc={(inst) => setEditingAdHoc(inst)}
            onOpenDetail={(target) => setDetailTarget(target)}
            onComplete={handleCompleteInstance}
            onClaim={handleClaimInstance}
            onSkip={handleSkipInstance}
            onDefer={handleDeferInstance}
            onUpdateStatus={handleUpdateInstanceStatus}
            onReassign={handleReassign}
            onDelete={handleDeleteInstance}
          />
        )}

        {view === 'projects' && (
          <ProjectsView
            data={dashboard}
            onRefresh={loadDashboard}
            onToast={showToast}
            onCompleteInstance={handleCompleteInstance}
            onClaimInstance={handleClaimInstance}
            onDeferInstance={handleDeferInstance}
            onUpdateInstanceStatus={handleUpdateInstanceStatus}
            onOpenDetail={(target) => setDetailTarget(target)}
            onEditTask={(t) => {
              setEditingTask(t);
              setDefaultCategoryId(undefined);
              setDefaultProjectId(undefined);
              setDefaultParentTaskId(undefined);
              setTaskModalOpen(true);
            }}
            onDeleteTask={async (id) => {
              await api.deleteTask(id);
              await loadDashboard();
              showToast('Deleted task.');
            }}
            onAddProjectTaskModal={(projectId, parentTaskId, categoryId) => {
              setEditingTask(null);
              setDefaultProjectId(projectId);
              setDefaultParentTaskId(parentTaskId);
              setDefaultCategoryId(categoryId);
              setTaskModalOpen(true);
            }}
          />
        )}

        {view === 'tasks' && (
          <TasksTreeView
            data={dashboard}
            onAddTask={(catId) => {
              setEditingTask(null);
              setDefaultCategoryId(catId);
              setTaskModalOpen(true);
            }}
            onOpenDetail={(target) => setDetailTarget(target)}
            onEditTask={(t) => {
              setEditingTask(t);
              setDefaultCategoryId(undefined);
              setTaskModalOpen(true);
            }}
            onToggleFavorite={async (t) => {
              await api.updateTask(t.id, { isFavorite: !t.isFavorite });
              await loadDashboard();
            }}
            onToggleActive={async (t) => {
              await api.updateTask(t.id, { active: !t.active });
              await loadDashboard();
            }}
            onDeleteTask={async (id) => {
              await api.deleteTask(id);
              await loadDashboard();
              showToast('Deleted task.');
            }}
            onRefresh={loadDashboard}
            onToast={showToast}
          />
        )}

        {view === 'activity' && (
          <ActivityLogView
            data={dashboard}
            onOpenDetail={(target) => setDetailTarget(target)}
            onEditAdHoc={(inst) => setEditingAdHoc(inst)}
            onEditTask={(t) => {
              setEditingTask(t);
              setDefaultCategoryId(undefined);
              setDefaultProjectId(undefined);
              setDefaultParentTaskId(undefined);
              setTaskModalOpen(true);
            }}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            data={dashboard}
            initialSubTab={settingsSubTab}
            onRefresh={loadDashboard}
            onToast={showToast}
          />
        )}
      </main>

      <nav className="mobile-nav" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={view === item.key ? 'active' : ''}
            onClick={() => setView(item.key)}
          >
            {item.icon}
            <span>{item.shortLabel}</span>
          </button>
        ))}
      </nav>

      {taskModalOpen && (() => {
        const activeOpenInst = editingTask
          ? dashboard.instances
              .filter(
                (i) =>
                  i.taskId === editingTask.id &&
                  (i.status === 'pending' ||
                    i.status === 'started' ||
                    i.status === 'on_hold' ||
                    i.status === 'gated'),
              )
              .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0]
          : undefined;
        return (
          <TaskModal
            task={editingTask}
            defaultCategoryId={defaultCategoryId}
            defaultProjectId={defaultProjectId}
            defaultParentTaskId={defaultParentTaskId}
            defaultIsHabit={defaultIsHabit}
            activeDueDate={activeOpenInst?.dueDate}
            activeWindowEndDate={activeOpenInst?.windowEndDate}
          categories={dashboard.categories}
          projects={dashboard.projects}
          allTasks={dashboard.tasks}
          members={dashboard.members}
          currentUser={dashboard.user}
          weatherTriggers={dashboard.weather.triggers}
          todayStr={dashboard.todayStr}
          onClose={() => {
            setTaskModalOpen(false);
            setEditingTask(null);
            setDefaultCategoryId(undefined);
            setDefaultProjectId(undefined);
            setDefaultParentTaskId(undefined);
            setDefaultIsHabit(false);
          }}
          onCategoryCreated={async () => {
            await loadDashboard();
          }}
          onSave={handleSaveTask}
        />
        );
      })()}

      {detailTarget && (
        <TaskDetailModal
          data={dashboard}
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
          onSelectTarget={(next) => setDetailTarget(next)}
          onEditTask={(t) => {
            setEditingTask(t);
            setDefaultCategoryId(undefined);
            setDefaultProjectId(undefined);
            setDefaultParentTaskId(undefined);
            setDefaultIsHabit(false);
            setTaskModalOpen(true);
          }}
          onEditAdHoc={(inst) => setEditingAdHoc(inst)}
          onOpenProjects={() => setView('projects')}
          onRefresh={loadDashboard}
          onToast={showToast}
        />
      )}

      {onboardingOpen && (
        <OnboardingModal
          data={dashboard}
          onClose={closeOnboarding}
          onRefresh={loadDashboard}
          onToast={(msg) => showToast(msg, 'info')}
          onCreateTask={() => {
            setEditingTask(null);
            setDefaultCategoryId(undefined);
            setDefaultProjectId(undefined);
            setDefaultParentTaskId(undefined);
            setDefaultIsHabit(false);
            setTaskModalOpen(true);
          }}
          onCreateHabit={() => {
            setEditingTask(null);
            setDefaultCategoryId(undefined);
            setDefaultProjectId(undefined);
            setDefaultParentTaskId(undefined);
            setDefaultIsHabit(true);
            setTaskModalOpen(true);
          }}
          onOpenSettingsTab={(tab) => {
            setSettingsSubTab(tab);
            setView('settings');
          }}
        />
      )}

      {editingAdHoc && (
        <AdHocEditModal
          instance={editingAdHoc}
          categories={dashboard.categories}
          members={dashboard.members}
          showEffort={Boolean(dashboard.user.showEffortAndFairness)}
          onClose={() => setEditingAdHoc(null)}
          onCategoryCreated={loadDashboard}
          onSave={async (id, payload) => {
            await api.updateInstance(id, payload);
            await loadDashboard();
            showToast(`Updated "${payload.taskTitle}".`);
          }}
          onDelete={handleDeleteInstance}
        />
      )}

      {toast && (
        <div className="toast">
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.kind === 'undid' && dashboard.undo?.canRedo ? (
            <button
              type="button"
              className="toast-action-btn"
              disabled={undoBusy}
              onClick={handleRedo}
            >
              <Redo2 size={13} /> Redo
            </button>
          ) : toast.kind !== 'info' && dashboard.undo?.canUndo ? (
            <button
              type="button"
              className="toast-action-btn"
              disabled={undoBusy}
              onClick={handleUndo}
            >
              <Undo2 size={13} /> Undo
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
