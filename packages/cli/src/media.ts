import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type MediaPlatform = "threads";
export type MediaKind = "reel" | "video" | "image";

interface ProbeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly avg_frame_rate?: string;
  readonly r_frame_rate?: string;
  readonly duration?: string;
  readonly bit_rate?: string;
  readonly sample_rate?: string;
}

export interface ProbeResult {
  readonly streams?: ProbeStream[];
  readonly format?: {
    readonly format_name?: string;
    readonly duration?: string;
    readonly size?: string;
    readonly bit_rate?: string;
  };
}

export interface UploadMediaMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly duration_ms?: number;
  readonly fps?: number;
  readonly video_codec?: string;
  readonly audio_codec?: string;
  readonly video_bitrate_bps?: number;
  readonly audio_bitrate_bps?: number;
  readonly audio_sample_rate_hz?: number;
}

export interface ValidationIssue {
  readonly level: "error" | "warning";
  readonly code: string;
  readonly message: string;
}

export interface MediaValidation {
  readonly path: string;
  readonly platform: MediaPlatform;
  readonly kind: MediaKind;
  readonly valid: boolean;
  readonly metadata: {
    readonly size: number;
    readonly duration?: number;
    readonly format?: string;
    readonly videoCodec?: string;
    readonly audioCodec?: string;
    readonly width?: number;
    readonly height?: number;
    readonly fps?: number;
    readonly videoBitrateBps?: number;
    readonly audioBitrateBps?: number;
    readonly audioSampleRateHz?: number;
  };
  readonly issues: readonly ValidationIssue[];
}

export interface PrepareOptions {
  readonly input: string;
  readonly output: string;
  readonly kind: MediaKind;
  readonly fit: "contain" | "cover";
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly ffmpegPath?: string;
}

interface ToolResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runTool(command: string, args: readonly string[]): Promise<ToolResult> {
  return await new Promise<ToolResult>((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`${command} was not found. Install FFmpeg and ensure ${command} is on PATH.`));
      } else {
        reject(error);
      }
    });
    child.once("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}

function parseNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? number : undefined;
}

function frameRate(value: string | undefined): number | undefined {
  if (!value || value === "0/0") return undefined;
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return numerator / denominator;
}

export function uploadMetadataFromProbe(
  probe: ProbeResult,
  kind: "image" | "video"
): UploadMediaMetadata {
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = parseNumber(probe.format?.duration) ?? parseNumber(video?.duration);
  const fps = frameRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  const videoBitrate = parseNumber(video?.bit_rate) ?? parseNumber(probe.format?.bit_rate);
  const audioBitrate = parseNumber(audio?.bit_rate);
  const audioSampleRate = parseNumber(audio?.sample_rate);
  return {
    ...(video?.width !== undefined ? { width: video.width } : {}),
    ...(video?.height !== undefined ? { height: video.height } : {}),
    ...(kind === "video" && duration !== undefined
      ? { duration_ms: Math.max(0, Math.round(duration * 1000)) }
      : {}),
    ...(kind === "video" && fps !== undefined ? { fps } : {}),
    ...(kind === "video" && video?.codec_name ? { video_codec: video.codec_name } : {}),
    ...(kind === "video" && audio?.codec_name ? { audio_codec: audio.codec_name } : {}),
    ...(kind === "video" && videoBitrate !== undefined ? { video_bitrate_bps: Math.round(videoBitrate) } : {}),
    ...(kind === "video" && audioBitrate !== undefined ? { audio_bitrate_bps: Math.round(audioBitrate) } : {}),
    ...(kind === "video" && audioSampleRate !== undefined ? { audio_sample_rate_hz: Math.round(audioSampleRate) } : {})
  };
}

export async function probeUploadMetadata(
  inputPath: string,
  kind: "image" | "video",
  ffprobePath?: string
): Promise<UploadMediaMetadata> {
  const { probe } = await probeMedia(inputPath, ffprobePath);
  return uploadMetadataFromProbe(probe, kind);
}

