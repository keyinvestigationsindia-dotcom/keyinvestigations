-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Customers profile table (extends Supabase auth.users)
create table public.customers (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text not null,
  company text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Cases table (investigations per customer)
create table public.cases (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade not null,
  case_number text unique not null,
  title text not null,
  status text default 'open' check (status in ('open','in_progress','resolved','closed')),
  service_type text,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security: customers can only see their own data
alter table public.customers enable row level security;
alter table public.cases enable row level security;

create policy "customers: own row only"
  on public.customers for all
  using (auth.uid() = id);

create policy "cases: own cases only"
  on public.cases for all
  using (auth.uid() = customer_id);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger customers_updated_at before update on public.customers
  for each row execute function public.handle_updated_at();

create trigger cases_updated_at before update on public.cases
  for each row execute function public.handle_updated_at();

-- Auto-create customer profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.customers (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
