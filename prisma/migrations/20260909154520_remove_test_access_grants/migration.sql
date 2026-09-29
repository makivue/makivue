-- Retire the obsolete test-access allowlist. Normal creation uses wallet balances.
-- IF EXISTS also supports environments where this obsolete table is already absent.
DROP TABLE IF EXISTS `test_access_grants`;
