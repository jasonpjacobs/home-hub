import { makeId } from './schema.js';
import { addDays, isMemberEligibleForInstance, isOpenStatus } from './taskEngine.js';

export async function deliverExternalNotification(notification, env = process.env, { priority = 'default' } = {}) {
  let channel = 'in_app';
  let deliveryStatus = 'sent';

  // 1. Resend Email (works directly to personal @gmail.com inboxes!)
  if (env.RESEND_API_KEY && notification.memberEmail) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || 'Home Hub <onboarding@resend.dev>',
          to: [notification.memberEmail],
          subject: notification.subject,
          text: notification.body,
        }),
      });
      if (res.ok) {
        channel = 'email';
        deliveryStatus = 'sent';
      } else {
        deliveryStatus = `email_failed_${res.status}`;
      }
    } catch {
      deliveryStatus = 'email_error';
    }
  }

  // 2. ntfy.sh Free Mobile Push Notifications (zero account needed on iOS/Android!)
  if (env.NTFY_TOPIC_URL) {
    try {
      await fetch(env.NTFY_TOPIC_URL, {
        method: 'POST',
        headers: {
          Title: notification.subject,
          Priority: priority === 'urgent' ? 'high' : 'default',
          Tags: priority === 'urgent' ? 'warning,house' : 'house,calendar',
        },
        body: notification.body,
      });
      if (channel === 'in_app') channel = 'ntfy';
    } catch {
      // Non-fatal
    }
  }

  // 3. Webhook (Discord / Slack / Google Workspace Chat / generic JSON)
  if (env.REMINDER_WEBHOOK_URL) {
    try {
      const isGoogleChat = env.REMINDER_WEBHOOK_URL.includes('chat.googleapis.com');
      const payload = isGoogleChat
        ? {
            cardsV2: [
              {
                cardId: notification.id,
                card: {
                  header: {
                    title: notification.subject,
                    subtitle: priority === 'urgent' ? 'Urgent Household Reminder' : 'Home Hub Update',
                  },
                  sections: [
                    {
                      widgets: [{ textParagraph: { text: notification.body.replace(/\n/g, '<br>') } }],
                    },
                  ],
                },
              },
            ],
          }
        : {
            text: `**${notification.subject}**\n${notification.body}`,
            content: `**${notification.subject}**\n${notification.body}`,
            title: notification.subject,
            message: notification.body,
          };

      await fetch(env.REMINDER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (channel === 'in_app') channel = isGoogleChat ? 'google_chat' : 'webhook';
    } catch {
      // Non-fatal
    }
  }

  return { channel, deliveryStatus };
}