function issue(
  issues: ValidationIssue[],
  level: ValidationIssue["level"],
  code: string,
  message: string
): void {
  issues.push({ level, code, message });
}

export async function probeMedia(
  inputPath: string,
  ffprobePath = "ffprobe"
): Promise<{ probe: ProbeResult; size: number }> {
  const absolutePath = resolve(inputPath);
  const file = await stat(absolutePath);
  if (!file.isFile()) throw new Error(`${absolutePath} is not a regular file`);
  const result = await runTool(ffprobePath, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    absolutePath
  ]);
  return { probe: JSON.parse(result.stdout) as ProbeResult, size: file.size };
}

export function isUploadReadyMp4(path: string, formatName: string | undefined): boolean {
  return extname(path).toLowerCase() === ".mp4" && (formatName ?? "").split(",").includes("mp4");
}

export async function validateMedia(
  inputPath: string,
  platform: MediaPlatform,
  kind: MediaKind,
  ffprobePath?: string
): Promise<MediaValidation> {
  const path = resolve(inputPath);
  const { probe, size } = await probeMedia(path, ffprobePath);
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = parseNumber(probe.format?.duration) ?? parseNumber(video?.duration);
  const fps = frameRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  const videoBitrate = parseNumber(video?.bit_rate) ?? parseNumber(probe.format?.bit_rate);
  const audioBitrate = parseNumber(audio?.bit_rate);
  const audioSampleRate = parseNumber(audio?.sample_rate);
  const format = probe.format?.format_name;
  const issues: ValidationIssue[] = [];

  if (size === 0) issue(issues, "error", "EMPTY_FILE", "The media file is empty.");
  if (size > 1_000_000_000) {
    issue(issues, "error", "FILE_TOO_LARGE", "Meta publishing accepts video files up to 1 GB.");
  }

  if (kind === "image") {
    if (!video) issue(issues, "error", "NO_IMAGE_STREAM", "No image stream was found.");
    if (size > 8_000_000) issue(issues, "error", "IMAGE_TOO_LARGE", "Meta image publishing accepts files up to 8 MB.");
    if (video && !["mjpeg", "png", "webp"].includes(video.codec_name ?? "")) {
      issue(issues, "error", "THREADS_IMAGE_FORMAT", "Threads API image publishing requires JPEG, PNG, or WebP.");
    }
    if (video?.width && video.height) {
      const aspect = video.width / video.height;
      if (video.width < 320 || video.width > 1_440) {
        issue(issues, "error", "IMAGE_WIDTH", "Meta image width must be between 320 and 1440 pixels.");
      }
      if (Math.max(aspect, 1 / aspect) > 10) {
        issue(issues, "error", "THREADS_IMAGE_ASPECT", "Threads image aspect ratio must not exceed 10:1 in either direction.");
      }
    }
  } else {
    if (!video) issue(issues, "error", "NO_VIDEO_STREAM", "No video stream was found.");
    if (video && !["h264", "hevc"].includes(video.codec_name ?? "")) {
      issue(issues, "error", "UNSUPPORTED_VIDEO_CODEC", "Use H.264 or HEVC video.");
    }
    if (audio && audio.codec_name !== "aac") {
      issue(issues, "error", "UNSUPPORTED_AUDIO_CODEC", "Use AAC audio or remove the audio stream.");
    }
    if (!video?.width || !video.height) {
      issue(issues, "error", "VIDEO_DIMENSIONS_UNKNOWN", "Video dimensions could not be read.");
    } else {
      if (video.width > 1_920) {
        issue(issues, "error", "VIDEO_WIDTH", "Meta publishing accepts at most 1920 horizontal pixels.");
      }
      const aspect = video.width / video.height;
      if (platform === "threads" && Math.max(aspect, 1 / aspect) > 10) {
        issue(issues, "error", "THREADS_VIDEO_ASPECT", "Threads video aspect ratio must not exceed 10:1 in either direction.");
      }
    }
    if (videoBitrate === undefined || videoBitrate <= 0) {
      issue(issues, "error", "VIDEO_BITRATE_UNKNOWN", "Video bitrate could not be read; remux or re-encode the file.");
    } else if (videoBitrate > 25_000_000) {
      issue(issues, "error", "VIDEO_BITRATE", "Video bitrate must not exceed 25 Mbps.");
    }
    if (audio) {
      if (audioSampleRate === undefined || audioSampleRate <= 0) {
        issue(issues, "error", "AUDIO_SAMPLE_RATE_UNKNOWN", "AAC sample rate could not be read.");
      } else if (audioSampleRate !== 48_000) {
        issue(issues, "error", "AUDIO_SAMPLE_RATE", "Meta publishing requires AAC audio at 48 kHz.");
      }
      if (audioBitrate === undefined || audioBitrate <= 0) {
        issue(issues, "error", "AUDIO_BITRATE_UNKNOWN", "AAC bitrate could not be read.");
      } else if (audioBitrate > 128_000) {
        issue(issues, "error", "AUDIO_BITRATE", "Audio bitrate must not exceed 128 kbps.");
      }
    }
    if (!isUploadReadyMp4(path, format)) {
      issue(
        issues,
        "error",
        "UPLOAD_PROFILE_REQUIRES_MP4",
        "The publisher accepts upload-ready MP4 video only. Run prepare and write the result to a .mp4 file."
      );
    }
    if (duration === undefined || duration <= 0) {
      issue(issues, "error", "INVALID_DURATION", "Video duration could not be read.");
    }
    if (duration !== undefined && duration > 300) {
      issue(issues, "error", "THREADS_DURATION", "Threads API video must be no longer than 5 minutes.");
    }
    if (fps === undefined) {
      issue(issues, "error", "FRAME_RATE_UNKNOWN", "Video frame rate could not be read.");
    } else if (fps < 23 || fps > 60) {
      issue(issues, "error", "FRAME_RATE", "Frame rate must be between 23 and 60 FPS.");
    }
    if (video?.width && video.height) {
      const aspect = video.width / video.height;
      if (kind === "reel" && Math.abs(aspect - 9 / 16) > 0.02) {
        issue(issues, "warning", "REEL_ASPECT", "9:16 is recommended for full-screen Reels.");
      }
    }
  }

  return {
    path,
    platform,
    kind,
    valid: !issues.some((entry) => entry.level === "error"),
    metadata: {
      size,
      ...(duration !== undefined ? { duration } : {}),
      ...(format ? { format } : {}),
      ...(video?.codec_name ? { videoCodec: video.codec_name } : {}),
      ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
      ...(video?.width !== undefined ? { width: video.width } : {}),
      ...(video?.height !== undefined ? { height: video.height } : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(videoBitrate !== undefined ? { videoBitrateBps: Math.round(videoBitrate) } : {}),
      ...(audioBitrate !== undefined ? { audioBitrateBps: Math.round(audioBitrate) } : {}),
      ...(audioSampleRate !== undefined ? { audioSampleRateHz: Math.round(audioSampleRate) } : {})
    },
    issues
  };
}

export function prepareArguments(options: PrepareOptions): readonly string[] {
  const overwrite = options.force ? "-y" : "-n";
  if (options.kind === "image") {
    return [
      "-hide_banner",
      "-loglevel",
      "warning",
      overwrite,
      "-i",
      resolve(options.input),
      "-map_metadata",
      "-1",
      "-vf",
      "scale=1440:1440:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      resolve(options.output)
    ];
  }
  const filter =
    options.fit === "cover"
      ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
      : "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1";
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    overwrite,
    "-i",
    resolve(options.input),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-map_metadata",
    "-1",
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    resolve(options.output)
  ];
}

export async function prepareMedia(options: PrepareOptions): Promise<readonly string[]> {
  const args = prepareArguments(options);
  if (!options.dryRun) await runTool(options.ffmpegPath ?? "ffmpeg", args);
  return args;
}
