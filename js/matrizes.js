import { iniciarPagina, avisar, abrirDialogo, mostrarErro } from './pagina.js';
import { sb, q } from './supabase.js';
import { esc } from './util.js';

const { main } = await iniciarPagina('matrizes');

const MODALIDADES = {
  presencial: 'Presencial', ead_sincrona: 'EAD síncrona', ead_assincrona: 'EAD assíncrona', pos: 'Pós (módulo)', tcc: 'TCC / Monografia',
};
const PROFESSOR = { obrigatorio: 'Obrigatório', opcional: 'Opcional', sem: 'Sem professor' };
const REGRA = { normal: 'Normal', pi_extensao: 'PI / Extensão (até 2/semana somadas, sem exigir carga)' };

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Matrizes curriculares</h1>
    <p class="sub">Cadastro fixo de cursos, matrizes e componentes. As turmas trazem os componentes daqui automaticamente.</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="novo-curso">Novo curso</button><button class="btn" id="nova-matriz">Nova matriz</button></div>
  </header>
  <div class="duas-colunas">
    <nav class="card estreita lista-nav" id="nav" aria-label="Matrizes" style="flex:1 1 240px;max-width:320px"></nav>
    <section class="card larga" id="painel" style="overflow:hidden"></section>
  </div>`;

let cursos = [], matrizes = [], comps = [];
let matrizAtual = null, semestreAtual = null;

await carregar();

async function carregar() {
  [cursos, matrizes] = await Promise.all([
    q(sb.from('cursos').select('*').order('nivel').order('nome')),
    q(sb.from('matrizes').select('*').order('nome')),
  ]);
  if (!matrizAtual && matrizes.length) matrizAtual = matrizes[0].id;
  desenharNav();
  await carregarComponentes();
}

function desenharNav() {
  const nav = main.querySelector('#nav');
  const grupo = (nivel, titulo) => {
    const cs = cursos.filter((c) => c.nivel === nivel);
    if (!cs.length) return '';
    return `<div class="grp">${titulo}</div>` + cs.map((c) => matrizes.filter((m) => m.curso_id === c.id).map((m) =>
      `<button type="button" data-m="${m.id}" aria-current="${m.id === matrizAtual}">${esc(c.sigla || c.nome)} · ${esc(m.nome)}<span>${esc(c.nome)}${m.vigente ? '' : ' · não vigente'}</span></button>`).join('')).join('');
  };
  nav.innerHTML = grupo('graduacao', 'Graduação') + grupo('pos', 'Pós-graduação') || '<p class="muted" style="padding:12px">Nenhum curso.</p>';
  nav.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => { matrizAtual = b.dataset.m; semestreAtual = null; desenharNav(); await carregarComponentes(); }));
}

async function carregarComponentes() {
  const painel = main.querySelector('#painel');
  if (!matrizAtual) { painel.innerHTML = '<p class="muted" style="padding:16px">Cadastre um curso e uma matriz.</p>'; return; }
  comps = await q(sb.from('componentes').select('*').eq('matriz_id', matrizAtual).order('semestre').order('ordem').order('nome'));
  const m = matrizes.find((x) => x.id === matrizAtual);
  const curso = cursos.find((c) => c.id === m.curso_id);
  const ehPos = curso.nivel === 'pos';
  const semestres = ehPos ? [0] : [...new Set(comps.map((c) => c.semestre))].sort((a, b) => a - b);
  if (semestreAtual === null || !semestres.includes(semestreAtual)) semestreAtual = semestres[0] ?? (ehPos ? 0 : 1);
  const lista = comps.filter((c) => c.semestre === semestreAtual);
  const unidade = ehPos ? 'h' : ' aulas';

  painel.innerHTML = `
    <div class="barra" style="justify-content:space-between;border-bottom:1px solid var(--linha)">
      <div><strong>${esc(curso.nome)} · ${esc(m.nome)}</strong> ${m.vigente ? '' : '<span class="chip chip-neu">não vigente</span>'}</div>
      <button class="btn btn-s" id="editar-matriz">Editar matriz</button>
    </div>
    ${ehPos ? '' : `<div class="abas" role="tablist" style="padding:0 16px">${semestres.map((s) => `<button class="aba" role="tab" data-s="${s}" aria-selected="${s === semestreAtual}">${s}º semestre</button>`).join('')}</div>`}
    <div class="tabela-box"><table>
      <thead><tr><th>Componente</th><th>Sigla</th><th>Modalidade</th><th style="text-align:right">${ehPos ? 'Horas' : 'Aulas no semestre'}</th><th>Regra</th><th>Professor</th><th></th></tr></thead>
      <tbody>${lista.length ? lista.map((c) => `<tr class="${c.ativo ? '' : 'inativo'}">
        <td>${esc(c.nome)}${c.ativo ? '' : ' <span class="chip chip-neu">inativo</span>'}</td>
        <td class="muted">${esc(c.sigla || '')}</td>
        <td>${c.modalidade === 'presencial' || c.modalidade === 'pos' ? MODALIDADES[c.modalidade] : `<span class="chip chip-aviso">${MODALIDADES[c.modalidade]}</span>`}</td>
        <td class="num" style="text-align:right">${c.carga ?? '—'}${c.carga != null ? unidade : ''}</td>
        <td>${c.regra === 'pi_extensao' ? '<span class="chip chip-red">PI / Extensão</span>' : '<span class="muted">Normal</span>'}</td>
        <td>${PROFESSOR[c.professor]}</td>
        <td><div class="acoes"><button class="btn btn-s" data-editar="${c.id}">Editar</button></div></td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">Nenhum componente neste semestre.</td></tr>'}</tbody></table></div>
    <div class="barra" style="justify-content:space-between;border-top:1px solid var(--linha)">
      <span class="muted" style="font-size:13px">Componente já usado em aulas não pode ser excluído, só desativado.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${ehPos ? '' : '<button class="btn" id="novo-sem">Novo semestre</button>'}<button class="btn btn-p" id="novo-comp">Adicionar componente</button></div>
    </div>`;

  painel.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { semestreAtual = +b.dataset.s; carregarComponentes(); }));
  painel.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => dialogoComponente(comps.find((c) => c.id === b.dataset.editar), ehPos)));
  painel.querySelector('#novo-comp').addEventListener('click', () => dialogoComponente(null, ehPos));
  painel.querySelector('#novo-sem')?.addEventListener('click', () => { semestreAtual = Math.max(0, ...semestres) + 1; dialogoComponente(null, ehPos); });
  painel.querySelector('#editar-matriz').addEventListener('click', () => dialogoMatriz(m));
}

