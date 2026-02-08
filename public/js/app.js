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
    document.querySelectorAll('.section-header, .gallery-item, .tier-card, .blog-card, .ppv-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // Add visible class styles
    const style = document.createElement('style');
    style.textContent = '.visible { opacity: 1 !important; transform: translateY(0) !important; }';
    document.head.appendChild(style);

    // Stagger gallery items (cap at 0.8s so last items don't wait too long)
    document.querySelectorAll('.gallery-item').forEach((item, i) => {
        item.style.transitionDelay = `${Math.min(i * 0.08, 0.8)}s`;
    });

    document.querySelectorAll('.tier-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.15}s`;
    });

    // Gallery image shimmer — mark items loaded once their image finishes
    document.querySelectorAll('.gallery-item img').forEach(img => {
        const markLoaded = () => img.closest('.gallery-item').classList.add('loaded');
        if (img.complete) {
            markLoaded();
        } else {
            img.addEventListener('load', markLoaded);
            img.addEventListener('error', markLoaded);
        }
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

            galleryItems.forEach(item => {
                if (filter === 'all' || item.dataset.category === filter) {
                    item.style.display = '';
                    setTimeout(() => {
                        item.style.opacity = '1';
                        item.style.transform = 'scale(1)';
                    }, 50);
                } else {
                    item.style.opacity = '0';
                    item.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        item.style.display = 'none';
                    }, 300);
                }
            });
        });
    });
}

// ==================== AUTH MODAL ====================
function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    if (!lightbox) return;

    document.querySelectorAll('.gallery-item img').forEach(img => {
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            lightboxImg.src = img.src;
            lightbox.style.display = 'flex';
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') lightbox.style.display = 'none';
    });
}

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

    let isSignUp = false;

    function openModal() {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    // btnLogin click is handled by updateAuthUI
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
                showToast(isSignUp ? 'Welcome to InkedMayhem!' : 'Welcome back!');
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

    // Check for existing session and set up login button
    const savedUser = localStorage.getItem('im_user');
    if (savedUser) {
        try {
            updateAuthUI(JSON.parse(savedUser));
        } catch (e) {
            localStorage.removeItem('im_token');
            localStorage.removeItem('im_user');
            updateAuthUI(null);
        }
    } else {
        updateAuthUI(null);
    }
}

function updateAuthUI(user) {
    const btnLogin = document.getElementById('btnLogin');
    const modal = document.getElementById('authModal');

    // Remove all previous click listeners by cloning
    const newBtn = btnLogin.cloneNode(true);
    btnLogin.parentNode.replaceChild(newBtn, btnLogin);

    if (user) {
        newBtn.textContent = user.name || 'Account';
        newBtn.addEventListener('click', () => {
            if (confirm('Sign out?')) {
                localStorage.removeItem('im_token');
                localStorage.removeItem('im_user');
                updateAuthUI(null);
                showToast('Signed out');
            }
        });
    } else {
        newBtn.textContent = 'Sign In';
        newBtn.addEventListener('click', () => {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }
}

// ==================== SUBSCRIPTION / PAYMENT ====================
async function handleSubscribe(tier) {
    const token = localStorage.getItem('im_token');

    if (!token) {
        document.getElementById('authModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        showToast('Sign in first to subscribe');
        return;
    }

    try {
        const res = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ tier, type: 'subscription' })
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
        document.getElementById('authModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        showToast('Sign in first to unlock content');
        return;
    }

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

        // Honeypot check — if the hidden field is filled, silently reject
        if (data.website) {
            showToast('Message sent! I\'ll get back to you soon.');
            form.reset();
            return;
        }
        delete data.website;

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
