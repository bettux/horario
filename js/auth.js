import { sb, rpc } from './supabase.js';
import { DOMINIO_LOGIN } from './config.js';

export const emailDoNif = (nif) => `${String(nif).trim()}@${DOMINIO_LOGIN}`;

// Login por NIF + senha. Devolve o perfil do professor.
export async function entrar(nif, senha) {
  const limpo = String(nif || '').replace(/\D/g, '');
  if (!limpo) throw new Error('Informe o seu NIF (somente números).');
  if (!senha) throw new Error('Informe a sua senha.');
  const { error } = await sb.auth.signInWithPassword({ email: emailDoNif(limpo), password: senha });
  if (error) {
    if (/banned/i.test(error.message)) throw new Error('Seu acesso está bloqueado. Fale com a coordenação.');
    throw new Error('NIF ou senha incorretos.');
  }
  const perfil = await meuPerfil();
  if (!perfil) { await sb.auth.signOut(); throw new Error('Este NIF não está vinculado a um professor.'); }
  if (!perfil.ativo) { await sb.auth.signOut(); throw new Error('Seu cadastro está inativo. Fale com a coordenação.'); }
  return perfil;
}

export async function meuPerfil() {
  return await rpc('meu_perfil');
}

export function destino(perfil) {
  if (perfil.troca_senha_pendente) return 'primeiro-acesso.html';
  return perfil.perfil === 'adm' ? 'inicio.html' : 'minhas-aulas.html';
}

// Protege uma página. Redireciona quem não pode estar nela.
export async function exigirSessao({ adm = false, permitirTroca = false } = {}) {
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.replace('index.html'); return new Promise(() => {}); }
  let perfil;
  try { perfil = await meuPerfil(); } catch { perfil = null; }
  if (!perfil || !perfil.ativo) { await sair(); return new Promise(() => {}); }
  if (perfil.troca_senha_pendente && !permitirTroca) { location.replace('primeiro-acesso.html'); return new Promise(() => {}); }
  if (adm && perfil.perfil !== 'adm') { location.replace('minhas-aulas.html'); return new Promise(() => {}); }
  return perfil;
}

export async function sair() {
  await sb.auth.signOut();
  location.replace('index.html');
}

// Chama a função de contas no servidor
export async function contas(acao, dados = {}) {
  const { data, error } = await sb.functions.invoke('gerenciar-usuarios', { body: { acao, ...dados } });
  if (error) {
    let msg = 'Não foi possível concluir a operação.';
    try { const corpo = await error.context.json(); if (corpo?.erro) msg = corpo.erro; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  return data;
}

export async function trocarSenha(nova, nif) {
  await contas('trocar_senha', { nova_senha: nova });
  // A troca de senha encerra a sessão antiga no servidor.
  // Entra de novo com a senha nova para obter uma sessão limpa (sem troca pendente).
  const { error } = await sb.auth.signInWithPassword({ email: emailDoNif(nif), password: nova });
  if (error) {
    await sb.auth.signOut();
    throw new Error('Senha alterada. Entre novamente com a sua nova senha.');
  }
}
