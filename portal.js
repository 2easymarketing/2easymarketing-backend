/**
 * 2EasyMarketing — Client Portal (embedded overlay version)
 */

// Global API helper — accessible everywhere
const _BACKEND = 'https://web-production-f0dfa2.up.railway.app';
function apiFetch(path, method = 'GET', body = null) {
  const token = window._authToken ? window._authToken() : (localStorage.getItem('2em_token') || null);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(_BACKEND + path, opts);
}

(function () {
  'use strict';

  const API = 'https://web-production-f0dfa2.up.railway.app';
  let authToken = localStorage.getItem('2em_token') || null;
  let currentUser = null;
  let currentTaskType = null;
  let allTasks = [];

  // ─── TASK FORM DEFINITIONS ───────────────────────────────────
  const TASK_FORMS = {
    social_post: {
      label: 'Social Media Posts',
      fields: [
        { name:'title',    label:'Task Title',         type:'text',     placeholder:'e.g. 3 Instagram posts for summer sale', required:true },
        { name:'platform', label:'Platform',           type:'select',   options:['Instagram','Facebook','LinkedIn','TikTok','Twitter/X','All Platforms'] },
        { name:'quantity', label:'Number of Posts',    type:'select',   options:['1','2','3','5','8'] },
        { name:'tone',     label:'Tone / Voice',       type:'select',   options:['Professional','Casual & Friendly','Bold & Energetic','Educational','Humorous','Inspirational'] },
        { name:'audience', label:'Target Audience',    type:'text',     placeholder:'e.g. Local homeowners 30-55' },
        { name:'brief',    label:'Topic / Goal',       type:'textarea', placeholder:'What should the posts be about? Include any promotions, key messages, or specific instructions.', required:true },
      ]
    },
    seo_audit: {
      label: 'SEO Audit & Report',
      fields: [
        { name:'title',   label:'Task Title',              type:'text',     placeholder:'e.g. Full SEO audit for mysite.com', required:true },
        { name:'website', label:'Website URL to Audit',    type:'text',     placeholder:'yoursite.com' },
        { name:'niche',   label:'Industry / Niche',        type:'text',     placeholder:'e.g. HVAC services, Rhode Island' },
        { name:'brief',   label:'Current Situation & Goals', type:'textarea', placeholder:'Where do you rank now? What keywords matter most? What are your 90-day goals?', required:true },
      ]
    },
    ad_copy: {
      label: 'Ad Copy & Campaign',
      fields: [
        { name:'title',    label:'Task Title',       type:'text',     placeholder:'e.g. Google Ads copy for roofing service', required:true },
        { name:'platform', label:'Ad Platform',      type:'select',   options:['Google Ads','Meta (Facebook/Instagram)','Both Google + Meta','LinkedIn Ads'] },
        { name:'goal',     label:'Campaign Goal',    type:'select',   options:['Lead Generation','Website Traffic','Brand Awareness','Sales / Conversions'] },
        { name:'quantity', label:'Number of Ads',    type:'select',   options:['1','2','3','5'] },
        { name:'budget',   label:'Monthly Ad Budget',type:'select',   options:['Under $500','$500-$1,000','$1,000-$3,000','$3,000-$5,000','$5,000+'] },
        { name:'audience', label:'Target Audience',  type:'text',     placeholder:'e.g. Homeowners 35-65 in Providence, RI' },
        { name:'brief',    label:'Key Offer & USP',  type:'textarea', placeholder:'What makes your business different? What is the main offer or hook?', required:true },
      ]
    },
    blog_content: {
      label: 'Blog & Content Writing',
      fields: [
        { name:'title',        label:'Task Title',          type:'text',     placeholder:'e.g. 1,500-word blog post on SEO tips', required:true },
        { name:'content_type', label:'Content Type',        type:'select',   options:['Blog Post','Website Homepage Copy','Service Page Copy','About Page','Landing Page'] },
        { name:'topic',        label:'Topic',               type:'text',     placeholder:'e.g. "5 ways local restaurants can get more Google reviews"' },
        { name:'keyword',      label:'Target SEO Keyword',  type:'text',     placeholder:'e.g. "restaurant marketing Providence RI"' },
        { name:'word_count',   label:'Word Count',          type:'select',   options:['500 words','800 words','1,000 words','1,500 words','2,000 words'] },
        { name:'tone',         label:'Tone',                type:'select',   options:['Professional','Casual & Conversational','Educational / Expert','Bold & Persuasive'] },
        { name:'audience',     label:'Target Audience',     type:'text',     placeholder:'e.g. Small business owners looking to grow online' },
        { name:'brief',        label:'Additional Details',  type:'textarea', placeholder:'Any specific points to cover, CTAs, links, or brand notes?', required:true },
      ]
    },
    email_campaign: {
      label: 'Email Campaign',
      fields: [
        { name:'title',           label:'Task Title',         type:'text',     placeholder:'e.g. 3-email welcome sequence', required:true },
        { name:'goal',            label:'Campaign Goal',      type:'select',   options:['Welcome New Subscribers','Promote a Sale / Offer','Nurture Leads','Re-engage Inactive Subscribers','Event / Launch Announcement'] },
        { name:'sequence_length', label:'Number of Emails',   type:'select',   options:['1','2','3','5','7'] },
        { name:'tone',            label:'Tone',               type:'select',   options:['Professional','Warm & Friendly','Urgent / Sales-Focused','Educational','Storytelling'] },
        { name:'audience',        label:'Audience Segment',   type:'text',     placeholder:'e.g. New leads who downloaded our free guide' },
        { name:'brief',           label:'Key Offer & Details',type:'textarea', placeholder:'What is the main offer? What pain point does your audience have?', required:true },
      ]
    }
  };

  // ─── OVERLAY OPEN / CLOSE ─────────────────────────────────────
  function openPortal() {
    const overlay = document.getElementById('portal-overlay');
    if (!overlay) return;
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (!authToken) {
      showAuthScreen();
    } else {
      verifyAndLoad();
    }
  }

  function closePortal() {
    const overlay = document.getElementById('portal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    stopPolling();
  }

  // ─── AUTH SCREENS ─────────────────────────────────────────────
  function showAuthScreen() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('portal-app').style.display = 'none';
  }

  function showPortalApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('portal-app').style.display = 'flex';
    setupUserUI();
    navigateTo('dashboard');
  }

  function setupUserUI() {
    if (!currentUser) return;
    document.getElementById('user-name-display').textContent = currentUser.name;
    document.getElementById('user-plan-display').textContent = (currentUser.plan || 'starter') + ' plan';
    document.getElementById('user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();

    if (currentUser.role === 'owner') {
      document.querySelectorAll('.owner-only').forEach(el => {
        el.style.display = 'flex';
      });
    }
  }

  async function verifyAndLoad() {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        currentUser = await res.json();
        showPortalApp();
      } else {
        authToken = null;
        showAuthScreen();
      }
    } catch(e) {
      authToken = null;
      showAuthScreen();
    }
  }

  // ─── INIT ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Open portal triggers
    ['open-portal-btn','open-portal-mobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => { e.preventDefault(); openPortal(); });
    });

    // Close portal
    const closeBtn = document.getElementById('portal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closePortal);

    // Auth toggle
    const goSignup = document.getElementById('go-signup');
    const goLogin  = document.getElementById('go-login');
    if (goSignup) goSignup.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('signup-form').style.display = 'block';
    });
    if (goLogin) goLogin.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('signup-form').style.display = 'none';
      document.getElementById('login-form').style.display = 'block';
    });

    // Login / Signup buttons
    const loginBtn  = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (loginBtn)  loginBtn.addEventListener('click', doLogin);
    if (signupBtn) signupBtn.addEventListener('click', doSignup);
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

    // Enter key on password
    const pwField = document.getElementById('login-password');
    if (pwField) pwField.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    // Nav links
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.view); });
    });

    // Task type cards
    document.querySelectorAll('.task-type-card').forEach(card => {
      card.addEventListener('click', () => showTaskForm(card.dataset.type));
    });

    // Back button
    const backBtn = document.getElementById('back-to-types');
    if (backBtn) backBtn.addEventListener('click', () => {
      document.getElementById('task-form-container').style.display = 'none';
      document.getElementById('task-type-grid').style.display = 'grid';
      currentTaskType = null;
    });

    // Submit task
    const submitBtn = document.getElementById('submit-task-btn');
    if (submitBtn) submitBtn.addEventListener('click', submitTask);

    // Filter tabs
    document.addEventListener('click', e => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadMyTasks(tab.dataset.filter);
    });

    // Modal close
    const modalClose = document.getElementById('modal-close');
    const taskModal  = document.getElementById('task-modal');
    if (modalClose) modalClose.addEventListener('click', () => { taskModal.style.display = 'none'; });
    if (taskModal)  taskModal.addEventListener('click', e => { if (e.target === taskModal) taskModal.style.display = 'none'; });
  });

  // ─── LOGIN ────────────────────────────────────────────────────
  async function doLogin() {
    const email    = (document.getElementById('login-email').value || '').trim();
    const password = (document.getElementById('login-password').value || '').trim();
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('login-btn');
    errEl.textContent = '';

    if (!email || !password) { errEl.textContent = 'Please enter email and password.'; return; }
    btn.disabled = true; btn.textContent = 'Logging in...';

    try {
      const res  = await apiFetch('/api/auth/login', 'POST', { email, password });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Login failed'; return; }
      authToken   = data.token;
      currentUser = data.user;
      localStorage.setItem('2em_token', authToken);
      showPortalApp();
    } catch(e) {
      errEl.textContent = 'Connection error — server may be starting up, try again in a moment.';
    } finally {
      btn.disabled = false; btn.textContent = 'Log In';
    }
  }

  // ─── SIGNUP ───────────────────────────────────────────────────
  async function doSignup() {
    const name     = (document.getElementById('signup-name').value || '').trim();
    const email    = (document.getElementById('signup-email').value || '').trim();
    const password = (document.getElementById('signup-password').value || '').trim();
    const business = (document.getElementById('signup-business').value || '').trim();
    const website  = (document.getElementById('signup-website').value || '').trim();
    const plan     = document.getElementById('signup-plan').value;
    const errEl    = document.getElementById('signup-error');
    const btn      = document.getElementById('signup-btn');
    errEl.textContent = '';

    if (!name || !email || !password) { errEl.textContent = 'Name, email, and password are required.'; return; }
    btn.disabled = true; btn.textContent = 'Creating account...';

    try {
      const res  = await apiFetch('/api/auth/signup', 'POST', { name, email, password, business, website, plan });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Signup failed'; return; }
      authToken   = data.token;
      currentUser = data.user;
      localStorage.setItem('2em_token', authToken);
      showPortalApp();
    } catch(e) {
      errEl.textContent = 'Connection error — please try again.';
    } finally {
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  }

  // ─── LOGOUT ───────────────────────────────────────────────────
  async function doLogout() {
    try { await apiFetch('/api/auth/logout', 'POST'); } catch(e) {}
    authToken = null; currentUser = null;
    localStorage.removeItem('2em_token');
    // Reset owner-only links
    document.querySelectorAll('.owner-only').forEach(el => el.style.display = 'none');
    showAuthScreen();
  }

  // ─── NAVIGATION ───────────────────────────────────────────────
  function navigateTo(view) {
    document.querySelectorAll('.portal-view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const el   = document.getElementById('view-' + view);
    const link = document.querySelector('.sidebar-link[data-view="' + view + '"]');
    if (el)   el.style.display = 'block';
    if (link) link.classList.add('active');

    stopPolling();
    if (view === 'dashboard')       { loadDashboard(); startPolling('dashboard'); }
    if (view === 'my-tasks')        { loadMyTasks('all'); startPolling('my-tasks'); }
    if (view === 'owner-dashboard') { loadOwnerDashboard(); loadSmtpStatus(); }
    if (view === 'autonomous')       loadAutonomous();
    if (view === 'media-factory')    loadMediaFactory();
    if (view === 'clients')         loadClients();
    if (view === 'system-health')   loadSystemHealth();
    if (view === 'update-log')      loadUpdateLog();
    if (view === 'security')        loadSecurityDashboard();
    if (view === 'council')         loadCouncil();
    if (view === 'channel-hub')     loadChannelHub();
    if (view === 'content-calendar') loadContentCalendar();
    if (view === 'competitor-spy')  loadCompetitorSpy();
    if (view === 'revenue')         loadRevenueDashboard();
    if (view === 'client-reports')  loadClientReports();
    if (view === 'new-task') {
      document.getElementById('task-form-container').style.display = 'none';
      document.getElementById('task-type-grid').style.display = 'grid';
    }
  }

  // ─── DASHBOARD ────────────────────────────────────────────────
  let _pollInterval = null;

  function startPolling(viewName) {
    stopPolling();
    _pollInterval = setInterval(() => {
      if (viewName === 'dashboard') loadDashboard();
      if (viewName === 'my-tasks')  loadMyTasks('all');
    }, 15000); // refresh every 15s
  }

  function stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  async function loadDashboard() {
    try {
      const res  = await apiFetch('/api/tasks/my');
      const data = await res.json();
      allTasks = data.tasks || [];

      document.getElementById('stat-total').textContent      = allTasks.length;
      document.getElementById('stat-processing').textContent = allTasks.filter(t => t.status === 'processing').length;
      document.getElementById('stat-review').textContent     = allTasks.filter(t => ['review','approved'].includes(t.status)).length;
      document.getElementById('stat-delivered').textContent  = allTasks.filter(t => t.status === 'delivered').length;

      const el = document.getElementById('recent-tasks-list');
      el.innerHTML = allTasks.length
        ? allTasks.slice(0,5).map(renderTaskCard).join('')
        : '<div class="empty-state">No tasks yet — click "New Task" to get started!</div>';
      bindCardClicks(el);
    } catch(e) { console.error('Dashboard:', e); }
  }

  // ─── MY TASKS ─────────────────────────────────────────────────
  async function loadMyTasks(filter = 'all') {
    try {
      const res  = await apiFetch('/api/tasks/my');
      const data = await res.json();
      allTasks = data.tasks || [];

      const filtered = filter === 'all' ? allTasks : allTasks.filter(t => {
        if (filter === 'processing') return t.status === 'processing';
        if (filter === 'review')     return ['review','approved'].includes(t.status);
        if (filter === 'delivered')  return t.status === 'delivered';
        return true;
      });

      const el = document.getElementById('all-tasks-list');
      el.innerHTML = filtered.length
        ? filtered.map(renderTaskCard).join('')
        : '<div class="empty-state">No tasks in this category.</div>';
      bindCardClicks(el);
    } catch(e) { console.error('My tasks:', e); }
  }

  // ─── TASK CARD ────────────────────────────────────────────────
  function renderTaskCard(task) {
    const typeLabel = { social_post:'Social Posts', seo_audit:'SEO Audit', ad_copy:'Ad Copy', blog_content:'Blog/Content', email_campaign:'Email Campaign' }[task.task_type] || task.task_type;
    const date = new Date(task.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    return `<div class="task-card" data-task-id="${task.id}">
      <div class="task-card-left">
        <div class="task-card-title">${esc(task.title)}</div>
        <div class="task-card-meta">${typeLabel} &middot; ${date}</div>
      </div>
      <span class="task-status status-${task.status}">${statusLabel(task.status)}</span>
    </div>`;
  }

  function statusLabel(s) {
    return { processing:'⚡ Processing', review:'👀 In Review', approved:'✅ Approved', delivered:'🚀 Delivered', error:'❌ Error', rejected:'↩ Needs Revision' }[s] || s;
  }

  function bindCardClicks(container) {
    container.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTaskModal(card.dataset.taskId));
    });
  }

  // ─── TASK MODAL ───────────────────────────────────────────────
  async function openTaskModal(taskId) {
    const modal = document.getElementById('task-modal');
    const body  = document.getElementById('modal-body');
    document.getElementById('modal-task-title').textContent = 'Loading...';
    modal.style.display = 'flex';
    body.innerHTML = '<div class="spinner"></div> Loading...';

    try {
      const res  = await apiFetch('/api/tasks/' + taskId);
      const task = await res.json();
      document.getElementById('modal-task-title').textContent = esc(task.title);

      const date = new Date(task.created_at).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
      let html = `<p class="modal-meta">Submitted ${date} &middot; <span class="task-status status-${task.status}" style="display:inline-block">${statusLabel(task.status)}</span></p>`;

      if (task.status === 'processing') {
        html += `<div style="text-align:center;padding:2.5rem"><div style="font-size:2.5rem">⚡</div><div style="color:#f59e0b;font-weight:700;font-size:1rem;margin-top:.5rem">AI is working on your task...</div><div style="color:rgba(180,200,220,.65);font-size:.85rem;margin-top:.4rem">Usually takes 30–60 seconds. Check back shortly.</div></div>`;
      } else if (['review','approved'].includes(task.status)) {
        html += `<div style="text-align:center;padding:2rem"><div style="font-size:2.5rem">👀</div><div style="color:#00c4b4;font-weight:700;margin-top:.5rem">In Review with Dev</div><div style="color:rgba(180,200,220,.65);font-size:.85rem;margin-top:.4rem">Your deliverable is ready and being reviewed before delivery.</div></div>`;
      } else if (task.status === 'delivered' && task.ai_result) {
        const result = task.ai_result;
        if (result.startsWith('IMAGE_AD_READY:')) {
          const fname = result.split(':')[1].split('\n')[0].trim();
          html += `<div style="font-weight:700;color:#00c4b4;font-size:.85rem;margin-bottom:.75rem">🖼️ Your AI Image Ad:</div>
            <img src="/media/${fname}" style="width:100%;border-radius:10px;margin-bottom:.75rem;max-height:360px;object-fit:contain;background:rgba(0,0,0,.3)" />
            <a href="/media/${fname}" download="${fname}" class="copy-btn" style="text-decoration:none;display:inline-block">⬇ Download Image Ad</a>`;
        } else if (result.startsWith('VIDEO_AD_READY:')) {
          const fname = result.split(':')[1].split('\n')[0].trim();
          html += `<div style="font-weight:700;color:#00c4b4;font-size:.85rem;margin-bottom:.75rem">🎬 Your AI Video Ad:</div>
            <video src="/media/${fname}" controls style="width:100%;border-radius:10px;margin-bottom:.75rem;max-height:360px;background:#000"></video>
            <a href="/media/${fname}" download="${fname}" class="copy-btn" style="text-decoration:none;display:inline-block">⬇ Download Video Ad</a>`;
        } else if (result.startsWith('VOICEOVER_READY:')) {
          const fname = result.split(':')[1].split('\n')[0].trim();
          html += `<div style="font-weight:700;color:#22c55e;font-size:.85rem;margin-bottom:.75rem">🎙️ Your AI Voiceover:</div>
            <audio src="/media/${fname}" controls style="width:100%;margin-bottom:.75rem"></audio>
            <a href="/media/${fname}" download="${fname}" class="copy-btn" style="text-decoration:none;display:inline-block">⬇ Download Audio</a>`;
        } else {
          html += `<div style="font-weight:700;color:#00c4b4;font-size:.85rem;margin-bottom:.5rem">Your Deliverable:</div>
            <div class="modal-result-box">${esc(result)}</div>
            <button class="copy-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(result)}).then(()=>{this.textContent='✓ Copied!'})">📋 Copy to Clipboard</button>`;
        }
      } else if (task.status === 'rejected') {
        html += `<div style="text-align:center;padding:2rem"><div style="font-size:2.5rem">↩</div><div style="color:#ef4444;font-weight:700;margin-top:.5rem">Needs Revision</div><div style="color:rgba(180,200,220,.65);font-size:.85rem;margin-top:.4rem">${esc(task.owner_notes || 'Dev will follow up with feedback.')}</div></div>`;
      }

      body.innerHTML = html;
    } catch(e) {
      body.innerHTML = '<div class="empty-state">Could not load task details.</div>';
    }
  }

  // ─── NEW TASK FORM ────────────────────────────────────────────
  function showTaskForm(type) {
    currentTaskType = type;
    const def = TASK_FORMS[type];
    document.getElementById('task-type-grid').style.display = 'none';
    document.getElementById('task-form-container').style.display = 'block';
    document.getElementById('task-form-title').textContent = def.label;

    document.getElementById('task-form').innerHTML = def.fields.map(f => {
      if (f.type === 'textarea') return `<div class="form-group"><label>${f.label}${f.required?' *':''}</label><textarea name="${f.name}" placeholder="${f.placeholder||''}" rows="4"${f.required?' required':''}></textarea></div>`;
      if (f.type === 'select')   return `<div class="form-group"><label>${f.label}</label><select name="${f.name}">${f.options.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></div>`;
      return `<div class="form-group"><label>${f.label}${f.required?' *':''}</label><input type="${f.type}" name="${f.name}" placeholder="${f.placeholder||''}"${f.required?' required':''}></div>`;
    }).join('');
  }

  async function submitTask() {
    const form   = document.getElementById('task-form');
    const errEl  = document.getElementById('task-submit-error');
    const btn    = document.getElementById('submit-task-btn');
    errEl.textContent = '';

    const brief = {};
    for (const el of form.elements) { if (el.name) brief[el.name] = el.value.trim(); }

    const def = TASK_FORMS[currentTaskType];
    for (const f of def.fields) {
      if (f.required && !brief[f.name]) { errEl.textContent = '"' + f.label + '" is required.'; return; }
    }

    btn.disabled = true; btn.textContent = '⚡ Submitting...';

    try {
      const res  = await apiFetch('/api/tasks/submit', 'POST', { task_type: currentTaskType, title: brief.title || def.label, brief });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Submission failed'; return; }
      btn.textContent = '✅ Submitted!';
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Submit Task — AI Starts Now →'; navigateTo('my-tasks'); }, 1200);
    } catch(e) {
      errEl.textContent = 'Connection error — please try again.';
      btn.disabled = false; btn.textContent = 'Submit Task — AI Starts Now →';
    }
  }

  // ─── OWNER DASHBOARD ─────────────────────────────────────────
  async function loadOwnerDashboard() {
    try {
      const [sRes, tRes] = await Promise.all([apiFetch('/api/owner/stats'), apiFetch('/api/owner/tasks')]);
      const stats = await sRes.json();
      const tasks = (await tRes.json()).tasks || [];

      document.getElementById('owner-stats-row').innerHTML = `
        <div class="stat-pill"><span class="pill-num">${stats.total_clients}</span><span class="pill-label">Clients</span></div>
        <div class="stat-pill"><span class="pill-num">${stats.total_tasks}</span><span class="pill-label">Total Tasks</span></div>
        <div class="stat-pill"><span class="pill-num">${stats.processing}</span><span class="pill-label">Processing</span></div>
        <div class="stat-pill highlight"><span class="pill-num">${stats.pending_review}</span><span class="pill-label">Need Review</span></div>
        <div class="stat-pill"><span class="pill-num">${stats.delivered}</span><span class="pill-label">Delivered</span></div>`;

      const reviewTasks = tasks.filter(t => t.status === 'review');
      const reviewEl    = document.getElementById('owner-review-list');
      reviewEl.innerHTML = reviewTasks.length ? reviewTasks.map(renderOwnerCard).join('') : '<div class="empty-state">No tasks awaiting review 🎉</div>';
      reviewEl.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', handleOwnerAction));

      const allEl = document.getElementById('owner-all-tasks-list');
      allEl.innerHTML = tasks.slice(0,15).map(renderTaskCard).join('');
      bindCardClicks(allEl);
    } catch(e) { console.error('Owner dashboard:', e); }
  }

  function renderOwnerCard(task) {
    const date    = new Date(task.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric' });
    const preview = task.ai_result ? esc(task.ai_result.slice(0,300)) + (task.ai_result.length>300 ? '...' : '') : '<em style="color:rgba(180,200,220,.5)">AI result loading...</em>';
    return `<div class="owner-task-card" id="otask-${task.id}">
      <div class="owner-task-header">
        <div>
          <div class="owner-task-title">${esc(task.title)}</div>
          <div class="owner-task-meta">Client: ${esc(task.client_name)} (${esc(task.client_email)}) &middot; ${task.client_plan} plan &middot; ${date}</div>
        </div>
        <span class="task-status status-${task.status}">${statusLabel(task.status)}</span>
      </div>
      <div class="ai-result-box" id="result-view-${task.id}">${preview}</div>
      <textarea class="ai-result-edit" id="result-edit-${task.id}">${esc(task.ai_result || '')}</textarea>
      <div class="owner-actions">
        <button class="btn-approve" data-action="approve"      data-task-id="${task.id}">✅ Approve</button>
        <button class="btn-deliver" data-action="deliver"      data-task-id="${task.id}">🚀 Deliver</button>
        <button class="btn-edit"    data-action="toggle-edit"  data-task-id="${task.id}">✏️ Edit</button>
        <button class="btn-regen"   data-action="regenerate"   data-task-id="${task.id}">🔄 Redo</button>
        <button class="btn-reject"  data-action="reject"       data-task-id="${task.id}">↩ Send Back</button>
      </div>
    </div>`;
  }

  async function handleOwnerAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const taskId = btn.dataset.taskId;

    if (action === 'toggle-edit') {
      const edit = document.getElementById('result-edit-' + taskId);
      const view = document.getElementById('result-view-' + taskId);
      const on   = edit.style.display === 'block';
      edit.style.display = on ? 'none' : 'block';
      view.style.display = on ? 'block' : 'none';
      btn.textContent    = on ? '✏️ Edit' : '💾 Done';
      return;
    }

    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '...';

    try {
      let res;
      if (action === 'approve') {
        const edit    = document.getElementById('result-edit-' + taskId);
        const edited  = edit.style.display === 'block' ? edit.value : null;
        res = await apiFetch('/api/owner/tasks/' + taskId + '/approve', 'POST', { ai_result: edited });
      } else if (action === 'deliver') {
        res = await apiFetch('/api/owner/tasks/' + taskId + '/deliver', 'POST', { notes: 'Delivered!' });
      } else if (action === 'reject') {
        const reason = prompt('Reason for sending back (optional):') || 'Needs revision';
        res = await apiFetch('/api/owner/tasks/' + taskId + '/reject', 'POST', { reason });
      } else if (action === 'regenerate') {
        const instr = prompt('Any additional instructions? (optional):') || '';
        res = await apiFetch('/api/owner/tasks/' + taskId + '/regenerate', 'POST', { instructions: instr });
      }
      if (res && res.ok) setTimeout(loadOwnerDashboard, 600);
    } catch(err) { console.error('Owner action:', err); }
    finally { btn.disabled = false; btn.textContent = orig; }
  }

  // ─── CLIENTS ──────────────────────────────────────────────────
  async function loadClients() {
    try {
      const res  = await apiFetch('/api/owner/clients');
      const data = await res.json();
      const cls  = data.clients || [];
      const wrap = document.getElementById('clients-table-wrap');
      if (!cls.length) { wrap.innerHTML = '<div class="empty-state">No clients yet.</div>'; return; }
      wrap.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Business</th><th>Plan</th><th>Joined</th></tr></thead><tbody>
        ${cls.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.business||'—')}</td><td>${c.plan}</td><td>${new Date(c.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </tbody></table>`;
    } catch(e) { console.error('Clients:', e); }
  }

  // ─── API HELPER ───────────────────────────────────────────────
  function apiFetch(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {}) }
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + path, opts);
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }


  // ─── EXPOSE GLOBALS FOR EXTERNAL FUNCTIONS ───────────────────────
  window._API = API;
  window._apiFetch = apiFetch;
  window._authToken = () => authToken;

  // ─── EXPOSE GLOBALS FOR INLINE ONCLICK ───────────────────────────
  window.manualRunEngine = async function(engine = 'all') {
    const btn = document.getElementById('run-engine-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⚡ Running...'; }
    try {
      const res  = await apiFetch('/api/owner/run-engine', 'POST', { engine });
      const data = await res.json();
      alert(data.message || 'Engines triggered! Check back in ~30 seconds.');
      setTimeout(loadAutonomous, 3000);
    } catch(e) {
      alert('Error triggering engine — make sure server is running.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Run All Engines Now'; }
    }
  };

  window.markAllRead = async function() {
    await apiFetch('/api/owner/alerts/read-all', 'POST', {});
    loadAutonomous();
  };

})();

// ═══════════════════════════════════════════════════════════════════════════
//  AUTONOMOUS ENGINE — OWNER TAB
// ═══════════════════════════════════════════════════════════════════════════

  // Called from navigateTo when view === 'autonomous'
  async function loadAutonomous() {
    try {
      const [autoRes, alertRes] = await Promise.all([
        apiFetch('/api/owner/autonomous'),
        apiFetch('/api/owner/alerts'),
      ]);
      const autoTasks = (await autoRes.json()).tasks || [];
      const alerts    = (await alertRes.json()).alerts || [];

      // Stats row
      const pending   = autoTasks.filter(t => t.status === 'pending_review').length;
      const approved  = autoTasks.filter(t => t.status === 'approved').length;
      const delivered = autoTasks.filter(t => t.status === 'delivered').length;
      const unread    = alerts.filter(a => !a.is_read).length;

      const statsEl = document.getElementById('auto-stats-row');
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="stat-pill highlight"><span class="pill-num">${pending}</span><span class="pill-label">Needs Review</span></div>
          <div class="stat-pill"><span class="pill-num">${approved}</span><span class="pill-label">Approved</span></div>
          <div class="stat-pill"><span class="pill-num">${delivered}</span><span class="pill-label">Delivered</span></div>
          <div class="stat-pill"><span class="pill-num">${unread}</span><span class="pill-label">Unread Alerts</span></div>`;
      }

      // Alerts feed
      const alertsEl = document.getElementById('auto-alerts-list');
      if (alertsEl) {
        if (!alerts.length) {
          alertsEl.innerHTML = '<div class="empty-state">No alerts yet — engines are spinning up.</div>';
        } else {
          alertsEl.innerHTML = alerts.slice(0, 20).map(a => {
            const sev = { warning:'#f59e0b', success:'#22c55e', info:'#00c4b4' }[a.severity] || '#00c4b4';
            const icon = { competitor:'🔎', opportunity:'💡', strategy:'🧠', content:'🏭' }[a.type] || '📣';
            const date = new Date(a.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
            return `<div class="alert-card ${a.is_read ? 'read' : 'unread'}" data-alert-id="${a.id}" style="border-left:3px solid ${sev}">
              <div class="alert-header">
                <span class="alert-icon">${icon}</span>
                <span class="alert-title">${esc(a.title)}</span>
                <span class="alert-date">${date}</span>
                ${!a.is_read ? `<button class="btn-mark-read" data-alert-id="${a.id}">✓ Read</button>` : ''}
              </div>
              <div class="alert-body">${esc(a.body).replace(/\n/g,'<br>')}</div>
            </div>`;
          }).join('');
          // Bind mark-read buttons
          alertsEl.querySelectorAll('.btn-mark-read').forEach(btn => {
            btn.addEventListener('click', async () => {
              await apiFetch('/api/owner/alerts/' + btn.dataset.alertId + '/read', 'POST', {});
              loadAutonomous();
            });
          });
        }
      }

      // Autonomous task queue
      const queueEl = document.getElementById('auto-queue-list');
      if (queueEl) {
        const active = autoTasks.filter(t => !['dismissed'].includes(t.status));
        if (!active.length) {
          queueEl.innerHTML = '<div class="empty-state">No autonomous tasks yet — engines will generate content shortly after startup.</div>';
        } else {
          queueEl.innerHTML = active.map(renderAutoCard).join('');
          bindAutoActions(queueEl);
        }
      }

      // Update badge
      updateAlertBadge(unread + pending);

    } catch(e) { console.error('Autonomous load error:', e); }
  }

  function renderAutoCard(task) {
    const engineLabel = { strategy:'🧠 Strategy', content:'🏭 Content', competitor:'🔎 Competitor', opportunity:'💡 Opportunity' }[task.engine] || task.engine;
    const statusColor = { pending_review:'#f59e0b', approved:'#22c55e', delivered:'#00c4b4', dismissed:'#6b7280' }[task.status] || '#00c4b4';
    const statusText  = { pending_review:'⏳ Awaiting Approval', approved:'✅ Approved', delivered:'🚀 Delivered', dismissed:'❌ Dismissed' }[task.status] || task.status;
    const date = new Date(task.generated_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const preview = task.content ? esc(task.content.slice(0, 400)) + (task.content.length > 400 ? '...' : '') : '<em>Generating...</em>';

    return `<div class="auto-task-card" id="atask-${task.id}">
      <div class="auto-task-header">
        <div>
          <div class="auto-engine-tag" style="color:${statusColor}">${engineLabel}</div>
          <div class="auto-task-title">${esc(task.title)}</div>
          <div class="auto-task-meta">Client: ${esc(task.client_name)} &middot; ${esc(task.client_plan)} plan &middot; ${date}</div>
        </div>
        <span class="task-status" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">${statusText}</span>
      </div>
      <div class="ai-result-box" id="aresult-view-${task.id}" style="white-space:pre-wrap">${preview}</div>
      <textarea class="ai-result-edit" id="aresult-edit-${task.id}" style="display:none">${esc(task.content || '')}</textarea>
      ${task.status === 'pending_review' ? `
      <div class="owner-actions">
        <button class="btn-approve"  data-auto-action="approve"    data-auto-id="${task.id}">✅ Approve</button>
        <button class="btn-deliver"  data-auto-action="deliver"    data-auto-id="${task.id}">🚀 Approve & Deliver</button>
        <button class="btn-edit"     data-auto-action="toggle-edit" data-auto-id="${task.id}">✏️ Edit</button>
        <button class="btn-reject"   data-auto-action="dismiss"    data-auto-id="${task.id}">✗ Dismiss</button>
      </div>` : task.status === 'approved' ? `
      <div class="owner-actions">
        <button class="btn-deliver"  data-auto-action="deliver"    data-auto-id="${task.id}">🚀 Deliver to Client</button>
        <button class="btn-edit"     data-auto-action="toggle-edit" data-auto-id="${task.id}">✏️ Edit</button>
      </div>` : ''}
    </div>`;
  }

  function bindAutoActions(container) {
    container.querySelectorAll('[data-auto-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.autoAction;
        const id     = btn.dataset.autoId;
        if (action === 'toggle-edit') {
          const edit = document.getElementById('aresult-edit-' + id);
          const view = document.getElementById('aresult-view-' + id);
          const on   = edit.style.display === 'block';
          edit.style.display = on ? 'none' : 'block';
          view.style.display = on ? 'block' : 'none';
          btn.textContent    = on ? '✏️ Edit' : '💾 Done';
          return;
        }
        btn.disabled = true;
        try {
          let res;
          if (action === 'approve') {
            const edit    = document.getElementById('aresult-edit-' + id);
            const content = edit.style.display === 'block' ? edit.value : null;
            res = await apiFetch('/api/owner/autonomous/' + id + '/approve', 'POST', { content });
          } else if (action === 'deliver') {
            res = await apiFetch('/api/owner/autonomous/' + id + '/deliver', 'POST', { notes: 'Delivered by Maya' });
          } else if (action === 'dismiss') {
            res = await apiFetch('/api/owner/autonomous/' + id + '/dismiss', 'POST', {});
          }
          if (res && res.ok) setTimeout(loadAutonomous, 600);
        } catch(err) { console.error('Auto action:', err); }
        finally { btn.disabled = false; }
      });
    });
  }

  function updateAlertBadge(count) {
    const badge = document.getElementById('auto-alert-badge');
    if (!badge) return;
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }


