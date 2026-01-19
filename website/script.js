// Particle System
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;

  const colors = [
    'rgba(249, 115, 22, 0.6)',
    'rgba(168, 85, 247, 0.5)',
    'rgba(34, 197, 94, 0.5)',
    'rgba(59, 130, 246, 0.5)'
  ];

  for (let i = 0; i < 40; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';

    const size = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 20;
    const duration = Math.random() * 20 + 20;

    particle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: 50%;
      left: ${left}%;
      bottom: -10px;
      opacity: 0;
      pointer-events: none;
      animation: float-up ${duration}s ${delay}s infinite ease-out;
      box-shadow: 0 0 ${size * 2}px ${color};
    `;

    container.appendChild(particle);
  }
}

// Add keyframes for particle animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes float-up {
    0% {
      transform: translateY(0) translateX(0);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      transform: translateY(-100vh) translateX(${Math.random() > 0.5 ? '' : '-'}${Math.random() * 100}px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(styleSheet);

// Initialize particles
document.addEventListener('DOMContentLoaded', createParticles);

// Mobile Menu Toggle
const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
const mobileMenu = document.querySelector('.mobile-menu');

if (mobileMenuBtn && mobileMenu) {
  mobileMenuBtn.addEventListener('click', () => {
    mobileMenuBtn.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenuBtn.classList.remove('active');
      mobileMenu.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Fade In on Scroll with Intersection Observer
const fadeElements = document.querySelectorAll('.fade-in');

const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const parent = entry.target.parentElement;
      const siblings = Array.from(parent.querySelectorAll('.fade-in'));
      const index = siblings.indexOf(entry.target);
      const delay = index * 80;

      setTimeout(() => {
        entry.target.classList.add('visible');
      }, delay);

      fadeObserver.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
});

fadeElements.forEach(el => fadeObserver.observe(el));

// Parallax effect on scroll
let ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) {
    window.requestAnimationFrame(() => {
      const scrolled = window.pageYOffset;

      // Parallax for background gradient
      const bgGradient = document.querySelector('.bg-gradient');
      if (bgGradient) {
        bgGradient.style.transform = `translateY(${scrolled * 0.3}px)`;
      }

      // Parallax for grid
      const bgGrid = document.querySelector('.bg-grid');
      if (bgGrid) {
        bgGrid.style.transform = `translateY(${scrolled * 0.1}px)`;
      }

      ticking = false;
    });
    ticking = true;
  }
});

// Navbar background on scroll
const nav = document.querySelector('nav');
if (nav) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.style.background = 'rgba(5, 5, 5, 0.98)';
      nav.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
    } else {
      nav.style.background = 'rgba(5, 5, 5, 0.8)';
      nav.style.borderBottom = '1px solid transparent';
    }
  });
}

// Counter animation for stat cards
function animateCounter(el, target, suffix = '', prefix = '') {
  const duration = 2000;
  const startTime = performance.now();
  const startValue = 0;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function (ease-out cubic)
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(startValue + (target - startValue) * eased);

    el.textContent = prefix + current.toLocaleString() + suffix;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

const statNumbers = document.querySelectorAll('.stat-number');
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const text = el.textContent.trim();

      // Parse number formats like "1.9M", "280K", "<1ms", "104"
      let target, suffix = '', prefix = '';

      if (text.includes('M')) {
        target = parseFloat(text) * 10;
        suffix = 'M';
        el.textContent = '0M';
        animateCounter(el, 19, 'M', '');
        setTimeout(() => { el.textContent = '1.9M'; }, 2000);
      } else if (text.includes('K')) {
        target = parseInt(text) * 1000;
        suffix = 'K';
        animateCounter(el, parseInt(text), 'K');
      } else if (text.includes('ms')) {
        prefix = '<';
        suffix = 'ms';
        el.textContent = '<1ms';
      } else {
        target = parseInt(text);
        if (!isNaN(target)) {
          animateCounter(el, target);
        }
      }

      statsObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

statNumbers.forEach(stat => statsObserver.observe(stat));

// Terminal typing effect
const terminalCode = document.querySelector('.terminal-code code');
if (terminalCode && window.innerWidth > 768) {
  const originalHTML = terminalCode.innerHTML;
  terminalCode.innerHTML = '';
  let charIndex = 0;
  const speed = 8;

  function typeTerminal() {
    if (charIndex < originalHTML.length) {
      if (originalHTML[charIndex] === '<') {
        const closingIndex = originalHTML.indexOf('>', charIndex);
        terminalCode.innerHTML += originalHTML.substring(charIndex, closingIndex + 1);
        charIndex = closingIndex + 1;
      } else {
        terminalCode.innerHTML += originalHTML[charIndex];
        charIndex++;
      }
      setTimeout(typeTerminal, speed);
    }
  }

  const terminal = document.querySelector('.code-terminal');
  const terminalObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      setTimeout(typeTerminal, 300);
      terminalObserver.disconnect();
    }
  }, { threshold: 0.3 });

  if (terminal) {
    terminalObserver.observe(terminal);
  }
}

// Bento card hover effects (3D tilt)
const bentoCards = document.querySelectorAll('.bento-card');
bentoCards.forEach(card => {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = (y - centerY) / 20;
    const rotateY = (centerX - x) / 20;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale(1)';
  });
});

// Stat card hover glow effect
const statCards = document.querySelectorAll('.stat-card');
statCards.forEach(card => {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
  });
});

// Add mouse glow styles
const glowStyle = document.createElement('style');
glowStyle.textContent = `
  .stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: radial-gradient(
      400px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
      rgba(249, 115, 22, 0.1),
      transparent 40%
    );
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
    border-radius: inherit;
  }

  .stat-card:hover::before {
    opacity: 1;
  }
`;
document.head.appendChild(glowStyle);

// Scroll reveal for sections
const sections = document.querySelectorAll('section');
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('section-visible');
    }
  });
}, { threshold: 0.1 });

sections.forEach(section => sectionObserver.observe(section));

// Logo pulse effect on hover
const logo = document.querySelector('.logo');
if (logo) {
  logo.addEventListener('mouseenter', () => {
    logo.style.animation = 'pulse 0.5s ease-out';
  });
  logo.addEventListener('animationend', () => {
    logo.style.animation = '';
  });
}

// Add pulse animation
const pulseStyle = document.createElement('style');
pulseStyle.textContent = `
  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }

  section {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  section.section-visible {
    opacity: 1;
    transform: translateY(0);
  }

  .hero-section {
    opacity: 1;
    transform: none;
  }
`;
document.head.appendChild(pulseStyle);

// Copy code functionality
function copyCode(btn) {
  const codeBlock = btn.closest('.code-terminal').querySelector('code');
  if (codeBlock) {
    navigator.clipboard.writeText(codeBlock.textContent).then(() => {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.color = '#22c55e';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.color = '';
      }, 2000);
    });
  }
}

// Initialize everything on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Trigger initial animations
  document.body.classList.add('loaded');

  // Show hero immediately
  const hero = document.querySelector('.hero-section');
  if (hero) {
    hero.style.opacity = '1';
    hero.style.transform = 'none';
  }
});