function opcoes(mapa, atual) { return Object.entries(mapa).map(([k, v]) => `<option value="${k}"${k === atual ? ' selected' : ''}>${v}</option>`).join(''); }

function dialogoComponente(c, ehPos) {
  const novo = !c;
  c = c || { nome: '', semestre: semestreAtual, ordem: comps.filter((x) => x.semestre === semestreAtual).length + 1, modalidade: ehPos ? 'pos' : 'presencial', carga: ehPos ? 30 : 80, regra: 'normal', professor: 'obrigatorio', ativo: true };
  abrirDialogo({
    titulo: novo ? 'Novo componente' : 'Editar componente',
    corpo: `
      <div class="linha-form" style="grid-template-columns:minmax(0,3fr) minmax(0,1fr)">
        <div class="campo"><label for="c-nome">Nome</label><input id="c-nome" value="${esc(c.nome)}" required></div>
        <div class="campo"><label for="c-sigla">Sigla</label><input id="c-sigla" value="${esc(c.sigla || '')}" maxlength="12" placeholder="Automática"></div>
      </div>
      <p class="muted" style="margin:-4px 0 0;font-size:12.5px">A sigla aparece na planilha. Em branco, o sistema usa as iniciais do nome.</p>
      <div class="linha-form" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="campo"><label for="c-sem">Semestre</label><input id="c-sem" type="number" min="0" max="12" value="${c.semestre}" ${ehPos ? 'disabled' : ''}></div>
        <div class="campo"><label for="c-ordem">Ordem</label><input id="c-ordem" type="number" min="0" value="${c.ordem}"></div>
        <div class="campo"><label for="c-carga">${ehPos ? 'Horas' : 'Aulas no semestre'}</label><input id="c-carga" type="number" min="0" value="${c.carga ?? ''}"></div>
      </div>
      <div class="campo"><label for="c-mod">Modalidade</label><select id="c-mod">${opcoes(MODALIDADES, c.modalidade)}</select></div>
      <div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="campo"><label for="c-prof">Professor</label><select id="c-prof">${opcoes(PROFESSOR, c.professor)}</select></div>
        <div class="campo"><label for="c-regra">Regra</label><select id="c-regra">${opcoes(REGRA, c.regra)}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="c-ativo" ${c.ativo ? 'checked' : ''}> Componente ativo</label>`,
    aoConfirmar: async (dlg) => {
      const v = (id) => dlg.querySelector(id).value;
      const dados = {
        matriz_id: matrizAtual, nome: v('#c-nome').trim(), sigla: v('#c-sigla').trim() || null, semestre: ehPos ? 0 : +v('#c-sem'), ordem: +v('#c-ordem') || 0,
        carga: v('#c-carga') === '' ? null : +v('#c-carga'), modalidade: v('#c-mod'), professor: v('#c-prof'), regra: v('#c-regra'),
        ativo: dlg.querySelector('#c-ativo').checked,
      };
      if (!dados.nome) throw new Error('Informe o nome.');
      if (novo) await q(sb.from('componentes').insert(dados));
      else await q(sb.from('componentes').update(dados).eq('id', c.id));
      semestreAtual = dados.semestre;
      avisar(novo ? 'Componente criado.' : 'Componente salvo.');
      await carregarComponentes();
    },
  });
}

