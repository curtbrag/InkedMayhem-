// ============================================
// INKEDMAYHEM — Main Application JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initScrollEffects();
    initGalleryFilters();
    initLightbox();
    initAuthModal();
    initContactForm();
    initFAQ();
    initTestimonialsCarousel();
    initCountdown();
    initBackToTop();
    initNewsletterForm();
    initImageShimmer();
    initAnimatedStats();
    loadLatestDrops();
    initPaymentPicker();
});

// ==================== NAVIGATION ====================
function initNavigation() {
    const navbar = document.getElementById('navbar');
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');

    // Scroll effect
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile menu toggle
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        mobileMenu.classList.toggle('active');
        document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
    });

    // Close mobile menu on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            mobileMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });
}

// ==================== SCROLL EFFECTS ====================
function initScrollEffects() {
    // Fade in sections on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe sections
    document.querySelectorAll('.section-header, .gallery-item, .tier-card, .blog-card, .ppv-card, .testimonial-card, .faq-item, .countdown-card, .newsletter-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // Add visible class styles
    const style = document.createElement('style');
    style.textContent = '.visible { opacity: 1 !important; transform: translateY(0) !important; }';
    document.head.appendChild(style);

    // Stagger gallery items
    document.querySelectorAll('.gallery-item').forEach((item, i) => {
        item.style.transitionDelay = `${i * 0.08}s`;
    });

    document.querySelectorAll('.tier-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.15}s`;
    });
}

// ==================== GALLERY FILTERS ====================
function initGalleryFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    const galleryItems = document.querySelectorAll('.gallery-item');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filter = btn.dataset.filter;

            galleryItems.forEach((item, i) => {
                if (filter === 'all' || item.dataset.category === filter) {
                    item.style.display = '';
                    // Stagger the fade-in for a cleaner look
                    setTimeout(() => {
                        item.style.opacity = '1';
                        item.style.transform = 'scale(1)';
                    }, 30 + i * 30);
                } else {
                    item.style.opacity = '0';
                    item.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        item.style.display = 'none';
                    }, 250);
                }
            });
        });
    });
}

// ==================== LIGHTBOX (Upgraded) ====================
function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxClose = document.getElementById('lightboxClose');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxCounter = document.getElementById('lightboxCounter');
    if (!lightbox) return;

    const galleryImages = Array.from(document.querySelectorAll('.gallery-item img'));
    let currentIndex = 0;
    let touchStartX = 0;
    let touchEndX = 0;

    function openLightbox(index) {
        currentIndex = index;
        updateLightbox();
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    function updateLightbox() {
        const visibleImages = galleryImages.filter(img => img.closest('.gallery-item').style.display !== 'none');
        const idx = visibleImages.indexOf(galleryImages[currentIndex]);
        lightboxImg.src = galleryImages[currentIndex].src;
        lightboxCounter.textContent = `${idx + 1} / ${visibleImages.length}`;
    }

    function navigate(dir) {
        const visibleImages = galleryImages.filter(img => img.closest('.gallery-item').style.display !== 'none');
        const currentVisible = visibleImages.indexOf(galleryImages[currentIndex]);
        let nextVisible = currentVisible + dir;
        if (nextVisible < 0) nextVisible = visibleImages.length - 1;
        if (nextVisible >= visibleImages.length) nextVisible = 0;
        currentIndex = galleryImages.indexOf(visibleImages[nextVisible]);
        updateLightbox();
    }

    galleryImages.forEach((img, i) => {
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(i);
        });
    });

    lightboxClose.addEventListener('click', closeLightbox);
    lightboxPrev.addEventListener('click', (e) => { e.stopPropagation(); navigate(-1); });
    lightboxNext.addEventListener('click', (e) => { e.stopPropagation(); navigate(1); });

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigate(-1);
        if (e.key === 'ArrowRight') navigate(1);
    });

    // Touch/swipe support
    lightbox.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    lightbox.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) {
            navigate(diff > 0 ? 1 : -1);
        }
    }, { passive: true });
}

// ==================== AUTH MODAL ====================
let isSignUp = false;