export function buildDailyDigestNotifications({
  household,
  members,
  instances,
  weatherAlerts = [],
  todayStr,
  appUrl = 'http://localhost:3001',
}) {
  const activeMembers = members.filter((m) => m.active !== false && m.notifyEmail !== false);
  const weekLimit = addDays(todayStr, 7);
  const monthLimit = addDays(todayStr, 31);
  const now = new Date().toISOString();
  const created = [];

  const byDeadline = (a, b) => {
    const aEnd = a.windowEndDate || a.dueDate || '';
    const bEnd = b.windowEndDate || b.dueDate || '';
    if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
    return (a.taskTitle || '').localeCompare(b.taskTitle || '');
  };

  for (const member of activeMembers) {
    const showEffort = Boolean(member.showEffortAndFairness);
    const mine = instances.filter(
      (i) =>
        isOpenStatus(i.status) &&
        i.status !== 'on_hold' &&
        i.status !== 'gated' &&
        i.visibility !== 'private' &&
        (i.assigneeId === member.id || (!i.assigneeId && isMemberEligibleForInstance(i, member.id))),
    );

    const overdue = mine
      .filter((i) => {
        const end = i.windowEndDate || i.dueDate;
        return Boolean(end) && end < todayStr;
      })
      .sort(byDeadline);

    const dueToday = mine
      .filter((i) => {
        const end = i.windowEndDate || i.dueDate;
        return Boolean(end) && end === todayStr;
      })
      .sort(byDeadline);

    const thisWeek = mine
      .filter((i) => {
        const end = i.windowEndDate || i.dueDate;
        return Boolean(end) && end > todayStr && end <= weekLimit;
      })
      .sort(byDeadline);

    const thisMonth = mine
      .filter((i) => {
        const end = i.windowEndDate || i.dueDate;
        return Boolean(end) && end > weekLimit && end <= monthLimit;
      })
      .sort(byDeadline);

    const urgentWeather = weatherAlerts.filter((w) => w.urgency === 'urgent' && w.visibility !== 'private');
    const headsUpWeather = weatherAlerts.filter((w) => w.urgency === 'heads_up' && w.visibility !== 'private');

    const formatItem = (a, { includeDeadline = true } = {}) => {
      const end = a.windowEndDate || a.dueDate;
      const isFlexible = Boolean(a.windowEndDate && a.windowEndDate !== a.dueDate);
      const who = a.assigneeId ? a.assigneeName?.split(' ')[0] || '' : 'Anyone';
      const meta = [];
      if (a.categoryPath) meta.push(a.categoryPath);
      if (showEffort && a.effort) meta.push(`${a.effort} ${a.effort === 1 ? 'pt' : 'pts'}`);
      const details = [];
      if (includeDeadline && end) details.push(isFlexible ? `due by ${end}` : `due ${end}`);
      if (who) details.push(who);
      const bracket = meta.length > 0 ? ` [${meta.join(', ')}]` : '';
      const paren = details.length > 0 ? ` (${details.join(' · ')})` : '';
      return `• ${a.taskTitle}${bracket}${paren}`;
    };

    const sections = [];
    if (urgentWeather.length > 0) {
      sections.push(
        `URGENT Weather (1–3 days):\n${urgentWeather.map((w) => `• ${w.taskTitle} — ${w.summary}`).join('\n')}`,
      );
    }
    if (headsUpWeather.length > 0) {
      sections.push(
        `Weather Heads-Up (4–10 days):\n${headsUpWeather.map((w) => `• ${w.taskTitle} — ${w.summary}`).join('\n')}`,
      );
    }
    if (overdue.length > 0) {
      sections.push(`Overdue (${overdue.length}):\n${overdue.map((a) => formatItem(a)).join('\n')}`);
    }
    if (dueToday.length > 0) {
      sections.push(
        `Today (${dueToday.length}):\n${dueToday.map((a) => formatItem(a, { includeDeadline: false })).join('\n')}`,
      );
    }
    if (thisWeek.length > 0) {
      sections.push(
        `This Week (${thisWeek.length}):\n${thisWeek.map((a) => formatItem(a)).join('\n')}`,
      );
    }
    if (thisMonth.length > 0) {
      sections.push(
        `This Month (${thisMonth.length}):\n${thisMonth.map((a) => formatItem(a)).join('\n')}`,
      );
    }
    if (sections.length === 0) {
      sections.push('All caught up! Nothing due today, this week, or this month.');
    }
    sections.push(`Open Daily Cockpit: ${appUrl}`);

    created.push({
      id: makeId('ntf'),
      householdId: household.id,
      memberId: member.id,
      memberEmail: member.email,
      type: 'daily_digest',
      subject: `Daily Cockpit Digest (${todayStr}) — ${household.name}`,
      body: sections.join('\n\n'),
      channel: 'in_app',
      deliveryStatus: 'queued',
      readAt: '',
      createdAt: now,
      _priority: urgentWeather.length > 0 || overdue.length > 0 ? 'urgent' : 'default',
    });
  }

  return created;
}

export function buildOverdueAlertNotifications({
  household,
  members,
  instances,
  existingNotifications,
  todayStr,
  appUrl = 'http://localhost:3001',
}) {
  const activeMembers = members.filter((m) => m.active !== false);
  const memberMap = new Map(activeMembers.map((m) => [m.id, m]));
  const overdueByMember = new Map();

  // Only escalate active carry_over tasks (skip on_hold/gated tasks parked intentionally)
  for (const inst of instances) {
    if (inst.visibility === 'private') continue;
    if (inst.status !== 'pending' && inst.status !== 'started') continue;
    if ((inst.overduePolicy || 'carry_over') !== 'carry_over') continue;
    const endDate = inst.windowEndDate || inst.dueDate;
    if (!endDate || endDate >= todayStr) continue;

    const recipients = inst.assigneeId
      ? [inst.assigneeId]
      : activeMembers.filter((m) => isMemberEligibleForInstance(inst, m.id)).map((m) => m.id);

    for (const rid of recipients) {
      if (!memberMap.has(rid)) continue;
      const list = overdueByMember.get(rid) || [];
      list.push(inst);
      overdueByMember.set(rid, list);
    }
  }

  const now = new Date().toISOString();
  const created = [];

  for (const [memberId, items] of overdueByMember.entries()) {
    const member = memberMap.get(memberId);
    const alreadySentToday = existingNotifications.some(
      (n) =>
        n.memberId === memberId &&
        n.type === 'overdue_alert' &&
        String(n.createdAt || '').startsWith(todayStr),
    );
    if (alreadySentToday) continue;

    const summary = items.map((a) => `• ${a.taskTitle} (due ${a.dueDate})`).join('\n');
    created.push({
      id: makeId('ntf'),
      householdId: household.id,
      memberId: member.id,
      memberEmail: member.email,
      type: 'overdue_alert',
      subject: `Overdue Tasks (${items.length}) — ${household.name}`,
      body: `Hi ${member.name.split(' ')[0]}, these must-complete tasks are overdue:\n${summary}\n\nOpen Home Hub: ${appUrl}`,
      channel: 'in_app',
      deliveryStatus: 'queued',
      readAt: '',
      createdAt: now,
      _priority: 'urgent',
    });
  }

  return created;
}
