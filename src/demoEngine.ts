import type {
  ApiKeyRow,
  Category,
  DashboardData,
  HabitStat,
  Household,
  Invite,
  LoadMetric,
  Member,
  NotificationItem,
  Project,
  RebalancePlan,
  StorageStatus,
  Task,
  TaskInstance,
  WeatherAlert,
  WeatherDay,
} from './types';

const STORAGE_KEY = 'homehub_browser_demo_v1';
const SESSION_FLAG_KEY = 'homehub_browser_demo_active';
const MAX_UNDO = 25;

const AVATAR_PALETTE = [
  '#2D6A4F',
  '#C86D51',
  '#3B6E8C',
  '#8B5E83',
  '#B07D2B',
  '#4A7C59',
  '#9C4A5B',
  '#4F5D75',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const OPEN_STATUSES = new Set(['pending', 'started', 'on_hold', 'gated']);

interface DemoSnapshot {
  categories: Category[];
  projects: Project[];
  tasks: Task[];
  instances: TaskInstance[];
}

interface UndoEntry {
  label: string;
  before: DemoSnapshot;
}

interface DemoState {
  activeMemberId: string;
  household: Household;
  members: Member[];
  categories: Category[];
  projects: Project[];
  tasks: Task[];
  instances: TaskInstance[];
  invites: Invite[];
  apiKeys: ApiKeyRow[];
  notifications: NotificationItem[];
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function getLocalTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseDateStr(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function formatDateUTC(dt: Date) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number) {
  const dt = parseDateStr(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatDateUTC(dt);
}

function diffDays(aStr: string, bStr: string) {
  return Math.round((parseDateStr(aStr).getTime() - parseDateStr(bStr).getTime()) / 86_400_000);
}

function getWeekdayName(dateStr: string) {
  return WEEKDAYS[parseDateStr(dateStr).getUTCDay()];
}

function buildCategoryPathMap(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, string>();
  for (const c of categories) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: Category | undefined = c;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentCategoryId ? byId.get(cur.parentCategoryId) : undefined;
    }
    out.set(c.id, parts.join(' > '));
  }
  return out;
}

function computeNextDueDate(task: Task, fromDateStr: string): string | null {
  const type = task.recurrenceType || 'weekly';
  const interval = Math.max(1, Number(task.recurrenceInterval) || 1);
  if (type === 'once') return null;
  if (type === 'daily' || type === 'custom_days') return addDays(fromDateStr, interval);
  if (type === 'weekly' || type === 'biweekly') {
    const days = (task.recurrenceDays || '')
      .split(',')
      .map((s) => s.trim())
      .filter((d) => WEEKDAYS.includes(d));
    if (days.length > 0 && task.cadenceMode !== 'flexible_window') {
      const base = type === 'biweekly' ? addDays(fromDateStr, 7) : fromDateStr;
      for (let i = 1; i <= 21; i++) {
        const cand = addDays(base, i);
        if (days.includes(getWeekdayName(cand))) return cand;
      }
    }
    return addDays(fromDateStr, type === 'biweekly' ? 14 : 7 * interval);
  }
  if (type === 'monthly') {
    const dt = parseDateStr(fromDateStr);
    const day = Math.min(28, Math.max(1, interval || dt.getUTCDate()));
    return formatDateUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, day, 12)));
  }
  if (type === 'quarterly') {
    const dt = parseDateStr(fromDateStr);
    return formatDateUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 3, 1, 12)));
  }
  if (type === 'seasonal') return addDays(fromDateStr, 90);
  if (type === 'yearly') {
    const dt = parseDateStr(fromDateStr);
    return `${dt.getUTCFullYear() + 1}-01-01`;
  }
  return addDays(fromDateStr, 7);
}

