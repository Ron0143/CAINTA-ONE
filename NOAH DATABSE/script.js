document.addEventListener('DOMContentLoaded', () => {
  // Shared company values populate any matching contact and footer placeholders.
  const companyDetails = {
    name: 'Cainta One Express',
    location: 'Cainta, Rizal',
    phone: '09566753142',
    email: 'rbaniqued70@gmail.com'
  };

  document.querySelectorAll('[data-location]').forEach((el) => {
    el.textContent = companyDetails.location;
  });

  document.querySelectorAll('[data-phone]').forEach((el) => {
    el.textContent = companyDetails.phone;
  });

  document.querySelectorAll('[data-email]').forEach((el) => {
    el.textContent = companyDetails.email;
    el.setAttribute('href', `mailto:${companyDetails.email}`);
  });

  const yearTarget = document.querySelector('[data-year]');
  if (yearTarget) {
    yearTarget.textContent = new Date().getFullYear();
  }

  const accountForm = document.getElementById('account-form');
  if (accountForm) {
    // Account-page elements and browser-local state used by sign-in and registration.
    const accountModes = document.querySelectorAll('[data-account-mode]');
    const nameField = document.getElementById('account-name-field');
    const nameInput = document.getElementById('account-name');
    const emailInput = document.getElementById('account-email');
    const phoneField = document.getElementById('account-phone-field');
    const phoneInput = document.getElementById('account-phone');
    const codeField = document.getElementById('account-code-field');
    const codeInput = document.getElementById('account-code');
    const sendCodeButton = document.getElementById('account-send-code');
    const verifyCodeButton = document.getElementById('account-verify-code');
    const passwordInput = document.getElementById('account-password');
    const accountMessage = document.getElementById('account-message');
    const accountPanel = document.getElementById('account-panel');
    const accountFormPanel = document.getElementById('account-form-panel');
    const accountNameDisplay = document.getElementById('account-name-display');
    const accountEmailDisplay = document.getElementById('account-email-display');
    const signOutButton = document.getElementById('account-sign-out');
    const accountKey = 'coe-demo-account-v1';
    const sessionKey = 'coe-demo-session-v1';
    let codeSentPhone = '';
    let verifiedPhone = '';
    let accountMode = new URLSearchParams(window.location.search).get('mode') === 'create'
      ? 'create'
      : 'signin';

    const setAccountMessage = (message, isError = false) => {
      accountMessage.textContent = message;
      accountMessage.classList.toggle('is-error', isError);
    };

    const renderAccountMode = () => {
      // Keep visible fields, required validation, button text, and accessibility state in sync.
      const creating = accountMode === 'create';
      nameField.hidden = !creating;
      nameInput.required = creating;
      phoneField.hidden = !creating;
      phoneInput.required = creating;
      codeField.hidden = !creating || !codeSentPhone || phoneInput.value.trim() !== codeSentPhone;
      codeInput.required = creating && !verifiedPhone;
      document.getElementById('account-submit').disabled = creating && verifiedPhone !== phoneInput.value.trim();
      passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
      document.getElementById('account-submit').textContent = creating ? 'Create Account' : 'Sign In';
      document.getElementById('account-heading').textContent = creating ? 'Create your account' : 'Welcome back';
      document.getElementById('account-intro').textContent = creating
        ? 'Use one account for your Cainta One Express requests.'
        : 'Sign in to your Cainta One Express account.';
      accountModes.forEach((button) => {
        const selected = button.dataset.accountMode === accountMode;
        button.setAttribute('aria-pressed', String(selected));
      });
      setAccountMessage('');
    };

    const derivePasswordHash = async (password, salt) => {
      // Derive a salted hash with Web Crypto; this is still only a local demo account store.
      if (!window.crypto?.subtle) {
        throw new Error('Account storage is unavailable in this browser. Open this page through a local web server.');
      }
      const key = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await window.crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
        key,
        256
      );
      return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
    };

    const showSignedInAccount = (account) => {
      accountNameDisplay.textContent = account.name;
      accountEmailDisplay.textContent = account.email;
      accountFormPanel.hidden = true;
      accountPanel.hidden = false;
    };

    accountModes.forEach((button) => {
      button.addEventListener('click', () => {
        accountMode = button.dataset.accountMode;
        codeSentPhone = '';
        verifiedPhone = '';
        phoneInput.value = '';
        codeInput.value = '';
        renderAccountMode();
      });
    });

    phoneInput.addEventListener('input', () => {
      const currentPhone = phoneInput.value.trim();
      if (currentPhone !== verifiedPhone) {
        verifiedPhone = '';
      }
      if (currentPhone !== codeSentPhone) {
        codeSentPhone = '';
        codeInput.value = '';
      }
      codeField.hidden = !codeSentPhone;
      document.getElementById('account-submit').disabled = accountMode === 'create' && !verifiedPhone;
    });

    // Request an SMS code from the local server and bind it to the current phone number.
    sendCodeButton.addEventListener('click', async () => {
      if (!phoneInput.reportValidity()) return;
      const phone = phoneInput.value.trim();
      sendCodeButton.disabled = true;
      setAccountMessage('Sending your SMS code...');
      try {
        const response = await fetch('/api/otp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not send a verification code.');
        if (phoneInput.value.trim() !== phone) {
          throw new Error('The phone number changed. Send a new code to that number.');
        }
        codeSentPhone = phone;
        verifiedPhone = '';
        codeInput.value = '';
        codeField.hidden = false;
        codeInput.required = true;
        document.getElementById('account-submit').disabled = true;
        codeInput.focus();
        setAccountMessage(result.message || 'Verification code sent by SMS.');
      } catch (error) {
        setAccountMessage(error.message || 'Could not send a verification code.', true);
      } finally {
        sendCodeButton.disabled = false;
      }
    });

    // Verify the entered code before enabling account creation.
    verifyCodeButton.addEventListener('click', async () => {
      if (!codeSentPhone || phoneInput.value.trim() !== codeSentPhone) {
        setAccountMessage('Send a code to your current phone number first.', true);
        return;
      }
      const code = codeInput.value.trim();
      if (!codeInput.reportValidity()) return;
      verifyCodeButton.disabled = true;
      setAccountMessage('Verifying your phone...');
      try {
        const response = await fetch('/api/otp/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: codeSentPhone, code })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'That code could not be verified.');
        verifiedPhone = result.phone;
        codeInput.required = false;
        document.getElementById('account-submit').disabled = false;
        setAccountMessage('Phone number verified. You can create your account.');
      } catch (error) {
        verifiedPhone = '';
        document.getElementById('account-submit').disabled = true;
        setAccountMessage(error.message || 'That code could not be verified.', true);
      } finally {
        verifyCodeButton.disabled = false;
      }
    });

    // Create or check the browser-stored account, then establish a local session.
    accountForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = document.getElementById('account-submit');
      submitButton.disabled = true;
      setAccountMessage(accountMode === 'create' ? 'Creating your account...' : 'Signing you in...');

      try {
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        let savedAccount = JSON.parse(localStorage.getItem(accountKey) || 'null');
        let account;

        if (accountMode === 'create') {
          if (!verifiedPhone || verifiedPhone !== phoneInput.value.trim()) {
            throw new Error('Verify your phone number before creating an account.');
          }
          if (savedAccount?.email === email) {
            throw new Error('An account with this email already exists on this browser.');
          }
          const salt = window.crypto.getRandomValues(new Uint8Array(16));
          const saltValue = Array.from(salt, (byte) => byte.toString(16).padStart(2, '0')).join('');
          const passwordHash = await derivePasswordHash(password, salt);
          account = {
            name: nameInput.value.trim(),
            email,
            phone: verifiedPhone,
            salt: saltValue,
            passwordHash
          };
          localStorage.setItem(accountKey, JSON.stringify(account));
        } else {
          if (!savedAccount || savedAccount.email !== email) {
            throw new Error('No matching account was found on this browser. Create an account first.');
          }
          const salt = Uint8Array.from(savedAccount.salt.match(/.{2}/g), (byte) => parseInt(byte, 16));
          const passwordHash = await derivePasswordHash(password, salt);
          if (passwordHash !== savedAccount.passwordHash) {
            throw new Error('That password does not match this account.');
          }
          account = savedAccount;
        }

        localStorage.setItem(sessionKey, JSON.stringify({ name: account.name, email: account.email }));
        showSignedInAccount(account);
        setAccountMessage('You are signed in on this browser.');
      } catch (error) {
        setAccountMessage(error.message || 'We could not complete that request.', true);
      } finally {
        submitButton.disabled = false;
      }
    });

    signOutButton.addEventListener('click', () => {
      localStorage.removeItem(sessionKey);
      accountPanel.hidden = true;
      accountFormPanel.hidden = false;
      accountForm.reset();
      codeSentPhone = '';
      verifiedPhone = '';
      accountMode = 'signin';
      renderAccountMode();
    });

    // Restore an existing local session when the account page is reopened.
    try {
      const currentSession = JSON.parse(localStorage.getItem(sessionKey) || 'null');
      if (currentSession?.email) {
        showSignedInAccount(currentSession);
      }
    } catch {
      localStorage.removeItem(sessionKey);
    }
    renderAccountMode();
  }

  // Highlight the home-page navigation item matching the section in view.
  const navLinks = document.querySelectorAll('.nav-menu a');
  const sections = [...document.querySelectorAll('main section[id]')];

  // Mark the navigation link for the section crossing the header's reading line.
  const updateActiveNav = () => {
    let currentSection = 'home';

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= 150 && rect.bottom >= 150) {
        currentSection = section.id;
      }
    });

    navLinks.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${currentSection}`;
      link.classList.toggle('active', isActive);
    });
  };

  updateActiveNav();
  window.addEventListener('scroll', updateActiveNav, { passive: true });

  // Intercept in-page links for smooth scrolling while preserving normal external links.
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;

      const target = document.querySelector(targetId);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Scroll quote requests to the contact section and fill shared status text.
  const quoteButtons = document.querySelectorAll('[data-quote]');
  quoteButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const contactSection = document.getElementById('contact');
      if (contactSection) {
        contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  const statusText = document.querySelector('[data-status]');
  if (statusText) {
    statusText.textContent = 'Serving Cainta, Rizal';
  }

  const sellModal = document.getElementById('sell-modal');
  const sellTitle = document.getElementById('sell-modal-title');
  const sellSubtitle = document.getElementById('sell-modal-subtitle');
  const sellServiceField = document.getElementById('sell-service');
  const sellForm = document.getElementById('sell-form');
  const sellSuccess = document.getElementById('sell-success');
  const itemSearch = document.getElementById('item-search');
  const itemName = document.getElementById('item-name');

  // Modal helpers update the selected service and its matching request copy.
  const openSellModal = (serviceName) => {
    if (!sellModal) return;
    sellTitle.textContent = `Buy from ${serviceName}`;
    sellServiceField.value = serviceName;
    sellSubtitle.textContent = serviceName === 'Food Express'
      ? 'Request food items, essentials, and fresh goods for quick local pickup.'
      : 'Request apparel, accessories, and retail items for easy delivery.';
    sellSuccess.hidden = true;
    sellModal.classList.add('open');
    sellModal.setAttribute('aria-hidden', 'false');
  };

  const closeSellModal = () => {
    if (!sellModal) return;
    sellModal.classList.remove('open');
    sellModal.setAttribute('aria-hidden', 'true');
  };

  // Route service-card choices to the order page with the service in the URL.
  document.querySelectorAll('.sell-trigger').forEach((button) => {
    button.addEventListener('click', () => {
      const serviceName = button.dataset.service;
      if (serviceName === 'Online Bazaar') {
        window.location.href = 'online-bazaar.html';
        return;
      }
      window.location.href = `food-express.html?service=${encodeURIComponent(serviceName)}`;
    });
  });

  // Close the request dialog from its close controls, backdrop, or Escape key.
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeSellModal);
  });

  sellModal?.addEventListener('click', (event) => {
    if (event.target === sellModal) closeSellModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sellModal?.classList.contains('open')) {
      closeSellModal();
    }
  });

  // Keep the requested item field synchronized with the modal's search input.
  itemSearch?.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    if (itemName && value) {
      itemName.value = value;
    }
  });

  // Show a local confirmation for the legacy seller-request dialog.
  sellForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    sellSuccess.hidden = false;
    sellForm.reset();
    sellServiceField.value = sellTitle.textContent.replace('Buy from ', '');
  });

  /* ============================================================
     LIVE BACKGROUND + SCROLL EFFECTS
     ============================================================ */
  // Respect the visitor's system setting when animating the background and content.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- 1. Mark elements for scroll reveal + parallax -------------------
  const revealTargets = [
    '.hero .eyebrow', '.hero h1', '.hero p', '.hero-actions', '.hero-metrics',
    '.section-head', '.service-card', '.feature-panel', '.stat-card',
    '.process-step', '.cta'
  ];

  revealTargets.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add('reveal');
      el.style.setProperty('--delay', `${(i % 4) * 0.1}s`);
    });
  });

  // element -> parallax speed (positive = drifts slower than page, negative = faster)
  const parallaxMap = [
    ['.hero-grid > div:first-child', 0.10],
    ['.hero-visual', -0.08],
    ['.section-head', 0.06],
    ['.feature-panel', 0.05],
    ['.stats-box', -0.05],
    ['.service-card:nth-child(2)', 0.05],
    ['.process-step:nth-child(even)', 0.05],
    ['.cta', 0.04]
  ];

  const parallaxEls = [];
  parallaxMap.forEach(([sel, speed]) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.dataset.parallax = speed;
      parallaxEls.push({ el, speed, base: 0 });
    });
  });

  const measure = () => {
    parallaxEls.forEach((p) => {
      p.el.style.translate = 'none';
      const r = p.el.getBoundingClientRect();
      p.base = r.top + window.scrollY + r.height / 2; // page-Y of element centre
    });
  };

  // ---- 2. Reveal on scroll ---------------------------------------------
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }

  // ---- 3. Background layers: scroll + mouse parallax -------------------
  const layers = [...document.querySelectorAll('.bg-live .layer')];
  let mouseX = 0, mouseY = 0, smoothMX = 0, smoothMY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // ---- 4. One animation loop, eased towards the real scroll position ----
  let targetY = window.scrollY;
  let currentY = targetY;

  window.addEventListener('scroll', () => { targetY = window.scrollY; }, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  measure();

  const frame = () => {
    currentY += (targetY - currentY) * 0.09;   // floaty easing
    smoothMX += (mouseX - smoothMX) * 0.05;
    smoothMY += (mouseY - smoothMY) * 0.05;

    if (!reduceMotion) {
      layers.forEach((layer) => {
        const speed = parseFloat(layer.dataset.speed) || 0.1;
        const mouse = parseFloat(layer.dataset.mouse) || 0;
        layer.style.setProperty('--sy', (currentY * speed).toFixed(2));
        layer.style.setProperty('--mx', (smoothMX * mouse).toFixed(2));
        layer.style.setProperty('--my', (smoothMY * mouse).toFixed(2));
      });

      const viewMid = currentY + window.innerHeight / 2;
      parallaxEls.forEach((p) => {
        const offset = (p.base - viewMid) * p.speed;
        p.el.style.translate = `0 ${offset.toFixed(1)}px`;
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});