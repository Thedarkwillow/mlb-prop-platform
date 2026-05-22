CREATE TABLE IF NOT EXISTS prop_snapshots (
  id BIGSERIAL PRIMARY KEY,
  slate_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  source_file TEXT,
  row_hash TEXT UNIQUE,
  player TEXT,
  team TEXT,
  opponent TEXT,
  game TEXT,
  market TEXT,
  side TEXT,
  line NUMERIC,
  odds_tier TEXT,
  projection NUMERIC,
  probability NUMERIC,
  expected_value NUMERIC,
  confidence_bucket TEXT,
  raw JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS graded_props (
  id BIGSERIAL PRIMARY KEY,
  slate_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  source_file TEXT,
  row_hash TEXT UNIQUE,
  player TEXT,
  team TEXT,
  opponent TEXT,
  game TEXT,
  market TEXT,
  side TEXT,
  line NUMERIC,
  result TEXT,
  hit BOOLEAN,
  probability NUMERIC,
  expected_value NUMERIC,
  confidence_bucket TEXT,
  pitch_type_tier TEXT,
  lineup_tier TEXT,
  own_bullpen_tier TEXT,
  opponent_bullpen_tier TEXT,
  catcher_framing_tier TEXT,
  savant_form_tier TEXT,
  raw JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS context_roi_history (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  signal TEXT,
  total INTEGER,
  wins INTEGER,
  losses INTEGER,
  pushes INTEGER,
  hit_rate NUMERIC,
  roi NUMERIC,
  avg_prob NUMERIC,
  avg_ev NUMERIC,
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prop_snapshots_slate ON prop_snapshots (slate_date);
CREATE INDEX IF NOT EXISTS idx_prop_snapshots_player_market ON prop_snapshots (player, market);
CREATE INDEX IF NOT EXISTS idx_graded_props_slate ON graded_props (slate_date);
CREATE INDEX IF NOT EXISTS idx_graded_props_market_side ON graded_props (market, side);
CREATE INDEX IF NOT EXISTS idx_context_roi_signal ON context_roi_history (signal);