function createInitialDemoState(): DemoState {
  const today = getLocalTodayStr();
  const now = new Date().toISOString();
  const hhId = 'hh_demo_oakridge';

  const household: Household = {
    id: hhId,
    name: 'Oakridge Home (Demo)',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
    locationName: 'Seattle, WA',
    latitude: 47.6062,
    longitude: -122.3321,
    digestTime: '08:00',
    rotationMode: 'auto_balanced',
    simulatedWeather: 'rain_and_freeze',
    createdAt: now,
  };

  const members: Member[] = [
    {
      id: 'mem_maya',
      householdId: hhId,
      name: 'Maya Chen',
      email: 'maya@oakridge.demo',
      role: 'admin',
      memberGroup: 'partner',
      avatarColor: '#2D6A4F',
      weeklyCapacity: 1.0,
      showEffortAndFairness: false,
      active: true,
      notifyEmail: true,
      createdAt: now,
    },
    {
      id: 'mem_alex',
      householdId: hhId,
      name: 'Alex Rivera',
      email: 'alex@oakridge.demo',
      role: 'admin',
      memberGroup: 'partner',
      avatarColor: '#C86D51',
      weeklyCapacity: 1.0,
      showEffortAndFairness: false,
      active: true,
      notifyEmail: true,
      createdAt: now,
    },
    {
      id: 'mem_sam',
      householdId: hhId,
      name: 'Sam Patel',
      email: 'sam@oakridge.demo',
      role: 'member',
      memberGroup: 'roommate',
      avatarColor: '#3B6E8C',
      weeklyCapacity: 1.0,
      showEffortAndFairness: false,
      active: true,
      notifyEmail: true,
      createdAt: now,
    },
    {
      id: 'mem_riley',
      householdId: hhId,
      name: 'Riley Chen',
      email: 'riley@oakridge.demo',
      role: 'member',
      memberGroup: 'kid',
      avatarColor: '#8B5E83',
      weeklyCapacity: 0.5,
      showEffortAndFairness: false,
      active: true,
      notifyEmail: false,
      createdAt: now,
    },
  ];

  const categories: Category[] = [
    { id: 'cat_home', householdId: hhId, name: 'Home', parentCategoryId: '', visibility: 'household', ownerId: '', sortOrder: 1, createdAt: now },
    { id: 'cat_kitchen', householdId: hhId, name: 'Kitchen', parentCategoryId: 'cat_home', visibility: 'household', ownerId: '', sortOrder: 1, createdAt: now },
    { id: 'cat_living', householdId: hhId, name: 'Living Areas', parentCategoryId: 'cat_home', visibility: 'household', ownerId: '', sortOrder: 2, createdAt: now },
    { id: 'cat_exterior', householdId: hhId, name: 'Exterior & Yard', parentCategoryId: 'cat_home', visibility: 'household', ownerId: '', sortOrder: 3, createdAt: now },
    { id: 'cat_seasonal', householdId: hhId, name: 'Seasonal & Weather', parentCategoryId: 'cat_exterior', visibility: 'household', ownerId: '', sortOrder: 1, createdAt: now },
    { id: 'cat_safety', householdId: hhId, name: 'Utilities & Safety', parentCategoryId: 'cat_home', visibility: 'household', ownerId: '', sortOrder: 4, createdAt: now },
    { id: 'cat_finance', householdId: hhId, name: 'Finance & Admin', parentCategoryId: '', visibility: 'household', ownerId: '', sortOrder: 2, createdAt: now },
    { id: 'cat_projects', householdId: hhId, name: 'Home Projects', parentCategoryId: '', visibility: 'household', ownerId: '', sortOrder: 3, createdAt: now },
    { id: 'cat_priv_habits', householdId: hhId, name: 'Habit Building', parentCategoryId: '', visibility: 'private', ownerId: 'mem_maya', sortOrder: 1, createdAt: now },
    { id: 'cat_priv_personal', householdId: hhId, name: 'Personal (Private)', parentCategoryId: '', visibility: 'private', ownerId: 'mem_maya', sortOrder: 2, createdAt: now },
  ];

  const projects: Project[] = [
    {
      id: 'proj_garage',
      householdId: hhId,
      title: 'Garage Cleanout & Wall Shelving',
      description: 'Sort storage bins, donate unused gear, and anchor two steel racks before winter.',
      categoryId: 'cat_projects',
      visibility: 'household',
      ownerId: 'mem_maya',
      status: 'active',
      targetDate: addDays(today, 14),
      leadMemberId: 'mem_maya',
      createdAt: now,
      completedAt: '',
    },
    {
      id: 'proj_guest',
      householdId: hhId,
      title: 'Prep Guest Room for Visitors',
      description: 'Wash spare linens, clear closet space, and stock guest bathroom basket.',
      categoryId: 'cat_projects',
      visibility: 'household',
      ownerId: 'mem_alex',
      status: 'planning',
      targetDate: addDays(today, 21),
      leadMemberId: 'mem_alex',
      createdAt: now,
      completedAt: '',
    },
  ];

  const tasks: Task[] = [
    {
      id: 'tsk_trash',
      householdId: hhId,
      categoryId: 'cat_exterior',
      projectId: '',
      stepOrder: 1,
      parentTaskId: '',
      title: 'Take out trash & recycling carts',
      description: 'Empty kitchen & bathroom bins and roll carts to the curb before pickup.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: true,
      needsDetails: false,
      effort: 2,
      cadenceMode: 'strict_date',
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: 'Tue,Fri',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'round_robin',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      fixedMemberId: '',
      lastAssignedMemberId: 'mem_maya',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_dishes',
      householdId: hhId,
      categoryId: 'cat_kitchen',
      projectId: '',
      stepOrder: 2,
      parentTaskId: '',
      title: 'Wash dinner dishes & load dishwasher',
      description: 'Quick evening reset so counters are clear for breakfast.',
      visibility: 'household',
      ownerId: 'mem_alex',
      isFavorite: true,
      needsDetails: false,
      effort: 2,
      cadenceMode: 'strict_date',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'roll_forward',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_alex',
      fixedMemberId: 'mem_alex',
      lastAssignedMemberId: 'mem_alex',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_vacuum',
      householdId: hhId,
      categoryId: 'cat_living',
      projectId: '',
      stepOrder: 3,
      parentTaskId: '',
      title: 'Vacuum living room & hallway',
      description: 'Flexible weekly task — anyone eligible can claim or complete it.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 3,
      cadenceMode: 'flexible_window',
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'roll_forward',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      fixedMemberId: '',
      lastAssignedMemberId: 'mem_sam',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_plants',
      householdId: hhId,
      categoryId: 'cat_living',
      projectId: '',
      stepOrder: 4,
      parentTaskId: '',
      title: 'Water indoor plants',
      description: 'Check soil moisture for ferns and kitchen herbs.',
      visibility: 'household',
      ownerId: 'mem_riley',
      isFavorite: true,
      needsDetails: false,
      effort: 1,
      cadenceMode: 'flexible_window',
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'roll_forward',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_riley',
      fixedMemberId: 'mem_riley',
      lastAssignedMemberId: 'mem_riley',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_bills',
      householdId: hhId,
      categoryId: 'cat_finance',
      projectId: '',
      stepOrder: 5,
      parentTaskId: '',
      title: 'Review & pay monthly utilities',
      description: 'Check water, power, and internet statements and confirm autopay.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 1,
      cadenceMode: 'strict_date',
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex',
      fixedMemberId: '',
      lastAssignedMemberId: 'mem_maya',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_hvac',
      householdId: hhId,
      categoryId: 'cat_safety',
      projectId: '',
      stepOrder: 6,
      parentTaskId: '',
      title: 'Replace HVAC air filter',
      description: 'Swap 16x25x1 MERV-11 filter in hall return vent.',
      visibility: 'household',
      ownerId: 'mem_alex',
      isFavorite: false,
      needsDetails: false,
      effort: 2,
      cadenceMode: 'flexible_window',
      recurrenceType: 'quarterly',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      fixedMemberId: '',
      lastAssignedMemberId: '',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_patio',
      householdId: hhId,
      categoryId: 'cat_seasonal',
      projectId: '',
      stepOrder: 7,
      parentTaskId: '',
      title: 'Put cover on outdoor patio furniture',
      description: 'Zip waterproof cover over sofa and tuck cushions in deck box.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 1,
      cadenceMode: 'weather_triggered',
      recurrenceType: 'once',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'rain_soon',
      weatherCooldownDays: 5,
      overduePolicy: 'auto_skip',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam,mem_riley',
      fixedMemberId: '',
      lastAssignedMemberId: '',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_freeze',
      householdId: hhId,
      categoryId: 'cat_seasonal',
      projectId: '',
      stepOrder: 8,
      parentTaskId: '',
      title: 'Drain hoses & cover outdoor faucets',
      description: 'Shut off exterior manifold valve and install foam covers before first freeze.',
      visibility: 'household',
      ownerId: 'mem_alex',
      isFavorite: false,
      needsDetails: false,
      effort: 3,
      cadenceMode: 'weather_triggered',
      recurrenceType: 'seasonal',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: 'fall',
      weatherTrigger: 'freeze_soon',
      weatherCooldownDays: 14,
      overduePolicy: 'carry_over',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex',
      fixedMemberId: '',
      lastAssignedMemberId: '',
      active: true,
      createdAt: now,
    },
    // Project steps
    {
      id: 'tsk_pg1',
      householdId: hhId,
      categoryId: 'cat_projects',
      projectId: 'proj_garage',
      stepOrder: 1,
      parentTaskId: '',
      title: 'Sort camping bins into keep / donate piles',
      description: 'Set aside anything unused in the past 2 years.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 3,
      cadenceMode: 'strict_date',
      recurrenceType: 'once',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      fixedMemberId: 'mem_maya',
      lastAssignedMemberId: 'mem_maya',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_pg2',
      householdId: hhId,
      categoryId: 'cat_projects',
      projectId: 'proj_garage',
      stepOrder: 2,
      parentTaskId: '',
      title: 'Pick up 2 steel shelving racks from hardware store',
      description: 'East wall clearance is 72 inches wide.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 2,
      cadenceMode: 'strict_date',
      recurrenceType: 'once',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_alex',
      fixedMemberId: 'mem_alex',
      lastAssignedMemberId: 'mem_alex',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_pg3',
      householdId: hhId,
      categoryId: 'cat_projects',
      projectId: 'proj_garage',
      stepOrder: 3,
      parentTaskId: '',
      title: 'Drop off donation boxes at thrift center',
      description: 'Anyone free this weekend can claim and drop off.',
      visibility: 'household',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 2,
      cadenceMode: 'strict_date',
      recurrenceType: 'once',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      fixedMemberId: '',
      lastAssignedMemberId: '',
      active: true,
      createdAt: now,
    },
    // Private Habits & Tasks for Maya
    {
      id: 'tsk_hab_pt',
      householdId: hhId,
      categoryId: 'cat_priv_habits',
      projectId: '',
      stepOrder: 1,
      parentTaskId: '',
      title: '10-minute morning stretch & shoulder PT',
      description: 'Resistance band external rotations + posture reset.',
      visibility: 'private',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      isHabit: true,
      routineCue: 'morning',
      effort: 1,
      cadenceMode: 'strict_date',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'auto_skip',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      fixedMemberId: 'mem_maya',
      lastAssignedMemberId: 'mem_maya',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_hab_skin',
      householdId: hhId,
      categoryId: 'cat_priv_habits',
      projectId: '',
      stepOrder: 2,
      parentTaskId: '',
      title: 'Use skin care product before bed',
      description: 'Evening skincare routine — auto-skips cleanly if missed.',
      visibility: 'private',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      isHabit: true,
      routineCue: 'evening',
      effort: 1,
      cadenceMode: 'strict_date',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'auto_skip',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      fixedMemberId: 'mem_maya',
      lastAssignedMemberId: 'mem_maya',
      active: true,
      createdAt: now,
    },
    {
      id: 'tsk_priv_dentist',
      householdId: hhId,
      categoryId: 'cat_priv_personal',
      projectId: '',
      stepOrder: 3,
      parentTaskId: '',
      title: 'Schedule annual dentist checkup',
      description: 'Call Dr. Patel’s office for a morning slot.',
      visibility: 'private',
      ownerId: 'mem_maya',
      isFavorite: false,
      needsDetails: false,
      effort: 1,
      cadenceMode: 'strict_date',
      recurrenceType: 'once',
      recurrenceInterval: 1,
      recurrenceDays: '',
      targetSeason: '',
      weatherTrigger: 'none',
      weatherCooldownDays: 5,
      overduePolicy: 'carry_over',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      fixedMemberId: 'mem_maya',
      lastAssignedMemberId: 'mem_maya',
      active: true,
      createdAt: now,
    },
  ];

  const instances: TaskInstance[] = [
    {
      id: 'inst_trash',
      householdId: hhId,
      taskId: 'tsk_trash',
      projectId: '',
      taskTitle: 'Take out trash & recycling carts',
      categoryPath: 'Home > Exterior & Yard',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 2,
      windowType: 'daily',
      dueDate: today,
      windowEndDate: today,
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'round_robin',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      assigneeId: 'mem_maya',
      assigneeName: 'Maya Chen',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'carry_over',
      reason: 'Round-robin rotation (Maya’s turn)',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_dishes',
      householdId: hhId,
      taskId: 'tsk_dishes',
      projectId: '',
      taskTitle: 'Wash dinner dishes & load dishwasher',
      categoryPath: 'Home > Kitchen',
      visibility: 'household',
      ownerId: 'mem_alex',
      effort: 2,
      windowType: 'daily',
      dueDate: today,
      windowEndDate: today,
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_alex',
      assigneeId: 'mem_alex',
      assigneeName: 'Alex Rivera',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'roll_forward',
      reason: 'Assigned to Alex',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_vacuum',
      householdId: hhId,
      taskId: 'tsk_vacuum',
      projectId: '',
      taskTitle: 'Vacuum living room & hallway',
      categoryPath: 'Home > Living Areas',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 3,
      windowType: 'weekly',
      dueDate: today,
      windowEndDate: addDays(today, 4),
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      assigneeId: '',
      assigneeName: '',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'roll_forward',
      reason: 'Anyone — flexible this week',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_bills',
      householdId: hhId,
      taskId: 'tsk_bills',
      projectId: '',
      taskTitle: 'Review & pay monthly utilities',
      categoryPath: 'Finance & Admin',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 1,
      windowType: 'monthly',
      dueDate: addDays(today, 5),
      windowEndDate: addDays(today, 5),
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex',
      assigneeId: '',
      assigneeName: '',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'carry_over',
      reason: 'Adults only',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_hvac',
      householdId: hhId,
      taskId: 'tsk_hvac',
      projectId: '',
      taskTitle: 'Replace HVAC air filter',
      categoryPath: 'Home > Utilities & Safety',
      visibility: 'household',
      ownerId: 'mem_alex',
      effort: 2,
      windowType: 'quarterly',
      dueDate: today,
      windowEndDate: addDays(today, 30),
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      assigneeId: '',
      assigneeName: '',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'carry_over',
      reason: 'Quarterly flexible task',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_patio',
      householdId: hhId,
      taskId: 'tsk_patio',
      projectId: '',
      taskTitle: 'Put cover on outdoor patio furniture',
      categoryPath: 'Home > Exterior & Yard > Seasonal & Weather',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 1,
      windowType: 'daily',
      dueDate: addDays(today, 2),
      windowEndDate: addDays(today, 2),
      triggerSource: 'weather',
      weatherUrgency: 'urgent',
      weatherSummary: 'Heavy rain forecasted in 2 days (85% chance, 18 mm)',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam,mem_riley',
      assigneeId: '',
      assigneeName: '',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'auto_skip',
      reason: 'Heavy rain forecasted in 2 days',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_freeze',
      householdId: hhId,
      taskId: 'tsk_freeze',
      projectId: '',
      taskTitle: 'Drain hoses & cover outdoor faucets',
      categoryPath: 'Home > Exterior & Yard > Seasonal & Weather',
      visibility: 'household',
      ownerId: 'mem_alex',
      effort: 3,
      windowType: 'daily',
      dueDate: addDays(today, 6),
      windowEndDate: addDays(today, 6),
      triggerSource: 'weather',
      weatherUrgency: 'heads_up',
      weatherSummary: 'Overnight freeze forecasted in 6 days (low 29°F)',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex',
      assigneeId: '',
      assigneeName: '',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'carry_over',
      reason: 'Overnight freeze forecasted in 6 days',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_dentist',
      householdId: hhId,
      taskId: 'tsk_priv_dentist',
      projectId: '',
      taskTitle: 'Schedule annual dentist checkup',
      categoryPath: 'Personal (Private)',
      visibility: 'private',
      ownerId: 'mem_maya',
      effort: 1,
      windowType: 'daily',
      dueDate: today,
      windowEndDate: today,
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      assigneeId: 'mem_maya',
      assigneeName: 'Maya Chen',
      claimedBy: '',
      status: 'gated',
      overduePolicy: 'carry_over',
      reason: 'Private personal task',
      completedAt: '',
      completedBy: '',
      notes: 'Left voicemail — waiting for callback with next week’s openings.',
      createdAt: now,
    },
    // Project step instances
    {
      id: 'inst_pg1',
      householdId: hhId,
      taskId: 'tsk_pg1',
      projectId: 'proj_garage',
      taskTitle: 'Sort camping bins into keep / donate piles',
      categoryPath: 'Home Projects',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 3,
      windowType: 'daily',
      dueDate: addDays(today, -1),
      windowEndDate: addDays(today, -1),
      triggerSource: 'project',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      assigneeId: 'mem_maya',
      assigneeName: 'Maya Chen',
      claimedBy: '',
      status: 'completed',
      overduePolicy: 'carry_over',
      reason: 'Project step',
      completedAt: `${addDays(today, -1)}T18:20:00.000Z`,
      completedBy: 'Maya Chen',
      notes: '3 boxes ready for donation!',
      createdAt: now,
    },
    {
      id: 'inst_pg2',
      householdId: hhId,
      taskId: 'tsk_pg2',
      projectId: 'proj_garage',
      taskTitle: 'Pick up 2 steel shelving racks from hardware store',
      categoryPath: 'Home Projects',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 2,
      windowType: 'daily',
      dueDate: addDays(today, 2),
      windowEndDate: addDays(today, 2),
      triggerSource: 'project',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_alex',
      assigneeId: 'mem_alex',
      assigneeName: 'Alex Rivera',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'carry_over',
      reason: 'Project step',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_pg3',
      householdId: hhId,
      taskId: 'tsk_pg3',
      projectId: 'proj_garage',
      taskTitle: 'Drop off donation boxes at thrift center',
      categoryPath: 'Home Projects',
      visibility: 'household',
      ownerId: 'mem_maya',
      effort: 2,
      windowType: 'daily',
      dueDate: addDays(today, 4),
      windowEndDate: addDays(today, 4),
      triggerSource: 'project',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'open_pool',
      eligibleMemberIds: 'mem_maya,mem_alex,mem_sam',
      assigneeId: '',
      assigneeName: '',
      claimedBy: '',
      status: 'pending',
      overduePolicy: 'carry_over',
      reason: 'Project step — open to claim',
      completedAt: '',
      completedBy: '',
      notes: '',
      createdAt: now,
    },
    // Recent completed habit check-ins so 7-day dots & streaks shine immediately!
    ...[-5, -4, -3, -2, -1].map((offset) => ({
      id: `inst_hab_skin_${Math.abs(offset)}`,
      householdId: hhId,
      taskId: 'tsk_hab_skin',
      projectId: '',
      taskTitle: 'Use skin care product before bed',
      categoryPath: 'Habit Building',
      visibility: 'private' as const,
      ownerId: 'mem_maya',
      effort: 1,
      windowType: 'daily',
      dueDate: addDays(today, offset),
      windowEndDate: addDays(today, offset),
      triggerSource: 'schedule',
      weatherUrgency: '' as const,
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      assigneeId: 'mem_maya',
      assigneeName: 'Maya Chen',
      claimedBy: '',
      status: 'completed' as const,
      overduePolicy: 'auto_skip' as const,
      reason: 'Daily habit',
      completedAt: `${addDays(today, offset)}T22:10:00.000Z`,
      completedBy: 'Maya Chen',
      notes: '',
      createdAt: now,
    })),
    ...[-6, -4, -2, -1, 0].map((offset) => ({
      id: `inst_hab_pt_${Math.abs(offset)}`,
      householdId: hhId,
      taskId: 'tsk_hab_pt',
      projectId: '',
      taskTitle: '10-minute morning stretch & shoulder PT',
      categoryPath: 'Habit Building',
      visibility: 'private' as const,
      ownerId: 'mem_maya',
      effort: 1,
      windowType: 'daily',
      dueDate: addDays(today, offset),
      windowEndDate: addDays(today, offset),
      triggerSource: 'schedule',
      weatherUrgency: '' as const,
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_maya',
      assigneeId: 'mem_maya',
      assigneeName: 'Maya Chen',
      claimedBy: '',
      status: 'completed' as const,
      overduePolicy: 'auto_skip' as const,
      reason: 'Daily habit',
      completedAt: `${addDays(today, offset)}T07:45:00.000Z`,
      completedBy: 'Maya Chen',
      notes: '',
      createdAt: now,
    })),
    // Sample completed Activity Log entries for Alex & Sam
    {
      id: 'inst_log_alex1',
      householdId: hhId,
      taskId: 'tsk_dishes',
      projectId: '',
      taskTitle: 'Wash dinner dishes & load dishwasher',
      categoryPath: 'Home > Kitchen',
      visibility: 'household',
      ownerId: 'mem_alex',
      effort: 2,
      windowType: 'daily',
      dueDate: addDays(today, -1),
      windowEndDate: addDays(today, -1),
      triggerSource: 'schedule',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: 'mem_alex',
      assigneeId: 'mem_alex',
      assigneeName: 'Alex Rivera',
      claimedBy: '',
      status: 'completed',
      overduePolicy: 'roll_forward',
      reason: 'Assigned to Alex',
      completedAt: `${addDays(today, -1)}T20:15:00.000Z`,
      completedBy: 'Alex Rivera',
      notes: '',
      createdAt: now,
    },
    {
      id: 'inst_log_sam1',
      householdId: hhId,
      taskId: '',
      projectId: '',
      taskTitle: 'Restocked dishwasher pods & paper towels',
      categoryPath: 'Home > Kitchen',
      visibility: 'household',
      ownerId: 'mem_sam',
      effort: 1,
      windowType: 'ad_hoc',
      dueDate: today,
      windowEndDate: today,
      triggerSource: 'ad_hoc',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: '',
      assigneeId: 'mem_sam',
      assigneeName: 'Sam Patel',
      claimedBy: 'Sam Patel',
      status: 'completed',
      overduePolicy: 'auto_skip',
      reason: 'Ad-hoc record',
      completedAt: `${today}T10:30:00.000Z`,
      completedBy: 'Sam Patel',
      notes: 'Picked up Costco pack',
      createdAt: now,
    },
  ];

  const invites: Invite[] = [
    {
      code: 'DEMO-INVITE',
      householdId: hhId,
      email: '',
      role: 'member',
      createdBy: 'mem_maya',
      expiresAt: addDays(today, 30) + 'T00:00:00.000Z',
      usedBy: '',
      createdAt: now,
    },
  ];

  const notifications: NotificationItem[] = [
    {
      id: 'ntf_demo_1',
      householdId: hhId,
      memberId: 'mem_maya',
      memberEmail: 'maya@oakridge.demo',
      type: 'daily_digest',
      subject: 'Welcome to the Interactive Demo!',
      body: 'Click any task to inspect details & update status, check off your Daily Habits, or try Undo (⌘Z). All changes stay right in your browser.',
      channel: 'in_app',
      deliveryStatus: 'sent',
      readAt: '',
      createdAt: now,
    },
  ];

  return {
    activeMemberId: 'mem_maya',
    household,
    members,
    categories,
    projects,
    tasks,
    instances,
    invites,
    apiKeys: [],
    notifications,
    undoStack: [],
    redoStack: [],
  };
}

