import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Check,
  CheckCheck,
  CloudRain,
  Copy,
  Download,
  Edit3,
  KeyRound,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Scale,
  Send,
  Smartphone,
  Sparkles,
  Table2,
  Trash2,
  UserPlus,
  Users,
  Webhook,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { DashboardData, Member, RebalancePlan } from '../types';

type SubTab = 'general' | 'members' | 'reminders' | 'sheets' | 'agent_api' | 'fairness';

const AVATAR_COLORS = [
  '#2D6A4F',
  '#C86D51',
  '#3B6E8C',
  '#8B5E83',
  '#B07D2B',
  '#4A7C59',
  '#9C4A5B',
  '#4F5D75',
];

const CAPACITY_OPTIONS = [
  { value: 1.0, label: '100% (Full share)' },
  { value: 0.75, label: '75% (Busy)' },
  { value: 0.5, label: '50% (Half / Kids)' },
  { value: 0.25, label: '25% (Light)' },
];

interface Props {
  data: DashboardData;
  initialSubTab?: SubTab;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

const APPS_SCRIPT_V2 = `// Paste into Extensions -> Apps Script in EITHER your Shared Household Sheet
// OR your Personal Private Sheet. Deploy -> New deployment -> Web app (Execute as: Me, Access: Anyone).
const API_TOKEN = '';
const ALLOWED_TABS = ['Households','Members','Invites','ApiKeys','Categories','Projects','Tasks','TaskInstances','Notifications'];

function checkToken(token) {
  if (API_TOKEN && token !== API_TOKEN) throw new Error('Invalid API token');
}
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.setFrozenRows(1); }
  return sheet;
}
function doGet(e) {
  try {
    checkToken((e && e.parameter && e.parameter.token) || '');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = {};
    ss.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (ALLOWED_TABS.indexOf(name) === -1) return;
      tabs[name] = sheet.getDataRange().getValues().map(function (row) {
        return row.map(function (c) { return c instanceof Date ? c.toISOString() : String(c == null ? '' : c); });
      });
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, tabs })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkToken(payload.token || '');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = payload.tabs || {};
    Object.keys(tabs).forEach(function (name) {
      if (ALLOWED_TABS.indexOf(name) === -1) return;
      var rows = tabs[name];
      var sheet = getOrCreateSheet(ss, name);
      sheet.clearContents();
      if (rows && rows.length > 0 && rows[0].length > 0) {
        sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
        sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  } finally { lock.releaseLock(); }
}`;

export function SettingsView({ data, initialSubTab = 'general', onRefresh, onToast }: Props) {
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // Weather & household form
  const [householdName, setHouseholdName] = useState(data.household.name || '');
  const [locationName, setLocationName] = useState(data.household.locationName || '');
  const [latitude, setLatitude] = useState(data.household.latitude != null ? String(data.household.latitude) : '');
  const [longitude, setLongitude] = useState(data.household.longitude != null ? String(data.household.longitude) : '');
  const [simWeather, setSimWeather] = useState(data.household.simulatedWeather || '');
  const [digestTime, setDigestTime] = useState(data.household.digestTime || '08:00');
  const [timezone, setTimezone] = useState(data.household.timezone || 'America/Los_Angeles');

  // Member add/edit state
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemName, setNewMemName] = useState('');
  const [newMemEmail, setNewMemEmail] = useState('');
  const [newMemPassword, setNewMemPassword] = useState('');
  const [newMemGroup, setNewMemGroup] = useState<'partner' | 'roommate' | 'kid'>('partner');
  const [newMemRole, setNewMemRole] = useState<'member' | 'admin'>('member');
  const [newMemColor, setNewMemColor] = useState(AVATAR_COLORS[0]);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemName, setEditMemName] = useState('');
  const [editMemEmail, setEditMemEmail] = useState('');
  const [editMemGroup, setEditMemGroup] = useState<'partner' | 'roommate' | 'kid'>('partner');
  const [editMemRole, setEditMemRole] = useState<'admin' | 'member'>('member');
  const [editMemColor, setEditMemColor] = useState(AVATAR_COLORS[0]);
  const [editMemCapacity, setEditMemCapacity] = useState(1.0);
  const [editMemNotify, setEditMemNotify] = useState(true);

  // Personal private sheet form
  const [privateSheetUrl, setPrivateSheetUrl] = useState(data.user.privateSheetUrl || '');
  const [privateSheetToken, setPrivateSheetToken] = useState('');
  const [copiedScript, setCopiedScript] = useState(false);

  // Invites
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Agent API keys
  const [keyName, setKeyName] = useState('Antigravity Assistant');
  const [keyAllowPrivate, setKeyAllowPrivate] = useState(false);
  const [newSecretKey, setNewSecretKey] = useState<string | null>(null);

  // Fairness rebalance
  const [includeFixed, setIncludeFixed] = useState(false);
  const [preview, setPreview] = useState<RebalancePlan | null>(null);

  // Account password update
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      onToast('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast('New passwords do not match.');
      return;
    }
    setWorking(true);
    try {
      await api.changePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onToast('Password updated!');
    } catch (err: any) {
      onToast(err.message || 'Could not update password.');
    } finally {
      setWorking(false);
    }
  }

  async function toggleMyFairness() {
    setWorking(true);
    try {
      const next = !data.user.showEffortAndFairness;
      await api.updateMember(data.user.id, { showEffortAndFairness: next });
      await onRefresh();
      onToast(
        next
          ? 'Effort weights & Fairness tools enabled for your account.'
          : 'Effort weights & Fairness tools hidden for your account.',
      );
    } finally {
      setWorking(false);
    }
  }

  async function saveHouseholdAndWeather(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    try {
      await api.updateHousehold({
        name: householdName.trim() || data.household.name,
        locationName,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        simulatedWeather: simWeather,
        digestTime,
        timezone,
      });
      await onRefresh();
      onToast('Saved household & 10-day weather forecast settings.');
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  function startEditingMember(m: Member) {
    setEditingMemberId(m.id);
    setEditMemName(m.name);
    setEditMemEmail(m.email);
    setEditMemGroup(m.memberGroup || 'partner');
    setEditMemRole(m.role);
    setEditMemColor(m.avatarColor || AVATAR_COLORS[0]);
    setEditMemCapacity(m.weeklyCapacity || 1.0);
    setEditMemNotify(m.notifyEmail !== false);
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!newMemName.trim()) return;
    setWorking(true);
    try {
      const res = await api.createMember({
        name: newMemName.trim(),
        email: newMemEmail.trim() || undefined,
        password: newMemPassword.trim() || undefined,
        memberGroup: newMemGroup,
        role: newMemRole,
        avatarColor: newMemColor,
      });
      setNewMemName('');
      setNewMemEmail('');
      setNewMemPassword('');
      setShowAddMember(false);
      await onRefresh();
      onToast(`Added ${res.member.name} to ${data.household.name}!`);
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveMember(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMemberId || !editMemName.trim()) return;
    setWorking(true);
    try {
      await api.updateMember(editingMemberId, {
        name: editMemName.trim(),
        email: editMemEmail.trim(),
        memberGroup: editMemGroup,
        role: editMemRole,
        avatarColor: editMemColor,
        weeklyCapacity: editMemCapacity,
        notifyEmail: editMemNotify,
      });
      setEditingMemberId(null);
      await onRefresh();
      onToast(`Saved changes for ${editMemName.trim()}.`);
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleToggleMemberActive(m: Member) {
    setWorking(true);
    try {
      await api.updateMember(m.id, { active: !m.active });
      await onRefresh();
      onToast(m.active ? `Marked ${m.name.split(' ')[0]} as Away.` : `${m.name.split(' ')[0]} is Active again.`);
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteMember(m: Member) {
    if (
      !window.confirm(
        `Remove ${m.name} from ${data.household.name}? Any pending tasks assigned to them will be set to Anyone.`,
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      await api.deleteMember(m.id);
      if (editingMemberId === m.id) setEditingMemberId(null);
      await onRefresh();
      onToast(`Removed ${m.name}.`);
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function savePersonalSheet(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    try {
      await api.updatePrivateSheet({ privateSheetUrl, privateSheetToken });
      await onRefresh();
      onToast(
        privateSheetUrl
          ? 'Connected your Personal Private Google Sheet!'
          : 'Switched private tasks back to local isolated Personal Sheet mirror.',
      );
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    try {
      const { invite, inviteUrl } = await api.createInvite({
        email: inviteEmail.trim() || undefined,
        role: inviteRole,
      });
      setInviteEmail('');
      await onRefresh();
      await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
      setCopiedCode(invite.code);
      setTimeout(() => setCopiedCode(null), 2000);
      onToast('Invite link created & copied!');
    } finally {
      setWorking(false);
    }
  }

  async function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    try {
      const res = await api.createApiKey({
        name: keyName.trim() || 'AI Agent Key',
        allowPrivate: keyAllowPrivate,
      });
      setNewSecretKey(res.secretKey);
      await onRefresh();
      onToast('API key generated! Copy it now — it is only shown once.');
    } catch (err: any) {
      onToast(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleRunReminders(type: 'daily_digest' | 'overdue_alert') {
    setWorking(true);
    try {
      const res = await api.runReminders(type, true);
      await onRefresh();
      onToast(`Sent ${res.sentCount} ${type === 'daily_digest' ? 'digest' : 'overdue alert'} notification(s).`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings, Sheets &amp; Integrations</h1>
          <p className="page-subtitle">
            Personal preferences, 10-day weather triggers, federated Google Sheets, reminders, and
            the AI Agent API.
          </p>
        </div>
      </div>

      <div className="tabs-bar">
        <button type="button" className={`tab-btn ${subTab === 'general' ? 'active' : ''}`} onClick={() => setSubTab('general')}>
          Preferences &amp; Weather
        </button>
        <button type="button" className={`tab-btn ${subTab === 'members' ? 'active' : ''}`} onClick={() => setSubTab('members')}>
          Members ({data.members.length})
        </button>
        <button type="button" className={`tab-btn ${subTab === 'reminders' ? 'active' : ''}`} onClick={() => setSubTab('reminders')}>
          Reminders ({data.notifications.filter((n) => n.memberId === data.user.id && !n.readAt).length})
        </button>
        <button type="button" className={`tab-btn ${subTab === 'sheets' ? 'active' : ''}`} onClick={() => setSubTab('sheets')}>
          Federated Google Sheets
        </button>
        <button type="button" className={`tab-btn ${subTab === 'agent_api' ? 'active' : ''}`} onClick={() => setSubTab('agent_api')}>
          AI Agent API &amp; MCP
        </button>
        {data.user.showEffortAndFairness && (
          <button type="button" className={`tab-btn ${subTab === 'fairness' ? 'active' : ''}`} onClick={() => setSubTab('fairness')}>
            Fairness &amp; Rebalance
          </button>
        )}
      </div>

      {/* GENERAL, PER-USER FAIRNESS & WEATHER */}
      {subTab === 'general' && (
        <div className="form-grid" style={{ gap: 20 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Scale size={18} /> My Personal Preference: Effort &amp; Fairness Tools
                </h3>
                <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Off by default for a calm checklist. Turning this on shows effort points (1–5 pts),
                  rolling workload bars, and Auto-Rebalance <strong>only for your account</strong> ({data.user.name}).
                </p>
              </div>
              <button
                type="button"
                className={`btn ${data.user.showEffortAndFairness ? 'btn-primary' : 'btn-secondary'}`}
                onClick={toggleMyFairness}
                disabled={working}
              >
                {data.user.showEffortAndFairness ? 'Enabled for Me (Turn Off)' : 'Disabled for Me (Enable)'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <CloudRain size={18} /> Household Profile &amp; 10-Day Weather Triggers
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              Uses free Open-Meteo 10-day forecasts: <strong>4–10 days out</strong> creates a gentle
              heads-up reminder, and <strong>1–3 days out</strong> escalates to an urgent Cockpit alert.
            </p>
            <form onSubmit={saveHouseholdAndWeather} className="form-grid">
              <div className="form-row-2">
                <div className="field">
                  <label htmlFor="hh-edit-name">Household Name</label>
                  <input
                    id="hh-edit-name"
                    className="input"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="sim-weather">Forecast Mode</label>
                  <select
                    id="sim-weather"
                    className="select"
                    value={simWeather}
                    onChange={(e) => setSimWeather(e.target.value)}
                  >
                    {data.weather.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row-2">
                <div className="field">
                  <label htmlFor="loc-name">Location Label</label>
                  <input id="loc-name" className="input" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Seattle, WA" />
                </div>
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor="loc-lat">Latitude</label>
                    <input id="loc-lat" className="input" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="47.6062" />
                  </div>
                  <div className="field">
                    <label htmlFor="loc-lon">Longitude</label>
                    <input id="loc-lon" className="input" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="-122.3321" />
                  </div>
                </div>
              </div>
              <div className="form-row-2">
                <div className="field">
                  <label htmlFor="dig-time">Daily Digest Time</label>
                  <input id="dig-time" type="time" className="input" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="hh-tz">Timezone</label>
                  <input id="hh-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                </div>
              </div>
              <div>
                <button type="submit" className="btn btn-primary" disabled={working}>
                  Save Household &amp; Weather Settings
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <KeyRound size={17} /> Account Password
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              Update your password anytime (leave Current Password blank if you just signed in with a Magic Link).
            </p>
            <form onSubmit={handleChangePassword} className="form-grid" style={{ maxWidth: 520 }}>
              <div className="field">
                <label htmlFor="pw-cur">Current Password (optional after Magic Link)</label>
                <input
                  id="pw-cur"
                  type="password"
                  className="input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>
              <div className="form-row-2">
                <div className="field">
                  <label htmlFor="pw-new">New Password</label>
                  <input
                    id="pw-new"
                    type="password"
                    className="input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    placeholder="At least 6 characters"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="pw-confirm">Confirm New Password</label>
                  <input
                    id="pw-confirm"
                    type="password"
                    className="input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={6}
                    placeholder="Repeat new password"
                    required
                  />
                </div>
              </div>
              <div>
                <button type="submit" className="btn btn-secondary" disabled={working}>
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HOUSEHOLD MEMBERS & INVITES */}
      {subTab === 'members' && (
        <div className="form-grid" style={{ gap: 20 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Users size={18} /> Household Members ({data.members.length})
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Configure names, groups (partner/roommate/kid), roles, avatar colors, email reminders, and away/vacation pauses.
                </p>
              </div>
              {data.user.role === 'admin' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowAddMember((v) => !v)}
                >
                  <Plus size={14} /> Add Member Directly
                </button>
              )}
            </div>

            {showAddMember && data.user.role === 'admin' && (
              <form
                onSubmit={handleAddMember}
                className="form-grid"
                style={{
                  padding: 16,
                  background: 'var(--surface-subtle)',
                  borderRadius: 12,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Add Household Member (great for kids or quick setup)</strong>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddMember(false)}>
                    <X size={14} />
                  </button>
                </div>
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor="new-mem-name">Name</label>
                    <input
                      id="new-mem-name"
                      className="input"
                      placeholder="e.g., Jordan Chen"
                      value={newMemName}
                      onChange={(e) => setNewMemName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="new-mem-email">Email (optional)</label>
                    <input
                      id="new-mem-email"
                      type="email"
                      className="input"
                      placeholder="Optional — leave blank for managed profile"
                      value={newMemEmail}
                      onChange={(e) => setNewMemEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor="new-mem-group">Group</label>
                    <select
                      id="new-mem-group"
                      className="select"
                      value={newMemGroup}
                      onChange={(e) => setNewMemGroup(e.target.value as 'partner' | 'roommate' | 'kid')}
                    >
                      <option value="partner">Partner / Adult</option>
                      <option value="roommate">Roommate</option>
                      <option value="kid">Kid</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="new-mem-role">Permissions Role</label>
                    <select
                      id="new-mem-role"
                      className="select"
                      value={newMemRole}
                      onChange={(e) => setNewMemRole(e.target.value as 'member' | 'admin')}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <div className="form-row-2">
                  <div className="field">
                    <label htmlFor="new-mem-pw">Login Password (optional, 6+ chars)</label>
                    <input
                      id="new-mem-pw"
                      type="password"
                      className="input"
                      placeholder="Leave blank if using Magic Link or managed profile"
                      value={newMemPassword}
                      onChange={(e) => setNewMemPassword(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Avatar Color</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
                      {AVATAR_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setNewMemColor(hex)}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: hex,
                            border: newMemColor === hex ? '2.5px solid var(--text)' : '2px solid transparent',
                            cursor: 'pointer',
                          }}
                          aria-label={`Color ${hex}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddMember(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={working}>
                    Add Member
                  </button>
                </div>
              </form>
            )}

            <div className="chore-list">
              {data.members.map((m) => {
                const canEdit = data.user.role === 'admin' || m.id === data.user.id;
                const isEditing = editingMemberId === m.id;
                return (
                  <div key={m.id} className="card" style={{ padding: '12px 14px', opacity: m.active ? 1 : 0.68 }}>
                    {!isEditing ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span className="avatar" style={{ background: m.avatarColor }}>
                          {m.name.charAt(0)}
                        </span>
                        <div className="assignment-main">
                          <div className="assignment-title">
                            <span>{m.name}</span>
                            {m.id === data.user.id && <span className="tag primary">You</span>}
                            <span className="tag">{m.memberGroup}</span>
                            <span className="tag">{m.role}</span>
                            {!m.active && <span className="tag accent">Away / Paused</span>}
                            {data.user.showEffortAndFairness && (
                              <span className="tag">{Math.round((m.weeklyCapacity || 1) * 100)}% capacity</span>
                            )}
                          </div>
                          <div className="assignment-meta">
                            <span>{m.email}</span>
                            <span>&middot; Reminders: {m.notifyEmail !== false ? 'On' : 'Off'}</span>
                          </div>
                        </div>
                        <div className="assignment-controls">
                          {canEdit && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => startEditingMember(m)}
                            >
                              <Edit3 size={13} /> Edit
                            </button>
                          )}
                          {data.user.role === 'admin' && m.id !== data.user.id && (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleToggleMemberActive(m)}
                              >
                                {m.active ? 'Mark Away' : 'Set Active'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger-ghost btn-sm"
                                onClick={() => handleDeleteMember(m)}
                                title={`Remove ${m.name}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleSaveMember} className="form-grid">
                        <div className="form-row-2">
                          <div className="field">
                            <label>Name</label>
                            <input
                              className="input"
                              value={editMemName}
                              onChange={(e) => setEditMemName(e.target.value)}
                              required
                            />
                          </div>
                          <div className="field">
                            <label>Email</label>
                            <input
                              type="email"
                              className="input"
                              value={editMemEmail}
                              onChange={(e) => setEditMemEmail(e.target.value)}
                              required
                            />
                          </div>
                        </div>
                        <div className="form-row-2">
                          <div className="field">
                            <label>Group</label>
                            <select
                              className="select"
                              value={editMemGroup}
                              onChange={(e) => setEditMemGroup(e.target.value as 'partner' | 'roommate' | 'kid')}
                            >
                              <option value="partner">Partner / Adult</option>
                              <option value="roommate">Roommate</option>
                              <option value="kid">Kid</option>
                            </select>
                          </div>
                          {data.user.role === 'admin' && (
                            <div className="field">
                              <label>Role</label>
                              <select
                                className="select"
                                value={editMemRole}
                                onChange={(e) => setEditMemRole(e.target.value as 'admin' | 'member')}
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="form-row-2">
                          {data.user.showEffortAndFairness && (
                            <div className="field">
                              <label>Weekly Capacity</label>
                              <select
                                className="select"
                                value={editMemCapacity}
                                onChange={(e) => setEditMemCapacity(Number(e.target.value))}
                              >
                                {CAPACITY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="field">
                            <label>Avatar Color</label>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
                              {AVATAR_COLORS.map((hex) => (
                                <button
                                  key={hex}
                                  type="button"
                                  onClick={() => setEditMemColor(hex)}
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    background: hex,
                                    border: editMemColor === hex ? '2.5px solid var(--text)' : '2px solid transparent',
                                    cursor: 'pointer',
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.84rem' }}>
                            <input
                              type="checkbox"
                              checked={editMemNotify}
                              onChange={(e) => setEditMemNotify(e.target.checked)}
                            />
                            Receive daily digests &amp; overdue reminders
                          </label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setEditingMemberId(null)}
                            >
                              Cancel
                            </button>
                            <button type="submit" className="btn btn-primary btn-sm" disabled={working}>
                              Save Member
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 6 }}>Shareable Invite Links</h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              Send a private invite link so partners or roommates can create their own login and password.
            </p>
            <form onSubmit={handleCreateInvite} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <input
                type="email"
                className="input"
                style={{ flex: 2, minWidth: 200 }}
                placeholder="Email (optional — leave blank for anyone with link)"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <select className="select" style={{ width: 130 }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="btn btn-primary btn-sm" disabled={working}>
                <UserPlus size={14} /> Create &amp; Copy Link
              </button>
            </form>

            {data.invites.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.invites.map((inv) => (
                  <div
                    key={inv.code}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: 9,
                      background: 'var(--surface-subtle)',
                      fontSize: '0.84rem',
                    }}
                  >
                    <div>
                      <strong>{inv.code}</strong> <span className="tag">{inv.role}</span>{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        {inv.email ? `Reserved for ${inv.email}` : 'Open invite'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          await navigator.clipboard?.writeText(`${window.location.origin}/?invite=${inv.code}`).catch(() => {});
                          setCopiedCode(inv.code);
                          setTimeout(() => setCopiedCode(null), 1800);
                          onToast('Copied invite link!');
                        }}
                      >
                        {copiedCode === inv.code ? <Check size={13} /> : <Copy size={13} />} Copy Link
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-ghost btn-sm"
                        onClick={async () => {
                          await api.deleteInvite(inv.code);
                          await onRefresh();
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* REMINDERS & PERSONAL GMAIL DELIVERY */}
      {subTab === 'reminders' && (
        <div className="form-grid" style={{ gap: 18 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <h3>Personal Household Delivery Channels</h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Tailored for personal `@gmail.com` households (since consumer Google Chat does not
                  support Space webhooks).
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleRunReminders('overdue_alert')} disabled={working}>
                  <AlertTriangle size={14} /> Check Overdue
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleRunReminders('daily_digest')} disabled={working}>
                  <Send size={14} /> Send Daily Digest Now
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
              <div className="banner success">
                <Bell size={17} style={{ flexShrink: 0 }} />
                <div>
                  <strong>In-App + Sheet Log</strong>
                  <div style={{ fontSize: '0.79rem' }}>Always active.</div>
                </div>
              </div>
              <div className={`banner ${data.reminderChannels.emailConfigured ? 'success' : 'info'}`}>
                <Mail size={17} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Email (Resend)</strong>
                  <div style={{ fontSize: '0.79rem' }}>Set <code>RESEND_API_KEY</code> for direct Gmail digests (100/day free).</div>
                </div>
              </div>
              <div className={`banner ${data.reminderChannels.ntfyConfigured ? 'success' : 'info'}`}>
                <Smartphone size={17} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Phone Push (ntfy.sh)</strong>
                  <div style={{ fontSize: '0.79rem' }}>Set <code>NTFY_TOPIC_URL</code> for free iOS/Android push alerts (urgent weather &amp; overdue).</div>
                </div>
              </div>
              <div className={`banner ${data.reminderChannels.webhookConfigured ? 'success' : 'info'}`}>
                <Webhook size={17} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Chat Webhook</strong>
                  <div style={{ fontSize: '0.79rem' }}>Set <code>REMINDER_WEBHOOK_URL</code> (Discord, Slack, or Workspace Google Chat).</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3>Recent Notifications ({data.notifications.length})</h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  await api.markAllNotificationsRead();
                  await onRefresh();
                  onToast('Marked read.');
                }}
              >
                <CheckCheck size={14} /> Mark Mine Read
              </button>
            </div>
            <div className="chore-list">
              {data.notifications.map((n) => {
                const isUnread = n.memberId === data.user.id && !n.readAt;
                return (
                  <div
                    key={n.id}
                    className="assignment-row"
                    style={{
                      alignItems: 'flex-start',
                      borderLeft: isUnread ? '4px solid var(--accent)' : undefined,
                      background: isUnread ? '#fffaf7' : undefined,
                    }}
                  >
                    <div className="assignment-main">
                      <div className="assignment-title">
                        <span>{n.subject}</span>
                        {isUnread && <span className="tag accent">Unread</span>}
                        <span className="tag primary">{n.channel}</span>
                      </div>
                      <p style={{ whiteSpace: 'pre-line', fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        {n.body}
                      </p>
                      <div className="assignment-meta">
                        <span>{n.memberEmail}</span>
                        <span>&middot; {new Date(n.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* FEDERATED MULTI-SHEET SETTINGS */}
      {subTab === 'sheets' && (
        <div className="form-grid" style={{ gap: 18 }}>
          <div className="two-col">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Table2 size={18} /> Shared Household Sheet
                </h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    await api.syncSheet();
                    await onRefresh();
                    onToast('Synced Shared & Personal Sheets!');
                  }}
                >
                  <RefreshCw size={14} /> Sync Both
                </button>
              </div>
              <div className={`banner ${data.storage.shared.connected ? 'success' : 'warning'}`} style={{ marginBottom: 12 }}>
                <span>{data.storage.shared.label}</span>
              </div>
              <div className="chore-list">
                {data.storage.shared.tabs.map((t) => (
                  <div key={t.name} className="assignment-row" style={{ padding: '8px 11px' }}>
                    <div className="assignment-main">
                      <strong>{t.name}</strong>{' '}
                      <span className="tag">
                        {t.rowCount} {t.rowCount === 1 ? 'row' : 'rows'}
                      </span>
                    </div>
                    <a
                      href={`/api/sheet/export?scope=shared&tab=${encodeURIComponent(t.name)}`}
                      className="btn btn-secondary btn-sm"
                      style={{ textDecoration: 'none' }}
                    >
                      <Download size={13} /> CSV
                    </a>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Lock size={18} style={{ color: 'var(--private)' }} /> Your Personal Private Sheet
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Link your own separate Google Sheet so your <strong>Private</strong> categories,
                projects, and tasks never even exist in the Shared Household spreadsheet—while still
                appearing seamlessly in your unified Cockpit!
              </p>
              <div className={`banner ${data.storage.personal.connected ? 'success' : 'private'}`} style={{ marginBottom: 12 }}>
                <span>{data.storage.personal.label}</span>
              </div>

              <form onSubmit={savePersonalSheet} className="form-grid" style={{ marginBottom: 14 }}>
                <div className="field">
                  <label htmlFor="priv-url">Personal Apps Script Web App URL</label>
                  <input
                    id="priv-url"
                    className="input"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={privateSheetUrl}
                    onChange={(e) => setPrivateSheetUrl(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="priv-tok">Optional API Token</label>
                  <input
                    id="priv-tok"
                    className="input"
                    placeholder="Matches API_TOKEN in your personal Code.gs"
                    value={privateSheetToken}
                    onChange={(e) => setPrivateSheetToken(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={working}>
                  Save Personal Sheet Link
                </button>
              </form>

              <div className="chore-list">
                {data.storage.personal.tabs.map((t) => (
                  <div key={t.name} className="assignment-row" style={{ padding: '7px 10px' }}>
                    <div className="assignment-main">
                      <strong>{t.name}</strong>{' '}
                      <span className="tag private">
                        {t.rowCount} private {t.rowCount === 1 ? 'row' : 'rows'}
                      </span>
                    </div>
                    <a
                      href={`/api/sheet/export?scope=private&tab=${encodeURIComponent(t.name)}`}
                      className="btn btn-secondary btn-sm"
                      style={{ textDecoration: 'none' }}
                    >
                      <Download size={13} /> CSV
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3>Universal Google Apps Script (Works for Shared &amp; Personal Sheets)</h3>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(APPS_SCRIPT_V2).catch(() => {});
                  setCopiedScript(true);
                  setTimeout(() => setCopiedScript(false), 2000);
                  onToast('Copied v2 Code.gs!');
                }}
              >
                {copiedScript ? <Check size={14} /> : <Copy size={14} />} {copiedScript ? 'Copied' : 'Copy Code.gs'}
              </button>
            </div>
            <div className="code-box">{APPS_SCRIPT_V2}</div>
          </div>
        </div>
      )}

      {/* AI AGENT API & MCP */}
      {subTab === 'agent_api' && (
        <div className="form-grid" style={{ gap: 18 }}>
          <div className="two-col">
            <div className="card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <KeyRound size={18} /> Scoped Agent API Keys
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Generate bearer keys so AI agents (like Antigravity) or other web services can read
                your Cockpit, bulk-create seasonal tasks, or spin up multi-step Projects via{' '}
                <code>/api/v1/*</code>.
              </p>

              <form onSubmit={handleCreateApiKey} className="form-grid" style={{ marginBottom: 14 }}>
                <div className="field">
                  <label htmlFor="key-name">Key Label</label>
                  <input id="key-name" className="input" value={keyName} onChange={(e) => setKeyName(e.target.value)} required />
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.84rem' }}>
                  <input
                    type="checkbox"
                    checked={keyAllowPrivate}
                    onChange={(e) => setKeyAllowPrivate(e.target.checked)}
                  />
                  Allow access to my Private Personal Sheet tasks (off by default)
                </label>
                <button type="submit" className="btn btn-primary btn-sm" disabled={working}>
                  Generate API Key
                </button>
              </form>

              {newSecretKey && (
                <div className="banner success" style={{ flexDirection: 'column', marginBottom: 14 }}>
                  <strong>Copy your new API key now (shown only once):</strong>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.82rem' }}>{newSecretKey}</code>
                </div>
              )}

              {data.apiKeys.length > 0 && (
                <div className="chore-list">
                  {data.apiKeys.map((k) => (
                    <div key={k.id} className="assignment-row" style={{ padding: '8px 11px' }}>
                      <div className="assignment-main">
                        <div className="assignment-title" style={{ fontSize: '0.88rem' }}>
                          <span>{k.name}</span>
                          <span className="tag">{k.keyPrefix}...</span>
                          {k.allowPrivate && <span className="tag private">Private OK</span>}
                        </div>
                        <div className="assignment-meta">{k.scopes}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger-ghost btn-sm"
                        onClick={async () => {
                          await api.deleteApiKey(k.id);
                          await onRefresh();
                          onToast('API key revoked.');
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Bot size={18} /> OpenAPI 3.1 &amp; MCP Server
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Self-documenting OpenAPI spec:{' '}
                <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                  /api/v1/openapi.json
                </a>
              </p>
              <div className="code-box">{`# Example: Read your Daily Cockpit from any script or AI agent
curl -H "Authorization: Bearer hh_live_YOUR_KEY" \\
  ${window.location.origin}/api/v1/cockpit

# Connect Home Hub's built-in MCP server (mcp/server.js)
{
  "mcpServers": {
    "home-hub": {
      "command": "node",
      "args": ["mcp/server.js"],
      "env": {
        "HOME_HUB_URL": "${window.location.origin}",
        "HOME_HUB_API_KEY": "hh_live_YOUR_KEY"
      }
    }
  }
}`}</div>
            </div>
          </div>
        </div>
      )}

      {/* OPT-IN PER-USER FAIRNESS & REBALANCE */}
      {subTab === 'fairness' && data.user.showEffortAndFairness && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3>Rolling 14-Day Effort Balance (Shared Tasks Only)</h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Private tasks and unassigned "Anyone" items are automatically excluded from household load.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const p = await api.previewRebalance(includeFixed);
                  setPreview(p);
                }}
              >
                <Scale size={14} /> Preview Rebalance
              </button>
              {preview && (
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={async () => {
                    const res = await api.applyRebalance(includeFixed);
                    setPreview(null);
                    await onRefresh();
                    onToast(`Rebalanced ${res.appliedCount} task(s)!`);
                  }}
                >
                  <Sparkles size={14} /> Apply ({preview.changes.length})
                </button>
              )}
            </div>
          </div>

          {(preview ? preview.afterLoads : data.loads).map((l) => (
            <div key={l.memberId} className="load-row">
              <div className="load-header">
                <strong>
                  {l.name} ({l.memberGroup})
                </strong>
                <span style={{ fontSize: '0.84rem' }}>
                  {l.actualPercent}% actual / {l.targetPercent}% target ({l.totalPoints} pts)
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${Math.min(100, l.actualPercent)}%`, background: l.avatarColor }} />
                <div className="bar-target-marker" style={{ left: `${Math.min(99, l.targetPercent)}%` }} />
              </div>
            </div>
          ))}

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.84rem', marginTop: 12 }}>
            <input type="checkbox" checked={includeFixed} onChange={(e) => setIncludeFixed(e.target.checked)} />
            Also rebalance fixed-assignee tasks
          </label>

          {preview && preview.changes.length > 0 && (
            <div className="chore-list" style={{ marginTop: 14 }}>
              {preview.changes.map((c) => (
                <div key={c.instanceId} className="assignment-row">
                  <div className="assignment-main">
                    <strong>{c.taskTitle}</strong>
                    <div className="assignment-meta">{c.reason}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                    <span>{c.fromMemberName.split(' ')[0]}</span>
                    <ArrowRight size={13} />
                    <strong style={{ color: 'var(--primary)' }}>{c.toMemberName.split(' ')[0]}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
