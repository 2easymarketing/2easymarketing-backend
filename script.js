/* ============================================
   DEVMARKETING — Interactive JavaScript
   ============================================ */

// === THEME TOGGLE ===
(function () {
  const html = document.documentElement;
  let theme = 'dark'; // default

  // Respect system preference if no stored preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    theme = 'light';
  }
  html.setAttribute('data-theme', theme);

  // Listen for system changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    theme = e.matches ? 'dark' : 'light';
    html.setAttribute('data-theme', theme);
  });
})();

// === STICKY HEADER scroll behavior ===
(function () {
  const header = document.getElementById('header');
  if (!header) return;

  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > lastY && y > 100) {
      header.style.transform = 'translateY(-100%)';
    } else {
      header.style.transform = 'translateY(0)';
    }
    lastY = y;
  }, { passive: true });
})();

// === MOBILE NAV ===
(function () {
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobileNav');
  const closeBtn = document.getElementById('mobileNavClose');
  const mobileLinks = document.querySelectorAll('.mobile-nav-link');

  function openNav() {
    mobileNav.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeNav() {
    mobileNav.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger && hamburger.addEventListener('click', openNav);
  closeBtn && closeBtn.addEventListener('click', closeNav);
  mobileLinks.forEach(link => link.addEventListener('click', closeNav));

  // Close on backdrop click
  mobileNav && mobileNav.addEventListener('click', (e) => {
    if (e.target === mobileNav) closeNav();
  });
})();

// === ACTIVE NAV LINK (scroll spy) ===
(function () {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
        });
      }
    });
  }, { rootMargin: '-40% 0px -50% 0px' });

  sections.forEach(s => observer.observe(s));
})();

// === SCROLL ANIMATIONS ===
(function () {
  const animateEls = document.querySelectorAll(
    '.service-card, .step-card, .cert-card, .pricing-card, .testimonial-card, .tool-category, .stat-item'
  );

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = entry.target.style.transform
          ? entry.target.style.transform.replace('translateY(24px)', 'translateY(0)')
          : 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  animateEls.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = `opacity 0.5s ease ${i * 0.05}s, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 0.05}s`;
    observer.observe(el);
  });
})();

// === COUNTER ANIMATION for stat numbers ===
(function () {
  const statNumbers = document.querySelectorAll('.stat-number');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const text = el.textContent;
        const match = text.match(/[\d.]+/);
        if (!match) return;

        const target = parseFloat(match[0]);
        const prefix = text.split(match[0])[0];
        const suffix = text.split(match[0])[1] || '';
        let start = 0;
        const duration = 1500;
        const startTime = performance.now();

        function update(currentTime) {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const value = start + (target - start) * eased;
          el.textContent = prefix + (target >= 100 ? Math.round(value) : value.toFixed(1)) + suffix;
          if (progress < 1) requestAnimationFrame(update);
        }

        requestAnimationFrame(update);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  statNumbers.forEach(el => observer.observe(el));
})();

// === CONTACT FORM ===
(function () {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;

    btn.textContent = 'Sending...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    setTimeout(() => {
      btn.textContent = '✓ Message Sent — We\'ll be in touch soon!';
      btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
      btn.style.opacity = '1';

      setTimeout(() => {
        form.reset();
        btn.textContent = original;
        btn.style.background = '';
        btn.disabled = false;
        btn.style.opacity = '1';
      }, 4000);
    }, 1200);
  });
})();

// === SMOOTH SCROLL for nav links ===
(function () {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
})();

// === NAV ACTIVE STYLE ===
const style = document.createElement('style');
style.textContent = `
  .nav-link.active {
    color: var(--color-accent) !important;
  }
`;
document.head.appendChild(style);
