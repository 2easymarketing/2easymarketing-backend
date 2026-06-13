/* ============================================
   2EASYMEDIA — Maya AI Chat Widget
   Floating chat assistant powered by Claude
   ============================================ */

(function () {
  'use strict';

  // ---- CONFIG ----
  const API_URL = '__PORT_8000__/api/chat';
  const WELCOME = "Hey! 👋 I'm **Maya**, 2EasyMedia's AI assistant. I have live competitor pricing data loaded — so if you're shopping around, I can show you exactly why we're the best deal in the market. What can I help you with?";
  const SUGGESTED = [
    "How do you compare to other agencies?",
    "What's your pricing?",
    "What services do you offer?",
    "Book a free strategy call",
  ];

  // ---- STATE ----
  let isOpen = false;
  let messages = []; // {role, content}
  let isTyping = false;

  // ---- BUILD WIDGET DOM ----
  const styles = document.createElement('style');
  styles.textContent = `
    /* === CHAT LAUNCHER BUTTON === */
    #em-launcher {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 9999;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(14,165,233,0.45), 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s ease;
      animation: em-pop-in 0.6s cubic-bezier(0.34,1.56,0.64,1) 1s both;
    }
    @keyframes em-pop-in {
      from { transform: scale(0); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }
    #em-launcher:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(14,165,233,0.6), 0 2px 10px rgba(0,0,0,0.35);
    }
    #em-launcher svg { transition: transform 0.3s ease; }
    #em-launcher.open svg.chat-icon { display: none; }
    #em-launcher.open svg.close-icon { display: block !important; }

    /* Notification dot */
    #em-notif {
      position: absolute;
      top: 2px; right: 2px;
      width: 16px; height: 16px;
      background: #ef4444;
      border: 2px solid #fff;
      border-radius: 50%;
      font-size: 9px;
      color: white;
      font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      animation: em-pulse-dot 2s infinite;
    }
    @keyframes em-pulse-dot {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
      50%      { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
    }

    /* === CHAT PANEL === */
    #em-panel {
      position: fixed;
      bottom: 100px;
      right: 28px;
      z-index: 9998;
      width: 380px;
      max-height: 580px;
      background: #0d1117;
      border: 1px solid #1e2d44;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(14,165,233,0.1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: scale(0.85) translateY(20px);
      transform-origin: bottom right;
      opacity: 0;
      pointer-events: none;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
    }
    #em-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    /* Panel header */
    #em-header {
      padding: 16px 20px;
      background: linear-gradient(135deg, rgba(14,165,233,0.15), rgba(99,102,241,0.15));
      border-bottom: 1px solid #1e2d44;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    #em-avatar {
      width: 40px; height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(14,165,233,0.2);
    }
    #em-header-info { flex: 1; }
    #em-header-name {
      font-family: 'Clash Display', sans-serif;
      font-size: 15px;
      font-weight: 700;
      color: #e8eef7;
      line-height: 1.2;
    }
    #em-header-status {
      font-size: 11px;
      color: #22c55e;
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 2px;
    }
    .em-status-dot {
      width: 6px; height: 6px;
      background: #22c55e;
      border-radius: 50%;
      animation: em-pulse-dot 2.5s infinite;
    }
    #em-close-btn {
      background: none;
      border: none;
      color: #7a8ba8;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      transition: color 0.2s, background 0.2s;
      line-height: 0;
    }
    #em-close-btn:hover { color: #e8eef7; background: rgba(255,255,255,0.08); }

    /* Messages area */
    #em-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    #em-messages::-webkit-scrollbar { width: 4px; }
    #em-messages::-webkit-scrollbar-track { background: transparent; }
    #em-messages::-webkit-scrollbar-thumb { background: #1e2d44; border-radius: 4px; }

    /* Message bubbles */
    .em-msg {
      display: flex;
      gap: 8px;
      max-width: 100%;
      animation: em-msg-in 0.3s cubic-bezier(0.16,1,0.3,1) both;
    }
    @keyframes em-msg-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .em-msg.user { flex-direction: row-reverse; }
    .em-msg-avatar {
      width: 28px; height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
      align-self: flex-end;
    }
    .em-msg.user .em-msg-avatar {
      background: linear-gradient(135deg, #6366f1, #a855f7);
    }
    .em-bubble {
      max-width: calc(100% - 44px);
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 13.5px;
      line-height: 1.55;
      color: #e8eef7;
    }
    .em-msg.assistant .em-bubble {
      background: #111827;
      border: 1px solid #1e2d44;
      border-bottom-left-radius: 4px;
    }
    .em-msg.user .em-bubble {
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      color: white;
      border-bottom-right-radius: 4px;
    }
    /* Bold in assistant messages */
    .em-bubble strong { color: #38bdf8; font-weight: 700; }

    /* Typing indicator */
    #em-typing {
      display: none;
    }
    #em-typing.visible { display: flex; }
    .em-typing-dots {
      display: flex;
      gap: 4px;
      padding: 12px 16px;
      background: #111827;
      border: 1px solid #1e2d44;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
    }
    .em-typing-dots span {
      width: 6px; height: 6px;
      background: #38bdf8;
      border-radius: 50%;
      animation: em-bounce 1.2s infinite ease-in-out;
    }
    .em-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .em-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes em-bounce {
      0%,60%,100% { transform: translateY(0); opacity: 0.5; }
      30%          { transform: translateY(-6px); opacity: 1; }
    }

    /* Suggested chips */
    #em-suggestions {
      padding: 0 16px 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      flex-shrink: 0;
    }
    .em-chip {
      padding: 5px 12px;
      background: rgba(14,165,233,0.1);
      border: 1px solid rgba(14,165,233,0.25);
      border-radius: 999px;
      font-size: 12px;
      color: #38bdf8;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s, transform 0.15s;
      white-space: nowrap;
    }
    .em-chip:hover {
      background: rgba(14,165,233,0.2);
      border-color: rgba(14,165,233,0.5);
      transform: translateY(-1px);
    }

    /* Input area */
    #em-input-area {
      padding: 12px 16px 16px;
      border-top: 1px solid #1e2d44;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
      background: #0d1117;
    }
    #em-input {
      flex: 1;
      background: #111827;
      border: 1.5px solid #1e2d44;
      border-radius: 12px;
      padding: 10px 14px;
      font-family: 'Satoshi', sans-serif;
      font-size: 13.5px;
      color: #e8eef7;
      resize: none;
      outline: none;
      max-height: 100px;
      min-height: 42px;
      transition: border-color 0.2s;
      line-height: 1.5;
    }
    #em-input::placeholder { color: #3d4f6b; }
    #em-input:focus { border-color: #0ea5e9; }
    #em-send {
      width: 42px; height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
      box-shadow: 0 2px 10px rgba(14,165,233,0.3);
    }
    #em-send:hover { transform: scale(1.05); box-shadow: 0 4px 16px rgba(14,165,233,0.45); }
    #em-send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    #em-send svg { color: white; }

    #em-powered {
      text-align: center;
      font-size: 10px;
      color: #3d4f6b;
      padding-bottom: 4px;
      letter-spacing: 0.04em;
    }
    #em-powered a { color: #4f6b8a; text-decoration: none; }

    /* Mobile responsive */
    @media (max-width: 480px) {
      #em-panel {
        width: calc(100vw - 24px);
        right: 12px;
        bottom: 88px;
        max-height: 65vh;
        border-radius: 16px;
      }
      #em-launcher { right: 16px; bottom: 16px; }
    }
  `;
  document.head.appendChild(styles);

  // ---- LAUNCHER BUTTON ----
  const launcher = document.createElement('button');
  launcher.id = 'em-launcher';
  launcher.setAttribute('aria-label', 'Chat with Maya, 2EasyMedia AI assistant');
  launcher.innerHTML = `
    <svg class="chat-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <svg class="close-icon" style="display:none" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
    <span id="em-notif" title="1 new message">1</span>
  `;
  document.body.appendChild(launcher);

  // ---- CHAT PANEL ----
  const panel = document.createElement('div');
  panel.id = 'em-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Maya');
  panel.innerHTML = `
    <div id="em-header">
      <div id="em-avatar">🤖</div>
      <div id="em-header-info">
        <div id="em-header-name">Maya — AI Assistant</div>
        <div id="em-header-status">
          <span class="em-status-dot"></span>
          Online now · 2EasyMedia
        </div>
      </div>
      <button id="em-close-btn" aria-label="Close chat">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <div id="em-messages" role="log" aria-live="polite" aria-label="Chat messages">
      <!-- messages injected here -->
    </div>

    <div id="em-typing" role="status" aria-label="Maya is typing">
      <div style="width:28px;flex-shrink:0"></div>
      <div class="em-typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>

    <div id="em-suggestions"></div>

    <div id="em-input-area">
      <textarea
        id="em-input"
        placeholder="Ask me anything about marketing…"
        rows="1"
        aria-label="Type your message"
        maxlength="500"
      ></textarea>
      <button id="em-send" aria-label="Send message" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>
        </svg>
      </button>
    </div>
    <div id="em-powered">Powered by AI · <a href="#contact">Talk to a human →</a></div>
  `;
  document.body.appendChild(panel);

  // ---- REFS ----
  const messagesEl = document.getElementById('em-messages');
  const typingEl   = document.getElementById('em-typing');
  const inputEl    = document.getElementById('em-input');
  const sendBtn    = document.getElementById('em-send');
  const suggestEl  = document.getElementById('em-suggestions');
  const notifDot   = document.getElementById('em-notif');

  // ---- HELPERS ----
  function parseMarkdown(text) {
    // Bold **text** → <strong>
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function addMessage(role, content) {
    const msg = document.createElement('div');
    msg.className = `em-msg ${role}`;
    const emoji = role === 'assistant' ? '🤖' : '👤';
    msg.innerHTML = `
      <div class="em-msg-avatar">${emoji}</div>
      <div class="em-bubble">${parseMarkdown(content)}</div>
    `;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function scrollToBottom() {
    setTimeout(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 50);
  }

  function showTyping(visible) {
    isTyping = visible;
    typingEl.classList.toggle('visible', visible);
    if (visible) scrollToBottom();
  }

  function showSuggestions(chips) {
    suggestEl.innerHTML = '';
    chips.forEach(text => {
      const chip = document.createElement('button');
      chip.className = 'em-chip';
      chip.textContent = text;
      chip.addEventListener('click', () => {
        suggestEl.innerHTML = '';
        sendMessage(text);
      });
      suggestEl.appendChild(chip);
    });
  }

  // ---- OPEN / CLOSE ----
  function openChat() {
    isOpen = true;
    panel.classList.add('open');
    launcher.classList.add('open');
    if (notifDot) notifDot.style.display = 'none';
    // Show welcome if first open
    if (messages.length === 0) {
      addMessage('assistant', WELCOME);
      messages.push({ role: 'assistant', content: WELCOME });
      setTimeout(() => showSuggestions(SUGGESTED), 400);
    }
    setTimeout(() => inputEl.focus(), 350);
  }

  function closeChat() {
    isOpen = false;
    panel.classList.remove('open');
    launcher.classList.remove('open');
  }

  launcher.addEventListener('click', () => isOpen ? closeChat() : openChat());
  document.getElementById('em-close-btn').addEventListener('click', closeChat);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  // ---- INPUT HANDLING ----
  inputEl.addEventListener('input', () => {
    // Auto-resize
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    // Toggle send button
    sendBtn.disabled = !inputEl.value.trim();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled && !isTyping) sendMessage(inputEl.value.trim());
    }
  });

  sendBtn.addEventListener('click', () => {
    if (!sendBtn.disabled && !isTyping) sendMessage(inputEl.value.trim());
  });

  // ---- SEND MESSAGE ----
  async function sendMessage(text) {
    if (!text || isTyping) return;

    // Clear input
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    suggestEl.innerHTML = '';

    // Add user message
    messages.push({ role: 'user', content: text });
    addMessage('user', text);

    // Show typing
    showTyping(true);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages.slice(-12) }), // last 12 msgs
      });

      const data = await res.json();
      const reply = data.reply || "Sorry, I hit a snag. Try asking again!";

      showTyping(false);
      messages.push({ role: 'assistant', content: reply });
      addMessage('assistant', reply);

      // Show contextual follow-up suggestions
      const lowerReply = reply.toLowerCase();
      const lowerUser = text.toLowerCase();
      if (lowerReply.includes('competitor') || lowerReply.includes('market') || lowerReply.includes('other agenc') || lowerUser.includes('compar') || lowerUser.includes('competitor') || lowerUser.includes('better than')) {
        showSuggestions(["What's your Starter plan?", "No setup fees — really?", "Book a free call"]);
      } else if (lowerReply.includes('price') || lowerReply.includes('cost') || lowerReply.includes('package') || lowerReply.includes('\$')) {
        showSuggestions(["How do you compare to others?", "Tell me about Growth plan", "Book a free call"]);
      } else if (lowerReply.includes('seo') || lowerReply.includes('search')) {
        showSuggestions(["How long does SEO take?", "What's included in SEO?", "Get a free audit"]);
      } else if (lowerReply.includes('social') || lowerReply.includes('instagram') || lowerReply.includes('tiktok')) {
        showSuggestions(["What platforms do you manage?", "How many posts per month?", "See pricing"]);
      } else if (lowerReply.includes('email')) {
        showSuggestions(["What email tools do you use?", "See full pricing", "Book a call"]);
      } else if (messages.length >= 4) {
        showSuggestions(["See pricing", "How do you compare to others?", "Book a free strategy call"]);
      }

    } catch (err) {
      showTyping(false);
      const errorMsg = "I'm having trouble connecting right now. Reach us directly at **dev@2easymedia.net** or try again!";
      messages.push({ role: 'assistant', content: errorMsg });
      addMessage('assistant', errorMsg);
    }
  }

  // Auto-open after 8 seconds if user hasn't opened yet
  setTimeout(() => {
    if (!isOpen && messages.length === 0) {
      if (notifDot) {
        notifDot.style.animation = 'em-pulse-dot 1s infinite';
      }
    }
  }, 8000);

  // ─── EXIT-INTENT: Recover abandoning visitors ─────────────────────────────
  let exitTriggered = false;
  document.addEventListener('mouseleave', (e) => {
    if (e.clientY <= 0 && !exitTriggered && !isOpen && messages.length === 0) {
      exitTriggered = true;
      // Show a compelling exit message in the chat
      setTimeout(() => {
        if (!isOpen) {
          toggleChat();
          const exitMsg = "Wait — before you go! 👋 Most agencies charge $2,000+ setup fees and lock you into 12-month contracts. We charge **zero setup fees** and never lock you in. Want me to show you exactly what we'd do for your business in the first 30 days?";
          messages.push({ role: 'assistant', content: exitMsg });
          addMessage('assistant', exitMsg);
        }
      }, 400);
    }
  });

  // ─── SCROLL DEPTH: Engage high-intent visitors ────────────────────────────
  let scrollEngaged = false;
  window.addEventListener('scroll', () => {
    const scrollPct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
    if (scrollPct > 60 && !scrollEngaged && !isOpen && messages.length === 0) {
      scrollEngaged = true;
      if (notifDot) {
        notifDot.style.display = 'block';
        notifDot.style.animation = 'em-pulse-dot 0.8s infinite';
      }
      // Show a proactive bubble after 1.5s
      setTimeout(() => {
        if (!isOpen) {
          // Just pulse the button — don't force open, let user decide
          const btn = document.getElementById('maya-chat-btn');
          if (btn) {
            btn.style.transform = 'scale(1.15)';
            btn.style.boxShadow = '0 0 30px rgba(0,212,255,0.6)';
            setTimeout(() => {
              btn.style.transform = '';
              btn.style.boxShadow = '';
            }, 2000);
          }
        }
      }, 1500);
    }
  }, { passive: true });

  // ─── PROACTIVE GREETING after 25s on pricing section ─────────────────────
  let pricingEngaged = false;
  const pricingObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !pricingEngaged && !isOpen) {
        pricingEngaged = true;
        setTimeout(() => {
          if (!isOpen && messages.length === 0) {
            if (notifDot) notifDot.style.display = 'block';
          }
        }, 5000);
      }
    });
  }, { threshold: 0.3 });
  const pricingSection = document.querySelector('#pricing, .pricing-section, [id*="pricing"]');
  if (pricingSection) pricingObserver.observe(pricingSection);

})();
