-- Xərc silmə icazələri + elan kart nömrəsi (üzvlər görüb kopyalaya bilsin)

-- 1) Listings: ödəniş kartı
alter table public.listings
  add column if not exists payment_card text;

comment on column public.listings.payment_card is
  'Elan sahibinin 16 rəqəmli kartı — təsdiqlənmiş iştirakçılar görür';

-- 2) Expenses DELETE: ödəyən və ya qrup yaradan
drop policy if exists expenses_delete_payer_or_owner on public.expenses;
create policy expenses_delete_payer_or_owner
  on public.expenses
  for delete
  to authenticated
  using (
    paid_by = auth.uid()
    or exists (
      select 1
      from public.expense_groups g
      where g.id = expenses.group_id
        and g.created_by = auth.uid()
    )
  );

-- 3) Expense groups DELETE: yalnız yaradan
drop policy if exists expense_groups_delete_owner on public.expense_groups;
create policy expense_groups_delete_owner
  on public.expense_groups
  for delete
  to authenticated
  using (created_by = auth.uid());

-- 4) Cascade cleanup helpers — üzvlük də silinsin
drop policy if exists expense_group_members_delete_owner on public.expense_group_members;
create policy expense_group_members_delete_owner
  on public.expense_group_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.expense_groups g
      where g.id = expense_group_members.group_id
        and g.created_by = auth.uid()
    )
  );