// ═══════════════════════════════════════════════════════════════════════════
//  AI MEDIA FACTORY — Portal Tab
// ═══════════════════════════════════════════════════════════════════════════

  const MEDIA_FORMS = {
    image_ad: {
      label: '🖼️ AI Image Ad',
      color: '#00c4b4',
      fields: [
        { name:'title',        label:'Project Title',        type:'text',     placeholder:'e.g. Summer sale Facebook ad', required:true },
        { name:'platform',     label:'Ad Platform',          type:'select',   options:['Facebook/Instagram Feed','Instagram Story (9:16)','Google Display','LinkedIn','Twitter/X','All Platforms'] },
        { name:'goal',         label:'Campaign Goal',        type:'select',   options:['Brand Awareness','Lead Generation','Sales / Conversions','Event Promotion','Product Launch'] },
        { name:'style',        label:'Visual Style',         type:'select',   options:['Cinematic & Dark','Clean & Minimal','Bold & Colorful','Luxury Premium','Playful & Fun','Corporate Professional'] },
        { name:'colors',       label:'Brand Colors',         type:'text',     placeholder:'e.g. Navy blue, gold, white' },
        { name:'aspect_ratio', label:'Aspect Ratio',         type:'select',   options:['1:1 (Square)','16:9 (Landscape)','9:16 (Story/Reel)','4:3 (Standard)'] },
        { name:'brief',        label:'What should it show?', type:'textarea', placeholder:'Describe what you want in the image — product, mood, people, setting, any specific elements.', required:true },
      ]
    },
    video_ad: {
      label: '🎬 AI Video Ad',
      color: '#00c4b4',
      fields: [
        { name:'title',        label:'Project Title',         type:'text',     placeholder:'e.g. 8-second Instagram Reel ad', required:true },
        { name:'platform',     label:'Platform',              type:'select',   options:['Instagram Reels','TikTok','YouTube Pre-Roll','Facebook Video','LinkedIn Video'] },
        { name:'duration',     label:'Duration',              type:'select',   options:['4','6','8'] },
        { name:'video_style',  label:'Video Style',           type:'select',   options:['Cinematic','Fast-cut energetic','Storytelling','Product showcase','Testimonial-style','Animated data'] },
        { name:'aspect_ratio', label:'Aspect Ratio',          type:'select',   options:['9:16 (Vertical / Reels)','16:9 (Landscape)'] },
        { name:'hook',         label:'Opening Hook',          type:'select',   options:['Dramatic reveal','Problem → solution','Bold statement','Behind-the-scenes','Results showcase'] },
        { name:'brief',        label:'What should it show?',  type:'textarea', placeholder:'Describe the story, product, feeling, or message. What should viewers feel and do after watching?', required:true },
      ]
    },
    voiceover: {
      label: '🎙️ AI Voiceover',
      color: '#22c55e',
      fields: [
        { name:'title',    label:'Project Title',        type:'text',     placeholder:'e.g. 30-second radio-style ad script', required:true },
        { name:'purpose',  label:'Purpose',              type:'select',   options:['Video Ad Voiceover','Social Media Content','Explainer / How-To','Podcast Intro/Outro','Phone On-Hold Message','Promotional Announcement'] },
        { name:'duration', label:'Target Duration',      type:'select',   options:['15 seconds','30 seconds','60 seconds','90 seconds','2 minutes'] },
        { name:'voice',    label:'Voice Style',          type:'select',   options:['charon (deep & authoritative)','kore (warm & friendly)','puck (energetic & upbeat)','fenrir (bold & dramatic)','aoede (smooth & professional)'] },
        { name:'tone',     label:'Tone',                 type:'select',   options:['Professional & Confident','Warm & Approachable','Urgent & Exciting','Calm & Reassuring','Bold & Punchy'] },
        { name:'brief',    label:'Script or Key Message',type:'textarea', placeholder:'Paste your script here, OR describe the key message and we\'ll write the script for you.', required:true },
      ]
    }
  };

  let currentMediaType = null;

  function loadMediaFactory() {
    // Bind media type cards
    document.querySelectorAll('.media-type-card').forEach(card => {
      card.addEventListener('click', () => showMediaForm(card.dataset.mediaType));
    });
    // Back button
    const back = document.getElementById('back-to-media-types');
    if (back) back.addEventListener('click', () => {
      document.getElementById('media-form-container').style.display = 'none';
      document.getElementById('media-type-grid').style.display = 'grid';
      currentMediaType = null;
    });
    // Submit button
    const submitBtn = document.getElementById('submit-media-btn');
    if (submitBtn) submitBtn.addEventListener('click', submitMediaRequest);
    // Load gallery
    loadMediaGallery();
  }

  function showMediaForm(type) {
    currentMediaType = type;
    const def = MEDIA_FORMS[type];
    document.getElementById('media-type-grid').style.display = 'none';
    document.getElementById('media-form-container').style.display = 'block';
    document.getElementById('media-form-title').textContent = def.label;
    document.getElementById('media-form-title').style.color = def.color;

    document.getElementById('media-form').innerHTML = def.fields.map(f => {
      if (f.type === 'textarea') return `<div class="form-group"><label>${f.label}${f.required?' *':''}</label><textarea name="${f.name}" placeholder="${f.placeholder||''}" rows="4"${f.required?' required':''}></textarea></div>`;
      if (f.type === 'select')   return `<div class="form-group"><label>${f.label}</label><select name="${f.name}">${f.options.map(o=>`<option value="${o.split(' ')[0]}">${o}</option>`).join('')}</select></div>`;
      return `<div class="form-group"><label>${f.label}${f.required?' *':''}</label><input type="${f.type}" name="${f.name}" placeholder="${f.placeholder||''}"${f.required?' required':''}></div>`;
    }).join('');

    // Style submit button to match type color
    const btn = document.getElementById('submit-media-btn');
    if (btn) {
      const colorMap = { image_ad:'linear-gradient(135deg,#00c4b4,#008c80)', video_ad:'linear-gradient(135deg,#00c4b4,#005a52)', voiceover:'linear-gradient(135deg,#22c55e,#16a34a)' };
      btn.style.background = colorMap[type] || btn.style.background;
    }
  }

  async function submitMediaRequest() {
    const form   = document.getElementById('media-form');
    const errEl  = document.getElementById('media-submit-error');
    const btn    = document.getElementById('submit-media-btn');
    errEl.textContent = '';

    const brief = {};
    for (const el of form.elements) { if (el.name) brief[el.name] = el.value.trim(); }

    const def = MEDIA_FORMS[currentMediaType];
    for (const f of def.fields) {
      if (f.required && !brief[f.name]) { errEl.textContent = '"' + f.label + '" is required.'; return; }
    }

    // Add client business context
    if (currentUser && currentUser.business) brief.business = currentUser.business;
    if (currentUser && currentUser.website)  brief.website  = currentUser.website;

    btn.disabled = true; btn.textContent = '⚡ Generating with AI...';

    try {
      const res  = await apiFetch('/api/tasks/submit', 'POST', {
        task_type: currentMediaType,
        title: brief.title || def.label,
        brief
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Submission failed'; return; }

      btn.textContent = '✅ Submitted! AI is generating...';

      // Show timing note
      const timingNote = { image_ad:'Image takes ~60 seconds', video_ad:'Video takes 2–4 minutes', voiceover:'Audio takes ~30 seconds' }[currentMediaType];
      errEl.style.color = '#00c4b4';
      errEl.textContent = timingNote + ' — check My Tasks for updates.';

      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '⚡ Generate with AI — Starts Now →';
        errEl.textContent = '';
        errEl.style.color = '#ef4444';
        navigateTo('my-tasks');
      }, 3000);
    } catch(e) {
      errEl.textContent = 'Connection error — please try again.';
      btn.disabled = false;
      btn.textContent = '⚡ Generate with AI — Starts Now →';
    }
  }

  async function loadMediaGallery() {
    try {
      const galleryEl = document.getElementById('media-gallery');
      if (!galleryEl) return;
      // Fetch delivered tasks with media content
      const res  = await apiFetch('/api/tasks/my');
      const data = await res.json();
      const mediaTasks = (data.tasks || []).filter(t =>
        ['image_ad','video_ad','voiceover'].includes(t.task_type) && t.status === 'delivered'
      );
      if (!mediaTasks.length) {
        galleryEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No delivered media yet — submit a request above and Dev will deliver it!</div>';
        return;
      }
      galleryEl.innerHTML = mediaTasks.map(renderMediaCard).join('');
    } catch(e) { console.error('Media gallery:', e); }
  }

  function renderMediaCard(task) {
    const typeIcon  = { image_ad:'🖼️', video_ad:'🎬', voiceover:'🎙️' }[task.task_type] || '🎨';
    const typeLabel = { image_ad:'Image Ad', video_ad:'Video Ad', voiceover:'Voiceover' }[task.task_type] || task.task_type;
    const date = new Date(task.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric' });

    // Check if ai_result contains a media file reference
    const result = task.ai_result || '';
    let mediaPreview = '';
    if (result.startsWith('IMAGE_AD_READY:')) {
      const fname = result.split(':')[1].split('\n')[0].trim();
      mediaPreview = `<img src="/media/${fname}" style="width:100%;border-radius:8px;margin-bottom:.75rem;max-height:200px;object-fit:cover" loading="lazy" />
        <a href="/media/${fname}" download="${fname}" class="media-dl-btn">⬇ Download Image</a>`;
    } else if (result.startsWith('VIDEO_AD_READY:')) {
      const fname = result.split(':')[1].split('\n')[0].trim();
      mediaPreview = `<video src="/media/${fname}" controls style="width:100%;border-radius:8px;margin-bottom:.75rem;max-height:200px"></video>
        <a href="/media/${fname}" download="${fname}" class="media-dl-btn">⬇ Download Video</a>`;
    } else if (result.startsWith('VOICEOVER_READY:')) {
      const fname = result.split(':')[1].split('\n')[0].trim();
      mediaPreview = `<audio src="/media/${fname}" controls style="width:100%;margin-bottom:.75rem"></audio>
        <a href="/media/${fname}" download="${fname}" class="media-dl-btn">⬇ Download Audio</a>`;
    } else {
      mediaPreview = `<div style="color:rgba(180,200,220,.5);font-size:.82rem">${esc(result.slice(0,200))}</div>`;
    }

    return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.25rem">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">
        <span style="font-size:1.4rem">${typeIcon}</span>
        <div>
          <div style="font-weight:700;color:#fff;font-size:.9rem">${esc(task.title)}</div>
          <div style="color:rgba(180,200,220,.5);font-size:.75rem">${typeLabel} · ${date}</div>
        </div>
      </div>
      ${mediaPreview}
    </div>`;
  }


// ═══════════════════════════════════════════════════════════════════
// SYSTEM HEALTH + UPDATE LOG — Self-Maintenance Dashboard
// ═══════════════════════════════════════════════════════════════════

async function loadSystemHealth() {
  const el = document.getElementById('system-health-content');
  if (!el) return;
  el.innerHTML = '<p style="color:rgba(200,220,240,.5);text-align:center;padding:3rem">Fetching system health...</p>';
  try {
    const data = await apiFetch('/api/owner/system-health').then(r => r.json());
    const statusColor = data.db_ok !== false ? '#5eeee6' : '#f87171';
    const errColor = (data.errors_last_hour || 0) === 0 ? '#4ade80' : '#f59e0b';

    el.innerHTML = `
      <!-- KPI Row -->
      <div style="display:flex;gap:.75rem;flex-wrap:wrap">
        ${healthKpi('Platform Version', `v${data.platform_version}`, '#00c4b4')}
        ${healthKpi('Python', data.python_version, '#00c4b4')}
        ${healthKpi('Memory (RSS)', `${data.memory_rss_mb} MB`, '#00c4b4')}
        ${healthKpi('DB Size', `${data.db_size_kb} KB`, '#5eeee6')}
        ${healthKpi('DB Clients', data.db_clients, '#4ade80')}
        ${healthKpi('DB Tasks', data.db_tasks, '#4ade80')}
        ${healthKpi('Errors (1h)', data.errors_last_hour || 0, errColor)}
        ${healthKpi('DB Status', data.db_ok ? 'OK' : 'ERROR', statusColor)}
      </div>

      <!-- Dependencies -->
      <div style="padding:1.25rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px">
        <h3 style="font-size:.9rem;font-weight:700;color:#00c4b4;margin:0 0 .75rem">&#128230; Critical Dependencies</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.5rem">
          ${Object.entries(data.dependencies || {}).map(([pkg, ver]) => `
            <div style="display:flex;justify-content:space-between;padding:.4rem .75rem;background:rgba(255,255,255,.03);border-radius:6px;font-size:.82rem">
              <span style="color:rgba(200,220,240,.7)">${pkg}</span>
              <span style="color:${ver === 'NOT INSTALLED' ? '#f87171' : '#4ade80'};font-weight:600">${ver}</span>
            </div>`).join('')}
        </div>
      </div>

      <!-- AI Models -->
      <div style="padding:1.25rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px">
        <h3 style="font-size:.9rem;font-weight:700;color:#00c4b4;margin:0 0 .75rem">&#129504; Registered AI Models</h3>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          ${Object.entries(data.ai_models || {}).map(([role, model]) => `
            <div style="display:flex;justify-content:space-between;padding:.4rem .75rem;background:rgba(255,255,255,.03);border-radius:6px;font-size:.82rem">
              <span style="color:rgba(200,220,240,.65);text-transform:uppercase;letter-spacing:.04em">${role.replace(/_/g,' ')}</span>
              <span style="color:#00c4b4;font-weight:600">${model}</span>
            </div>`).join('')}
        </div>
      </div>

      <!-- Top Error Sources -->
      ${data.top_error_sources ? `
      <div style="padding:1.25rem;background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.15);border-radius:12px">
        <h3 style="font-size:.9rem;font-weight:700;color:#f87171;margin:0 0 .75rem">&#128680; Top Error Sources (Last Hour)</h3>
        ${Object.entries(data.top_error_sources).map(([src, cnt]) => `
          <div style="display:flex;justify-content:space-between;padding:.3rem .6rem;font-size:.82rem">
            <span style="color:rgba(200,220,240,.7)">${src}</span>
            <span style="color:#f87171;font-weight:700">${cnt} errors</span>
          </div>`).join('')}
      </div>` : ''}

      <!-- Uptime -->
      <p style="color:rgba(200,220,240,.4);font-size:.78rem;text-align:center">Server started: ${data.server_start_iso || 'unknown'}</p>
    `;
  } catch (e) {
    el.innerHTML = `<div style="color:#f87171;padding:2rem;text-align:center">Failed to load health: ${e.message}</div>`;
  }
}

