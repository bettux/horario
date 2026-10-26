import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, abrirDialogo, confirmar, mostrarErro } from './pagina.js';
import { sb, q } from './supabase.js';
import { esc } from './util.js';

const { main } = await iniciarPagina('turmas');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Gestão de turmas</h1>
    <p class="sub">A turma traz automaticamente todos os componentes que a matriz prevê para o semestre.</p></div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div class="campo" style="width:150px"><label for="per">Período letivo</label><select id="per"></select></div>
      <button class="btn btn-p" id="nova">Nova turma</button>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <section class="card tabela-box" id="lista"><p class="carregando" style="padding:16px">Carregando…</p></section>`;

const [periodos, cursos, matrizes, comps] = await Promise.all([
  listarPeriodos(),
  q(sb.from('cursos').select('*')),
  q(sb.from('matrizes').select('*').order('nome')),
  q(sb.from('componentes').select('id, matriz_id, semestre, nome, carga, modalidade, regra').eq('ativo', true).order('ordem')),
]);
const sel = main.querySelector('#per');
let periodoId = preencherPeriodos(sel, periodos);
sel.addEventListener('change', () => { periodoId = sel.value; listar(); });

const cursoDa = (matrizId) => cursos.find((c) => c.id === matrizes.find((m) => m.id === matrizId)?.curso_id);
const rotuloMatriz = (m) => { const c = cursos.find((x) => x.id === m.curso_id); return `${c.sigla || c.nome} · ${m.nome}`; };

if (!periodoId) {
  main.querySelector('#lista').innerHTML = '<p class="muted" style="padding:16px">Crie um período em Configurações acadêmicas antes de cadastrar turmas.</p>';
  main.querySelector('#nova').disabled = true;
} else {
  listar();
}
main.querySelector('#nova').addEventListener('click', () => dialogoTurma());

async function listar() {
  const turmas = await q(sb.from('turmas').select('*, subturmas(id, nome), aulas(id), ofertas_pos(id)').eq('periodo_id', periodoId));
  turmas.sort((a, b) => rotuloMatriz(matrizes.find((m) => m.id === a.matriz_id)).localeCompare(rotuloMatriz(matrizes.find((m) => m.id === b.matriz_id))) || a.semestre - b.semestre || a.identificacao.localeCompare(b.identificacao));
  main.querySelector('#lista').innerHTML = `<table style="min-width:680px">
    <thead><tr><th>Curso / matriz</th><th>Semestre</th><th>Turma</th><th>Subturmas</th><th>Componentes</th><th>Situação</th><th></th></tr></thead>
    <tbody>${turmas.length ? turmas.map((t) => {
      const m = matrizes.find((x) => x.id === t.matriz_id);
      const pos = cursoDa(t.matriz_id)?.nivel === 'pos';
      const n = comps.filter((c) => c.matriz_id === t.matriz_id && c.semestre === t.semestre).length;
      const usada = t.aulas.length + t.ofertas_pos.length;
      return `<tr><td>${esc(rotuloMatriz(m))}</td><td>${pos ? 'Pós' : t.semestre + 'º'}</td><td>${esc(t.identificacao)}</td>
        <td>${pos ? '<span class="muted">—</span>' : t.subturmas.map((s) => esc(s.nome)).sort().join(', ') || '<span class="chip chip-erro">nenhuma</span>'}</td>
        <td class="num">${n}</td>
        <td>${usada ? `<span class="chip chip-ok">${pos ? t.ofertas_pos.length + ' módulo(s)' : t.aulas.length + ' aula(s) na grade'}</span>` : '<span class="chip chip-aviso">Sem alocação</span>'}</td>
        <td><div class="acoes"><button class="btn btn-s" data-editar="${t.id}">Editar</button>${usada ? '' : `<button class="btn btn-s" data-excluir="${t.id}">Excluir</button>`}</div></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted">Nenhuma turma neste período.</td></tr>'}</tbody></table>`;

  main.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => dialogoTurma(turmas.find((t) => t.id === b.dataset.editar))));
  main.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Excluir turma?', 'A turma não tem aulas alocadas. As subturmas também serão excluídas.', 'Excluir', true))) return;
    try { await q(sb.from('turmas').delete().eq('id', b.dataset.excluir)); avisar('Turma excluída.'); listar(); }
    catch (e) { mostrarErro(main.querySelector('#msg'), e); }
  }));
}

