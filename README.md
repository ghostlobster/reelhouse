# Reelhouse 🚀

> **Hybrid CDN & Object Storage Asset Hub for On-Premise Servers**  
> Brand-agnostic management, metrics analytics, video duration extraction, seamless media previews, and on-premise local disk mirroring.

---

## 🌟 Key Capabilities

- **Brand-Agnostic Object Storage Support**:
  - **AWS S3**: Standard regions and S3 buckets.
  - **Cloudflare R2**: Zero-egress endpoint integration (`https://<account-id>.r2.cloudflarestorage.com`).
  - **MinIO (Self-Hosted)**: Path-style addressing (`forcePathStyle: true`) for on-premise deployments.
  - **KeyCDN**: Storage zones over SFTP (host, port, username, password); set the pull zone as the Public CDN Domain for direct previews.
  - **Wasabi & Backblaze B2**: Flat-rate hot cloud storage compatibility.
  - **Generic S3 / HTTP Origin**: Any S3-compatible service or CDN edge origin.

- **Configured Directly from the UI**:
  - Connect and manage multiple storage sources with custom friendly labels.
  - Pre-built provider templates with 1-click configuration.
  - Integrated **"Test Connection"** button to verify authentication and bucket reachability before saving.
  - Configurable on-premise target directory (e.g., `E:\Storage\cdn-mirror` or `./downloads`).
  - Built-in **Read-Only Mode** protection to safeguard cloud assets from accidental modification.

- **Rich File Previews for Common Formats**:
  - **Video (`.mp4`, `.mkv`, `.mov`, `.webm`, `.avi`)**: High-performance HTML5 player streaming over an HTTP Range Proxy with instant seeking and scrub controls.
  - **Audio (`.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`)**: Audio player with scrub controls and duration display.
  - **Images (`.png`, `.jpg`, `.webp`, `.svg`, `.gif`, `.avif`)**: Interactive viewer with zoom-in, zoom-out, pan, rotate, and dimensions info.
  - **Code & Text (`.json`, `.js`, `.py`, `.md`, `.txt`, `.yaml`, `.csv`)**: Formatted monospace viewer with line numbers and 1-click clipboard copy.
  - **Documents (`.pdf`)**: Native iframe previewer with download fallback.

- **Deep Scanning & Comprehensive Metrics**:
  - **Total Video Play Time (Primary Metric)**:
    - Sum of play time across all video assets, formatted into days, hours, minutes, and seconds (e.g., `7h 51m 38s`).
    - Remote video duration extraction via HTTP Range header probing (reads container `mvhd`/`moov` and `EBML` tags without having to download multi-gigabyte video files!).
    - Video resolution breakdown: 4K UHD (2160p), 2K QHD (1440p), Full HD (1080p), HD (720p), SD (480p/360p).
    - Video duration tiers: `< 1 min` (Shorts), `1-5 mins` (Clips), `5-15 mins` (Standard), `15-30 mins` (Medium), `30-60 mins` (Episodes), `> 1 hour` (Feature/Movies).
    - Video container format and codec distribution (H.264, HEVC, VP9, ProRes; MP4, MKV, MOV, WebM).
    - Longest videos leaderboard with 1-click playback.
  - **Size-Related Metrics**:
    - Total library size and object count.
    - Average and median file sizes.
    - Size distribution histogram (`<100KB`, `100KB-1MB`, `1MB-10MB`, `10MB-100MB`, `100MB-1GB`, `1GB-10GB`, `>10GB`).
    - Top 20 largest files leaderboard with instant preview and download.
    - Estimated cloud storage cost per month based on provider rates.
  - **Time-Related Metrics**:
    - Monthly ingestion timeline chart (upload volume and object counts over time).
    - Recency age buckets (`Past 24 Hours`, `Past 7 Days`, `Past 30 Days`, `1-3 Months`, `3-6 Months`, `6-12 Months`, `> 1 Year`).
    - Oldest and newest ingested file identification.
  - **On-Premise Box Synchronization Status**:
    - Remote vs. local volume and file count comparison.
    - Percentage of remote assets synced locally on the box.
    - Missing files count and remaining download volume.
    - Free disk space meter on the on-premise drive.

- **Background Download Engine & Folder Structure Preservation**:
  - **Preserves Full Folder Hierarchy**: All downloaded files maintain their exact nested folder structure on the on-premise box local disk (e.g., `<source.localPath>/videos/courses/module-01/lesson.mp4`).
  - **Date Range Filtering**: Download files based on their last modified timestamps with quick presets (`Since Last Checkpoint`, `Past 24 Hours`, `Past 7 Days`, `Past 30 Days`, `All Time`, or custom datetime-local ranges).
  - **Last Download Date Checkpoints**: Sources track their last download checkpoint timestamp. When you trigger "Since Last Checkpoint", it automatically resumes from that moment, preventing redundant downloads. Checkpoints can be updated automatically or adjusted manually.
  - **Full Action History & Audit Logs**: Every download run is preserved as a structured session record with filter parameters, file counts, and byte tallies. Click into any session to see every file that was downloaded, exact disk paths, and completion timestamps.
  - Concurrency limiter with streaming chunk writes to local disk, live progress bars, speed telemetry (MB/s), and transfer queue drawer.

