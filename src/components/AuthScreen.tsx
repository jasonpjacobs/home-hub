import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CloudRain,
  FolderKanban,
  Home,
  Link2,
  Lock,
  Sparkles,
  Table2,
} from 'lucide-react';
import { api } from '../api';
import type { DemoMember, StorageStatus } from '../types';

interface Props {
  initialInviteCode?: string;
  demoMembers: DemoMember[];
  registrationCodeRequired?: boolean;
  storage: StorageStatus | null;
  onAuthenticated: (opts?: { isNewUser?: boolean }) => void;
}

type Mode = 'login' | 'magic' | 'register' | 'join';

export function AuthScreen({
  initialInviteCode,
  demoMembers,
  registrationCodeRequired = false,
  storage,
  onAuthenticated,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialInviteCode ? 'join' : 'login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicPreview, setMagicPreview] = useState<string | null>(null);
  const [magicMessage, setMagicMessage] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [registrationCode, setRegistrationCode] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode || '');
  const [memberGroup, setMemberGroup] = useState('partner');
  const [inviteInfo, setInviteInfo] = useState<{ householdName: string; role: string } | null>(null);

  useEffect(() => {
    if (initialInviteCode) {
      setInviteCode(initialInviteCode);
      setMode('join');
      api
        .lookupInvite(initialInviteCode)
        .then((info) => {
          setInviteInfo({ householdName: info.householdName, role: info.role });
          if (info.email) setEmail(info.email);
        })
        .catch(() => setInviteInfo(null));
    }
  }, [initialInviteCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMagicPreview(null);
    setMagicMessage(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await api.login(email, password);
        onAuthenticated();
      } else if (mode === 'magic') {
        const res = await api.requestMagicLink(email);
        setMagicMessage(res.message);
        if (res.previewLink) setMagicPreview(res.previewLink);
      } else if (mode === 'register') {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
        await api.register({
          householdName,
          name,
          email,
          password,
          timezone: tz,
          ...(registrationCode.trim() ? { registrationCode: registrationCode.trim() } : {}),
        });
        onAuthenticated({ isNewUser: true });
      } else if (mode === 'join') {
        await api.joinWithInvite({ code: inviteCode, name, email, password, memberGroup });
        onAuthenticated({ isNewUser: true });
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(memberId?: string) {
    setError(null);
    setLoading(true);
    try {
      await api.demoLogin(memberId);
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Demo login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-hero">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  background: 'rgba(255,255,255,0.16)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Home size={20} />
              </div>
              <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Home Hub</span>
            </div>

            <h1>Tasks, habits, projects &amp; weather-smart planning for your home.</h1>
            <p style={{ marginTop: 12, opacity: 0.85, fontSize: '0.94rem' }}>
              A calm Daily Cockpit for partners, roommates, and kids—keeping shared household
              plans and private personal routines cleanly separated in one app.
            </p>

            <div className="hero-list">
              <div className="hero-item">
                <Sparkles size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>Daily Cockpit with 1-tap favorites, quick-log bar &amp; claimable Anyone tasks</span>
              </div>
              <div className="hero-item">
                <FolderKanban size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>Multi-step Projects &amp; Daily → Yearly / Seasonal flexible horizons</span>
              </div>
              <div className="hero-item">
                <CloudRain size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>10-day forecast alerts (4–10d gentle heads-up, 1–3d urgent triggers)</span>
              </div>
              <div className="hero-item">
                <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>Multi-spreadsheet federation for private tasks + AI Agent API &amp; MCP</span>
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: '0.8rem',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Table2 size={15} />
            <span>{storage?.label || 'Local Sheet Mirror (Demo Mode)'}</span>
          </div>
        </div>

        <div className="auth-panel">
          <div className="tabs-bar">
            {(['login', 'magic', 'register', 'join'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`tab-btn ${mode === m ? 'active' : ''}`}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
              >
                {m === 'login' ? 'Sign In' : m === 'magic' ? 'Magic Link' : m === 'register' ? 'New Home' : 'Join'}
              </button>
            ))}
          </div>

          {error && (
            <div className="banner error" style={{ marginBottom: 14 }}>
              <span>{error}</span>
            </div>
          )}

          {inviteInfo && mode === 'join' && (
            <div className="banner success" style={{ marginBottom: 14 }}>
              <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              <span>
                Invited to join <strong>{inviteInfo.householdName}</strong> as {inviteInfo.role}!
              </span>
            </div>
          )}

          {magicMessage && (
            <div className="banner info" style={{ marginBottom: 14, flexDirection: 'column' }}>
              <span>{magicMessage}</span>
              {magicPreview && (
                <a
                  href={magicPreview}
                  style={{ color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Link2 size={15} /> Click here to sign in instantly
                </a>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="form-grid">
            {mode === 'register' && (
              <>
                <div className="field">
                  <label htmlFor="hh-name">Household Name</label>
                  <input
                    id="hh-name"
                    className="input"
                    placeholder="e.g., Maple Street Home"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    required
                  />
                </div>
                {registrationCodeRequired && (
                  <div className="field">
                    <label htmlFor="reg-code">Friends &amp; Family Access Code</label>
                    <input
                      id="reg-code"
                      className="input"
                      placeholder="Ask the host for the signup code"
                      value={registrationCode}
                      onChange={(e) => setRegistrationCode(e.target.value)}
                      required
                    />
                  </div>
                )}
              </>
            )}

            {mode === 'join' && (
              <div className="form-row-2">
                <div className="field">
                  <label htmlFor="invite-code">Invite Code</label>
                  <input
                    id="invite-code"
                    className="input"
                    placeholder="MAPLE-2026"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="mem-group">Household Role</label>
                  <select
                    id="mem-group"
                    className="select"
                    value={memberGroup}
                    onChange={(e) => setMemberGroup(e.target.value)}
                  >
                    <option value="partner">Partner / Adult</option>
                    <option value="roommate">Roommate</option>
                    <option value="kid">Kid</option>
                  </select>
                </div>
              </div>
            )}

            {(mode === 'register' || mode === 'join') && (
              <div className="field">
                <label htmlFor="your-name">Your Name</label>
                <input
                  id="your-name"
                  className="input"
                  placeholder="e.g., Jordan Lee"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== 'magic' && (
              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="password">Password</label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 4px', fontSize: '0.76rem' }}
                      onClick={() => {
                        setMode('magic');
                        setError(null);
                      }}
                    >
                      Forgot password? Use Magic Link
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  type="password"
                  className="input"
                  placeholder={mode === 'login' ? 'Enter password' : 'At least 6 characters'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', padding: '11px 16px', marginTop: 4 }}
            >
              {loading
                ? 'Working...'
                : mode === 'login'
                  ? 'Sign In'
                  : mode === 'magic'
                    ? 'Send Magic Sign-In Link'
                    : mode === 'register'
                      ? 'Create Household'
                      : 'Join Household'}
            </button>
          </form>

          {demoMembers.length > 0 && (
            <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div
                style={{
                  fontSize: '0.77rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 9,
                }}
              >
                Try Demo Household (Maple Street Home)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {demoMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={loading}
                    onClick={() => handleDemoLogin(m.id)}
                    style={{ justifyContent: 'flex-start', padding: '7px 10px' }}
                  >
                    <span className="avatar sm" style={{ background: m.avatarColor }}>
                      {m.name.charAt(0)}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.name.split(' ')[0]}
                    </span>
                    <span className="tag" style={{ marginLeft: 'auto', fontSize: '0.68rem' }}>
                      {m.memberGroup}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