function initAuthModal() {
    const modal = document.getElementById('authModal');
    const btnLogin = document.getElementById('btnLogin');
    const btnClose = document.getElementById('modalClose');
    const toggleAuth = document.getElementById('toggleAuth');
    const toggleText = document.getElementById('toggleText');
    const modalTitle = document.getElementById('modalTitle');
    const authSubmit = document.getElementById('authSubmit');
    const nameGroup = document.getElementById('nameGroup');
    const authForm = document.getElementById('authForm');

    function openModal() {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    btnLogin.addEventListener('click', openModal);
    btnClose.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    toggleAuth.addEventListener('click', (e) => {
        e.preventDefault();
        isSignUp = !isSignUp;

        if (isSignUp) {
            modalTitle.textContent = 'Create Account';
            authSubmit.textContent = 'Sign Up';
            toggleText.textContent = 'Already have an account?';
            toggleAuth.textContent = 'Sign In';
            nameGroup.style.display = 'block';
        } else {
            modalTitle.textContent = 'Sign In';
            authSubmit.textContent = 'Sign In';
            toggleText.textContent = "Don't have an account?";
            toggleAuth.textContent = 'Sign Up';
            nameGroup.style.display = 'none';
        }
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        const name = document.getElementById('authName').value;

        const endpoint = isSignUp ? '/api/auth-register' : '/api/auth-login';
        const body = isSignUp ? { email, password, name } : { email, password };

        try {
            authSubmit.textContent = 'Loading...';
            authSubmit.disabled = true;

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (data.success) {
                localStorage.setItem('im_token', data.token);
                localStorage.setItem('im_user', JSON.stringify(data.user));
                closeModal();
                updateAuthUI(data.user);
                // If user was trying to subscribe or unlock, continue that flow
                if (pendingSubscribeTier) {
                    const tier = pendingSubscribeTier;
                    pendingSubscribeTier = null;
                    showToast(isSignUp ? 'Account created! Choose your payment method.' : 'Welcome back! Choose your payment method.');
                    handleSubscribe(tier);
                } else if (pendingUnlockPostId) {
                    const postId = pendingUnlockPostId;
                    pendingUnlockPostId = null;
                    showToast(isSignUp ? 'Account created! Choose your payment method.' : 'Welcome back! Choose your payment method.');
                    handleUnlock(postId);
                } else {
                    showToast(isSignUp ? 'Welcome to InkedMayhem!' : 'Welcome back!');
                }
            } else {
                showToast(data.error || 'Something went wrong', 'error');
            }
        } catch (err) {
            showToast('Connection error — try again', 'error');
        } finally {
            authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
            authSubmit.disabled = false;
        }
    });

    // Check for existing session
    const savedUser = localStorage.getItem('im_user');
    if (savedUser) {
        try {
            updateAuthUI(JSON.parse(savedUser));
        } catch (e) {
            localStorage.removeItem('im_token');
            localStorage.removeItem('im_user');
        }
    }
}

function updateAuthUI(user) {
    const btnLogin = document.getElementById('btnLogin');
    if (user) {
        const tierLabels = { free: '', vip: ' [VIP]', elite: ' [ELITE]' };
        btnLogin.textContent = (user.name || 'Account') + (tierLabels[user.tier] || '');
        btnLogin.style.fontSize = '0.6rem';
        btnLogin.onclick = () => {
            if (confirm('Sign out?')) {
                localStorage.removeItem('im_token');
                localStorage.removeItem('im_user');
                btnLogin.textContent = 'Sign In';
                btnLogin.style.fontSize = '';
                btnLogin.onclick = () => document.getElementById('authModal').classList.add('active');
                showToast('Signed out');
            }
        };
    }
}

// ==================== SUBSCRIPTION / PAYMENT ====================
let activePromoCode = null;
let pendingSubscribeTier = null;
let pendingUnlockPostId = null;

// Payment picker state
let pendingPaymentType = null; // 'subscription' or 'single'
let pendingPaymentTier = null;
let pendingPaymentPostId = null;

const VENMO_HANDLE = 'Christina-Dipietro-6';
const TIER_PRICES = { vip: 9.99, elite: 24.99 };
const TIER_NAMES = { vip: 'Ink Insider (VIP)', elite: 'Mayhem Circle (Elite)' };
const DEFAULT_POST_PRICE = 4.99;

function initPaymentPicker() {
    const modal = document.getElementById('paymentPickerModal');
    if (!modal) return;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closePaymentPicker();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closePaymentPicker();
    });
}

