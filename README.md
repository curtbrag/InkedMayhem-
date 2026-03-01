# InkedMayhem

---

## Netlify Environment Variables

Go to **Netlify > Site Configuration > Environment Variables** and make sure these are set:

| Variable | What It Is |
|----------|------------|
| `JWT_SECRET` | Any random string you make up |
| `ADMIN_PASSWORD` | Password for your admin dashboard (default: `073588`) |
| `STRIPE_SECRET_KEY` | From Stripe > Developers > API Keys (starts with `sk_live_`) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe > Developers > Webhooks (starts with `whsec_`) |

After changing any of these, redeploy the site.

---

## Stripe Webhook

In Stripe go to **Developers > Webhooks > Add endpoint**

- **URL:** `https://inkedmayhem.netlify.app/api/stripe-webhook`
- **Events to select:**
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`
  - `customer.subscription.updated`
  - `charge.refunded`
  - `charge.dispute.created`

Copy the signing secret and paste it as `STRIPE_WEBHOOK_SECRET` in Netlify.

---

## Admin Dashboard

**https://inkedmayhem.netlify.app/admin**

Log in with your `ADMIN_PASSWORD`. From here you can manage users, content, and approve Venmo payments.

---

## Venmo

When a fan pays with Venmo, it shows up in your admin dashboard as "pending." Check your Venmo, confirm you got paid, then hit **Approve** in the dashboard.

---

All content © 2026 InkedMayhem. All rights reserved.
