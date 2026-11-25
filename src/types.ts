export interface Household {
  id: string;
  name: string;
  timezone: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  digestTime: string;
  rotationMode: 'auto_balanced' | 'round_robin';
  simulatedWeather: string;
  createdAt: string;
}

export interface Member {
  id: string;
  householdId: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  memberGroup: 'partner' | 'roommate' | 'kid';
  avatarColor: string;
  weeklyCapacity: number;
  showEffortAndFairness: boolean;
  active: boolean;
  notifyEmail: boolean;
  privateSheetUrl?: string;
  privateSheetConnected?: boolean;
  createdAt: string;
}

export interface DemoMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  memberGroup: string;
  avatarColor: string;
}

export interface Category {
  id: string;
  householdId: string;
  name: string;
  parentCategoryId: string;
  visibility: 'household' | 'private';
  ownerId: string;
  sortOrder: number;
  storageSource?: 'shared_sheet' | 'personal_sheet';
  createdAt: string;
}

export interface Project {
  id: string;
  householdId: string;
  title: string;
  description: string;
  categoryId: string;
  visibility: 'household' | 'private';
  ownerId: string;
  status: 'planning' | 'active' | 'on_hold' | 'completed';
  targetDate: string;
  leadMemberId: string;
  storageSource?: 'shared_sheet' | 'personal_sheet';
  createdAt: string;
  completedAt: string;
}

export interface Task {
  id: string;
  householdId: string;
  categoryId: string;
  projectId: string;
  stepOrder: number;
  parentTaskId: string;
  title: string;
  description: string;
  visibility: 'household' | 'private';
  ownerId: string;
  isFavorite: boolean;
  needsDetails: boolean;
  isHabit?: boolean;
  routineCue?: '' | 'morning' | 'afternoon' | 'evening' | 'anytime';
  effort: number;
  cadenceMode: 'strict_date' | 'flexible_window' | 'weather_triggered';
  recurrenceType:
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'custom_months'
    | 'quarterly'
    | 'seasonal'
    | 'yearly'
    | 'custom_days'
    | 'once';
  recurrenceInterval: number;
  recurrenceDays: string;
  targetSeason: '' | 'spring' | 'summer' | 'fall' | 'winter';
  weatherTrigger: string;
  weatherCooldownDays: number;
  overduePolicy: 'carry_over' | 'auto_skip' | 'roll_forward';
  assignmentMode: 'fixed' | 'open_pool' | 'round_robin' | 'auto_balanced';
  eligibleMemberIds: string;
  fixedMemberId: string;
  lastAssignedMemberId: string;
  active: boolean;
  storageSource?: 'shared_sheet' | 'personal_sheet';
  createdAt: string;
}

export interface TaskInstance {
  id: string;
  householdId: string;
  taskId: string;
  projectId: string;
  taskTitle: string;
  categoryPath: string;
  visibility: 'household' | 'private';
  ownerId: string;
  effort: number;
  windowType: string;
  dueDate: string;
  windowEndDate: string;
  triggerSource: string;
  weatherUrgency: '' | 'urgent' | 'heads_up';
  weatherSummary: string;
  assignmentMode: string;
  eligibleMemberIds: string;
  assigneeId: string;
  assigneeName: string;
  claimedBy: string;
  status: 'pending' | 'started' | 'on_hold' | 'gated' | 'completed' | 'skipped';
  overduePolicy: 'carry_over' | 'auto_skip' | 'roll_forward';
  reason: string;
  completedAt: string;
  completedBy: string;
  notes: string;
  storageSource?: 'shared_sheet' | 'personal_sheet';
  createdAt: string;
}

export interface WeatherDay {
  date: string;
  daysAway: number;
  tempMax: number;
  tempMin: number;
  precipProb: number;
  precipMm: number;
  snowfallCm: number;
  windMaxMph: number;
  condition: string;
}

export interface WeatherAlert {
  taskId: string;
  taskTitle: string;
  visibility: 'household' | 'private';
  ownerId: string;
  existingInstanceId: string | null;
  trigger: string;
  urgency: 'urgent' | 'heads_up';
  matchedDate: string;
  daysAway: number;
  summary: string;
}

