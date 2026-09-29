ALTER TABLE `storyboards`
    ADD COLUMN `reference_video_assets` JSON NULL AFTER `actual_video_end_frame_url`;
