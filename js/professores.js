import { iniciarPagina, avisar, mostrarErro } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { contas } from './auth.js';
import { esc, mostrarAlerta } from './util.js';

const { perfil, main } = await iniciarPagina('professores');

const CORES = ['#14857C', '#3F4FC2', '#C98A1B', '#7A45B8', '#2B7BC4', '#4D8C3A', '#B83A7B', '#8C6A4F', '#0E7490', '#6D28D9', '#B45309', '#475569'];

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Cadastro de professores</h1>
    <p class="sub">Inativar não apaga o histórico de aulas do professor.</p></div>
    <button class="btn btn-p" id="novo">Novo professor</button>
  </header>
  <div class="duas-colunas">
    <section class="card larga" style="overflow:hidden">
      <div class="barra" style="border-bottom:1px solid var(--linha)">
        <div class="campo" style="flex:1 1 240px"><label for="busca">Buscar por nome ou NIF</label><input id="busca" placeholder="Digite para buscar"></div>
        <div class="campo" style="flex:0 1 160px"><label for="sit">Situação</label><select id="sit"><option value="todos">Todos</option><option value="ativos" selected>Ativos</option><option value="inativos">Inativos</option></select></div>
      </div>
      <div class="tabela-box" id="lista"></div>
    </section>
    <form class="card estreita painel" id="form" novalidate></form>
  </div>`;

let profs = [], acessos = [], editando = null;

async function carregar() {
  [profs, acessos] = await Promise.all([
    q(sb.from('professores').select('*').order('nome')),
    rpc('listar_acessos'),
  ]);
  listar();
}

function situacaoAcesso(a) {
  if (!a?.tem_acesso) return '<span class="muted">Sem acesso</span>';
  if (a.bloqueado) return '<span class="chip chip-neu">Bloqueado</span>';
  return a.perfil === 'adm' ? '<span class="chip chip-red">Administrador</span>' : 'Professor';
}

function listar() {
  const termo = main.querySelector('#busca').value.trim().toLowerCase();
  const sit = main.querySelector('#sit').value;
  const lista = profs.filter((p) => (sit === 'todos' || (sit === 'ativos') === p.ativo) &&
    (!termo || p.nome.toLowerCase().includes(termo) || p.nif.includes(termo)));
  main.querySelector('#lista').innerHTML = `<table style="min-width:560px">
    <thead><tr><th>Nome</th><th>NIF</th><th>Situação</th><th>Acesso ao sistema</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map((p) => `<tr class="${p.ativo ? '' : 'inativo'}">
      <td><span class="cor-amostra" style="background:${esc(p.cor)}"></span>${esc(p.nome)}</td>
      <td class="num">${esc(p.nif)}</td>
      <td>${p.ativo ? '<span class="chip chip-ok">Ativo</span>' : '<span class="chip chip-neu">Inativo</span>'}</td>
      <td>${situacaoAcesso(acessos.find((a) => a.professor_id === p.id))}</td>
      <td><div class="acoes"><button class="btn btn-s" type="button" data-editar="${p.id}">Editar</button></div></td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">Nenhum professor encontrado.</td></tr>'}</tbody></table>`;
  main.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => abrirForm(profs.find((p) => p.id === b.dataset.editar))));
}

