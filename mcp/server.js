#!/usr/bin/env node
/**
 * Home Hub MCP Server (Model Context Protocol over stdio)
 *
 * Lets AI assistants (Antigravity, Claude Desktop, etc.) directly read your
 * Daily Cockpit, bulk-create seasonal tasks, break down Projects into steps,
 * check weather alerts, and mark tasks complete via Home Hub's /api/v1/* API.
 *
 * Environment variables:
 *   HOME_HUB_URL      (default: http://localhost:3001)
 *   HOME_HUB_API_KEY  (scoped hh_live_... key generated in Home Hub Settings)
 */

import readline from 'node:readline';

const BASE_URL = (process.env.HOME_HUB_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_KEY = process.env.HOME_HUB_API_KEY || '';

const TOOLS = [
  {
    name: 'get_cockpit',
    description:
      'Get today’s Daily Cockpit: overdue tasks, tasks due today, open claimable radar tasks, active weather alerts (1-3d urgent & 4-10d heads-up), favorites, needs-details inbox, and active projects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tasks',
    description: 'List household (and permitted private) tasks, optionally filtered by categoryId, projectId, or needsDetails.',
    inputSchema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string' },
        projectId: { type: 'string' },
        needsDetails: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_task',
    description:
      'Create a household or private task with optional recurrence (daily/weekly/biweekly/monthly/custom_months/quarterly/seasonal/yearly/custom_days/once), recurrenceInterval, flexible window (firstDueDate + windowEndDate), weatherTrigger (rain_soon/freeze_soon/snow_soon/high_wind/heat_wave), overduePolicy (carry_over/auto_skip/roll_forward), and eligibleMemberIds.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        categoryId: { type: 'string' },
        visibility: { type: 'string', enum: ['household', 'private'] },
        isFavorite: { type: 'boolean' },
        isHabit: { type: 'boolean', description: 'Set true for habit tracking (daily, times_per_week, weekly, or custom_days)' },
        routineCue: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'anytime'] },
        cadenceMode: { type: 'string', enum: ['strict_date', 'flexible_window', 'weather_triggered'] },
        recurrenceType: { type: 'string', description: 'daily, weekly, times_per_week (use recurrenceInterval for N/wk), biweekly, monthly, custom_months, quarterly, seasonal, yearly, custom_days, once' },
        recurrenceInterval: { type: 'integer' },
        targetSeason: { type: 'string' },
        targetMonth: { type: 'integer', description: 'Optional target month (1=Jan .. 12=Dec) for yearly tasks' },
        weatherTrigger: { type: 'string' },
        overduePolicy: { type: 'string', enum: ['carry_over', 'auto_skip', 'roll_forward'] },
        assignmentMode: { type: 'string', enum: ['fixed', 'open_pool', 'round_robin', 'auto_balanced'] },
        eligibleMemberIds: { type: 'array', items: { type: 'string' } },
        fixedMemberId: { type: 'string' },
        firstDueDate: { type: 'string', description: 'YYYY-MM-DD, or empty string "" to leave unscheduled (no due date)' },
        windowEndDate: { type: 'string' },
        scheduleFirst: { type: 'boolean', description: 'Set false to save a task without scheduling a due date yet' },
      },
    },
  },
  {
    name: 'bulk_create_tasks',
    description: 'Bulk-create multiple tasks in one call (ideal for seasonal checklists or room routines).',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'quick_log_task',
    description: 'Quickly log something just completed ("complete_now") or drop a rough task into Inbox ("add_inbox") with needsDetails=true.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        mode: { type: 'string', enum: ['complete_now', 'add_inbox'] },
        visibility: { type: 'string', enum: ['household', 'private'] },
      },
    },
  },
  {
    name: 'log_ad_hoc_task',
    description: 'Log a one-off ad-hoc record ("Hey, I did this — keep a record") with optional category, date, and notes, without creating a recurring task template.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        categoryId: { type: 'string' },
        visibility: { type: 'string', enum: ['household', 'private'] },
        date: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'create_project_with_steps',
    description: 'Create a non-recurring household or private Project broken down into assignable steps with due dates.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        targetDate: { type: 'string' },
        visibility: { type: 'string', enum: ['household', 'private'] },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              dueDate: { type: 'string' },
              assignmentMode: { type: 'string', enum: ['fixed', 'open_pool'] },
              fixedMemberId: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'complete_instance',
    description: 'Mark a task instance complete (auto-schedules next cycle if recurring).',
    inputSchema: {
      type: 'object',
      required: ['instanceId'],
      properties: {
        instanceId: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'claim_instance',
    description: 'Claim an open radar task instance.',
    inputSchema: {
      type: 'object',
      required: ['instanceId'],
      properties: {
        instanceId: { type: 'string' },
      },
    },
  },
  {
    name: 'defer_instance',
    description: 'Defer a task instance by a number of days or to a specific YYYY-MM-DD date.',
    inputSchema: {
      type: 'object',
      required: ['instanceId'],
      properties: {
        instanceId: { type: 'string' },
        days: { type: 'integer' },
        untilDate: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
  {
    name: 'get_weather_forecast',
    description: 'Fetch 10-day household weather forecast and active urgent (1-3d) & heads-up (4-10d) weather alerts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_categories',
    description: 'List all household (and permitted private) categories and subcategories with their full breadcrumb paths.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_category',
    description: 'Create a top-level category or subcategory (pass parentCategoryId to nest under an existing category).',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        parentCategoryId: { type: 'string' },
        visibility: { type: 'string', enum: ['household', 'private'] },
      },
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task (title, description, categoryId, recurrence, overduePolicy, assignmentMode, isFavorite, active, etc.).',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        categoryId: { type: 'string' },
        isFavorite: { type: 'boolean' },
        active: { type: 'boolean' },
        cadenceMode: { type: 'string', enum: ['strict_date', 'flexible_window', 'weather_triggered'] },
        recurrenceType: { type: 'string' },
        recurrenceInterval: { type: 'integer' },
        recurrenceDays: { type: 'string' },
        targetSeason: { type: 'string' },
        targetMonth: { type: 'integer', description: 'Optional target month (1=Jan .. 12=Dec, 0=anytime) for yearly tasks' },
        weatherTrigger: { type: 'string' },
        overduePolicy: { type: 'string', enum: ['carry_over', 'auto_skip', 'roll_forward'] },
        assignmentMode: { type: 'string', enum: ['fixed', 'open_pool', 'round_robin', 'auto_balanced'] },
        fixedMemberId: { type: 'string' },
        firstDueDate: { type: 'string', description: 'YYYY-MM-DD, or empty string "" to clear the due date' },
        windowEndDate: { type: 'string' },
        clearSchedule: { type: 'boolean', description: 'Set true to remove the open due date and keep the task unscheduled' },
      },
    },
  },
  {
    name: 'move_tasks',
    description: 'Batch-move or reparent one or more tasks to a different categoryId, parentTaskId, or stepOrder (also refreshes pending instance category paths).',
    inputSchema: {
      type: 'object',
      required: ['updates'],
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              categoryId: { type: 'string' },
              parentTaskId: { type: 'string' },
              stepOrder: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task template and its open instances.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
      },
    },
  },
];

