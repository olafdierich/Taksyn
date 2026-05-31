# Taksyn – Setup Guide
## Get your team trialling in ~20 minutes

---

## STEP 1 — Get the code on GitHub (5 min)

1. Go to **github.com** → sign up free if needed
2. Click **"New repository"** → name it `taksyn` → click **Create**
3. Click **"uploading an existing file"**
4. Upload ALL files from this folder, keeping the folder structure:
   ```
   taksyn/
   ├── index.html
   ├── package.json
   ├── vite.config.js
   ├── .env.example
   ├── public/
   │   └── favicon.svg
   └── src/
       ├── main.jsx
       ├── App.jsx
       └── supabase.js
   ```
5. Click **Commit changes**

---

## STEP 2 — Create your Supabase database (5 min)

1. Go to **supabase.com** → "Start your project" → sign up free
2. Click **"New project"** → name it `taksyn` → set a database password → click Create
3. Wait ~2 minutes for it to spin up
4. Go to **SQL Editor** (left sidebar) → click **"New query"**
5. Copy the entire contents of `supabase-schema.sql` → paste → click **Run**
6. Go to **Settings → API** (left sidebar)
7. Copy your:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon / public key** (long string starting with `eyJ...`)

---

## STEP 3 — Deploy to Vercel (5 min)

1. Go to **vercel.com** → sign up free (use "Continue with GitHub")
2. Click **"Add New Project"** → select your `taksyn` repo → click **Import**
3. Before clicking Deploy, click **"Environment Variables"** and add:
   ```
   VITE_SUPABASE_URL     = https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJ...your-anon-key...
   ```
4. Click **Deploy**
5. In ~2 minutes you'll get a live URL like: **`taksyn.vercel.app`**

---

## STEP 4 — Create your Super Admin account (2 min)

1. Open your live URL
2. Click **"Sign up"** and register with your email
3. In Supabase → **Table Editor → profiles** → find your row
4. Change the `role` column to `super_admin` and `tier` to `Enterprise`
5. Now you have full platform access

---

## STEP 5 — Invite your team (ongoing)

### Option A — Demo accounts (fastest for trials)
Share these login details with your team. Everyone can sign in instantly:

| Role         | Email                       | Password   |
|-------------|----------------------------|------------|
| Client Admin | clientadmin@taksyn.demo    | Demo1234!  |
| Manager      | manager@taksyn.demo        | Demo1234!  |
| Supervisor   | supervisor@taksyn.demo     | Demo1234!  |
| Worker       | worker@taksyn.demo         | Demo1234!  |

*(These work without Supabase — demo mode)*

### Option B — Real accounts (for live trial)
1. Ask each staff member to go to your Vercel URL and click **Sign up**
2. They register with their real email
3. You go to Supabase → Table Editor → profiles → find their row → set their role

---

## What each role sees

| Role         | Can do                                                      |
|-------------|-------------------------------------------------------------|
| Super Admin  | Everything — full platform + user management + all reports |
| Client Admin | Manage org, teams, tasks, evidence, reports                 |
| Manager      | Team dashboard, tasks, evidence review, escalations        |
| Supervisor   | Review & approve evidence, escalate tasks                   |
| Worker       | See assigned tasks, complete checklists, upload photos      |

---

## Costs (all free for trial)

| Service  | Free tier                          |
|---------|-------------------------------------|
| GitHub   | Unlimited public repos              |
| Supabase | 500MB DB, 50,000 monthly active users |
| Vercel   | Unlimited deployments, custom domain |

**Total cost to trial: $0**

---

## Custom domain (optional)

In Vercel → your project → **Domains** → add `app.taksyn.com` or similar.
Costs ~$15/year for the domain itself.

---

## Need help?

If you get stuck on any step, just come back and ask — happy to walk through it.
