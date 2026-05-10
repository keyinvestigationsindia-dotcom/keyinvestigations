// ============================================================
// KEY Investigations – Shared App Config & Helpers
// ============================================================
const SUPABASE_URL = 'https://mqsohzqbsupsathxphgd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xc29oenFic3Vwc2F0aHhwaGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMDc5ODIsImV4cCI6MjA5Mzg4Mzk4Mn0.uyXA4qRgDNRAWqG27gcZVO85T2SmxianHBb514t_6Xc';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUS_COLORS = {
  pending:      'bg-slate-100 text-slate-600',
  assigned:     'bg-blue-50 text-blue-700',
  in_progress:  'bg-amber-50 text-amber-700',
  under_review: 'bg-purple-50 text-purple-700',
  qc_review:    'bg-indigo-50 text-indigo-700',
  rfi_raised:   'bg-red-50 text-red-700',
  resolved:     'bg-green-50 text-green-700',
  closed:       'bg-slate-50 text-slate-400',
};
const STATUS_LABELS = {
  pending:'Pending', assigned:'Assigned', in_progress:'In Progress',
  under_review:'Under Review', qc_review:'QC Review', rfi_raised:'RFI Raised',
  resolved:'Resolved', closed:'Closed'
};
const PRIORITY_PILL = {
  low:'bg-slate-100 text-slate-500', normal:'bg-blue-50 text-blue-600',
  high:'bg-amber-50 text-amber-600', urgent:'bg-red-50 text-red-600'
};
const TYPE_ICONS = {motor_od:'🚗',motor_theft:'🔓',health:'🏥',mact:'⚖️',tp:'🤝',non_motor:'🏢'};
const ROLE_ROUTES = { key_admin:'admin.html', key_qc:'qc.html', key_agent:'agent.html', external:'dashboard.html' };
const CHECKLIST = [
  {key:'policy_document',    label:'Policy document verified'},
  {key:'subject_documents',  label:'Vehicle / subject documents verified'},
  {key:'incident_date',      label:'Incident date matches FIR / records'},
  {key:'location',           label:'Location corroborated'},
  {key:'photographs',        label:'Photographs / evidence collected'},
  {key:'witness_statements', label:'Witness statements recorded'},
  {key:'estimate_verified',  label:'Repair estimate / hospital bill verified'},
  {key:'agent_visit',        label:'Agent site visit confirmed'},
];

async function getSession() {
  const { data:{ session } } = await sb.auth.getSession();
  return session;
}
async function getProfile(uid) {
  const { data } = await sb.from('profiles').select('*').eq('id', uid).single();
  return data;
}
async function getWorkspaces(uid) {
  const { data } = await sb.from('workspace_members')
    .select('*, tenants(id,name,slug)')
    .eq('user_id', uid);
  return data || [];
}
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}
async function routeByRole() {
  const session = await getSession();
  if (!session) return window.location.href = 'login.html';
  const profile = await getProfile(session.user.id);
  if (!profile) return window.location.href = 'login.html';
  const target = ROLE_ROUTES[profile.system_role] || 'dashboard.html';
  if (!window.location.pathname.endsWith(target)) window.location.href = target;
  return { session, profile };
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
function avatar(name) {
  return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
}
function pill(text, cls) {
  return `<span class="px-2.5 py-1 rounded-full text-xs font-semibold ${cls}">${text}</span>`;
}
// Shared nav header builder
function buildHeader(profile, tenantName='') {
  const roleLabels = { key_admin:'KEY Admin', key_qc:'QC Reviewer', key_agent:'Agent', external: tenantName };
  return `
  <header class="bg-navy border-b border-white/10 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <a href="index.html" class="flex items-center">
          <img src="images/logo.png" alt="KEY Investigations" class="h-8 rounded-lg" style="background:rgba(255,255,255,0.9);padding:2px 6px;" />
        </a>
        ${tenantName ? `<span class="text-white/20">|</span><span class="text-white/50 text-sm">${tenantName}</span>` : ''}
        <span class="bg-gold/10 border border-gold/20 text-gold text-xs font-bold px-3 py-1 rounded-full hidden sm:inline">
          ${roleLabels[profile.system_role]||'User'}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-gold rounded-full flex items-center justify-center text-navy text-xs font-bold">${avatar(profile.full_name)}</div>
        <span class="text-white/70 text-sm hidden sm:block">${profile.full_name||profile.email}</span>
        <button onclick="signOut()" class="text-white/40 hover:text-white text-xs border border-white/10 px-3 py-1.5 rounded-lg">Sign out</button>
      </div>
    </div>
  </header>`;
}
