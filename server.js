const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

// ── FIND YT-DLP ──
function getYtDlpPath() {
  const candidates = [
    process.env.YTDLP_PATH,
    '/home/render/.local/bin/yt-dlp',
    '/opt/render/.local/bin/yt-dlp',
    path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    './yt-dlp',
    'yt-dlp'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (p === 'yt-dlp' || fs.existsSync(p)) return p; } catch {}
  }
  return 'yt-dlp';
}

function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    console.log('CMD:', cmd.substring(0, 120));
    exec(cmd, {
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env, HOME: process.env.HOME || '/tmp' }
    }, (err, stdout, stderr) => {
      if (err) { console.error('ERR:', stderr || err.message); reject(new Error(stderr || err.message)); return; }
      resolve(stdout.trim());
    });
  });
}

function runYtDlp(args) {
  const p = getYtDlpPath();
  return runCmd(`"${p}" ${args}`);
}

function fmtNum(n) {
  if (!n) return null;
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}

function fmtDur(s) {
  if (!s) return null;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=s%60;
  if (h>0) return h+':'+String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');
  return m+':'+String(ss).padStart(2,'0');
}

function checkUrl(url) {
  try {
    const u = new URL(url);
    return ['youtube.com','www.youtube.com','youtu.be','m.youtube.com'].includes(u.hostname) ? url : null;
  } catch { return null; }
}

// ── ROUTES ──
app.get('/', (req, res) => res.json({ status: 'ok', service: 'GrabVid API', version: '1.0.0' }));

// Debug endpoint — visit /debug to see yt-dlp path and version
app.get('/debug', async (req, res) => {
  const ytPath = getYtDlpPath();
  let version = 'unknown', which = 'unknown';
  try { version = await runYtDlp('--version'); } catch(e) { version = 'ERROR: '+e.message; }
  try { which = await runCmd('which yt-dlp 2>/dev/null || echo "not in PATH"'); } catch(e) { which = e.message; }
  // Find all yt-dlp binaries
  let findResult = '';
  try { findResult = await runCmd('find /home /opt /usr -name "yt-dlp" 2>/dev/null | head -10'); } catch {}
  res.json({ ytPath, version, which, findResult, HOME: process.env.HOME, PATH: process.env.PATH?.substring(0,300) });
});

// GET /info?url=...
app.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const safe = checkUrl(url);
  if (!safe) return res.status(400).json({ error: 'Only YouTube URLs supported.' });

  try {
    const out = await runYtDlp(`--dump-json --no-playlist --no-warnings --no-check-certificates "${safe}"`);
    const data = JSON.parse(out);
    const id = data.id;
    const formats = [];
    const seen = new Set();

    if (data.formats) {
      // Best: combined mp4 with video+audio
      data.formats
        .filter(f => f.ext==='mp4' && f.vcodec && f.vcodec!=='none' && f.acodec && f.acodec!=='none' && f.height)
        .sort((a,b) => (b.height||0)-(a.height||0))
        .forEach(f => {
          const lbl = f.height+'p';
          if (seen.has(lbl)) return;
          seen.add(lbl);
          formats.push({ format_id:f.format_id, label:lbl, ext:'mp4', type:'video', height:f.height, filesize:f.filesize||f.filesize_approx||null, url:f.url });
        });

      // Fallback: any video format
      if (!formats.length) {
        data.formats
          .filter(f => f.vcodec && f.vcodec!=='none' && f.height)
          .sort((a,b) => (b.height||0)-(a.height||0))
          .slice(0,4)
          .forEach(f => {
            const lbl = f.height+'p';
            if (seen.has(lbl)) return;
            seen.add(lbl);
            formats.push({ format_id:f.format_id, label:lbl, ext:f.ext||'mp4', type:'video', height:f.height, filesize:f.filesize||null, url:f.url });
          });
      }

      // Audio
      const aud = data.formats
        .filter(f => f.acodec && f.acodec!=='none' && (!f.vcodec||f.vcodec==='none'))
        .sort((a,b) => (b.abr||0)-(a.abr||0));
      if (aud.length) {
        const b = aud[0];
        formats.push({ format_id:b.format_id, label:'MP3 Audio', ext:'mp3', type:'audio', abr:b.abr||128, filesize:b.filesize||null, url:b.url });
      }
    }

    return res.json({
      success: true,
      video: {
        id, title:data.title,
        thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`,
        duration:fmtDur(data.duration), duration_seconds:data.duration,
        channel:data.uploader||data.channel,
        view_count:fmtNum(data.view_count),
        is_short:!!(data.duration&&data.duration<=60)
      },
      formats: formats.slice(0,5)
    });

  } catch(err) {
    const msg = err.message||'';
    console.error('Info error:', msg.substring(0,300));
    if (msg.includes('Private')) return res.status(400).json({ error:'This video is private.' });
    if (msg.includes('not available')) return res.status(400).json({ error:'Video not available in your region.' });
    if (msg.includes('age')) return res.status(400).json({ error:'Age-restricted video.' });
    return res.status(500).json({ error:'Could not fetch video info.', detail:msg.substring(0,300) });
  }
});

// GET /download?url=...&format_id=...
app.get('/download', async (req, res) => {
  const { url, format_id } = req.query;
  if (!url||!format_id) return res.status(400).json({ error:'url and format_id required' });
  const safe = checkUrl(url);
  if (!safe) return res.status(400).json({ error:'Invalid URL' });
  try {
    const dlUrl = await runYtDlp(`--format "${format_id}" --get-url --no-playlist --no-warnings --no-check-certificates "${safe}"`);
    if (!dlUrl||!dlUrl.startsWith('http')) throw new Error('No URL returned');
    return res.json({ success:true, download_url:dlUrl });
  } catch(err) {
    return res.status(500).json({ error:'Could not get download link.', detail:err.message.substring(0,200) });
  }
});

app.listen(PORT, () => {
  console.log(`GrabVid API on port ${PORT}`);
  console.log(`yt-dlp: ${getYtDlpPath()}`);
});