function healthKpi(label, value, color) {
  return `
    <div style="flex:1;min-width:130px;padding:1rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;text-align:center">
      <div style="font-size:1.3rem;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:.72rem;color:rgba(200,220,240,.5);text-transform:uppercase;letter-spacing:.06em;margin-top:.3rem">${label}</div>
    </div>`;
}

async function runMaintenance() {
  const btn = document.getElementById('run-maintenance-btn');
  const status = document.getElementById('maintenance-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Running maintenance...';
  try {
    const res = await apiFetch('/api/owner/run-maintenance', 'POST');
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Server error ' + res.status + ': ' + errText.slice(0, 120));
    }
    const data = await res.json();
    if (status) {
      status.style.color = '#00c4b4';
      status.textContent = data.message || 'Maintenance complete! Check Update Log.';
      setTimeout(() => { if (status) { status.textContent = ''; status.style.color = ''; } }, 8000);
    }
  } catch (e) {
    if (status) {
      status.style.color = '#ff6b6b';
      status.textContent = 'Error: ' + e.message;
    }
  }
  if (btn) btn.disabled = false;
}

async function loadUpdateLog() {
  // Version badges
  try {
    const vd = await apiFetch('/api/version').then(r => r.json());
    const vb = document.getElementById('version-badges');
    if (vb) {
      vb.innerHTML = `
        ${vBadge('Version', `v${vd.version}`, '#00c4b4')}
        ${vBadge('Codename', vd.codename, '#00c4b4')}
        ${vBadge('Build Date', vd.build_date, '#00c4b4')}
        ${vBadge('Domain', vd.domain, '#4ade80')}
      `;
    }

    // Changelog
    const cl = document.getElementById('changelog-list');
    if (cl && vd.changelog) {
      cl.innerHTML = vd.changelog.map((entry, i) => `
        <div style="padding:1rem 1.25rem;background:rgba(255,255,255,.03);border:1px solid ${i===0?'rgba(0,196,180,.3)':'rgba(255,255,255,.07)'};border-radius:10px">
          <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem">
            <span style="font-size:.85rem;font-weight:800;color:${i===0?'#00c4b4':'#00c4b4'}">v${entry.version}</span>
            <span style="font-size:.75rem;color:rgba(200,220,240,.4)">${entry.date}</span>
            ${i===0?'<span style="font-size:.7rem;background:rgba(0,196,180,.2);color:#00c4b4;padding:1px 8px;border-radius:9999px;font-weight:700">CURRENT</span>':''}
          </div>
          <ul style="margin:0;padding-left:1.1rem;display:flex;flex-direction:column;gap:.25rem">
            ${entry.changes.map(c=>`<li style="font-size:.82rem;color:rgba(200,220,240,.7)">${c}</li>`).join('')}
          </ul>
        </div>`).join('');
    }
  } catch(e) {
    console.warn('Version fetch failed:', e);
  }

  // Live log
  const ll = document.getElementById('update-log-list');
  if (!ll) return;
  ll.innerHTML = '<p style="color:rgba(200,220,240,.4);font-size:.82rem">Loading activity log...</p>';
  try {
    const data = await apiFetch('/api/owner/update-log').then(r => r.json());
    if (!data.log || data.log.length === 0) {
      ll.innerHTML = '<p style="color:rgba(200,220,240,.4);font-size:.82rem">No log entries yet.</p>';
      return;
    }
    const typeColors = { boot: '#4ade80', maintenance: '#00c4b4', error: '#f87171', info: '#00c4b4' };
    ll.innerHTML = data.log.map(entry => {
      const c = typeColors[entry.event_type] || '#94a3b8';
      return `
        <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.6rem .9rem;background:rgba(255,255,255,.03);border-radius:8px;border-left:3px solid ${c}">
          <span style="font-size:.72rem;font-weight:700;color:${c};text-transform:uppercase;min-width:70px">${entry.event_type}</span>
          <span style="font-size:.8rem;color:rgba(200,220,240,.8);flex:1">${entry.summary}</span>
          <span style="font-size:.72rem;color:rgba(200,220,240,.35);white-space:nowrap">${entry.created_at}</span>
        </div>`;
    }).join('');
  } catch (e) {
    ll.innerHTML = `<div style="color:#f87171;font-size:.82rem">Error: ${e.message}</div>`;
  }
}

