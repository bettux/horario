import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'horario-auth' },
});

// Chama uma função do banco (RPC) e devolve os dados; lança erro com mensagens legíveis
export async function rpc(nome, args = {}) {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw erroLegivel(error);
  return data;
}

// Converte erros do banco: as validações vêm em "details", uma por linha
export function erroLegivel(error) {
  const e = new Error(error.message || 'Erro inesperado.');
  e.linhas = error.details ? String(error.details).split('\n').filter(Boolean) : [];
  return e;
}