function showPaymentPicker(type, tierOrPostId) {
    pendingPaymentType = type;
    const modal = document.getElementById('paymentPickerModal');
    const desc = document.getElementById('paymentPickerDesc');
    const title = document.getElementById('paymentPickerTitle');
    const venmoNote = document.getElementById('venmoNote');

    if (type === 'subscription') {
        pendingPaymentTier = tierOrPostId;
        pendingPaymentPostId = null;
        const price = TIER_PRICES[tierOrPostId];
        title.textContent = 'Choose Payment';
        desc.textContent = `${TIER_NAMES[tierOrPostId]} — $${price.toFixed(2)}/mo`;
    } else {
        pendingPaymentPostId = tierOrPostId;
        pendingPaymentTier = null;
        title.textContent = 'Choose Payment';
        desc.textContent = `Unlock content — $${DEFAULT_POST_PRICE.toFixed(2)}`;
    }

    venmoNote.style.display = 'none';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closePaymentPicker() {
    const modal = document.getElementById('paymentPickerModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    pendingPaymentType = null;
    pendingPaymentTier = null;
    pendingPaymentPostId = null;
}

function payWithStripe() {
    const type = pendingPaymentType;
    const tier = pendingPaymentTier;
    const postId = pendingPaymentPostId;
    closePaymentPicker();
    if (type === 'subscription' && tier) {
        proceedStripeSubscribe(tier);
    } else if (type === 'single' && postId) {
        proceedStripeUnlock(postId);
    }
}

function payWithVenmo() {
    const token = localStorage.getItem('im_token');
    const user = JSON.parse(localStorage.getItem('im_user') || '{}');
    const email = user.email || '';
    let amount, note, requestBody;

    if (pendingPaymentType === 'subscription' && pendingPaymentTier) {
        amount = TIER_PRICES[pendingPaymentTier];
        note = `InkedMayhem ${TIER_NAMES[pendingPaymentTier]} subscription - ${email}`;
        requestBody = { type: 'subscription', tier: pendingPaymentTier, amount };
    } else if (pendingPaymentType === 'single' && pendingPaymentPostId) {
        amount = DEFAULT_POST_PRICE;
        note = `InkedMayhem unlock ${pendingPaymentPostId} - ${email}`;
        requestBody = { type: 'single', postId: pendingPaymentPostId, amount };
    } else {
        return;
    }

    // Record the pending Venmo payment request
    if (token) {
        fetch('/api/venmo-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(requestBody)
        }).catch(() => {});
    }

    // Show the note about including email
    document.getElementById('venmoNote').style.display = 'block';

    const venmoUrl = `https://account.venmo.com/u/${VENMO_HANDLE}?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`;
    window.open(venmoUrl, '_blank');
}

async function applyPromoCode() {
    const input = document.getElementById('promoCodeInput');
    const result = document.getElementById('promoResult');
    const code = (input?.value || '').trim().toUpperCase();

    if (!code) { result.textContent = ''; result.style.color = '#888'; return; }

    result.textContent = 'Checking...';
    result.style.color = '#888';

    try {
        const res = await fetch('/api/promo-codes/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.valid) {
            activePromoCode = code;
            const desc = data.discountType === 'percent'
                ? `${data.discountValue}% off`
                : `$${(data.discountValue / 100).toFixed(2)} off`;
            result.textContent = `${desc} applied!`;
            result.style.color = '#4ade80';
            showToast(`Promo code ${code} applied — ${desc}`);
        } else {
            activePromoCode = null;
            result.textContent = data.error || 'Invalid code';
            result.style.color = '#c22020';
        }
    } catch {
        result.textContent = 'Error checking code';
        result.style.color = '#c22020';
    }
}

async function handleSubscribe(tier) {
    const token = localStorage.getItem('im_token');

    if (!token) {
        pendingSubscribeTier = tier;
        // Switch modal to Sign Up mode for new subscribers
        isSignUp = true;
        const modalTitle = document.getElementById('modalTitle');
        const authSubmit = document.getElementById('authSubmit');
        const toggleText = document.getElementById('toggleText');
        const toggleAuth = document.getElementById('toggleAuth');
        const nameGroup = document.getElementById('nameGroup');
        if (modalTitle) modalTitle.textContent = 'Create Account';
        if (authSubmit) authSubmit.textContent = 'Sign Up';
        if (toggleText) toggleText.textContent = 'Already have an account?';
        if (toggleAuth) toggleAuth.textContent = 'Sign In';
        if (nameGroup) nameGroup.style.display = 'block';
        document.getElementById('authModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        showToast('Create an account to subscribe');
        return;
    }

    // Show payment method picker
    showPaymentPicker('subscription', tier);
}

async function proceedStripeSubscribe(tier) {
    const token = localStorage.getItem('im_token');
    try {
        const body = { tier, type: 'subscription' };
        if (activePromoCode) body.promoCode = activePromoCode;

        const res = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (data.url) {
            window.location.href = data.url;
        } else {
            showToast(data.error || 'Payment setup failed', 'error');
        }
    } catch (err) {
        showToast('Connection error — try again', 'error');
    }
}

async function handleUnlock(postId) {
    const token = localStorage.getItem('im_token');

    if (!token) {
        pendingUnlockPostId = postId;
        // Switch modal to Sign Up mode for new users
        isSignUp = true;
        const modalTitle = document.getElementById('modalTitle');
        const authSubmit = document.getElementById('authSubmit');
        const toggleText = document.getElementById('toggleText');
        const toggleAuth = document.getElementById('toggleAuth');
        const nameGroup = document.getElementById('nameGroup');
        if (modalTitle) modalTitle.textContent = 'Create Account';
        if (authSubmit) authSubmit.textContent = 'Sign Up';
        if (toggleText) toggleText.textContent = 'Already have an account?';
        if (toggleAuth) toggleAuth.textContent = 'Sign In';
        if (nameGroup) nameGroup.style.display = 'block';
        document.getElementById('authModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        showToast('Create an account to unlock content');
        return;
    }

    // Show payment method picker
    showPaymentPicker('single', postId);
}

async function proceedStripeUnlock(postId) {
    const token = localStorage.getItem('im_token');
    try {
        const res = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ postId, type: 'single' })
        });

        const data = await res.json();

        if (data.url) {
            window.location.href = data.url;
        } else {
            showToast(data.error || 'Payment setup failed', 'error');
        }
    } catch (err) {
        showToast('Connection error — try again', 'error');
    }
}

