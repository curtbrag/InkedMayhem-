# InkedMayhem

Independent creator platform — no middlemen, no platform cuts. 100% yours.

---

## What You Get

- Your own website at **inkedmayhem.netlify.app**
- Fans can sign up, subscribe, and pay you directly
- Two payment options: **Stripe** (credit card) and **Venmo**
- Admin dashboard to manage users, content, and payments
- Telegram notifications when someone subscribes, pays, or cancels

### Pricing (already set up)

| Tier | Price | What They Get |
|------|-------|---------------|
| Free | $0 | Can browse the public gallery |
| Ink Insider (VIP) | $9.99/month | Access to VIP-only posts |
| Mayhem Circle (Elite) | $24.99/month | Access to everything |
| Single Post Unlock | $4.99 each | Buy one post without subscribing |

---

## How To Set It Up (Step by Step)

### Step 1: Netlify (Your Hosting)

Your site is already connected to Netlify. When you push code to GitHub, it auto-deploys.

**Site URL:** `https://inkedmayhem.netlify.app`

### Step 2: Set Environment Variables in Netlify

Go to: **Netlify Dashboard > Your Site > Site Configuration > Environment Variables**

Add these one at a time (click "Add a variable" for each):

| Variable | What to Put | Where to Get It |
|----------|-------------|-----------------|
| `JWT_SECRET` | Any long random string (like `myS3cretKey2026xyz`) | Make one up — keep it secret |
| `ADMIN_PASSWORD` | Your admin dashboard password | Make one up — you'll use this to log in |
| `STRIPE_SECRET_KEY` | Starts with `sk_live_...` | Stripe Dashboard (see Step 3) |
| `STRIPE_WEBHOOK_SECRET` | Starts with `whsec_...` | Stripe Dashboard (see Step 3) |
| `TELEGRAM_CREATOR_BOT_TOKEN` | Bot token from BotFather | Telegram (see Step 4) — optional |
| `TELEGRAM_ADMIN_CHAT_ID` | Your Telegram chat ID | Telegram (see Step 4) — optional |

After adding variables, click **"Redeploy" > "Clear cache and deploy site"** so they take effect.

### Step 3: Stripe Setup (Credit Card Payments)

1. Go to [stripe.com](https://stripe.com) and create an account (or log in)
2. In Stripe Dashboard, click **Developers** (top right) > **API Keys**
3. Copy your **Secret key** (starts with `sk_live_...`) — paste it as `STRIPE_SECRET_KEY` in Netlify
4. Now set up the webhook:
   - In Stripe, go to **Developers** > **Webhooks**
   - Click **"Add endpoint"**
   - **Endpoint URL:** `https://inkedmayhem.netlify.app/api/stripe-webhook`
   - Click **"Select events"** and check ALL of these:
     - `checkout.session.completed`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
     - `customer.subscription.updated`
     - `charge.refunded`
     - `charge.dispute.created`
   - Click **"Add endpoint"**
   - On the next page, click **"Reveal"** next to "Signing secret"
   - Copy it (starts with `whsec_...`) — paste as `STRIPE_WEBHOOK_SECRET` in Netlify

### Step 4: Telegram Notifications (Optional)

This sends you a message on Telegram whenever someone subscribes, pays, cancels, etc.

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, give it a name like "InkedMayhem Alerts"
3. BotFather gives you a token — paste it as `TELEGRAM_CREATOR_BOT_TOKEN` in Netlify
4. To get your chat ID:
   - Send any message to your new bot
   - Open this URL in your browser: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - Look for `"chat":{"id":123456789}` — that number is your chat ID
   - Paste it as `TELEGRAM_ADMIN_CHAT_ID` in Netlify

### Step 5: Venmo (Already Set Up)

Venmo handle is set to **Christina-Dipietro-6**. When a fan picks Venmo:
- They get sent to Venmo with the amount and a note pre-filled
- The payment shows up in your Admin Dashboard as "pending"
- You check your Venmo, confirm you got paid, then hit "Approve" in the admin dashboard
- Their account gets upgraded automatically

---

## Your Admin Dashboard

**URL:** `https://inkedmayhem.netlify.app/admin`

**Password:** Whatever you set as `ADMIN_PASSWORD` in Netlify (default is `073588` if you haven't changed it — change it!)

### What you can do in the dashboard:

- **Users** — See all registered users, their tier, change their tier manually
- **Content** — Create/edit/delete posts, set which tier can see them, schedule posts
- **Venmo Payments** — See pending Venmo payments, approve or reject them
- **Analytics** — Revenue events, subscriber counts
- **Messages** — Read contact form submissions
- **Export** — Download your user data

---

## How Payments Work

### Stripe (Credit Card)
1. Fan clicks "Subscribe" or "Unlock" on your site
2. They pick "Pay with Card"
3. Stripe checkout opens — they enter card info
4. Stripe processes the payment and tells your site automatically (via webhook)
5. Their account gets upgraded instantly — no action needed from you

### Venmo
1. Fan clicks "Subscribe" or "Unlock"
2. They pick "Pay with Venmo"
3. Venmo opens with the amount and a note pre-filled
4. They send the payment to you on Venmo
5. You go to your Admin Dashboard > Venmo Payments
6. Find their payment, click **Approve**
7. Their account gets upgraded

---

## How To Add New Content

### From the Admin Dashboard (easiest way)
1. Go to `https://inkedmayhem.netlify.app/admin`
2. Log in with your password
3. Go to the **Content** section
4. Click **"New Post"**
5. Fill in the title, upload an image, pick which tier can see it
6. Click **Save** (or schedule it for later)

### Gallery Images (on the main page)
Put your images in the `public/images/` folder, then add them in `public/index.html`:
```html
<div class="gallery-item" data-category="blackwork">
    <img src="/images/your-image.jpg" alt="Description">
</div>
```

---

## Important Links

| What | URL |
|------|-----|
| Your Site | `https://inkedmayhem.netlify.app` |
| Members Page | `https://inkedmayhem.netlify.app/members` |
| Admin Dashboard | `https://inkedmayhem.netlify.app/admin` |
| Netlify Dashboard | `https://app.netlify.com` |
| Stripe Dashboard | `https://dashboard.stripe.com` |
| GitHub Repo | `https://github.com/curtbrag/InkedMayhem-` |

---

## If Something Breaks

- **Payments not working?** Check that `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in Netlify environment variables. Redeploy after adding them.
- **Can't log into admin?** Check your `ADMIN_PASSWORD` environment variable in Netlify.
- **Site not updating?** Go to Netlify Dashboard > Deploys and check if the latest deploy succeeded.
- **Telegram not sending?** Make sure `TELEGRAM_CREATOR_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` are set and you've messaged the bot at least once.

---

All content © 2026 InkedMayhem. All rights reserved.