function loadState(): DemoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed && parsed.household && Array.isArray(parsed.members) && parsed.members.length > 0) {
        return {
          ...parsed,
          undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
          redoStack: Array.isArray(parsed.redoStack) ? parsed.redoStack : [],
        };
      }
    }
  } catch {
    // ignore corrupt localStorage
  }
  const fresh = createInitialDemoState();
  saveState(fresh);
  return fresh;
}

function saveState(state: DemoState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

function cloneSnap(state: DemoState): DemoSnapshot {
  return structuredClone({
    categories: state.categories,
    projects: state.projects,
    tasks: state.tasks,
    instances: state.instances,
  });
}

function pushUndo(state: DemoState, label: string, before: DemoSnapshot) {
  state.undoStack.push({ label, before });
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}

function getActiveMember(state: DemoState): Member {
  return state.members.find((m) => m.id === state.activeMemberId) || state.members[0];
}

function computeHabitStats(tasks: Task[], instances: TaskInstance[], todayStr: string): HabitStat[] {
  const habits = tasks.filter((t) => Boolean(t.isHabit) && t.active !== false);
  const completedByTask = new Map<string, Set<string>>();
  const todayInstByTask = new Map<string, string>();

  for (const inst of instances) {
    if (inst.status !== 'completed' || !inst.taskId) continue;
    const compDate = inst.completedAt ? String(inst.completedAt).slice(0, 10) : inst.dueDate;
    const dateKey =
      inst.dueDate && inst.triggerSource !== 'quick_log' ? inst.dueDate : compDate;
    if (!dateKey) continue;
    if (!completedByTask.has(inst.taskId)) completedByTask.set(inst.taskId, new Set());
    completedByTask.get(inst.taskId)!.add(dateKey);
    if (dateKey === todayStr || compDate === todayStr) {
      completedByTask.get(inst.taskId)!.add(todayStr);
      todayInstByTask.set(inst.taskId, inst.id);
    }
  }

  return habits.map((habit) => {
    const doneDates = completedByTask.get(habit.id) || new Set<string>();
    const last7Days = [];
    for (let offset = -6; offset <= 0; offset++) {
      const date = addDays(todayStr, offset);
      last7Days.push({
        date,
        weekday: getWeekdayName(date),
        done: doneDates.has(date),
        isToday: offset === 0,
      });
    }
    const doneToday = doneDates.has(todayStr);
    const completedLast7 = last7Days.filter((d) => d.done).length;
    let currentStreak = 0;
    let cursor = doneToday ? todayStr : addDays(todayStr, -1);
    let safety = 0;
    while (doneDates.has(cursor) && safety < 365) {
      currentStreak++;
      cursor = addDays(cursor, -1);
      safety++;
    }
    const sorted = Array.from(doneDates).sort();
    let bestStreak = 0;
    let run = 0;
    let prev = '';
    for (const d of sorted) {
      run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
      if (run > bestStreak) bestStreak = run;
      prev = d;
    }
    return {
      taskId: habit.id,
      doneToday,
      todayCompletedInstanceId: todayInstByTask.get(habit.id) || null,
      currentStreak,
      bestStreak,
      completedLast7,
      last7Days,
    };
  });
}

function computeLoads(members: Member[], instances: TaskInstance[], todayStr: string): LoadMetric[] {
  const active = members.filter((m) => m.active !== false);
  const totalCap = active.reduce((s, m) => s + Math.max(0.25, m.weeklyCapacity || 1), 0);
  const start = addDays(todayStr, -14);
  const end = addDays(todayStr, 14);
  const map = new Map<string, LoadMetric>();

  for (const m of active) {
    map.set(m.id, {
      memberId: m.id,
      name: m.name,
      email: m.email,
      avatarColor: m.avatarColor,
      role: m.role,
      memberGroup: m.memberGroup,
      weeklyCapacity: Math.max(0.25, m.weeklyCapacity || 1),
      pendingPoints: 0,
      completedPoints: 0,
      totalPoints: 0,
      pendingCount: 0,
      completedCount: 0,
      overdueCount: 0,
      normalizedLoad: 0,
      targetPercent: 0,
      actualPercent: 0,
      deltaPercent: 0,
    });
  }

  for (const inst of instances) {
    if (inst.visibility === 'private' || inst.status === 'skipped' || !inst.assigneeId) continue;
    const b = map.get(inst.assigneeId);
    if (!b) continue;
    const pts = Math.max(1, inst.effort || 1);
    if (OPEN_STATUSES.has(inst.status) && inst.dueDate <= end) {
      b.pendingPoints += pts;
      b.totalPoints += pts;
      b.pendingCount += 1;
      if ((inst.windowEndDate || inst.dueDate) < todayStr && inst.status !== 'on_hold' && inst.status !== 'gated') {
        b.overdueCount += 1;
      }
    } else if (inst.status === 'completed' && inst.dueDate >= start && inst.dueDate <= end) {
      b.completedPoints += pts;
      b.totalPoints += pts;
      b.completedCount += 1;
    }
  }

  const grand = Array.from(map.values()).reduce((s, x) => s + x.totalPoints, 0);
  return Array.from(map.values()).map((b) => {
    const targetPercent = totalCap > 0 ? Math.round((b.weeklyCapacity / totalCap) * 100) : 0;
    const actualPercent = grand > 0 ? Math.round((b.totalPoints / grand) * 100) : targetPercent;
    return {
      ...b,
      normalizedLoad: Number((b.totalPoints / b.weeklyCapacity).toFixed(2)),
      targetPercent,
      actualPercent,
      deltaPercent: actualPercent - targetPercent,
    };
  });
}

function buildSimulatedWeather(todayStr: string, tasks: Task[], instances: TaskInstance[]) {
  const days: WeatherDay[] = Array.from({ length: 10 }, (_, i) => {
    const isRain = i === 2;
    const isFreeze = i === 6;
    return {
      date: addDays(todayStr, i),
      daysAway: i,
      tempMax: isFreeze ? 37 : isRain ? 54 : 62,
      tempMin: isFreeze ? 29 : isRain ? 44 : 47,
      precipProb: isRain ? 85 : i === 3 ? 40 : 10,
      precipMm: isRain ? 18 : 0,
      snowfallCm: 0,
      windMaxMph: isRain ? 22 : 9,
      condition: isFreeze ? 'Clear & Freezing' : isRain ? 'Heavy Rain' : 'Partly Cloudy',
    };
  });

  const alerts: WeatherAlert[] = [];
  for (const t of tasks) {
    if (!t.active || t.cadenceMode !== 'weather_triggered') continue;
    const openInst = instances.find((i) => i.taskId === t.id && OPEN_STATUSES.has(i.status));
    if (t.weatherTrigger === 'rain_soon') {
      const recentlyDone = instances.some(
        (i) => i.taskId === t.id && i.status === 'completed' && String(i.completedAt || '').startsWith(todayStr),
      );
      if (!recentlyDone) {
        alerts.push({
          taskId: t.id,
          taskTitle: t.title,
          visibility: t.visibility,
          ownerId: t.ownerId,
          existingInstanceId: openInst?.id || null,
          trigger: 'rain_soon',
          urgency: 'urgent',
          matchedDate: addDays(todayStr, 2),
          daysAway: 2,
          summary: 'Heavy rain forecasted in 2 days (85% chance, 18 mm)',
        });
      }
    } else if (t.weatherTrigger === 'freeze_soon') {
      const recentlyDone = instances.some(
        (i) => i.taskId === t.id && i.status === 'completed' && String(i.completedAt || '').startsWith(todayStr),
      );
      if (!recentlyDone) {
        alerts.push({
          taskId: t.id,
          taskTitle: t.title,
          visibility: t.visibility,
          ownerId: t.ownerId,
          existingInstanceId: openInst?.id || null,
          trigger: 'freeze_soon',
          urgency: 'heads_up',
          matchedDate: addDays(todayStr, 6),
          daysAway: 6,
          summary: 'Overnight freeze forecasted in 6 days (low 29°F)',
        });
      }
    }
  }

  return {
    source: 'simulated',
    preset: 'rain_and_freeze',
    locationName: 'Seattle, WA (Demo Forecast)',
    days,
    error: null,
    alerts,
    triggers: [
      { id: 'none', label: 'None' },
      { id: 'rain_soon', label: 'Rain forecasted' },
      { id: 'freeze_soon', label: 'Freeze / Frost forecasted' },
      { id: 'snow_soon', label: 'Snow forecasted' },
      { id: 'heatwave_soon', label: 'Heatwave forecasted' },
      { id: 'high_wind', label: 'High wind forecasted' },
    ],
    presets: [
      { id: '', label: 'Live Open-Meteo Forecast' },
      { id: 'rain_and_freeze', label: 'Demo: Rain (2d) + Freeze (6d)' },
      { id: 'clear', label: 'Demo: Clear Week' },
    ],
  };
}

export function isLocalDemoMode(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLocalDemoMode(enabled: boolean) {
  try {
    if (enabled) {
      window.sessionStorage.setItem(SESSION_FLAG_KEY, '1');
      loadState();
    } else {
      window.sessionStorage.removeItem(SESSION_FLAG_KEY);
    }
  } catch {
    // ignore
  }
}

export function resetLocalDemoState() {
  const fresh = createInitialDemoState();
  saveState(fresh);
  return fresh;
}

export function switchLocalDemoMember(memberId: string) {
  const state = loadState();
  if (state.members.some((m) => m.id === memberId)) {
    state.activeMemberId = memberId;
    saveState(state);
  }
}

function getUndoSummary(state: DemoState) {
  const lastUndo = state.undoStack[state.undoStack.length - 1];
  const lastRedo = state.redoStack[state.redoStack.length - 1];
  return {
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    undoCount: state.undoStack.length,
    redoCount: state.redoStack.length,
    lastActionLabel: lastUndo?.label || null,
    redoActionLabel: lastRedo?.label || null,
  };
}

function filterVisible<T extends { visibility: string; ownerId: string }>(rows: T[], memberId: string): T[] {
  return rows.filter((r) => r.visibility !== 'private' || r.ownerId === memberId);
}

export const demoApi = {
  async dashboard(): Promise<DashboardData> {
    const state = loadState();
    const user = getActiveMember(state);
    const todayStr = getLocalTodayStr();
    const visCats = filterVisible(state.categories, user.id);
    const visProjs = filterVisible(state.projects, user.id);
    const visTasks = filterVisible(state.tasks, user.id);
    const visInsts = filterVisible(state.instances, user.id).sort((a, b) =>
      (a.dueDate || '').localeCompare(b.dueDate || ''),
    );

    const sharedStorage: StorageStatus = {
      mode: 'browser_demo',
      label: 'Browser Sandbox Demo (localStorage)',
      connected: false,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      tabs: [],
    };
    const personalStorage: StorageStatus = {
      mode: 'browser_demo',
      label: 'Browser Sandbox Private Space',
      connected: false,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      tabs: [],
    };

    return {
      user,
      household: state.household,
      todayStr,
      members: state.members,
      categories: visCats,
      projects: visProjs,
      tasks: visTasks,
      instances: visInsts,
      habitStats: computeHabitStats(visTasks, visInsts, todayStr),
      undo: getUndoSummary(state),
      loads: computeLoads(state.members, visInsts, todayStr),
      invites: state.invites,
      apiKeys: state.apiKeys,
      notifications: state.notifications,
      weather: buildSimulatedWeather(todayStr, visTasks, visInsts),
      storage: { shared: sharedStorage, personal: personalStorage },
      reminderChannels: { emailConfigured: false, ntfyConfigured: false, webhookConfigured: false },
    };
  },

  async updateHousehold(payload: Partial<Household>) {
    const state = loadState();
    state.household = { ...state.household, ...payload };
    saveState(state);
    return { household: state.household };
  },

  async createMember(payload: {
    name: string;
    email?: string;
    memberGroup?: 'partner' | 'roommate' | 'kid';
    role?: 'admin' | 'member';
    avatarColor?: string;
    weeklyCapacity?: number;
  }) {
    const state = loadState();
    const m: Member = {
      id: makeId('mem'),
      householdId: state.household.id,
      name: payload.name.trim(),
      email: payload.email?.trim() || `${payload.name.toLowerCase().replace(/\s+/g, '.')}@oakridge.demo`,
      role: payload.role || 'member',
      memberGroup: payload.memberGroup || 'partner',
      avatarColor: payload.avatarColor || AVATAR_PALETTE[state.members.length % AVATAR_PALETTE.length],
      weeklyCapacity: payload.weeklyCapacity || (payload.memberGroup === 'kid' ? 0.5 : 1.0),
      showEffortAndFairness: false,
      active: true,
      notifyEmail: true,
      createdAt: new Date().toISOString(),
    };
    state.members.push(m);
    saveState(state);
    return { member: m };
  },

  async updateMember(id: string, payload: Partial<Member>) {
    const state = loadState();
    const m = state.members.find((x) => x.id === id);
    if (!m) throw new Error('Member not found');
    Object.assign(m, payload);
    saveState(state);
    return { member: m };
  },

  async deleteMember(id: string) {
    const state = loadState();
    state.members = state.members.filter((m) => m.id !== id);
    saveState(state);
    return { ok: true };
  },

  async updatePrivateSheet() {
    const state = loadState();
    return {
      member: getActiveMember(state),
      personalStorage: {
        mode: 'browser_demo',
        label: 'Browser Sandbox Private Space',
        connected: false,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        tabs: [],
      },
    };
  },

  async changePassword() {
    return { ok: true };
  },

  async installStarterPack() {
    return { ok: true, createdCount: 0 };
  },

  async createInvite(payload: { email?: string; role?: 'admin' | 'member' }) {
    const state = loadState();
    const inv: Invite = {
      code: `DEMO-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      householdId: state.household.id,
      email: payload.email || '',
      role: payload.role || 'member',
      createdBy: state.activeMemberId,
      expiresAt: addDays(getLocalTodayStr(), 14) + 'T00:00:00.000Z',
      usedBy: '',
      createdAt: new Date().toISOString(),
    };
    state.invites.unshift(inv);
    saveState(state);
    return { invite: inv, inviteUrl: `${window.location.origin}/?demo=1` };
  },

  async deleteInvite(code: string) {
    const state = loadState();
    state.invites = state.invites.filter((i) => i.code !== code);
    saveState(state);
    return { ok: true };
  },

  async createApiKey(payload: { name: string; scopes?: string[]; allowPrivate?: boolean }) {
    const state = loadState();
    const key: ApiKeyRow = {
      id: makeId('key'),
      householdId: state.household.id,
      memberId: state.activeMemberId,
      name: payload.name || 'Demo Key',
      keyPrefix: 'hh_demo_123456',
      scopes: (payload.scopes || ['tasks:read']).join(','),
      allowPrivate: Boolean(payload.allowPrivate),
      lastUsedAt: '',
      createdAt: new Date().toISOString(),
    };
    state.apiKeys.unshift(key);
    saveState(state);
    return { apiKey: key, secretKey: 'hh_demo_sandbox_key_not_active_on_server' };
  },

  async deleteApiKey(id: string) {
    const state = loadState();
    state.apiKeys = state.apiKeys.filter((k) => k.id !== id);
    saveState(state);
    return { ok: true };
  },

  async createCategory(payload: { name: string; parentCategoryId?: string; visibility?: 'household' | 'private' }) {
    const state = loadState();
    const before = cloneSnap(state);
    const vis = payload.visibility === 'private' ? 'private' : 'household';
    const cat: Category = {
      id: makeId('cat'),
      householdId: state.household.id,
      name: payload.name.trim(),
      parentCategoryId: payload.parentCategoryId || '',
      visibility: vis,
      ownerId: vis === 'private' ? state.activeMemberId : '',
      sortOrder: 10,
      createdAt: new Date().toISOString(),
    };
    state.categories.push(cat);
    pushUndo(state, `Create category "${cat.name}"`, before);
    saveState(state);
    return { category: cat };
  },

  async updateCategory(id: string, payload: { name?: string; parentCategoryId?: string; sortOrder?: number }) {
    const state = loadState();
    const before = cloneSnap(state);
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) throw new Error('Category not found');
    if (payload.name?.trim()) cat.name = payload.name.trim();
    if (payload.parentCategoryId !== undefined) cat.parentCategoryId = payload.parentCategoryId;
    if (payload.sortOrder !== undefined) cat.sortOrder = payload.sortOrder;
    pushUndo(state, `Edit category "${cat.name}"`, before);
    saveState(state);
    return { category: cat };
  },

  async deleteCategory(id: string) {
    const state = loadState();
    const before = cloneSnap(state);
    const target = state.categories.find((c) => c.id === id);
    const fallback = target?.parentCategoryId || '';
    state.categories.forEach((c) => {
      if (c.parentCategoryId === id) c.parentCategoryId = fallback;
    });
    state.tasks.forEach((t) => {
      if (t.categoryId === id) t.categoryId = fallback;
    });
    state.categories = state.categories.filter((c) => c.id !== id);
    pushUndo(state, `Delete category "${target?.name || ''}"`, before);
    saveState(state);
    return { ok: true };
  },

  async createProject(payload: Partial<Project>) {
    const state = loadState();
    const before = cloneSnap(state);
    const vis = payload.visibility === 'private' ? 'private' : 'household';
    const proj: Project = {
      id: makeId('proj'),
      householdId: state.household.id,
      title: String(payload.title || '').trim(),
      description: String(payload.description || '').trim(),
      categoryId: String(payload.categoryId || 'cat_projects'),
      visibility: vis,
      ownerId: state.activeMemberId,
      status: payload.status || 'active',
      targetDate: String(payload.targetDate || ''),
      leadMemberId: vis === 'private' ? state.activeMemberId : String(payload.leadMemberId || ''),
      createdAt: new Date().toISOString(),
      completedAt: '',
    };
    state.projects.unshift(proj);
    pushUndo(state, `Create project "${proj.title}"`, before);
    saveState(state);
    return { project: proj };
  },

  async updateProject(id: string, payload: Partial<Project>) {
    const state = loadState();
    const before = cloneSnap(state);
    const proj = state.projects.find((p) => p.id === id);
    if (!proj) throw new Error('Project not found');
    Object.assign(proj, payload);
    pushUndo(state, `Update project "${proj.title}"`, before);
    saveState(state);
    return { project: proj };
  },

  async deleteProject(id: string) {
    const state = loadState();
    const before = cloneSnap(state);
    const proj = state.projects.find((p) => p.id === id);
    state.projects = state.projects.filter((p) => p.id !== id);
    state.tasks = state.tasks.filter((t) => t.projectId !== id);
    state.instances = state.instances.filter((i) => i.projectId !== id);
    pushUndo(state, `Delete project "${proj?.title || ''}"`, before);
    saveState(state);
    return { ok: true };
  },

  async addProjectStep(
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
  ) {
    const state = loadState();
    const proj = state.projects.find((p) => p.id === projectId);
    if (!proj) throw new Error('Project not found');
    const created = await demoApi.createTask({
      title: payload.title,
      description: payload.description || '',
      categoryId: payload.categoryId !== undefined ? payload.categoryId : proj.categoryId,
      projectId,
      parentTaskId: payload.parentTaskId || '',
      visibility: proj.visibility,
      cadenceMode: 'strict_date',
      recurrenceType: 'once',
      overduePolicy: 'carry_over',
      assignmentMode: payload.assignmentMode || (payload.fixedMemberId ? 'fixed' : 'open_pool'),
      fixedMemberId: payload.fixedMemberId || '',
      eligibleMemberIds: payload.eligibleMemberIds || [],
      firstDueDate: payload.dueDate || proj.targetDate || getLocalTodayStr(),
    });
    return { created: [{ task: created.task, instance: created.instance! }] };
  },

  async createTask(
    payload: Partial<Omit<Task, 'eligibleMemberIds'>> & {
      eligibleMemberIds?: string[] | string;
      firstDueDate?: string;
      scheduleFirst?: boolean;
    },
  ) {
    const state = loadState();
    const before = cloneSnap(state);
    const user = getActiveMember(state);
    const today = getLocalTodayStr();
    const now = new Date().toISOString();
    const vis = payload.visibility === 'private' ? 'private' : 'household';
    const isHabit = Boolean(payload.isHabit);
    let catId = String(payload.categoryId || '');
    if (isHabit && !catId) {
      const existing = state.categories.find(
        (c) => (vis === 'private' ? c.visibility === 'private' : c.visibility !== 'private') && /habit/i.test(c.name),
      );
      if (existing) catId = existing.id;
      else {
        const createdCat: Category = {
          id: makeId('cat'),
          householdId: state.household.id,
          name: 'Habit Building',
          parentCategoryId: '',
          visibility: vis,
          ownerId: vis === 'private' ? user.id : '',
          sortOrder: 10,
          createdAt: now,
        };
        state.categories.push(createdCat);
        catId = createdCat.id;
      }
    }

    const eligibleCsv =
      vis === 'private'
        ? user.id
        : Array.isArray(payload.eligibleMemberIds)
          ? payload.eligibleMemberIds.join(',')
          : String(payload.eligibleMemberIds || '');

    const task: Task = {
      id: makeId('tsk'),
      householdId: state.household.id,
      categoryId: catId,
      projectId: String(payload.projectId || ''),
      stepOrder: state.tasks.length + 1,
      parentTaskId: String(payload.parentTaskId || ''),
      title: String(payload.title || '').trim(),
      description: String(payload.description || '').trim(),
      visibility: vis,
      ownerId: user.id,
      isFavorite: Boolean(payload.isFavorite),
      needsDetails: Boolean(payload.needsDetails),
      isHabit,
      routineCue: isHabit ? payload.routineCue || 'anytime' : '',
      effort: Math.min(5, Math.max(1, Number(payload.effort) || (isHabit ? 1 : 2))),
      cadenceMode: payload.cadenceMode || 'strict_date',
      recurrenceType: payload.recurrenceType || (payload.projectId ? 'once' : isHabit ? 'daily' : 'weekly'),
      recurrenceInterval: Math.max(1, Number(payload.recurrenceInterval) || 1),
      recurrenceDays: String(payload.recurrenceDays || ''),
      targetSeason: payload.targetSeason || '',
      weatherTrigger: String(payload.weatherTrigger || 'none'),
      weatherCooldownDays: Number(payload.weatherCooldownDays) || 5,
      overduePolicy: payload.overduePolicy || (isHabit ? 'auto_skip' : 'carry_over'),
      assignmentMode: vis === 'private' ? 'fixed' : payload.assignmentMode || 'open_pool',
      eligibleMemberIds: eligibleCsv,
      fixedMemberId: vis === 'private' ? user.id : String(payload.fixedMemberId || ''),
      lastAssignedMemberId: '',
      active: true,
      createdAt: now,
    };

    const catMap = buildCategoryPathMap(state.categories);
    const fixedMember = task.fixedMemberId ? state.members.find((m) => m.id === task.fixedMemberId) : null;
    const due = payload.firstDueDate || today;
    const inst: TaskInstance | null =
      payload.scheduleFirst === false || task.cadenceMode === 'weather_triggered'
        ? null
        : {
            id: makeId('inst'),
            householdId: state.household.id,
            taskId: task.id,
            projectId: task.projectId,
            taskTitle: task.title,
            categoryPath: catMap.get(task.categoryId) || 'General',
            visibility: task.visibility,
            ownerId: user.id,
            effort: task.effort,
            windowType: task.cadenceMode === 'flexible_window' ? task.recurrenceType : 'daily',
            dueDate: due,
            windowEndDate:
              task.cadenceMode === 'flexible_window' && task.recurrenceType === 'weekly'
                ? addDays(due, 6)
                : due,
            triggerSource: task.projectId ? 'project' : 'schedule',
            weatherUrgency: '',
            weatherSummary: '',
            assignmentMode: task.assignmentMode,
            eligibleMemberIds: task.eligibleMemberIds,
            assigneeId: fixedMember ? fixedMember.id : vis === 'private' ? user.id : '',
            assigneeName: fixedMember ? fixedMember.name : vis === 'private' ? user.name : '',
            claimedBy: '',
            status: 'pending',
            overduePolicy: task.overduePolicy,
            reason: vis === 'private' ? 'Private personal task' : fixedMember ? `Assigned to ${fixedMember.name.split(' ')[0]}` : 'Anyone',
            completedAt: '',
            completedBy: '',
            notes: '',
            createdAt: now,
          };

    state.tasks.push(task);
    if (inst) state.instances.push(inst);
    pushUndo(state, `Create "${task.title}"`, before);
    saveState(state);
    return { task, instance: inst };
  },

  async updateTask(
    id: string,
    payload: Partial<Omit<Task, 'eligibleMemberIds'>> & {
      eligibleMemberIds?: string[] | string;
      firstDueDate?: string;
    },
  ) {
    const state = loadState();
    const before = cloneSnap(state);
    const t = state.tasks.find((x) => x.id === id);
    if (!t) throw new Error('Task not found');
    const { eligibleMemberIds, firstDueDate, ...rest } = payload;
    Object.assign(t, rest);
    if (eligibleMemberIds !== undefined) {
      t.eligibleMemberIds = Array.isArray(eligibleMemberIds) ? eligibleMemberIds.join(',') : eligibleMemberIds;
    }
    const catMap = buildCategoryPathMap(state.categories);
    const fixedMember = t.fixedMemberId ? state.members.find((m) => m.id === t.fixedMemberId) : null;
    for (const inst of state.instances) {
      if (inst.taskId === t.id && OPEN_STATUSES.has(inst.status)) {
        inst.taskTitle = t.title;
        inst.categoryPath = catMap.get(t.categoryId) || 'General';
        inst.effort = t.effort;
        inst.overduePolicy = t.overduePolicy;
        if (firstDueDate) {
          inst.dueDate = firstDueDate;
          if (!inst.windowEndDate || inst.windowEndDate < firstDueDate) inst.windowEndDate = firstDueDate;
        }
        if (t.assignmentMode === 'fixed' && fixedMember) {
          inst.assigneeId = fixedMember.id;
          inst.assigneeName = fixedMember.name;
        } else if (t.assignmentMode === 'open_pool') {
          inst.assigneeId = '';
          inst.assigneeName = '';
        }
      }
    }
    pushUndo(state, `Edit "${t.title}"`, before);
    saveState(state);
    return { task: t };
  },

  async deleteTask(id: string) {
    const state = loadState();
    const before = cloneSnap(state);
    const t = state.tasks.find((x) => x.id === id);
    state.tasks = state.tasks.filter((x) => x.id !== id);
    state.instances = state.instances.filter((i) => !(i.taskId === id && OPEN_STATUSES.has(i.status)));
    pushUndo(state, `Delete "${t?.title || 'task'}"`, before);
    saveState(state);
    return { ok: true };
  },

  async reorderTasks(updates: Array<{ id: string; parentTaskId?: string; stepOrder?: number; categoryId?: string }>) {
    const state = loadState();
    const before = cloneSnap(state);
    const map = new Map(state.tasks.map((t) => [t.id, t]));
    for (const u of updates) {
      const t = map.get(u.id);
      if (!t) continue;
      if (u.parentTaskId !== undefined && u.parentTaskId !== t.id) t.parentTaskId = u.parentTaskId;
      if (u.stepOrder !== undefined) t.stepOrder = u.stepOrder;
      if (u.categoryId !== undefined) t.categoryId = u.categoryId;
    }
    pushUndo(state, 'Reorder tasks', before);
    saveState(state);
    return { ok: true };
  },

  async quickLog(payload: { text: string; mode: 'complete_now' | 'add_inbox'; visibility?: 'household' | 'private' }) {
    const res = await demoApi.createTask({
      title: payload.text,
      visibility: payload.visibility || 'household',
      needsDetails: true,
      recurrenceType: 'once',
      cadenceMode: 'strict_date',
    });
    return { task: res.task, instance: res.instance! };
  },

  async logAdHoc(payload: { title: string; categoryId?: string; visibility?: 'household' | 'private'; date?: string; notes?: string }) {
    const state = loadState();
    const before = cloneSnap(state);
    const user = getActiveMember(state);
    const today = getLocalTodayStr();
    const date = payload.date || today;
    const catMap = buildCategoryPathMap(state.categories);
    const now = new Date().toISOString();
    const inst: TaskInstance = {
      id: makeId('inst'),
      householdId: state.household.id,
      taskId: '',
      projectId: '',
      taskTitle: payload.title.trim(),
      categoryPath: payload.categoryId ? catMap.get(payload.categoryId) || 'General' : 'General',
      visibility: payload.visibility === 'private' ? 'private' : 'household',
      ownerId: user.id,
      effort: 1,
      windowType: 'ad_hoc',
      dueDate: date,
      windowEndDate: date,
      triggerSource: 'ad_hoc',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: user.id,
      assigneeId: user.id,
      assigneeName: user.name,
      claimedBy: user.name,
      status: 'completed',
      overduePolicy: 'auto_skip',
      reason: 'Ad-hoc record',
      completedAt: date === today ? now : `${date}T12:00:00.000Z`,
      completedBy: user.name,
      notes: payload.notes || '',
      createdAt: now,
    };
    state.instances.unshift(inst);
    pushUndo(state, `Log "${inst.taskTitle}"`, before);
    saveState(state);
    return { instance: inst };
  },

  async quickCompleteTask(taskId: string) {
    const state = loadState();
    const user = getActiveMember(state);
    const today = getLocalTodayStr();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('Task not found');
    const already = state.instances.find(
      (i) => i.taskId === taskId && i.status === 'completed' && String(i.completedAt || '').startsWith(today),
    );
    if (already) return { instance: already, nextInstance: null };
    const existingOpen = state.instances.find(
      (i) => i.taskId === taskId && OPEN_STATUSES.has(i.status) && i.dueDate <= today,
    );
    if (existingOpen) return demoApi.completeInstance(existingOpen.id, true);

    const before = cloneSnap(state);
    const catMap = buildCategoryPathMap(state.categories);
    const now = new Date().toISOString();
    const inst: TaskInstance = {
      id: makeId('inst'),
      householdId: state.household.id,
      taskId: task.id,
      projectId: task.projectId,
      taskTitle: task.title,
      categoryPath: catMap.get(task.categoryId) || 'General',
      visibility: task.visibility,
      ownerId: task.ownerId || user.id,
      effort: task.effort || 1,
      windowType: 'daily',
      dueDate: today,
      windowEndDate: today,
      triggerSource: 'quick_log',
      weatherUrgency: '',
      weatherSummary: '',
      assignmentMode: 'fixed',
      eligibleMemberIds: task.eligibleMemberIds,
      assigneeId: user.id,
      assigneeName: user.name,
      claimedBy: user.name,
      status: 'completed',
      overduePolicy: task.overduePolicy,
      reason: 'Quick-completed',
      completedAt: now,
      completedBy: user.name,
      notes: '',
      createdAt: now,
    };
    state.instances.unshift(inst);
    pushUndo(state, `Complete "${task.title}"`, before);
    saveState(state);
    return { instance: inst, nextInstance: null };
  },

  async generateSchedule() {
    return { createdCount: 0 };
  },

  async completeInstance(id: string, completed?: boolean, notes?: string) {
    const state = loadState();
    const before = cloneSnap(state);
    const user = getActiveMember(state);
    const today = getLocalTodayStr();
    const inst = state.instances.find((i) => i.id === id);
    if (!inst) throw new Error('Instance not found');
    const targetDone = completed !== undefined ? completed : inst.status !== 'completed';
    let nextInstance: TaskInstance | null = null;

    if (targetDone) {
      inst.status = 'completed';
      inst.completedAt = new Date().toISOString();
      inst.completedBy = user.name;
      if (!inst.assigneeId) {
        inst.assigneeId = user.id;
        inst.assigneeName = user.name;
      }
      if (notes !== undefined) inst.notes = notes;

      const task = state.tasks.find((t) => t.id === inst.taskId && t.active !== false);
      if (task && !task.projectId && task.cadenceMode !== 'weather_triggered' && task.recurrenceType !== 'once') {
        const nextDue = computeNextDueDate(task, inst.dueDate >= today ? inst.dueDate : today);
        if (nextDue && !state.instances.some((x) => x.taskId === task.id && x.status === 'pending' && x.dueDate >= nextDue)) {
          nextInstance = {
            ...inst,
            id: makeId('inst'),
            dueDate: nextDue,
            windowEndDate: nextDue,
            status: 'pending',
            completedAt: '',
            completedBy: '',
            notes: '',
            createdAt: new Date().toISOString(),
          };
          state.instances.push(nextInstance);
        }
      }
      pushUndo(state, `Complete "${inst.taskTitle}"`, before);
    } else {
      inst.status = 'pending';
      inst.completedAt = '';
      inst.completedBy = '';
      pushUndo(state, `Re-open "${inst.taskTitle}"`, before);
    }

    saveState(state);
    return { instance: inst, nextInstance };
  },

  async claimInstance(id: string, unclaim = false) {
    const state = loadState();
    const before = cloneSnap(state);
    const user = getActiveMember(state);
    const inst = state.instances.find((i) => i.id === id);
    if (!inst) throw new Error('Instance not found');
    if (unclaim) {
      inst.assigneeId = '';
      inst.assigneeName = '';
      inst.claimedBy = '';
      inst.reason = 'Set to Anyone';
      pushUndo(state, `Unclaim "${inst.taskTitle}"`, before);
    } else {
      inst.assigneeId = user.id;
      inst.assigneeName = user.name;
      inst.claimedBy = user.name;
      inst.reason = `Claimed by ${user.name.split(' ')[0]}`;
      pushUndo(state, `Claim "${inst.taskTitle}"`, before);
    }
    saveState(state);
    return { instance: inst };
  },

  async skipInstance(id: string) {
    const state = loadState();
    const before = cloneSnap(state);
    const user = getActiveMember(state);
    const inst = state.instances.find((i) => i.id === id);
    if (!inst) throw new Error('Instance not found');
    inst.status = 'skipped';
    inst.reason = `Skipped by ${user.name.split(' ')[0]}`;
    pushUndo(state, `Skip "${inst.taskTitle}"`, before);
    saveState(state);
    return { instance: inst };
  },

  async deferInstance(id: string, payload: { days?: number; untilDate?: string }) {
    const state = loadState();
    const before = cloneSnap(state);
    const today = getLocalTodayStr();
    const inst = state.instances.find((i) => i.id === id);
    if (!inst) throw new Error('Instance not found');
    const target = payload.untilDate || addDays(inst.dueDate > today ? inst.dueDate : today, payload.days || 1);
    inst.status = 'pending';
    inst.dueDate = target;
    inst.windowEndDate = target;
    inst.reason = `Deferred to ${target}`;
    pushUndo(state, `Defer "${inst.taskTitle}"`, before);
    saveState(state);
    return { instance: inst };
  },

  async updateInstance(id: string, payload: Partial<TaskInstance> & { categoryId?: string }) {
    const state = loadState();
    const before = cloneSnap(state);
    const inst = state.instances.find((i) => i.id === id);
    if (!inst) throw new Error('Instance not found');
    const user = getActiveMember(state);
    if (payload.taskTitle?.trim()) inst.taskTitle = payload.taskTitle.trim();
    if (payload.categoryId !== undefined) {
      const catMap = buildCategoryPathMap(state.categories);
      inst.categoryPath = payload.categoryId ? catMap.get(payload.categoryId) || 'General' : 'General';
    }
    if (payload.assigneeId !== undefined) {
      const m = state.members.find((x) => x.id === payload.assigneeId);
      inst.assigneeId = m ? m.id : '';
      inst.assigneeName = m ? m.name : '';
    }
    if (payload.dueDate) {
      inst.dueDate = payload.dueDate;
      if (!inst.windowEndDate || inst.windowEndDate < payload.dueDate || inst.triggerSource === 'ad_hoc') {
        inst.windowEndDate = payload.dueDate;
      }
    }
    if (payload.status) {
      inst.status = payload.status;
      if (payload.status === 'completed' && !inst.completedAt) {
        inst.completedAt = new Date().toISOString();
        inst.completedBy = user.name;
      } else if (payload.status !== 'completed') {
        inst.completedAt = '';
        inst.completedBy = '';
      }
    }
    if (payload.notes !== undefined) inst.notes = payload.notes;
    if (payload.effort !== undefined) inst.effort = payload.effort;
    pushUndo(state, `Update "${inst.taskTitle}"`, before);
    saveState(state);
    return { instance: inst };
  },

  async deleteInstance(id: string) {
    const state = loadState();
    const before = cloneSnap(state);
    const inst = state.instances.find((i) => i.id === id);
    state.instances = state.instances.filter((i) => i.id !== id);
    pushUndo(state, `Delete "${inst?.taskTitle || 'occurrence'}"`, before);
    saveState(state);
    return { ok: true };
  },

  async previewRebalance(): Promise<RebalancePlan> {
    const state = loadState();
    const loads = computeLoads(state.members, state.instances, getLocalTodayStr());
    return { beforeLoads: loads, afterLoads: loads, changes: [] };
  },

  async applyRebalance() {
    return { appliedCount: 0, changes: [] };
  },

  async runReminders() {
    return { sentCount: 0 };
  },

  async markAllNotificationsRead() {
    const state = loadState();
    const now = new Date().toISOString();
    state.notifications.forEach((n) => {
      if (!n.readAt) n.readAt = now;
    });
    saveState(state);
    return { ok: true };
  },

  async syncSheet() {
    return { ok: true };
  },

  async initSheet() {
    return { ok: true };
  },

  async undo() {
    const state = loadState();
    const entry = state.undoStack.pop();
    if (!entry) throw new Error('Nothing to undo.');
    state.redoStack.push({ label: entry.label, before: cloneSnap(state) });
    state.categories = entry.before.categories;
    state.projects = entry.before.projects;
    state.tasks = entry.before.tasks;
    state.instances = entry.before.instances;
    saveState(state);
    return { ok: true, restoredLabel: entry.label, undo: getUndoSummary(state) };
  },

  async redo() {
    const state = loadState();
    const entry = state.redoStack.pop();
    if (!entry) throw new Error('Nothing to redo.');
    state.undoStack.push({ label: entry.label, before: cloneSnap(state) });
    state.categories = entry.before.categories;
    state.projects = entry.before.projects;
    state.tasks = entry.before.tasks;
    state.instances = entry.before.instances;
    saveState(state);
    return { ok: true, restoredLabel: entry.label, undo: getUndoSummary(state) };
  },
};
