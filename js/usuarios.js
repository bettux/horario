import { iniciarPagina, avisar, confirmar } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { contas } from './auth.js';
import { esc, mostrarAlerta } from './util.js';

const { main } = await iniciarPagina('usuarios');
const { data: eu } = await sb.auth.getUser();

main.innerHTML = `
  <header class="cabecalho"><div>
    <h1>Usuários e acessos</h1>
    <p class="sub">As contas nascem no cadastro do professor. Aqui você redefine senhas e define quem é administrador.</p>
  </div></header>
  <div class="alerta alerta-aviso">Login pelo NIF. Senha provisória: NIF + cfp109, válida por 7 dias, com troca obrigatória no primeiro acesso. Ao redefinir, a senha volta para esse padrão e as sessões abertas da pessoa são encerradas. Não é possível remover o último administrador nem o seu próprio perfil de administrador.</div>
  <div id="msg" class="oculto" role="alert"></div>
  <section class="card" style="overflow:hidden">
    <div class="barra" style="border-bottom:1px solid var(--linha)">
      <div class="campo" style="flex:1 1 240px"><label for="busca">Buscar</label><input id="busca" placeholder="Nome ou NIF"></div>
      <div class="campo" style="flex:0 1 180px"><label for="filtro">Perfil</label><select id="filtro"><option value="">Todos</option><option value="adm">Administrador</option><option value="professor">Professor</option><option value="sem">Sem acesso</option></select></div>
    </div>
    <div class="tabela-box" id="lista"><p class="carregando" style="padding:16px">Carregando…</p></div>
  </section>`;

let linhas = [];
const msg = main.querySelector('#msg');

async function carregar() {
  try { linhas = await rpc('listar_acessos'); listar(); }
  catch (e) { mostrarAlerta(msg, 'erro', e.message); }
}

function senhaChip(a) {
  if (!a.tem_acesso) return '<span class="muted">—</span>';
  if (a.bloqueado) return '<span class="chip chip-neu">Acesso bloqueado</span>';
  if (!a.troca_pendente) return '<span class="chip chip-ok">Definitiva</span>';
  const dias = Math.ceil((new Date(a.provisoria_expira_em) - new Date()) / 86400000);
  return dias > 0 ? `<span class="chip chip-aviso">Provisória · ${dias} dia${dias > 1 ? 's' : ''}</span>` : '<span class="chip chip-erro">Provisória expirada</span>';
}

