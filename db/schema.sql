-- core schema
create extension if not exists "uuid-ossp";

create table if not exists reviews (
  id uuid primary key default uuid_generate_v4(),
  repo text not null,
  pr_number integer not null,
  commit_sha text not null,
  status text not null default 'pending', -- pending | processing | completed | failed
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists review_findings (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references reviews(id) on delete cascade,
  file_path text not null,
  line_number integer not null,
  category text not null,       -- bug-risk | security | style
  severity text not null,       -- low | medium | high
  explanation text not null,
  validated boolean not null default false,
  posted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists eval_labels (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references reviews(id) on delete cascade,
  finding_id uuid references review_findings(id) on delete set null,
  is_true_positive boolean not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references reviews(id) on delete cascade,
  prompt_tokens integer not null,
  completion_tokens integer not null,
  cost_usd numeric(10, 6) not null default 0,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_findings_review_id on review_findings(review_id);
create index if not exists idx_eval_labels_review_id on eval_labels(review_id);
create index if not exists idx_usage_events_review_id on usage_events(review_id);