function dialogoMatriz(m) {
  abrirDialogo({
    titulo: m ? 'Editar matriz' : 'Nova matriz',
    corpo: `
      <div class="campo"><label for="m-curso">Curso</label><select id="m-curso" ${m ? 'disabled' : ''}>${cursos.map((c) => `<option value="${c.id}"${m?.curso_id === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label for="m-nome">Nome da matriz</label><input id="m-nome" value="${esc(m?.nome || '')}" placeholder="Ex.: Atual, 2027" required></div>
      <label class="check"><input type="checkbox" id="m-vig" ${!m || m.vigente ? 'checked' : ''}> Vigente</label>`,
    aoConfirmar: async (dlg) => {
      const nome = dlg.querySelector('#m-nome').value.trim();
      if (!nome) throw new Error('Informe o nome.');
      const vigente = dlg.querySelector('#m-vig').checked;
      if (m) await q(sb.from('matrizes').update({ nome, vigente }).eq('id', m.id));
      else { const [nova] = await q(sb.from('matrizes').insert({ curso_id: dlg.querySelector('#m-curso').value, nome, vigente }).select()); matrizAtual = nova.id; semestreAtual = null; }
      avisar('Matriz salva.'); await carregar();
    },
  });
}

main.querySelector('#nova-matriz').addEventListener('click', () => dialogoMatriz(null));
main.querySelector('#novo-curso').addEventListener('click', () => abrirDialogo({
  titulo: 'Novo curso',
  corpo: `<div class="campo"><label for="k-nome">Nome</label><input id="k-nome" required></div>
    <div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="campo"><label for="k-sigla">Sigla</label><input id="k-sigla" placeholder="Ex.: ADS"></div>
      <div class="campo"><label for="k-nivel">Nível</label><select id="k-nivel"><option value="graduacao">Graduação</option><option value="pos">Pós-graduação</option></select></div></div>
    <p class="muted" style="margin:0;font-size:12.5px">Depois crie a matriz do curso em "Nova matriz".</p>`,
  aoConfirmar: async (dlg) => {
    const nome = dlg.querySelector('#k-nome').value.trim();
    if (!nome) throw new Error('Informe o nome.');
    await q(sb.from('cursos').insert({ nome, sigla: dlg.querySelector('#k-sigla').value.trim() || null, nivel: dlg.querySelector('#k-nivel').value }));
    avisar('Curso criado.'); await carregar();
  },
}));

window.addEventListener('unhandledrejection', (ev) => { const box = document.createElement('div'); main.prepend(box); mostrarErro(box, ev.reason); });
