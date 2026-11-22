import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, abrirDialogo, confirmar, mostrarErro } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc } from './util.js';

const { main } = await iniciarPagina('turmas');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Gestão de turmas</h1>
    <p class="sub">A turma traz automaticamente todos os componentes que a matriz prevê para o semestre.</p></div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div class="campo" style="width:150px"><label for="per">Período letivo</label><select id="per"></select></div>
      <button class="btn" id="copiar">Copiar de outro período</button>
      <button class="btn btn-p" id="nova">Nova turma</button>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <section class="card tabela-box" id="lista"><p class="carregando" style="padding:16px">Carregando…</p></section>`;

const [periodos, cursos, matrizes, comps, profs] = await Promise.all([
  listarPeriodos(),
  q(sb.from('cursos').select('*')),
  q(sb.from('matrizes').select('*').order('nome')),
  q(sb.from('componentes').select('id, matriz_id, semestre, nome, carga, modalidade, regra, professor').eq('ativo', true).order('ordem')),
  q(sb.from('professores').select('id, nome, ativo').order('nome')),
]);
const sel = main.querySelector('#per');
let periodoId = preencherPeriodos(sel, periodos);
sel.addEventListener('change', () => { periodoId = sel.value; listar(); });

const cursoDa = (matrizId) => cursos.find((c) => c.id === matrizes.find((m) => m.id === matrizId)?.curso_id);
const rotuloMatriz = (m) => { const c = cursos.find((x) => x.id === m.curso_id); return `${c.sigla || c.nome} · ${m.nome}`; };

if (!periodoId) {
  main.querySelector('#lista').innerHTML = '<p class="muted" style="padding:16px">Crie um período em Configurações acadêmicas antes de cadastrar turmas.</p>';
  main.querySelector('#nova').disabled = true;
  main.querySelector('#copiar').disabled = true;
} else {
  listar();
}
main.querySelector('#nova').addEventListener('click', () => dialogoTurma());
main.querySelector('#copiar').addEventListener('click', dialogoCopiar);

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
        <td><div class="acoes">${pos ? '' : `<button class="btn btn-s" data-profs="${t.id}">Professores</button>`}<button class="btn btn-s" data-editar="${t.id}">Editar</button>${usada ? '' : `<button class="btn btn-s" data-excluir="${t.id}">Excluir</button>`}</div></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted">Nenhuma turma neste período.</td></tr>'}</tbody></table>`;

  main.querySelectorAll('[data-profs]').forEach((b) => b.addEventListener('click', () => dialogoProfessores(turmas.find((t) => t.id === b.dataset.profs))));
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
        <div class="campo"><label for="t-id">Identificação (código da turma)</label><input id="t-id" value="${esc(t?.identificacao || "")}" placeholder="Ex.: CTSADS226N1" required></div>
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

