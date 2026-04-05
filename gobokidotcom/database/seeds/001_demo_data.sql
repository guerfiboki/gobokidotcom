-- ============================================================
-- GOBOKI — Seed Data (Demo Tenant + Sample Data)
-- ============================================================

-- Demo tenant
INSERT INTO tenants (id, name, slug, plan, settings) VALUES
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Blue Horizon Retreats',
  'blue-horizon',
  'pro',
  '{
    "primaryColor": "#0d9f80",
    "timezone": "Europe/Lisbon",
    "currency": "USD",
    "language": "en",
    "depositPercent": 30
  }'
);

-- Owner user (password: Demo1234!)
INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'jordan@bluehorizon.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeJf5tNJXzv3aEnXzFkPXa.fO',
  'Jordan', 'Davies', 'owner'
);

-- Experiences
INSERT INTO experiences (tenant_id, name, slug, type, description, short_desc, base_price, duration_days, max_capacity, max_guests, location) VALUES
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  '7-Day Surf Retreat',
  '7-day-surf-retreat',
  'retreat',
  'An immersive week of surfing in world-class waves. From sunrise sessions to sunset yoga, our retreat in Taghazout, Morocco is designed for surfers of all levels.',
  'All-inclusive surf retreat in Taghazout, Morocco',
  1420.00, 7, 12, 12,
  '{"country": "MA", "city": "Taghazout", "coordinates": {"lat": 30.5353, "lng": -9.7083}}'
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Dive Master Package',
  'dive-master-package',
  'package',
  'A comprehensive 8-day PADI Divemaster course combined with guided reef exploration in the Red Sea.',
  'PADI Divemaster course + guided reef dives',
  1300.00, 8, 8, 8,
  '{"country": "EG", "city": "Dahab", "coordinates": {"lat": 28.4851, "lng": 34.5101}}'
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Yoga & Meditation Camp',
  'yoga-meditation-camp',
  'retreat',
  'A 7-day transformative retreat blending Hatha yoga, Vipassana meditation and sound healing in the hills of Bali.',
  'Transformative yoga & meditation in Bali',
  1450.00, 7, 16, 16,
  '{"country": "ID", "city": "Ubud", "coordinates": {"lat": -8.5069, "lng": 115.2625}}'
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Safari Adventure 10D',
  'safari-adventure-10d',
  'tour',
  'A 10-day wildlife safari spanning three national parks in Kenya, including the Maasai Mara during the Great Migration.',
  'Ultimate 10-day Kenya safari experience',
  1600.00, 10, 10, 10,
  '{"country": "KE", "city": "Nairobi", "coordinates": {"lat": -1.2921, "lng": 36.8219}}'
);

-- Demo customers
INSERT INTO customers (tenant_id, email, first_name, last_name, phone, nationality, tags, source, total_bookings, total_spent) VALUES
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'amira@surf-life.com', 'Amira', 'Mansouri', '+212 661 234 567', 'MA',
  ARRAY['vip','surf','repeat'], 'instagram', 4, 8240.00
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'tomas@diveworld.cz', 'Tomás', 'Krejčí', '+420 775 123 456', 'CZ',
  ARRAY['group','diving'], 'direct', 2, 10400.00
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'sofia.l@wellness.fr', 'Sofia', 'Laurent', '+33 6 12 34 56 78', 'FR',
  ARRAY['solo','yoga'], 'google', 1, 1450.00
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'rafael@adventura.mx', 'Rafael', 'Herrera', '+52 55 1234 5678', 'MX',
  ARRAY['group','safari','vip'], 'referral', 3, 22800.00
);
