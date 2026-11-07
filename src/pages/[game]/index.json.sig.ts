// /<game>/index.json.sig: the game index's signature, byte for byte. Fixed URL.
import type { APIRoute } from 'astro';
import { load, rawSig } from '../../data/load';

export function getStaticPaths() {
  return load().games.filter((g) => g.status !== 'coming' && rawSig('games', g.id, 'index.json.sig'))
    .map((g) => ({ params: { game: g.id } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(rawSig('games', params.game!, 'index.json.sig'), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
