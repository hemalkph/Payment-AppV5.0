/**
 * ICT Academy — Payment Info App
 * Accordion, scroll reveal, and copy-to-clipboard interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  initAccordions();
  initScrollReveal();
  initCopyButtons();
  initYearTabs();
  initYouTubePlayers();
  initLocationTabs();
});

/* ===================================================
   Location Tabs (Physical Timetable)
   =================================================== */
function initLocationTabs() {
  const tabs = document.querySelectorAll('.location-tab');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const location = tab.getAttribute('data-location');

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding panel
      document.querySelectorAll('.location-panel').forEach(panel => {
        panel.classList.remove('active');
      });

      const targetPanel = document.getElementById('panel-' + location);
      if (targetPanel) {
        targetPanel.classList.add('active');

        // Re-trigger reveal animation for cards
        targetPanel.querySelectorAll('.card').forEach(card => {
          card.classList.remove('visible');
          requestAnimationFrame(() => {
            card.classList.add('reveal', 'visible');
          });
        });

        // Smooth scroll to panel
        targetPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

/* ===================================================
   YouTube Player Overlay
   =================================================== */
function initYouTubePlayers() {
  const playerConfigs = [
    { wrapper: 'ytPlayerWrapper', thumbnail: 'ytThumbnail', iframe: 'ytIframeContainer', videoId: 'ASSriwLZ1oU' },
    { wrapper: 'ytPlayerWrapperEn', thumbnail: 'ytThumbnailEn', iframe: 'ytIframeContainerEn', videoId: 'ASSriwLZ1oU' }
  ];

  playerConfigs.forEach(config => {
    const thumbnail = document.getElementById(config.thumbnail);
    const iframeContainer = document.getElementById(config.iframe);

    if (!thumbnail || !iframeContainer) return;

    thumbnail.addEventListener('click', () => {
      thumbnail.style.display = 'none';
      iframeContainer.style.display = 'block';
      iframeContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${config.videoId}?autoplay=1&rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    });
  });
}

/* ===================================================
   Year Tabs (Timetable page)
   =================================================== */
function initYearTabs() {
  const tabs = document.querySelectorAll('.year-tab');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const year = tab.getAttribute('data-year');

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding panel
      document.querySelectorAll('.timetable-panel').forEach(panel => {
        panel.classList.remove('active');
      });

      const targetPanel = document.getElementById('panel-' + year);
      if (targetPanel) {
        targetPanel.classList.add('active');

        // Re-trigger reveal animation for the panel card
        const card = targetPanel.querySelector('.card');
        if (card) {
          card.classList.remove('visible');
          requestAnimationFrame(() => {
            card.classList.add('reveal', 'visible');
          });
        }

        // Smooth scroll to panel
        targetPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

/* ===================================================
   Accordion
   =================================================== */
function initAccordions() {
  const triggers = document.querySelectorAll('.accordion__trigger');

  triggers.forEach(trigger => {
    trigger.addEventListener('click', () => {
      const accordion = trigger.closest('.accordion');
      const panel = accordion.querySelector('.accordion__panel');
      const isActive = accordion.classList.contains('active');

      // Close all other accordions
      document.querySelectorAll('.accordion.active').forEach(openAcc => {
        if (openAcc !== accordion) {
          closeAccordion(openAcc);
        }
      });

      if (isActive) {
        closeAccordion(accordion);
      } else {
        openAccordion(accordion);
      }
    });
  });
}

function openAccordion(accordion) {
  const panel = accordion.querySelector('.accordion__panel');
  const trigger = accordion.querySelector('.accordion__trigger');
  const content = panel.querySelector('.accordion__content');

  accordion.classList.add('active');
  trigger.setAttribute('aria-expanded', 'true');

  // Animate open
  panel.style.maxHeight = content.scrollHeight + 'px';

  // After transition, allow natural height for dynamic content
  panel.addEventListener('transitionend', function handler() {
    if (accordion.classList.contains('active')) {
      panel.style.maxHeight = 'none';
    }
    panel.removeEventListener('transitionend', handler);
  });
}

function closeAccordion(accordion) {
  const panel = accordion.querySelector('.accordion__panel');
  const trigger = accordion.querySelector('.accordion__trigger');

  // Set explicit height before collapsing (for smooth transition)
  panel.style.maxHeight = panel.scrollHeight + 'px';

  // Force reflow
  panel.offsetHeight; // eslint-disable-line no-unused-expressions

  // Animate close
  requestAnimationFrame(() => {
    panel.style.maxHeight = '0';
  });

  accordion.classList.remove('active');
  trigger.setAttribute('aria-expanded', 'false');
}

/* ===================================================
   Scroll Reveal (Intersection Observer)
   =================================================== */
function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');

  if (!reveals.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  reveals.forEach(el => observer.observe(el));
}

/* ===================================================
   Copy to Clipboard
   =================================================== */
function initCopyButtons() {
  const copyBtns = document.querySelectorAll('.copy-btn');

  copyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');

      try {
        await navigator.clipboard.writeText(textToCopy);
        showCopyFeedback(btn, true);
      } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();

        try {
          document.execCommand('copy');
          showCopyFeedback(btn, true);
        } catch (e) {
          showCopyFeedback(btn, false);
        }

        document.body.removeChild(textArea);
      }
    });
  });
}

function showCopyFeedback(btn, success) {
  const originalHTML = btn.innerHTML;

  if (success) {
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Copied!
    `;
  } else {
    btn.innerHTML = 'Failed';
  }

  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = originalHTML;
  }, 2000);
}
