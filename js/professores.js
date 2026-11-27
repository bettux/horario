import { iniciarPagina, avisar, mostrarErro, abrirDialogo } from './pagina.js?v=202611271051';
import { sb, q, rpc } from './supabase.js?v=202611271051';
import { contas } from './auth.js?v=202611271051';
import { esc, mostrarAlerta } from './util.js?v=202611271051';
import { CORES_PROFESSORES, CORES_PLANILHA, proximaCor } from './cores.js?v=202611271051';

const { perfil, main } = await iniciarPagina('professores');


main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Cadastro de professores</h1>
    <p class="sub">Inativar não apaga o histórico de aulas do professor. Excluir só é possível para quem não tem aulas no período ativo.</p></div>
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
      <td><span class="cor-amostra" style="background:${esc(p.cor)}"></span>${esc(p.nome)}${p.apelido ? ` <span class="muted" style="font-size:12.5px">· no horário: ${esc(p.apelido)}</span>` : ''}</td>
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
  const cor = (p?.cor || proximaCor(profs.map((x) => x.cor))).toUpperCase();
  const TODAS = [...CORES_PLANILHA, ...CORES_PROFESSORES];
  const personalizada = !TODAS.includes(cor);
  const emUso = new Map(profs.filter((x) => x.id !== p?.id).map((x) => [String(x.cor).toUpperCase(), x.nome]));
  const form = main.querySelector('#form');
  form.innerHTML = `
    <h2>${p ? 'Editar professor' : 'Novo professor'}</h2>
    <div class="campo"><label for="nome">Nome completo</label><input id="nome" value="${esc(p?.nome || '')}" required></div>
    <div class="campo"><label for="apelido">Nome no horário <span class="muted" style="font-weight:400">(opcional)</span></label><input id="apelido" maxlength="30" value="${esc(p?.apelido || '')}" placeholder="${esc((p?.nome || '').split(' ')[0] || 'Ex.: Canno')}">
      <span class="muted" style="font-size:12px">Como aparece nos blocos do horário, no Montar horário e nos relatórios por turma. Em branco = primeiro nome. Cadastros, carga e a planilha oficial continuam com o nome completo.</span></div>
    <div class="campo"><label for="nif">NIF</label><input id="nif" inputmode="numeric" value="${esc(p?.nif || '')}" ${a?.tem_acesso ? 'disabled' : ''} required>
      ${a?.tem_acesso ? '<span class="muted" style="font-size:12px">O NIF é o login; não pode ser alterado depois que o acesso foi criado.</span>' : ''}</div>
    <div class="campo"><span class="rotulo">Cor nas grades</span>
      <span class="muted" style="font-size:12px">Cores da planilha</span>
      <div class="cores" id="cores-plan">${CORES_PLANILHA.map((c) => `<button type="button" style="background:${c}" data-cor="${c}" aria-pressed="${c === cor}" aria-label="Cor ${c}${emUso.has(c) ? ', em uso por ' + esc(emUso.get(c)) : ''}" title="${c}${emUso.has(c) ? ' · em uso: ' + esc(emUso.get(c)) : ' · livre'}"${emUso.has(c) ? ' data-usada' : ''}></button>`).join('')}</div>
      <span class="muted" style="font-size:12px;margin-top:4px">Outras cores</span>
      <div class="cores" id="cores">${CORES_PROFESSORES.map((c) => `<button type="button" style="background:${c}" data-cor="${c}" aria-pressed="${c === cor}" aria-label="Cor ${c}${emUso.has(c) ? ', em uso por ' + esc(emUso.get(c)) : ''}" title="${c}${emUso.has(c) ? ' · em uso: ' + esc(emUso.get(c)) : ' · livre'}"${emUso.has(c) ? ' data-usada' : ''}></button>`).join('')}</div>
      <div class="cor-livre">
        <input type="color" id="cor-pick" value="${cor}" aria-label="Escolher outra cor">
        <input id="cor-hex" value="${cor}" maxlength="7" placeholder="#RRGGBB" aria-label="Código da cor" spellcheck="false">
        <span class="muted" style="font-size:12px">Outra cor: escolha ou digite o código (ex.: #00B0F0)</span>
      </div>
      <span class="muted" style="font-size:12px">A cor com contorno pontilhado já está em uso por outro professor.${personalizada ? ' Este professor usa uma cor própria.' : ''}</span></div>
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
    <div style="display:flex;gap:10px"><button class="btn btn-p" type="submit">Salvar professor</button><button class="btn" type="button" id="cancelar">Cancelar</button></div>
    ${p ? `<div style="border-top:1px solid var(--linha);padding-top:14px;display:flex;flex-direction:column;gap:6px">
      <button class="btn btn-p btn-perigo" type="button" id="excluir" style="align-self:flex-start">Excluir professor</button>
      <span class="muted" style="font-size:12px;line-height:1.45">Só é possível excluir quem não tem nenhuma aula no período ativo nem em períodos futuros. Para quem já deu aula, prefira desmarcar "Professor ativo".</span></div>` : ''}`;
  const pick = form.querySelector('#cor-pick'), hexIn = form.querySelector('#cor-hex');
  const marcar = (c) => {
    form.querySelectorAll('[data-cor]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cor === c)));
    pick.value = c; hexIn.value = c; hexIn.classList.remove('invalido');
  };
  form.querySelectorAll('[data-cor]').forEach((b) => b.addEventListener('click', () => marcar(b.dataset.cor)));
  pick.addEventListener('input', () => marcar(pick.value.toUpperCase()));
  hexIn.addEventListener('input', () => {
    let v = hexIn.value.trim().toUpperCase(); if (v && !v.startsWith('#')) v = '#' + v;
    if (/^#[0-9A-F]{6}$/.test(v)) marcar(v); else hexIn.classList.add('invalido');
  });
  form.querySelector('#cancelar').addEventListener('click', () => abrirForm(null));
  form.querySelector('#excluir')?.addEventListener('click', () => excluir(p, form.querySelector('#msg')));
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
    const apelido = form.querySelector('#apelido').value.trim().replace(/\s+/g, ' ') || null;
    const curto = (x) => (x.apelido || x.nome.split(' ')[0]).toLowerCase();
    const igual = profs.find((x) => x.id !== p?.id && x.ativo && curto(x) === (apelido || nome.split(' ')[0]).toLowerCase());
    const nif = form.querySelector('#nif').value.replace(/\D/g, '');
    const cor = form.querySelector('#cor-hex').value.trim().toUpperCase().replace(/^([0-9A-F]{6})$/, '#$1');
    if (!/^#[0-9A-F]{6}$/.test(cor)) throw new Error('Cor inválida. Use o formato #RRGGBB, por exemplo #00B0F0.');
    const ativo = form.querySelector('#ativo').checked;
    const criarAcesso = form.querySelector('#criar-acesso')?.checked;
    const perfilNovo = form.querySelector('input[name=perfil]:checked')?.value || p?.perfil || 'professor';
    if (!nome) throw new Error('Informe o nome.');
    if (!a?.tem_acesso && !/^\d{3,12}$/.test(nif)) throw new Error('Informe o NIF (somente números).');
    if (p && p.auth_user_id && p.auth_user_id === (await sb.auth.getUser()).data.user?.id && !ativo) throw new Error('Você não pode inativar o seu próprio cadastro.');

    let id = p?.id;
    const dados = { nome, apelido, cor, ativo, ...(a?.tem_acesso ? {} : { nif, perfil: perfilNovo }) };
    if (p) await q(sb.from('professores').update(dados).eq('id', id));
    else { const [novo] = await q(sb.from('professores').insert(dados).select()); id = novo.id; }

    let aviso = p ? 'Professor salvo.' : 'Professor cadastrado.';
    if (igual) aviso += ` Atenção: ${igual.nome} aparece no horário com o mesmo nome (${igual.apelido || igual.nome.split(' ')[0]}). Use um "Nome no horário" diferente para não confundir.`;
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

// ---------- excluir professor (com conferência e confirmação pelo NIF) ----------
async function excluir(p, msg) {
  msg.classList.add('oculto');
  let info;
  try { [info] = await rpc('exclusao_professor', { p_professor: p.id }); }
  catch (e) { mostrarErro(msg, e); return; }
  if (info.impedimentos?.length) {
    mostrarAlerta(msg, 'erro', `${p.nome} não pode ser excluído:`, info.impedimentos);
    return;
  }
  const apaga = info.apaga || [];
  const dlg = abrirDialogo({
    titulo: 'Excluir professor definitivamente?',
    confirmar: 'Excluir definitivamente',
    perigo: true,
    corpo: `<div class="alerta alerta-erro" style="margin:0 0 12px"><strong>Atenção: esta ação não pode ser desfeita.</strong></div>
      <p style="margin:0 0 8px;line-height:1.55">O cadastro de <strong>${esc(p.nome)}</strong> (NIF ${esc(p.nif)}) será apagado. Ele não tem aulas no período ativo nem nos próximos.</p>
      ${apaga.length ? `<p style="margin:0 0 4px">Também serão apagados:</p><ul style="margin:0 0 10px;padding-left:20px;line-height:1.6">${apaga.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="campo"><label for="conf-nif">Para confirmar, digite o NIF do professor</label><input id="conf-nif" inputmode="numeric" autocomplete="off"></div>`,
    aoConfirmar: async (d) => {
      if (d.querySelector('#conf-nif').value.replace(/\D/g, '') !== p.nif) throw new Error('O NIF digitado não confere.');
      const r = await contas('excluir_professor', { professor_id: p.id });
      avisar(`${p.nome} foi excluído.${r?.acesso_removido ? ' O login também foi apagado.' : ''}`);
      await carregar();
      abrirForm(null);
    },
  });
  const ok = dlg.querySelector('[data-ok]'), campo = dlg.querySelector('#conf-nif');
  ok.disabled = true;
  campo.addEventListener('input', () => { ok.disabled = campo.value.replace(/\D/g, '') !== p.nif; });
}

main.querySelector('#novo').addEventListener('click', () => abrirForm(null));
main.querySelector('#busca').addEventListener('input', listar);
main.querySelector('#sit').addEventListener('change', listar);

try { await carregar(); abrirForm(null); }
catch (e) { const box = document.createElement('div'); main.prepend(box); mostrarAlerta(box, 'erro', e.message); }
void perfil;
