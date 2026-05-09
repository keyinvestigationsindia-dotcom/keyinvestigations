// Supabase config
const SUPABASE_URL = 'https://mqsohzqbsupsathxphgd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xc29oenFic3Vwc2F0aHhwaGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMDc5ODIsImV4cCI6MjA5Mzg4Mzk4Mn0.uyXA4qRgDNRAWqG27gcZVO85T2SmxianHBb514t_6Xc';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Tab switching (login page) ----
function switchTab(tab) {
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('panel-' + tab);
  if (panel) panel.classList.add('active');
  const tabs = { login: 0, signup: 1 };
  const tabEls = document.querySelectorAll('.auth-tab');
  if (tab in tabs) tabEls[tabs[tab]]?.classList.add('active');
}

function showAlert(id, msg, type = 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${type}`;
  el.style.display = 'block';
}
function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ---- Sign In ----
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('login-error');
    const btn = document.getElementById('login-btn');
    btn.textContent = 'Signing in...';
    btn.disabled = true;

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showAlert('login-error', error.message);
      btn.textContent = 'Sign In';
      btn.disabled = false;
    } else {
      window.location.href = 'dashboard.html';
    }
  });
}

// ---- Sign Up ----
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('signup-error');
    const btn = document.getElementById('signup-btn');
    btn.textContent = 'Creating account...';
    btn.disabled = true;

    const name = document.getElementById('signup-name').value;
    const company = document.getElementById('signup-company').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;

    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name, company } }
    });

    if (error) {
      showAlert('signup-error', error.message);
      btn.textContent = 'Create Account';
      btn.disabled = false;
    } else {
      showAlert('signup-success', '✓ Account created! Check your email to confirm, then sign in.', 'success');
      btn.textContent = 'Account Created!';
    }
  });
}

// ---- Password Reset ----
const resetForm = document.getElementById('resetForm');
if (resetForm) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('reset-error');
    const btn = document.getElementById('reset-btn');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    const email = document.getElementById('reset-email').value;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://keyinvestigations.in/dashboard.html'
    });

    if (error) {
      showAlert('reset-error', error.message);
      btn.textContent = 'Send Reset Link';
      btn.disabled = false;
    } else {
      showAlert('reset-success', '✓ Reset link sent! Check your inbox.', 'success');
    }
  });
}

// ---- Sign Out ----
async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

// ---- Auth guard for dashboard ----
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

// ---- Redirect if already logged in (login page) ----
if (window.location.pathname.includes('login.html')) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) window.location.href = 'dashboard.html';
  });
}