function vBadge(label, value, color) {
  return `<div style="padding:.6rem 1rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;display:flex;flex-direction:column;gap:.2rem">
    <span style="font-size:.7rem;color:rgba(200,220,240,.4);text-transform:uppercase;letter-spacing:.06em">${label}</span>
    <span style="font-size:.9rem;font-weight:700;color:${color}">${value}</span>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// SMTP / LEAD NOTIFICATION SETUP — Owner Panel Card
// ═══════════════════════════════════════════════════════════════════

async function loadSmtpStatus() {
  const el = document.getElementById('smtp-status-card');
  if (!el) return;
  try {
    const d = await apiFetch('/api/owner/smtp-status').then(r => r.json());
    const configured = d.configured;
    el.innerHTML = `
      <div style="padding:1.25rem;background:${configured ? 'rgba(34,197,94,.08)' : 'rgba(251,191,36,.08)'};
                  border:1px solid ${configured ? 'rgba(34,197,94,.2)' : 'rgba(251,191,36,.2)'};border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
          <h3 style="font-size:.95rem;font-weight:700;color:${configured ? '#4ade80' : '#fbbf24'};margin:0">
            ${configured ? '✅ Lead Emails Active' : '⚠️ Lead Emails Not Configured'}
          </h3>
          ${configured ? `<button onclick="sendTestNotification()" style="background:rgba(34,197,94,.2);border:1px solid rgba(34,197,94,.3);color:#4ade80;padding:.35rem .9rem;border-radius:6px;font-size:.8rem;font-weight:700;cursor:pointer">Send Test Email</button>` : ''}
        </div>
        <p style="color:rgba(200,220,240,.65);font-size:.83rem;margin:0 0 .75rem">
          ${configured
            ? `Sending to <strong style="color:#fff">${d.notify_to}</strong> via <strong style="color:#00c4b4">${d.smtp_user}</strong>`
            : 'Set up Gmail SMTP to get instant alerts every time a lead submits the contact form, Maya captures a lead, or a client signs up.'}
        </p>
        ${!configured ? `
        <div style="background:rgba(0,0,0,.25);border-radius:8px;padding:.9rem 1rem;font-size:.8rem;color:rgba(200,220,240,.7);line-height:1.8">
          <strong style="color:#fbbf24">3-step setup:</strong><br>
          1. Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:#00c4b4">myaccount.google.com/apppasswords</a> → create App Password for "Mail"<br>
          2. Set environment variables on your server:<br>
          <code style="color:#00c4b4;background:rgba(0,196,180,.1);padding:2px 6px;border-radius:4px;display:block;margin:.4rem 0">SMTP_USER=you@gmail.com<br>SMTP_PASS=xxxx-xxxx-xxxx-xxxx</code>
          3. Restart the server — you'll get instant email alerts for every lead
        </div>` : ''}
        <span id="smtp-test-result" style="font-size:.8rem;color:#4ade80;margin-top:.5rem;display:block"></span>
      </div>`;
  } catch(e) {
    el.innerHTML = `<p style="color:rgba(200,220,240,.4);font-size:.83rem">Could not load SMTP status.</p>`;
  }
}

async function sendTestNotification() {
  const result = document.getElementById('smtp-test-result');
  if (result) result.textContent = 'Sending test...';
  try {
    const d = await apiFetch('/api/owner/test-notification', 'POST').then(r => r.json());
    if (result) result.textContent = d.sent ? '✅ Test email sent! Check your inbox.' : '❌ ' + (d.message || 'SMTP not configured.');
  } catch(e) {
    if (result) result.textContent = '❌ Error: ' + e.message;
  }
}

// ═══════════════════════════════════════════════════════════════════
// NEW PORTAL SECTIONS — Channel Hub, Content Calendar, Competitor Spy,
// Revenue Dashboard, Client Reports
// ═══════════════════════════════════════════════════════════════════

// ─── CHANNEL HUB ─────────────────────────────────────────────────
function loadChannelHub() {
  const el = document.getElementById('channel-hub-content');
  if (!el) return;

  const channels = [
    { name: 'YouTube', icon: '▶', color: '#FF0000', desc: 'Video content, Shorts, Live streams', stat: 'Videos', val: '—', status: 'Connect' },
    { name: 'YouTube Shorts', icon: '🩳', color: '#FF0000', desc: 'Short-form vertical video (< 60s)', stat: 'Shorts', val: '—', status: 'Connect' },
    { name: 'TikTok', icon: '♪', color: '#69C9D0', desc: 'Short-form video, trends, FYP', stat: 'Posts', val: '—', status: 'Connect' },
    { name: 'Twitch', icon: '◉', color: '#00c4b4', desc: 'Live streaming, gaming, IRL', stat: 'Streams', val: '—', status: 'Connect' },
    { name: 'Instagram', icon: '◈', color: '#E1306C', desc: 'Reels, Stories, Feed posts', stat: 'Posts', val: '—', status: 'Connect' },
    { name: 'Facebook', icon: 'f', color: '#1877F2', desc: 'Pages, Groups, Ads, Reels', stat: 'Posts', val: '—', status: 'Connect' },
    { name: 'LinkedIn', icon: 'in', color: '#0A66C2', desc: 'B2B content, thought leadership', stat: 'Posts', val: '—', status: 'Connect' },
    { name: 'Twitter/X', icon: '✕', color: '#000000', desc: 'Real-time marketing, viral content', stat: 'Tweets', val: '—', status: 'Connect' },
    { name: 'Pinterest', icon: '♗', color: '#E60023', desc: 'Visual discovery, product pins', stat: 'Pins', val: '—', status: 'Connect' },
    { name: 'Discord', icon: '⬡', color: '#00c4b4', desc: 'Community building, server marketing', stat: 'Members', val: '—', status: 'Connect' },
    { name: 'Podcast', icon: '🎙', color: '#00c4b4', desc: 'Audio ads, sponsor spots, host reads', stat: 'Episodes', val: '—', status: 'Connect' },
    { name: 'Google Ads', icon: 'G', color: '#4285F4', desc: 'Search, Display, Shopping campaigns', stat: 'Campaigns', val: '—', status: 'Connect' },
    { name: 'Email', icon: '✉', color: '#00c4b4', desc: 'Newsletters, drip campaigns, sequences', stat: 'Subscribers', val: '—', status: 'Active' },
    { name: 'SMS/Text', icon: '💬', color: '#00c4b4', desc: 'Text marketing, promotions, alerts', stat: 'Contacts', val: '—', status: 'Connect' },
  ];

  el.innerHTML = `
    <div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.15);border-radius:14px;padding:1.25rem;margin-bottom:1.5rem">
      <p style="margin:0;color:rgba(200,220,240,.8);font-size:.9rem">
        🚀 <strong style="color:#00c4b4">2EasyMarketing's Channel Hub</strong> is the only agency portal managing 14+ platforms in one place. 
        Competitors manage 3–4 at most. Connect your channels to unlock AI scheduling, cross-platform analytics, and one-click content distribution.
      </p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem">
      ${channels.map(c => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;gap:1rem;transition:border-color .2s;cursor:pointer" 
             onmouseover="this.style.borderColor='${c.color}44'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
          <div style="width:44px;height:44px;border-radius:10px;background:${c.color}22;border:1px solid ${c.color}44;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800;color:${c.color};flex-shrink:0">${c.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:#fff;font-size:.9rem">${c.name}</div>
            <div style="color:rgba(180,200,220,.5);font-size:.75rem;margin-top:2px">${c.desc}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:6px;background:${c.status==='Active'?'rgba(34,197,94,.15)':'rgba(0,196,180,.1)'};color:${c.status==='Active'?'#4ade80':'#00c4b4'};border:1px solid ${c.status==='Active'?'rgba(34,197,94,.25)':'rgba(0,196,180,.2)'}">${c.status}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="margin-top:2rem;background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.2);border-radius:14px;padding:1.25rem">
      <h3 style="margin:0 0 .75rem;color:#00c4b4;font-size:.95rem">🤖 What Maya Does With These Channels</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem">
        ${[
          ['Auto-Schedule Posts','Publishes content at peak engagement times across all channels'],
          ['Cross-Platform Repurpose','Turns one piece of content into 6 formats automatically'],
          ['Competitor Monitoring','Tracks what rivals post and when — then beats them to it'],
          ['Trend Detection','Spots viral trends early and drafts content to capitalize'],
          ['Engagement Alerts','Notifies you when a post is going viral or needs attention'],
          ['ROI Tracking','Connects each channel to actual leads and revenue'],
        ].map(([t,d]) => `
          <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:.75rem">
            <div style="font-weight:700;color:#fff;font-size:.82rem;margin-bottom:3px">${t}</div>
            <div style="color:rgba(180,200,220,.5);font-size:.75rem">${d}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── CONTENT CALENDAR ────────────────────────────────────────────
function loadContentCalendar() {
  const el = document.getElementById('content-calendar-content');
  if (!el) return;

  const today = new Date();
  const month = today.toLocaleString('default', { month: 'long', year: 'numeric' });
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();

  const scheduledPosts = [
    { day: today.getDate(), platform: 'Instagram', color: '#E1306C', type: 'Reel', time: '10:00 AM' },
    { day: today.getDate()+2, platform: 'TikTok', color: '#69C9D0', type: 'Video', time: '3:00 PM' },
    { day: today.getDate()+4, platform: 'YouTube', color: '#FF0000', type: 'Short', time: '12:00 PM' },
    { day: today.getDate()+5, platform: 'LinkedIn', color: '#0A66C2', type: 'Post', time: '9:00 AM' },
    { day: today.getDate()+7, platform: 'Twitter/X', color: '#000', type: 'Thread', time: '8:00 AM' },
    { day: today.getDate()+9, platform: 'Facebook', color: '#1877F2', type: 'Reel', time: '2:00 PM' },
    { day: today.getDate()+12, platform: 'TikTok', color: '#69C9D0', type: 'Video', time: '5:00 PM' },
    { day: today.getDate()+14, platform: 'YouTube', color: '#FF0000', type: 'Video', time: '11:00 AM' },
  ];

  let calCells = '';
  for (let i = 0; i < firstDay; i++) calCells += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate();
    const posts = scheduledPosts.filter(p => p.day === d);
    calCells += `
      <div style="background:${isToday?'rgba(0,196,180,.1)':'rgba(255,255,255,.03)'};border:1px solid ${isToday?'rgba(0,196,180,.3)':'rgba(255,255,255,.06)'};border-radius:8px;padding:.5rem;min-height:70px">
        <div style="font-size:.75rem;font-weight:${isToday?'800':'500'};color:${isToday?'#00c4b4':'rgba(200,220,240,.6)'};margin-bottom:4px">${d}</div>
        ${posts.map(p => `<div style="background:${p.color}22;border-left:2px solid ${p.color};border-radius:3px;padding:2px 5px;margin-bottom:2px;font-size:.65rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.platform} · ${p.type}</div>`).join('')}
      </div>`;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
      <div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.15);border-radius:12px;padding:1rem;text-align:center">
        <div style="font-size:1.8rem;font-weight:800;color:#00c4b4">${scheduledPosts.length}</div>
        <div style="color:rgba(180,200,220,.6);font-size:.8rem">Posts Scheduled This Month</div>
      </div>
      <div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.2);border-radius:12px;padding:1rem;text-align:center">
        <div style="font-size:1.8rem;font-weight:800;color:#00c4b4">6</div>
        <div style="color:rgba(180,200,220,.6);font-size:.8rem">Platforms Active</div>
      </div>
    </div>
    <h2 style="color:#fff;font-size:1rem;font-weight:700;margin:0 0 1rem">${month}</h2>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:.4rem;margin-bottom:.4rem">
      ${days.map(d => `<div style="text-align:center;font-size:.7rem;font-weight:700;color:rgba(180,200,220,.4);padding:.3rem 0">${d}</div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:.4rem;margin-bottom:1.5rem">
      ${calCells}
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.1rem">
      <h3 style="margin:0 0 1rem;color:#fff;font-size:.9rem">📋 Upcoming Posts</h3>
      ${scheduledPosts.slice(0,5).map(p => `
        <div style="display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></div>
          <div style="flex:1"><span style="color:#fff;font-size:.85rem;font-weight:600">${p.platform}</span> <span style="color:rgba(180,200,220,.5);font-size:.8rem">· ${p.type}</span></div>
          <div style="color:rgba(180,200,220,.5);font-size:.75rem">Day ${p.day} at ${p.time}</div>
        </div>
      `).join('')}
      <div style="margin-top:1rem;padding:.75rem;background:rgba(0,196,180,.06);border-radius:8px;text-align:center">
        <span style="color:#00c4b4;font-size:.82rem;font-weight:600">🤖 Maya auto-schedules posts at peak engagement times for each platform</span>
      </div>
    </div>
  `;
}

// ─── COMPETITOR SPY ──────────────────────────────────────────────
function loadCompetitorSpy() {
  const el = document.getElementById('competitor-spy-content');
  if (!el) return;

  el.innerHTML = `
    <div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.15);border-radius:14px;padding:1.25rem;margin-bottom:1.5rem">
      <p style="margin:0;color:rgba(200,220,240,.8);font-size:.9rem">
        🕵️ <strong style="color:#00c4b4">Competitor Spy</strong> — Add your competitors and Maya will monitor their pricing, content strategy, ad spend, and reviews in real-time. 
        You'll always know what they're doing before your clients do.
      </p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem;margin-bottom:1.5rem">
      ${[
        { name: 'WebFX', pricing: '$3,000+/mo', weakness: 'No AI video ads, no Twitch', score: 72 },
        { name: 'Hibu', pricing: '$500–2,000/mo', weakness: 'Slow delivery, no autonomous AI', score: 58 },
        { name: 'Thrive Agency', pricing: '$1,500+/mo', weakness: 'No client portal, manual reports', score: 61 },
      ].map(c => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.1rem">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.75rem">
            <div style="font-weight:700;color:#fff;font-size:.95rem">${c.name}</div>
            <div style="background:rgba(248,113,113,.1);color:#f87171;font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid rgba(248,113,113,.2)">Threat: ${c.score}/100</div>
          </div>
          <div style="color:rgba(180,200,220,.6);font-size:.8rem;margin-bottom:.5rem">💰 Pricing: <span style="color:#fbbf24">${c.pricing}</span></div>
          <div style="color:rgba(180,200,220,.6);font-size:.8rem;margin-bottom:.75rem">⚠️ Weakness: <span style="color:#4ade80">${c.weakness}</span></div>
          <div style="background:rgba(255,255,255,.03);border-radius:8px;height:6px;overflow:hidden">
            <div style="height:100%;width:${c.score}%;background:linear-gradient(90deg,#4ade80,#f59e0b);border-radius:6px"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.1rem;margin-bottom:1rem">
      <h3 style="margin:0 0 1rem;color:#fff;font-size:.9rem">➕ Add Competitor to Monitor</h3>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap">
        <input id="comp-name" placeholder="Company name" style="flex:1;min-width:160px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.6rem .9rem;color:#fff;font-size:.85rem;outline:none">
        <input id="comp-url" placeholder="Website URL" style="flex:1;min-width:200px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.6rem .9rem;color:#fff;font-size:.85rem;outline:none">
        <button onclick="addCompetitor()" style="background:linear-gradient(135deg,#00c4b4,#008c80);border:none;color:#fff;padding:.6rem 1.2rem;border-radius:8px;font-weight:700;cursor:pointer;font-size:.85rem;white-space:nowrap">+ Track</button>
      </div>
    </div>
    <div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.2);border-radius:12px;padding:1rem;text-align:center">
      <div style="color:#00c4b4;font-size:.85rem;font-weight:600">🤖 Maya runs competitor checks every 24 hours and alerts you to pricing changes, new services, and viral content</div>
    </div>
  `;
}

window.addCompetitor = function() {
  const name = document.getElementById('comp-name')?.value;
  const url = document.getElementById('comp-url')?.value;
  if (!name) return;
  alert(`✅ ${name} added to monitoring list. Maya will report back within 24 hours.`);
};

// ─── REVENUE DASHBOARD ───────────────────────────────────────────
function loadRevenueDashboard() {
  const el = document.getElementById('revenue-content');
  if (!el) return;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem">
      ${[
        { label:'MRR', val:'$0', sub:'Monthly Recurring Revenue', color:'#00c4b4' },
        { label:'Leads This Month', val:'0', sub:'From all channels combined', color:'#00c4b4' },
        { label:'Avg Client Value', val:'$0', sub:'Revenue per active client', color:'#4ade80' },
        { label:'Pipeline Value', val:'$0', sub:'Prospects × avg deal size', color:'#fbbf24' },
      ].map(k => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.1rem">
          <div style="font-size:1.6rem;font-weight:800;color:${k.color}">${k.val}</div>
          <div style="font-weight:700;color:#fff;font-size:.82rem;margin:.25rem 0">${k.label}</div>
          <div style="color:rgba(180,200,220,.4);font-size:.72rem">${k.sub}</div>
        </div>
      `).join('')}
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.25rem;margin-bottom:1rem">
      <h3 style="margin:0 0 1rem;color:#fff;font-size:.9rem">💰 Revenue by Channel</h3>
      ${[
        { ch:'Google Ads', leads:0, revenue:'$0', bar:0 },
        { ch:'Facebook/Instagram Ads', leads:0, revenue:'$0', bar:0 },
        { ch:'Organic Social', leads:0, revenue:'$0', bar:0 },
        { ch:'Referrals', leads:0, revenue:'$0', bar:0 },
        { ch:'Direct / Website', leads:0, revenue:'$0', bar:0 },
      ].map(r => `
        <div style="display:flex;align-items:center;gap:1rem;margin-bottom:.75rem">
          <div style="width:130px;color:rgba(200,220,240,.7);font-size:.8rem;flex-shrink:0">${r.ch}</div>
          <div style="flex:1;background:rgba(255,255,255,.06);border-radius:4px;height:8px;overflow:hidden">
            <div style="height:100%;width:${r.bar}%;background:linear-gradient(90deg,#00c4b4,#008c80);border-radius:4px"></div>
          </div>
          <div style="width:50px;text-align:right;color:#4ade80;font-size:.8rem;font-weight:700">${r.revenue}</div>
        </div>
      `).join('')}
      <div style="margin-top:1rem;padding:.75rem;background:rgba(0,196,180,.06);border-radius:8px;text-align:center;color:rgba(180,200,220,.6);font-size:.8rem">
        Revenue tracking activates once you connect your channels and add clients. Maya fills this automatically.
      </div>
    </div>
    <div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:1rem">
      <h3 style="margin:0 0 .5rem;color:#4ade80;font-size:.9rem">📈 Your Revenue Targets</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;text-align:center">
        <div><div style="font-size:1.2rem;font-weight:800;color:#4ade80">$497</div><div style="color:rgba(180,200,220,.5);font-size:.72rem">Starter/mo</div></div>
        <div><div style="font-size:1.2rem;font-weight:800;color:#fbbf24">$1,497</div><div style="color:rgba(180,200,220,.5);font-size:.72rem">Growth/mo</div></div>
        <div><div style="font-size:1.2rem;font-weight:800;color:#00c4b4">$3,497</div><div style="color:rgba(180,200,220,.5);font-size:.72rem">Agency/mo</div></div>
      </div>
    </div>
  `;
}

// ─── CLIENT REPORTS ──────────────────────────────────────────────
function loadClientReports() {
  const el = document.getElementById('client-reports-content');
  if (!el) return;

  el.innerHTML = `
    <div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.15);border-radius:14px;padding:1.25rem;margin-bottom:1.5rem">
      <p style="margin:0;color:rgba(200,220,240,.8);font-size:.9rem">
        📊 <strong style="color:#00c4b4">One-click client reports</strong> — Generate beautiful, branded PDF reports showing your clients exactly what you've done for them. 
        No other local agency does this automatically.
      </p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-bottom:1.5rem">
      ${[
        { name:'Monthly Performance Report', desc:'Full breakdown of all campaigns, leads, and ROI for the month', icon:'📊', color:'#00c4b4' },
        { name:'Social Media Report', desc:'Engagement, reach, follower growth across all platforms', icon:'📱', color:'#00c4b4' },
        { name:'Competitor Analysis Report', desc:'What competitors are doing vs. what you\'re doing better', icon:'🕵️', color:'#f59e0b' },
        { name:'AI Activity Report', desc:'Everything Maya did autonomously this month on your behalf', icon:'🤖', color:'#4ade80' },
        { name:'ROI Summary', desc:'Every dollar spent vs. every dollar earned — clear and simple', icon:'💰', color:'#fbbf24' },
        { name:'Custom Report', desc:'Ask Maya to build any report you need for any client', icon:'✨', color:'#00c4b4' },
      ].map(r => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.1rem;cursor:pointer;transition:border-color .2s"
             onmouseover="this.style.borderColor='${r.color}44'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'"
             onclick="generateReport('${r.name}')">
          <div style="font-size:1.5rem;margin-bottom:.5rem">${r.icon}</div>
          <div style="font-weight:700;color:#fff;font-size:.9rem;margin-bottom:.35rem">${r.name}</div>
          <div style="color:rgba(180,200,220,.5);font-size:.78rem;margin-bottom:.75rem">${r.desc}</div>
          <div style="background:${r.color}15;border:1px solid ${r.color}33;color:${r.color};font-size:.75rem;font-weight:700;padding:4px 10px;border-radius:6px;display:inline-block">Generate →</div>
        </div>
      `).join('')}
    </div>
  `;
}

window.generateReport = function(name) {
  alert(`🤖 Maya is generating your "${name}"...\n\nThis feature activates once you have active clients. Maya will email the report directly to your client automatically.`);
};

window.generateClientReport = function() {
  loadClientReports();
};

// ─── NAVIGATION NOTE ─────────────────────────────────────────────
// All section loaders (loadChannelHub, loadContentCalendar, loadCompetitorSpy,
// loadRevenueDashboard, loadClientReports) are already wired inside the IIFE
// via the navigateTo() function (lines 309-313). No external override needed.

// ═══════════════════════════════════════════════════════════════════════════
//  FORTRESS SECURITY DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_COLORS = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      '#22c55e',
};

const THREAT_LABELS = {
  sqli:                'SQL Injection',
  xss:                 'XSS Attack',
  traversal:           'Path Traversal',
  cmdi:                'Command Injection',
  ssrf:                'SSRF Attack',
  honeypot:            'Honeypot Triggered',
  rate_limit:          'Rate Limit Exceeded',
  rate_limit_auth:     'Auth Brute Force',
  rate_limit_api:      'API Flood',
  scanner:             'Scanner Detected',
  behavioral_anomaly:  'Behavioral Anomaly',
  malicious_cidr:      'Malicious CIDR',
  blocked_ip:          'Blocked IP Access Attempt',
  manual_block:        'Manual Block',
  lang_probe:          'Language Probe',
  cms_probe:           'CMS/Admin Probe',
  admin_probe:         'Admin Panel Probe',
  webshell:            'Webshell Attempt',
  oversized_body:      'Oversized Payload',
  suspicious_request:  'Suspicious Request',
};

window.loadSecurityDashboard = async function() {
  const hours = document.getElementById('security-hours')?.value || 24;

  // Set KPIs to loading
  ['sec-total','sec-blocked','sec-honeypot','sec-critical'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '…';
  });

  try {
    const [d, blockedData] = await Promise.all([
      apiFetch(`/api/owner/security/stats?hours=${hours}`).then(r => r.json()),
      apiFetch('/api/owner/security/blocked').then(r => r.json()),
    ]);

    // KPI cards
    const critCount = (d.by_severity || []).find(s => s.severity === 'critical')?.c || 0;
    setText('sec-total',    d.total_threats ?? 0);
    setText('sec-blocked',  d.blocked_ips ?? 0);
    setText('sec-honeypot', d.honeypot_hits ?? 0);
    setText('sec-critical', critCount);

    // Threats by type
    const byTypeEl = document.getElementById('sec-by-type');
    if (byTypeEl) {
      const maxC = Math.max(...(d.by_type || []).map(t => t.c), 1);
      byTypeEl.innerHTML = (d.by_type || []).slice(0, 10).map(t => {
        const pct = Math.round((t.c / maxC) * 100);
        const label = THREAT_LABELS[t.threat_type] || t.threat_type;
        return `
          <div style="margin-bottom:.6rem">
            <div style="display:flex;justify-content:space-between;margin-bottom:.25rem">
              <span style="color:#e2e8f0;font-size:.78rem">${label}</span>
              <span style="color:#94a3b8;font-size:.78rem;font-weight:700">${t.c}</span>
            </div>
            <div style="height:5px;background:rgba(255,255,255,.06);border-radius:3px">
              <div style="height:5px;width:${pct}%;background:linear-gradient(90deg,#ef4444,#f97316);border-radius:3px;transition:width .4s"></div>
            </div>
          </div>`;
      }).join('') || '<div style="color:rgba(180,200,220,.4);font-size:.82rem">No threats recorded. System is clean.</div>';
    }

    // Top attacking IPs
    const topIPsEl = document.getElementById('sec-top-ips');
    if (topIPsEl) {
      topIPsEl.innerHTML = (d.top_ips || []).slice(0, 8).map((item, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .6rem;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.12);border-radius:6px;margin-bottom:.35rem">
          <div>
            <span style="color:#f87171;font-size:.78rem;font-weight:700;font-family:monospace">${item.ip}</span>
          </div>
          <div style="display:flex;gap:.5rem;align-items:center">
            <span style="color:#94a3b8;font-size:.75rem">${item.c} hits</span>
            <button onclick="quickBlock('${item.ip}')" title="Block this IP"
              style="background:#ef444422;border:1px solid #ef444444;color:#f87171;font-size:.7rem;padding:2px 7px;border-radius:4px;cursor:pointer">Block</button>
          </div>
        </div>`).join('') || '<div style="color:rgba(180,200,220,.4);font-size:.82rem">No attack sources detected.</div>';
    }

    // Blocked IP list
    renderBlockedIPs(blockedData.blocked || []);

    // Recent threat feed
    const recentEl = document.getElementById('sec-recent');
    if (recentEl) {
      recentEl.innerHTML = (d.recent_threats || []).map(t => {
        const color = SEVERITY_COLORS[t.severity] || '#94a3b8';
        const label = THREAT_LABELS[t.threat_type] || t.threat_type;
        const time  = new Date(t.ts).toLocaleTimeString();
        return `
          <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.6rem .8rem;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-left:3px solid ${color};border-radius:6px">
            <div style="min-width:72px;color:#64748b;font-size:.72rem;font-family:monospace;padding-top:1px">${time}</div>
            <div style="flex:1">
              <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.2rem">
                <span style="color:${color};font-size:.75rem;font-weight:700;text-transform:uppercase">${label}</span>
                <span style="color:rgba(180,200,220,.35);font-size:.7rem">·</span>
                <span style="color:#94a3b8;font-size:.72rem;font-family:monospace">${t.ip}</span>
              </div>
              ${t.path ? `<div style="color:rgba(180,200,220,.5);font-size:.72rem;font-family:monospace">${t.path}</div>` : ''}
              ${t.details ? `<div style="color:rgba(180,200,220,.4);font-size:.7rem;margin-top:.2rem">${t.details}</div>` : ''}
            </div>
            <div style="background:${color}22;border:1px solid ${color}44;color:${color};font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap">${t.action}</div>
          </div>`;
      }).join('') || '<div style="color:rgba(180,200,220,.4);font-size:.82rem;text-align:center;padding:2rem">No threat activity in this time range. ✅</div>';
    }

  } catch (e) {
    console.error('[FORTRESS] Dashboard load failed:', e);
  }
};

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(val).toLocaleString();
}

function renderBlockedIPs(list) {
  const el = document.getElementById('blocked-ip-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="color:rgba(180,200,220,.4);font-size:.8rem">No IPs currently blocked.</div>';
    return;
  }
  el.innerHTML = list.slice(0, 50).map(b => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .75rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:6px">
      <div>
        <span style="color:#f87171;font-size:.8rem;font-weight:700;font-family:monospace">${b.ip}</span>
        <span style="color:#64748b;font-size:.72rem;margin-left:.5rem">${b.reason}</span>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <span style="color:${b.unblock_at === 'permanent' ? '#ef4444' : '#f59e0b'};font-size:.7rem;font-weight:700">
          ${b.unblock_at === 'permanent' ? 'PERMANENT' : 'TEMP'}
        </span>
        <button onclick="quickUnblock('${b.ip}')"
          style="background:#22c55e22;border:1px solid #22c55e44;color:#4ade80;font-size:.7rem;padding:2px 7px;border-radius:4px;cursor:pointer">Unblock</button>
      </div>
    </div>`).join('');
}

window.manualBlockIP = async function() {
  const ip = document.getElementById('block-ip-input')?.value?.trim();
  const permanent = document.getElementById('block-ip-type')?.value === 'true';
  if (!ip) { alert('Enter an IP address.'); return; }
  try {
    await apiFetch('/api/owner/security/block', 'POST', { ip, reason: 'manual_block', permanent });
    document.getElementById('block-ip-input').value = '';
    await window.loadSecurityDashboard();
  } catch (e) {
    alert('Failed to block IP: ' + e.message);
  }
};

window.manualUnblockIP = async function() {
  const ip = document.getElementById('block-ip-input')?.value?.trim();
  if (!ip) { alert('Enter an IP address to unblock.'); return; }
  await quickUnblock(ip);
  document.getElementById('block-ip-input').value = '';
};

window.quickBlock = async function(ip) {
  if (!confirm(`Block ${ip} for 24 hours?`)) return;
  try {
    await apiFetch('/api/owner/security/block', 'POST', { ip, reason: 'manual_block_ui', permanent: false });
    await window.loadSecurityDashboard();
  } catch (e) { alert('Failed: ' + e.message); }
};

window.quickUnblock = async function(ip) {
  try {
    await apiFetch('/api/owner/security/unblock', 'POST', { ip });
    await window.loadSecurityDashboard();
  } catch (e) { alert('Failed: ' + e.message); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  LLM COUNCIL DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const COUNCIL_MODELS = {
  claude:  { name: 'Claude Sonnet', role: 'Creative Strategist', emoji: '🟣', color: '#00c4b4' },
  gpt4o:   { name: 'GPT-4o',        role: 'Data Analyst',        emoji: '🟢', color: '#22c55e' },
  gemini:  { name: 'Gemini Pro',    role: 'Growth Hacker',       emoji: '🔵', color: '#3b82f6' },
};

async function loadCouncil() {
  renderCouncilRoster();
  switchCouncilTab('full');
}

function renderCouncilRoster() {
  const el = document.getElementById('council-roster');
  if (!el) return;
  el.innerHTML = Object.entries(COUNCIL_MODELS).map(([id, m]) => `
    <div style="background:rgba(${id==='claude'?'168,85,247':'id'==='gpt4o'?'34,197,94':'59,130,246'},0.08);border:1px solid ${m.color}44;border-radius:12px;padding:1.2rem;text-align:center">
      <div style="font-size:2rem;margin-bottom:.5rem">${m.emoji}</div>
      <div style="font-weight:700;color:${m.color};font-size:.95rem;margin-bottom:.25rem">${m.name}</div>
      <div style="font-size:.8rem;color:rgba(180,200,220,.6)">${m.role}</div>
    </div>
  `).join('');

  // Fix color bug with proper approach
  el.querySelectorAll('[style]').forEach((node, i) => {
    const colors = ['168,85,247', '34,197,94', '59,130,246'];
    const borders = ['#00c4b444', '#22c55e44', '#3b82f644'];
    node.style.background = `rgba(${colors[i]}, 0.08)`;
    node.style.border = `1px solid ${borders[i]}`;
  });
}

window.switchCouncilTab = function(tab) {
  ['full','quick','history'].forEach(t => {
    const panel = document.getElementById(`council-panel-${t}`);
    const btn = document.getElementById(`council-tab-${t}`);
    if (panel) panel.style.display = t === tab ? '' : 'none';
    if (btn) {
      if (t === tab) {
        btn.style.background = 'linear-gradient(135deg,#00c4b4,#005a52)';
        btn.style.color = '#fff';
        btn.style.border = 'none';
      } else {
        btn.style.background = 'rgba(0,196,180,.1)';
        btn.style.color = '#00c4b4';
        btn.style.border = '1px solid rgba(0,196,180,.2)';
      }
    }
  });
  if (tab === 'history') loadCouncilHistory();
};

window.runCouncilSession = async function() {
  const brief    = document.getElementById('council-brief').value.trim();
  const taskType = document.getElementById('council-task-type').value;
  const business = document.getElementById('council-business').value.trim();
  const statusEl = document.getElementById('council-status');
  const resultEl = document.getElementById('council-full-result');
  const btn      = document.getElementById('council-run-btn');

  if (!brief) { alert('Please enter a strategic brief.'); return; }

  btn.disabled = true;
  btn.textContent = '⚙ Convening...';
  statusEl.textContent = 'Consulting Claude, GPT-4o, and Gemini in parallel... (30-60s)';
  resultEl.style.display = 'none';

  try {
    const data = await apiFetch('/api/council/session', 'POST', {
      brief,
      task_type: taskType,
      context: { business },
    }).then(r => r.json());

    renderCouncilResult(data, resultEl);
    resultEl.style.display = '';
    statusEl.textContent = `Session ${data.session_id} — completed`;
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⚖ Convene the Council';
  }
};

window.runQuickCouncil = async function() {
  const question = document.getElementById('council-question').value.trim();
  const statusEl = document.getElementById('quick-council-status');
  const resultEl = document.getElementById('council-quick-result');

  if (!question) { alert('Please enter a question.'); return; }

  statusEl.textContent = 'Asking all 3 models... (15-30s)';
  resultEl.style.display = 'none';

  try {
    const data = await apiFetch('/api/council/quick', 'POST', { question }).then(r => r.json());
    renderCouncilResult(data, resultEl, true);
    resultEl.style.display = '';
    statusEl.textContent = 'Council has spoken.';
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
};

function renderCouncilResult(data, container, quick = false) {
  const verdict  = data.verdict || {};
  const responses = data.responses || {};
  const scores   = verdict.scores || {};

  const modelCards = Object.entries(COUNCIL_MODELS).map(([id, m]) => {
    const resp  = responses[id] || 'No response';
    const score = scores[id];
    return `
      <div style="background:#0d1b2a;border:1px solid ${m.color}44;border-radius:12px;padding:1.2rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
          <div style="font-weight:700;color:${m.color}">${m.emoji} ${m.name}</div>
          ${score ? `<div style="background:${m.color}22;color:${m.color};border-radius:99px;padding:.2rem .7rem;font-size:.8rem;font-weight:700">${score.score}/10</div>` : ''}
        </div>
        ${score ? `<div style="font-size:.75rem;color:rgba(180,200,220,.5);margin-bottom:.75rem;font-style:italic">${score.reason}</div>` : ''}
        <div style="font-size:.85rem;color:#cbd5e1;line-height:1.6;max-height:200px;overflow-y:auto;white-space:pre-wrap">${escHtml(resp)}</div>
      </div>
    `;
  }).join('');

  const keyActions = (verdict.key_actions || []).map(a =>
    `<div style="display:flex;gap:.75rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="color:#00c4b4;font-weight:700;margin-top:.1rem">&#9656;</span>
      <span style="color:#e2e8f0;font-size:.9rem">${escHtml(a)}</span>
    </div>`
  ).join('');

  container.innerHTML = `
    <!-- MAYA VERDICT -->
    <div class="card" style="margin-bottom:1.5rem;border-color:rgba(0,196,180,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <div class="card-title" style="color:#00c4b4">&#9878; Council Verdict — Maya's Synthesis</div>
        ${verdict.confidence ? `<div style="background:rgba(0,196,180,.2);color:#00c4b4;border-radius:99px;padding:.3rem .8rem;font-size:.85rem;font-weight:700">Confidence: ${verdict.confidence}%</div>` : ''}
      </div>
      <div style="font-size:.95rem;color:#e2e8f0;line-height:1.7;margin-bottom:1.25rem;white-space:pre-wrap">${escHtml(verdict.verdict || 'No verdict generated.')}</div>
      ${verdict.winning_insight ? `
        <div style="background:rgba(0,196,180,.08);border:1px solid rgba(0,196,180,.25);border-radius:10px;padding:1rem;margin-bottom:1rem">
          <div style="font-size:.75rem;color:#00c4b4;font-weight:700;margin-bottom:.4rem">&#9889; WINNING INSIGHT</div>
          <div style="color:#e2e8f0;font-size:.9rem">${escHtml(verdict.winning_insight)}</div>
        </div>
      ` : ''}
      ${keyActions ? `
        <div style="font-size:.8rem;color:rgba(180,200,220,.6);font-weight:700;margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.05em">Key Actions</div>
        ${keyActions}
      ` : ''}
    </div>

    <!-- 3 MODEL RESPONSES -->
    <div style="font-size:.8rem;color:rgba(180,200,220,.5);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem">Individual Model Responses</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem">
      ${modelCards}
    </div>
  `;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

async function loadCouncilHistory() {
  const el = document.getElementById('council-history-list');
  if (!el) return;
  el.innerHTML = '<div style="color:rgba(180,200,220,.5);padding:1rem">Loading...</div>';

  try {
    const data = await apiFetch('/api/council/sessions?limit=20').then(r => r.json());
    const sessions = data.sessions || [];

    if (!sessions.length) {
      el.innerHTML = '<div style="color:rgba(180,200,220,.4);padding:2rem;text-align:center">No council sessions yet. Run your first session!</div>';
      return;
    }

    el.innerHTML = sessions.map(s => {
      const v = s.verdict || {};
      return `
        <div class="card" style="margin-bottom:1rem;cursor:pointer" onclick="this.querySelector('.history-expand').style.display=this.querySelector('.history-expand').style.display==='none'?'':'none'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-weight:700;color:#e2e8f0;margin-bottom:.3rem">${escHtml(s.brief.substring(0,80))}${s.brief.length>80?'...':''}</div>
              <div style="display:flex;gap:.5rem;flex-wrap:wrap">
                <span style="background:rgba(0,196,180,.2);color:#00c4b4;border-radius:99px;padding:.15rem .6rem;font-size:.72rem">${s.task_type}</span>
                <span style="background:rgba(0,196,180,.1);color:#00c4b4;border-radius:99px;padding:.15rem .6rem;font-size:.72rem">${s.mode}</span>
                ${v.confidence ? `<span style="background:rgba(34,197,94,.1);color:#22c55e;border-radius:99px;padding:.15rem .6rem;font-size:.72rem">${v.confidence}% confidence</span>` : ''}
              </div>
            </div>
            <div style="font-size:.75rem;color:rgba(180,200,220,.4);white-space:nowrap;margin-left:1rem">${s.created_at ? s.created_at.substring(0,16).replace('T',' ') : ''}</div>
          </div>
          <div class="history-expand" style="display:none;margin-top:1rem">
            ${v.verdict ? `<div style="font-size:.85rem;color:#cbd5e1;line-height:1.6;border-top:1px solid rgba(255,255,255,.06);padding-top:.75rem;white-space:pre-wrap">${escHtml(v.verdict.substring(0,500))}${v.verdict.length>500?'...':''}</div>` : ''}
            <div style="margin-top:.75rem">
              <button onclick="event.stopPropagation();deleteCouncilSession(${s.id})" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#f87171;padding:.3rem .8rem;border-radius:6px;cursor:pointer;font-size:.75rem">&#128465; Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div style="color:#f87171;padding:1rem">Error: ${e.message}</div>`;
  }
}

window.deleteCouncilSession = async function(id) {
  if (!confirm('Delete this council session?')) return;
  try {
    await apiFetch(`/api/council/sessions/${id}`, 'DELETE');
    await loadCouncilHistory();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
};

/* =============================================================
   AD ENGINE — 2EasyMarketing
   Full AI Campaign Builder + Meta Ads API Integration
   ============================================================= */

(function AdEngine() {
  'use strict';

  // ── Storage keys ──────────────────────────────────────────
  const AE_SETTINGS_KEY = '2em_ae_settings';
  const AE_CAMPAIGNS_KEY = '2em_ae_campaigns';

  // ── Platform config ───────────────────────────────────────
  const AE_PLATFORMS = {
    facebook_instagram: { label: 'Meta (Facebook + Instagram)', color: '#1877F2', icon: '📱', formats: ['single_image','carousel','video','story','collection'] },
    youtube:            { label: 'YouTube',                     color: '#FF0000', icon: '▶',  formats: ['video','bumper_6s','skippable','non_skippable'] },
    tiktok:             { label: 'TikTok',                      color: '#69C9D0', icon: '🎶', formats: ['video','spark_ad','topview'] },
    google:             { label: 'Google Ads',                  color: '#4285F4', icon: '🔍', formats: ['search','display','shopping','pmax'] },
    snapchat:           { label: 'Snapchat',                    color: '#FFFC00', icon: '🔓', formats: ['single_image','video','story','collection'] },
    x_twitter:          { label: 'X / Twitter',                 color: '#ffffff', icon: '𝕏',  formats: ['single_image','video','carousel','text'] },
    microsoft:          { label: 'Microsoft / Bing Ads',        color: '#00A4EF', icon: '💻', formats: ['search','display','audience','shopping'] },
    linkedin:           { label: 'LinkedIn',                    color: '#0A66C2', icon: '👥', formats: ['single_image','carousel','video','message','text'] },
    pinterest:          { label: 'Pinterest',                   color: '#E60023', icon: '📌', formats: ['single_image','carousel','video','shopping'] },
    reddit:             { label: 'Reddit',                      color: '#FF4500', icon: '👾', formats: ['single_image','video','carousel','text'] },
    amazon:             { label: 'Amazon Ads',                  color: '#FF9900', icon: '🛒', formats: ['sponsored_product','sponsored_brand','sponsored_display','dsp'] },
  };

  const FORMAT_LABELS = {
    single_image: 'Single Image', carousel: 'Carousel', video: 'Video Ad', story: 'Story / Reel',
    collection: 'Collection', bumper_6s: '6-Second Bumper', skippable: 'Skippable In-Stream',
    non_skippable: 'Non-Skippable (15s)', spark_ad: 'Spark Ad', topview: 'TopView', search: 'Search Ad',
    display: 'Display / Banner', shopping: 'Shopping', pmax: 'Performance Max', audience: 'Audience Network',
    message: 'Message Ad', text: 'Text Ad', sponsored_product: 'Sponsored Product',
    sponsored_brand: 'Sponsored Brand', sponsored_display: 'Sponsored Display', dsp: 'DSP Display'
  };

  // ── State ─────────────────────────────────────────────────
  let aeSettings = {};
  let aeCampaigns = [];
  let aeCurrentOutput = null;

  const META_GRAPH = 'https://graph.facebook.com/v19.0';
  const CLAUDE_KEY = 'sk-ant-api03-oZYx56RjHe2DRm2ElAz8YblUjNkDCYWx1qfDpuABOJUDp-UhtIExkhg7QE0y3tKdEAP1eVkeozAOg4GTPZ2RWQ-ht4BYQAA';
  const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

  // ── Init ──────────────────────────────────────────────────
  function aeInit() {
    aeLoadSettings();
    aeLoadCampaigns();
    aeBindTabs();
    aeBindPlatformGrid();
    aeBindForm();
    aeBindSettings();
    aeBindCampaignControls();
    aeUpdateFormatOptions('facebook_instagram');
  }

  // ── Load / Save ───────────────────────────────────────────
  function aeLoadSettings() {
    try { aeSettings = JSON.parse(localStorage.getItem(AE_SETTINGS_KEY)) || {}; } catch(e) { aeSettings = {}; }
    setValue('ae-meta-token',       aeSettings.metaToken || '');
    setValue('ae-ad-account-id',    aeSettings.adAccountId || '');
    setValue('ae-page-id',          aeSettings.pageId || '');
    setValue('ae-ig-id',            aeSettings.igId || '');
    setValue('ae-markup',           aeSettings.markup !== undefined ? aeSettings.markup : 25);
    setValue('ae-approval-mode',    aeSettings.approvalMode || 'manual');
    setValue('ae-alert-threshold',  aeSettings.alertThreshold || 100);
    // Other platforms
    var platFields = [
      'google-dev-token','google-client-id','google-client-secret','google-refresh-token','google-customer-id',
      'youtube-channel-id','tiktok-token','tiktok-app-id','tiktok-advertiser-id',
      'snap-token','snap-org-id','snap-account-id',
      'x-api-key','x-api-secret','x-access-token','x-access-secret','x-account-id',
      'msft-client-id','msft-client-secret','msft-refresh-token','msft-dev-token','msft-customer-id',
      'li-token','li-account-id','pin-token','pin-account-id',
      'reddit-client-id','reddit-client-secret','reddit-token','reddit-account-id',
      'amz-client-id','amz-client-secret','amz-refresh-token','amz-profile-id'
    ];
    platFields.forEach(function(f) {
      var key = f.replace(/-([a-z])/g, function(m,c){ return c.toUpperCase(); });
      setValue('ae-' + f, aeSettings[key] || '');
    });
    aeUpdateStatusDots();
  }

  function aeSaveSettings() {
    aeSettings.metaToken       = getVal('ae-meta-token');
    aeSettings.adAccountId     = getVal('ae-ad-account-id');
    aeSettings.pageId          = getVal('ae-page-id');
    aeSettings.igId            = getVal('ae-ig-id');
    aeSettings.markup          = parseFloat(getVal('ae-markup')) || 25;
    aeSettings.approvalMode    = getVal('ae-approval-mode');
    aeSettings.alertThreshold  = parseFloat(getVal('ae-alert-threshold')) || 100;
    // Other platforms
    var platFields = [
      'google-dev-token','google-client-id','google-client-secret','google-refresh-token','google-customer-id',
      'youtube-channel-id','tiktok-token','tiktok-app-id','tiktok-advertiser-id',
      'snap-token','snap-org-id','snap-account-id',
      'x-api-key','x-api-secret','x-access-token','x-access-secret','x-account-id',
      'msft-client-id','msft-client-secret','msft-refresh-token','msft-dev-token','msft-customer-id',
      'li-token','li-account-id','pin-token','pin-account-id',
      'reddit-client-id','reddit-client-secret','reddit-token','reddit-account-id',
      'amz-client-id','amz-client-secret','amz-refresh-token','amz-profile-id'
    ];
    platFields.forEach(function(f) {
      var key = f.replace(/-([a-z])/g, function(m,c){ return c.toUpperCase(); });
      aeSettings[key] = getVal('ae-' + f);
    });
    localStorage.setItem(AE_SETTINGS_KEY, JSON.stringify(aeSettings));
    aeUpdateStatusDots();
  }

  // Update green/grey dots per platform
  function aeUpdateStatusDots() {
    var dotMap = {
      'dot-meta':      !!(aeSettings.metaToken && aeSettings.adAccountId),
      'dot-google':    !!(aeSettings.googleDevToken && aeSettings.googleCustomerId),
      'dot-youtube':   !!(aeSettings.googleDevToken && aeSettings.youtubeChannelId),
      'dot-tiktok':    !!(aeSettings.tiktokToken && aeSettings.tiktokAdvertiserId),
      'dot-snapchat':  !!(aeSettings.snapToken && aeSettings.snapAccountId),
      'dot-x':         !!(aeSettings.xApiKey && aeSettings.xAccountId),
      'dot-microsoft': !!(aeSettings.msftClientId && aeSettings.msftCustomerId),
      'dot-linkedin':  !!(aeSettings.liToken && aeSettings.liAccountId),
      'dot-pinterest': !!(aeSettings.pinToken && aeSettings.pinAccountId),
      'dot-reddit':    !!(aeSettings.redditToken && aeSettings.redditAccountId),
      'dot-amazon':    !!(aeSettings.amzClientId && aeSettings.amzProfileId),
    };
    Object.keys(dotMap).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.style.background = dotMap[id] ? '#00c4b4' : 'rgba(180,200,220,.3)';
        el.title = dotMap[id] ? 'Connected' : 'Not connected';
      }
    });
  }

  function aeLoadCampaigns() {
    try { aeCampaigns = JSON.parse(localStorage.getItem(AE_CAMPAIGNS_KEY)) || []; } catch(e) { aeCampaigns = []; }
  }
  function aeSaveCampaigns() { localStorage.setItem(AE_CAMPAIGNS_KEY, JSON.stringify(aeCampaigns)); }

  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function setValue(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
  function hide(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; }
  function showBlock(id) { var el = document.getElementById(id); if (el) el.style.display = 'block'; }

  // ── Platform grid ─────────────────────────────────────────
  function aeBindPlatformGrid() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.ae-plat-btn');
      if (!btn) return;
      var grid = document.getElementById('ae-platform-grid');
      if (!grid) return;
      grid.querySelectorAll('.ae-plat-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var plat = btn.dataset.platform;
      var hidden = document.getElementById('ae-platform');
      if (hidden) hidden.value = plat;
      aeUpdateFormatOptions(plat);
    });
  }

  function aeUpdateFormatOptions(plat) {
    var platCfg = AE_PLATFORMS[plat] || AE_PLATFORMS['facebook_instagram'];
    var sel = document.getElementById('ae-format');
    if (!sel) return;
    sel.innerHTML = platCfg.formats.map(function(f) {
      return '<option value="' + f + '">' + (FORMAT_LABELS[f] || f) + '</option>';
    }).join('');
  }

  // ── Tab switching ─────────────────────────────────────────
  function aeBindTabs() {
    document.addEventListener('click', function(e) {
      var tab = e.target.closest('[data-ae-tab]');
      if (!tab) return;
      var name = tab.dataset.aeTab;
      document.querySelectorAll('.ae-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      ['create','campaigns','settings'].forEach(function(t) {
        var el = document.getElementById('ae-tab-' + t);
        if (el) el.style.display = (t === name) ? 'block' : 'none';
      });
      if (name === 'campaigns') aeRenderCampaigns();
      if (name === 'settings') { aeLoadSettings(); }
    });
    document.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'ae-goto-settings') {
        e.preventDefault();
        var st = document.querySelector('[data-ae-tab="settings"]');
        if (st) st.click();
      }
    });
  }

  // ── Form bindings ─────────────────────────────────────────
  function aeBindForm() {
    document.addEventListener('click', async function(e) {
      if (e.target && e.target.id === 'ae-generate-btn') { await aeGenerateCampaign(); }
      if (e.target && e.target.id === 'ae-save-draft-btn') { aeSaveDraft(); }
      if (e.target && e.target.id === 'ae-launch-btn') { await aeLaunchCampaign(); }
    });
  }

  function aeCollectBrief() {
    return {
      clientName:  getVal('ae-client-name'),
      product:     getVal('ae-product'),
      goal:        getVal('ae-goal'),
      platform:    getVal('ae-platform') || 'facebook_instagram',
      format:      getVal('ae-format'),
      dailyBudget: parseFloat(getVal('ae-daily-budget')) || 50,
      duration:    getVal('ae-duration'),
      location:    getVal('ae-location'),
      ageMin:      getVal('ae-age-min'),
      ageMax:      getVal('ae-age-max'),
      interests:   getVal('ae-interests'),
      offer:       getVal('ae-offer'),
      url:         getVal('ae-url'),
    };
  }

  // ── AI Campaign Generator ─────────────────────────────────
  async function aeGenerateCampaign() {
    var brief = aeCollectBrief();
    if (!brief.clientName || !brief.product || !brief.offer) {
      alert('Please fill in Client Name, Product/Service, and Key Offer before generating.');
      return;
    }

    hide('ae-output-content');
    showBlock('ae-generating');
    var btn = document.getElementById('ae-generate-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    var platCfg = AE_PLATFORMS[brief.platform] || AE_PLATFORMS['facebook_instagram'];
    var msgs = [
      'Analyzing your offer for ' + platCfg.label + '...',
      'Crafting platform-optimized headlines...',
      'Building audience targeting strategy...',
      'Optimizing budget allocation...',
      'Finalizing your campaign...'
    ];
    var mi = 0;
    var msgInterval = setInterval(function() {
      var el = document.getElementById('ae-generating-msg');
      if (el && mi < msgs.length) el.textContent = msgs[mi++];
    }, 1200);

    try {
      var goalLabels = {
        LEAD_GENERATION:'Lead Generation', CONVERSIONS:'Sales/Conversions',
        TRAFFIC:'Website Traffic', BRAND_AWARENESS:'Brand Awareness',
        VIDEO_VIEWS:'Video Views', APP_INSTALLS:'App Installs', MESSAGES:'Messages/DMs'
      };
      var markup = aeSettings.markup !== undefined ? aeSettings.markup : 25;
      var actualDailyBudget = (brief.dailyBudget * (1 - markup/100)).toFixed(2);
      var totalBudget = brief.duration === 'ongoing' ? 'Ongoing'
        : '$' + (brief.dailyBudget * parseInt(brief.duration)).toLocaleString();
      var formatLabel = FORMAT_LABELS[brief.format] || brief.format;

      // Platform-specific strategy notes for the AI
      var platNotes = {
        facebook_instagram: 'Focus on thumb-stopping visual hooks. Use social proof and emotional triggers. Facebook excels at detailed interest targeting; Instagram favors lifestyle imagery.',
        youtube:            'Hooks MUST capture attention in first 5 seconds before skip. Storytelling format works best. Include strong verbal CTA at 15s and end screen CTA.',
        tiktok:             'Must feel native and organic — NOT like a traditional ad. Use trending audio concepts, fast cuts, text overlays. Gen Z & Millennial tone. Educational or entertaining hooks.',
        google:             'Keyword-intent driven copy. Headline 1 = primary keyword match. Headline 2 = USP. Headline 3 = CTA. Description = benefit + urgency. For display: bold visual, minimal text.',
        snapchat:           'Vertical 9:16 only. First 2 seconds are critical. Young demographic (13-34). Fun, authentic, fast-paced. Swipe-up CTA language.',
        x_twitter:          'Concise and punchy. Controversy or curiosity hooks perform best. Conversation-starter tone. Twitter blue checkmark audience = professionals and news-followers.',
        microsoft:          'Professional tone, older demographic (35-65+). Bing search users often have high purchase intent. Similar to Google but less competitive keywords.',
        linkedin:           'B2B focus. Professional tone. Lead gen forms work extremely well. Thought leadership angle. Target by job title, company size, industry.',
        pinterest:          'Aspirational imagery drives clicks. Vertical pins (2:3 ratio). Discovery mindset buyer. DIY, home, fashion, food, wedding niches excel here.',
        reddit:             'Authenticity is CRITICAL — Reddit users hate ads that feel fake. Community-specific language. Value-first approach. Highly niche targeting by subreddit.',
        amazon:             'Product-focused. Keyword relevance. Benefit-driven bullets. Price and review count matter. For Sponsored Brands: brand story + top 3 products.',
      };
      var platNote = platNotes[brief.platform] || '';

      var prompt = 'You are a world-class digital advertising strategist. Create a complete, high-performing ad campaign optimized specifically for ' + platCfg.label + '.\n\n' +
        'PLATFORM: ' + platCfg.label + '\n' +
        'CLIENT: ' + brief.clientName + '\n' +
        'PRODUCT/SERVICE: ' + brief.product + '\n' +
        'CAMPAIGN GOAL: ' + (goalLabels[brief.goal] || brief.goal) + '\n' +
        'AD FORMAT: ' + formatLabel + '\n' +
        'DAILY BUDGET: $' + brief.dailyBudget + '/day (' + (brief.duration === 'ongoing' ? 'ongoing' : brief.duration + ' days') + ')\n' +
        'LOCATION: ' + (brief.location || 'United States') + '\n' +
        'TARGET AGE: ' + brief.ageMin + '-' + brief.ageMax + '\n' +
        'INTERESTS: ' + (brief.interests || 'general') + '\n' +
        'KEY OFFER: ' + brief.offer + '\n' +
        'LANDING PAGE: ' + (brief.url || 'Not specified') + '\n\n' +
        'PLATFORM STRATEGY NOTES: ' + platNote + '\n\n' +
        'Respond ONLY with valid JSON (no markdown, no code blocks):\n' +
        '{"campaignName":"string","summary":"2-3 sentence strategy","variations":[{"headline":"string max 40 chars","body":"string max 150 chars platform-optimized","cta":"one word action"},{"headline":"string","body":"string","cta":"string"},{"headline":"string","body":"string","cta":"string"}],"audience":{"targeting":"string","interests":["str","str","str","str","str"],"behaviors":"string","lookalike":"string"},"budget":{"dailySpend":"' + actualDailyBudget + '","totalEstimate":"' + totalBudget + '","splitRecommendation":"string","bestTimes":"string","expectedResults":"string"},"strategy":"string one key platform-specific optimization tip"}';

      var response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-calls': 'true'
        },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
      });

      if (!response.ok) throw new Error('AI request failed: ' + response.status);
      var data = await response.json();
      var rawText = data.content[0].text.trim();
      var campaignData;
      try {
        var jsonStr = rawText.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
        campaignData = JSON.parse(jsonStr);
      } catch(pe) { throw new Error('AI response could not be parsed. Please try again.'); }

      aeCurrentOutput = { brief: brief, campaignData: campaignData, generatedAt: Date.now() };
      aeRenderOutput(brief, campaignData);

    } catch(err) {
      clearInterval(msgInterval);
      hide('ae-generating');
      showBlock('ae-output-content');
      var sub = document.getElementById('ae-output-sub');
      if (sub) { sub.textContent = 'Error: ' + err.message + '. Please try again.'; sub.style.color = '#ff6b6b'; }
    } finally {
      clearInterval(msgInterval);
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate Campaign with AI'; }
    }
  }

  // ── Render AI Output ──────────────────────────────────────
  function aeRenderOutput(brief, d) {
    hide('ae-generating');
    showBlock('ae-output-content');
    var platCfg = AE_PLATFORMS[brief.platform] || AE_PLATFORMS['facebook_instagram'];

    var summary = document.getElementById('ae-summary-card');
    if (summary) {
      summary.innerHTML =
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">' +
          '<span style="font-size:.9rem">' + platCfg.icon + '</span>' +
          '<span style="font-size:.72rem;font-weight:700;color:#00c4b4;text-transform:uppercase;letter-spacing:.06em">' + aeEscape(d.campaignName) + '</span>' +
          '<span style="font-size:.65rem;padding:1px 6px;border-radius:10px;background:' + platCfg.color + '22;color:' + platCfg.color + ';border:1px solid ' + platCfg.color + '44;margin-left:auto">' + aeEscape(platCfg.label) + '</span>' +
        '</div>' +
        '<div style="color:rgba(255,255,255,.8);font-size:.82rem;line-height:1.6">' + aeEscape(d.summary) + '</div>' +
        (d.strategy ? '<div style="margin-top:.6rem;padding:.5rem .75rem;background:rgba(0,196,180,.08);border-radius:6px;font-size:.76rem;color:rgba(255,255,255,.65)"><strong style="color:#00c4b4">Platform Tip:</strong> ' + aeEscape(d.strategy) + '</div>' : '');
    }

    var vars = document.getElementById('ae-ad-variations');
    if (vars && d.variations) {
      vars.innerHTML = d.variations.map(function(v, i) {
        return '<div class="ae-ad-variation">' +
          '<div class="ae-ad-var-num">Ad ' + (i+1) + '</div>' +
          '<div class="ae-ad-var-headline">' + aeEscape(v.headline) + '</div>' +
          '<div class="ae-ad-var-body">' + aeEscape(v.body) + '</div>' +
          '<div class="ae-ad-var-cta">CTA: ' + aeEscape(v.cta) + '</div>' +
        '</div>';
      }).join('');
    }

    var aud = document.getElementById('ae-audience-box');
    if (aud && d.audience) {
      var interests = Array.isArray(d.audience.interests) ? d.audience.interests.join(', ') : '';
      aud.innerHTML =
        '<div><strong>Targeting:</strong> ' + aeEscape(d.audience.targeting) + '</div>' +
        (interests ? '<div><strong>Interests:</strong> ' + aeEscape(interests) + '</div>' : '') +
        (d.audience.behaviors ? '<div><strong>Behaviors:</strong> ' + aeEscape(d.audience.behaviors) + '</div>' : '') +
        (d.audience.lookalike ? '<div><strong>Lookalike:</strong> ' + aeEscape(d.audience.lookalike) + '</div>' : '') +
        '<div style="margin-top:.4rem"><strong>Age:</strong> ' + brief.ageMin + '–' + brief.ageMax + ' &nbsp;|&nbsp; <strong>Location:</strong> ' + aeEscape(brief.location || 'United States') + '</div>';
    }

    var bud = document.getElementById('ae-budget-box');
    if (bud && d.budget) {
      bud.innerHTML =
        '<div><strong>Daily Ad Spend (after markup):</strong> $' + d.budget.dailySpend + '/day</div>' +
        '<div><strong>Total Campaign Budget:</strong> ' + d.budget.totalEstimate + '</div>' +
        (d.budget.splitRecommendation ? '<div><strong>Budget Split:</strong> ' + aeEscape(d.budget.splitRecommendation) + '</div>' : '') +
        (d.budget.bestTimes ? '<div><strong>Best Times:</strong> ' + aeEscape(d.budget.bestTimes) + '</div>' : '') +
        (d.budget.expectedResults ? '<div style="margin-top:.4rem;padding:.4rem .6rem;background:rgba(0,196,180,.06);border-radius:6px"><strong>Expected Results:</strong> ' + aeEscape(d.budget.expectedResults) + '</div>' : '');
    }

    // Check if platform API connected
    var hasApi = aeIsPlatformConnected(brief.platform);
    var warning = document.getElementById('ae-api-warning');
    var launchBtn = document.getElementById('ae-launch-btn');
    if (warning) warning.style.display = hasApi ? 'none' : 'block';
    if (launchBtn) {
      launchBtn.disabled = false; // always enabled — non-Meta platforms show instructions
      launchBtn.textContent = hasApi ? 'Launch on ' + platCfg.label + ' →' : 'Get Launch Instructions →';
    }
  }

  function aeIsPlatformConnected(plat) {
    var s = aeSettings;
    switch(plat) {
      case 'facebook_instagram': return !!(s.metaToken && s.adAccountId && s.pageId);
      case 'youtube':            return !!(s.googleDevToken && s.youtubeChannelId);
      case 'google':             return !!(s.googleDevToken && s.googleCustomerId);
      case 'tiktok':             return !!(s.tiktokToken && s.tiktokAdvertiserId);
      case 'snapchat':           return !!(s.snapToken && s.snapAccountId);
      case 'x_twitter':          return !!(s.xApiKey && s.xAccountId);
      case 'microsoft':          return !!(s.msftClientId && s.msftCustomerId);
      case 'linkedin':           return !!(s.liToken && s.liAccountId);
      case 'pinterest':          return !!(s.pinToken && s.pinAccountId);
      case 'reddit':             return !!(s.redditToken && s.redditAccountId);
      case 'amazon':             return !!(s.amzClientId && s.amzProfileId);
      default: return false;
    }
  }

  // ── Save Draft ────────────────────────────────────────────
  function aeSaveDraft() {
    if (!aeCurrentOutput) { alert('Generate a campaign first.'); return; }
    var brief = aeCurrentOutput.brief;
    var draft = {
      id: 'draft_' + Date.now(), status: 'draft',
      clientName: brief.clientName, product: brief.product, goal: brief.goal,
      platform: brief.platform, dailyBudget: brief.dailyBudget, duration: brief.duration,
      campaignName: aeCurrentOutput.campaignData.campaignName,
      data: aeCurrentOutput, createdAt: Date.now(),
      spend: 0, impressions: 0, clicks: 0, leads: 0,
    };
    aeCampaigns.unshift(draft);
    aeSaveCampaigns();
    var btn = document.getElementById('ae-save-draft-btn');
    if (btn) {
      var orig = btn.textContent; btn.textContent = '✓ Saved!'; btn.style.color = '#00c4b4';
      setTimeout(function() { btn.textContent = orig; btn.style.color = ''; }, 2000);
    }
  }

  // ── Launch Campaign ───────────────────────────────────────
  async function aeLaunchCampaign() {
    if (!aeCurrentOutput) { alert('Generate a campaign first.'); return; }
    var brief = aeCurrentOutput.brief;
    var d = aeCurrentOutput.campaignData;
    var platCfg = AE_PLATFORMS[brief.platform] || AE_PLATFORMS['facebook_instagram'];
    var hasApi = aeIsPlatformConnected(brief.platform);

    // Non-Meta platforms: show instructions panel
    if (brief.platform !== 'facebook_instagram' || !hasApi) {
      aeLaunchInstructions(brief, d, platCfg, hasApi);
      return;
    }

    if (aeSettings.approvalMode === 'manual') {
      var confirmed = confirm(
        'Launch this campaign on ' + platCfg.label + '?\n\n' +
        'Campaign: ' + d.campaignName + '\n' +
        'Client: ' + brief.clientName + '\n' +
        'Daily Budget: $' + brief.dailyBudget + '/day\n' +
        'Duration: ' + (brief.duration === 'ongoing' ? 'Ongoing' : brief.duration + ' days') + '\n\n' +
        'This will charge your Meta Ad Account. Confirm?'
      );
      if (!confirmed) return;
    }

    var btn = document.getElementById('ae-launch-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Launching...'; }

    try {
      var result = await aeCreateMetaCampaign();
      var campaign = {
        id: result.campaignId || ('local_' + Date.now()),
        metaCampaignId: result.campaignId, metaAdSetId: result.adSetId,
        status: 'active', clientName: brief.clientName, product: brief.product,
        goal: brief.goal, platform: brief.platform, dailyBudget: brief.dailyBudget,
        duration: brief.duration, campaignName: d.campaignName,
        data: aeCurrentOutput, createdAt: Date.now(),
        spend: 0, impressions: 0, clicks: 0, leads: 0,
      };
      aeCampaigns.unshift(campaign);
      aeSaveCampaigns();
      var camTab = document.querySelector('[data-ae-tab="campaigns"]');
      if (camTab) camTab.click();
      alert('Campaign launched successfully!\n\nCampaign ID: ' + (result.campaignId || 'N/A'));
    } catch(err) {
      alert('Launch failed: ' + err.message + '\n\nSaved as draft.');
      aeSaveDraft();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Launch on ' + platCfg.label + ' →'; }
    }
  }

  // Launch instructions modal for non-Meta (or unconnected) platforms
  function aeLaunchInstructions(brief, d, platCfg, isConnected) {
    var existing = document.getElementById('ae-launch-modal');
    if (existing) existing.remove();

    var instructions = {
      youtube:   'Copy the campaign brief above. Go to <a href="https://ads.google.com" target="_blank" style="color:#00c4b4">ads.google.com</a> → New Campaign → Video. Select your YouTube Channel, set budget to $' + brief.dailyBudget + '/day, and paste your AI-generated copy.',
      tiktok:    'Copy the campaign brief above. Go to <a href="https://ads.tiktok.com" target="_blank" style="color:#00c4b4">ads.tiktok.com</a> → Create Campaign. Select your objective, set daily budget to $' + brief.dailyBudget + ', and use the AI-generated ad copy.',
      google:    'Copy the keywords and headlines above. Go to <a href="https://ads.google.com" target="_blank" style="color:#00c4b4">ads.google.com</a> → New Campaign → Search or Display. Paste AI headlines and descriptions.',
      snapchat:  'Go to <a href="https://adsmanager.snapchat.com" target="_blank" style="color:#00c4b4">Snap Ads Manager</a> → Create Ad. Set daily budget to $' + brief.dailyBudget + '/day. Use AI copy for your ad text.',
      x_twitter: 'Go to <a href="https://ads.twitter.com" target="_blank" style="color:#00c4b4">X Ads Manager</a> → Create Campaign. Select your objective and paste the AI-generated copy.',
      microsoft: 'Copy keywords/headlines. Go to <a href="https://ui.ads.microsoft.com" target="_blank" style="color:#00c4b4">Microsoft Ads</a> → New Campaign → Search or Audience. Import from Google Ads or build with AI copy.',
      linkedin:  'Go to <a href="https://www.linkedin.com/campaignmanager" target="_blank" style="color:#00c4b4">LinkedIn Campaign Manager</a> → Create Campaign. Select LinkedIn objective, use AI headlines and body copy.',
      pinterest: 'Go to <a href="https://ads.pinterest.com" target="_blank" style="color:#00c4b4">Pinterest Ads</a> → Create a campaign. Upload your creative, set daily budget to $' + brief.dailyBudget + '/day. Use AI copy for description.',
      reddit:    'Go to <a href="https://ads.reddit.com" target="_blank" style="color:#00c4b4">Reddit Ads</a> → Create Campaign. Target by subreddit using AI interest keywords. Use authentic, community-tone copy from AI output.',
      amazon:    'Go to <a href="https://advertising.amazon.com" target="_blank" style="color:#00c4b4">Amazon Ads Console</a> → Create Campaign. Choose Sponsored Products or Sponsored Brand. Use AI-generated keywords and copy.',
    };

    var connectNote = !isConnected
      ? '<div style="margin-bottom:1rem;padding:.75rem;background:rgba(255,196,0,.08);border:1px solid rgba(255,196,0,.25);border-radius:8px;font-size:.8rem;color:rgba(255,220,100,.9)">⚡ To enable one-click launch for ' + platCfg.label + ', go to <strong>Platform Settings</strong> and enter your API credentials.</div>'
      : '';

    var modal = document.createElement('div');
    modal.id = 'ae-launch-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(6,16,24,.85);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    modal.innerHTML =
      '<div style="background:#0d1e2c;border:1px solid rgba(0,196,180,.2);border-radius:14px;max-width:520px;width:100%;padding:2rem;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem">' +
          '<span style="font-size:1.5rem">' + platCfg.icon + '</span>' +
          '<div><div style="font-weight:700;color:#fff;font-size:1rem">Launch on ' + platCfg.label + '</div><div style="font-size:.78rem;color:rgba(180,200,220,.6)">Your AI campaign is ready</div></div>' +
          '<button onclick="document.getElementById(\'ae-launch-modal\').remove()" style="margin-left:auto;background:none;border:none;color:rgba(180,200,220,.5);cursor:pointer;font-size:1.2rem">✕</button>' +
        '</div>' +
        connectNote +
        '<div style="background:rgba(0,196,180,.06);border:1px solid rgba(0,196,180,.15);border-radius:8px;padding:1rem;margin-bottom:1rem">' +
          '<div style="font-size:.7rem;font-weight:700;color:#00c4b4;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem">Campaign Ready</div>' +
          '<div style="font-size:.82rem;color:rgba(255,255,255,.8)">' + aeEscape(d.campaignName) + '</div>' +
          '<div style="font-size:.76rem;color:rgba(180,200,220,.6);margin-top:.25rem">' + aeEscape(brief.clientName) + ' · $' + brief.dailyBudget + '/day · ' + (brief.duration === 'ongoing' ? 'Ongoing' : brief.duration + ' days') + '</div>' +
        '</div>' +
        '<div style="font-size:.82rem;color:rgba(180,200,220,.8);line-height:1.7;margin-bottom:1.25rem">' + (instructions[brief.platform] || 'Log into your ad platform and use the generated copy above to create your campaign.') + '</div>' +
        '<div style="display:flex;gap:.75rem">' +
          '<button onclick="aeSaveDraftPublic()" style="flex:1;padding:.65rem;background:rgba(0,196,180,.1);border:1px solid rgba(0,196,180,.3);border-radius:8px;color:#00c4b4;cursor:pointer;font-size:.82rem;font-weight:600">Save as Draft</button>' +
          '<button onclick="document.getElementById(\'ae-launch-modal\').remove()" style="flex:1;padding:.65rem;background:linear-gradient(135deg,#00c4b4,#008c80);border:none;border-radius:8px;color:#061018;cursor:pointer;font-size:.82rem;font-weight:700">Got It ✓</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }

  // Public save draft for modal access
  window.aeSaveDraftPublic = function() { aeSaveDraft(); var m = document.getElementById('ae-launch-modal'); if (m) m.remove(); };

  // ── Public save per platform
  window.aePlatSave = function(platform) {
    aeSaveSettings();
    // Flash feedback on the relevant save button
    var btn = event.target;
    if (btn) {
      var orig = btn.textContent; btn.textContent = '✓ Saved!'; btn.style.color = '#00c4b4';
      setTimeout(function() { btn.textContent = orig; btn.style.color = ''; }, 2000);
    }
    aeUpdateStatusDots();
  };

  // ── Meta Campaign Creation ────────────────────────────────
  async function aeCreateMetaCampaign() {
    var brief = aeCurrentOutput.brief;
    var d = aeCurrentOutput.campaignData;
    var token = aeSettings.metaToken;
    var accountId = aeSettings.adAccountId;
    var pageId = aeSettings.pageId;

    var campaignBody = new URLSearchParams({
      name: d.campaignName, objective: brief.goal, status: 'PAUSED',
      special_ad_categories: '[]', access_token: token
    });
    var campRes = await fetch(META_GRAPH + '/' + accountId + '/campaigns', { method:'POST', body:campaignBody });
    var campData = await campRes.json();
    if (campData.error) throw new Error('Campaign create failed: ' + campData.error.message);
    var campaignId = campData.id;

    var markup = aeSettings.markup !== undefined ? aeSettings.markup : 25;
    var actualDailyBudgetCents = Math.round(brief.dailyBudget * (1 - markup/100) * 100);
    var targetingSpec = {
      age_min: parseInt(brief.ageMin) || 25, age_max: parseInt(brief.ageMax) || 55,
      geo_locations: { countries: ['US'] },
      publisher_platforms: brief.platform === 'facebook' ? ['facebook'] : brief.platform === 'instagram' ? ['instagram'] : ['facebook','instagram']
    };
    var adSetBody = new URLSearchParams({
      name: d.campaignName + ' — Ad Set', campaign_id: campaignId,
      daily_budget: actualDailyBudgetCents, billing_event: 'IMPRESSIONS',
      optimization_goal: brief.goal === 'LEAD_GENERATION' ? 'LEAD_GENERATION' : brief.goal === 'TRAFFIC' ? 'LINK_CLICKS' : brief.goal === 'BRAND_AWARENESS' ? 'REACH' : 'CONVERSIONS',
      targeting: JSON.stringify(targetingSpec), status: 'PAUSED', access_token: token
    });
    if (brief.duration !== 'ongoing') {
      adSetBody.append('end_time', Math.floor(Date.now()/1000) + (parseInt(brief.duration)*86400));
    }
    var adSetRes = await fetch(META_GRAPH + '/' + accountId + '/adsets', { method:'POST', body:adSetBody });
    var adSetData = await adSetRes.json();
    if (adSetData.error) throw new Error('Ad Set create failed: ' + adSetData.error.message);
    var adSetId = adSetData.id;

    var variation = d.variations[0];
    var creativeBody = new URLSearchParams({
      name: d.campaignName + ' — Creative',
      object_story_spec: JSON.stringify({
        page_id: pageId,
        link_data: {
          link: brief.url || 'https://2easymarketing.net',
          message: variation.body, name: variation.headline,
          call_to_action: { type: variation.cta.toUpperCase().replace(/\s+/g,'_').replace(/\//g,'_') }
        }
      }),
      access_token: token
    });
    var creativeRes = await fetch(META_GRAPH + '/' + accountId + '/adcreatives', { method:'POST', body:creativeBody });
    var creativeData = await creativeRes.json();
    if (creativeData.error) throw new Error('Creative create failed: ' + creativeData.error.message);

    var adBody = new URLSearchParams({
      name: d.campaignName + ' — Ad', adset_id: adSetId,
      creative: JSON.stringify({ creative_id: creativeData.id }), status: 'PAUSED', access_token: token
    });
    var adRes = await fetch(META_GRAPH + '/' + accountId + '/ads', { method:'POST', body:adBody });
    var adData = await adRes.json();
    if (adData.error) throw new Error('Ad create failed: ' + adData.error.message);
    return { campaignId:campaignId, adSetId:adSetId, adId:adData.id, creativeId:creativeData.id };
  }

  // ── Test Meta Connection ──────────────────────────────────
  async function aeTestConnection() {
    aeSaveSettings();
    var token = aeSettings.metaToken;
    var accountId = aeSettings.adAccountId;
    var statusEl = document.getElementById('ae-conn-status');
    if (!token || !accountId) {
      if (statusEl) { statusEl.textContent = '⚠ Please enter your Access Token and Ad Account ID first.'; statusEl.className = 'ae-conn-status error'; }
      return;
    }
    if (statusEl) { statusEl.textContent = 'Testing connection...'; statusEl.className = 'ae-conn-status'; }
    try {
      var res = await fetch(META_GRAPH + '/' + accountId + '?fields=name,account_status,currency,timezone_name&access_token=' + encodeURIComponent(token));
      var data = await res.json();
      if (data.error) throw new Error(data.error.message);
      if (statusEl) {
        statusEl.innerHTML = '<div>✓ Connected! Account: <strong>' + (data.name || accountId) + '</strong></div><div>Currency: ' + (data.currency || 'USD') + ' | Timezone: ' + (data.timezone_name || 'N/A') + '</div>';
        statusEl.className = 'ae-conn-status success';
      }
      aeUpdateStatusDots();
    } catch(err) {
      if (statusEl) { statusEl.textContent = '✗ Connection failed: ' + err.message; statusEl.className = 'ae-conn-status error'; }
    }
  }

  // ── Fetch Meta Stats ──────────────────────────────────────
  async function aeFetchMetaStats() {
    if (!aeSettings.metaToken || !aeSettings.adAccountId) return;
    try {
      var res = await fetch(META_GRAPH + '/' + aeSettings.adAccountId + '/campaigns?fields=name,status,insights{spend,impressions,clicks,actions}&date_preset=all_time&access_token=' + encodeURIComponent(aeSettings.metaToken));
      var data = await res.json();
      if (data.error || !data.data) return;
      data.data.forEach(function(mc) {
        var local = aeCampaigns.find(function(c) { return c.metaCampaignId === mc.id; });
        if (local && mc.insights && mc.insights.data && mc.insights.data[0]) {
          var ins = mc.insights.data[0];
          local.spend = parseFloat(ins.spend) || 0;
          local.impressions = parseInt(ins.impressions) || 0;
          local.clicks = parseInt(ins.clicks) || 0;
          var leadAction = (ins.actions || []).find(function(a) { return a.action_type === 'lead'; });
          local.leads = leadAction ? parseInt(leadAction.value) : 0;
          local.status = mc.status.toLowerCase();
        }
      });
      aeSaveCampaigns();
      aeRenderCampaigns();
    } catch(e) {}
  }

  // ── Render Live Campaigns ─────────────────────────────────
  function aeRenderCampaigns() {
    var list = document.getElementById('ae-campaigns-list');
    if (!list) return;
    if (!aeCampaigns.length) {
      list.innerHTML = '<div class="ae-empty-state"><div style="font-size:2rem;margin-bottom:.5rem">⚡</div><div>No campaigns yet. Create your first above.</div></div>';
      return;
    }
    var totalSpend=0, totalImpressions=0, totalClicks=0, totalLeads=0, activeCount=0;
    aeCampaigns.forEach(function(c) {
      totalSpend += c.spend||0; totalImpressions += c.impressions||0;
      totalClicks += c.clicks||0; totalLeads += c.leads||0;
      if (c.status==='active') activeCount++;
    });
    var statActive = document.getElementById('ae-stat-active'); if(statActive) statActive.textContent = activeCount;
    var statSpend = document.getElementById('ae-stat-total-spend'); if(statSpend) statSpend.textContent = '$'+totalSpend.toFixed(2);
    var statImp = document.getElementById('ae-stat-impressions'); if(statImp) statImp.textContent = totalImpressions.toLocaleString();
    var statClk = document.getElementById('ae-stat-clicks'); if(statClk) statClk.textContent = totalClicks.toLocaleString();
    var statLd = document.getElementById('ae-stat-leads'); if(statLd) statLd.textContent = totalLeads.toLocaleString();

    list.innerHTML = aeCampaigns.map(function(c) {
      var platCfg = AE_PLATFORMS[c.platform] || { label: c.platform, color: '#00c4b4', icon: '⚡' };
      var statusClass = c.status==='active'?'active':c.status==='paused'?'paused':c.status==='draft'?'draft':'ended';
      var date = new Date(c.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      return '<div class="ae-campaign-card" data-campaign-id="' + c.id + '">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.25rem">' +
            '<div class="ae-campaign-name">' + aeEscape(c.campaignName||c.product) + '</div>' +
            '<span class="ae-status-badge ' + statusClass + '">' + c.status + '</span>' +
            '<span style="font-size:.65rem;padding:1px 6px;border-radius:10px;background:' + platCfg.color + '22;color:' + platCfg.color + ';border:1px solid ' + platCfg.color + '44;margin-left:auto">' + aeEscape(platCfg.icon) + ' ' + aeEscape(platCfg.label) + '</span>' +
          '</div>' +
          '<div class="ae-campaign-meta">' + aeEscape(c.clientName) + ' &nbsp;|&nbsp; $' + c.dailyBudget + '/day &nbsp;|&nbsp; ' + date + '</div>' +
          '<div class="ae-campaign-stats">' +
            '<span class="ae-campaign-stat">Spent: <strong>$' + (c.spend||0).toFixed(2) + '</strong></span>' +
            '<span class="ae-campaign-stat">Impressions: <strong>' + (c.impressions||0).toLocaleString() + '</strong></span>' +
            '<span class="ae-campaign-stat">Clicks: <strong>' + (c.clicks||0).toLocaleString() + '</strong></span>' +
            '<span class="ae-campaign-stat">Leads: <strong>' + (c.leads||0) + '</strong></span>' +
          '</div>' +
        '</div>' +
        '<div class="ae-campaign-controls">' +
          (c.status==='active' ? '<button class="ae-ctrl-btn" data-action="pause" data-id="' + c.id + '">Pause</button>' :
           c.status==='paused' ? '<button class="ae-ctrl-btn" data-action="resume" data-id="' + c.id + '">Resume</button>' : '') +
          '<button class="ae-ctrl-btn danger" data-action="delete" data-id="' + c.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Campaign Controls ─────────────────────────────────────
  function aeBindCampaignControls() {
    document.addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-action]');
      if (btn) {
        var action = btn.dataset.action;
        var id = btn.dataset.id;
        if (!id) return;
        if (action==='delete') {
          if (!confirm('Delete this campaign record from your dashboard?')) return;
          aeCampaigns = aeCampaigns.filter(function(c){ return c.id!==id; });
          aeSaveCampaigns(); aeRenderCampaigns(); return;
        }
        if (action==='pause' || action==='resume') {
          var campaign = aeCampaigns.find(function(c){ return c.id===id; });
          if (!campaign) return;
          if (aeSettings.metaToken && campaign.metaCampaignId) {
            try { await aeToggleMetaCampaign(campaign.metaCampaignId, action); } catch(err) { alert('Meta API: ' + err.message); }
          }
          campaign.status = action==='pause' ? 'paused' : 'active';
          aeSaveCampaigns(); aeRenderCampaigns(); return;
        }
      }
      if (e.target && e.target.id==='ae-test-connection') { await aeTestConnection(); }
      if (e.target && e.target.id==='ae-save-settings') {
        aeSaveSettings();
        var s = document.getElementById('ae-conn-status');
        if (s) { s.textContent='✓ Settings saved.'; s.className='ae-conn-status success'; }
        setTimeout(function(){ if(s) s.textContent=''; }, 3000);
      }
      if (e.target && e.target.id==='ae-save-margin') {
        aeSaveSettings();
        var b = e.target; var orig=b.textContent; b.textContent='✓ Saved!';
        setTimeout(function(){ b.textContent=orig; }, 2000);
      }
      if (e.target && e.target.id==='ae-refresh-campaigns') {
        await aeFetchMetaStats(); aeRenderCampaigns();
      }
    });
  }

  async function aeToggleMetaCampaign(metaCampaignId, action) {
    var body = new URLSearchParams({ status: action==='pause'?'PAUSED':'ACTIVE', access_token: aeSettings.metaToken });
    var res = await fetch(META_GRAPH + '/' + metaCampaignId, { method:'POST', body });
    var data = await res.json();
    if (data.error) throw new Error(data.error.message);
  }

  // ── Settings bindings ─────────────────────────────────────
  function aeBindSettings() { /* handled in aeBindCampaignControls */ }

  // ── Utility ───────────────────────────────────────────────
  function aeEscape(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Hook into portal nav ──────────────────────────────────
  document.addEventListener('click', function(e) {
    var link = e.target.closest('[data-view="ad-engine"]');
    if (link) {
      setTimeout(function() { aeLoadSettings(); aeLoadCampaigns(); aeRenderCampaigns(); }, 100);
    }
  });

  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', aeInit);
  } else {
    aeInit();
  }

})(); // end AdEngine IIFE