function abrirForm(p) {
  editando = p || null;
  const a = p ? acessos.find((x) => x.professor_id === p.id) : null;
  const usadas = new Set(profs.map((x) => x.cor));
  const cor = p?.cor || CORES.find((c) => !usadas.has(c)) || CORES[0];
  const form = main.querySelector('#form');
  form.innerHTML = `
    <h2>${p ? 'Editar professor' : 'Novo professor'}</h2>
    <div class="campo"><label for="nome">Nome completo</label><input id="nome" value="${esc(p?.nome || '')}" required></div>
    <div class="campo"><label for="nif">NIF</label><input id="nif" inputmode="numeric" value="${esc(p?.nif || '')}" ${a?.tem_acesso ? 'disabled' : ''} required>
      ${a?.tem_acesso ? '<span class="muted" style="font-size:12px">O NIF é o login; não pode ser alterado depois que o acesso foi criado.</span>' : ''}</div>
    <div class="campo"><span class="rotulo">Cor nas grades</span>
      <div class="cores" id="cores">${CORES.map((c) => `<button type="button" style="background:${c}" data-cor="${c}" aria-pressed="${c === cor}" aria-label="Cor ${c}"></button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="ativo" ${!p || p.ativo ? 'checked' : ''}> Professor ativo</label>
    <div class="requisitos" style="gap:10px">
      ${a?.tem_acesso
        ? `<span style="font-size:13.5px">Acesso ao sistema: <strong>${a.perfil === 'adm' ? 'Administrador' : 'Professor'}</strong>${a.bloqueado ? ' · bloqueado' : ''}</span>
           <span class="muted" style="font-size:12.5px">Perfil e senha são alterados em Usuários e acessos.</span>`
        : `<label class="check"><input type="checkbox" id="criar-acesso" ${p ? '' : 'checked'}> Criar acesso ao sistema</label>
           <div style="display:flex;gap:18px;padding-left:26px"><label class="check" style="font-size:13.5px"><input type="radio" name="perfil" value="professor" ${p?.perfil !== 'adm' ? 'checked' : ''}> Professor</label>
           <label class="check" style="font-size:13.5px"><input type="radio" name="perfil" value="adm" ${p?.perfil === 'adm' ? 'checked' : ''}> Administrador</label></div>
           <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5;padding-left:26px">Login: o NIF. Senha provisória: NIF + cfp109, válida por 7 dias, com troca obrigatória no primeiro acesso.</p>`}
    </div>
    <div id="msg" class="oculto" role="alert"></div>
    <div style="display:flex;gap:10px"><button class="btn btn-p" type="submit">Salvar professor</button><button class="btn" type="button" id="cancelar">Cancelar</button></div>`;
  form.querySelectorAll('[data-cor]').forEach((b) => b.addEventListener('click', () => form.querySelectorAll('[data-cor]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))));
  form.querySelector('#cancelar').addEventListener('click', () => abrirForm(null));
  form.querySelector('#nome').focus();
}

main.querySelector('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const msg = form.querySelector('#msg');
  const botao = form.querySelector('[type=submit]');
  botao.disabled = true;
  try {
    const p = editando;
    const a = p ? acessos.find((x) => x.professor_id === p.id) : null;
    const nome = form.querySelector('#nome').value.trim().replace(/\s+/g, ' ');
    const nif = form.querySelector('#nif').value.replace(/\D/g, '');
    const cor = form.querySelector('[data-cor][aria-pressed="true"]').dataset.cor;
    const ativo = form.querySelector('#ativo').checked;
    const criarAcesso = form.querySelector('#criar-acesso')?.checked;
    const perfilNovo = form.querySelector('input[name=perfil]:checked')?.value || p?.perfil || 'professor';
    if (!nome) throw new Error('Informe o nome.');
    if (!a?.tem_acesso && !/^\d{3,12}$/.test(nif)) throw new Error('Informe o NIF (somente números).');
    if (p && p.auth_user_id && p.auth_user_id === (await sb.auth.getUser()).data.user?.id && !ativo) throw new Error('Você não pode inativar o seu próprio cadastro.');

    let id = p?.id;
    const dados = { nome, cor, ativo, ...(a?.tem_acesso ? {} : { nif, perfil: perfilNovo }) };
    if (p) await q(sb.from('professores').update(dados).eq('id', id));
    else { const [novo] = await q(sb.from('professores').insert(dados).select()); id = novo.id; }

    let aviso = p ? 'Professor salvo.' : 'Professor cadastrado.';
    if (criarAcesso && ativo) {
      await contas('criar_acesso', { professor_id: id });
      aviso += ` Acesso criado: login ${nif}, senha provisória ${nif}cfp109 (7 dias).`;
    }
    if (a?.tem_acesso && p.ativo !== ativo) {
      await contas(ativo ? 'reativar_acesso' : 'bloquear_acesso', { professor_id: id });
      aviso += ativo ? ' Acesso reativado.' : ' Acesso bloqueado.';
    }
    avisar(aviso);
    await carregar();
    abrirForm(null);
  } catch (e) {
    mostrarErro(msg, e);
  } finally {
    botao.disabled = false;
  }
});

main.querySelector('#novo').addEventListener('click', () => abrirForm(null));
main.querySelector('#busca').addEventListener('input', listar);
main.querySelector('#sit').addEventListener('change', listar);

try { await carregar(); abrirForm(null); }
catch (e) { const box = document.createElement('div'); main.prepend(box); mostrarAlerta(box, 'erro', e.message); }
void perfil;
