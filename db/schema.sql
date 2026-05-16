CREATE TABLE IF NOT EXISTS priced_boards (
  id BIGSERIAL PRIMARY KEY,
  slate_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  source_file TEXT,
  row_count INTEGER,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS full_board_grades (
  id BIGSERIAL PRIMARY KEY,
  slate_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  player TEXT,
  team TEXT,
  game TEXT,
  market TEXT,
  side TEXT,
  line NUMERIC,
  odds_tier TEXT,
  probability NUMERIC,
  edge NUMERIC,
  decision TEXT,
  actual NUMERIC,
  result TEXT,
  game_pk BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS slips (
  id BIGSERIAL PRIMARY KEY,
  slate_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  name TEXT,
  size INTEGER,
  status TEXT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS phase7_reports (
  id BIGSERIAL PRIMARY KEY,
  slate_date DATE NOT NULL,
  report_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_full_board_grades_date ON full_board_grades(slate_date);
CREATE INDEX IF NOT EXISTS idx_full_board_grades_market ON full_board_grades(market);
CREATE INDEX IF NOT EXISTS idx_full_board_grades_result ON full_board_grades(result);
CREATE INDEX IF NOT EXISTS idx_priced_boards_date ON priced_boards(slate_date);
CREATE INDEX IF NOT EXISTS idx_slips_date ON slips(slate_date);
CREATE INDEX IF NOT EXISTS idx_phase7_reports_date_type ON phase7_reports(slate_date, report_type);
