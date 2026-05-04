const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(cors({
  origin: '*', // In production set to your frontend domain
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// ── HELPERS ──
function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    const allowed = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
    if (!allowed.includes(u.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    // Try multiple paths — ./yt-dlp for Render, yt-dlp for local/global install
    const ytdlpPath = process.env.YTDLP_PATH ||
      (fs.existsSync(path.join(__dirname, 'yt-dlp')) ? path.join(__dirname, 'yt-dlp') : 'yt-dlp');
    const cmd = `${ytdlpPath} ${args}`;

    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function formatNumber(n) {
  if (!n) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ── ROUTES ──

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'GrabVid API', version: '1.0.0' });
});

// GET /info?url=... — returns video metadata + available formats
app.get('/info', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) {
    return res.status(400).json({ error: 'Invalid or unsupported URL. Only YouTube URLs are supported.' });
  }

  try {
    // Get video info as JSON
    const output = await runYtDlp(
      `--dump-json --no-playlist --no-warnings "${safeUrl}"`
    );

    const data = JSON.parse(output);

    // Extract video ID for thumbnail
    const videoId = data.id;
    const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // Build clean format list
    const formats = [];
    const seen = new Set();

    if (data.formats) {
      // Video + audio combined formats (best for users)
      const combined = data.formats.filter(f =>
        f.ext === 'mp4' &&
        f.vcodec && f.vcodec !== 'none' &&
        f.acodec && f.acodec !== 'none' &&
        f.height
      );

      // Sort by height descending
      combined.sort((a, b) => (b.height || 0) - (a.height || 0));

      combined.forEach(f => {
        const label = `${f.height}p`;
        if (seen.has(label)) return;
        seen.add(label);

        formats.push({
          format_id: f.format_id,
          label: label,
          ext: 'mp4',
          type: 'video',
          height: f.height,
          filesize: f.filesize || f.filesize_approx || null,
          url: f.url
        });
      });

      // If no combined formats found, use best video + audio merged
      if (formats.length === 0) {
        const videoFormats = data.formats.filter(f =>
          f.vcodec && f.vcodec !== 'none' && f.height
        ).sort((a, b) => (b.height || 0) - (a.height || 0));

        videoFormats.slice(0, 4).forEach(f => {
          const label = `${f.height}p`;
          if (seen.has(label)) return;
          seen.add(label);
          formats.push({
            format_id: f.format_id,
            label: label,
            ext: f.ext || 'mp4',
            type: 'video',
            height: f.height,
            filesize: f.filesize || null,
            url: f.url
          });
        });
      }

      // Audio formats
      const audioFormats = data.formats.filter(f =>
        f.acodec && f.acodec !== 'none' &&
        (!f.vcodec || f.vcodec === 'none') &&
        (f.ext === 'm4a' || f.ext === 'webm' || f.ext === 'mp3')
      ).sort((a, b) => (b.abr || 0) - (a.abr || 0));

      if (audioFormats.length > 0) {
        const best = audioFormats[0];
        formats.push({
          format_id: best.format_id,
          label: `MP3 Audio`,
          ext: 'mp3',
          type: 'audio',
          abr: best.abr || 128,
          filesize: best.filesize || null,
          url: best.url
        });
      }
    }

    // Limit to top 5 formats
    const topFormats = formats.slice(0, 5);

    return res.json({
      success: true,
      video: {
        id: videoId,
        title: data.title,
        thumbnail: thumbnail,
        duration: formatDuration(data.duration),
        duration_seconds: data.duration,
        channel: data.uploader || data.channel,
        view_count: formatNumber(data.view_count),
        upload_date: data.upload_date,
        is_short: data.duration && data.duration <= 60,
      },
      formats: topFormats
    });

  } catch (err) {
    console.error('yt-dlp error:', err.message);

    // Handle specific errors
    if (err.message.includes('Private video')) {
      return res.status(400).json({ error: 'This video is private and cannot be downloaded.' });
    }
    if (err.message.includes('not available')) {
      return res.status(400).json({ error: 'This video is not available in your region or has been removed.' });
    }
    if (err.message.includes('age')) {
      return res.status(400).json({ error: 'Age-restricted videos cannot be downloaded.' });
    }

    return res.status(500).json({ error: 'Could not fetch video info. The video may be unavailable or restricted.' });
  }
});

// GET /download?url=...&format_id=... — returns direct download URL
app.get('/download', async (req, res) => {
  const { url, format_id } = req.query;

  if (!url || !format_id) {
    return res.status(400).json({ error: 'url and format_id are required' });
  }

  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Get the direct download URL for the specific format
    const directUrl = await runYtDlp(
      `--format "${format_id}" --get-url --no-playlist --no-warnings "${safeUrl}"`
    );

    if (!directUrl || !directUrl.startsWith('http')) {
      throw new Error('Could not get download URL');
    }

    return res.json({
      success: true,
      download_url: directUrl
    });

  } catch (err) {
    console.error('Download URL error:', err.message);
    return res.status(500).json({ error: 'Could not generate download link. Please try again.' });
  }
});

// GET /formats — returns supported resolutions info
app.get('/formats', (req, res) => {
  res.json({
    supported: ['1080p', '720p', '480p', '360p', 'MP3 Audio'],
    note: 'Available formats depend on the original video'
  });
});

// ── START ──
app.listen(PORT, () => {
  console.log(`GrabVid API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/`);
});
