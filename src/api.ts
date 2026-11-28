import { demoApi, isLocalDemoMode } from './demoEngine';
import type {
  ApiKeyRow,
  Category,
  DashboardData,
  DemoMember,
  Household,
  Invite,
  Member,
  Project,
  RebalancePlan,
  SiteAdminOverview,
  StorageStatus,
  Task,
  TaskInstance,
} from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await res.text();
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
  }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

const serverApi = {
  me: () =>
    request<{
      user: Member | null;
      isSiteAdmin?: boolean;
      household: Household | null;
      demoMembers: DemoMember[];
      demoEnabled?: boolean;
      registrationCodeRequired?: boolean;
      storage: StorageStatus;
    }>('/api/auth/me'),

  login: (email: string, password: string) =>
    request<{ user: Member; household: Household }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  demoLogin: (memberId?: string) =>
    request<{ user: Member; household: Household }>('/api/auth/demo', {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    }),

  register: (payload: {
    householdName: string;
    name: string;
    email: string;
    password: string;
    timezone: string;
    registrationCode?: string;
  }) =>
    request<{ user: Member; household: Household }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  requestMagicLink: (email: string) =>
    request<{ ok: boolean; emailed: boolean; previewLink?: string; message: string }>(
      '/api/auth/magic-request',
      { method: 'POST', body: JSON.stringify({ email }) },
    ),

  verifyMagicLink: (token: string) =>
    request<{ user: Member; household: Household }>('/api/auth/magic-verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  lookupInvite: (code: string) =>
    request<{ code: string; email: string; role: string; householdName: string }>(
      `/api/invites/${encodeURIComponent(code)}`,
    ),

  joinWithInvite: (payload: {
    code: string;
    name: string;
    email: string;
    password: string;
    memberGroup?: string;
  }) =>
    request<{ user: Member; household: Household }>('/api/auth/join', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  dashboard: () => request<DashboardData>('/api/dashboard'),

  updateHousehold: (payload: Partial<Household>) =>
    request<{ household: Household }>('/api/household', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createMember: (payload: {
    name: string;
    email?: string;
    password?: string;
    memberGroup?: 'partner' | 'roommate' | 'kid';
    role?: 'admin' | 'member';
    avatarColor?: string;
    weeklyCapacity?: number;
  }) =>
    request<{ member: Member }>('/api/members', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMember: (id: string, payload: Partial<Member>) =>
    request<{ member: Member }>(`/api/members/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteMember: (id: string) =>
    request<{ ok: boolean }>(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  updatePrivateSheet: (payload: { privateSheetUrl: string; privateSheetToken?: string }) =>
    request<{ member: Member; personalStorage: StorageStatus }>('/api/profile/private-sheet', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  changePassword: (payload: { currentPassword?: string; newPassword: string }) =>
    request<{ ok: boolean }>('/api/profile/password', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  installStarterPack: () =>
    request<{ ok: boolean; createdCount: number }>('/api/onboarding/starter-pack', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  createInvite: (payload: { email?: string; role?: 'admin' | 'member' }) =>
    request<{ invite: Invite; inviteUrl: string }>('/api/invites', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteInvite: (code: string) =>
    request<{ ok: boolean }>(`/api/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  createApiKey: (payload: { name: string; scopes?: string[]; allowPrivate?: boolean }) =>
    request<{ apiKey: ApiKeyRow; secretKey: string }>('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteApiKey: (id: string) =>
    request<{ ok: boolean }>(`/api/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createCategory: (payload: {
    name: string;
    parentCategoryId?: string;
    visibility?: 'household' | 'private';
  }) =>
    request<{ category: Category }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCategory: (
    id: string,
    payload: { name?: string; parentCategoryId?: string; sortOrder?: number },
  ) =>
    request<{ category: Category }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/api/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createProject: (payload: Partial<Project>) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProject: (id: string, payload: Partial<Project>) =>
    request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  addProjectStep: (
    projectId: string,
    payload: {
      title: string;
      description?: string;
      categoryId?: string;
      parentTaskId?: string;
      dueDate?: string;
      assignmentMode?: 'fixed' | 'open_pool';
      fixedMemberId?: string;
      eligibleMemberIds?: string[];
    },
  ) =>
    request<{ created: Array<{ task: Task; instance: TaskInstance }> }>(
      `/api/projects/${encodeURIComponent(projectId)}/steps`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  createTask: (
    payload: Partial<Omit<Task, 'eligibleMemberIds'>> & {
      eligibleMemberIds?: string[] | string;
      firstDueDate?: string;
      windowEndDate?: string;
      scheduleFirst?: boolean;
    },
  ) =>
    request<{ task: Task; instance: TaskInstance | null }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTask: (
    id: string,
    payload: Partial<Omit<Task, 'eligibleMemberIds'>> & {
      eligibleMemberIds?: string[] | string;
      firstDueDate?: string;
      windowEndDate?: string;
      clearSchedule?: boolean;
    },
  ) =>
    request<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  reorderTasks: (
    updates: Array<{ id: string; parentTaskId?: string; stepOrder?: number; categoryId?: string }>,
  ) =>
    request<{ ok: boolean }>('/api/tasks/reorder', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    }),

  quickLog: (payload: {
    text: string;
    mode: 'complete_now' | 'add_inbox';
    visibility?: 'household' | 'private';
  }) =>
    request<{ task: Task; instance: TaskInstance }>('/api/tasks/quick-log', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logAdHoc: (payload: {
    title: string;
    categoryId?: string;
    visibility?: 'household' | 'private';
    date?: string;
    notes?: string;
  }) =>
    request<{ instance: TaskInstance }>('/api/instances/ad-hoc', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  quickCompleteTask: (taskId: string) =>
    request<{ instance: TaskInstance; nextInstance: TaskInstance | null }>(
      `/api/tasks/${encodeURIComponent(taskId)}/quick-complete`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  generateSchedule: (horizonDays = 14) =>
    request<{ createdCount: number }>('/api/schedule/generate', {
      method: 'POST',
      body: JSON.stringify({ horizonDays }),
    }),

  completeInstance: (id: string, completed?: boolean, notes?: string) =>
    request<{ instance: TaskInstance; nextInstance: TaskInstance | null }>(
      `/api/instances/${encodeURIComponent(id)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ completed, ...(notes !== undefined ? { notes } : {}) }),
      },
    ),

  claimInstance: (id: string, unclaim = false) =>
    request<{ instance: TaskInstance }>(`/api/instances/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ unclaim }),
    }),

  skipInstance: (id: string) =>
    request<{ instance: TaskInstance }>(`/api/instances/${encodeURIComponent(id)}/skip`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deferInstance: (id: string, payload: { days?: number; untilDate?: string; reason?: string }) =>
    request<{ instance: TaskInstance }>(`/api/instances/${encodeURIComponent(id)}/defer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateInstance: (id: string, payload: Partial<TaskInstance> & { categoryId?: string }) =>
    request<{ instance: TaskInstance }>(`/api/instances/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteInstance: (id: string) =>
    request<{ ok: boolean }>(`/api/instances/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  previewRebalance: (includeFixed = false) =>
    request<RebalancePlan>('/api/distribution/preview', {
      method: 'POST',
      body: JSON.stringify({ includeFixed }),
    }),

  applyRebalance: (includeFixed = false) =>
    request<{ appliedCount: number; changes: RebalancePlan['changes'] }>(
      '/api/distribution/apply',
      { method: 'POST', body: JSON.stringify({ includeFixed }) },
    ),

  runReminders: (type: 'daily_digest' | 'overdue_alert' | 'both', force = true) =>
    request<{ sentCount: number }>('/api/reminders/run', {
      method: 'POST',
      body: JSON.stringify({ type, force }),
    }),

  markAllNotificationsRead: () =>
    request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  deleteNotification: (id: string) =>
    request<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  clearAllNotifications: () =>
    request<{ ok: boolean; deletedCount: number }>('/api/notifications', {
      method: 'DELETE',
    }),

  syncSheet: () => request<{ ok: boolean }>('/api/sheet/sync', { method: 'POST' }),
  initSheet: () => request<{ ok: boolean }>('/api/sheet/init', { method: 'POST' }),

  undo: () =>
    request<{ ok: boolean; restoredLabel: string; undo: DashboardData['undo'] }>('/api/undo', {
      method: 'POST',
    }),
  redo: () =>
    request<{ ok: boolean; restoredLabel: string; undo: DashboardData['undo'] }>('/api/redo', {
      method: 'POST',
    }),

  trackVisit: (kind: 'page_view' | 'demo_launch' = 'page_view') =>
    request<{ ok: boolean }>('/api/analytics/visit', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }).catch(() => ({ ok: false })),

  adminOverview: () => request<SiteAdminOverview>('/api/admin/overview'),

  adminDeleteHousehold: (id: string) =>
    request<{ ok: boolean; deletedHouseholdName: string; deletedMemberCount: number }>(
      `/api/admin/households/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
};

type ApiClient = typeof serverApi;

export const api: ApiClient = new Proxy(serverApi, {
  get(target, prop, receiver) {
    if (isLocalDemoMode() && prop in demoApi) {
      return (demoApi as Record<PropertyKey, unknown>)[prop];
    }
    return Reflect.get(target, prop, receiver);
  },
});
