export function buildOpenApiSpec(baseUrl = 'http://localhost:3001') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Home Hub Agent & Automation API',
      version: '2.0.0',
      description:
        'Scoped REST API allowing AI agents and external services to read the household Daily Cockpit, manage hierarchical tasks & multi-step projects, check weather-triggered alerts, and log completions against federated Google Sheets.',
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Scoped API key generated in Home Hub Settings (format: hh_live_...)',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/cockpit': {
        get: {
          summary: 'Get Daily Cockpit snapshot',
          description:
            'Returns due/overdue tasks, open claimable radar tasks, weather-triggered alerts (urgent 1-3d & heads-up 4-10d), favorited quick-complete tasks, active project steps, and items needing details.',
          responses: { '200': { description: 'Cockpit snapshot JSON' } },
        },
      },
      '/api/v1/tasks': {
        get: {
          summary: 'List tasks',
          parameters: [
            { name: 'visibility', in: 'query', schema: { type: 'string', enum: ['all', 'household', 'private'] } },
            { name: 'categoryId', in: 'query', schema: { type: 'string' } },
            { name: 'projectId', in: 'query', schema: { type: 'string' } },
            { name: 'needsDetails', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'List of tasks' } },
        },
        post: {
          summary: 'Create a new task',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    categoryId: { type: 'string' },
                    projectId: { type: 'string' },
                    visibility: { type: 'string', enum: ['household', 'private'] },
                    isFavorite: { type: 'boolean' },
                    effort: { type: 'integer', minimum: 1, maximum: 5 },
                    cadenceMode: { type: 'string', enum: ['strict_date', 'flexible_window', 'weather_triggered'] },
                    recurrenceType: {
                      type: 'string',
                      enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'seasonal', 'yearly', 'custom_days', 'once'],
                    },
                    targetSeason: { type: 'string', enum: ['', 'spring', 'summer', 'fall', 'winter'] },
                    weatherTrigger: {
                      type: 'string',
                      enum: ['none', 'rain_soon', 'freeze_soon', 'snow_soon', 'high_wind', 'heat_wave', 'dry_clear_day'],
                    },
                    overduePolicy: { type: 'string', enum: ['carry_over', 'auto_skip', 'roll_forward'] },
                    assignmentMode: { type: 'string', enum: ['fixed', 'open_pool', 'round_robin', 'auto_balanced'] },
                    eligibleMemberIds: { type: 'array', items: { type: 'string' } },
                    fixedMemberId: { type: 'string' },
                    firstDueDate: { type: 'string', format: 'date' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created task & initial instance' } },
        },
      },
      '/api/v1/tasks/bulk': {
        post: {
          summary: 'Bulk-create multiple tasks at once',
          description: 'Ideal for AI agents setting up seasonal checklists, room routines, or onboarding a household.',
          responses: { '201': { description: 'Created tasks array' } },
        },
      },
      '/api/v1/tasks/quick-log': {
        post: {
          summary: 'Free-form quick capture or instant completion',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['text'],
                  properties: {
                    text: { type: 'string' },
                    mode: { type: 'string', enum: ['complete_now', 'add_inbox'] },
                    visibility: { type: 'string', enum: ['household', 'private'] },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Logged quick task & instance' } },
        },
      },
      '/api/v1/projects': {
        get: { summary: 'List projects and step progress', responses: { '200': { description: 'Projects list' } } },
        post: {
          summary: 'Create a multi-step project (optionally with initial steps)',
          responses: { '201': { description: 'Created project & steps' } },
        },
      },
      '/api/v1/projects/{id}/steps': {
        post: {
          summary: 'Add one or more assignable steps to a project',
          responses: { '201': { description: 'Added steps' } },
        },
      },
      '/api/v1/categories': {
        get: { summary: 'List hierarchical categories', responses: { '200': { description: 'Categories list' } } },
        post: { summary: 'Create a category or subcategory', responses: { '201': { description: 'Created category' } } },
      },
      '/api/v1/categories/{id}': {
        patch: { summary: 'Rename or re-parent a category or subcategory', responses: { '200': { description: 'Updated category' } } },
        delete: { summary: 'Delete a category (promotes subcategories/tasks to its parent)', responses: { '200': { description: 'Deleted' } } },
      },
      '/api/v1/instances': {
        get: { summary: 'List scheduled/active task instances', responses: { '200': { description: 'Instances list' } } },
      },
      '/api/v1/instances/{id}': {
        patch: {
          summary: 'Update instance status (pending, started, on_hold, gated, completed, skipped), notes, assigneeId, or dueDate',
          responses: { '200': { description: 'Updated instance' } },
        },
      },
      '/api/v1/instances/ad-hoc': {
        post: {
          summary: 'Log an ad-hoc completed record ("Hey, I did this — keep a record") without creating a recurring task',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    categoryId: { type: 'string' },
                    visibility: { type: 'string', enum: ['household', 'private'] },
                    date: { type: 'string', format: 'date' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Logged ad-hoc record' } },
        },
      },
      '/api/v1/instances/{id}/complete': {
        post: { summary: 'Mark a task instance complete (auto-schedules next cycle if recurring)', responses: { '200': { description: 'Updated instance' } } },
      },
      '/api/v1/instances/{id}/claim': {
        post: { summary: 'Claim an open radar task instance', responses: { '200': { description: 'Claimed instance' } } },
      },
      '/api/v1/instances/{id}/skip': {
        post: { summary: 'Skip a task instance', responses: { '200': { description: 'Skipped instance' } } },
      },
      '/api/v1/instances/{id}/defer': {
        post: {
          summary: 'Defer a task instance to a later date (days offset or explicit YYYY-MM-DD)',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    days: { type: 'integer', minimum: 1 },
                    untilDate: { type: 'string', format: 'date' },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Deferred instance' } },
        },
      },
      '/api/v1/weather': {
        get: {
          summary: 'Get 10-day weather forecast and active weather-triggered alerts (urgent 1-3d & heads-up 4-10d)',
          responses: { '200': { description: 'Forecast & alerts' } },
        },
      },
    },
  };
}
