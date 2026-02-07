# InkedMayhem

Independent creator platform — no middlemen, no platform cuts. 100% yours.

## Features

- **Dark & Edgy Design** — Custom tattoo-culture aesthetic
- **Image Gallery** — Filterable portfolio of work
- **Subscription Tiers** — Free / VIP ($9.99/mo) / Elite ($24.99/mo)
- **Pay-Per-Post** — Individual content unlocking
- **User Authentication** — JWT-based sign up/sign in
- **Stripe Payments** — Subscriptions + one-time purchases
- **Contact Form** — Messages stored in Netlify Blobs
- **Blog Section** — Stories and updates
- **Fully Responsive** — Mobile-first design
- **Legal Pages** — Terms of Service + Privacy Policy

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no framework bloat)
- **Backend**: Netlify Serverless Functions
- **Storage**: Netlify Blobs (user data, contacts)
- **Payments**: Stripe Checkout
- **Auth**: JWT + bcrypt
- **Hosting**: Netlify

## Setup

### 1. Clone & Install
```bash
git clone https://github.com/curtbrag/InkedMayhem-.git
cd InkedMayhem-
npm install
```

### 2. Environment Variables (Netlify Dashboard)
| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Random secret for auth tokens (already set) |
| `STRIPE_SECRET_KEY` | From [Stripe Dashboard](https://dashboard.stripe.com/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhook setup |

### 3. Stripe Setup
1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get your Secret Key from Dashboard → Developers → API Keys
3. Add webhook endpoint: `https://inkedmayhem.netlify.app/api/stripe-webhook`
4. Select events: `checkout.session.completed`, `customer.subscription.deleted`
5. Copy the webhook signing secret

### 4. Local Dev
```bash
npx netlify dev
```

### 5. Deploy
Push to main branch — Netlify auto-deploys.

## Adding Content

### Gallery Images
Replace placeholder divs in `public/index.html` with:
```html
<div class="gallery-item" data-category="blackwork">
    <img src="/images/your-image.jpg" alt="Description">
</div>
```

### Blog Posts
Add new `<article class="blog-card">` blocks in the blog section.

### Exclusive Content
Paid content is gated by user tier. The `create-checkout.mts` function handles payment flow.

## File Structure
```
├── public/
│   ├── index.html          # Main site
│   ├── success.html        # Post-payment page
│   ├── terms.html          # Terms of Service
│   ├── privacy.html        # Privacy Policy
│   ├── css/style.css       # All styles
│   ├── js/app.js           # Frontend logic
│   └── images/             # Gallery images
├── netlify/
│   └── functions/
│       ├── auth-register.mts   # User registration
│       ├── auth-login.mts      # User login
│       ├── create-checkout.mts # Stripe checkout
│       ├── stripe-webhook.mts  # Payment confirmation
│       └── contact.mts         # Contact form
├── netlify.toml            # Netlify config
└── package.json
```

## License

All content © 2026 InkedMayhem. All rights reserved.
