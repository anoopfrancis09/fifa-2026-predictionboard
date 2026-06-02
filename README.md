# FIFA / World Cup 2026 Prediction Board

A Vite + React + TypeScript app using Supabase for auth, database, row-level security, and payout settlement.

## Features

- Username/password login flow.
- Supabase Auth is used behind the scenes with a generated private email per username.
- Every user starts with a $100 balance.
- Admins can add upcoming matches with date/time and outcome weights.
- Admins can edit or delete upcoming match entries. Deleting an upcoming match refunds any existing stakes automatically.
- Users can place or update one prediction per match until 15 minutes before kick-off.
- Prediction options are mutually exclusive: Team A win, Draw, Team B win.
- Stakes are deducted when a prediction is placed.
- Admins settle matches using the Admin page.
- Winners receive `stake × selected result weight`.
- Results page shows all predictors and their selected result after the match is finished.
- Money is masked from other users; users can see their own stake, payout and net only. Admins can see all money columns.
- Leaderboard tab shows all users sorted by adjusted total balance in descending order, including remaining coins and net owing.
- Borrow tab lets users request coins from another user. Approved requests transfer coins and increase the borrower's owing balance.

## Payout rule used

The admin enters weights for each outcome when creating or editing a match:

```text
winning payout = user's stake × selected result weight
net amount = payout - user's original stake
```

Example: Brazil weight is 2.50 and the user bids $10:

- If Brazil wins, payout is $25 and net profit is $15.
- If Brazil loses or the match is a draw, payout is $0 and net is -$10.

Only the original stake is deducted when the user places a prediction. Losing users do not lose anything extra.

## Supabase setup

1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Paste and run `supabase/schema.sql`.
4. Run any migration files you need, such as `supabase/leaderboard-migration.sql`, `supabase/borrow-coins-migration.sql`, and then `supabase/leaderboard-net-owing-migration.sql`.
5. Go to **Authentication → Providers → Email** and disable email confirmation for this private username/password app.
6. Copy your project URL and anon key into `.env.local`:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

7. Start the app:

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

The app uses these RPCs from `supabase/schema.sql` and the migration files:

- `public.place_prediction(p_match_id uuid, p_choice prediction_choice, p_amount numeric)`
- `public.finish_match(p_match_id uuid, p_result prediction_choice)`
- `public.admin_update_match(p_match_id uuid, p_team_a text, p_team_b text, p_team_a_weight numeric, p_draw_weight numeric, p_team_b_weight numeric, p_match_time timestamptz)`
- `public.admin_delete_match(p_match_id uuid)`
- `public.get_match_results(p_match_id uuid)`
- `public.get_leaderboard()`
- `public.get_borrow_users()`
- `public.get_coin_borrow_requests()`
- `public.request_coin_borrow(p_lender_id uuid, p_amount numeric)`
- `public.approve_coin_borrow_request(p_request_id uuid)`
- `public.decline_coin_borrow_request(p_request_id uuid)`

These functions enforce the core rules in the database, not only in the React UI.

## Notes

- This is built for a friendly prediction board, not a regulated betting product.
- The theme avoids official FIFA trademarks/images. You can add your own licensed assets later in `src/styles.css` or as image files.
- If you want other users' bid amounts to become public after a match, edit `get_match_results()` in `supabase/schema.sql` to return `p.amount`, `p.payout_amount`, and `p.net_amount` for all rows. Currently, it masks money for privacy.
