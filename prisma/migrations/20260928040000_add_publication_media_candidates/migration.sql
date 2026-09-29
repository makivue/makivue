ALTER TABLE `projects`
    ADD COLUMN `publication_cover_candidates` JSON NULL AFTER `cover_alt`,
    ADD COLUMN `publication_trailer_candidates` JSON NULL AFTER `trailer_duration`;
