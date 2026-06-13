/**
 * 2EasyMarketing — Client Portal (embedded overlay version)
 */
(function () {
  'use strict';

  const API = '__PORT_8000__';  // deployed as: port/8000
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
        html += `<div style="text-align:center;padding:2rem"><div style="font-size:2.5rem">👀</div><div style="color:#c084fc;font-weight:700;margin-top:.5rem">In Review with Dev</div><div style="color:rgba(180,200,220,.65);font-size:.85rem;margin-top:.4rem">Your deliverable is ready and being reviewed before delivery.</div></div>`;
      } else if (task.status === 'delivered' && task.ai_result) {
        const result = task.ai_result;
        if (result.startsWith('IMAGE_AD_READY:')) {
          const fname = result.split(':')[1].split('\n')[0].trim();
          html += `<div style="font-weight:700;color:#00d4ff;font-size:.85rem;margin-bottom:.75rem">🖼️ Your AI Image Ad:</div>
            <img src="/media/${fname}" style="width:100%;border-radius:10px;margin-bottom:.75rem;max-height:360px;object-fit:contain;background:rgba(0,0,0,.3)" />
            <a href="/media/${fname}" download="${fname}" class="copy-btn" style="text-decoration:none;display:inline-block">⬇ Download Image Ad</a>`;
        } else if (result.startsWith('VIDEO_AD_READY:')) {
          const fname = result.split(':')[1].split('\n')[0].trim();
          html += `<div style="font-weight:700;color:#a855f7;font-size:.85rem;margin-bottom:.75rem">🎬 Your AI Video Ad:</div>
            <video src="/media/${fname}" controls style="width:100%;border-radius:10px;margin-bottom:.75rem;max-height:360px;background:#000"></video>
            <a href="/media/${fname}" download="${fname}" class="copy-btn" style="text-decoration:none;display:inline-block">⬇ Download Video Ad</a>`;
        } else if (result.startsWith('VOICEOVER_READY:')) {
          const fname = result.split(':')[1].split('\n')[0].trim();
          html += `<div style="font-weight:700;color:#22c55e;font-size:.85rem;margin-bottom:.75rem">🎙️ Your AI Voiceover:</div>
            <audio src="/media/${fname}" controls style="width:100%;margin-bottom:.75rem"></audio>
            <a href="/media/${fname}" download="${fname}" class="copy-btn" style="text-decoration:none;display:inline-block">⬇ Download Audio</a>`;
        } else {
          html += `<div style="font-weight:700;color:#00d4ff;font-size:.85rem;margin-bottom:.5rem">Your Deliverable:</div>
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
            const sev = { warning:'#f59e0b', success:'#22c55e', info:'#00d4ff' }[a.severity] || '#a855f7';
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
    const statusColor = { pending_review:'#f59e0b', approved:'#22c55e', delivered:'#00d4ff', dismissed:'#6b7280' }[task.status] || '#a855f7';
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
      color: '#00d4ff',
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
      color: '#a855f7',
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
      const colorMap = { image_ad:'linear-gradient(135deg,#00d4ff,#0ea5e9)', video_ad:'linear-gradient(135deg,#a855f7,#7c3aed)', voiceover:'linear-gradient(135deg,#22c55e,#16a34a)' };
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
      errEl.style.color = '#00d4ff';
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
    const data = await apiFetch('/api/owner/system-health');
    const statusColor = data.db_ok !== false ? '#22d3ee' : '#f87171';
    const errColor = (data.errors_last_hour || 0) === 0 ? '#4ade80' : '#f59e0b';

    el.innerHTML = `
      <!-- KPI Row -->
      <div style="display:flex;gap:.75rem;flex-wrap:wrap">
        ${healthKpi('Platform Version', `v${data.platform_version}`, '#a855f7')}
        ${healthKpi('Python', data.python_version, '#00d4ff')}
        ${healthKpi('Memory (RSS)', `${data.memory_rss_mb} MB`, '#06b6d4')}
        ${healthKpi('DB Size', `${data.db_size_kb} KB`, '#22d3ee')}
        ${healthKpi('DB Clients', data.db_clients, '#4ade80')}
        ${healthKpi('DB Tasks', data.db_tasks, '#4ade80')}
        ${healthKpi('Errors (1h)', data.errors_last_hour || 0, errColor)}
        ${healthKpi('DB Status', data.db_ok ? 'OK' : 'ERROR', statusColor)}
      </div>

      <!-- Dependencies -->
      <div style="padding:1.25rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px">
        <h3 style="font-size:.9rem;font-weight:700;color:#00d4ff;margin:0 0 .75rem">&#128230; Critical Dependencies</h3>
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
        <h3 style="font-size:.9rem;font-weight:700;color:#a855f7;margin:0 0 .75rem">&#129504; Registered AI Models</h3>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          ${Object.entries(data.ai_models || {}).map(([role, model]) => `
            <div style="display:flex;justify-content:space-between;padding:.4rem .75rem;background:rgba(255,255,255,.03);border-radius:6px;font-size:.82rem">
              <span style="color:rgba(200,220,240,.65);text-transform:uppercase;letter-spacing:.04em">${role.replace(/_/g,' ')}</span>
              <span style="color:#00d4ff;font-weight:600">${model}</span>
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
  if (status) status.textContent = 'Running...';
  try {
    await apiFetch('/api/owner/run-maintenance', { method: 'POST' });
    if (status) status.textContent = 'Maintenance triggered! Check Update Log in ~30s.';
    setTimeout(() => { if (status) status.textContent = ''; }, 6000);
  } catch (e) {
    if (status) status.textContent = 'Error: ' + e.message;
  }
  if (btn) btn.disabled = false;
}

async function loadUpdateLog() {
  // Version badges
  try {
    const vd = await apiFetch('/api/version');
    const vb = document.getElementById('version-badges');
    if (vb) {
      vb.innerHTML = `
        ${vBadge('Version', `v${vd.version}`, '#a855f7')}
        ${vBadge('Codename', vd.codename, '#00d4ff')}
        ${vBadge('Build Date', vd.build_date, '#06b6d4')}
        ${vBadge('Domain', vd.domain, '#4ade80')}
      `;
    }

    // Changelog
    const cl = document.getElementById('changelog-list');
    if (cl && vd.changelog) {
      cl.innerHTML = vd.changelog.map((entry, i) => `
        <div style="padding:1rem 1.25rem;background:rgba(255,255,255,.03);border:1px solid ${i===0?'rgba(168,85,247,.3)':'rgba(255,255,255,.07)'};border-radius:10px">
          <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem">
            <span style="font-size:.85rem;font-weight:800;color:${i===0?'#a855f7':'#00d4ff'}">v${entry.version}</span>
            <span style="font-size:.75rem;color:rgba(200,220,240,.4)">${entry.date}</span>
            ${i===0?'<span style="font-size:.7rem;background:rgba(168,85,247,.2);color:#a855f7;padding:1px 8px;border-radius:9999px;font-weight:700">CURRENT</span>':''}
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
    const data = await apiFetch('/api/owner/update-log');
    if (!data.log || data.log.length === 0) {
      ll.innerHTML = '<p style="color:rgba(200,220,240,.4);font-size:.82rem">No log entries yet.</p>';
      return;
    }
    const typeColors = { boot: '#4ade80', maintenance: '#00d4ff', error: '#f87171', info: '#a855f7' };
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
    const d = await apiFetch('/api/owner/smtp-status');
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
            ? `Sending to <strong style="color:#fff">${d.notify_to}</strong> via <strong style="color:#00d4ff">${d.smtp_user}</strong>`
            : 'Set up Gmail SMTP to get instant alerts every time a lead submits the contact form, Maya captures a lead, or a client signs up.'}
        </p>
        ${!configured ? `
        <div style="background:rgba(0,0,0,.25);border-radius:8px;padding:.9rem 1rem;font-size:.8rem;color:rgba(200,220,240,.7);line-height:1.8">
          <strong style="color:#fbbf24">3-step setup:</strong><br>
          1. Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:#00d4ff">myaccount.google.com/apppasswords</a> → create App Password for "Mail"<br>
          2. Set environment variables on your server:<br>
          <code style="color:#a855f7;background:rgba(168,85,247,.1);padding:2px 6px;border-radius:4px;display:block;margin:.4rem 0">SMTP_USER=you@gmail.com<br>SMTP_PASS=xxxx-xxxx-xxxx-xxxx</code>
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
    const d = await apiFetch('/api/owner/test-notification', { method: 'POST' });
    if (result) result.textContent = d.sent ? '✅ Test email sent! Check your inbox.' : '❌ ' + d.message;
  } catch(e) {
    if (result) result.textContent = '❌ Error: ' + e.message;
  }
}
