// /<game>/media/<file>: the images and videos a game's data names (file, poster, sources),
// served as they are from its data zip (or, for older data, from disk).
import path from 'node:path';
import type { APIRoute } from 'astro';
import { load, mediaBytes } from '../../../data/load';

export function getStaticPaths() {
  return load().games.flatMap((g) =>
    (g.info?.media ?? []).flatMap((m) => [m.file, m.poster, ...(m.sources ?? [])].filter((f): f is string => !!f))
      .filter((f, i, all) => f.startsWith('media/') && all.indexOf(f) === i)
      .map((f) => ({ params: { game: g.id, file: f.slice('media/'.length) } })),
  );
}

const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4' };

export const GET: APIRoute = ({ params }) =>
  new Response(mediaBytes(params.game!, `media/${params.file}`), {
    headers: { 'Content-Type': types[path.extname(params.file!).toLowerCase()] ?? 'application/octet-stream' },
  });
