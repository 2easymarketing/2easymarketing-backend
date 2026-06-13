/**
 * 2EasyMedia — Premium Effects Engine
 * Particle canvas, cursor glow, typewriter, scroll reveal, counters, parallax
 */

(function () {
  'use strict';

  /* =============================================
     1. PARTICLE CANVAS
  ============================================= */
  function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [], animId;
    const mouse = { x: -9999, y: -9999 };

    const CONFIG = {
      count: 90,
      baseRadius: 1.5,
      speed: 0.35,
      connectDist: 130,
      mouseRepel: 100,
      colors: ['#00d4ff', '#a855f7', '#06b6d4', '#818cf8', '#ffffff']
    };

    function resize() {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    }

    function randomColor() {
      return CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
    }

    function createParticle() {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * CONFIG.speed * 2,
        vy: (Math.random() - 0.5) * CONFIG.speed * 2,
        radius: Math.random() * CONFIG.baseRadius + 0.5,
        color: randomColor(),
        alpha: Math.random() * 0.5 + 0.3,
        pulse: Math.random() * Math.PI * 2
      };
    }

    function initParticleArray() {
      particles = [];
      for (let i = 0; i < CONFIG.count; i++) particles.push(createParticle());
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Mouse repulsion
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONFIG.mouseRepel) {
          const force = (CONFIG.mouseRepel - dist) / CONFIG.mouseRepel;
          p.vx += (dx / dist) * force * 0.8;
          p.vy += (dy / dist) * force * 0.8;
        }

        // Speed clamp
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > CONFIG.speed * 3) {
          p.vx = (p.vx / speed) * CONFIG.speed * 3;
          p.vy = (p.vy / speed) * CONFIG.speed * 3;
        }

        // Friction
        p.vx *= 0.99;
        p.vy *= 0.99;

        p.x += p.vx;
        p.y += p.vy;
        p.pulse += 0.03;

        // Wrap
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;

        // Draw particle
        const pulseAlpha = p.alpha + Math.sin(p.pulse) * 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace(')', `, ${pulseAlpha})`).replace('rgb', 'rgba').replace('#', 'rgba(').replace(/rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2}),/, (m, r, g, b) =>
          `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},`
        );

        // Simpler color approach
        ctx.globalAlpha = pulseAlpha;
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Connect nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const ex = p.x - q.x;
          const ey = p.y - q.y;
          const ed = Math.sqrt(ex * ex + ey * ey);
          if (ed < CONFIG.connectDist) {
            const lineAlpha = (1 - ed / CONFIG.connectDist) * 0.25;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.globalAlpha = lineAlpha;
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 0.6;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => {
      resize();
      initParticleArray();
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });

    canvas.addEventListener('mouseleave', () => {
      mouse.x = -9999;
      mouse.y = -9999;
    });

    resize();
    initParticleArray();
    draw();
  }

  /* =============================================
     2. CURSOR GLOW
  ============================================= */
  function initCursorGlow() {
    const glow = document.getElementById('cursor-glow');
    if (!glow) return;

    let cx = -200, cy = -200;
    let tx = -200, ty = -200;
    let raf;

    document.addEventListener('mousemove', (e) => {
      tx = e.clientX;
      ty = e.clientY;
    });

    document.addEventListener('mouseleave', () => {
      tx = -500;
      ty = -500;
    });

    function animate() {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      glow.style.transform = `translate(${cx - 200}px, ${cy - 200}px)`;
      raf = requestAnimationFrame(animate);
    }
    animate();

    // Scale up on interactive elements
    document.querySelectorAll('a, button, .pricing-card, .service-card').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        glow.style.width = '480px';
        glow.style.height = '480px';
        glow.style.opacity = '0.55';
      });
      el.addEventListener('mouseleave', () => {
        glow.style.width = '400px';
        glow.style.height = '400px';
        glow.style.opacity = '0.35';
      });
    });
  }

  /* =============================================
     3. TYPEWRITER HERO TITLE
  ============================================= */
  function initTypewriter() {
    const titleEl = document.querySelector('.hero-title');
    if (!titleEl) return;

    // Extract plain text lines
    const lines = [
      { text: 'Dominate the', class: '' },
      { text: 'Digital Space.', class: 'gradient-text' }
    ];

    titleEl.innerHTML = '';
    titleEl.style.minHeight = '1.2em';

    let lineIdx = 0;
    let charIdx = 0;
    let isDeleting = false;

    // Build the structure
    const line1 = document.createElement('span');
    line1.className = 'tw-line1';
    const line2 = document.createElement('span');
    line2.className = 'tw-line2 gradient-text';
    const cursor = document.createElement('span');
    cursor.className = 'tw-cursor';
    cursor.textContent = '|';
    cursor.style.cssText = 'animation: cursorBlink 0.8s infinite; color: #00d4ff; font-weight: 300;';

    titleEl.appendChild(line1);
    titleEl.appendChild(document.createElement('br'));
    titleEl.appendChild(line2);
    titleEl.appendChild(cursor);

    // Add blink keyframe
    if (!document.getElementById('tw-style')) {
      const s = document.createElement('style');
      s.id = 'tw-style';
      s.textContent = `@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`;
      document.head.appendChild(s);
    }

    // Type line 1 then line 2
    function typeSequence() {
      const fullLine1 = 'Dominate the';
      const fullLine2 = 'Digital Space.';

      let i = 0, j = 0;
      const delay1 = 80;
      const delay2 = 80;
      const pauseBetween = 300;

      function typeLine1() {
        if (i <= fullLine1.length) {
          line1.textContent = fullLine1.slice(0, i++);
          setTimeout(typeLine1, delay1);
        } else {
          setTimeout(typeLine2, pauseBetween);
        }
      }

      function typeLine2() {
        if (j <= fullLine2.length) {
          line2.textContent = fullLine2.slice(0, j++);
          setTimeout(typeLine2, delay2);
        } else {
          // Done — hide cursor after 2s
          setTimeout(() => { cursor.style.opacity = '0'; }, 2000);
        }
      }

      typeLine1();
    }

    // Start after a brief delay
    setTimeout(typeSequence, 500);
  }

  /* =============================================
     4. SCROLL REVEAL (IntersectionObserver)
  ============================================= */
  function initScrollReveal() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-up').forEach((el) => {
      observer.observe(el);
    });
  }

  /* =============================================
     5. COUNTER ANIMATION
  ============================================= */
  function initCounters() {
    const counters = document.querySelectorAll('.stat-number[data-target]');
    if (!counters.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = parseFloat(el.dataset.target);
          const suffix = el.dataset.suffix || '';
          const prefix = el.dataset.prefix || '';
          const duration = 2000;
          const start = performance.now();
          const isDecimal = target % 1 !== 0;

          function update(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = target * eased;
            el.textContent = prefix + (isDecimal ? current.toFixed(1) : Math.round(current)) + suffix;
            if (progress < 1) requestAnimationFrame(update);
            else el.textContent = prefix + (isDecimal ? target.toFixed(1) : target) + suffix;
          }

          requestAnimationFrame(update);
          observer.unobserve(el);
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach((c) => observer.observe(c));
  }

  /* =============================================
     6. PARALLAX HERO
  ============================================= */
  function initParallax() {
    const heroBg = document.querySelector('.hero-bg-img');
    if (!heroBg) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          heroBg.style.transform = `translateY(${scrollY * 0.3}px) scale(1.05)`;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* =============================================
     7. HEADER SCROLL STATE
  ============================================= */
  function initHeader() {
    const header = document.querySelector('.header');
    if (!header) return;

    window.addEventListener('scroll', () => {
      if (window.scrollY > 60) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  /* =============================================
     8. SECTION ENTRANCE — stagger children
  ============================================= */
  function initSectionStagger() {
    // Service cards
    document.querySelectorAll('.services-grid .service-card').forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${i * 0.08}s`;
    });

    // Step cards
    document.querySelectorAll('.roadmap-grid .step-card').forEach((el, i) => {
      el.classList.add('reveal-up');
      el.style.transitionDelay = `${i * 0.06}s`;
    });

    // Pricing cards
    document.querySelectorAll('.pricing-grid .pricing-card').forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${i * 0.1}s`;
    });

    // Testimonial cards
    document.querySelectorAll('.testimonials-grid .testimonial-card').forEach((el, i) => {
      el.classList.add('reveal-up');
      el.style.transitionDelay = `${i * 0.1}s`;
    });

    // Cert cards
    document.querySelectorAll('.certs-grid .cert-card').forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${i * 0.07}s`;
    });

    // Section headers
    document.querySelectorAll('.section-header').forEach((el) => {
      el.classList.add('reveal');
    });
  }

  /* =============================================
     9. NEON BUTTON RIPPLE
  ============================================= */
  function initButtonRipple() {
    document.querySelectorAll('.btn-primary, .btn-secondary').forEach((btn) => {
      btn.addEventListener('click', function (e) {
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.style.cssText = `
          position:absolute; border-radius:50%;
          background:rgba(255,255,255,0.25);
          width:4px; height:4px;
          left:${e.clientX - rect.left - 2}px;
          top:${e.clientY - rect.top - 2}px;
          transform:scale(0);
          animation:rippleAnim 0.55s ease-out forwards;
          pointer-events:none;
        `;
        if (!document.getElementById('ripple-style')) {
          const s = document.createElement('style');
          s.id = 'ripple-style';
          s.textContent = `@keyframes rippleAnim{to{transform:scale(80);opacity:0}}`;
          document.head.appendChild(s);
        }
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  /* =============================================
     10. INIT ALL
  ============================================= */
  function init() {
    initSectionStagger();   // Must come before scrollReveal so classes are applied
    initScrollReveal();
    initParticles();
    initCursorGlow();
    initTypewriter();
    initCounters();
    initParallax();
    initHeader();
    initButtonRipple();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ─── ANIMATED COUNTER (result stats + any [data-count]) ──────────────────
(function() {
  function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-count'), 10);
    const suffix = el.getAttribute('data-suffix') || '';
    const duration = 1800;
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(ease * target);
      el.textContent = current.toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString() + suffix;
    }
    requestAnimationFrame(step);
  }

  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target._counted) {
        entry.target._counted = true;
        animateCounter(entry.target);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  counters.forEach(el => obs.observe(el));
})();
