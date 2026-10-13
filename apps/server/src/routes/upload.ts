import path from "node:path";
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { BASE_URL, UPLOADS_DIR } from "../config.js";

export const uploadRouter = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WebP images are supported"));
    }
  }
});

uploadRouter.post("/", (req: Request, res: Response) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: { message: "No image file provided in form field 'image'" } });
      return;
    }

    const filename = req.file.filename;
    const publicUrl = `${BASE_URL}/uploads/${filename}`;

    res.status(201).json({
      filename,
      url: publicUrl,
      size_bytes: req.file.size,
      mime_type: req.file.mimetype
    });
  });
});
