// /registry.json: the exact bytes of the data folder's registry.json. This URL is built
// into shipped installers: never move or rename it.
import type { APIRoute } from 'astro';
import { rawRegistry } from '../data/load';

export const GET: APIRoute = () =>
  new Response(rawRegistry(), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