async function apiCall(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'get_cockpit':
      return apiCall('GET', '/api/v1/cockpit');
    case 'list_tasks': {
      const q = new URLSearchParams();
      if (args.categoryId) q.set('categoryId', args.categoryId);
      if (args.projectId) q.set('projectId', args.projectId);
      if (args.needsDetails) q.set('needsDetails', 'true');
      return apiCall('GET', `/api/v1/tasks${q.toString() ? `?${q}` : ''}`);
    }
    case 'create_task':
      return apiCall('POST', '/api/v1/tasks', args);
    case 'bulk_create_tasks':
      return apiCall('POST', '/api/v1/tasks/bulk', { tasks: args.tasks || [] });
    case 'quick_log_task':
      return apiCall('POST', '/api/v1/tasks/quick-log', args);
    case 'log_ad_hoc_task':
      return apiCall('POST', '/api/v1/instances/ad-hoc', args);
    case 'create_project_with_steps':
      return apiCall('POST', '/api/v1/projects', args);
    case 'complete_instance':
      return apiCall('POST', `/api/v1/instances/${encodeURIComponent(args.instanceId)}/complete`, {
        completed: true,
        notes: args.notes,
      });
    case 'claim_instance':
      return apiCall('POST', `/api/v1/instances/${encodeURIComponent(args.instanceId)}/claim`, {});
    case 'defer_instance':
      return apiCall('POST', `/api/v1/instances/${encodeURIComponent(args.instanceId)}/defer`, {
        days: args.days,
        untilDate: args.untilDate,
        reason: args.reason,
      });
    case 'get_weather_forecast':
      return apiCall('GET', '/api/v1/weather');
    case 'list_categories':
      return apiCall('GET', '/api/v1/categories');
    case 'create_category':
      return apiCall('POST', '/api/v1/categories', args);
    case 'update_task': {
      const { taskId, ...patch } = args;
      return apiCall('PATCH', `/api/v1/tasks/${encodeURIComponent(taskId)}`, patch);
    }
    case 'move_tasks':
      return apiCall('POST', '/api/v1/tasks/reorder', { updates: args.updates || [] });
    case 'delete_task':
      return apiCall('DELETE', `/api/v1/tasks/${encodeURIComponent(args.taskId)}`);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function writeMessage(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = req;

  try {
    if (method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'home-hub-mcp', version: '2.0.0' },
        },
      });
    } else if (method === 'tools/list') {
      writeMessage({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const data = await callTool(params?.name, params?.arguments || {});
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] },
      });
    } else if (id !== undefined) {
      writeMessage({ jsonrpc: '2.0', id, result: {} });
    }
  } catch (err) {
    if (id !== undefined) {
      writeMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message || 'Tool execution failed' },
      });
    }
  }
});