// ==================== CONTACT FORM ====================
function initContactForm() {
    const form = document.getElementById('contactForm');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        try {
            const btn = form.querySelector('button[type="submit"]');
            btn.textContent = 'Sending...';
            btn.disabled = true;

            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (result.success) {
                showToast('Message sent! I\'ll get back to you soon.');
                form.reset();
            } else {
                showToast('Failed to send — try again', 'error');
            }
        } catch (err) {
            showToast('Connection error', 'error');
        } finally {
            const btn = form.querySelector('button[type="submit"]');
            btn.textContent = 'Send It →';
            btn.disabled = false;
        }
    });
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '2rem',
        right: '2rem',
        padding: '1rem 2rem',
        background: type === 'error' ? '#c22020' : '#1a1a1a',
        color: '#e8e4df',
        fontFamily: "'Space Mono', monospace",
        fontSize: '0.75rem',
        letterSpacing: '1px',
        border: `1px solid ${type === 'error' ? '#e63030' : '#333'}`,
        zIndex: '99999',
        opacity: '0',
        transform: 'translateY(10px)',
        transition: 'all 0.3s ease'
    });

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== LATEST DROPS ====================
// Load recently published free content from the pipeline
function loadLatestDrops() {
    const section = document.getElementById('latest-content');
    const grid = document.getElementById('latestDropsGrid');
    if (!section || !grid) return;

    fetch('/api/content?tier=free')
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;
            const items = (data.content || []).filter(c => c.tier === 'free').slice(0, 6);
            if (!items.length) return;

            section.style.display = '';
            grid.innerHTML = items.map(c => {
                const hasImage = c.imageUrl && (c.imageUrl.startsWith('http') || c.imageUrl.startsWith('/api/'));
                const typeIcons = { post: '\u270E', gallery: '\u2726', video: '\u25B6', announcement: '\u2605' };
                const icon = typeIcons[c.type] || '\u2726';
                const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

                return `<div style="background:#0d0d0d;border:1px solid #222;overflow:hidden;transition:all 0.3s;cursor:pointer" onmouseover="this.style.borderColor='#333';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='#222';this.style.transform=''">
                    <div style="aspect-ratio:4/5;background:#1a1a1a;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">
                        ${hasImage
                            ? `<img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.title)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:2rem;color:#555">${icon}</div>`
                            : `<div style="font-size:2rem;color:#555">${icon}</div>`
                        }
                        ${c.category ? `<span style="position:absolute;top:0.8rem;right:0.8rem;background:#c22020;color:#fff;font-size:0.5rem;letter-spacing:2px;text-transform:uppercase;padding:0.25rem 0.7rem;font-family:'Space Mono',monospace">${escapeHtml(c.category)}</span>` : ''}
                    </div>
                    <div style="padding:1.2rem">
                        <h3 style="font-family:'Cormorant Garamond',serif;font-size:1.1rem;margin-bottom:0.3rem;color:#e8e4df">${escapeHtml(c.title)}</h3>
                        <span style="font-size:0.6rem;color:#555;letter-spacing:2px;font-family:'Space Mono',monospace">${dateStr}</span>
                    </div>
                </div>`;
            }).join('');
        })
        .catch(() => {});
}

// ==================== FAQ ACCORDION ====================
function initFAQ() {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all others
            faqItems.forEach(other => other.classList.remove('active'));

            // Toggle current
            if (!isActive) {
                item.classList.add('active');
                question.setAttribute('aria-expanded', 'true');
            } else {
                question.setAttribute('aria-expanded', 'false');
            }
        });
    });
}

// ==================== TESTIMONIALS CAROUSEL ====================
function initTestimonialsCarousel() {
    const track = document.getElementById('testimonialsTrack');
    const dotsContainer = document.getElementById('testimonialDots');
    const prevBtn = document.getElementById('testimonialPrev');
    const nextBtn = document.getElementById('testimonialNext');
    if (!track) return;

    const cards = track.querySelectorAll('.testimonial-card');
    let currentSlide = 0;
    let touchStartX = 0;

    function getVisibleCount() {
        const w = window.innerWidth;
        if (w > 900) return 3;
        if (w > 600) return 2;
        return 1;
    }

    function getSlideCount() {
        return Math.max(1, cards.length - getVisibleCount() + 1);
    }

    function buildDots() {
        dotsContainer.innerHTML = '';
        const count = getSlideCount();
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('div');
            dot.className = 'testimonial-dot' + (i === currentSlide ? ' active' : '');
            dot.addEventListener('click', () => goToSlide(i));
            dotsContainer.appendChild(dot);
        }
    }

    function goToSlide(index) {
        const maxSlide = getSlideCount() - 1;
        currentSlide = Math.max(0, Math.min(index, maxSlide));
        const card = cards[0];
        const gap = 24; // 1.5rem
        const cardWidth = card.offsetWidth + gap;
        track.style.transform = `translateX(-${currentSlide * cardWidth}px)`;
        buildDots();
    }

    prevBtn.addEventListener('click', () => goToSlide(currentSlide - 1));
    nextBtn.addEventListener('click', () => goToSlide(currentSlide + 1));

    // Touch support
    track.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    track.addEventListener('touchend', (e) => {
        const diff = touchStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) > 50) {
            goToSlide(currentSlide + (diff > 0 ? 1 : -1));
        }
    }, { passive: true });

    // Auto-advance with pause on hover/touch
    function nextSlide() {
        goToSlide(currentSlide + 1 >= getSlideCount() ? 0 : currentSlide + 1);
    }
    let autoPlay = setInterval(nextSlide, 5000);

    function pauseAutoPlay() { clearInterval(autoPlay); }
    function resumeAutoPlay() { clearInterval(autoPlay); autoPlay = setInterval(nextSlide, 5000); }

    const section = track.closest('.testimonials-section');
    section.addEventListener('mouseenter', pauseAutoPlay);
    section.addEventListener('mouseleave', resumeAutoPlay);
    // Pause on touch too (mobile)
    section.addEventListener('touchstart', pauseAutoPlay, { passive: true });
    section.addEventListener('touchend', () => { setTimeout(resumeAutoPlay, 3000); }, { passive: true });

    buildDots();
    window.addEventListener('resize', () => goToSlide(currentSlide));
}

// ==================== COUNTDOWN TIMER ====================
function initCountdown() {
    const daysEl = document.getElementById('cdDays');
    const hoursEl = document.getElementById('cdHours');
    const minsEl = document.getElementById('cdMins');
    const secsEl = document.getElementById('cdSecs');
    if (!daysEl) return;

    // Calculate next Tuesday or Thursday at 8pm ET using UTC offsets
    function getNextDropMs() {
        // Get current UTC time
        const now = Date.now();
        // ET is UTC-5 (EST) or UTC-4 (EDT)
        // Use Intl to detect current ET offset
        const etStr = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).format(now);
        // Parse ET parts: "MM/DD/YYYY, HH:MM:SS"
        const parts = etStr.match(/(\d+)/g);
        const etMonth = parseInt(parts[0], 10) - 1;
        const etDay = parseInt(parts[1], 10);
        const etYear = parseInt(parts[2], 10);
        const etHour = parseInt(parts[3], 10);
        const etMin = parseInt(parts[4], 10);
        const etSec = parseInt(parts[5], 10);

        // Create a Date representing ET time
        const etDate = new Date(etYear, etMonth, etDay, etHour, etMin, etSec);
        const dayOfWeek = etDate.getDay(); // 0=Sun, 2=Tue, 4=Thu

        // Find days until next Tue(2) or Thu(4) at 8pm ET
        const dropDays = [2, 4]; // Tuesday, Thursday
        let bestDaysUntil = 8;

        for (const targetDay of dropDays) {
            let daysUntil = (targetDay - dayOfWeek + 7) % 7;
            // If it's the same day, check if we're past 8pm
            if (daysUntil === 0 && etHour >= 20) {
                daysUntil = 7; // Next week same day
            }
            // Also try next week for the other day
            if (daysUntil === 0 && etHour < 20) {
                daysUntil = 0; // Today, still before 8pm
            }
            if (daysUntil < bestDaysUntil) {
                bestDaysUntil = daysUntil;
            }
        }

        // Build target: today + bestDaysUntil at 8pm ET
        const targetET = new Date(etYear, etMonth, etDay + bestDaysUntil, 20, 0, 0, 0);
        // Calculate diff in ms using the ET clock
        return targetET.getTime() - etDate.getTime();
    }

    function updateTimer() {
        const diff = Math.max(0, getNextDropMs());

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const mins = Math.floor((diff / (1000 * 60)) % 60);
        const secs = Math.floor((diff / 1000) % 60);

        daysEl.textContent = String(days).padStart(2, '0');
        hoursEl.textContent = String(hours).padStart(2, '0');
        minsEl.textContent = String(mins).padStart(2, '0');
        secsEl.textContent = String(secs).padStart(2, '0');
    }

    updateTimer();
    setInterval(updateTimer, 1000);
}

// ==================== BACK TO TOP ====================
function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 600) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ==================== NEWSLETTER FORM ====================
function initNewsletterForm() {
    const form = document.getElementById('newsletterForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.querySelector('input[name="email"]').value;
        const btn = form.querySelector('.newsletter-btn');
        const origText = btn.textContent;

        try {
            btn.textContent = 'Subscribing...';
            btn.disabled = true;

            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Newsletter Subscriber',
                    email,
                    subject: 'newsletter',
                    message: 'Newsletter signup'
                })
            });

            const data = await res.json();
            if (data.success) {
                showToast('You\'re in! Welcome to the Mayhem List.');
                form.reset();
            } else {
                showToast('Something went wrong — try again', 'error');
            }
        } catch {
            showToast('Connection error — try again', 'error');
        } finally {
            btn.textContent = origText;
            btn.disabled = false;
        }
    });
}

// ==================== IMAGE SHIMMER LOADING ====================
function initImageShimmer() {
    document.querySelectorAll('.gallery-item img[loading="lazy"]').forEach(img => {
        if (img.complete) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', () => img.classList.add('loaded'));
        }
    });
}

// ==================== ANIMATED STATS COUNTER ====================
function initAnimatedStats() {
    const stats = document.querySelectorAll('.stat-num');
    if (!stats.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateNumber(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    stats.forEach(stat => observer.observe(stat));

    function animateNumber(el) {
        const text = el.textContent.trim();
        const hasPlus = text.includes('+');
        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (isNaN(num)) return;

        const duration = 1500;
        const start = performance.now();

        function update(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(eased * num);
            el.textContent = current + (hasPlus ? '+' : '');
            if (progress < 1) requestAnimationFrame(update);
        }

        el.textContent = '0' + (hasPlus ? '+' : '');
        requestAnimationFrame(update);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
