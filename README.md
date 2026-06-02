# FIFA / World Cup 2026 Prediction Board

A Vite + React + TypeScript app using Supabase for auth, database, row-level security, and payout settlement.

## Features

- Username/password login flow.
- Supabase Auth is used behind the scenes with a generated private email per username.
- Every user starts with a $100 balance.
- Admins can add upcoming matches with date/time and result weights.
- Admins can set separate weights for Team A win, Draw, and Team B win.
- Users can place or update one prediction per match until 15 minutes before kick-off.
- Prediction options are mutually exclusive: Team A win, Draw, Team B win.
- Stakes are deducted when a prediction is placed.
- Admins settle matches using the Admin page.
- Winning payout is calculated using the configured weight for the winning result.
- Losing users only lose the amount they bid.
- Results page shows all predictors and their selected result after the match is finished.
- Money is masked from other users; users can see their own stake, payout and net only. Admins can see all money columns.

## Payout rule used

The admin sets weights when adding a match. Example:

```text
Argentina win: 2.80x
Draw: 3.00x
Brazil win: 2.50x
```

When the match is finished:

```text
winning payout = user's bid × winning result weight
net amount = winning payout - user's original bid
```

Examples:

- User bids $10 on Brazil at 2.50x and Brazil wins: payout is $25, net profit is $15.
- User bids $10 on Argentina and Brazil wins: payout is $0, net is -$10.

The user's stake is deducted when they place the bid. If they win, the full payout is added back to their balance. If they lose, nothing more is deducted.

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

## Updating an existing database

If you already ran an older version of the schema, run this file in Supabase SQL Editor instead of re-running the whole schema:

```text
supabase/add-weights-migration.sql
```

It adds the weight columns and replaces the payout functions.

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
