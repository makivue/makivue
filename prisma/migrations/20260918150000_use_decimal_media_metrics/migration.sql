-- Media durations use seconds with microsecond precision; quality scores retain six decimals.
ALTER TABLE `projects`
    MODIFY COLUMN `trailer_duration` DECIMAL(18,6) NULL COMMENT '预告片时长（秒）';

ALTER TABLE `generations`
    MODIFY COLUMN `planned_duration` DECIMAL(18,6) NULL COMMENT '计划生成时长（秒）',
    MODIFY COLUMN `actual_duration` DECIMAL(18,6) NULL COMMENT '实际生成时长（秒）';

ALTER TABLE `quality_reviews`
    MODIFY COLUMN `score` DECIMAL(10,6) NOT NULL COMMENT '质量评分';

ALTER TABLE `video_merges`
    MODIFY COLUMN `duration` DECIMAL(18,6) NULL COMMENT '合并视频时长（秒）';
