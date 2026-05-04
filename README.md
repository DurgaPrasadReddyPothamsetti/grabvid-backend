# GrabVid Backend — Deployment Guide

## How It Works
1. User pastes YouTube URL on your frontend
2. Frontend calls your API: `GET /info?url=...`
3. Your server runs yt-dlp to extract direct CDN URLs from YouTube
4. Returns video info + download URLs to browser
5. Browser downloads video **directly from YouTube's CDN** — your server transfers ZERO video data
6. Result: unlimited users, zero bandwidth cost on your server

---

## Deploy on Render.com (FREE — 15 minutes)

### Step 1 — Create GitHub Repository
1. Go to github.com → Sign up / Log in
2. Click "New repository"
3. Name it `grabvid-backend`
4. Set to **Public**
5. Click "Create repository"

### Step 2 — Upload Backend Files
Upload these 3 files to your repository:
- `server.js`
- `package.json`
- `render.yaml`

Either use GitHub's web interface (drag & drop) or:
```bash
git init
git add .
git commit -m "Initial backend"
git remote add origin https://github.com/YOURUSERNAME/grabvid-backend.git
git push -u origin main
```

### Step 3 — Deploy on Render.com
1. Go to **render.com** → Sign up free (use GitHub login)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account
4. Select the `grabvid-backend` repository
5. Render will auto-detect the `render.yaml` config
6. Click **"Create Web Service"**
7. Wait ~3 minutes for build to complete

### Step 4 — Get Your API URL
After deployment, Render gives you a URL like:
```
https://grabvid-api.onrender.com
```
**Copy this URL** — you need it for the frontend.

### Step 5 — Update Frontend
Open `frontend/index.html`
Find this line near the top of the `<script>` section:
```javascript
const API_BASE = 'https://YOUR-RENDER-URL.onrender.com';
```
Replace with your actual Render URL:
```javascript
const API_BASE = 'https://grabvid-api.onrender.com';
```

---

## Deploy Frontend

### Option A — Netlify (Recommended, Free)
1. Go to netlify.com
2. Drag the `frontend` folder onto Netlify
3. Done — live in 30 seconds
4. Add your custom domain (grabvid.com etc.) in Netlify settings

### Option B — GitHub Pages (Free)
1. Create repo `grabvid-frontend`
2. Upload frontend files
3. Settings → Pages → Deploy from main branch

---

## Important Notes

### Render Free Tier
- **Spins down** after 15 minutes of inactivity
- First request after spin-down takes ~10-20 seconds
- After that, responses are fast (~2-3 seconds)
- **Upgrade to $7/month Starter plan** when you have regular traffic — stays always on

### yt-dlp Updates
YouTube changes its systems regularly. If downloads stop working:
1. Go to your Render dashboard
2. Click "Manual Deploy" → "Deploy Latest Commit"
3. This reinstalls the latest yt-dlp which fixes YouTube changes

### CORS
The backend allows all origins (`*`) by default.
In production, change this line in server.js:
```javascript
origin: '*'
// Change to:
origin: 'https://your-frontend-domain.com'
```

---

## API Reference

### GET /
Health check
```json
{ "status": "ok", "service": "GrabVid API" }
```

### GET /info?url={youtube_url}
Get video info and available formats
```json
{
  "success": true,
  "video": {
    "id": "dQw4w9WgXcQ",
    "title": "Video Title",
    "thumbnail": "https://img.youtube.com/vi/...",
    "duration": "3:32",
    "channel": "Channel Name",
    "view_count": "1.2B",
    "is_short": false
  },
  "formats": [
    { "format_id": "137", "label": "1080p", "ext": "mp4", "type": "video", "url": "https://..." },
    { "format_id": "136", "label": "720p",  "ext": "mp4", "type": "video", "url": "https://..." },
    { "format_id": "135", "label": "480p",  "ext": "mp4", "type": "video", "url": "https://..." },
    { "format_id": "140", "label": "MP3 Audio", "ext": "mp3", "type": "audio", "url": "https://..." }
  ]
}
```

### GET /download?url={youtube_url}&format_id={format_id}
Get fresh direct download URL (YouTube CDN URLs expire, use this for final download)
```json
{
  "success": true,
  "download_url": "https://rr1---sn-xxx.googlevideo.com/..."
}
```

---

## Cost Summary
- Render.com free tier: **$0/month**
- Frontend hosting (Netlify): **$0/month**
- yt-dlp: **Free, open source**
- **Total: $0/month** for moderate traffic
- Upgrade to Render Starter ($7/month) when traffic grows
