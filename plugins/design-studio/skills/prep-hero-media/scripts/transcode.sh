#!/usr/bin/env bash
# Prepare hero media for the web with ffmpeg. Bash 3.2 compatible (stock macOS).
#
#   transcode.sh video <input> <out-dir> [--name hero] [--widths 1920,1280] [--poster-at 1.0]
#                [--crf 26] [--maxrate 2500k] [--start 0] [--duration <s>] [--fps 30]
#   transcode.sh image <input> <out-dir> [--name portrait] [--widths 640,1280,1920] [--quality 78]
#   transcode.sh probe <input>
#
# video: per width, <name>-<w>.mp4 (H.264 High, yuv420p, faststart) and <name>-<w>.webm (VP9),
#        both without audio and with a capped bitrate, plus <name>-poster.webp and <name>-poster.jpg
#        cut at --poster-at seconds from the largest width. Widths above the source are skipped.
# image: per width, <name>-<w>.webp and <name>-<w>.avif (when ffmpeg has an AV1 encoder), never
#        upscaled; warns when the source is under twice the largest width.
# probe: prints width, height, duration, codecs, audio presence and size.
# The input is never modified or deleted. Prints a before/after size table.
set -euo pipefail

die() { echo "transcode.sh: $*" >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found (macOS: brew install ffmpeg)"
command -v ffprobe >/dev/null 2>&1 || die "ffprobe not found (it ships with ffmpeg)"

size_of() { wc -c <"$1" | tr -d ' '; }
human() {
  awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f MB", b / 1048576; else printf "%d KB", (b + 512) / 1024 }'
}
dims() { ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$1" | head -1; }
# Read the lists whole: grep -q closing the pipe early would fail the pipeline under pipefail.
encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
muxers=$(ffmpeg -hide_banner -muxers 2>/dev/null || true)
has_encoder() { case "$encoders" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
has_muxer() { case "$muxers" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

probe() {
  local in="$1"
  [ -f "$in" ] || die "no such file: $in"
  echo "file:     $in"
  echo "size:     $(human "$(size_of "$in")")"
  echo "video:    $(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,bit_rate -of default=nw=1:nk=0 "$in" | tr '\n' ' ')"
  local audio
  audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$in" | head -1)
  echo "audio:    ${audio:-none}"
  echo "duration: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in" 2>/dev/null || echo n/a)s"
}

mode="${1:-}"
[ -n "$mode" ] || die "usage: transcode.sh video|image|probe <input> [<out-dir>] [options]"
shift
in="${1:-}"
[ -n "$in" ] && [ -f "$in" ] || die "input file missing: ${in:-<none>}"
shift

if [ "$mode" = "probe" ]; then
  probe "$in"
  exit 0
fi

out="${1:-}"
[ -n "$out" ] || die "output directory missing"
shift
mkdir -p "$out"

name="" widths="" poster_at="1.0" crf="26" maxrate="2500k" start="0" duration="" fps="30" quality="78"
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --widths) widths="$2"; shift 2 ;;
    --poster-at) poster_at="$2"; shift 2 ;;
    --crf) crf="$2"; shift 2 ;;
    --maxrate) maxrate="$2"; shift 2 ;;
    --start) start="$2"; shift 2 ;;
    --duration) duration="$2"; shift 2 ;;
    --fps) fps="$2"; shift 2 ;;
    --quality) quality="$2"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

