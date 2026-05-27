// Shared photo upload helpers — Phase 6.7
//
// Used by TIA depot.html (Damaged In Transit modal + Add Device modal when
// status = Damaged In Transit) for the damaged-claim photo upload pipeline.
//
// Pipeline (per photo):
//   1. HEIC → JPEG via heic2any (lazy-loaded from cdn.jsdelivr.net on demand).
//      iPhone defaults to HEIC and Canvas can't decode it directly.
//   2. Canvas resize to long-edge max 1600 px, JPEG @ 0.85 quality. The
//      re-encode also strips EXIF/GPS metadata as a privacy backstop in
//      case the server-side strip is bypassed.
//
// Exposes (on window via plain script-tag include):
//   - isHeicFile(file)              → boolean
//   - ensureHeic2AnyLoaded()        → Promise<void>
//   - resizeImageToJpeg(blob, max=1600, q=0.85) → Promise<Blob>
//
// IMS and TIA each ship their own byte-identical copy. Keep them in sync.
// When this file changes, bump the ?v= cache-bust on every HTML page that
// includes it.

function isHeicFile(file) {
    const name = (file.name || "").toLowerCase();
    return file.type === "image/heic" || file.type === "image/heif"
        || name.endsWith(".heic") || name.endsWith(".heif");
}

let _heic2anyLoading = null;
function ensureHeic2AnyLoaded() {
    if (window.heic2any) return Promise.resolve();
    if (_heic2anyLoading) return _heic2anyLoading;
    _heic2anyLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
        script.onload = () => resolve();
        script.onerror = () => {
            _heic2anyLoading = null;   // allow retry on next attempt
            reject(new Error("Failed to load heic2any library — check network / CSP"));
        };
        document.head.appendChild(script);
    });
    return _heic2anyLoading;
}

function resizeImageToJpeg(fileOrBlob, maxDim = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(fileOrBlob);
        img.onload = () => {
            let { width, height } = img;
            if (width >= height && width > maxDim) {
                height = Math.round(height * maxDim / width);
                width = maxDim;
            } else if (height > width && height > maxDim) {
                width = Math.round(width * maxDim / height);
                height = maxDim;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                if (blob) resolve(blob);
                else reject(new Error("Canvas toBlob returned null"));
            }, "image/jpeg", quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Image load failed"));
        };
        img.src = url;
    });
}
