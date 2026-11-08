// /<game>/index.json: the game's index, byte for byte (indexes are signed, so never
// re-serialise them). Only games with public releases have one. Fixed URL, like /registry.json.
import type { APIRoute } from 'astro';
import { load, rawIndex } from '../../data/load';

export function getStaticPaths() {
  return load().games.filter((g) => g.status !== 'coming').map((g) => ({ params: { game: g.id } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(rawIndex(params.game!), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