src_dims=$(dims "$in")
src_w=${src_dims%x*}
src_h=${src_dims#*x}
[ -n "$src_w" ] || die "could not read the dimensions of $in"
in_size=$(size_of "$in")
made=""

# Widths in descending order, keeping only those the source can fill (always at least one).
pick_widths() {
  local list="$1" kept=""
  for w in $(echo "$list" | tr ',' '\n' | sort -rn); do
    if [ "$w" -le "$src_w" ]; then kept="$kept $w"; else echo "skip ${w}px: the source is only ${src_w}px wide" >&2; fi
  done
  [ -n "$kept" ] || kept=" $src_w"
  echo $kept
}

if [ "$mode" = "video" ]; then
  name="${name:-hero}"
  ws=$(pick_widths "${widths:-1920,1280}")
  bufsize="$(( ${maxrate%k} * 2 ))k"
  trim=""
  [ "$start" != "0" ] && trim="-ss $start"
  [ -n "$duration" ] && trim="$trim -t $duration"
  for w in $ws; do
    vf="scale=${w}:-2:flags=lanczos,fps=${fps},format=yuv420p"
    # shellcheck disable=SC2086
    ffmpeg -hide_banner -loglevel error -y $trim -i "$in" -an -vf "$vf" \
      -c:v libx264 -profile:v high -preset slow -crf "$crf" -maxrate "$maxrate" -bufsize "$bufsize" \
      -movflags +faststart "$out/$name-$w.mp4"
    made="$made $out/$name-$w.mp4"
    if has_encoder libvpx-vp9; then
      # Constrained quality: with -crf, libvpx treats -b:v as the bitrate ceiling.
      # shellcheck disable=SC2086
      ffmpeg -hide_banner -loglevel error -y $trim -i "$in" -an -vf "$vf" \
        -c:v libvpx-vp9 -crf $((crf + 8)) -b:v "$maxrate" -row-mt 1 -deadline good -cpu-used 2 \
        "$out/$name-$w.webm"
      made="$made $out/$name-$w.webm"
    else
      echo "no libvpx-vp9 encoder: WebM skipped, MP4 alone plays everywhere" >&2
    fi
  done
  top=$(echo $ws | awk '{print $1}')
  # The poster comes from the first rendition so it matches the loop's first frames exactly.
  ffmpeg -hide_banner -loglevel error -y -ss "$poster_at" -i "$out/$name-$top.mp4" -frames:v 1 -c:v libwebp -quality 80 "$out/$name-poster.webp"
  ffmpeg -hide_banner -loglevel error -y -ss "$poster_at" -i "$out/$name-$top.mp4" -frames:v 1 -q:v 4 "$out/$name-poster.jpg"
  made="$made $out/$name-poster.webp $out/$name-poster.jpg"
elif [ "$mode" = "image" ]; then
  name="${name:-$(basename "${in%.*}")}"
  ws=$(pick_widths "${widths:-640,1280,1920}")
  top=$(echo $ws | awk '{print $1}')
  if [ $((src_w)) -lt $((top * 2)) ]; then
    echo "warning: the source is ${src_w}x${src_h}; under 2x the largest width (${top}px), it will look soft on retina screens. Ask for a larger original." >&2
  fi
  avif=""
  if has_muxer avif; then
    if has_encoder libsvtav1; then avif="libsvtav1"; elif has_encoder libaom-av1; then avif="libaom-av1"; fi
  fi
  for w in $ws; do
    ffmpeg -hide_banner -loglevel error -y -i "$in" -vf "scale=${w}:-2:flags=lanczos" -c:v libwebp -quality "$quality" "$out/$name-$w.webp"
    made="$made $out/$name-$w.webp"
    if [ -n "$avif" ]; then
      # AV1 needs even dimensions and a 4:2:0 layout; crf 30 is close to WebP quality 78.
      ffmpeg -hide_banner -loglevel error -y -i "$in" -vf "scale=${w}:-2:flags=lanczos,format=yuv420p" -c:v "$avif" -crf 30 -still-picture 1 "$out/$name-$w.avif" 2>/dev/null \
        || ffmpeg -hide_banner -loglevel error -y -i "$in" -vf "scale=${w}:-2:flags=lanczos,format=yuv420p" -c:v "$avif" -crf 30 "$out/$name-$w.avif"
      made="$made $out/$name-$w.avif"
    fi
  done
  [ -n "$avif" ] || echo "no AV1 encoder or avif muxer in this ffmpeg: AVIF skipped, WebP alone is fine" >&2
else
  die "unknown mode: $mode (video, image or probe)"
fi

echo
echo "| file | dimensions | size |"
echo "| --- | --- | ---: |"
echo "| $(basename "$in") (source) | ${src_w}x${src_h} | $(human "$in_size") |"
for f in $made; do
  echo "| $(basename "$f") | $(dims "$f") | $(human "$(size_of "$f")") |"
done