export interface LoadMetric {
  memberId: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  memberGroup: string;
  weeklyCapacity: number;
  pendingPoints: number;
  completedPoints: number;
  totalPoints: number;
  pendingCount: number;
  completedCount: number;
  overdueCount: number;
  normalizedLoad: number;
  targetPercent: number;
  actualPercent: number;
  deltaPercent: number;
}

export interface Invite {
  code: string;
  householdId: string;
  email: string;
  role: 'admin' | 'member';
  createdBy: string;
  expiresAt: string;
  usedBy: string;
  createdAt: string;
}

export interface ApiKeyRow {
  id: string;
  householdId: string;
  memberId: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  allowPrivate: boolean;
  lastUsedAt: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  householdId: string;
  memberId: string;
  memberEmail: string;
  type: string;
  subject: string;
  body: string;
  channel: string;
  deliveryStatus: string;
  readAt: string;
  createdAt: string;
}

export interface SheetTabStatus {
  name: string;
  columns: string[];
  rowCount: number;
}

export interface StorageStatus {
  mode: string;
  label: string;
  connected: boolean;
  sheetId?: string | null;
  sheetUrl?: string | null;
  appsScriptConfigured?: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  tabs: SheetTabStatus[];
}

export interface HabitDayPoint {
  date: string;
  weekday: string;
  done: boolean;
  isToday: boolean;
}

export interface HabitStat {
  taskId: string;
  doneToday: boolean;
  todayCompletedInstanceId: string | null;
  currentStreak: number;
  bestStreak: number;
  completedLast7: number;
  last7Days: HabitDayPoint[];
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  lastActionLabel: string | null;
  redoActionLabel: string | null;
}

export interface DashboardData {
  user: Member;
  isSiteAdmin?: boolean;
  household: Household;
  todayStr: string;
  members: Member[];
  categories: Category[];
  projects: Project[];
  tasks: Task[];
  instances: TaskInstance[];
  habitStats: HabitStat[];
  undo?: UndoState;
  loads: LoadMetric[];
  invites: Invite[];
  apiKeys: ApiKeyRow[];
  notifications: NotificationItem[];
  weather: {
    source: string;
    preset: string;
    locationName: string;
    days: WeatherDay[];
    error: string | null;
    alerts: WeatherAlert[];
    triggers: Array<{ id: string; label: string }>;
    presets: Array<{ id: string; label: string }>;
  };
  storage: {
    shared: StorageStatus;
    personal: StorageStatus;
  };
  reminderChannels: {
    emailConfigured: boolean;
    ntfyConfigured: boolean;
    webhookConfigured: boolean;
  };
}

export interface RebalanceChange {
  instanceId: string;
  taskTitle: string;
  dueDate: string;
  effort: number;
  fromMemberId: string;
  fromMemberName: string;
  toMemberId: string;
  toMemberName: string;
  reason: string;
}

export interface RebalancePlan {
  beforeLoads: LoadMetric[];
  afterLoads: LoadMetric[];
  changes: RebalanceChange[];
}

export interface SiteAdminDailyStat {
  date: string;
  pageViews: number;
  demoLaunches: number;
}

export interface SiteAdminHousehold {
  id: string;
  name: string;
  locationName: string;
  timezone: string;
  createdAt: string;
  lastActivityAt: string;
  isCurrentHousehold: boolean;
  memberCount: number;
  members: Array<{
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'member';
    memberGroup: string;
    active: boolean;
  }>;
  taskCount: number;
  projectCount: number;
  completedCount: number;
  openCount: number;
  inviteCount: number;
}

export interface SiteAdminOverview {
  analytics: {
    totalPageViews: number;
    todayPageViews: number;
    last7DaysPageViews: number;
    totalDemoLaunches: number;
    todayDemoLaunches: number;
    last7DaysDemoLaunches: number;
    daily: SiteAdminDailyStat[];
  };
  totals: {
    households: number;
    members: number;
    activeMembers: number;
    tasks: number;
    projects: number;
    completedInstances: number;
  };
  config: {
    storageMode: string;
    storageLabel: string;
    demoEnabled: boolean;
    registrationCodeRequired: boolean;
    emailConfigured: boolean;
    ntfyConfigured: boolean;
    webhookConfigured: boolean;
    appUrl: string;
  };
  households: SiteAdminHousehold[];
}