function dialogoTurma(t) {
  const nova = !t;
  const subs = t ? t.subturmas.map((s) => ({ ...s })) : [{ nome: 'T1' }];
  const removidas = [];
  const opMatriz = matrizes.filter((m) => m.vigente || m.id === t?.matriz_id).map((m) => `<option value="${m.id}"${m.id === t?.matriz_id ? ' selected' : ''}>${esc(rotuloMatriz(m))}</option>`).join('');

  const dlg = abrirDialogo({
    titulo: nova ? 'Nova turma' : 'Editar turma',
    confirmar: nova ? 'Criar turma' : 'Salvar',
    corpo: `
      <div class="campo"><label for="t-mat">Curso e matriz</label><select id="t-mat" ${nova ? '' : 'disabled'}>${opMatriz}</select></div>
      <div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="campo" id="box-sem"><label for="t-sem">Semestre</label><select id="t-sem" ${nova ? '' : 'disabled'}></select></div>
        <div class="campo"><label for="t-id">Identificação</label><input id="t-id" value="${esc(t?.identificacao || 'Turma A')}" required></div>
      </div>
      <div class="campo" id="box-sub"><span class="rotulo">Subturmas</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center" id="subs"></div>
        <span class="muted" style="font-size:12px">Aula com T1+T2 juntas conta uma vez para o professor.</span></div>
      <div id="previa" style="padding:12px 14px;border-radius:10px;background:#F7F7F9;font-size:13px;max-height:220px;overflow:auto"></div>`,
    aoConfirmar: async (d) => {
      const ident = d.querySelector('#t-id').value.trim();
      if (!ident) throw new Error('Informe a identificação.');
      const matriz = d.querySelector('#t-mat').value;
      const pos = cursoDa(matriz)?.nivel === 'pos';
      const semestre = pos ? 0 : +d.querySelector('#t-sem').value;
      if (!pos && !subs.length) throw new Error('A turma precisa de pelo menos uma subturma.');
      let id = t?.id;
      if (nova) {
        const [criada] = await q(sb.from('turmas').insert({ periodo_id: periodoId, matriz_id: matriz, semestre, identificacao: ident }).select());
        id = criada.id;
      } else {
        await q(sb.from('turmas').update({ identificacao: ident }).eq('id', id));
      }
      if (!pos) {
        for (const r of removidas) {
          try { await q(sb.from('subturmas').delete().eq('id', r.id)); }
          catch { throw new Error(`A subturma ${r.nome} tem aulas na grade e não pode ser removida.`); }
        }
        const novas = subs.filter((s) => !s.id).map((s) => ({ turma_id: id, nome: s.nome }));
        if (novas.length) await q(sb.from('subturmas').insert(novas));
      }
      avisar(nova ? 'Turma criada.' : 'Turma salva.');
      listar();
    },
  });

  const selMat = dlg.querySelector('#t-mat'), selSem = dlg.querySelector('#t-sem');
  function atualizar() {
    const pos = cursoDa(selMat.value)?.nivel === 'pos';
    dlg.querySelector('#box-sem').classList.toggle('oculto', pos);
    dlg.querySelector('#box-sub').classList.toggle('oculto', pos);
    if (nova) {
      const sems = [...new Set(comps.filter((c) => c.matriz_id === selMat.value && c.semestre > 0).map((c) => c.semestre))].sort((a, b) => a - b);
      const atual = selSem.value;
      selSem.innerHTML = sems.map((s) => `<option value="${s}">${s}º</option>`).join('');
      if (sems.includes(+atual)) selSem.value = atual;
    } else {
      selSem.innerHTML = `<option>${t.semestre}º</option>`;
    }
    const sem = pos ? 0 : +(nova ? selSem.value : t.semestre);
    const lista = comps.filter((c) => c.matriz_id === selMat.value && c.semestre === sem);
    dlg.querySelector('#previa').innerHTML = `<strong>${nova ? 'Entram automaticamente' : 'Componentes da turma'}: ${lista.length}</strong>` +
      lista.map((c) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #EEEEF1"><span>${esc(c.nome)}</span><span class="muted num">${c.carga ?? '—'}${pos ? 'h' : ''}${c.modalidade.startsWith('ead') ? ' · EAD' : ''}${c.regra === 'pi_extensao' ? ' · especial' : ''}</span></div>`).join('');
  }
  function desenharSubs() {
    dlg.querySelector('#subs').innerHTML = subs.map((s, i) => `<span class="tag">${esc(s.nome)}<button type="button" aria-label="Remover ${esc(s.nome)}" data-rm="${i}">×</button></span>`).join('') +
      '<button type="button" class="btn btn-s" id="add-sub">+ Subturma</button>';
    dlg.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { const [r] = subs.splice(+b.dataset.rm, 1); if (r.id) removidas.push(r); desenharSubs(); }));
    dlg.querySelector('#add-sub').addEventListener('click', () => {
      let n = subs.length + 1; while (subs.some((s) => s.nome === `T${n}`)) n++;
      subs.push({ nome: `T${n}` }); desenharSubs();
    });
  }
  selMat.addEventListener('change', atualizar);
  selSem.addEventListener('change', atualizar);
  atualizar(); desenharSubs();
}
