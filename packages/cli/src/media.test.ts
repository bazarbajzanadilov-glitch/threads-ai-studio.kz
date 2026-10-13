import { describe, expect, it } from "vitest";
import { isUploadReadyMp4, prepareArguments, uploadMetadataFromProbe } from "./media.js";

describe("prepareArguments", () => {
  it("builds a non-overwriting, fast-start Reel conversion", () => {
    const args = prepareArguments({
      input: "input.mp4",
      output: "output.mp4",
      kind: "reel",
      fit: "contain",
      force: false,
      dryRun: true
    });
    expect(args).toContain("-n");
    expect(args).toContain("+faststart");
    expect(args.join(" ")).toContain("pad=1080:1920");
    expect(args).toContain("libx264");
  });

  it("uses an explicit crop only when cover is selected", () => {
    const args = prepareArguments({
      input: "input.mov",
      output: "output.mp4",
      kind: "video",
      fit: "cover",
      force: true,
      dryRun: true
    });
    expect(args).toContain("-y");
    expect(args.join(" ")).toContain("crop=1080:1920");
  });

  it("normalizes ffprobe values for the upload API", () => {
    expect(
      uploadMetadataFromProbe(
        {
          format: { duration: "12.345", bit_rate: "8128000" },
          streams: [
            { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30000/1001", bit_rate: "8000000" },
            { codec_type: "audio", codec_name: "aac", bit_rate: "128000", sample_rate: "48000" }
          ]
        },
        "video"
      )
    ).toEqual({
      width: 1080,
      height: 1920,
      duration_ms: 12345,
      fps: 30000 / 1001,
      video_codec: "h264",
      audio_codec: "aac",
      video_bitrate_bps: 8_000_000,
      audio_bitrate_bps: 128_000,
      audio_sample_rate_hz: 48_000
    });
  });

  it("requires the approved MP4 upload profile even when FFprobe calls a MOV file mov/mp4", () => {
    expect(isUploadReadyMp4("ready.mp4", "mov,mp4,m4a,3gp,3g2,mj2")).toBe(true);
    expect(isUploadReadyMp4("raw.mov", "mov,mp4,m4a,3gp,3g2,mj2")).toBe(false);
    expect(isUploadReadyMp4("renamed.mp4", "matroska,webm")).toBe(false);
  });
});
