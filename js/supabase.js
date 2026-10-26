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

// Executa uma consulta do supabase-js e devolve data, ou lança erro legível
export async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw erroLegivel(error);
  return data;
}

// Converte erros do banco em português; validações vêm em "details", uma por linha
export function erroLegivel(error) {
  const codigos = {
    '23505': 'Já existe um cadastro com esses dados.',
    '23503': 'Este cadastro está em uso e não pode ser excluído.',
    '23514': 'Algum valor está fora do permitido. Confira os campos.',
    '23502': 'Preencha todos os campos obrigatórios.',
    '22P02': 'Algum campo tem um formato inválido.',
    '22007': 'Data ou horário inválido.',
    '22008': 'Data ou horário inválido.',
  };
  const e = new Error(codigos[error.code] || error.message || 'Erro inesperado.');
  e.linhas = error.details && error.code === 'P0001' ? String(error.details).split('\n').filter(Boolean) : [];
  e.codigo = error.code;
  return e;
}
