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
  const soonDateStr = addDays(todayStr, 3);
  const now = new Date().toISOString();
  const created = [];

  for (const member of activeMembers) {
    const showEffort = Boolean(member.showEffortAndFairness);
    const mine = instances.filter(
      (i) =>
        isOpenStatus(i.status) &&
        i.status !== 'on_hold' &&
        i.visibility !== 'private' &&
        (i.assigneeId === member.id || (!i.assigneeId && isMemberEligibleForInstance(i, member.id))),
    );

    const overdue = mine.filter((i) => (i.windowEndDate || i.dueDate) < todayStr);
    const dueToday = mine.filter(
      (i) => i.dueDate <= todayStr && (i.windowEndDate || i.dueDate) >= todayStr && i.windowType === 'daily',
    );
    const openRadar = mine.filter((i) => !i.assigneeId && i.assignmentMode === 'open_pool');
    const upcoming = mine.filter((i) => i.dueDate > todayStr && i.dueDate <= soonDateStr && i.assigneeId === member.id);

    const urgentWeather = weatherAlerts.filter((w) => w.urgency === 'urgent' && w.visibility !== 'private');
    const headsUpWeather = weatherAlerts.filter((w) => w.urgency === 'heads_up' && w.visibility !== 'private');

    const lines = [];
    if (urgentWeather.length > 0) {
      lines.push(
        `URGENT Weather (1-3 days): ${urgentWeather.map((w) => `${w.taskTitle} — ${w.summary}`).join('; ')}`,
      );
    }
    if (headsUpWeather.length > 0) {
      lines.push(
        `Weather Heads-Up (4-10 days): ${headsUpWeather.map((w) => `${w.taskTitle} — ${w.summary}`).join('; ')}`,
      );
    }
    if (overdue.length > 0) {
      lines.push(
        `Overdue (${overdue.length}): ${overdue.map((a) => `${a.taskTitle} (due ${a.dueDate})`).join('; ')}`,
      );
    }
    if (dueToday.length > 0) {
      lines.push(
        `Due Today (${dueToday.length}): ${dueToday
          .map((a) =>
            showEffort
              ? `${a.taskTitle} [${a.categoryPath}, ${a.effort} ${a.effort === 1 ? 'pt' : 'pts'}]`
              : `${a.taskTitle} [${a.categoryPath}]`,
          )
          .join('; ')}`,
      );
    }
    if (openRadar.length > 0) {
      lines.push(
        `Open for Anyone (${openRadar.length}): ${openRadar.slice(0, 4).map((a) => a.taskTitle).join(', ')}`,
      );
    }
    if (upcoming.length > 0) {
      lines.push(
        `Next 3 Days (${upcoming.length}): ${upcoming.map((a) => `${a.taskTitle} (${a.dueDate})`).join('; ')}`,
      );
    }
    if (lines.length === 0) {
      lines.push('All caught up! Nothing urgent on your Daily Cockpit today.');
    }
    lines.push(`Open Daily Cockpit: ${appUrl}`);

    created.push({
      id: makeId('ntf'),
      householdId: household.id,
      memberId: member.id,
      memberEmail: member.email,
      type: 'daily_digest',
      subject: `Daily Cockpit Digest (${todayStr}) — ${household.name}`,
      body: lines.join('\n'),
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
    if (endDate >= todayStr) continue;

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
