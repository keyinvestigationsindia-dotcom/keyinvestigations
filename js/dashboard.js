// Dashboard logic — runs after auth.js

(async () => {
  // Guard: redirect if not logged in
  const session = await requireAuth();
  if (!session) return;

  const user = session.user;

  // Fetch customer profile
  const { data: profile } = await supabase
    .from('customers')
    .select('*')
    .eq('id', user.id)
    .single();

  const name = profile?.full_name || user.email;
  const firstName = name.split(' ')[0];
  const initial = name.charAt(0).toUpperCase();

  // Set user info in header
  document.getElementById('userName').textContent = name;
  document.getElementById('welcomeName').textContent = firstName;
  document.getElementById('avatarInitial').textContent = initial;

  // Fetch cases
  const { data: cases, error } = await supabase
    .from('cases')
    .select('*')
    .order('created_at', { ascending: false });

  // Stats
  const total = cases?.length || 0;
  const open = cases?.filter(c => c.status === 'open').length || 0;
  const inProgress = cases?.filter(c => c.status === 'in_progress').length || 0;
  const resolved = cases?.filter(c => c.status === 'resolved').length || 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-open').textContent = open;
  document.getElementById('stat-progress').textContent = inProgress;
  document.getElementById('stat-resolved').textContent = resolved;

  // Render cases table
  const container = document.getElementById('casesContainer');

  if (!cases || cases.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>No cases yet</h3>
        <p>Your investigation cases will appear here once assigned by our team.</p>
      </div>`;
    return;
  }

  const statusLabel = {
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed'
  };

  const rows = cases.map(c => `
    <tr>
      <td><strong>${c.case_number}</strong></td>
      <td>${c.title}</td>
      <td>${c.service_type || '–'}</td>
      <td><span class="status-badge status-${c.status}">${statusLabel[c.status] || c.status}</span></td>
      <td>${new Date(c.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Case No.</th>
          <th>Title</th>
          <th>Service Type</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
})();