---

## 🛠️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       React + Vite UI                       │
│    (Tailwind CSS, Lucide Icons, Recharts, Video Streamer)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP REST & WebSocket (/ws)
┌──────────────────────────────▼──────────────────────────────┐
│                    Node.js Express Server                   │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │   Scanner Engine      │       │   Download Manager    │  │
│  │  (HTTP Range Prober)  │       │   (Concurrency Queue) │  │
│  └───────────┬───────────┘       └───────────┬───────────┘  │
│              │                               │              │
│  ┌───────────▼───────────┐       ┌───────────▼───────────┐  │
│  │   PostgreSQL 17       │       │   Streaming Proxy     │  │
│  │   (node-postgres)     │       │   (Range 206 / Seek)  │  │
│  └───────────────────────┘       └───────────────────────┘  │
└──────────────┬───────────────────────────────┬──────────────┘
               │ S3 Protocol                   │ Atomic Writes
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│ CDN / Object Store Provider │ │   Local On-Premise Box Disk │
│ (AWS, R2, MinIO, KeyCDN...) │ │   (e.g., E:\Storage\mirror) │
└─────────────────────────────┘ └─────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Start Full Application (Docker)

Starts Postgres and the app, serving both the REST API and the frontend dashboard:

```bash
docker compose up -d --build
```

Open your browser to: **`http://127.0.0.1:3010`**

On first start, data from an earlier SQLite-based install (`data/reelhouse.db`) is imported into Postgres automatically; the SQLite file is kept as a backup.

Without Docker for the app itself: `docker compose up -d postgres`, then `npm run server` and open **`http://localhost:3001`**.

### 2. Start in Development Mode (Live HMR)

Runs both the backend API (port 3001) and Vite frontend (port 5173 with proxy). Needs Postgres running (`docker compose up -d postgres`):

```bash
npm run dev
```

Open your browser to: **`http://localhost:5173`**

### 3. Immediate 1-Click Demo Testing

If you don't have S3 credentials immediately available, click the **"Load Demo CDN Library"** button in the UI header to populate realistic media assets, 4K videos, audio tracks, and documents to explore all charts, metrics, and video previews.

---

## 📊 Defined Metrics Reference

| Metric Group | Metric Name | Description |
| :--- | :--- | :--- |
| **Video** | `totalVideoDuration` | Total playback time of all remote and local videos combined (formatted into `Xd Yh Zm Ws`). |
| **Video** | `avgVideoDuration` | Average duration per video file in the bucket. |
| **Video** | `resolutionBuckets` | Classification into 4K UHD (2160p), 2K (1440p), 1080p FHD, 720p HD, and SD. |
| **Video** | `durationBuckets` | Distribution across `<1m`, `1-5m`, `5-15m`, `15-30m`, `30-60m`, and `>1h`. |
| **Video** | `containerFormats` | File counts and storage volume for `.mp4`, `.mkv`, `.mov`, `.webm`, etc. |
| **Video** | `videoCodecs` | Distribution across H.264 (AVC), HEVC (H.265), VP9, ProRes, etc. |
| **Storage & Size** | `totalSize` | Total storage footprint in bytes, formatted (MB, GB, TB). |
| **Storage & Size** | `sizeBuckets` | Histogram across 7 logarithmic size tiers (<100KB to >10GB). |
| **Storage & Size** | `largestFiles` | Ranked leaderboard of largest individual objects. |
| **Storage & Size** | `costEstimates` | Estimated monthly cloud storage cost based on provider rate ($/GB). |
| **Time & Ingestion**| `monthlyIngestion` | Aggregated timeline showing monthly volume and upload activity. |
| **Time & Ingestion**| `ageBuckets` | Recency distribution (<24h, 7d, 30d, 1-3mo, 3-6mo, 6-12mo, >1y). |
| **On-Premise Box** | `syncPercentage` | Percentage of remote library mirrored on local on-premise disk. |
| **On-Premise Box** | `missingLocalSize` | Storage volume needed to complete full local mirroring. |
| **On-Premise Box** | `localDiskFreeSpace` | Available storage space on the on-premise drive. |

---

## 🔒 Security & Safety

- **Read-Only by Default**: Designed specifically for read-only browsing, inspection, and one-way downloads from CDN/S3 to the on-premise box.
- **Credential Storage**: Credentials are stored in the local Postgres database (Docker volume `reelhouse-pgdata`, reachable only from this machine) on your on-premise box, never sent to third parties. They are stored in plain text, so protect access to that volume and to database backups.
- **Range-Based Media Probe**: Remote video durations are extracted by reading small atom headers over HTTP Range requests, avoiding full video file downloads during scans.
