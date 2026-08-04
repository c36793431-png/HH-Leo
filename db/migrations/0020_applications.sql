-- CV application intake for /careers — replaces the mailto-based apply flow with a proper
-- form + admin review queue. cv_url stores the private Blob storage path, never a public URL.
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  role_interest text not null,
  message text,
  cv_url text,
  status text not null default 'new' check (status in ('new', 'reviewed', 'contacted', 'hired', 'rejected')),
  admin_notes text,
  created_at timestamptz not null default now()
);

create index if not exists applications_email_created_at_idx on applications (email, created_at desc);
create index if not exists applications_status_idx on applications (status);

insert into schema_migrations (version, name) values
  ('0020', '0020_applications.sql')
on conflict (version) do nothing;
