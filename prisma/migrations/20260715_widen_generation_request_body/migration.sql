-- 图像生成会记录完整的提示词诊断信息；复杂连续性提示词可能超过 TEXT 的 64KB。
ALTER TABLE `generations` MODIFY `request_body` LONGTEXT NULL;
