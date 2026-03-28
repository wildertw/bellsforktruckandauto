/**
 * Authentication — login, logout, session management.
 */
import { $, dom, state, BLOG_AUTH, BLOG_API } from './state.js';
import { sha256Hex, showFeedback } from './utils.js';

export function toggleAuth(showDashboard, user) {
  dom.authPanel.style.display = showDashboard ? 'none' : 'grid';
  dom.dashboard.style.filter = showDashboard ? 'none' : 'blur(1px)';
  dom.dashboard.dataset.noScroll = showDashboard ? 'true' : 'false';
  dom.currentUser.textContent = user ? 'Signed in as ' + user : '';
}

export async function handleLogin(event, { loadBlogPosts, loadBlogComments, loadInventoryFromSite, renderOverview }) {
  event.preventDefault();
  const user = $('loginUser').value.trim();
  const pass = $('loginPass').value;
  if (!user || !pass) {
    showFeedback(dom.loginFeedback, 'Enter username and password.');
    return;
  }
  try {
    const passwordHash = await sha256Hex(pass);
    const res = await fetch(BLOG_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, passwordHash }),
    });
    if (!res.ok) throw new Error('Auth failed');
    const data = await res.json();
    state.blogToken = data.token;
    state.blogUser = data.user || user;
    state.authPasswordHash = passwordHash;

    sessionStorage.setItem('bf_admin_session', JSON.stringify({
      authenticated: true, user: state.blogUser, username: user,
      passwordHash: passwordHash, loginTime: Date.now(),
    }));

    toggleAuth(true, state.blogUser);
    dom.loginFeedback.textContent = '';
    await Promise.all([loadBlogPosts(), loadBlogComments()]);
    loadInventoryFromSite();
    renderOverview();
  } catch (err) {
    showFeedback(dom.loginFeedback, 'Credentials do not match.');
  }
}

export function handleLogout() {
  state.blogToken = '';
  state.blogUser = '';
  state.authPasswordHash = '';
  sessionStorage.removeItem('bf_admin_session');
  document.cookie = 'bf_admin_token=; Path=/; Max-Age=0; SameSite=Strict';
  toggleAuth(false);
  window.location.reload();
}

export async function blogAdminRequest(path, options) {
  if (!state.blogToken) throw new Error('Not authenticated');
  const url = BLOG_API + (path || '?action=admin-list');
  const init = {
    ...(options || {}),
    headers: {
      Authorization: 'Bearer ' + state.blogToken,
      ...((options && options.headers) || {}),
      ...((options && options.body) ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Blog request failed');
  }
  return res.json();
}
