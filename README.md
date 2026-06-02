# FIFA / World Cup 2026 Prediction Board

A Vite + React + TypeScript app using Supabase for auth, database, row-level security, and payout settlement.

## Features

- Username/password login flow.
- Supabase Auth is used behind the scenes with a generated private email per username.
- Every user starts with a $100 balance.
- Admins can add upcoming matches with date/time.
- Users can place or update one prediction per match until 15 minutes before kick-off.
- Prediction options are mutually exclusive: Team A win, Draw, Team B win.
- Stakes are deducted when a prediction is placed.
- Admins settle matches using the Admin page.
- Winners receive their stake back plus a proportional share of losing stakes.
- Results page shows all predictors and their selected result after the match is finished.
- Money is masked from other users; users can see their own stake, payout and net only. Admins can see all money columns.

## Payout rule used

Because there can be multiple correct predictors, the app uses this rule:

```text
winning payout = user's stake + (user's stake / total winning stakes) × total losing stakes
net amount = payout - user's original stake
```

Example: if two correct users bid $10 and $30, and losing stakes total $80:

- $10 winner gets $10 + 25% of $80 = $30 payout, $20 net profit.
- $30 winner gets $30 + 75% of $80 = $90 payout, $60 net profit.

If nobody predicts correctly, no payout is made.

## Supabase setup

1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Paste and run `supabase/schema.sql`.
4. Go to **Authentication → Providers → Email** and disable email confirmation for this private username/password app.
5. Copy your project URL and anon key into `.env.local`:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

6. Start the app:

```bash
npm install
npm run dev
```

## Make the first admin

Create your first user from the app, then run this in Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where username = 'your_username';
```

Log out and back in. The Admin tab should appear.

## Main Supabase RPCs

The app uses these RPCs from `supabase/schema.sql`:

- `public.place_prediction(p_match_id uuid, p_choice prediction_choice, p_amount numeric)`
- `public.finish_match(p_match_id uuid, p_result prediction_choice)`
- `public.get_match_results(p_match_id uuid)`

These functions enforce the core rules in the database, not only in the React UI.

## Notes

- This is built for a friendly prediction board, not a regulated betting product.
- The theme avoids official FIFA trademarks/images. You can add your own licensed assets later in `src/styles.css` or as image files.
- If you want other users' bid amounts to become public after a match, edit `get_match_results()` in `supabase/schema.sql` to return `p.amount`, `p.payout_amount`, and `p.net_amount` for all rows. Currently, it masks money for privacy.
