// /registry.json.sig: the registry's signature, byte for byte. Built only when the data
// has one (the made-up sample data is unsigned). Fixed URL, like /registry.json.
import type { APIRoute } from 'astro';
import { load, rawSig } from '../data/load';

export function getStaticPaths() {
  load();
  return rawSig('registry.json.sig') ? [{ params: { sig: 'registry.json.sig' } }] : [];
}

export const GET: APIRoute = () =>
  new Response(rawSig('registry.json.sig'), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
