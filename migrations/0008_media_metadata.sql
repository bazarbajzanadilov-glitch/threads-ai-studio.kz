-- Metadata required for server-side enforcement of the official Meta video
-- publishing profile. Values are measured locally by ffprobe/MP4Box before
-- the object is uploaded; the Worker never decodes large video files.
ALTER TABLE media_assets ADD COLUMN video_bitrate_bps INTEGER;
ALTER TABLE media_assets ADD COLUMN audio_bitrate_bps INTEGER;
ALTER TABLE media_assets ADD COLUMN audio_sample_rate_hz INTEGER;
