// ============================================
// KEY Investigations – Shared App Config
// ============================================
const SUPABASE_URL = 'https://mqsohzqbsupsathxphgd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xc29oenFic3Vwc2F0aHhwaGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMDc5ODIsImV4cCI6MjA5Mzg4Mzk4Mn0.uyXA4qRgDNRAWqG27gcZVO85T2SmxianHBb514t_6Xc';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUS_COLORS = {
  pending:      'bg-slate-100 text-slate-600',
  assigned:     'bg-blue-50 text-blue-700',
  in_progress:  'bg-amber-50 text-amber-700',
  under_review: 'bg-purple-50 text-purple-700',
  resolved:     'bg-green-50 text-green-700',
  closed:       'bg-slate-50 text-slate-400',
};
const STATUS_LABELS = {
  pending: 'Pending', assigned: 'Assigned', in_progress: 'In Progress',
  under_review: 'Under Review', resolved: 'Resolved', closed: 'Closed'
};
const PRIORITY_COLORS = {
  low: 'text-slate-400', normal: 'text-blue-500', high: 'text-amber-500', urgent: 'text-red-500'
};

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}
async function getProfile(uid) {
  const { data } = await sb.from('profiles').select('*, companies(name)').eq('id', uid).single();
  return data;
}
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function avatar(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}
