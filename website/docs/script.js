// Mobile Sidebar Toggle
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.querySelector('.mobile-menu-toggle');
  sidebar.classList.toggle('open');
  toggle.textContent = sidebar.classList.contains('open') ? '✕' : '☰';
}

// Close sidebar on link click (mobile)
document.querySelectorAll('.sidebar-nav a').forEach(link => {
  link.addEventListener('click', () => {
    if (window.innerWidth <= 1024) {
      document.getElementById('sidebar').classList.remove('open');
      document.querySelector('.mobile-menu-toggle').textContent = '☰';
    }
  });
});

// Copy Code Function with animation
function copyCode(btn) {
  const code = btn.parentElement.nextElementSibling.querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

// Highlight active section on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.sidebar-nav a');

function updateActiveSection() {
  let current = '';
  const scrollY = window.scrollY;

  sections.forEach(section => {
    const sectionTop = section.offsetTop - 120;
    const sectionHeight = section.offsetHeight;

    if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
      current = section.getAttribute('id');
    }
  });

  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === `#${current}`) {
      link.classList.add('active');
    }
  });
}

window.addEventListener('scroll', updateActiveSection);
updateActiveSection();

// Search functionality with highlighting
const searchInput = document.getElementById('search');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query === '') {
      navLinks.forEach(link => {
        link.style.display = 'block';
        link.style.opacity = '1';
      });
      document.querySelectorAll('.sidebar-section').forEach(section => {
        section.style.display = 'block';
      });
      return;
    }

    document.querySelectorAll('.sidebar-section').forEach(section => {
      const links = section.querySelectorAll('.sidebar-nav a');
      let hasVisible = false;

      links.forEach(link => {
        const text = link.textContent.toLowerCase();
        if (text.includes(query)) {
          link.style.display = 'block';
          link.style.opacity = '1';
          hasVisible = true;
        } else {
          link.style.display = 'none';
          link.style.opacity = '0';
        }
      });

      section.style.display = hasVisible ? 'block' : 'none';
    });
  });

  // Search keyboard shortcut (Cmd/Ctrl + K)
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      searchInput.blur();
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    }
  });
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      const offset = 100;
      const targetPosition = target.offsetTop - offset;
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });

      // Update URL without jumping
      history.pushState(null, null, this.getAttribute('href'));
    }
  });
});

// Back to top button
const backToTop = document.createElement('button');
backToTop.className = 'back-to-top';
backToTop.innerHTML = '↑';
backToTop.setAttribute('aria-label', 'Back to top');
document.body.appendChild(backToTop);

backToTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', () => {
  if (window.scrollY > 500) {
    backToTop.classList.add('visible');
  } else {
    backToTop.classList.remove('visible');
  }
});

// Add line numbers to code blocks (optional)
document.querySelectorAll('pre code').forEach(block => {
  const lines = block.innerHTML.split('\n');
  if (lines.length > 3 && !block.classList.contains('no-line-numbers')) {
    // Only add if more than 3 lines and not disabled
  }
});

// Intersection Observer for section animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Animate cards and callouts on scroll
document.querySelectorAll('.card, .callout, .code-block').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  sectionObserver.observe(el);
});

// Initialize - set first visible link as active if none
setTimeout(() => {
  if (!document.querySelector('.sidebar-nav a.active')) {
    const firstLink = document.querySelector('.sidebar-nav a');
    if (firstLink) firstLink.classList.add('active');
  }
}, 100);

// Table of contents highlight (if TOC exists)
const tocLinks = document.querySelectorAll('.toc-list a');
if (tocLinks.length > 0) {
  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
      if (window.scrollY >= section.offsetTop - 150) {
        current = section.getAttribute('id');
      }
    });

    tocLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });
}

// Print-friendly: expand all sections
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('.sidebar').forEach(el => {
    el.style.display = 'none';
  });
  document.querySelector('.main-content').style.marginLeft = '0';
});

window.addEventListener('afterprint', () => {
  document.querySelectorAll('.sidebar').forEach(el => {
    el.style.display = '';
  });
  document.querySelector('.main-content').style.marginLeft = '';
});
