-- projects.novel 存的是所有章节拼接后的整本小说，60 集会超过 TEXT (65KB) 上限。
-- episodes.chapter_content / episodes.script 单集单值虽然目前接近 TEXT 上限，
-- 但预留空间，长剧本也不会溢出。
ALTER TABLE `projects` MODIFY `novel` LONGTEXT NULL;
ALTER TABLE `episodes` MODIFY `chapter_content` LONGTEXT NULL;
ALTER TABLE `episodes` MODIFY `script` LONGTEXT NULL;