// ---------- Matéria -> Professor de cada subturma ----------
async function dialogoProfessores(t) {
  const subs = [...t.subturmas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  const lista = comps.filter((c) => c.matriz_id === t.matriz_id && c.semestre === t.semestre && c.professor !== 'sem');
  const m = matrizes.find((x) => x.id === t.matriz_id);
  if (!subs.length) { avisar('Cadastre ao menos uma subturma (Editar) antes de definir os professores.', 'aviso'); return; }
  const ids = subs.map((s) => s.id);
  const [atuais, aulas, conjs] = await Promise.all([
    q(sb.from('atribuicoes').select('subturma_id, componente_id, professor_id').in('subturma_id', ids)),
    q(sb.from('aulas').select('componente_id, aula_professores(professor_id), aula_subturmas(subturma_id)').eq('turma_id', t.id)),
    q(sb.from('turma_conjuntas').select('componente_id, aulas').eq('turma_id', t.id)),
  ]);
  const conjDe = (cid) => conjs.find((x) => x.componente_id === cid)?.aulas || 0;
  const porSemana = (c) => (c.regra === 'pi_extensao' ? 2 : Math.ceil((Number(c.carga) || 0) / (periodos.find((p) => p.id === t.periodo_id)?.semanas_letivas || 20)));
  // valor gravado; se não houver, sugere o professor que já está na grade
  const valor = (sid, cid) => {
    const a = atuais.find((x) => x.subturma_id === sid && x.componente_id === cid);
    if (a) return { id: a.professor_id, sugerido: false };
    const g = aulas.find((x) => x.componente_id === cid && x.aula_subturmas.some((y) => y.subturma_id === sid) && x.aula_professores.length);
    return { id: g?.aula_professores[0].professor_id || '', sugerido: !!g };
  };
  const opcoes = (sel) => `<option value="">—</option>` + profs.filter((p) => p.ativo || p.id === sel)
    .map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)}${p.ativo ? '' : ' (inativo)'}</option>`).join('');
  let algumSugerido = false;
  const linhas = lista.map((c) => `<tr><td>${esc(c.nome)}${c.modalidade.startsWith('ead') ? ' <span class="chip chip-neu">EAD</span>' : ''}${c.professor === 'opcional' ? ' <span class="muted" style="font-size:12px">(opcional)</span>' : ''}</td>
    ${subs.map((s) => { const v = valor(s.id, c.id); if (v.sugerido) algumSugerido = true;
      return `<td><select data-sub="${s.id}" data-comp="${c.id}" aria-label="${esc(c.nome)} ${esc(s.nome)}"${v.sugerido ? ' class="sugerido"' : ''}>${opcoes(v.id)}</select></td>`; }).join('')}
    ${subs.length > 1 ? `<td><button type="button" class="btn btn-s" data-igual="${c.id}" title="Usar o professor da ${esc(subs[0].nome)} em todas">= ${esc(subs[0].nome)}</button></td>
      <td>${c.modalidade === 'ead_assincrona' ? '<span class="muted">—</span>' : `<input type="number" min="0" max="${porSemana(c)}" value="${conjDe(c.id)}" data-conj="${c.id}" style="width:64px" aria-label="Aulas conjuntas por semana de ${esc(c.nome)}"> <span class="muted" style="font-size:12px">de ${porSemana(c)}</span>`}</td>` : ''}</tr>`).join('');
  const corpo = `
    <p class="muted" style="margin:0 0 4px;font-size:13px">${esc(rotuloMatriz(m))} · ${t.semestre}º semestre · ${esc(t.identificacao)}. Defina quem dá cada matéria em cada subturma${subs.length > 1 ? ` e quantas aulas por semana são da turma inteira (${subs.map((s) => esc(s.nome)).join('+')} juntas; 0 = separadas, o normal)` : ''}. Vale só para este semestre. Isso não cria aulas na grade; serve de base para montar o horário.</p>
    ${algumSugerido ? '<p style="margin:0 0 4px;font-size:12.5px;color:var(--aviso-chip)">Os campos com fundo azul foram sugeridos a partir das aulas que já estão na grade. Confira e salve.</p>' : ''}
    <div class="tabela-box" style="max-height:60vh;overflow:auto"><table style="min-width:${300 + subs.length * 200}px">
      <thead><tr><th>Matéria</th>${subs.map((s) => `<th style="min-width:190px">${esc(s.nome)}</th>`).join('')}${subs.length > 1 ? `<th></th><th title="Aulas por semana com ${subs.map((s) => esc(s.nome)).join(' e ')} juntas. 0 = separadas.">${subs.map((s) => esc(s.nome)).join('+')} juntas / semana</th>` : ''}</tr></thead>
      <tbody>${linhas || `<tr><td colspan="${subs.length + 3}" class="muted">A matriz não tem matérias com professor neste semestre.</td></tr>`}</tbody></table></div>`;
  const dlg = abrirDialogo({
    titulo: `Professores das matérias · ${t.identificacao}`, corpo, confirmar: 'Salvar professores',
    aoConfirmar: async (d) => {
      const itens = [...d.querySelectorAll('select[data-sub]')].filter((x) => x.value).map((x) => ({ subturma_id: x.dataset.sub, componente_id: x.dataset.comp, professor_id: x.value }));
      await rpc('salvar_atribuicoes', { p_turma: t.id, p_itens: itens });
      const conjNovos = [...d.querySelectorAll('[data-conj]')].map((x) => ({ turma_id: t.id, componente_id: x.dataset.conj, aulas: Math.max(0, Math.min(10, +x.value || 0)) }));
      const zerar = conjNovos.filter((x) => !x.aulas).map((x) => x.componente_id);
      if (zerar.length) await q(sb.from('turma_conjuntas').delete().eq('turma_id', t.id).in('componente_id', zerar));
      const gravar = conjNovos.filter((x) => x.aulas);
      if (gravar.length) await q(sb.from('turma_conjuntas').upsert(gravar, { onConflict: 'turma_id,componente_id' }));
      avisar(`Professores da turma ${t.identificacao} salvos.`);
    },
  });
  dlg.style.width = 'min(980px, calc(100vw - 32px))';
  dlg.querySelectorAll('[data-igual]').forEach((b) => b.addEventListener('click', () => {
    const sels = [...dlg.querySelectorAll(`select[data-comp="${b.dataset.igual}"]`)];
    sels.slice(1).forEach((x) => { x.value = sels[0].value; x.classList.remove('sugerido'); });
  }));
  dlg.querySelectorAll('select[data-sub]').forEach((x) => x.addEventListener('change', () => x.classList.remove('sugerido')));
}

// ---------- Copiar de outro período ----------
function dialogoCopiar() {
  const atual = periodos.find((p) => p.id === periodoId);
  const outros = periodos.filter((p) => p.id !== periodoId).sort((a, b) => b.inicio.localeCompare(a.inicio));
  if (!outros.length) { avisar('Não há outro período cadastrado para copiar.', 'aviso'); return; }
  const anterior = outros.find((p) => p.inicio < atual.inicio) || outros[0];
  const rot = (p) => `${p.ano}/${p.semestre}`;
  abrirDialogo({
    titulo: `Copiar para ${rot(atual)}`, confirmar: 'Copiar',
    corpo: `
      <div class="campo"><label for="cp-origem">Copiar a graduação do período</label>
        <select id="cp-origem">${outros.map((p) => `<option value="${p.id}"${p.id === anterior.id ? ' selected' : ''}>${rot(p)}</option>`).join('')}</select></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
        <label class="check"><input type="checkbox" checked disabled> Turmas e subturmas (mesmo curso, semestre e identificação)</label>
        <label class="check"><input type="checkbox" checked disabled> Professores das matérias</label>
        <label class="check"><input type="checkbox" id="cp-disp" checked> Disponibilidade dos professores</label>
        <label class="check"><input type="checkbox" id="cp-aulas"> Aulas da grade (horário)</label>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px;line-height:1.55">Nada que já existe em ${rot(atual)} é apagado ou trocado: turmas iguais são aproveitadas,
      a disponibilidade só é copiada para quem ainda não tem, e a grade só vai para turmas que ainda estão sem aulas.
      Se a grade copiada quebrar alguma regra, nada é gravado e o sistema mostra o motivo. A pós não é copiada.
      Depois de copiar, ajuste o código das turmas (ex.: CTSADS126N1 → CTSADS127N1) em Editar.</p>`,
    aoConfirmar: async (d) => {
      const r = await rpc('copiar_periodo', { p_origem: d.querySelector('#cp-origem').value, p_destino: periodoId,
        p_disponibilidades: d.querySelector('#cp-disp').checked, p_aulas: d.querySelector('#cp-aulas').checked });
      const partes = [`${r.turmas_criadas} turma(s) criada(s)`, r.turmas_existentes ? `${r.turmas_existentes} já existia(m)` : '',
        `${r.atribuicoes} professor(es) de matéria`, d.querySelector('#cp-disp').checked ? `${r.disponibilidades} horário(s) de disponibilidade` : '',
        d.querySelector('#cp-aulas').checked ? `${r.aulas} aula(s) na grade` : ''].filter(Boolean);
      avisar(`Cópia feita: ${partes.join(', ')}.`);
      listar();
    },
  });
}