function listar() {
  const termo = main.querySelector('#busca').value.trim().toLowerCase();
  const f = main.querySelector('#filtro').value;
  const lista = linhas.filter((a) => (!termo || a.nome.toLowerCase().includes(termo) || a.nif.includes(termo)) &&
    (!f || (f === 'sem' ? !a.tem_acesso : a.tem_acesso && a.perfil === f)));
  main.querySelector('#lista').innerHTML = `<table style="min-width:820px">
    <thead><tr><th>Nome</th><th>Login (NIF)</th><th>Perfil</th><th>Senha</th><th>Último acesso</th><th style="text-align:right">Ações</th></tr></thead>
    <tbody>${lista.map((a) => {
      const souEu = a.tem_acesso && eu.user && linhaEhMinha(a);
      let acoes = '';
      if (!a.ativo) acoes = '<span class="muted" style="font-size:12.5px">Professor inativo</span>';
      else if (!a.tem_acesso) acoes = `<button class="btn btn-s" data-acao="criar" data-id="${a.professor_id}">Criar acesso</button>`;
      else if (souEu) acoes = '<span class="muted" style="font-size:12.5px">Você</span>';
      else {
        acoes = `<button class="btn btn-s" data-acao="reset" data-id="${a.professor_id}">${a.troca_pendente && new Date(a.provisoria_expira_em) < new Date() ? 'Liberar nova provisória' : 'Redefinir senha'}</button>`;
        acoes += a.perfil === 'adm'
          ? `<button class="btn btn-s" data-acao="prof" data-id="${a.professor_id}">Tornar professor</button>`
          : `<button class="btn btn-s" data-acao="adm" data-id="${a.professor_id}">Tornar administrador</button>`;
        acoes += a.bloqueado
          ? `<button class="btn btn-s" data-acao="reativar" data-id="${a.professor_id}">Reativar acesso</button>`
          : `<button class="btn btn-s" data-acao="bloquear" data-id="${a.professor_id}">Bloquear</button>`;
      }
      return `<tr class="${a.ativo ? '' : 'inativo'}"><td>${esc(a.nome)}${souEu ? ' <span class="muted" style="font-size:12px">(você)</span>' : ''}</td>
        <td class="num">${esc(a.nif)}</td>
        <td>${a.tem_acesso ? (a.perfil === 'adm' ? '<span class="chip chip-red">Administrador</span>' : 'Professor') : '<span class="muted">Sem acesso</span>'}</td>
        <td>${senhaChip(a)}</td>
        <td class="num">${a.ultimo_acesso ? new Date(a.ultimo_acesso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '<span class="muted">Nunca acessou</span>'}</td>
        <td><div class="acoes">${acoes}</div></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Nenhum usuário encontrado.</td></tr>'}</tbody></table>`;
  main.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', () => agir(b.dataset.acao, linhas.find((a) => a.professor_id === b.dataset.id))));
}

let meuProfessorId = null;
function linhaEhMinha(a) { return a.professor_id === meuProfessorId; }

async function agir(acao, a) {
  const textos = {
    criar: ['Criar acesso?', `${a.nome} poderá entrar com o login ${a.nif} e a senha provisória ${a.nif}cfp109, válida por 7 dias.`, 'Criar acesso'],
    reset: ['Redefinir senha?', `A senha atual de ${a.nome} deixa de funcionar. Ela entra com a senha provisória (${a.nif}cfp109), válida por 7 dias, e precisa criar uma nova antes de usar o sistema.`, 'Redefinir senha'],
    adm: ['Tornar administrador?', `${a.nome} terá acesso completo: cadastros, grades, pós, relatórios e contas.`, 'Tornar administrador'],
    prof: ['Tornar professor?', `${a.nome} passa a ver somente as próprias aulas.`, 'Confirmar'],
    bloquear: ['Bloquear acesso?', `${a.nome} não conseguirá mais entrar até ser reativado. As aulas não são alteradas.`, 'Bloquear'],
    reativar: ['Reativar acesso?', `${a.nome} volta a entrar com a senha que já tinha.`, 'Reativar'],
  };
  const [t, txt, rot] = textos[acao];
  if (!(await confirmar(t, txt, rot, acao === 'bloquear'))) return;
  try {
    if (acao === 'criar') await contas('criar_acesso', { professor_id: a.professor_id });
    if (acao === 'reset') await contas('resetar_senha', { professor_id: a.professor_id });
    if (acao === 'bloquear') await contas('bloquear_acesso', { professor_id: a.professor_id });
    if (acao === 'reativar') await contas('reativar_acesso', { professor_id: a.professor_id });
    if (acao === 'adm' || acao === 'prof') await q(sb.from('professores').update({ perfil: acao === 'adm' ? 'adm' : 'professor' }).eq('id', a.professor_id));
    avisar({ criar: 'Acesso criado.', reset: 'Senha redefinida para a provisória.', adm: 'Agora é administrador.', prof: 'Agora é professor.', bloquear: 'Acesso bloqueado.', reativar: 'Acesso reativado.' }[acao]);
    await carregar();
  } catch (e) {
    avisar(e.message, 'erro');
  }
}

main.querySelector('#busca').addEventListener('input', listar);
main.querySelector('#filtro').addEventListener('change', listar);
try { meuProfessorId = (await rpc('meu_perfil'))?.professor_id; } catch { /* ignora */ }
carregar();
