// /<game>/media/<file>: the images and videos a game's game.json names, copied as they are.
import fs from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { load, mediaPath } from '../../../data/load';

export function getStaticPaths() {
  return load().games.flatMap((g) =>
    (g.info?.media ?? []).flatMap((m) => [m.file, m.poster].filter((f): f is string => !!f))
      .filter((f, i, all) => f.startsWith('media/') && all.indexOf(f) === i)
      .map((f) => ({ params: { game: g.id, file: f.slice('media/'.length) } })),
  );
}

const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4' };

export const GET: APIRoute = ({ params }) => {
  const file = mediaPath(params.game!, `media/${params.file}`);
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
};
